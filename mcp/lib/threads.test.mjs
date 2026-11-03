// Two conversations under one trace session (a client that does not echo Mcp-Session-Id):
// the signals recorded, and the threads they are split into.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assignThreads, metaSignals, requestSignals, threadFromSignals, touchedPaths } from "./threads.mjs";

test("signals: header names, id-like values hashed, never credentials", () => {
    const sig = requestSignals({ headers: {
        authorization: "Bearer rc_SECRET", cookie: "rc_session=SECRET", "x-api-key": "SECRET", "x-session-token": "SECRET",
        "openai-conversation-id": "conv-123", "x-request-id": "req-9", "user-agent": "ChatGPT", "mcp-session-id": "abc",
    } }, { sent: true, known: false });
    assert.deepEqual(sig.headers, ["authorization", "cookie", "mcp-session-id", "openai-conversation-id", "user-agent", "x-api-key", "x-request-id", "x-session-token"]);
    assert.deepEqual(Object.keys(sig.ids).sort(), ["openai-conversation-id", "x-request-id"]);
    assert.match(sig.ids["openai-conversation-id"], /^[0-9a-f]{12}$/);
    assert.ok(!JSON.stringify(sig).includes("SECRET") && !JSON.stringify(sig).includes("conv-123"));
    assert.deepEqual(sig.mcp_session, { sent: true, known: false });
    const m = metaSignals({ "openai/conversation": "c1", "openai/userLocation": { city: "X" }, progressToken: "p1", sessionKey: "k" });
    assert.deepEqual(m.keys, ["openai/conversation", "openai/userLocation", "progressToken", "sessionKey"]);
    assert.deepEqual(Object.keys(m.ids), ["openai/conversation"], "id-like keys only; nothing token- or key-like");
    assert.equal(metaSignals(undefined), null);
});

test("thread from signals: _meta conversation first, then a session/conversation header; a request id never", () => {
    assert.equal(threadFromSignals({ call_meta: { ids: { "openai/session": "aa", "openai/conversation": "bb" } } }).how, "meta:openai/conversation");
    assert.deepEqual(threadFromSignals({ ids: { "x-request-id": "r1", "openai-session-id": "s1" } }), { thread: "h:s1", how: "header:openai-session-id" });
    assert.equal(threadFromSignals({ ids: { "x-request-id": "r1", "openai-chat": "c" } }), null);
});

test("touched paths: inputs, output_path, and the files a result names", () => {
    const t = touchedPaths({ files: { json_path: { path: "./out/a.json" } }, args: { output_path: "out/a.png" },
        result: '{"rc_path": "out/a.rc", "bytes": 3}\npng_path: out/r-1.png (on the server)', root: "/ws" });
    assert.deepEqual(t.sort(), ["out/a.json", "out/a.png", "out/a.rc", "out/r-1.png"]);
    assert.deepEqual(touchedPaths({ files: { json_path: { path: "/ws/out/b.json" } }, root: "/ws" }), ["out/b.json"]);
});

// The shape of the real ~dd9654 session, simulated: two ChatGPT chats on one account and browser,
// interleaved, each building its own document; build_kit and find calls carry no file.
const S = (sec) => sec * 1000;
const call = (id, start, end, touched = [], extra = {}) => ({ id, start: S(start), end: S(end), touched, ...extra });

test("lineage: two interleaved chats with different documents are two threads; no-file calls join by time", () => {
    const calls = [
        call(1, 0, 1),                                        // A build_kit
        call(2, 20, 21, ["out/doc-a.rc"]),                    // A convert -> doc-a
        call(3, 25, 26),                                      // B build_kit (A is thinking): by time, joins A (a known limit)
        call(4, 40, 41, ["out/doc-b.rc"]),                    // B convert -> doc-b
        call(5, 45, 46, ["out/doc-a.rc", "out/r-5.png"]),     // A render doc-a
        call(6, 60, 61, ["out/doc-b.rc", "out/r-6.png"]),     // B render doc-b
        call(7, 70, 72, ["out/doc-a.rc"]),                    // A convert with edits (same file)
        call(8, 73, 74),                                      // B? find_components right after 7: joins A (7 ended last)
        call(9, 90, 91, ["out/doc-b.rc"]),                    // B publish doc-b
    ];
    const t = assignThreads(calls);
    const a = t[1].thread, b = t[3].thread;
    assert.notEqual(a, b);
    assert.deepEqual([1, 4, 6].map((i) => t[i].thread), [a, a, a], "doc-a's calls");
    assert.deepEqual([3, 5, 8].map((i) => t[i].thread), [b, b, b], "doc-b's calls");
    assert.deepEqual([1, 3, 4, 5, 6, 8].map((i) => t[i].how), Array(6).fill("lineage"));
    assert.deepEqual([0, 2, 7].map((i) => t[i]), [{ thread: a, how: "time" }, { thread: a, how: "time" }, { thread: a, how: "time" }],
        "no-file calls by time: A's opening build_kit joins the document after it; B's build_kit lands in A (A ended last): a known limit");
    assert.equal(new Set(t.map((x) => x.thread)).size, 2);
});

