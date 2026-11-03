// Telling conversations apart inside one trace session. A client that does not echo the
// Mcp-Session-Id it was given (ChatGPT, so far) has all its calls under one fallback key (a hash
// of its auth header and user agent), even when two chats run at once. Per call we keep:
//   - the client's signals, to learn what it does send: request header NAMES, the values of a
//     few id-like headers (hashed), whether Mcp-Session-Id came back and whether we issued it,
//     the keys of params._meta (id-like values hashed), initialize's clientInfo;
//   - a thread, decided in this order: the echoed Mcp-Session-Id; a conversation / session id
//     from _meta or a header; the documents the call read or wrote (lineage); the time.
// Never an auth header's, cookie's or token's value.

import { createHash } from "node:crypto";
import path from "node:path";

const hash = (v) => createHash("sha256").update(String(v)).digest("hex").slice(0, 12);

// Header values that may be recorded (hashed): id-like names. Never anything credential-like.
const ID_HEADER = /session|conversation|chat|thread|request-id|openai/i;
const SECRET_NAME = /auth|cookie|token|key|secret|passw|signature/i;
// Of those, the ones that can name a conversation (a request id names one request: never a thread).
const THREAD_NAME = /session|conversation|thread/i;
const META_ID = /session|conversation|thread/i;

/** What a request carries, minus anything secret: {headers, ids, mcp_session}. */
export function requestSignals(req, { sent = false, known = false } = {}) {
    const names = Object.keys(req.headers ?? {}).map((n) => n.toLowerCase()).sort();
    const ids = {};
    for (const n of names) {
        if (n === "mcp-session-id" || !ID_HEADER.test(n) || SECRET_NAME.test(n)) continue;
        const v = req.headers[n];
        if (v != null && String(v) !== "") ids[n] = hash(Array.isArray(v) ? v.join(",") : v);
    }
    return { headers: names, ids, mcp_session: { sent, known } };
}

/** params._meta of a tools/call: {keys, ids} (id-like values hashed), or null. */
export function metaSignals(meta) {
    if (!meta || typeof meta !== "object") return null;
    const keys = Object.keys(meta).sort();
    const ids = {};
    for (const k of keys) {
        const v = meta[k];
        if (META_ID.test(k) && !SECRET_NAME.test(k) && (typeof v === "string" || typeof v === "number") && String(v) !== "") ids[k] = hash(v);
    }
    return { keys, ids };
}

/** A conversation id among the signals: {thread, how}, _meta first, then headers; or null. */
export function threadFromSignals(signals) {
    const m = signals?.call_meta?.ids ?? {};
    const mk = Object.keys(m).sort((a, b) => rank(a) - rank(b))[0];
    if (mk) return { thread: `m:${m[mk]}`, how: `meta:${mk}` };
    const h = signals?.ids ?? {};
    const hk = Object.keys(h).filter((n) => THREAD_NAME.test(n)).sort((a, b) => rank(a) - rank(b))[0];
    if (hk) return { thread: `h:${h[hk]}`, how: `header:${hk}` };
    return null;
}
// A conversation id beats a session id beats a thread id (sessions can span conversations).
const rank = (k) => (/conversation/i.test(k) ? 0 : /thread/i.test(k) ? 1 : 2);

/** A path as the workspace names it: relative to root, normalised. */
export function normPath(p, root = null) {
    let s = String(p).trim();
    if (root && path.isAbsolute(s) && (s === root || s.startsWith(root + path.sep))) s = path.relative(root, s);
    return path.posix.normalize(s.split(path.sep).join("/")).replace(/^\.\//, "");
}

const OUT_KEYS = "json_path|rc_path|html_path|png_path|output_path|expanded_path|plan_path";

/**
 * The workspace files a call touched: those it read (files, from traceFiles) and those its
 * result names or its output_path asked for.
 */
export function touchedPaths({ files = null, args = null, result = "", root = null } = {}) {
    const out = new Set();
    for (const f of Object.values(files ?? {})) if (f?.path) out.add(normPath(f.path, root));
    if (typeof args?.output_path === "string") out.add(normPath(args.output_path, root));
    const text = String(result ?? "");
    for (const m of text.matchAll(new RegExp(`"(?:${OUT_KEYS})":\\s*"([^"]+)"`, "g"))) out.add(normPath(m[1], root));
    for (const m of text.matchAll(new RegExp(`^(?:${OUT_KEYS}):\\s*(\\S+)`, "gm"))) out.add(normPath(m[1], root));
    return [...out].filter((p) => p && p !== "." && !p.startsWith("<"));
}

/**
 * Threads for a session's calls, in order: [{thread, how}] for
 * calls = [{id, start, end, thread?, how?, touched: [paths]}] (ms).
 *   - a call with a recorded thread (an echoed session id, an id from _meta or a header) keeps it;
 *   - lineage: calls sharing a file that at least two calls touched (read, or wrote and another
 *     read) are one thread, the document's; a file used once (a render's PNG) links nothing;
 *   - the rest join by time: the thread whose latest call ended most recently before this one
 *     started, skipping a thread with a call still running then (a chat waits for each result);
 *     with none before it, the thread of the next call that has one (a chat's opening
 *     build_kit joins the document it leads to); else a new thread.
 * Decided over the whole session when it is shown, so later calls can place earlier ones.
 */
export function assignThreads(calls) {
    const uses = new Map();   // path -> count of calls touching it
    for (const c of calls) for (const p of new Set(c.touched ?? [])) uses.set(p, (uses.get(p) ?? 0) + 1);
    const parent = calls.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const firstBy = new Map();   // shared path -> first call index touching it
    const linked = new Set();
    calls.forEach((c, i) => {
        if (c.thread) return;
        for (const p of new Set(c.touched ?? [])) {
            if ((uses.get(p) ?? 0) < 2) continue;
            linked.add(i);
            if (firstBy.has(p)) parent[find(i)] = find(firstBy.get(p)); else firstBy.set(p, i);
        }
    });
    const out = calls.map((c) => (c.thread ? { thread: c.thread, how: c.how ?? "recorded" } : null));
    calls.forEach((c, i) => { if (!out[i] && linked.has(i)) out[i] = { thread: `l:${calls[find(i)].id}`, how: "lineage" }; });
    calls.forEach((c, i) => {
        if (out[i]) return;
        // Threads with a call that had ended by the time this one started, and none still running then.
        const last = new Map(), busy = new Set();
        calls.forEach((d, j) => {
            if (j === i || !out[j]) return;
            const t = out[j].thread;
            if (d.end <= c.start) last.set(t, Math.max(last.get(t) ?? -Infinity, d.end));
            else if (d.start < c.start && d.end > c.start) busy.add(t);
        });
        const pick = [...last.entries()].filter(([t]) => !busy.has(t)).sort((a, b) => b[1] - a[1])[0];
        if (pick) { out[i] = { thread: pick[0], how: "time" }; return; }
        // Nothing before it (a chat's opening build_kit): the thread of the next call that has one.
        const next = calls.findIndex((d, j) => j > i && out[j] && d.start >= c.start);
        out[i] = next >= 0 ? { thread: out[next].thread, how: "time" } : { thread: `t:${c.id}`, how: i === 0 ? "first" : "time" };
    });
    return out;
}
