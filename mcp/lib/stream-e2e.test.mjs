// The stream end to end, through the examples server: public name, posting a published page,
// the stream page (both orders), votes (form and JSON), removal, and what a stranger cannot do.

import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { csrfFor, openAccounts } from "./accounts.mjs";

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "examples-server.mjs");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
    const s = createServer();
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    const { port } = s.address();
    await new Promise((r) => s.close(r));
    return port;
}

async function start() {
    const port = await freePort();
    const root = mkdtempSync(path.join(tmpdir(), "rc-stream-e2e-"));
    const child = spawn(process.execPath, [SERVER, "--http"], {
        env: { ...process.env, MCP_HTTP_PORT: String(port), MCP_ROOT: root, RC_ACCOUNTS: "1", MCP_TOKEN: "admin-secret-token-0123456789abcdef",
            RC_ACCOUNT_URL: `http://127.0.0.1:${port}/account/`, RC_DB: "", RC_EMAIL_VERIFY: "off", RC_SIGNUP: "", RESEND_API_KEY: "",
            RC_ADMIN_EMAILS: "boss@example.com" },
        stdio: ["ignore", "ignore", "pipe"],
    });
    let log = "";
    child.stderr.on("data", (d) => { log += d; });
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 300; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {} await sleep(100); }
    const post = (p, form, cookie, headers = {}) => fetch(`${base}${p}`, { method: "POST", redirect: "manual",
        headers: { Origin: base, "Content-Type": "application/x-www-form-urlencoded", ...(cookie ? { Cookie: `rc_session=${cookie}` } : {}), ...headers },
        body: new URLSearchParams(form) });
    const get = (p, cookie) => fetch(`${base}${p}`, { headers: cookie ? { Cookie: `rc_session=${cookie}` } : {} });
    return { base, root, post, get, log: () => log, stop: () => { child.kill(); rmSync(root, { recursive: true, force: true }); } };
}

const sidOf = (res) => /rc_session=([^;]*)/.exec(res.headers.get("set-cookie") ?? "")?.[1];

/** A published page as the deploy server leaves it: pages/<id>/meta.json (+ preview), and its row. */
async function publish(s, accountId, id, title) {
    const dir = path.join(s.root, "pages", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ id, title, created: new Date().toISOString(), rc_bytes: 1234, document: { width: 320, height: 200 }, preview: true }));
    writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>page</title>");
    const store = await openAccounts(path.join(s.root, "rc.db"));
    store.recordPage({ id, accountId, title, url: `${s.base}/pages/${id}/` });
    store.close();
}

