// Managing published pages through the front door's `pages` tool: list, get (the JSON back),
// publish with page_id (replace in place, same URL), share / unshare (the stream), unpublish;
// and someone else's page reads as no page at all.

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RC2IMAGE } from "./rc2image.mjs";
import { csrfFor } from "./accounts.mjs";

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "remotecompose-server.mjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
    const s = createServer();
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    const { port } = s.address();
    await new Promise((r) => s.close(r));
    return port;
}

const doc = (words) => ({ header: { apiLevel: 7, width: 300, height: 200, profiles: 513 }, resources: {}, root: [
    { column: { modifiers: ["fillMaxSize", { padding: 16 }], children: [{ text: { text: words, fontSize: 16 } }] } }] });

test("pages: list, get, replace in place, share, unshare, unpublish", { skip: !existsSync(RC2IMAGE) && "rc2image is not built" }, async (t) => {
    const port = await freePort();
    const root = mkdtempSync(path.join(tmpdir(), "rc-pages-e2e-"));
    writeFileSync(path.join(root, "one.json"), JSON.stringify(doc("Version one")));
    const base = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, [SERVER, "--http"], {
        cwd: root,
        env: { ...process.env, MCP_HTTP_PORT: String(port), MCP_ROOT: root, RC_ACCOUNTS: "1", MCP_TOKEN: "admin-secret-token-0123456789abcdef",
            RC_ACCOUNT_URL: `${base}/account/`, MCP_PUBLIC_URL: base, RC_DB: "", RC_EMAIL_VERIFY: "off", RC_SIGNUP: "", RESEND_API_KEY: "", RC_SCRIPTS: "" },
        stdio: ["ignore", "ignore", "pipe"],
    });
    let log = "";
    child.stderr.on("data", (d) => { log += d; });
    t.after(() => { child.kill(); rmSync(root, { recursive: true, force: true }); });
    for (let i = 0; i < 300; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {} await sleep(100); }

    async function account(email, name) {
        const reg = await fetch(`${base}/account/register`, { method: "POST", redirect: "manual",
            headers: { Origin: base, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email, name }) });
        const sid = /rc_session=([^;]*)/.exec(reg.headers.get("set-cookie"))[1];
        const token = /rc_[A-Za-z0-9_-]{43}/.exec(await reg.text())[0];
        const rpc = async (method, params, session) => {
            const r = await fetch(`${base}/mcp`, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(session ? { "Mcp-Session-Id": session } : {}) } });
            const text = await r.text();
            return { session: r.headers.get("mcp-session-id"), body: JSON.parse(text.startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data:")).slice(5)) };
        };
        const { session } = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
        const call = async (name, args) => {
            const r = (await rpc("tools/call", { name, arguments: args }, session)).body.result;
            return { error: r.isError === true, text: r.content.map((x) => x.text ?? "").join("\n") };
        };
        call.sid = sid;
        return call;
    }
    const a = await account("a@example.com", "Ada");
    const b = await account("b@example.com", "Bo");
    const json = (r) => JSON.parse(r.text.slice(r.text.indexOf("{"), r.text.lastIndexOf("}") + 1));

    // Publish, then list and get it back.
    let r = await a("publish", { json_path: "one.json", title: "One" });
    assert.ok(!r.error, r.text);
    const id = /"page_id": "([^"]+)"/.exec(r.text)[1];
    let list = json(await a("pages", {}));
    assert.deepEqual(list.pages.map((p) => p.id), [id]);
    assert.equal(list.pages[0].stream, undefined);
    const got = json(await a("pages", { action: "get", page_id: id }));
    assert.equal(got.title, "One");
    assert.deepEqual(got.json, doc("Version one"));
    assert.ok(got.json_path, "a copy to edit");
    const rc = await fetch(got.rc_url);
    assert.equal(rc.status, 200);
    assert.ok(Buffer.from(await rc.arrayBuffer()).toString("latin1").includes("Version one"));

    // Edit the copy and publish it in place: the same id and URL, the new document.
    const copy = path.join(root, got.json_path);
    writeFileSync(copy, readFileSync(copy, "utf8").replace("Version one", "Version two"));
    r = await a("publish", { json_path: got.json_path, page_id: id, title: "Two" });
    assert.ok(!r.error, r.text);
    assert.match(r.text, new RegExp(`"page_id": "${id}"`));
    assert.match(r.text, /"replaced": true/);
    const meta = JSON.parse(readFileSync(path.join(root, "pages", id, "meta.json"), "utf8"));
    assert.equal(meta.title, "Two");
    assert.equal(meta.created, got.created, "keeps when it was first published");
    assert.ok(meta.updated);
    const page = await (await fetch(`${base}/pages/${id}/`)).text();
    assert.ok(Buffer.from(/var DATA = "([^"]*)"/.exec(page)[1], "base64").toString("latin1").includes("Version two"));
    assert.equal(json(await a("pages", {})).pages.length, 1, "replaced, not added");

    // The same document published again without page_id (a title changed): a second page, and
    // the result says which page it duplicates and how to replace instead. Someone else is not told.
    r = await a("publish", { json_path: got.json_path, title: "Two, renamed" });
    assert.ok(!r.error, r.text);
    assert.match(r.text, new RegExp(`"same_document_as": "${id}"`));
    assert.match(r.text, /publish with page_id/);
    const twin = /"page_id": "([^"]+)"/.exec(r.text)[1];
    assert.notEqual(twin, id);
    writeFileSync(path.join(root, "two.json"), readFileSync(copy, "utf8"));
    r = await b("publish", { json_path: "two.json", title: "Mine" });
    assert.ok(!r.error && !/same_document_as/.test(r.text), r.text);
    assert.match((await a("pages", { action: "unpublish", page_id: twin })).text, /Unpublished/);
    assert.deepEqual(json(await b("pages", {})).pages.length, 1);
    await b("pages", { action: "unpublish", page_id: json(await b("pages", {})).pages[0].id });

    // Someone else's page: no page at all, for every action.
    for (const [tool, args] of [["pages", { action: "get", page_id: id }], ["pages", { action: "share", page_id: id }],
        ["pages", { action: "unpublish", page_id: id }], ["publish", { json_path: "one.json", page_id: id }]]) {
        r = await b(tool, args);
        assert.equal(r.error, true, `${tool} ${args.action ?? ""}`);
        assert.match(r.text, /no published page .* of yours/);
    }
    assert.deepEqual(json(await b("pages", {})).pages, []);

    // The stream: share under a name, listed so; unshare.
    r = await a("pages", { action: "share", page_id: id, title: "My page" });
    assert.ok(!r.error, r.text);
    assert.deepEqual(json(await a("pages", {})).pages[0].stream?.title, "My page");
    assert.match(await (await fetch(`${base}/stream/`)).text(), /My page/);
    r = await a("pages", { action: "unshare", page_id: id });
    assert.match(r.text, /Took .* out of the stream/);
    assert.equal(json(await a("pages", {})).pages[0].stream, undefined);

    // Unpublish: gone.
    r = await a("pages", { action: "unpublish", page_id: id });
    assert.match(r.text, /Unpublished/);
    assert.equal((await fetch(`${base}/pages/${id}/`)).status, 404);
    assert.deepEqual(json(await a("pages", {})).pages, []);

    // The account page: each card carries its actions (no separate Stream section); deleting
    // asks first, and works only for the page's owner.
    r = await a("publish", { json_path: "one.json", title: "Three" });
    const third = /"page_id": "([^"]+)"/.exec(r.text)[1];
    const accountPage = async (who) => (await fetch(`${base}/account/`, { headers: { Cookie: `rc_session=${who.sid}` } })).text();
    const html = await accountPage(a);
    assert.ok(!/<h2>Stream<\/h2>/.test(html), "no separate stream section");
    assert.match(html, new RegExp(`action="pages/${third}/delete"[^]*?Delete permanently`));
    assert.match(html, /<summary class="link">Post to the stream<\/summary>/);
    assert.match(html, /<summary class="link danger">Delete…<\/summary>/);
    const del = (who) => fetch(`${base}/account/pages/${third}/delete`, { method: "POST", redirect: "manual",
        headers: { Origin: base, "Content-Type": "application/x-www-form-urlencoded", Cookie: `rc_session=${who.sid}` },
        body: new URLSearchParams({ csrf: csrfFor(who.sid) }) });
    assert.equal((await del(b)).status, 303);
    assert.equal((await fetch(`${base}/pages/${third}/`)).status, 200, "someone else cannot delete it");
    assert.equal((await del(a)).status, 303);
    assert.equal((await fetch(`${base}/pages/${third}/`)).status, 404);
    assert.ok(!(await accountPage(a)).includes(third));
    assert.equal(log.includes("unhandled"), false, log);
});
