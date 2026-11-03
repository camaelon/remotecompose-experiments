// End to end: a session that renders and publishes, on real servers (rc-examples for the account
// pages, rc-render, rc-deploy; one workspace and database). Its pictures on the session page,
// behind the account's access rules; the published page's preview, public, on the cards.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
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

test("renders kept on the session page (own or admin only); publish preview on the cards and session", async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), "rc-renders-e2e-"));
    const [ap, rp, dp] = [await freePort(), await freePort(), await freePort()];
    const site = `http://127.0.0.1:${ap}`, render = `http://127.0.0.1:${rp}`, deploy = `http://127.0.0.1:${dp}`;
    const env = { ...process.env, MCP_ROOT: root, RC_ACCOUNTS: "1", MCP_TOKEN: "admin-secret-token-0123456789abcdef", RC_EMAIL_VERIFY: "off",
        RC_ADMIN_EMAILS: "boss@example.com", RC_DB: "", RC_TRACE_DIR: "", RC_PUBLIC_ORIGIN: "", RC_MOUNT: "", RESEND_API_KEY: "" };
    const kids = [["examples-server.mjs", ap, {}], ["rc-render-server.mjs", rp, {}], ["deploy-server.mjs", dp, { MCP_PUBLIC_URL: deploy }]].map(([f, port, extra]) =>
        spawn(process.execPath, [path.join(DIR, f), "--http"], { env: { ...env, ...extra, MCP_HTTP_PORT: String(port) }, stdio: "ignore" }));
    t.after(() => { kids.forEach((k) => k.kill()); rmSync(root, { recursive: true, force: true }); });
    for (const u of [site, render, deploy]) for (let i = 0; i < 300; i++) { try { if ((await fetch(`${u}/healthz`)).ok) break; } catch {} await sleep(100); }

    const register = async (email) => {
        const r = await fetch(`${site}/account/register`, { method: "POST", redirect: "manual", body: new URLSearchParams({ email }),
            headers: { Origin: site, "Content-Type": "application/x-www-form-urlencoded" } });
        const html = await r.text();
        return { cookie: `rc_session=${/rc_session=([^;]+)/.exec(r.headers.get("set-cookie"))[1]}`, token: /id="tok">(rc_[A-Za-z0-9_-]{43})/.exec(html)[1] };
    };
    const ann = await register("ann@example.com"), bob = await register("bob@example.com"), boss = await register("boss@example.com");
    const H = { Authorization: `Bearer ${ann.token}`, "Content-Type": "application/json" };
    const sessionId = (await fetch(`${render}/mcp`, { method: "POST", headers: H,
        body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "e2e" } } }) })).headers.get("mcp-session-id");
    const call = (base, name, args) => fetch(`${base}/mcp`, { method: "POST", headers: { ...H, "Mcp-Session-Id": sessionId },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }).then((r) => r.json());
    const doc = { header: { width: 1600, height: 900 }, root: { Column: { modifiers: [{ fillMaxSize: true }, { background: "#204080" }, { padding: 40 }],
        children: [{ Text: { text: "Hello", fontSize: 96, color: "#ffffff" } }] } } };
    const r1 = await call(render, "render_rc", { json: doc, width: 1600, height: 900 });
    assert.ok(r1.result.content.some((c) => c.type === "image"), "a real render");
    const pub = await call(deploy, "package_web", { json: doc, title: "Hello page", accept_design_warnings: true, reason: "e2e" });
    assert.ok(!pub.result.isError, JSON.stringify(pub).slice(0, 400));
    const published = JSON.parse(pub.result.content.find((c) => c.type === "text").text);
    const client = sessionId.slice(0, 8);

    // The render as a file under traces/, scaled to 960 px.
    const tdir = path.join(root, "traces");
    const files = readdirSync(path.join(tdir, readdirSync(tdir)[0], client));
    assert.equal(files.length, 1);

    // The session page: the strip, the full image, the publish on top.
    const page = await (await fetch(`${site}/account/sessions/${client}`, { headers: { Cookie: ann.cookie } })).text();
    const imgSrc = new RegExp(`<span class="strip"><a href="${client}/img/(\\d+-0\\.png)"`).exec(page);
    assert.ok(imgSrc, "a thumbnail strip on the row");
    assert.match(page, /<h4>Pictures<\/h4>/);
    assert.match(page, /<h2>Published in this session<\/h2>/);
    assert.ok(page.includes(`${published.url}preview.png`));
    const imgUrl = `${site}/account/sessions/${client}/img/${imgSrc[1]}`;

    // The picture's route: own 200 (a PNG, 960 wide), someone else 404, signed out 404, admin 200 with ?account.
    const own = await fetch(imgUrl, { headers: { Cookie: ann.cookie } });
    assert.equal(own.status, 200);
    assert.equal(own.headers.get("content-type"), "image/png");
    assert.equal(Buffer.from(await own.arrayBuffer()).readUInt32BE(16), 960);
    assert.equal((await fetch(imgUrl, { headers: { Cookie: bob.cookie } })).status, 404);
    assert.equal((await fetch(imgUrl)).status, 404);
    assert.equal((await fetch(`${site}/account/sessions/${client}/img/999-0.png`, { headers: { Cookie: ann.cookie } })).status, 404, "not a picture of the session");
    const annId = /<td class="w">ann@example\.com[\s\S]*?sessions\/\?account=(\d+)/.exec(await (await fetch(`${site}/account/`, { headers: { Cookie: boss.cookie } })).text())[1];
    assert.equal((await fetch(`${imgUrl}?account=${annId}`, { headers: { Cookie: bob.cookie } })).status, 404);
    assert.equal((await fetch(`${imgUrl}?account=${annId}`, { headers: { Cookie: boss.cookie } })).status, 200);

    // The preview: made at publish, next to the page, public; on the account page's cards and the /pages/ index.
    assert.ok(existsSync(path.join(root, "pages", published.page_id, "preview.png")));
    assert.equal(published.preview_url, `${published.url}preview.png`);
    const prev = await fetch(published.preview_url);
    assert.equal(prev.status, 200);
    assert.equal(Buffer.from(await prev.arrayBuffer()).readUInt32BE(16), 960, "1600 px wide document, scaled to 960");
    const acct = await (await fetch(`${site}/account/`, { headers: { Cookie: ann.cookie } })).text();
    assert.match(acct, /<a class="pcard" href="[^"]+">\s*<div class="pthumb"><img src="[^"]+preview\.png"/);
    const index = await (await fetch(`${deploy}/pages/`, { headers: { Cookie: ann.cookie } })).text();
    assert.ok(index.includes(`<img src="${published.page_id}/preview.png"`));
    assert.match(index, /Hello page/);
});