test("stream: post, list, vote, sort, remove", async (t) => {
    const s = await start();
    t.after(() => s.stop());
    const reg = async (email) => {
        const r = await s.post("/account/register", { email, name: "" });
        assert.equal(r.status, 200, s.log());
        return sidOf(r);
    };
    const ann = await reg("ann@example.com"), bob = await reg("bob@example.com"), boss = await reg("boss@example.com");
    const ids = await (async () => { const st = await openAccounts(path.join(s.root, "rc.db")); const r = ["ann", "bob"].map((n) => st.findAccount(`${n}@example.com`).id); st.close(); return r; })();
    const P1 = "a".repeat(22), P2 = "b".repeat(22), PB = "c".repeat(22);
    await publish(s, ids[0], P1, "Clock");
    await publish(s, ids[0], P2, "Weather");
    await publish(s, ids[1], PB, "Bob's page");

    // Empty, and the nav has the tab.
    let page = await (await s.get("/stream/")).text();
    assert.match(page, /Nothing in the stream yet/);
    assert.match(page, /href="\.\.\/stream\/" aria-current="page">Stream/);
    assert.match(page, /Sign in<\/a> to vote/);

    // Posting needs a name (registration left it empty); the account page says so.
    let acctPage = await (await s.get("/account/", ann)).text();
    assert.match(acctPage, /id="name"/);
    assert.match(acctPage, /Post to the stream<\/button>/);
    let r = await s.post("/account/stream", { csrf: csrfFor(ann), page_id: P1, title: "My clock" }, ann);
    assert.equal(r.status, 400);
    assert.match(await r.text(), /Set your name first/);
    r = await s.post("/account/name", { csrf: csrfFor(ann), name: "Ann K" }, ann);
    assert.equal(r.status, 303);
    await s.post("/account/name", { csrf: csrfFor(bob), name: "Bob" }, bob);

    // Post two pages; a stranger's page is refused; a stale form is refused.
    assert.equal((await s.post("/account/stream", { csrf: csrfFor(ann), page_id: P1, title: "My clock" }, ann)).status, 303);
    await sleep(5);
    assert.equal((await s.post("/account/stream", { csrf: csrfFor(ann), page_id: P2, title: "Weather <b>now</b>" }, ann)).status, 303);
    r = await s.post("/account/stream", { csrf: csrfFor(ann), page_id: PB, title: "Not mine" }, ann);
    assert.match(await r.text(), /only post your own/);
    assert.equal((await s.post("/account/stream", { csrf: "nope", page_id: PB, title: "x" }, bob)).status, 403);

    page = await (await s.get("/stream/")).text();
    assert.ok(page.indexOf("Weather &lt;b&gt;now&lt;/b&gt;") < page.indexOf("My clock"), "newest first, title escaped");
    assert.match(page, /by Ann K/);
    assert.match(page, new RegExp(`href="${s.base}/pages/${P1}/"`), "a card opens the published page");
    assert.match(page, new RegExp(`src="${s.base}/pages/${P1}/preview.png"`));
    assert.match(page, /2 items/);

    // Votes: the form redirects back; JSON answers the score; one per account, replaced, taken back.
    r = await s.post(`/stream/${P1}/vote`, { csrf: csrfFor(bob), value: "1" }, bob);
    assert.equal(r.status, 303);
    assert.equal(r.headers.get("location"), `../#s-${P1}`);
    r = await s.post(`/stream/${P1}/vote`, { csrf: csrfFor(boss), value: "1" }, boss, { Accept: "application/json" });
    assert.deepEqual(await r.json(), { score: 2, ups: 2, downs: 0, my_vote: 1 });
    r = await s.post(`/stream/${P1}/vote`, { csrf: csrfFor(boss), value: "-1" }, boss, { Accept: "application/json" });
    assert.deepEqual(await r.json(), { score: 0, ups: 1, downs: 1, my_vote: -1 });
    r = await s.post(`/stream/${P1}/vote`, { csrf: csrfFor(boss), value: "0" }, boss, { Accept: "application/json" });
    assert.deepEqual(await r.json(), { score: 1, ups: 1, downs: 0, my_vote: 0 });
    await s.post(`/stream/${P2}/vote`, { csrf: csrfFor(bob), value: "-1" }, bob);
    // Signed out, a stale form, another site: no vote counted.
    assert.equal((await s.post(`/stream/${P2}/vote`, { value: "1" }, null, { Accept: "application/json" })).status, 401);
    assert.equal((await s.post(`/stream/${P2}/vote`, { csrf: "stale", value: "1" }, ann)).status, 403);
    assert.equal((await s.post(`/stream/${P2}/vote`, { csrf: csrfFor(ann), value: "1" }, ann, { Origin: "https://evil.example" })).status, 403);
    assert.equal((await s.post(`/stream/${P2}/vote`, { csrf: csrfFor(ann), value: "5" }, ann)).status, 400);

    // Top: by score.
    page = await (await s.get("/stream/?sort=top", bob)).text();
    assert.ok(page.indexOf("My clock") < page.indexOf("Weather"), "highest score first");
    assert.match(page, /Top<\/a>/);
    assert.match(page, new RegExp(`id="s-${P1}"[\\s\\S]*?aria-pressed="true" aria-label="Vote up"`), "bob sees his up vote");
    assert.match(page, /You are <b>Bob<\/b> \(<a href="\.\.\/account\/#name">change<\/a>\)/);
    // Changing it: the stream shows the new name at once.
    assert.equal((await s.post("/account/name", { csrf: csrfFor(bob), name: "Robert" }, bob)).status, 303);
    assert.match(await (await s.get("/account/", bob)).text(), /<b>Robert<\/b>[^\n]*Change name/);
    await s.post("/account/name", { csrf: csrfFor(ann), name: "Ann Karenina" }, ann);
    assert.match(await (await s.get("/stream/")).text(), /by Ann Karenina/);

    // The account page shows the score and offers rename and remove.
    acctPage = await (await s.get("/account/", ann)).text();
    assert.match(acctPage, /in the stream<\/span> <span class="muted">score 1 \(\+1 \/ −0\)/);
    assert.match(acctPage, /Rename<\/button>/);

    // A stranger cannot remove an item; its owner can; an admin can remove any from the stream page.
    await s.post(`/account/stream/${P1}/remove`, { csrf: csrfFor(bob) }, bob);
    assert.match(await (await s.get("/stream/")).text(), /My clock/);
    assert.equal((await s.post(`/stream/${P2}/remove`, { csrf: csrfFor(bob) }, bob)).status, 403);
    assert.equal((await s.post(`/account/stream/${P1}/remove`, { csrf: csrfFor(ann) }, ann)).status, 303);
    assert.equal((await s.post(`/stream/${P2}/remove`, { csrf: csrfFor(boss) }, boss)).status, 303);
    assert.match(await (await s.get("/stream/")).text(), /Nothing in the stream yet/);
});

