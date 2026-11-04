// App scripts end to end, through the front door: off by default and not listed; the account
// switch turns them on; publish then takes a script, refuses one that does not compile, reports
// the dry run, and the script travels INSIDE the document (system:__logic__), which the page runs sandboxed.

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { csrfFor } from "./accounts.mjs";
import { RC2IMAGE } from "./rc2image.mjs";
import { compileAppScript } from "./app-script.mjs";

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "remotecompose-server.mjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
    const s = createServer();
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    const { port } = s.address();
    await new Promise((r) => s.close(r));
    return port;
}

const DOC = { header: { apiLevel: 7, width: 300, height: 200, profiles: 513 }, resources: {}, root: [
    { variable: { name: "summary", vtype: "string", value: "Empty", export: true } },
    { column: { modifiers: ["fillMaxSize", { padding: 16 }, { spacedBy: 8 }], children: [
        { text: { text: "@summary", fontSize: 16 } },
        { box: { modifiers: ["fillMaxWidth", { height: 48 }, { onClick: { type: "hostNamedAction", name: "add", value: "apple" } }], children: [{ text: { text: "Add" } }] } },
    ] } }] };

test("app scripts: opt-in per account, then publish with a script", { skip: !existsSync(RC2IMAGE) && "rc2image is not built" }, async (t) => {
    const port = await freePort();
    const root = mkdtempSync(path.join(tmpdir(), "rc-app-e2e-"));
    writeFileSync(path.join(root, "cart.json"), JSON.stringify(DOC));
    writeFileSync(path.join(root, "cart.ts"), "let n: number = rc.storage.get('n') ?? 0;\nrc.onAction('add', (v) => { n++; rc.set('summary', `${n} × ${v}`); rc.storage.set('n', n); });\n");
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

    const reg = await fetch(`${base}/account/register`, { method: "POST", redirect: "manual",
        headers: { Origin: base, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email: "dev@example.com", name: "Dev" }) });
    const sid = /rc_session=([^;]*)/.exec(reg.headers.get("set-cookie"))[1];
    const token = /rc_[A-Za-z0-9_-]{43}/.exec(await reg.text())[0];
    async function rpc(method, params, session) {
        const r = await fetch(`${base}/mcp`, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(session ? { "Mcp-Session-Id": session } : {}) } });
        const text = await r.text();
        return { session: r.headers.get("mcp-session-id"), body: JSON.parse(text.startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data:")).slice(5)) };
    }
    const connect = async () => {
        const { session } = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
        return {
            tools: async () => (await rpc("tools/list", {}, session)).body.result.tools,
            call: async (name, args) => (await rpc("tools/call", { name, arguments: args }, session)).body.result,
        };
    };
    const offered = (tools) => ({
        publish: "script" in tools.find((x) => x.name === "publish").inputSchema.properties,
        app: tools.find((x) => x.name === "reference").inputSchema.properties.topic.enum.includes("app"),
    });

    // Off: not listed, refused, the guide says how to turn it on.
    let c = await connect();
    assert.deepEqual(offered(await c.tools()), { publish: false, app: false });
    let r = await c.call("publish", { json_path: "cart.json", script_path: "cart.ts" });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /app scripts are off for your account/);
    assert.match((await c.call("reference", { topic: "app" })).content[0].text, /off for your account/);
    assert.ok(!/App scripts are on/.test((await c.call("reference", {})).content[0].text), "no workflow step");
    assert.ok(!/^\[app\]/m.test((await c.call("reference", { query: "save state between visits" })).content[0].text), "not searched");
    assert.match(await (await fetch(`${base}/account/`, { headers: { Cookie: `rc_session=${sid}` } })).text(), /id="scripts"[\s\S]*?Turn on/);

    // A JSON that carries a system:__logic__, published with scripts off: inert, and said so.
    const doc2 = JSON.parse(readFileSync(path.join(root, "cart.json"), "utf8"));
    doc2.root.unshift({ variable: { name: "system:__logic__", vtype: "string", value: "rc.set('summary', 'carried');", export: true } });
    writeFileSync(path.join(root, "carried.json"), JSON.stringify(doc2));
    r = await c.call("publish", { json_path: "carried.json", title: "Carried" });
    let carriedText = r.content.map((x) => x.text ?? "").join("\n");
    assert.ok(!r.isError, carriedText);
    assert.match(carriedText, /carries an app script \(system:__logic__\), but app scripts are off for you: the page does not run it/);
    const offPage = await (await fetch(`${base}/pages/${/"page_id": "([^"]+)"/.exec(carriedText)[1]}/`)).text();
    assert.ok(!/"embedded":true/.test(offPage) && !/setAttribute\("sandbox"/.test(offPage), "no app bridge on the page");

    // On.
    assert.equal((await fetch(`${base}/account/scripts`, { method: "POST", redirect: "manual",
        headers: { Origin: base, "Content-Type": "application/x-www-form-urlencoded", Cookie: `rc_session=${sid}` },
        body: new URLSearchParams({ csrf: csrfFor(sid), on: "1" }) })).status, 303);
    c = await connect();
    assert.deepEqual(offered(await c.tools()), { publish: true, app: true });
    assert.match((await c.call("reference", { topic: "app" })).content[0].text, /STRONGLY prefer a document without a script[\s\S]*declare const rc/);
    assert.match((await c.call("reference", {})).content[0].text, /App scripts are on for you, and the default is still NO script[\s\S]*publish it with\s+script/, "the workflow's step");
    assert.match((await c.call("reference", { query: "save state between visits localStorage" })).content[0].text, /^\[app\]/m, "searched");

    // A script that does not compile is refused; one with a typo publishes, with the warning.
    r = await c.call("publish", { json_path: "cart.json", script: "const x: number = ;" });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /script: .*line 1/);
    r = await c.call("publish", { json_path: "cart.json", script: "rc.onAction('ad', () => rc.set('sumary', 'x'));" });
    let text = r.content.map((x) => x.text ?? "").join("\n");
    assert.match(text, /no action \\"ad\\"[^]*did you mean \\"add\\"/);
    assert.match(text, /no variable \\"sumary\\"[^]*did you mean \\"summary\\"/);

    // The real one: published, the dry run clean, app.ts beside the page, the page sandboxes it.
    r = await c.call("publish", { json_path: "cart.json", script_path: "cart.ts", title: "Cart" });
    text = r.content.map((x) => x.text ?? "").join("\n");
    assert.ok(!r.isError, text);
    assert.match(text, /Script dry run: sets summary = \\"1 × apple\\"; handles \\"add\\"; uses storage/);
    assert.match(text, /Embedded in the document \(system:__logic__, \d+ bytes of the \.rc\)/);
    assert.ok(!/Script warnings|Script errors/.test(text), text);
    const id = /"page_id": "([^"]+)"/.exec(text)[1];
    assert.equal(readFileSync(path.join(root, "pages", id, "app.ts"), "utf8"), readFileSync(path.join(root, "cart.ts"), "utf8"));
    assert.equal(JSON.parse(readFileSync(path.join(root, "pages", id, "meta.json"), "utf8")).app, true);
    const page = await (await fetch(`${base}/pages/${id}/`)).text();
    assert.match(page, /setAttribute\("sandbox", "allow-scripts"\)/);
    assert.ok(!/allow-same-origin/.test(page), "never same-origin");
    assert.match(page, /"label":"Script"/, "the Script button");
    assert.match(page, /id="app-log"/, "the App panel");
    // The script is in the document, not beside it in the page: the .rc carries the compiled JS.
    const js = compileAppScript(readFileSync(path.join(root, "cart.ts"), "utf8"));
    const rc = Buffer.from(/var DATA = "([^"]*)"/.exec(page)[1], "base64").toString("latin1");
    assert.ok(rc.includes("system:__logic__") && rc.includes("rc.onAction('add'"), "the .rc carries the script");
    assert.ok(!page.includes(js.slice(0, 40).replace(/</g, "")), "not written into the page beside it");
    assert.match(page, /"embedded":true/);
    // Never a value: not settable from the URL, not in the panel.
    assert.ok(!/"declared":\{[^}]*system:__logic__/.test(page) && !/"name":"system:__logic__"/.test(page), "system:__logic__ is not a settable variable");

    // A JSON that already carries its system:__logic__ (a republish): with scripts on, it is the script.
    r = await c.call("publish", { json_path: "carried.json", title: "Carried" });
    text = r.content.map((x) => x.text ?? "").join("\n");
    assert.ok(!r.isError, text);
    assert.match(text, /Embedded in the document/, "scripts on: a carried script runs (republish)");
    assert.equal(log.includes("unhandled"), false, log);
});
