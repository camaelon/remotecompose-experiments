// What a tool call asked and got back, in one log line, so a session can be retraced from the
// journal: the prompt build_kit was given, the examples and components it returned, the
// findings a render or audit reported, the page a publish made.
//
//   <tool> ok 2667ms {"client":"a1b2c3","args":{"goal":"..."},"result":{"examples":["TIM-12"],...}}
//
// Arguments are summarised, never copied whole: prompts and queries in full (up to a limit),
// ids and options as they are, documents (json, definition, doc, rc_base64) as their size and
// a short hash, so the same document can be recognised across calls without logging it.
// MCP_LOG_CALLS=0 turns the details off (the "<tool> ok <ms>" line stays).

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { resolvePath } from "./workspace.mjs";

const DETAILS = process.env.MCP_LOG_CALLS !== "0";
const KEEP_TEXT = new Set(["goal", "query", "prompt", "id", "name", "kind", "task", "topic", "action", "tool",
    "style", "category", "theme", "componentTheme", "clock", "mode", "family", "form_factor", "page_id"]);
const DOCUMENT = new Set(["json", "definition", "doc", "rc_base64", "source"]);
const MAX_LINE = 4000;

const hash = (s) => createHash("sha1").update(s).digest("hex").slice(0, 8);
const docSummary = (v) => {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return { bytes: Buffer.byteLength(s ?? ""), sha: hash(s ?? "") };
};

/** The arguments in short: what was asked, without the documents' content. */
export function summarizeArgs(args = {}) {
    const out = {};
    for (const [k, v] of Object.entries(args ?? {})) {
        if (v === undefined) continue;
        if (DOCUMENT.has(k)) { out[k] = docSummary(v); continue; }
        if (typeof v === "string") out[k] = KEEP_TEXT.has(k) || /_path$/.test(k) ? v.slice(0, 1000) : v.length <= 120 ? v : { len: v.length, sha: hash(v) };
        else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
        else if (Array.isArray(v)) out[k] = v.length <= 12 && v.every((x) => typeof x !== "object") ? v : { items: v.length, sha: hash(JSON.stringify(v)) };
        else if (v && typeof v === "object") {
            const s = JSON.stringify(v);
            out[k] = s.length <= 300 ? v : { bytes: s.length, sha: hash(s), keys: Object.keys(v).slice(0, 8) };
        }
    }
    return out;
}

const ids = (list, key) => (Array.isArray(list) ? list.map((x) => x?.[key]).filter((x) => x !== undefined).slice(0, 12) : undefined);

/** What came back, in short: ids, names, codes and sizes from the result's JSON and text. */
export function summarizeResult(content) {
    const out = {};
    if (!Array.isArray(content)) return out;
    const images = content.filter((c) => c?.type === "image").length;
    if (images) out.images = images;
    for (const c of content) {
        if (c?.type !== "text" || typeof c.text !== "string") continue;
        let j = null;
        try { j = JSON.parse(c.text); } catch { /* plain text */ }
        if (j && typeof j === "object" && !Array.isArray(j)) {
            const pick = {
                examples: ids(j.examples, "id"),
                layout_model: j.layout_model?.id,
                components: ids(j.components, "name") ?? (Array.isArray(j.components) && typeof j.components[0] === "string" ? j.components.slice(0, 12) : undefined),
                needs_component: j.needs_component?.terms,
                icons: j.icons?.suggestions ? j.icons.suggestions.map((s) => s.icons?.[0]).filter(Boolean)
                    : ids(j.icons, "name"),
                not_covered: j.not_covered?.length ? j.not_covered : undefined,
                unmatched: j.unmatched_terms?.length ? j.unmatched_terms : undefined,
                id: typeof j.id === "string" ? j.id : undefined,
                title: typeof j.title === "string" ? j.title : undefined,
                name: typeof j.name === "string" ? j.name : undefined,
                ok: typeof j.ok === "boolean" ? j.ok : undefined,
                errors: Array.isArray(j.errors) && j.errors.length ? j.errors.slice(0, 5) : undefined,
                warnings: Array.isArray(j.warnings) && j.warnings.length ? j.warnings.length : undefined,
                counts: j.counts,
                findings: Array.isArray(j.findings) ? j.findings.map((f) => (typeof f === "string" ? f : `${f.severity ?? "note"}:${f.code ?? f.name ?? f.feature ?? "?"}`)).slice(0, 15) : undefined,
                bytes: typeof j.bytes === "number" ? j.bytes : undefined,
                rc_path: j.rc_path,
                url: j.url ?? j.page_url ?? j.public_url,
                count: typeof j.count === "number" ? j.count : undefined,
                error: j.error,
            };
            for (const [k, v] of Object.entries(pick)) if (v !== undefined && !(k in out)) out[k] = v;
        } else {
            // Plain text: the design warnings and finding lines carry [code]s; publish prints URLs.
            const codes = [...c.text.matchAll(/^- \[([a-z_]+)\]/gm)].map((m) => m[1]);
            if (codes.length) out.design_warnings = [...new Set([...(out.design_warnings ?? []), ...codes])];
            const finds = [...c.text.matchAll(/^(error|warning|info): \[([a-z_]+)\]/gm)].map((m) => `${m[1]}:${m[2]}`);
            if (finds.length) out.findings = [...new Set([...(out.findings ?? []), ...finds])].slice(0, 15);
            const url = /https?:\/\/\S+\/pages\/[A-Za-z0-9_-]{8,}\/?/.exec(c.text);
            if (url && !out.url) out.url = url[0];
        }
    }
    return out;
}