test("time: a call does not join a thread that was still running when it started", () => {
    const t = assignThreads([
        call(1, 0, 10, ["out/x.rc"]), call(2, 2, 3, ["out/x.rc"]),       // thread X (overlapping: two calls of one chat? sharing the file decides)
        call(3, 20, 40, ["out/y.rc"]), call(4, 41, 42, ["out/y.rc"]),    // thread Y
        call(5, 30, 31),                                                  // starts while Y's call 3 runs: not Y
    ]);
    assert.equal(t[4].thread, t[0].thread);
    assert.equal(t[4].how, "time");
});

test("recorded threads (session id, _meta) are kept", () => {
    const t = assignThreads([call(1, 0, 1, [], { thread: "m:aa", how: "meta:openai/conversation" }), call(2, 2, 3, [], { thread: "m:bb", how: "meta:openai/conversation" })]);
    assert.deepEqual(t.map((x) => x.thread), ["m:aa", "m:bb"]);
});

// --- end to end, real servers, one fallback key (same token, same user agent, no Mcp-Session-Id)

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function freePort() { const s = createServer(); await new Promise((r) => s.listen(0, "127.0.0.1", r)); const { port } = s.address(); await new Promise((r) => s.close(r)); return port; }

test("e2e: interleaved chats split by lineage; with a _meta conversation id, by meta; gaps per thread; nothing secret", async (t) => {
    const root = mkdtempSync(path.join(tmpdir(), "rc-threads-e2e-"));
    const [ap, jp, rp] = [await freePort(), await freePort(), await freePort()];
    const site = `http://127.0.0.1:${ap}`, j2r = `http://127.0.0.1:${jp}`, render = `http://127.0.0.1:${rp}`;
    const env = { ...process.env, MCP_ROOT: root, RC_ACCOUNTS: "1", MCP_TOKEN: "admin-secret-token-0123456789abcdef", RC_EMAIL_VERIFY: "off",
        RC_DB: "", RC_TRACE_DIR: "", RC_PUBLIC_ORIGIN: "", RC_MOUNT: "", RESEND_API_KEY: "" };
    const kids = [["examples-server.mjs", ap], ["json2rc-server.mjs", jp], ["rc-render-server.mjs", rp]].map(([f, port]) =>
        spawn(process.execPath, [path.join(DIR, f), "--http"], { env: { ...env, MCP_HTTP_PORT: String(port) }, stdio: "ignore" }));
    t.after(() => { kids.forEach((k) => k.kill()); rmSync(root, { recursive: true, force: true }); });
    for (const u of [site, j2r, render]) for (let i = 0; i < 300; i++) { try { if ((await fetch(`${u}/healthz`)).ok) break; } catch {} await sleep(100); }
    const reg = async (email) => {
        const r = await fetch(`${site}/account/register`, { method: "POST", redirect: "manual", body: `email=${email}`, headers: { Origin: site, "Content-Type": "application/x-www-form-urlencoded" } });
        const h = await r.text();
        return { token: /id="tok">(rc_[A-Za-z0-9_-]{43})/.exec(h)[1], cookie: `rc_session=${/rc_session=([^;]+)/.exec(r.headers.get("set-cookie"))[1]}` };
    };
    // No Mcp-Session-Id ever sent back: every call lands on the fallback key, like ChatGPT's.
    const mk = (who) => async (base, name, args, meta) => (await fetch(`${base}/mcp`, { method: "POST",
        headers: { Authorization: `Bearer ${who.token}`, "Content-Type": "application/json", "User-Agent": "openai-mcp/1.0", "X-Request-Id": `r-${Math.random()}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args, ...(meta ? { _meta: meta } : {}) } }) })).json();
    const doc = (bg) => ({ header: { width: 120, height: 80 }, root: { Box: { modifiers: [{ fillMaxSize: true }, { background: bg }] } } });
    const rcOf = (r) => JSON.parse(r.result.content.find((c) => c.type === "text").text).rc_path;

    // 1. Lineage: chat A and chat B interleaved, each converting and rendering its own document.
    const ann = await reg("ann@example.com"), A = mk(ann);
    const a1 = rcOf(await A(j2r, "json2rc", { json: doc("#ff0000") }));   // A creates doc-a
    await sleep(150);
    const b1 = rcOf(await A(j2r, "json2rc", { json: doc("#0000ff") }));   // B creates doc-b
    await sleep(300);
    await A(render, "render_rc", { rc_path: a1 });                         // A renders doc-a
    await sleep(100);
    await A(render, "render_rc", { rc_path: b1 });                         // B renders doc-b
    await A(render, "validate", { rc_path: a1, render: false });           // A again
    const list = await (await fetch(`${site}/account/`, { headers: { Cookie: ann.cookie } })).text();
    assert.match(list, /2 threads/);
    const client = /href="sessions\/(~[0-9a-f]{6})"/.exec(list)[1];
    const page = await (await fetch(`${site}/account/sessions/${encodeURIComponent(client)}`, { headers: { Cookie: ann.cookie } })).text();
    assert.match(page, /2 conversations in this session/);
    assert.match(page, /the documents the calls read and wrote/);
    const letters = [...page.matchAll(/title="thread ([A-Z])"/g)].map((m) => m[1]);
    assert.deepEqual(letters, ["A", "B", "A", "B", "A"]);
    // Gaps within a thread: B's render follows B's convert (~400 ms+), not A's render (~100 ms).
    const bGap = [...page.matchAll(/title="thread B">B<\/span>#(\d+)<\/span><span class="t">[^<]*<\/span>\s*<span class="n[^"]*" title="since the previous call ended">([^<]*)</g)].map((m) => m[2]);
    assert.equal(bGap[0], "start");
    assert.ok(/ms|s$/.test(bGap[1]) && !/^\+\d{1,2} ms$/.test(bGap[1]), `B's gap is within B: ${bGap[1]}`);
    // The thread filter.
    const keyB = /href="[^"]*thread=([^"&]+)"><span class="sw"[^>]*><\/span>Thread B/.exec(page)[1];
    const onlyB = await (await fetch(`${site}/account/sessions/${encodeURIComponent(client)}?thread=${keyB}`, { headers: { Cookie: ann.cookie } })).text();
    assert.equal((onlyB.match(/<details id="c\d+"/g) ?? []).length, 2);
    // Client signals: names, the request id seen as one-per-call, nothing secret.
    assert.match(page, /<h2>Client signals<\/h2>/);
    assert.match(page, /<code>x-request-id<\/code>/);
    assert.match(page, /new on every call: a request id/);
    assert.match(page, /0\/5<\/b><span>calls sent Mcp-Session-Id back/);
    assert.ok(!page.includes(ann.token));

    // 2. A _meta conversation id splits by meta, and the sessions list shows each conversation as its own row.
    const bob = await reg("bob@example.com"), B = mk(bob);
    await B(render, "validate", { json: doc("#111111"), render: false }, { "openai/conversation": "conv-1", "openai/userAgent": "x" });
    await B(render, "validate", { json: doc("#222222"), render: false }, { "openai/conversation": "conv-2" });
    await B(render, "validate", { json: doc("#333333"), render: false }, { "openai/conversation": "conv-1" });
    const blist = await (await fetch(`${site}/account/`, { headers: { Cookie: bob.cookie } })).text();
    assert.equal((blist.match(/one conversation<\/span>/g) ?? []).length, 2);
    const bclient = /href="sessions\/(~[0-9a-f]{6})\?thread=/.exec(blist)[1];
    const bpage = await (await fetch(`${site}/account/sessions/${encodeURIComponent(bclient)}`, { headers: { Cookie: bob.cookie } })).text();
    assert.match(bpage, /the id in the call&#39;s _meta \(openai\/conversation\)|the id in the call's _meta \(openai\/conversation\)/);
    assert.match(bpage, /<b>2 values<\/b>: could name conversations/);

    // Nothing secret in the database: no token, no auth header, no raw conversation id.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(root, "rc.db"));
    const dump = JSON.stringify(db.prepare("SELECT meta, thread, thread_how, touched FROM calls").all());
    db.close();
    for (const secret of [ann.token, bob.token, "Bearer", "conv-1", "conv-2"]) assert.ok(!dump.includes(secret), secret);
});
