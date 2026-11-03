import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openAccounts } from "./accounts.mjs";
import { TRACE_CAP, traceArgs, traceResult } from "./calllog.mjs";

test("traceArgs: whole arguments, documents included; long strings cut to fit 20 KB; still JSON", () => {
    const small = { json: { header: { width: 100 }, root: { Box: {} } }, width: 320, goal: "a clock" };
    assert.deepEqual(JSON.parse(traceArgs(small)), small, "kept whole, not summarised");
    const doc = "x".repeat(60_000);
    const big = traceArgs({ json: doc, goal: "keep me" });
    assert.ok(big.length <= TRACE_CAP);
    const parsed = JSON.parse(big);
    assert.equal(parsed.goal, "keep me", "short fields survive");
    assert.match(parsed.json, /…\[cut \d+ of 60000 characters\]$/);
    const many = traceArgs({ json: { items: Array.from({ length: 5000 }, (_, i) => ({ i, v: "abcdefgh" })) } });
    assert.ok(many.length <= TRACE_CAP);
    assert.ok(JSON.parse(many)._truncated, "a structure with no long string falls back to a head");
});

test("no secrets: our token shapes and MCP_TOKEN are scrubbed from args and results", () => {
    const tok = "rc_" + "A".repeat(43), acc = "rco_" + "b".repeat(43), ref = "rcr_" + "c".repeat(43);
    const saved = process.env.MCP_TOKEN;
    process.env.MCP_TOKEN = "admin-secret-token-0123456789abcdef";
    try {
        const a = traceArgs({ note: `${tok} ${acc}`, other: "admin-secret-token-0123456789abcdef" });
        assert.ok(!a.includes(tok) && !a.includes(acc) && !a.includes("admin-secret"));
        assert.match(a, /\[token\] \[token\]/);
        const r = traceResult([{ type: "text", text: `got ${ref}` }]);
        assert.equal(r, "got [token]");
    } finally { if (saved === undefined) delete process.env.MCP_TOKEN; else process.env.MCP_TOKEN = saved; }
});

test("traceResult: text in full, images as [image WxH, N KB], errors, capped", () => {
    const png = Buffer.alloc(3000);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]).copy(png);
    png.writeUInt32BE(640, 16); png.writeUInt32BE(480, 20);
    const r = traceResult([{ type: "text", text: '{"ok":true}' }, { type: "image", mimeType: "image/png", data: png.toString("base64") }]);
    assert.equal(r, '{"ok":true}\n\n[image 640x480, 3 KB]');
    assert.equal(traceResult(null, new Error("boom")), "error: boom");
    const long = traceResult([{ type: "text", text: "y".repeat(50_000) }]);
    assert.ok(long.length <= TRACE_CAP);
    assert.match(long, /cut: 50000 characters in all/);
});

test("sessions: grouped by client, durations, gaps between calls, via", async () => {
    const s = await openAccounts(":memory:");
    const a = s.createAccount({ email: "s@example.com" });
    const t = s.issueToken(a.id, "laptop");
    const at = (sec) => new Date(Date.UTC(2026, 10, 2, 10, 0, sec)).toISOString();
    const rec = (client, endSec, ms, tool, ok = true, args = "{}") =>
        s.recordCall({ accountId: a.id, tokenId: t.id, server: "remotecompose", tool, ms, ok, client, args, result: "r", ts: at(endSec) });
    rec("aaaa1111", 2, 1000, "build_kit");        // 10:00:01 - 10:00:02
    rec("aaaa1111", 30, 3000, "render");          // starts 10:00:27: a 25 s gap
    rec("aaaa1111", 31, 500, "render", false);
    rec("bbbb2222", 5, 100, "convert");
    // (sessions() looks at the last 30 days: move them to now)
    s.db.prepare("UPDATE calls SET ts = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour', '+' || CAST(substr(ts, 18, 2) AS INTEGER) || ' seconds')").run();
    const list = s.sessions(a.id);
    assert.equal(list.length, 2);
    const one = list.find((x) => x.client === "aaaa1111");
    assert.equal(one.calls, 3);
    assert.equal(one.errors, 1);
    assert.deepEqual(one.tools, { build_kit: 1, render: 2 });
    assert.equal(one.via, "token: laptop");
    assert.equal(one.duration_ms, 30_000);
    const calls = s.sessionCalls(a.id, "aaaa1111");
    assert.deepEqual(calls.map((c) => c.gap_ms), [null, 25_000, 500]);
    assert.equal(s.sessionCalls(a.id, "nope").length, 0);
    const b = s.createAccount({ email: "other@example.com" });
    assert.equal(s.sessionCalls(b.id, "aaaa1111").length, 0, "another account sees none of it");
});

test("schema 4 migration from 3, and the 30-day retention of trace bodies", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rc-trace-"));
    try {
        const file = path.join(dir, "rc.db");
        const s = await openAccounts(file);
        // Back to schema 3: drop the new columns, as an older server left the file.
        s.db.exec("DROP INDEX calls_account_client; ALTER TABLE calls DROP COLUMN client; ALTER TABLE calls DROP COLUMN args; ALTER TABLE calls DROP COLUMN result; ALTER TABLE calls DROP COLUMN images; ALTER TABLE calls DROP COLUMN files; ALTER TABLE calls DROP COLUMN meta; ALTER TABLE calls DROP COLUMN thread; ALTER TABLE calls DROP COLUMN thread_how; ALTER TABLE calls DROP COLUMN touched; PRAGMA user_version = 3;");
        s.db.prepare("INSERT INTO calls (ts, account_id, server, tool, ms, ok, summary) VALUES ('2026-01-01T00:00:00.000Z', 1, 's', 't', 1, 1, 'kept')").run();
        s.close();
        const m = await openAccounts(file);
        assert.equal(m.db.prepare("PRAGMA user_version").get().user_version, 10);
        const cols = m.db.prepare("PRAGMA table_info(calls)").all().map((c) => c.name);
        assert.ok(["client", "args", "result"].every((c) => cols.includes(c)));
        m.recordCall({ accountId: 1, server: "s", tool: "old", ms: 1, ok: true, client: "c1", args: '{"a":1}', result: "x", summary: "old one", ts: "2020-01-01T00:00:00.000Z" });
        m.recordCall({ accountId: 1, server: "s", tool: "new", ms: 1, ok: true, client: "c1", args: '{"a":2}', result: "y" });
        m.cleanup();
        const rows = m.db.prepare("SELECT tool, summary, args, result FROM calls ORDER BY id").all().map((r) => ({ ...r }));
        assert.equal(rows.length, 3, "rows stay");
        assert.deepEqual({ ...rows[1] }, { tool: "old", summary: "old one", args: null, result: null });
        assert.equal(rows[2].args, '{"a":2}');
        m.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
});
