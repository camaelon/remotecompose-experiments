// End to end: an MCP session against real servers (rc-render and rc-examples, one database), then
// its trace on the account pages: own sessions only, admins any, the JSON download.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort() {
    const s = createServer();
    await new Promise((r) => s.listen(0, "127.0.0.1", r));
    const { port } = s.address();
    await new Promise((r) => s.close(r));
    return port;
}

test("a session's calls are traced and shown to their account (and admins) only", async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), "rc-trace-e2e-"));
    const [ap, rp] = [await freePort(), await freePort()];
    const site = `http://127.0.0.1:${ap}`, render = `http://127.0.0.1:${rp}`;
    const env = { ...process.env, MCP_ROOT: root, RC_ACCOUNTS: "1", MCP_TOKEN: "admin-secret-token-0123456789abcdef", RC_EMAIL_VERIFY: "off",
        RC_ADMIN_EMAILS: "boss@example.com", RC_DB: "", RC_PUBLIC_ORIGIN: "", RC_MOUNT: "", RESEND_API_KEY: "" };
    const kids = [["examples-server.mjs", ap], ["rc-render-server.mjs", rp]].map(([f, port]) =>
        spawn(process.execPath, [path.join(DIR, f), "--http"], { env: { ...env, MCP_HTTP_PORT: String(port) }, stdio: "ignore" }));
    t.after(() => { kids.forEach((k) => k.kill()); rmSync(root, { recursive: true, force: true }); });
    for (const u of [site, render]) for (let i = 0; i < 300; i++) { try { if ((await fetch(`${u}/healthz`)).ok) break; } catch {} await sleep(100); }

    const register = async (email) => {
        const r = await fetch(`${site}/account/register`, { method: "POST", redirect: "manual", body: new URLSearchParams({ email }),
            headers: { Origin: site, "Content-Type": "application/x-www-form-urlencoded" } });
        const html = await r.text();
        return { cookie: `rc_session=${/rc_session=([^;]+)/.exec(r.headers.get("set-cookie"))[1]}`, token: /id="tok">(rc_[A-Za-z0-9_-]{43})/.exec(html)[1] };
    };
    const ann = await register("ann@example.com"), bob = await register("bob@example.com"), boss = await register("boss@example.com");

    // An MCP session: initialize gives the session id, every later call sends it back.
    const init = await fetch(`${render}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${ann.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "e2e" } } }) });
    const sessionId = init.headers.get("mcp-session-id");
    assert.ok(sessionId);
    const call = (name, args) => fetch(`${render}/mcp`, { method: "POST",
        headers: { Authorization: `Bearer ${ann.token}`, "Content-Type": "application/json", "Mcp-Session-Id": sessionId },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }).then((r) => r.json());
    const doc = { header: { width: 120, height: 80 }, root: { Box: { modifiers: [{ background: "#3366ff" }] } } };
    await call("validate", { json: doc, render: false });
    await sleep(300);
    await call("validate", { json: doc, render: false });           // identical: a repeat
    await call("render_rc", { json: doc, width: 120, height: 80 });   // an image result
    await call("validate", { json: "{ not json" });                   // an error (or a failed validation)
    const client = sessionId.slice(0, 8);

    // The account page lists the session; the session page shows the calls in full.
    const acct = await (await fetch(`${site}/account/`, { headers: { Cookie: ann.cookie } })).text();
    assert.match(acct, /<h2>Recent sessions<\/h2>/);
    assert.ok(acct.includes(`href="sessions/${client}"`));
    assert.match(acct, /validate ×3, render_rc|render_rc, validate ×3/);
    const page = await fetch(`${site}/account/sessions/${client}`, { headers: { Cookie: ann.cookie } });
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.equal((html.match(/<details id="c\d+">/g) ?? []).length, 4);
    assert.match(html, /repeat 1\/2/);
    assert.match(html, /Repeated identical calls/);
    assert.match(html, /&quot;background&quot;: &quot;#3366ff&quot;/, "the inline document, pretty-printed and escaped");
    assert.match(html, /\[image 120x80, \d+ KB\]/);
    assert.match(html, /wall time/);
    assert.ok(!html.includes(ann.token), "never the token");

    // JSON download.
    const j = await (await fetch(`${site}/account/sessions/${client}.json`, { headers: { Cookie: ann.cookie } })).json();
    assert.equal(j.session, client);
    assert.equal(j.calls.length, 4);
    assert.deepEqual(j.calls[0].args.json, doc);
    assert.ok(j.calls[1].gap_ms >= 250);

    // Someone else's: 404, also by asking for the account; signed out: off to sign in.
    assert.equal((await fetch(`${site}/account/sessions/${client}`, { headers: { Cookie: bob.cookie } })).status, 404);
    const annId = /account=(\d+)/.exec(await (await fetch(`${site}/account/`, { headers: { Cookie: boss.cookie } })).text().then((h) => h.match(/<td class="w">ann@example\.com[\s\S]*?sessions\/\?account=\d+/)[0]))[1];
    assert.equal((await fetch(`${site}/account/sessions/${client}?account=${annId}`, { headers: { Cookie: bob.cookie } })).status, 404);
    assert.equal((await fetch(`${site}/account/sessions/${client}`, { redirect: "manual" })).status, 303);
    // An admin, from the accounts list.
    const asAdmin = await fetch(`${site}/account/sessions/${client}?account=${annId}`, { headers: { Cookie: boss.cookie } });
    assert.equal(asAdmin.status, 200);
    assert.match(await asAdmin.text(), /ann@example\.com/);
    const index = await (await fetch(`${site}/account/sessions/?account=${annId}`, { headers: { Cookie: boss.cookie } })).text();
    assert.ok(index.includes(`href="${client}?account=${annId}"`));
});
