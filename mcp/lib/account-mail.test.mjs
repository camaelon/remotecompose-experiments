// End to end: the examples server (account pages + an MCP endpoint) in HTTP mode with accounts
// and email verification on, sending through a local stand-in for Resend's API.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "examples-server.mjs");
const KEY = "re_e2e_key_abcdefghijklmnop";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
    const s = createServer();
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    const { port } = s.address();
    await new Promise((r) => s.close(r));
    return port;
}

async function mailMock() {
    const got = [];
    let status = 200;
    const server = createServer(async (req, res) => {
        let body = ""; for await (const c of req) body += c;
        got.push({ auth: req.headers.authorization, json: JSON.parse(body) });
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(status === 200 ? { id: `m${got.length}` } : { statusCode: status, message: "domain not verified" }));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    return { got, url: `http://127.0.0.1:${server.address().port}/emails`, close: () => server.close(), fail: (s) => { status = s; } };
}

async function start(env) {
    const port = await freePort();
    const root = mkdtempSync(path.join(tmpdir(), "rc-acct-e2e-"));
    const child = spawn(process.execPath, [SERVER, "--http"], {
        env: { ...process.env, MCP_HTTP_PORT: String(port), MCP_ROOT: root, RC_ACCOUNTS: "1", MCP_TOKEN: "admin-secret-token-0123456789abcdef",
            RC_ACCOUNT_URL: `http://127.0.0.1:${port}/account/`, RC_DB: "", RC_EMAIL_VERIFY: "", RC_SIGNUP: "", RESEND_API_KEY: "", ...env },
        stdio: ["ignore", "ignore", "pipe"],
    });
    let log = "";
    child.stderr.on("data", (d) => { log += d; });
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 300; i++) { try { if ((await fetch(`${base}/healthz`)).ok) break; } catch {} await sleep(100); }
    const post = (p, form, cookie) => fetch(`${base}${p}`, { method: "POST", redirect: "manual",
        headers: { Origin: base, "Content-Type": "application/x-www-form-urlencoded", ...(cookie ? { Cookie: cookie } : {}) }, body: new URLSearchParams(form) });
    return { base, root, post, log: () => log, stop: () => { child.kill(); rmSync(root, { recursive: true, force: true }); } };
}

const sid = (res) => /rc_session=([^;]*)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
const codeOf = (mail) => /code=([A-Za-z0-9_-]+)/.exec(mail.json.text)[1];
async function waitFor(fn, ms = 3000) { for (let t = 0; t < ms; t += 50) { const v = fn(); if (v) return v; await sleep(50); } return fn(); }