test("showcases: an admin marks a stream item; the Showcases page shows it first", async (t) => {
    const s = await start();
    t.after(() => s.stop());
    const reg = async (email, name) => sidOf(await s.post("/account/register", { email, name }));
    const ann = await reg("ann@example.com", "Ann"), boss = await reg("boss@example.com", "Boss");
    const st = await openAccounts(path.join(s.root, "rc.db"));
    const annId = st.findAccount("ann@example.com").id;
    st.close();
    const P = "f".repeat(22);
    await publish(s, annId, P, "Orbit");
    await s.post("/account/stream", { csrf: csrfFor(ann), page_id: P, title: "Orbits, live" }, ann);

    let show = await (await s.get("/showcases/")).text();
    assert.ok(!show.includes("From the stream"), "nothing marked yet");
    assert.match(await (await s.get("/stream/", boss)).text(), /Make showcase<\/button>/);
    assert.ok(!(await (await s.get("/stream/", ann)).text()).includes("Make showcase"), "not offered to others");
    assert.equal((await s.post(`/stream/${P}/feature`, { csrf: csrfFor(ann), value: "1" }, ann)).status, 403);
    assert.equal((await s.post(`/stream/${P}/feature`, { csrf: csrfFor(boss), value: "1" }, boss)).status, 303);

    show = await (await s.get("/showcases/")).text();
    assert.match(show, /From the stream/);
    assert.ok(show.indexOf("Orbits, live") < show.indexOf('<h2 class="cat">Showcases</h2>'), "before the catalog's");
    assert.match(show, /by Ann/);
    assert.match(show, new RegExp(`href="${s.base}/pages/${P}/"`));
    const stream = await (await s.get("/stream/", boss)).text();
    assert.match(stream, /class="star">Showcase/);
    assert.match(stream, /Unshowcase<\/button>/);

    await s.post(`/stream/${P}/feature`, { csrf: csrfFor(boss), value: "0" }, boss);
    assert.ok(!(await (await s.get("/showcases/")).text()).includes("From the stream"));
    // Marked, then taken out of the stream by its owner: off the Showcases page too.
    await s.post(`/stream/${P}/feature`, { csrf: csrfFor(boss), value: "1" }, boss);
    await s.post(`/account/stream/${P}/remove`, { csrf: csrfFor(ann) }, ann);
    assert.ok(!(await (await s.get("/showcases/")).text()).includes("From the stream"));
});
