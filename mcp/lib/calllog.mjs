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
                findings: Array.isArray(j.findings) ? j.findings.map((f) => (typeof f === "string" ? f : `${f.severity}:${f.code}`)).slice(0, 15) : undefined,
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