test("register -> email -> confirm -> token; links once; same answer for known addresses; sign-in by email", async (t) => {
    const mail = await mailMock();
    const s = await start({ RESEND_API_KEY: KEY, RC_MAIL_FROM: "RemoteCompose <noreply@example.com>", RC_MAIL_API_URL: mail.url, RC_MAIL_PER_HOUR: "4" });
    t.after(() => { s.stop(); mail.close(); });

    // Register: a pending account, a "check your email" page, no token, no session.
    const r1 = await s.post("/account/register", { email: "Ann@Example.com", name: "Ann" });
    assert.equal(r1.status, 200);
    const page1 = await r1.text();
    assert.match(page1, /Check your email/);
    assert.ok(!/rc_[A-Za-z0-9_-]{43}/.test(page1), "no token before verification");
    assert.equal(sid(r1), undefined);
    const m1 = await waitFor(() => mail.got[0]);
    assert.equal(m1.auth, `Bearer ${KEY}`);
    assert.equal(m1.json.from, "RemoteCompose <noreply@example.com>");
    assert.deepEqual(m1.json.to, ["ann@example.com"]);
    assert.equal(m1.json.subject, "Confirm your email for RemoteCompose");
    assert.ok(m1.json.html.includes(`${s.base}/account/verify?code=`));
    const code = codeOf(m1);

    // The link's GET only shows a button (a mail scanner spends nothing).
    const g = await fetch(`${s.base}/account/verify?code=${code}`);
    assert.match(await g.text(), /Confirm and get my token/);
    // Its POST: verified, signed in, the first token once.
    const v = await s.post("/account/verify", { code });
    assert.equal(v.status, 200);
    const vpage = await v.text();
    assert.match(vpage, /Your email is confirmed/);
    const token = /id="tok">(rc_[A-Za-z0-9_-]{43})/.exec(vpage)[1];
    assert.ok(sid(v));
    const again = await s.post("/account/verify", { code });
    assert.equal(again.status, 400, "a link works once");
    assert.match(await again.text(), /expired or was already used/);

    // The token works on the MCP endpoint.
    const mcp = await fetch(`${s.base}/mcp/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    assert.equal(mcp.status, 200);

    // Registering a known address answers exactly like a new one; the mail is a sign-in link.
    const known = await (await s.post("/account/register", { email: "ann@example.com" })).text();
    const unknown = await (await s.post("/account/register", { email: "zed@example.com" })).text();
    assert.equal(known.replaceAll("ann@example.com", "X"), unknown.replaceAll("zed@example.com", "X"));
    const m2 = await waitFor(() => mail.got.find((m) => m.json.to[0] === "ann@example.com" && m !== m1));
    assert.equal(m2.json.subject, "Your RemoteCompose sign-in link");
    assert.match(m2.json.text, /already has one/);
    const m3 = await waitFor(() => mail.got.find((m) => m.json.to[0] === "zed@example.com"));
    assert.equal(m3.json.subject, "Confirm your email for RemoteCompose");

    // A pending account cannot sign in by email: it gets its confirmation link again.
    const n = mail.got.length;
    await s.post("/account/email-signin", { email: "zed@example.com" });
    const m4 = await waitFor(() => mail.got[n]);
    assert.equal(m4.json.subject, "Confirm your email for RemoteCompose");

    // Sign in by email: a session, once.
    const k = mail.got.length;
    const es = await s.post("/account/email-signin", { email: "ann@example.com" });
    assert.match(await es.text(), /Check your email/);
    const m5 = await waitFor(() => mail.got[k]);
    const scode = codeOf(m5);
    const si = await s.post("/account/signin-link", { code: scode });
    assert.equal(si.status, 303);
    const cookie = `rc_session=${sid(si)}`;
    const acctPage = await (await fetch(`${s.base}/account/`, { headers: { Cookie: cookie } })).text();
    assert.match(acctPage, /Your account/);
    assert.match(acctPage, /ann@example\.com/);
    assert.equal((await s.post("/account/signin-link", { code: scode })).status, 400);
    // A verification code is no sign-in code and vice versa.
    assert.equal((await s.post("/account/signin-link", { code: codeOf(m4) })).status, 400);

    // Expired: a sign-in link older than 15 minutes.
    const k2 = mail.got.length;
    await s.post("/account/email-signin", { email: "ann@example.com" });
    const m6 = await waitFor(() => mail.got[k2]);
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(s.root, "rc.db"));
    db.exec("PRAGMA busy_timeout = 5000");
    db.prepare("UPDATE codes SET expires = '2000-01-01T00:00:00.000Z' WHERE used IS NULL").run();
    db.close();
    assert.equal((await s.post("/account/signin-link", { code: codeOf(m6) })).status, 400, "expired");

    // Per account: at most RC_MAIL_PER_HOUR (4 here) emails an hour (ann had four by now); the page does not say.
    const k3 = mail.got.length;
    const capped = await s.post("/account/email-signin", { email: "ann@example.com" });
    assert.match(await capped.text(), /Check your email/);
    await sleep(400);
    assert.equal(mail.got.length, k3, "no fourth email this hour");

    // A refusal from Resend is logged with its message, never the key.
    mail.fail(403);
    await s.post("/account/register", { email: "fail@example.com" });
    await waitFor(() => /domain not verified/.test(s.log()));
    assert.match(s.log(), /mail not sent: Resend answered 403: domain not verified/);
    assert.ok(!s.log().includes(KEY));
    // And no link or code ever reaches the log when a key is set.
    assert.ok(!s.log().includes(code) && !s.log().includes(scode));
});

test("without RESEND_API_KEY the link is logged and works", async (t) => {
    const s = await start({});
    t.after(() => s.stop());
    await s.post("/account/register", { email: "dev@example.com" });
    const line = await waitFor(() => /mail to dev@example\.com: Confirm your email for RemoteCompose (\S+)/.exec(s.log()));
    assert.ok(line, s.log());
    assert.ok(!/Someone \(we hope you\)/.test(s.log()), "the body is not logged");
    const code = /code=([A-Za-z0-9_-]+)/.exec(line[1])[1];
    const v = await s.post("/account/verify", { code });
    assert.equal(v.status, 200);
    assert.match(await v.text(), /id="tok">rc_/);
});

test("RC_EMAIL_VERIFY=off keeps the instant token", async (t) => {
    const s = await start({ RC_EMAIL_VERIFY: "off" });
    t.after(() => s.stop());
    const r = await s.post("/account/register", { email: "quick@example.com" });
    assert.equal(r.status, 200);
    assert.match(await r.text(), /id="tok">rc_/);
    assert.ok(sid(r));
});
