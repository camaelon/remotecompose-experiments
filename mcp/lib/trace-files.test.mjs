// The input files a call reads: hashed at call time, so an edited document is not a "repeat".
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { traceFiles } from "./calllog.mjs";

test("traceFiles: hash and size of the input files; outputs skipped; a missing file recorded, not thrown", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rc-tf-"));
    try {
        const f = path.join(dir, "doc.json");
        writeFileSync(f, '{"a":1}');
        const one = traceFiles({ json_path: f, output_path: path.join(dir, "out.png"), width: 390 });
        assert.deepEqual(Object.keys(one), ["json_path"], "output_path is not an input");
        assert.equal(one.json_path.bytes, 7);
        assert.match(one.json_path.sha, /^[0-9a-f]{16}$/);
        assert.deepEqual(traceFiles({ json_path: f }), one, "unchanged: same hash");
        writeFileSync(f, '{"a":2}');
        assert.notEqual(traceFiles({ json_path: f }).json_path.sha, one.json_path.sha, "edited: a new hash");
        assert.deepEqual(traceFiles({ rc_path: path.join(dir, "nope.rc") }), { rc_path: { path: path.join(dir, "nope.rc"), missing: true } });
        assert.equal(traceFiles({ path: dir }), null, "a folder is not a file");
        assert.equal(traceFiles({ goal: "x" }), null);
        assert.equal(traceFiles(null), null);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort() { const s = createServer(); await new Promise((r) => s.listen(0, "127.0.0.1", r)); const { port } = s.address(); await new Promise((r) => s.close(r)); return port; }

test("session page: the same path edited between calls is not a repeat; unchanged is; versions shown", async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), "rc-tf-e2e-"));
    const [ap, rp] = [await freePort(), await freePort()];
    const site = `http://127.0.0.1:${ap}`, render = `http://127.0.0.1:${rp}`;
    const env = { ...process.env, MCP_ROOT: root, RC_ACCOUNTS: "1", MCP_TOKEN: "admin-secret-token-0123456789abcdef", RC_EMAIL_VERIFY: "off",
        RC_DB: "", RC_TRACE_DIR: "", RC_PUBLIC_ORIGIN: "", RC_MOUNT: "", RESEND_API_KEY: "" };
    const kids = [["examples-server.mjs", ap], ["rc-render-server.mjs", rp]].map(([f, port]) =>
        spawn(process.execPath, [path.join(DIR, f), "--http"], { env: { ...env, MCP_HTTP_PORT: String(port) }, stdio: "ignore" }));
    t.after(() => { kids.forEach((k) => k.kill()); rmSync(root, { recursive: true, force: true }); });
    for (const u of [site, render]) for (let i = 0; i < 300; i++) { try { if ((await fetch(`${u}/healthz`)).ok) break; } catch {} await sleep(100); }
    const r = await fetch(`${site}/account/register`, { method: "POST", redirect: "manual", body: "email=f@example.com", headers: { Origin: site, "Content-Type": "application/x-www-form-urlencoded" } });
    const html0 = await r.text(), token = /id="tok">(rc_[A-Za-z0-9_-]{43})/.exec(html0)[1], cookie = `rc_session=${/rc_session=([^;]+)/.exec(r.headers.get("set-cookie"))[1]}`;
    const H = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const sid = (await fetch(`${render}/mcp`, { method: "POST", headers: H, body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "t" } } }) })).headers.get("mcp-session-id");
    const call = (args) => fetch(`${render}/mcp`, { method: "POST", headers: { ...H, "Mcp-Session-Id": sid },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "validate", arguments: args } }) }).then((x) => x.json());
    const doc = (bg) => JSON.stringify({ header: { width: 100, height: 100 }, root: { Box: { modifiers: [{ background: bg }] } } });
    const args = { json_path: "out/doc.json", render: false };
    mkdirSync(path.join(root, "out"), { recursive: true });
    writeFileSync(path.join(root, "out/doc.json"), doc("#ff0000"));
    await call(args);                                       // #1 v1
    await call(args);                                       // #2 v1 again: a real repeat
    writeFileSync(path.join(root, "out/doc.json"), doc("#00ff00"));
    await call(args);                                       // #3 v2: same arguments, a new document
    writeFileSync(path.join(root, "out/doc.json"), doc("#0000ff"));
    await call(args);                                       // #4 v3
    await call({ json_path: "out/missing.json", render: false });   // #5: no such file, still recorded
    const page = await (await fetch(`${site}/account/sessions/${sid.slice(0, 8)}`, { headers: { Cookie: cookie } })).text();
    const rows = [...page.matchAll(/<details id="c(\d+)"><summary>([\s\S]*?)<\/summary>/g)].map((m) => m[2]);
    assert.equal(rows.length, 5, "every call recorded, the missing file's too");
    assert.match(rows[0], /doc\.json v1/); assert.match(rows[0], /repeat 1\/2/);
    assert.match(rows[1], /doc\.json v1/); assert.match(rows[1], /repeat 2\/2/);
    assert.match(rows[2], /doc\.json v2/); assert.doesNotMatch(rows[2], /repeat/);
    assert.match(rows[3], /doc\.json v3/); assert.doesNotMatch(rows[3], /repeat/);
    assert.match(rows[4], /missing\.json missing/);
});