/** The detail part of a call's log line (JSON), or "" when details are off. */
export function callDetails({ client, args, content, error }) {
    if (!DETAILS) return "";
    const rec = { ...(client ? { client } : {}), args: summarizeArgs(args) };
    if (content) rec.result = summarizeResult(content);
    if (error) rec.error = String(error).split("\n")[0].slice(0, 300);
    let s = JSON.stringify(rec);
    if (s.length > MAX_LINE) s = s.slice(0, MAX_LINE) + "…";
    return " " + s;
}

// --- the session trace (the account pages' session view): a call's whole arguments and result,
// documents included (they are what someone retracing a session wants to read), capped.

export const TRACE_CAP = 20 << 10;
// Our own secrets, should one ever be passed as an argument or echoed in a result.
const SECRET = /\b(?:rc|rco|rcr)_[A-Za-z0-9_-]{43}\b/g;
const scrub = (s) => {
    let out = String(s).replace(SECRET, "[token]");
    const admin = process.env.MCP_TOKEN;
    if (admin && admin.length >= 24) out = out.split(admin).join("[token]");
    return out;
};

/** Cuts the longest strings in `v` (halving, repeatedly) until its JSON fits `cap`; else a head. */
function fit(v, cap) {
    let s = JSON.stringify(v);
    if (s === undefined) return null;
    if (s.length <= cap) return s;
    v = JSON.parse(s);
    for (let i = 0; i < 40 && s.length > cap; i++) {
        let best = null;   // [holder, key, length]
        const walk = (o) => {
            for (const [k, x] of Object.entries(o)) {
                if (typeof x === "string") { if (!best || x.length > best[2]) best = [o, k, x.length]; }
                else if (x && typeof x === "object") walk(x);
            }
        };
        if (v && typeof v === "object") walk(v);
        if (!best || best[2] < 200) break;
        const [o, k, n] = best;
        const keep = Math.max(100, Math.min(Math.floor(n / 2), n - (s.length - cap) - 60));
        o[k] = o[k].slice(0, keep) + `…[cut ${n - keep} of ${n} characters]`;
        s = JSON.stringify(v);
    }
    if (s.length <= cap) return s;
    // No long string to cut: the start of the JSON, as a string (escaping grows it: shrink to fit).
    let n = cap - 200, out;
    do { out = JSON.stringify({ _truncated: `${s.length} characters of JSON`, head: s.slice(0, n) }); n = Math.floor(n * 0.8); } while (out.length > cap && n > 100);
    return out;
}

/** The call's arguments as JSON, at most TRACE_CAP characters (long strings cut first), no secrets. */
export function traceArgs(args, cap = TRACE_CAP) {
    try { return scrub(fit(args ?? {}, cap) ?? "{}"); } catch { return null; }
}

/** A PNG's size from its header (base64), or null. */
function pngSize(b64) {
    try {
        const b = Buffer.from(String(b64).slice(0, 64), "base64");
        return b.readUInt32BE(0) === 0x89504e47 ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : null;
    } catch { return null; }
}

/** What came back, as text: every text item in full, an image as "[image WxH, N KB]"; capped, no secrets. */
export function traceResult(content, error, cap = TRACE_CAP) {
    let text;
    if (error != null) text = `error: ${error?.message ?? error}`;
    else if (!Array.isArray(content)) text = "";
    else text = content.map((c) => {
        if (c?.type === "text") return String(c.text ?? "");
        if (c?.type === "image") {
            const size = pngSize(c.data);
            const kb = Math.round((String(c.data ?? "").length * 3) / 4 / 1024);
            return `[image ${size ? `${size.w}x${size.h}` : c.mimeType ?? "?"}, ${kb} KB]`;
        }
        if (c?.type === "resource" || c?.type === "resource_link") return `[${c.type} ${c.resource?.uri ?? c.uri ?? ""}]`;
        return `[${c?.type ?? "?"}]`;
    }).join("\n\n");
    text = scrub(text);
    return text.length <= cap ? text : text.slice(0, cap - 60) + `\n…[cut: ${text.length} characters in all]`;
}

// The input files a call names (json_path, rc_path, path, input_path, ...: any "*_path" or "path"
// argument but the outputs), as they were when the call started: their content hash and size.
// Two calls with the same arguments read different documents when the file changed between
// them; the session page tells those apart (a version per path), and only calls whose files
// match too count as repeats.
const OUTPUT = /^(output|out|png|save|html)_?/i;
const MAX_HASH = 64 << 20;

/** {argName: {path, sha, bytes} | {path, missing: true}}, or null when the call names no file. */
export function traceFiles(args) {
    if (!args || typeof args !== "object") return null;
    const out = {};
    for (const [k, v] of Object.entries(args)) {
        if (typeof v !== "string" || !v || !(k === "path" || /_path$/.test(k)) || OUTPUT.test(k)) continue;
        try {
            const abs = resolvePath(v, k);
            const st = statSync(abs);
            if (!st.isFile()) continue;
            out[k] = st.size > MAX_HASH ? { path: v, bytes: st.size, sha: `size-${st.size}-${st.mtimeMs}` }
                : { path: v, bytes: st.size, sha: createHash("sha256").update(readFileSync(abs)).digest("hex").slice(0, 16) };
        } catch { out[k] = { path: v, missing: true }; }   // outside the workspace, or not there: recorded as such
    }
    return Object.keys(out).length ? out : null;
}
