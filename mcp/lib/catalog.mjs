// The example catalog (examples/catalog.json, built by examples/tools/build.mjs) and its
// vocabulary (docs/examples-vocabulary.json): term resolution, ranking and kit building for
// the rc-examples server. Phase 1 of docs/EXAMPLES_TAXONOMY.md, "The retrieval tool":
// deterministic, tags and synonyms only, every pick explained.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLibrary, loadIconCatalog, VERTICAL_EXAMPLES, BATCH_EXAMPLES, BATCH2_EXAMPLES, THREE_D_EXAMPLES } from "./components.mjs";
import { designAudit } from "./design-audit.mjs";
import { loadMaps } from "./maps.mjs";
import { STRUCTURES, classifyStructure, structureMenu, HIDE_TEMPLATES } from "./structures.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
export const EXAMPLES_DIR = process.env.RC_EXAMPLES_DIR ?? path.join(ROOT, "examples");
const VOCAB_PATH = process.env.RC_EXAMPLES_VOCAB ?? path.join(ROOT, "docs", "examples-vocabulary.json");

const STOP = new Set(["a", "an", "the", "and", "or", "with", "of", "for", "to", "in", "on", "that", "it",
    "my", "me", "some", "show", "showing", "make", "build", "create", "want", "need", "like", "using",
    "use", "which", "when", "from", "by", "as", "at", "is", "be", "can", "should", "one", "two", "into",
    "this", "these", "those", "your", "our", "its", "please", "app", "application", "let", "have", "get",
    "i", "we", "you", "also", "so", "are", "will", "would", "could", "about", "nice", "good", "simple", "new", "whether", "shows", "remotecompose", "ui", "display", "displays", "displaying"]);

let cache = null;

/** Lower case; - _ / and spaces equivalent; a trailing plural s dropped from each word. */
export function normalizeWords(s) {
    return String(s).toLowerCase().replace(/[-_/]+/g, " ").replace(/[^a-z0-9.+ ]+/g, " ")
        .split(/\s+/).map((w) => w.replace(/^\.+|\.+$/g, "")).filter(Boolean).map(singular);
}
// Plurals the suffix rules get wrong ("buses" would become "buse").
const IRREGULAR = { buses: "bus", gases: "gas", statuses: "status", bonuses: "bonus", viruses: "virus",
    campuses: "campus", analyses: "analysis", axes: "axis", indices: "index", children: "child", people: "person", calories: "calorie", movies: "movie", cookies: "cookie", series: "series", species: "species" };
function singular(w) {
    // Not plurals: this, status, bus, analysis, canvas, gps.
    if (w.length <= 3 || !w.endsWith("s") || /(ss|is|us|as|ps)$/.test(w) || w.includes(".")) return w;
    if (/(ch|sh|x|z|ss)es$/.test(w)) return w.slice(0, -2);   // switches, boxes
    if (IRREGULAR[w]) return IRREGULAR[w];                    // buses (not "buse")
    if (/[^aeiou]ies$/.test(w)) return w.slice(0, -3) + "y";  // entries
    return w.slice(0, -1);
}

/** The catalog, vocabulary, component library and phrase index, reloaded when a file changes. */
// ---- the generated corpus (examples/generated, built by its build.mjs) --------------------
// Documents the eval runs built from one prompt each: shown only when asked (include_generated).
let genCache = null;
export function loadGenerated() {
    const p = path.join(EXAMPLES_DIR, "generated", "index.json");
    const stamp = existsSync(p) ? statSync(p).mtimeMs : 0;
    if (genCache && genCache.stamp === stamp) return genCache.list;
    // RC_HIDE_GENERATED="55,GEN-52": entries an evaluation run must not see (its own prompt's).
    const hide = new Set(String(process.env.RC_HIDE_GENERATED ?? "").split(",").map((x) => x.trim()).filter(Boolean).map((x) => /^\d+$/.test(x) ? `GEN-${x.padStart(2, "0")}` : x));
    const list = (stamp ? JSON.parse(readFileSync(p, "utf8")).examples ?? [] : []).filter((e) => !hide.has(e.id));
    genCache = { stamp, list };
    return list;
}
/** Generated documents whose prompt is closest to a goal: [{entry, score, shared}]. */
export function similarGenerated(goal, limit = 3) {
    const FILLER = new Set(["with", "for", "and", "the", "that", "this", "from", "into", "your", "you", "can", "its", "each", "all", "show", "showing", "make", "build", "want", "need", "some", "per", "one", "two", "three"]);
    const words = new Set(normalizeWords(goal).filter((w) => w.length > 2 && !GENERIC.has(w) && !FILLER.has(w)));
    if (!words.size) return [];
    return loadGenerated().map((e) => {
        const kw = new Set(normalizeWords(`${e.prompt} ${e.title} ${(e.components ?? []).join(" ")}`));
        const shared = [...words].filter((w) => kw.has(w));
        return { entry: e, shared, score: shared.length / Math.sqrt(words.size * Math.max(1, kw.size) / 8) };
    }).filter((x) => x.shared.length >= 2).sort((a, b) => b.score - a.score).slice(0, limit);
}

export function loadCatalog() {
    const catPath = path.join(EXAMPLES_DIR, "catalog.json");
    const stamp = [catPath, VOCAB_PATH].map((p) => (existsSync(p) ? statSync(p).mtimeMs : 0)).join(":");
    if (cache && cache.stamp === stamp) return cache;
    const vocab = JSON.parse(readFileSync(VOCAB_PATH, "utf8"));
    const catalog = existsSync(catPath) ? JSON.parse(readFileSync(catPath, "utf8")) : { examples: [] };
    if (process.env.RC_HIDE_VERTICALS) catalog.examples = catalog.examples.filter((e) => !VERTICAL_EXAMPLES.includes(e.id));
    if (process.env.RC_HIDE_BATCH) catalog.examples = catalog.examples.filter((e) => !BATCH_EXAMPLES.includes(e.id));
    if (process.env.RC_HIDE_BATCH2) catalog.examples = catalog.examples.filter((e) => !BATCH2_EXAMPLES.includes(e.id));
    if (process.env.RC_HIDE_3D) catalog.examples = catalog.examples.filter((e) => !THREE_D_EXAMPLES.includes(e.id));
    const library = loadLibrary();
    // phrase (normalised words joined by a space) -> [{kind, id}]
    const phrases = new Map();
    const add = (phrase, kind, id) => {
        const key = normalizeWords(phrase).join(" ");
        if (!key) return;
        const list = phrases.get(key) ?? [];
        if (!list.some((x) => x.kind === kind && x.id === id)) list.push({ kind, id });
        phrases.set(key, list);
    };
    for (const [id, c] of Object.entries(vocab.capabilities)) {
        add(id, "capability", id);
        if (c.label) add(c.label, "capability", id);
        for (const s of c.synonyms ?? []) add(s, "capability", id);
    }
    for (const [id, u] of Object.entries(vocab.use_cases)) {
        add(id, "use_case", id);
        for (const s of u.synonyms ?? []) add(s, "use_case", id);
    }
    for (const [id, f] of Object.entries(vocab.form_factors)) {
        add(id, "form_factor", id);
        for (const s of f.synonyms ?? []) add(s, "form_factor", id);
    }
    for (const [name, c] of Object.entries(vocab.components ?? {})) {
        if (!library.components.has(name)) continue;   // only components that exist
        add(name, "component", name);
        for (const s of c.synonyms ?? []) add(s, "component", name);
    }
    for (const name of library.components.keys()) add(name, "component", name);
    const maxPhrase = Math.max(1, ...[...phrases.keys()].map((k) => k.split(" ").length));
    const examples = catalog.examples ?? [];
    // Each library component's demo (examples/components/<Name>/: doc.json, meta.json, render.png).
    const demos = new Map((catalog.components ?? []).map((c) => [c.id, c]));
    cache = { stamp, vocab, catalog, examples, byId: new Map(examples.map((e) => [e.id, e])), demos, library, phrases, maxPhrase };
    return cache;
}

/**
 * Map free text (or a list of terms) to vocabulary ids, longest phrase first. Explicit ids
 * ("input.drag", "widget-4x2", "Button") are accepted as such.
 */
// Words too generic to name a subject ("current", "today", "screen").
// Also the adjectives and filler a model adds when it rewrites the user's request
// ("beautiful polished responsive ... themed"): none of them is a thing to build.
// Goals that need date arithmetic no example teaches: the kit points at the formulas in the
// expressions reference (a run of prompt 8 built an ISO week from scratch, in 27 calls).
// Goals that need typing: the format has no text input of its own.
const TEXT_ENTRY = /\b(calculator|converter|amount|enter a number|text ?fields?|input fields?|login|log ?in|sign ?in|sign ?up|password|e-?mail field|search (box|bar|field)|type|typing|keyboard|form fields?|enter (a|the|your)|text box)\b/i;

const CALENDAR_MATH = /\b(week number|iso week|calendar|days? (in|of) (the )?(month|year)|leap year|this week|next week|last week|days? (until|since|ago|from now|left)|end of (the )?(month|year)|through the (week|month|year)|how far through|(month|year) progress|month view|date (window|picker))\b/i;

const GENERIC = new Set(["current", "number", "numbers", "drawn", "drawing", "shown", "showing", "display", "displaying",
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "dozen", "all", "every", "each",
    "change", "changes", "changing", "amount", "amounts", "break", "breaks", "empty", "empties", "window", "hand", "hands", "face",
    "highlight", "highlighted", "highlighting", "glance", "session", "sessions", "section", "sections", "choice", "choices",
    "option", "options", "item", "items", "entry", "entries", "row", "rows", "line", "lines", "part", "parts",
    "through", "far", "coloured", "colored", "colour", "color", "colours", "colors", "room", "rooms", "out", "summary", "quality",
    "score", "scores", "slept", "count", "counts", "total", "totals", "title", "titles", "saved", "monochrome", "production", "care", "active", "inactive", "unread", "read", "across", "along", "within", "between", "around", "per", "versus", "vs", "against", "today", "time", "screen", "app", "page", "view", "data", "value", "values", "info", "information", "smart", "make", "can", "adjust",
    "beautiful", "polished", "responsive", "modern", "clean", "custom", "drawn", "smooth", "dynamic", "possible", "themed", "daily",
    "elegant", "sleek", "minimal", "pretty", "stylish", "professional", "fancy", "cool", "great", "visual", "visualization", "visualisation",
    "design", "designed", "interface", "layout", "style", "styled", "rich", "detailed", "simple", "basic", "accurate", "real", "live",
    "based", "external", "source", "supplied", "labeled", "labelled", "using", "compact", "state", "dynamic", "possible", "host", "variable", "variables",
    "must", "not", "native", "render", "rendered", "html", "marked", "premium", "navy", "theme", "dark", "light", "four", "three", "two", "status",
    "widget", "hour", "hours", "minute", "next", "previous", "last", "how", "many", "much", "until", "till", "since", "ago", "day", "days", "week", "weeks", "over", "under", "above", "below", "style",
    "plotted", "plot", "grid", "sample", "samples", "emoji", "emojis", "typography", "font", "background", "card", "cards",
    "red", "orange", "yellow", "green", "blue", "cyan", "teal", "purple", "pink", "white", "black", "grey", "gray", "navy", "gold", "high", "low", "level", "vertical", "horizontal", "top", "bottom", "left", "right", "small", "large", "big", "label", "labels", "indicator", "chart", "showing", "show", "create"]);
// Sizes and numbers ("420x540", "24") are no subject either.
const generic = (w) => GENERIC.has(w) || /ly$/.test(w) || /^\d+(x\d+)?$/.test(w);

export function resolveTerms(input) {
    const C = loadCatalog();
    const texts = Array.isArray(input) ? input : [input ?? ""];
    const out = { capabilities: new Set(), use_cases: new Set(), form_factors: new Set(), components: new Set(),
                  matched: [], unmatched_terms: [] };
    const bucket = { capability: "capabilities", use_case: "use_cases", form_factor: "form_factors", component: "components" };
    for (const text of texts) {
        const words = normalizeWords(text);
        for (let i = 0; i < words.length;) {
            let hit = null, n = Math.min(C.maxPhrase, words.length - i);
            for (; n > 0; n--) {
                // A stopword alone is never a term ("for" is a synonym of loops only in
                // "for loop"; "an app for the moon" is not asking for one).
                if (n === 1 && STOP.has(words[i])) continue;
                const p = words.slice(i, i + n).join(" ");
                if (C.phrases.has(p)) { hit = { phrase: p, ids: C.phrases.get(p) }; break; }
            }
            if (hit) {
                for (const { kind, id } of hit.ids) out[bucket[kind]].add(id);
                out.matched.push({ term: hit.phrase, ids: hit.ids.map((x) => `${x.kind}:${x.id}`) });
                i += n;
            } else {
                // A capability prefix ("input", "draw") is a family of ids.
                const w = words[i];
                const fam = Object.keys(C.vocab.capabilities).filter((id) => id.startsWith(w + "."));
                if (fam.length && w.length > 2) {
                    fam.forEach((id) => out.capabilities.add(id));
                    out.matched.push({ term: w, ids: fam.map((id) => `capability:${id}`) });
                } else if (w.length > 1 && !STOP.has(w) && !generic(w)) out.unmatched_terms.push(w);   // a word worth acting on ("tonight's" leaves an "s")
                i++;
            }
        }
    }
    return {
        capabilities: [...out.capabilities].sort(), use_cases: [...out.use_cases].sort(),
        form_factors: [...out.form_factors].sort(), components: [...out.components].sort(),
        matched: out.matched, unmatched_terms: [...new Set(out.unmatched_terms)],
    };
}

function exampleCaps(e) {
    return { primary: e.capabilities?.primary ?? [], secondary: e.capabilities?.secondary ?? [] };
}
function textBlob(e) {
    return normalizeWords([e.title, e.summary, e.prompt, ...(e.teaches ?? []), ...(e.keywords ?? []),
        ...(e.snippets ?? []).map((s) => s.note), ...(e.pitfalls ?? [])].filter(Boolean).join(" ")).join(" ");
}

/** Score one example against a resolved query; returns {score, why, matched, lacking}. */
function scoreExample(e, q, words) {
    const { primary, secondary } = exampleCaps(e);
    let score = 0;
    const why = [], matched = [], lacking = [];
    for (const cap of q.capabilities) {
        if (primary.includes(cap)) { score += 3; matched.push(cap); why.push(`demonstrates ${cap}`); }
        else if (secondary.includes(cap)) { score += 2; matched.push(cap); why.push(`uses ${cap}`); }
        else lacking.push(cap);
    }
    for (const u of q.use_cases) if ((e.use_cases ?? []).includes(u)) { score += 2; why.push(`use case ${u}`); }
    for (const f of q.form_factors) if (e.form_factor === f) { score += 1.5; why.push(`form factor ${f}`); }
    // derived.components are the calls the build found; meta.components may also name the
    // component an example builds by hand (INT-02 draws its own Switch), which ranks lower.
    const calls = e.derived?.components ?? [];
    for (const c of q.components) {
        if (calls.includes(c)) { score += e.kind === "gallery" ? 4 : 3; why.push(`calls the ${c} component`); }
        else if ((e.components ?? []).includes(c)) { score += 1.5; why.push(`builds a ${c} by hand`); }
    }
    if (words.length) {
        const blob = ` ${textBlob(e)} `;
        const hits = words.filter((w) => blob.includes(` ${w} `) || blob.includes(` ${w}`));
        if (hits.length) { score += 0.5 * hits.length; why.push(`mentions ${hits.join(", ")}`); }
    }
    return { score, why, matched, lacking };
}

// Whether an example draws its whole UI on canvases (a feature demo), from its doc: such an
// example teaches a technique, and its structure must not be copied for a screen.
const canvasOnlyCache = new Map();
export function canvasOnly(e) {
    if (canvasOnlyCache.has(e.id)) return canvasOnlyCache.get(e.id);
    let v = false;
    try {
        // The root is a canvas (alone, or the only child of one container), or the audit says
        // the whole UI is hand-placed on canvases.
        const d = exampleDoc(e);
        const unwrap = (n) => {
            if (!n || typeof n !== "object") return n;
            if (Array.isArray(n)) return n.length === 1 ? unwrap(n[0]) : n;
            const k = typeof n.type === "string" ? n.type.toLowerCase() : Object.keys(n)[0]?.toLowerCase();
            const body = typeof n.type === "string" ? n : n[Object.keys(n)[0]];
            if (["box", "column", "row"].includes(k) && Array.isArray(body?.children) && body.children.length === 1) return unwrap(body.children[0]);
            return n;
        };
        const root = unwrap(d?.root);
        const isCanvas = root && typeof root === "object" && (String(root.type).toLowerCase() === "canvas" || "canvas" in root);
        v = Boolean(d && (isCanvas || designAudit(d).some((f) => f.code === "absolute_layout")));
    } catch { /* unreadable */ }
    canvasOnlyCache.set(e.id, v);
    return v;
}
const CANVAS_NOTE = "A canvas-only feature demo: take the technique (the drawing, the expressions), not the " +
    "structure. Lay a screen out with column/row/text and components, and keep a canvas for the drawing itself.";

const inlineCache = new Map();
/** The component names an example defines in its own doc.json (`components` block). */
export function inlineComponents(e) {
    if (inlineCache.has(e.id)) return inlineCache.get(e.id);
    let names = [];
    try { const c = exampleDoc(e)?.components; if (c && typeof c === "object" && !Array.isArray(c)) names = Object.keys(c); } catch { /* no doc */ }
    inlineCache.set(e.id, names);
    return names;
}
/** A snippet is a pointer into the example, not the example: a long one is cut, with a note. */
function capSnippet(json, limit = 1600) {
    if (json === undefined || json === null) return json;
    const s = typeof json === "string" ? json : JSON.stringify(json);
    if (s.length <= limit) return json;
    return { truncated: true, chars: s.length, start: s.slice(0, limit), note: "The whole snippet is in the example: get <id> with parts [\"json\"]." };
}

export function summarizeExample(e, { matched = [], compact = false } = {}) {
    let snippets = (e.snippets ?? []).filter((s) => !matched.length || matched.includes(s.shows));
    if (!snippets.length) snippets = e.snippets ?? [];   // nothing matched the capabilities: show them all
    // In a kit (compact): the entry is a pointer, not the example. The matched snippets first,
    // then the shortest, within a budget; pitfalls within one too; `get` has everything.
    if (compact) {
        const budget = 2400;
        const ranked = [...snippets].sort((a, b) => (matched.includes(b.shows) - matched.includes(a.shows))
            || JSON.stringify(snippetJson(e, a.pointer) ?? "").length - JSON.stringify(snippetJson(e, b.pointer) ?? "").length);
        let used = 0; const kept = [];
        for (const sn of ranked) { const n = JSON.stringify(snippetJson(e, sn.pointer) ?? "").length + JSON.stringify(sn).length; if (used + n > budget && kept.length) break; kept.push(sn); used += n; }
        snippets = kept;
    }
    const pitfalls = compact ? (() => { let used = 0; return (e.pitfalls ?? []).filter((p) => (used += String(p).length) <= 1500); })() : e.pitfalls;
    return {
        ...(canvasOnly(e) ? { structure: "canvas", structure_note: CANVAS_NOTE } : {}),
        id: e.id, folder: e.folder, title: e.title, summary: e.summary, level: e.level, family: e.family,
        kind: e.kind ?? "example",
        capabilities: e.capabilities, use_cases: e.use_cases, form_factor: e.form_factor,
        // Library components the example calls; what its own doc.json defines (a Panel of its
        // own) is listed apart: `get` finds only library ones.
        components: (e.derived?.components ?? []).filter((c) => !inlineComponents(e).includes(c)),
        ...(inlineComponents(e).length ? { inline_components: inlineComponents(e),
            inline_note: "Defined inside this example's doc.json (its `components` block), not in the library: copy the definition from get <id> (parts json), or use the library's Card." } : {}),
        ...((e.components ?? []).some((c) => !(e.derived?.components ?? []).includes(c))
            ? { hand_built: (e.components ?? []).filter((c) => !(e.derived?.components ?? []).includes(c)) } : {}),
        teaches: e.teaches, pitfalls,
        ...(compact && (e.snippets ?? []).length > snippets.length ? { more: `${(e.snippets ?? []).length - snippets.length} more snippet(s) and the full JSON: get ${e.id}` } : {}),
        // What its renders were checked against (dates, values): verify a derived document the same way.
        ...(e.check?.describe ? { verified: String(e.check.describe).slice(0, 500) } : {}),
        snippets: snippets.map((s) => ({ ...s, json: capSnippet(snippetJson(e, s.pointer)) })),
        size: { bytes: e.derived?.bytes, ops: e.derived?.op_count },
    };
}

export function exampleDoc(e, which = "doc.json") {
    const p = path.join(EXAMPLES_DIR, e.folder, which);
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
}
function snippetJson(e, pointer) {
    const doc = exampleDoc(e);
    let cur = doc;
    for (const part of pointer.split("/").slice(1).map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))) {
        if (cur == null) return null;
        cur = cur[Array.isArray(cur) ? Number(part) : part];
    }
    return cur == null ? null : elideData(cur);
}

// A snippet teaches a technique, not its data: a long list of numbers (a forecast, a table)
// is cut to its first values and a count (a kit pasted a 49-entry tide table to teach a row).
function elideData(v) {
    if (Array.isArray(v)) {
        if (v.length > 8 && v.every((x) => typeof x === "number")) return [...v.slice(0, 4), `… ${v.length - 4} more values`];
        return v.map(elideData);
    }
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, elideData(x)]));
    return v;
}

/** Ranked examples for a query. */
export function findExamples({ query = "", capabilities = [], use_cases = [], form_factor, components = [],
                               max_level, family, limit = 5 } = {}) {
    const C = loadCatalog();
    const r = resolveTerms(query);
    const q = {
        capabilities: [...new Set([...r.capabilities, ...expandCapIds(capabilities, C)])],
        use_cases: [...new Set([...r.use_cases, ...use_cases])],
        form_factors: [...new Set([...r.form_factors, ...(form_factor ? [form_factor] : [])])],
        components: [...new Set([...r.components, ...components])],
    };
    const ranked = C.examples
        .filter((e) => (max_level === undefined || e.level <= max_level) && (!family || e.family === family))
        .map((e) => ({ e, ...scoreExample(e, q, r.unmatched_terms) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score || a.e.level - b.e.level || (a.e.derived?.op_count ?? 0) - (b.e.derived?.op_count ?? 0));
    return {
        resolved: { ...q, matched: r.matched },
        unmatched_terms: r.unmatched_terms,
        total: ranked.length,
        examples: ranked.slice(0, limit).map((x) => ({
            ...summarizeExample(x.e, { matched: x.matched }), score: Math.round(x.score * 10) / 10,
            why: x.why, matched_capabilities: x.matched, lacking_capabilities: x.lacking,
        })),
    };
}

/** "input" -> every input.* id; exact ids pass through; unknown ids are reported by the caller. */
function expandCapIds(ids, C) {
    const out = [];
    for (const id of ids) {
        if (C.vocab.capabilities[id]) out.push(id);
        else out.push(...Object.keys(C.vocab.capabilities).filter((k) => k.startsWith(id + ".")));
    }
    return out;
}

// 3D is offered only when a request asks for it: a 2D chart or a picture of an object must not
// come back as a 3D scene (3D has not landed in androidx yet; it plays in the C++ and TS players).
export const WANTS_3D = /\b(3[- ]?d|three[- ]dimensional|exploded view|surface plot|functions? of two variables|360(°|[- ]degrees?)? (view|spin|turntable)|z\s*=\s*f\s*\()/i;
const THREE_D_COMPONENTS = new Set(["Scene3D", "Chart3D"]);
const is3D = (e) => exampleCaps(e).primary.some((c) => c.startsWith("3d.")) || (e.components ?? []).some((c) => THREE_D_COMPONENTS.has(c));
const no3dCache = new WeakMap();
function without3D(C) {
    let v = no3dCache.get(C);
    if (!v) no3dCache.set(C, (v = { ...C, examples: C.examples.filter((e) => !is3D(e)) }));
    return v;
}

/** The smallest set of examples (greedy set cover) that together demonstrate the goal. */
// How many examples mention each word (title, keywords, prompt), for the subject weighting.
const dfCache = new WeakMap();
function wordDocFreq(C) {
    let m = dfCache.get(C);
    if (m) return m;
    m = new Map();
    for (const e of C.examples) {
        const words = new Set(normalizeWords([e.title, (e.keywords ?? []).join(" "), e.prompt].filter(Boolean).join(" ")));
        for (const w of words) m.set(w, (m.get(w) ?? 0) + 1);
    }
    dfCache.set(C, m);
    return m;
}

export function buildKit({ goal = "", capabilities = [], max_examples = 4, include_generated = false, structure = null } = {}) {
    const kit = buildKitCore({ goal, capabilities, max_examples, structure });
    if (include_generated) {
        const sim = similarGenerated(goal);
        if (sim.length) kit.generated = sim.map(({ entry: e, shared }) => ({ id: e.id, title: e.title, prompt: e.prompt, components: e.components,
            bytes: e.bytes, why: `shares ${shared.join(", ")}`, note: "a whole document an assistant built from that prompt with these tools (not minimal, not Java-verified): get it for its JSON" }));
    }
    return kit;
}

function buildKitCore({ goal = "", capabilities = [], max_examples = 4, structure = null } = {}) {
    // The caller's own reading of the request beats the guess from its words: one structure or
    // several, the main one first; "none" when no structure fits.
    const picks = (Array.isArray(structure) ? structure : structure ? [structure] : []).filter((id) => id !== "none");
    const none = (Array.isArray(structure) ? structure : [structure]).includes("none");
    const pickedAll = picks.map((id) => STRUCTURES.find((s) => s.id === id) ?? (() => { throw new Error(`build_kit: no structure "${id}": use ${STRUCTURES.map((s) => s.id).join(", ")} or none`); })());
    const chosen = pickedAll[0] ?? null;
    const shapeOf = () => (chosen ? { structure: chosen, score: Infinity } : none ? null : classifyStructure(goal));
    const wants3D = WANTS_3D.test(String(goal)) || capabilities.some((c) => String(c).startsWith("3d"));
    const C = wants3D ? loadCatalog() : without3D(loadCatalog());
    const r = resolveTerms(goal);
    if (!wants3D) {
        r.components = r.components.filter((n) => !THREE_D_COMPONENTS.has(n));
        r.capabilities = r.capabilities.filter((c) => !c.startsWith("3d."));
    }
    const needed = new Set([...r.capabilities, ...expandCapIds(capabilities, C)]);
    // Components first: a goal that names a component gets its call, not a hand-drawn copy.
    // A structure with a template: the template first, whatever the words matched.
    const template = !HIDE_TEMPLATES ? shapeOf()?.structure.template : null;
    const alsoTemplates = HIDE_TEMPLATES ? [] : pickedAll.slice(1).map((s) => s.template).filter(Boolean);
    const comps = [...new Set([...(template ? [template] : []), ...alsoTemplates, ...pickedAll.flatMap((s) => [...(s.core ?? []), ...(s.components ?? [])]), ...(shapeOf()?.structure.core ?? []), ...r.components])].filter((n) => !(HIDE_TEMPLATES && ["RowList", "AdaptiveSplit"].includes(n))).map((n) => componentSummary(n)).filter(Boolean);
    for (const c of comps) for (const cap of c.capabilities ?? []) needed.delete(cap);
    // A word that names a component ("curve" -> LineChart) is covered by it: the capabilities
    // the same word also resolves to (draw.path) need no example of their own, unless another
    // word of the goal asks for them.
    const capsOf = (m, has) => (m.ids ?? []).filter((x) => x.startsWith("capability:")).map((x) => x.slice(11))
        .filter(() => (m.ids ?? []).some((x) => x.startsWith("component:")) === has);
    const byComponent = new Set(r.matched.flatMap((m) => capsOf(m, true)));
    const byOthers = new Set(r.matched.flatMap((m) => capsOf(m, false)));
    for (const cap of byComponent) if (!byOthers.has(cap)) needed.delete(cap);
    const kit = [];
    const remaining = new Set(needed);
    // (Diagnostics, DX-*, are deliberately broken documents: never offered for a goal.)
    const pool = C.examples.filter((e) => !/^DX-/.test(e.id));
    while (remaining.size && kit.length < max_examples) {
        let best = null;
        for (const e of pool) {
            const { primary, secondary } = exampleCaps(e);
            const covers = [...remaining].filter((c) => primary.includes(c) || secondary.includes(c));
            if (!covers.length) continue;
            const titleWords = ` ${normalizeWords(e.title ?? "").join(" ")} `;
            const titleBonus = r.matched.some((m) => titleWords.includes(` ${m.term} `.replace(/^ this /, " "))) ? 0.5 : 0;
            // An example built with a component the goal asks for shows that component in use.
            const compBonus = r.components.some((c) => (e.components ?? []).includes(c)) ? 1 : 0;
            const useBonus = titleBonus + compBonus + (r.use_cases.some((u) => (e.use_cases ?? []).includes(u)) ? 0.5 : 0)
                + (r.form_factors.includes(e.form_factor) ? 0.5 : 0);
            // An example ABOUT a capability (primary) teaches it better than one that uses it
            // in passing (secondary): "this month" wants the calendar, not a text demo with a date.
            const weight = covers.reduce((n, c) => n + (primary.includes(c) ? 1 : 0.5), 0);
            const value = (weight + useBonus) / (1 + 0.25 * (e.level ?? 1));
            if (!best || value > best.value || (value === best.value && (e.derived?.op_count ?? 0) < (best.e.derived?.op_count ?? 0))) {
                best = { e, covers, value };
            }
        }
        if (!best) break;
        best.covers.forEach((c) => remaining.delete(c));
        pool.splice(pool.indexOf(best.e), 1);
        kit.push(best);
    }
    // Examples about the goal's subject: its words in an example's title, keywords or prompt
    // ("sunrise" -> the sun arc example), which capabilities alone don't reach.
    // Time nouns are generic for "what to draw" but name a subject for the examples: a week
    // widget wants the calendar, not a text demo.
    const TIME_NOUNS = new Set(["day", "days", "week", "weeks", "month", "months", "year", "years", "hour", "hours", "minute", "minutes",
        "second", "seconds", "today", "tonight", "date", "dates", "time", "times", "season", "seasons", "calendar"]);
    const goalWords = normalizeWords(goal).filter((w) => w.length > 2 && !STOP.has(w) && (!generic(w) || TIME_NOUNS.has(w)));
    // A word that many examples mention ("day", "year", "time") says less about the subject
    // than one few do ("curve", "moon"): each hit is weighted by the word's rarity.
    const rarity = (w) => {
        const n = C.examples.length, d = wordDocFreq(C).get(w) ?? 0;
        return Math.min(1.5, Math.max(0.35, Math.log((n + 1) / (d + 1)) / Math.log(n + 1) * 1.5));
    };
    const textScore = (e) => {
        const t = ` ${normalizeWords(e.title ?? "").join(" ")} `, k = ` ${normalizeWords((e.keywords ?? []).join(" ")).join(" ")} `,
              p = ` ${normalizeWords(e.prompt ?? "").join(" ")} `;
        const hits = goalWords.filter((w) => t.includes(` ${w}`) || k.includes(` ${w}`) || p.includes(` ${w}`));
        const score = goalWords.reduce((n, w) => n + rarity(w) * ((t.includes(` ${w}`) ? 2 : 0) + (k.includes(` ${w}`) ? 1.5 : 0) + (p.includes(` ${w}`) ? 1 : 0)), 0);
        return { hits, score };
    };
    // Not promoted: examples that knowingly show an anti-pattern (an expected design finding:
    // a fixed date, glyph stars); a canvas-only demo counts for less than a laid-out screen.
    const DESIGN_CODES = new Set(["hardcoded_date", "glyph_icon", "absolute_layout", "fixed_coordinates", "text_anchor"]);
    // (Diagnostics, DX-*, are deliberately broken documents: never a subject example.)
    const byText = C.examples.filter((e) => e.kind !== "gallery" && !/^DX-/.test(e.id) && !(e.expect_findings ?? []).some((c) => DESIGN_CODES.has(c)))
        .map((e) => { const t = textScore(e); return { e, ...t, score: t.score * (canvasOnly(e) ? 0.6 : 1) }; })
        // Two of the goal's words, or one in the title: a single shared word in passing ("target"
        // in a touch-target example for a thermostat's target) is not the subject.
        .filter((x) => x.score >= (goalWords.length <= 2 ? 1.5 : 3) && (new Set(x.hits).size >= 2
            || (goalWords.length <= 3 && goalWords.some((w) => ` ${normalizeWords(x.e.title ?? "").join(" ")} `.includes(` ${w} `)))
            || (goalWords.length <= 2 && x.hits.length >= 1)))
        .sort((a, b) => b.score - a.score);
    // The second subject example must be about the subject nearly as much as the first (a
    // skyline that mentions the moon is not a second moon example).
    const topScore = byText[0]?.score ?? 0;
    const x_hitsEnough = (y) => new Set(y.hits).size >= 2;
    // (With a structure chosen, a subject needs more than a passing word: "where" is not a map.)
    for (const x of byText.slice(0, 2).filter((y, i) => (i === 0 || y.score >= 0.5 * topScore) && (!chosen || x_hitsEnough(y)))) {
        const have = kit.find((k) => k.e.id === x.e.id);
        if (have) { have.about = x.hits; have.value = x.score; continue; }   // a capability pick that is also the subject
        kit.unshift({ e: x.e, covers: [], value: x.score, about: x.hits });
    }
    // max_examples holds: the goal's own subject first, then the capability picks that fit.
    if (kit.length > max_examples) {
        const about = kit.filter((k) => k.about), rest = kit.filter((k) => !k.about);
        kit.splice(0, kit.length, ...about.slice(0, max_examples), ...rest.slice(0, Math.max(0, max_examples - about.length)));
    }
    // The goal's own subject first, best match first; then the capability picks, simplest first.
    kit.sort((a, b) => (b.about ? 1 : 0) - (a.about ? 1 : 0) || (a.about && b.about ? b.value - a.value : 0) || a.e.level - b.e.level);
    // How to structure the screen: the best-matching example that is laid out with components
    // (not a canvas-only demo), else the reference app layout.
    // The layout model: among the reference screens, the one closest to the goal, else the first.
    // (A canvas-only demo is no model of a screen's structure, whatever it is about.)
    let models = LAYOUT_MODELS.map((id) => C.examples.find((e) => e.id === id)).filter((e) => e && !canvasOnly(e));
    // A widget or tile is modelled on a widget, never on a phone screen (a seasons widget was
    // sent to a 565-op day-length screen because its words matched).
    // A watch face or tile is modelled on the round watch example.
    if (/\b(watch ?face|always[- ]on|ambient)\b/i.test(String(goal)) && !/\btile\b/i.test(String(goal))) {
        // (A face is a drawing on the round screen: the analog clock, canvas and all.)
        const round = C.examples.filter((e) => e.form_factor === "watch-round");
        if (round.length) models = round;
    } else if (/\b(widget|tile|complication|glance)\b/i.test(String(goal))) {
        const small = models.filter((e) => /widget|square|watch|tile/.test(String(e.form_factor)));
        if (small.length) models = small;
    }
    // Earlier references are the stronger models: a near tie goes to them.
    // With no subject match, the kind of surface decides: a form or settings screen takes the
    // form-rows model, another full screen the cards list, a widget or tile the sunrise widget.
    const gl = String(goal).toLowerCase();
    const fallback = /\b(settings?|form|login|sign[- ]?in|preferences|profile|account|mixer|sliders?|toggles?|switches|controls?|calculator|converter|picker)\b/.test(gl) ? "CMP-12"
        : /\b(screen|app|page|dashboard|player|tracker|list|card)\b/.test(gl) ? "CMP-05"
        // A small widget of a few values: the countdown (4x2, texts in a column); one with a
        // drawing or a curve: the sunrise widget.
        : /\b(widget|tile)\b/.test(gl) && !/\b(chart|curve|graph|plot|path|arc|ring|gauge|map|moon|sun|tide)\b/.test(gl) ? "TIM-08" : "TIM-12";
    // A dashboard is modelled on the stats dashboard (tiles, a chart, a list), whatever its subject words match.
    const dashboard = /\b(dashboards?|overview)\b/i.test(String(goal)) ? models.find((e) => e.id === "CMP-08") : null;
    // What the request is shaped like decides the start: among that structure's examples, the
    // closest in subject, else its best. Only a request with no recognisable shape uses the words.
    const shape = shapeOf();
    const shapeExamples = (shape?.structure.examples ?? []).filter((id) => !(HIDE_TEMPLATES && id === "CMP-18")).map((id) => C.examples.find((e) => e.id === id)).filter(Boolean);
    // (With a template its example is the start: it shows how the template is called.)
    const shapeModel = (!HIDE_TEMPLATES && shape?.structure.template ? shapeExamples[0] : null)
        ?? shapeExamples.map((e, i) => ({ e, score: textScore(e).score >= 3 ? textScore(e).score : 0, i })).sort((a, b) => b.score - a.score || a.i - b.i)[0]?.e;
    const model = shapeModel ?? dashboard ?? models.map((e, i) => ({ e, ...textScore(e), rank: (models.length - i) * 0.75 })).filter((x) => x.score >= 3)
        .sort((a, b) => (b.score + b.rank) - (a.score + a.rank))[0]?.e ?? models.find((e) => e.id === fallback) ?? models[0];
    // Words an example is about, and proper nouns (capitalised mid-goal: "San Francisco"), are not
    // things the library lacks.
    const covered = new Set(byText.slice(0, 2).flatMap((x) => x.hits));
    // ...and they are not unmatched either: the vocabulary has no entry, but an example does.
    // Place names (a city or a country the maps know) are the goal's data, not missing features.
    let places = null;
    try { const m = loadMaps(); places = new Set([...m.cities.flatMap((c) => c.name.toLowerCase().split(/\s+/)), ...m.countries110.flatMap((c) => c.name.toLowerCase().split(/\s+/))]); } catch {}
    r.unmatched_terms = r.unmatched_terms.filter((w) => !covered.has(w) && !(places && places.has(w)));
    const proper = new Set(String(goal).split(/\s+/).slice(1).filter((w) => /^[A-Z][a-z]/.test(w)).flatMap((w) => normalizeWords(w)));
    // The layout model is an example too, ahead of the capability picks (models fetch what the
    // kit lists); max_examples still holds, the weakest capability picks go first.
    if (model && !kit.some((k) => k.e.id === model.id)) {
        kit.splice(kit.filter((k) => k.about).length, 0, { e: model, covers: [], value: 0, layout: true });
        while (kit.length > Math.max(max_examples, 2)) {
            const i = kit.map((k, j) => [k, j]).reverse().find(([k]) => !k.about && !k.layout)?.[1];
            if (i === undefined) break;
            kit.splice(i, 1);
        }
    }
    // A second chosen structure brings its own starting example.
    for (const s of pickedAll.slice(1)) {
        const e = s.examples.map((id) => C.examples.find((x) => x.id === id)).find(Boolean);
        if (e && !kit.some((k) => k.e.id === e.id)) kit.push({ e, covers: [], value: 0, about: [`the ${s.id} part`] });
    }
    // ...nor words a returned component stands for (its synonyms: "waxing" for MoonPhase).
    for (const c of comps) for (const syn of c.synonyms ?? []) normalizeWords(syn).forEach((w) => covered.add(w));
    // ...nor a word that only qualifies a style ("a moonrise-style label" asks for a label).
    // (Unless the qualifier names a drawing: "a hypnogram-like chart" asks for a hypnogram.)
    for (const m of String(goal).toLowerCase().matchAll(/([a-z]+)[- ](?:style|like|ish|esque|inspired|themed)\b/g)) {
        const w = normalizeWords(m[1])[0];
        if (w && !/(gram|graph|chart|meter|gauge|map|scope|plot|diagram)$/.test(w)) covered.add(w);
    }
    // An event, a state or a quantity (a season, a solstice, a delivery step, a streak) is
    // computed or written, not drawn: not a component to write.
    const NOT_DRAWN = new Set(["season", "seasons", "solstice", "equinox", "sunrise", "sunset", "holiday", "anniversary", "birthday",
        "deadline", "delivery", "delivered", "shipped", "ordered", "dispatched", "tracker", "tracking", "streak", "streaks", "stage", "stages",
        "status", "state", "eta", "forecast", "trend", "goal", "goals", "target", "targets", "record", "records", "average", "averages"]);
    // And only a word that names something VISUAL is a component to write: a shape, a symbol,
    // an instrument, a picture (a moon, a needle, a hypnogram); a label, a quantity or a data
    // field (a coin, a pollutant, an email, a bill) is text or a component's parameter.
    const VISUAL = new Set(["icon", "icons", "symbol", "symbols", "glyph", "logo", "logos", "picture", "pictures", "illustration", "drawing",
        "diagram", "sketch", "shape", "shapes", "figure", "figures", "avatar", "badge", "badges", "gauge", "gauges", "dial", "dials", "needle",
        "meter", "meters", "ring", "rings", "arc", "arcs", "wheel", "wheels", "compass", "thermometer", "barometer", "speedometer", "odometer",
        "bottle", "glass", "cup", "mug", "battery", "signal", "wifi", "bluetooth", "cloud", "clouds", "sun", "moon", "star", "stars", "planet",
        "earth", "globe", "map", "maps", "flag", "flags", "heart", "hearts", "arrow", "arrows", "pointer", "hand", "hands", "needle", "drop",
        "drops", "raindrop", "snowflake", "flame", "fire", "leaf", "leaves", "tree", "trees", "flower", "plant", "wave", "waves", "curve",
        "curves", "path", "paths", "pattern", "patterns", "grid", "ruler", "scale", "slider", "knob", "knobs", "switch", "toggle", "button",
        "chart", "charts", "graph", "graphs", "plot", "plots", "sparkline", "histogram", "hypnogram", "timeline", "calendar", "clock",
        "watch", "face", "hourglass", "timer", "stopwatch", "bar", "bars", "donut", "pie", "swatch", "swatches", "palette", "spectrum",
        "gradient", "silhouette", "skyline", "car", "bus", "train", "plane", "airplane", "bike", "ship", "rocket", "house", "building",
        "door", "window", "lock", "key", "bell", "envelope", "phone", "laptop", "camera", "lamp", "bulb", "candle", "medal", "trophy",
        "crown", "shield", "target", "crosshair", "radar", "waveform", "equalizer", "vu"]);
    const visual = (w) => VISUAL.has(w) || /(gram|graph|chart|meter|gauge|map|scope|icon)$/.test(w);
    if (process.env.KIT_DEBUG) console.error(`[kit] byText top: ${byText.slice(0, 2).map((x) => `${x.e.id}[${x.hits.join(" ")}]`).join(" ")}`);
    if (process.env.KIT_DEBUG) for (const w of r.unmatched_terms) console.error(`[kit] ${w}: covered=${covered.has(w)} proper=${proper.has(w)} generic=${generic(w)} not_drawn=${NOT_DRAWN.has(w)} visual=${visual(w)}`);
    let needs = needsComponent({ ...r, unmatched_terms: r.unmatched_terms.filter((w) => !covered.has(w) && !proper.has(w) && !generic(w) && !NOT_DRAWN.has(w) && visual(w)) }, C);
    // Not for generic words, nor for what a returned component already shows (an icon of a
    // clock next to the AnalogClock component).
    const icons = suggestIcons(goal, r, new Set([...normalizeWords(goal).filter((w) => generic(w)), ...covered]));
    // A word an icon shows is not a component to write ("wifi" in a status bar).
    if (needs && icons?.suggestions?.length) {
        const shown = new Set(icons.suggestions.flatMap((x) => normalizeWords(x.for)));
        needs.terms = needs.terms.filter((w) => !shown.has(w));
        if (!needs.terms.length) needs = null;
    }
    // Suggested icons are drawn with the Icon component: list it with its call and params.
    if (icons?.suggestions.length && !comps.some((c) => c.name === "Icon")) {
        const icon = componentSummary("Icon");
        if (icon) comps.push(icon);
    }
    return {
        resolved: { capabilities: [...needed], use_cases: r.use_cases, form_factors: r.form_factors,
                    components: r.components, matched: r.matched },
        unmatched_terms: r.unmatched_terms,
        // (Search words and gallery pointers help nobody who has the component already.)
        components: comps.map(({ synonyms, gallery, ...c }) => ({ ...c, ...(c.demo ? { demo: { how: c.demo.how } } : {}) })),
        examples: kit.map((k) => ({ ...summarizeExample(k.e, { matched: k.covers, compact: true }), contributes: k.covers,
            ...(k.about ? { about: `the goal's subject: ${k.about.join(", ")}` } : {}),
            ...(k.layout ? { about: "the layout model: structure the screen like this" } : {}) })),
        ...(model ? { layout_model: {
            id: model.id, title: model.title, folder: model.folder,
            // The whole document, so a first draft needs no further call (a long one: get it).
            ...((() => { try { const d = JSON.stringify(exampleDoc(model)); return d.length <= 16000 ? { document: d } : {}; } catch { return {}; } })()),
            why: "Structure the screen like this: layout components (column, row, text, library components) for the " +
                 "structure and every text, a canvas only for a drawing, values computed in the document. get it for the full JSON.",
        } } : {}),
        ...(shape ? { structure: { id: shape.structure.id, is: shape.structure.is, adapts: shape.structure.adapts,
            ...(template ? { template, use: `${template} (see its entry in components) is a short call with the adaptive layout built in. Rows are named objects. For rows that cannot be tapped pass readOnly: true so they all fit at small sizes (a cut list says "+N more"); tappable rows keep 48 dp and scroll; a check list is check: true. Sliders that tell the app their value (onRelease) cross-talk in a scrolling list, on devices too: use your own non-scrolling column for those.` } : {}),
            ...(pickedAll.length > 1 ? { also: pickedAll.slice(1).map((s) => ({ id: s.id, is: s.is, adapts: s.adapts })) } : {}),
            ...(chosen ? {} : { note: "This is only a guess from the words, right about 70% of the time. Read structures below: if another fits the request better, call build_kit again with structure: its id, for its example and components." }) } } : none ? {} : { structure: { note: "No guess from the words. Read structures below and call build_kit again with structure: the id that fits the request." } }),
        structures: structureMenu((id) => C.examples.some((e) => e.id === id)),
        // Looks are not a feature to find an example of: theme colours give them all.
        not_covered: [...[...remaining].filter((c) => c !== "theme.mode"), ...(CALENDAR_MATH.test(goal) ? ["calendar arithmetic: no example, but recipes in reference expressions (Calendar arithmetic): an app date as an EPOCH DAY with today's epoch day from year() and dayOfYear(), days until/since, dates N days away, week numbers, month names"] : []),
            ...(TEXT_ENTRY.test(goal) ? ["text entry: the format has NO keyboard input — see the design rule \"Text entry is the app's\""] : [])],
        ...(needs ? { needs_component: needs } : {}),
        ...(icons ? { icons } : {}),
        design: designRules(goal, r, needed),
        next_steps: [
            needs ? `Write the component(s) in needs_component first and check_component each with a sweep until every rendered state is right.` : null,
            CALENDAR_MATH.test(goal) ? "Week numbers, month lengths, leap years and dates N days away are formulas in `reference expressions` (Calendar arithmetic): compute them as named variables from dayOfYear()/weekDay()/dayOfMonth(), then check with render clocks at year and month boundaries." : null,
            "Assemble one document structured like layout_model (components for layout and text, canvases only for drawings): library and inline component calls, the examples' techniques, values computed in the document rather than pasted.",
            "convert it with looks and sizes (or check: true): it returns the contact sheet of those renders, which is what the document looks like now (look at it; no separate render of the same sizes), and audits it (it flags glyph icons, repeated subtrees, hard-coded dates and colours).",
            "If it has controls (taps, sliders, a pager), inspect {\"task\": \"controls\"} (rc-inspect: try_controls) tries each once from a fresh start and reports what it changed and what looks wrong: one call, not an interact per control.",
            "Components expand automatically in every tool.",
        ].filter(Boolean),
    };
}

/**
 * Icons for the goal: Material Symbols matching its content words (the matched terms and the
 * unmatched ones), so a symbol on screen is an {"Icon": ...} call, not a glyph or a drawing.
 */
// Words about the document's qualities, not things on screen: an icon for them is noise (a
// wheelchair for "accessible", a lamp for the "light" theme).
const NOT_ICON_TERMS = /^(platform|platforms|local|local time|difference|home screen|home screen widget|widget|widgets|compact|accessible|accessibility|mono|monochrome|theme|themes?d?|light|dark|open|opens|zero|cap|capped|large|small|count|counts|unread|summary|state)$/i;
const ICONS_FOR = { transit: ["directions_bus", "train", "tram"], departure: ["departure_board", "schedule"], arrival: ["departure_board", "schedule"], delay: ["schedule", "warning"], delayed: ["schedule", "warning"] };
function suggestIcons(goal, r, skip) {
    let out = [];
    // Content words only (not filler, not stopwords), and an icon whose NAME has the word: a
    // tag-only match is noise ("how" -> how_to_reg, "many" -> groups).
    // A term is skipped when every word of it is (a phrase "analog clock" next to AnalogClock).
    const skipped = (t) => { const ws = normalizeWords(t); return ws.length > 0 && ws.every((w) => (skip ?? new Set()).has(w)); };
    const terms = [...new Set([...r.unmatched_terms, ...r.matched.map((m) => m.term)])]
        .filter((t) => t.length > 2 && !STOP.has(t) && !skipped(t) && !NOT_ICON_TERMS.test(t));
    try {
        for (const t of terms) {
            const words = normalizeWords(t);
            // A subject whose icon has another name (no icon is named "transit" that shows one).
            if (ICONS_FOR[words.join(" ")]) continue;   // listed below, whatever the term
            if (words.join(" ") === "home" && /\bhome ?screen\b/i.test(goal)) continue;   // where it goes, not what it shows
            const hit = findIcons({ query: t, limit: 6 }).icons.map((i) => i.name)
                // The icon is named after the word (moon, moon_stars), not merely containing it
                // (shield_moon): a word inside a compound name names something else.
                .filter((n) => words.some((w) => { const p = n.split("_")[0]; return singular(p) === w || p.startsWith(w) || singular(n) === w; }))
                .concat(findIcons({ query: t, limit: 6 }).icons.map((i) => i.name)
                    // A name ending in the word (potted_plant) when none starts with it.
                    .filter((n) => words.some((w) => { const ps = n.split("_"); return ps.length === 2 && singular(ps[1]) === w; })))
                .filter((n, i, arr) => arr.indexOf(n) === i)
                .slice(0, 3);
            if (hit.length) out.push({ for: t, icons: hit });
        }
    } catch { return undefined; }   // no icon catalog on this install
    const said = new Set(normalizeWords(goal));
    const subjects = Object.entries(ICONS_FOR).filter(([w]) => said.has(w)).map(([w, icons]) => ({ for: w, icons }));
    return {
        suggestions: [...subjects, ...out].slice(0, 8),
        how: "Every symbol on screen (status, action, navigation, category) is {\"Icon\": {\"name\": ...}} (style outlined|rounded|sharp, filled for a selected state, size, color, label). find kind \"icons\" searches 4,157 Material Symbols by meaning.",
    };
}

// Reference screens laid out with components, with a drawing in a canvas and values computed
// from the clock: the default layout_model when no better-matching one exists.
const LAYOUT_MODELS = ["TIM-12", "TIM-13", "TIM-11", "TIM-08", "TIM-10", "TIM-14", "CMP-05", "CMP-08", "LAY-14", "CMP-12", "CMP-14", "CMP-15"];

// Examples that teach drawing a shape from a value, for a component the library lacks.
const DRAWING_KIT = ["DRW-01", "DRW-02", "DRW-06", "DRW-12", "EXP-06"];
// Library components to model a new one on: a value-driven drawing, a family of pictograms.
const MODEL_COMPONENTS = ["ProgressRing", "WeatherIcon", "Gauge"];

/**
 * The words of the goal that nothing in the catalog or library stands for. When one names
 * something to show (an object, a symbol, a quantity: a moon phase, a wind arrow, a tide), the
 * model must draw it, and a component is how to draw it once, correctly, and check it: the
 * failure this prevents is a text glyph (◐) or N hand-pasted canvases, one of them wrong.
 */
function needsComponent(r, C) {
    const terms = r.unmatched_terms.filter((w) => w.length > 2);
    if (!terms.length) return null;
    const pick = (ids) => ids.map((id) => C.examples.find((e) => e.id === id)).filter(Boolean)
        .map((e) => ({ id: e.id, title: e.title, folder: e.folder }));
    return {
        terms,
        why: `Nothing in the catalog or the component library stands for: ${terms.join(", ")}. If one of ` +
             "them is something to SHOW (an object, a symbol, a state or quantity such as a phase or a level), " +
             "draw it with a component you define, not a text glyph (◐ ☾ ★ ☀) and not a canvas pasted once per use.",
        recipe: [
            "First check whether an icon already shows it (find kind \"icons\"; a static symbol needs no new component). Otherwise name the component after the thing (MoonPhase, WindArrow). Its params are what varies, normalised: a fraction 0..1 for anything cyclic or partial (phase, level, progress), an angle in degrees, an enum for discrete kinds; plus size and color with theme defaults (@colors.*).",
            "Draw in a fixed unit box (e.g. 0..100) and scale to the size once; derive every coordinate from the params with expressions, so one definition serves every value. Prefer circles, arcs, clips and pathExpression over SVG path strings.",
            "Work out the geometry of each regime separately before writing it: the ranges of the param where the shape changes kind (which side is filled, whether a curve bulges in or out, which half of a cycle it is, below or above a threshold). Write down what each regime must look like, then express the switch with step()/ifElse (see EXP-06).",
            "check_component with sweep: {param, values} covering both ends, the midpoints and both halves of anything cyclic (e.g. phase 0, .125, .25, ..., .875). Compare every cell of the contact sheet with what the thing really looks like; fix and repeat until all are right.",
            "Define it once under the document's top-level `components` and call it wherever it appears (every day cell, the hero, the legend), passing the computed value.",
        ],
        learn_from: {
            examples: pick(DRAWING_KIT),
            components: MODEL_COMPONENTS.filter((n) => C.library.components.has(n)),
            guide: "component_authoring_guide",
        },
    };
}

// Phrases that mean the content depends on the current date or time.
const NOW_WORDS = /\b(today|tonight|now|current|this (day|week|month|year)|next (week|month)|upcoming|calendar|month|week|daily|weekly)\b/;
// Words for a status that depends on the current time.
const LIVE_WORDS = /\b(right now|now|current(?:ly)?|rising|falling|next|upcoming|remaining|left|until|countdown|live|in progress|status)\b/;
// Words for a quantity worth a visual.
const QUANTITY_WORDS = /\b(percentages?|latency|uptime|calories?|kcal|macros?|grams?|protein|carbs?|fat|steps?|distance|percent|progress|levels?|phases?|usage|scores?|ratings?|budgets?|battery|temperatures?|speed|counts?|stats?|trends?|history|remaining|left|curves?|charts?|graphs?|tides?|over time|hourly|daily)\b/;

/** Design rules for this goal: when to use which capability, not only how. */
function designRules(goal, r, needed) {
    const g = String(goal).toLowerCase();
    const rules = [
        { rule: "Show meaning with drawing, not characters", how: "A symbol (status, action, navigation, category) is an Icon ({\"Icon\": {\"name\": \"wifi\"}}; see icons, and find kind \"icons\"); a visual that depends on a value (a phase, a level, a progress) is a library component or one you define (see needs_component). Never text glyphs or emoji (◐ ★ ☀ ✓): they render inconsistently, can't be themed, sized or animated, and are usually approximations." },
        { rule: "Repeat by definition, not by copy", how: "A cell, row or tile that appears N times is one inline component (top-level `components`) or a loop, called with its value. N pasted copies are large and drift: one wrong copy goes unnoticed." },
        { rule: "Theme colours", how: "Use @colors.* (and the library's components) so light, dark and mono (always-on, e-ink) work; literal hex colours lock one look. The theme's colours: background, surface, surfaceHigh, onSurface, muted, outline, track, primary, onPrimary, secondary, success, warning, error, disabled, onDisabled; numbers (@theme.*): space_1..4, radius_sm/md/lg, text_sm/md/lg/xl, control_height, stroke." },
        { rule: "Switch content by state", how: "A state a stateLayout, an expression or a TextChoice reads is a float variable: all three can read a float, and the last two read an integer variable as 0. A screen with phases (work / break, playing / paused, empty / loaded) switches what it shows from a variable, never by rebuilding: a word from an index is a TextChoice; two alternatives are two children with a visibility modifier each (\"@isBreak\" and \"1 - @isBreak\"; an integer 0/1), stacked in a box so the layout does not move; a whole layout per state is a stateLayout node ({\"stateLayout\": {\"indexId\": \"@phase\", \"children\": [...]}}, a format node, not a component: LAY-15); a state colour is two coloured copies switched by visibility (LAY-12), a host colour the app sets, or (json2rc) a computed colour in resources.colors — {\"hsv\": [h, s, v]} or {\"argb\": [a, r, g, b]} from variables. A hidden alternative takes no taps and no space." },
        { rule: "Adapt rather than retype", how: "When an example is close, do not write it out: convert {\"from_example\": \"CMP-15\", \"set\": {\"stop\": \"Central\"}, \"edits\": [{\"old\": ..., \"new\": ...}], \"looks\": [...], \"sizes\": [...], \"samples\": [...]} copies it on the server and changes only what you send; old is matched in the document as shown here, ignoring whitespace between tokens." },
        { rule: "Check it all in one call", how: "convert the document once with its whole check: {\"json\": ..., \"looks\": [\"light\", \"dark\", \"mono-dark\", \"mono-light\"], \"sizes\": [[320, 160], [160, 160]], \"samples\": [{\"count\": 0}, {\"name\": \"A very long name\"}, {\"$tap\": \"Save\", \"$wait\": 1, \"$expect\": {\"saved\": 1}}, {\"$drag\": [40, 48, 240, 48], \"$expect\": {\"other\": 50}}]}. It returns the contact sheets, findings, audit warnings, what a screen reader announces, the tap targets, whether the players agree and the repaint verdict: no separate audit or inspect calls. Every look runs at every size, every data case and tap in the first look. Then send only each change, convert {\"json_path\": ..., \"edits\": [{\"old\": ..., \"new\": ...}]}: the same check comes back with just the pictures that changed. Rewriting the whole document each time is the slowest part of building one. When nothing is wrong it says NO FAULTS FOUND and writes the full contact sheet. Faults it cannot see remain, so look at the pictures; then stop." },
        { rule: "Syntax you will need", how: "A text the app sets: {\"variable\": {\"name\": \"stop\", \"vtype\": \"string\", \"value\": \"Central\", \"export\": true}} first in root, read as \"@stop\". A number the app sets: resources.variables {\"n\": {\"value\": 3, \"export\": true}}. step(x, edge) is 1 when x > edge, 0 at equality, so x >= 3 for whole numbers is step(x, 2.5). ifElse(a, b, c) is b when c > 0, else a. A variable must not share a name with a function (round, min, step): it silently breaks them. Visibility takes a declared variable holding exactly 0 or 1 (never a function written in the modifier or passed through a param): {\"visibility\": \"@shown\"} with shown = \"step(@n, 0.5)\". A word picked by an index: {\"TextChoice\": {\"items\": [\"Clear\", \"Rain\"], \"index\": \"@i\"}}, inside a box for modifiers. Joining text: {\"type\": \"textMerge\", \"id1\": \"Line \", \"id2\": \"@line\"}. textFromFloat TRUNCATES (102.9996 at 2 decimals shows 102.00): round the value first, round(@x * 100) / 100. A padding list is [horizontal, vertical]. In a column a height share is verticalWeight, not weight. Modifiers apply in order: clip, background, then padding." },
        { rule: "Light, dark and mono come from the theme", how: "With @colors.* every look exists already: no theme switch to write and no colour overrides to test with. Check them with render looks. To ship them: convert with componentTheme \"all\" makes ONE file (to show mono the host sets the theme.mono float AND the mono colours as named colours, so a separate file is simpler); mono-dark or mono-light makes a file for that look." },
        { rule: "Adapt to the size, including smaller", how: `In a row or column with a weighted child, separate the children with spacer boxes, not spacedBy (the gaps overflow). A widget is resized by the host, often smaller than designed. Fill the width and scale drawings to their box (componentWidth()/componentHeight()); when the height shrinks, drop the least important content first, or switch to a compact layout. Alternatives that hold TEXT switch with a stateLayout on the window, by size and never by content ({\"stateLayout\": {\"indexId\": \"@layout\", ...}} with layout = \"step(windowWidth(), 300) + step(windowHeight(), 140)\"; LAY-15), or one layout whose row count and sizes are computed from windowWidth() and windowHeight() (CMP-15): a fitBox measures a text's whole one-line width, so a long name from the app can blank every alternative; a fitBox suits fixed-size alternatives without long text (its first child that fits is shown; LAY-09) — or at minimum put the content in a verticalScroll. Dropping content: {"box": {"modifiers": ["fillMaxSize", {"padding": 16}], "children": [{"collapsibleColumn": {"modifiers": ["fillMaxSize"], "horizontalAlignment": "start", "verticalArrangement": "top", "children": [title, main, {"text": {..., "modifiers": [{"collapsiblePriority": {"orientation": "vertical", "priority": 2}}]}}, ...]}}]}} — padding on the wrapping box (collapsibleColumn ignores its own), alignment start (it centres by default), the lowest priority is dropped first, children without one are dropped last, only when they don't fit on their own (LAY-13, LAY-14). A weighted child (a chart with weight) is never dropped and absorbs the shortage first, so nothing else goes: give it a fixed height instead of a weight (a weight does not combine with heightIn), and let the optional lines carry the priorities. Check with render variants (it includes a short size and reports overflow).` },
    ];
    if (NOW_WORDS.test(g) || needed.has("time.date") || needed.has("time.clock")) rules.push({
        rule: "Compute dates from the clock",
        how: "\"this month\", \"today\", \"now\": the month name, its number of days, the weekday of the 1st, today's highlight and anything derived (a moon phase, a countdown) are expressions over the time variables, so the document stays right tomorrow and next month. Don't paste values computed offline, and don't state precise data (event times) you cannot compute or source.",
    });
    // The form is a watch (not a widget that shows a watch's battery).
    if (/\b(watch ?(tile|face)|wear ?os|complication|always[- ]on|(for|on) (a|the|my) watch)\b/.test(g)) rules.push({
        rule: "A watch is round and small",
        how: "A watch tile or face is drawn on a round screen of 160-220 dp: keep the content inside the inscribed circle (a centred square of 0.7 × min(windowWidth(), windowHeight()), or ring-shaped content around it), size everything from the window (not fixed dp), keep one number big and the rest minimal, and give the always-on (mono) look as much care as the colour one. Render at 160×160, 192×192 and 220×220 and at a rectangular widget size; a stateLayout indexed by the aspect (\"step(windowWidth(), windowHeight() * 1.3)\") can switch between the round and the wide layout.",
    });
    // Controls: what a tap changes outside the document must reach the app.
    if (/\b(switch(es)?|toggles?|buttons?|taps?|tappable|sliders?|scrub|controls?|lock|unlock|play|pause|settings?|form|check ?marks?|checkbox(es)?|check (it )?off|tick( off)?|to-?do|habit|stopwatch|laps?|start|stop|tracker|track|log|counter|count up|intake|add (a|one)|\+1)\b/.test(g)) rules.push({
        rule: "Taps reach the app",
        how: "A control that changes something outside the document (a light, a lock, playback) keeps its state in an exported variable AND sends the app a hostNamedAction on each tap ({\"onClick\": [{\"type\": \"valueFloatExpressionChange\", \"target\": \"@on\", \"value\": \"1 - @on\"}, {\"type\": \"hostNamedAction\", \"name\": \"kitchenLight\"}]}; INT-08): an exported variable alone only lets the app read a value. Library Button/IconButton/ListItem take the same list in their onClick param; Switch, Checkbox, Chip, Rating, Stepper and Tabs run their own flip first and then the extra actions you pass in onClick (get the component for its params). Give each control its own action name (a shared name is registered only by the first control tapped). Declare the numbers the app sets in resources.variables with export: true, and check every tap with inspect interact (host_actions and changed_host_variables). Exactly one of a set selected (tip chips, a theme choice, tabs): one exported index variable (\"@tip\" = 0, 1, 2); each option's tap sets it with valueFloatChange to its own index and sends its own action; each option's selected look and state read \"step(0.5, abs(@tip - k))\"-style values declared in resources (1 when chosen).",
    });
    if (TEXT_ENTRY.test(g)) rules.push({
        rule: "Text entry is the app's",
        how: "A RemoteCompose document cannot take keyboard input. A field is a display the app fills: a box showing a host string (\"@email\", or its placeholder when empty — keep a host float with the length, an expression cannot read a string), with a tap that sends a hostNamedAction (\"editEmail\") so the app opens its own input and sends the typed text back as the host string. A password is masked by the app (send \"•••••••\"). Give each field a semantics label (\"Email, empty\" / its value). A submit button enabled by the content takes a runtime enabled (Button's enabled accepts a variable). A NUMBER the user sets (an amount, a count) can stay in the document: a Stepper (+/−, its value exported), preset Chips, or a slider for display — or the app's own numeric input via a tapped field.",
    });
    if (/\b(colou?r picker|hue|saturation|lightness|brightness of the colou?r|rgb|hsl|hsv|swatch|tint)\b/.test(g)) rules.push({
        rule: "Compute the colour",
        how: "A colour that follows values (a picker's preview, a tint) is a computed colour in resources.colors: {\"preview\": {\"hsv\": [\"@hue\", \"@sat\", \"@val\"]}} (h, s, v in 0..1; or {\"argb\": [a, r, g, b]}), used as \"@colors.preview\"; it re-evaluates when the variables change, and follows a Slider live while dragging (the expander moves it after the slider) as long as nothing before the slider reads it. HSL is not native: V = L + S·min(L, 1 − L), S_v = 2·(1 − L / V). Slider tracks can show the range as a gradient drawn on a canvas. In mono the preview has no colour: show the values as text too.",
    });
    // A list of rows from host values (departures, appointments, a queue).
    if (/\b(departures?|arrivals?|bus(es)?|trains?|transit|schedule|timetable|upcoming|queue|next \d+|agenda|appointments?|rows? of)\b/.test(g)) rules.push({
        rule: "Rows from the app",
        how: "N rows the app fills: per slot host values (a host string per text, a float per number), a slot marked empty by a sentinel (-1) and hidden by visibility on a declared 0/1 variable, \"No more …\" when all are hidden; minutes until a time later today are computed from timeInMin() with a midnight wrap ((t - timeInMin() + 1440) % 1440); an instant that can be days away or in another zone (a flight, a deadline) is sent as an epoch-day number plus UTC minute of the day, and the time left is (@day - epochDay) * 1440 + @utcMin - utcNow, with utcNow = timeInMin() - offsetToUtc() / 60 (reference query: epoch day). Make each row ONE spoken item: a LabelValue (or a canvas with one contentDescription) instead of separate texts. A colour the app sends (a line badge) needs its text colour sent too (onLine): onPrimary is the theme's and may not contrast with it.",
    });
    rules.push({
        rule: "Sample values show the design",
        how: "(Values relative to the clock — departures at 08:55 — are populated only near that time: pin the clock in your checks, and expect render variants' \"seven hours later\" to show the empty state.) The document's default values are what every preview, gallery and first render shows: pick values that show the design populated and typical — a bill already entered, two laps recorded, three of eight items done, a mid-range level — not the empty or zero state. Check the empty state too (render samples), but do not ship it as the default.",
    });
    if (LIVE_WORDS.test(g)) rules.push({
        rule: "Compute what depends on now",
        how: "\"right now\", \"current\", \"rising or falling\", \"next\", \"in 2 h\": the status, the next event, the current value " +
            "and a chart's now marker are expressions of the clock (timeInMin(), dayOfMonth()...) and the data, so they stay right " +
            "as the day goes on. Data that comes from outside (a forecast, a schedule) is exported host variables or arrays; the " +
            "live parts are computed from it, never typed in. A word that follows a value (a phase name, \"Rising\"/\"Falling\", a weekday) is a TextChoice ({\"TextChoice\": {\"items\": [...], \"index\": \"@i\"}}): a layout text can't take textSubtext/textLookup. Joined to other text in one line (\"Waning gibbous, 57% lit\"), compute the word in a canvas global block and textMerge it (TIM-11). Render with variants to see another time of day.",
    });
    // A reading with a right range (moisture, humidity, temperature for a plant or a room): too
    // low and too high are both bad, which the usual gauge zones (green to red as it rises) get wrong.
    if (/\b(moisture|humidity|ideal|comfort|optimal|in range|too (dry|wet|low|high|cold|hot))\b/.test(g)) rules.push({
        rule: "A right range, not a rising alarm",
        how: "A reading that is wrong on both sides (soil moisture 40-70 %, humidity, a room temperature) is a Gauge with the band: {\"value\": \"@moisture\", \"bandLo\": \"@lo\", \"bandHi\": \"@hi\"} draws the band on the track, the value green inside and amber outside, and in mono a filled dot inside and a hollow one outside. Without bandLo/bandHi its zones go green → amber → red as the value rises (bone dry would read green). Add the word under it (\"Too dry\" / \"OK\" / \"Too wet\") by step() on both edges.",
    });
    // E-ink: black on white, still, refreshed rarely.
    if (/\b(e-?ink|e-?paper|eink|epaper|black and white|reflective|kindle)\b/.test(g)) rules.push({
        rule: "E-ink is mono-light",
        how: "An e-ink screen is the mono-light look: set componentTheme \"mono-light\" (white paper, black text and strokes, one grey #616161, no motion) and check it there. Large type, no animation, no fills that ghost. Date values alone never repaint: to flip at midnight read timeInMin() (a minute check, pixels unchanged) or let the app redraw (reference: Repaint). Check the panel's exact sizes with render sizes ([[800, 480], [480, 800], [296, 128]]).",
    });
    // Exact decimals: the format's own formatter drops a digit on ordinary values.
    if (/\b(money|prices?|costs?|pay|payments?|bills?|budget|tips?|totals?|currency|convert|converter|dollars?|euros?|cents?|\$|€|£)\b/.test(g)) rules.push({
        rule: "Print exact decimals from whole numbers",
        how: "textFromFloat with 2 decimals prints every x.97 as x.96 ($19.97 reads $19.96), and values under 0.001 as garbage (0.000621 reads 0.210001), on every player including Android, and no check can see it. For an amount shown to the cent, compute a local \"cents\": \"round(@v * 100)\", then join {\"type\": \"textMerge\", \"id1\": {\"type\": \"textFromFloat\", \"value\": \"floor(@cents / 100)\", \"whole\": 9, \"decimal\": 0, \"flags\": 21}, \"id2\": {\"type\": \"textMerge\", \"id1\": \".\", \"id2\": {\"type\": \"textFromFloat\", \"value\": \"@cents % 100\", \"whole\": 2, \"decimal\": 0, \"flags\": 12}}}. Floats hold about 7 digits, so this is exact up to about 50,000.",
    });
    // Scaled quantities (a recipe, a converter): amounts read as cooks write them.
    if (/\b(recipe|ingredients?|servings?|portions?|scal(e|es|ing))\b/.test(g)) rules.push({
        rule: "Amounts read like a cook writes them",
        how: (process.env.RC_HIDE_BATCH ? "" : "Use ScaledAmount: {\"amount\": 240, \"factor\": \"@servings / 4\", \"unit\": \"g\", \"step\": 5}, or format \"fraction\" for cups and spoons (about 1.5 KB a call, so quarters or plain numbers in a long list). Otherwise: ") + "A scaled amount = base × servings / baseServings, formatted by kind (a host number per ingredient: 0 count, 1 volume, 2 weight, 3 \"a pinch\"): volumes snap to eighths — whole = floor(a + 1/16), the fraction index round((a - whole) × 8) picks \"\" ⅛ ¼ ⅜ ½ ⅝ ¾ ⅞ with a TextChoice (⅓/⅔ from thirds when closer); grams round to 5 above 20; \"a pinch\" never scales; the unit is a host string per ingredient (singular/plural by step(a, 1)). Steps that can be checked off are Checkbox rows (the label wraps); a struck-through done step is two texts switched by visibility.",
    });
    // Time zones: the format knows UTC, not a city's offset.
    if (/\b(world ?clock|time ?zones?|timezones?|utc|gmt|local time in|time difference)\b/.test(g)) rules.push({
        rule: "Time zones come from the app",
        how: "The document knows UTC: utcMin = timeInMin() - offsetToUtc() / 60 (minutes of the day, offsetToUtc() in seconds). It has no time-zone database, so each city's offset is a host float the app sends in minutes, daylight saving included (London 0 or 60, New York -300 or -240, Sydney 600 or 660): local = (utcMin + @offLondon + 1440) % 1440, hour = floor(local / 60), minute = local % 60; the day differs when utcMin + offset leaves 0..1440 (\"+1 day\"). offsetToUtc() is the device's own offset (local minus UTC, in seconds: +32400 in Tokyo), so the difference from the user's time is (@offCity - offsetToUtc() / 60) / 60 hours (London seen from Tokyo: -9). A half-hour zone (India, +330) needs the minutes too. Day or night by the local hour (sunrise ~6-18) or a WorldMap night shade.",
    });
    // Maps: the WorldMap component and the $map building blocks.
    if (/\b(maps?|world|countr(y|ies)|continent|europe|asia|africa|america|lat(itude)?|lon(gitude)?|time ?zones?|geograph\w*|where in the world|flight|route)\b/.test(g) && /\b(maps?|world|time ?zones?|countr(y|ies)|where|flight|route|clock)\b/.test(g)) rules.push({
        rule: "Maps are built in",
        how: "A map is the WorldMap component: {\"WorldMap\": {\"region\": \"world\" | \"Europe\" | \"FRA\" | [lonMin, latMin, lonMax, latMax], \"detail\": \"low\", \"borders\": true, \"highlight\": [\"FRA\"], \"cities\": [\"Tokyo\"], \"labels\": true}}. What changes at run time: countries coloured from a host array (\"values\": \"@visited\", \"valueCountries\": [...] in the array's order, MAP-04), any number of points from host arrays (\"pointsLon\"/\"pointsLat\", MAP-05), a great-circle route with a plane at a progress (\"routeFrom\": \"Paris\", \"routeTo\": \"Singapore\", \"progress\": \"@p\"), state borders (\"states\": [\"AUS\"]), the night side (\"night\": true) and one marker (\"markLon\"/\"markLat\"). map_info {region} lists the countries (the values order), the height and how coarse the outlines are: the data suits a continent or a country, not a city. Your own canvas: {\"$map\"} (\"outline\": true for a stroked coast), {\"$mapHeight\"}, {\"$mapPoint\"}, {\"$mapRoute\"} (MAP-03), scaled by ONE factor and clipped (reference: Maps). Keep detail low on widgets (a world of land is ~6 KB).",
    });
    // Pages of laid-out content (onboarding, a carousel): a page variable, buttons and a swipe.
    if (/\b(onboarding|pager|pages?|carousel|walkthrough|tutorial|swipe|slides?)\b/.test(g)) rules.push({
        rule: "Pages are a page variable",
        how: "Laid-out pages are a float @page (resources.variables, exported so the app can read it) and one box per page shown by visibility on on0 = \"1 - min(1, abs(@page - 0))\" (declared variables, exactly 0/1), with a stateLayout or animated visibility for the fade. Next / Skip are onClick valueFloatExpressionChange on @page (plus a hostNamedAction to tell the app). A swipe on laid-out content: on the page's container {\"onTouchDown\": [{\"type\": \"valueFloatExpressionChange\", \"target\": \"@pxStart\", \"value\": \"touchX()\"}]} and {\"onTouchUp\": [{\"type\": \"valueFloatExpressionChange\", \"target\": \"@page\", \"value\": \"clamp(0, N - 1, @page + clamp(-1, 1, round((@pxStart - touchX()) / (0.5 * windowWidth()))))\"}]} — it changes on release; a touch-tracking (TouchExpression) variable cannot drive a layout's visibility. PagerDots shows the position; announce \"Page 2 of 3\". Check with inspect interact: {\"drag\": [300, 300, 60, 300]}.",
    });
    // A visual explanation: a drawing that changes per step, with captions and controls.
    if (/\b(explain\w*|teach\w*|lesson|tutorial|how (it|an?|the) \w+ works?|step[- ]by[- ]step|visual(ly)? (guide|explanation)|proof|demonstrat\w*)\b/.test(g)) rules.push({
        rule: "An explanation is a drawing driven by a step",
        how: (process.env.RC_HIDE_BATCH ? "" : "Use StepExplainer for a new explainer: {\"StepExplainer\": {\"step\": \"@at\", \"eased\": \"@e\", \"steps\": [{\"title\": \"..\", \"text\": \"..\"}], \"slots\": {\"visual\": [your canvas]}}}: it adapts to size and takes progress, controls, frame and computed steps as params. See CMP-27, CMP-28 and CMP-29. Otherwise: ") + "Use the Walkthrough component for the frame: {\"Walkthrough\": {\"titles\": [...], \"texts\": [...], \"step\": \"@step\", \"shown\": \"@stepNow\", \"eased\": \"@stepEased\", \"autoplay\": true, \"slots\": {\"content\": [your canvas]}}} — Back/Next (48 dp), play/pause, \"Step 2 of 5\" announced with the caption. Draw the explanation yourself in the content slot reading @stepEased (it eases 0.6 s between steps): part k appears with clamp(0, 1, @stepEased - k), moves with lerp(a, b, that), fades by paint alpha. A continuous animation inside a step reads animationTime() (repaints every frame while shown: keep it to the step that needs it). Interactive parameters are Sliders writing variables the drawing reads. Do not declare stepNow/stepEased in resources (the component writes them).",
    });
    // A QR or barcode: no generator in the format; a placeholder is a drawn pattern.
    if (/\b(qr|barcode|bar code|scan code)\b/.test(g)) rules.push({
        rule: "A QR code is a drawing",
        how: "The format has no QR generator: a placeholder is a canvas in a framed square — three finder squares (7×7 modules: outer ring, inner 3×3) in three corners and a fixed pseudo-random module grid (a loop over a 21×21 or 25×25 grid drawing a square where a hash like (i*7 + j*13 + i*j) % 5 < 2), black on white in EVERY look (scanners need it; keep it out of mono-dark's lit area budget only if it is not meant to be scanned). A real code is an image the app supplies (a bitmap resource it sets) or a path it sends.",
    });
    // Always-on (ambient) screens: almost black, few lit pixels, one repaint a minute.
    if (/\b(always[- ]on|ambient|aod|low[- ]power|monochrome|mono)\b/.test(g)) rules.push({
        rule: "Always-on is mono-dark",
        how: "An always-on face or tile is the mono-dark look: build it with componentTheme \"mono-dark\" (black background, white ink, one grey, no motion) and check it there first. Light up few pixels (thin weights 200-300, outlines not fills, no large filled areas), show no seconds and read only timeInMin() / the date so it repaints once a minute (inspect runtime says so), and keep it still. DigitalClock and AnalogClock already drop their seconds in mono. A battery level is a host float the watch app exports (batteryLevel() does not exist on Android).",
    });
    // A level where LOW is the alarm (battery, fuel, charge, storage left): Gauge's default
    // zones turn amber then red as the value RISES, so a full battery would read as an alert.
    if (/\b(battery|batteries|fuel|charge|charging|range|remaining|left in)\b/.test(g) && /\b(arc|gauge|dial|ring|meter)\b/.test(g)) rules.push({
        rule: "Low is the alarm",
        how: "A battery, fuel or charge level is bad when LOW. A Gauge's zones go green → amber → red as the value rises, so give it the band instead: {\"value\": \"@battery\", \"bandLo\": 20, \"bandHi\": 100} (green above 20 %, amber below, a hollow dot in mono), or draw a ProgressRing in @colors.error under the threshold. Say the low state in words too (\"Low battery\").",
    });
    // Today's curve so far (production, usage, steps): drawn up to now, the rest of the day empty.
    if (/\b(today'?s?|so far|production|consumption|usage)\b/.test(g) && /\b(curve|chart|graph|line|production)\b/.test(g)) rules.push({
        rule: "Today's curve stops at now",
        how: "A curve over today is drawn up to now with LineChart's upTo (the sample index of now, e.g. \"(timeInMin() - 300) / 30\" for 30-min samples from 05:00): the line and its area stop there, the axis still spans the day, the min/max dots consider the drawn part. Pass the whole day's array (future slots 0) with y_min/y_max set; never push future samples below the plot.",
    });
    // Turn-by-turn navigation: the arrows are Material icons, picked by the direction code.
    if (/\b(navigation|turn[- ]by[- ]turn|next turn|directions?|route)\b/.test(g)) rules.push({
        rule: "Turn arrows are icons",
        how: "Draw the next turn with the Material icons turn_left, turn_right, turn_slight_left, turn_slight_right, turn_sharp_left, turn_sharp_right, straight, u_turn_left, u_turn_right, roundabout_left, roundabout_right, merge, fork_left, fork_right (find_icons \"turn\"), one Icon per direction code shown by visibility on eq(@turn - k), or a stateLayout over the code. The distance as \"800 m\" / \"1.2 km\" / \"Now\" by step() on the metres.",
    });
    // A quantity against a target (calories, a budget, a goal) is often past it.
    if (/\b(target|goal|budget|limit|quota|vs\.?|against)\b/.test(g)) rules.push({
        rule: "Show the overshoot",
        how: "A value against a target goes past it (31 % over the calories, a category over its budget): a bar shows it with ProgressBar {\"progress\": \"@spent / max(@limit, 0.01)\", \"overshoot\": true} — the bar rescales, a tick marks the limit and the excess is an @colors.error segment (hatched in mono). ProgressRing clamps at a full ring: for a ring past its target use ActivityRings (a second lap) or MeterBreakdown (the ring with its parts). Always add a computed \"N over\" text (step(@v, @target) switches \"N left\" / \"N over\") — then check it with render samples at 0, at the target and over it.",
    });
    if (QUANTITY_WORDS.test(g)) rules.push({
        rule: "Give quantities a visual",
        how: "A value with a range or a meaning (percent, level, phase, trend) gets a drawing: ProgressBar, ProgressRing, Gauge, Sparkline, BarChart, LineChart (a value over time, or a curve computed from the clock: tide, temperature, sun), or your own component; the number as text is secondary.",
    });
    rules.push({
        rule: "Look before answering",
        how: "Render the document and look at it; for every component you wrote, check_component with a sweep over its parameter range. Check the states a user will reach (other days, other values, light and dark), not only the first render.",
    });
    return rules;
}

export function componentSummary(name) {
    const C = loadCatalog();
    const def = C.library.components.get(name);
    if (!def) return null;
    const gallery = C.examples.find((e) => e.kind === "gallery" && (e.components ?? []).includes(name));
    return {
        name, summary: def.summary, capabilities: def.capabilities ?? [],
        params: Object.fromEntries(Object.entries(def.params ?? {}).map(([k, p]) => [k, p])),
        slots: def.slots ?? {}, call: def.call ?? null, pitfalls: def.pitfalls ?? [],
        synonyms: C.vocab.components?.[name]?.synonyms ?? [],
        gallery: gallery ? { id: gallery.id, title: gallery.title, folder: gallery.folder } : null,
        demo: C.demos.has(name)
            ? { folder: C.demos.get(name).folder, prompt: C.demos.get(name).prompt, bytes: C.demos.get(name).derived?.bytes,
                java_identical: C.demos.get(name).derived?.java_identical,
                how: `get {"id": "${name}", "parts": ["demo_json"]} returns the demo document calling it (every param in use); parts ["render"] its PNGs` }
            : null,
    };
}

export function findComponents({ query = "", capabilities = [], limit = 10 } = {}) {
    const C = loadCatalog();
    const r = resolveTerms(query);
    const caps = new Set([...r.capabilities, ...expandCapIds(capabilities, C)]);
    const words = r.unmatched_terms;
    const scored = [...C.library.components.keys()].map((name) => {
        const s = componentSummary(name);
        let score = 0;
        const why = [];
        if (r.components.includes(name)) { score += 5; why.push("named or a synonym"); }
        const capHits = s.capabilities.filter((c) => caps.has(c));
        if (capHits.length) { score += 2 * capHits.length; why.push(`covers ${capHits.join(", ")}`); }
        const blob = ` ${normalizeWords([name, s.summary, ...s.synonyms].join(" ")).join(" ")} `;
        const hits = words.filter((w) => blob.includes(` ${w}`));
        if (hits.length) { score += hits.length; why.push(`mentions ${hits.join(", ")}`); }
        return { s, score, why };
    }).filter((x) => x.score > 0 || (!query && !capabilities.length))
      .sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name));
    // A listing with no query is the whole library: names only, every one (a run asked for the
    // list and got 10 of 35 with no word about the rest).
    if (!query && !capabilities.length) return { unmatched_terms: [], total: scored.length, components: scored.map((x) => ({ name: x.s.name, summary: x.s.summary })) };
    return { unmatched_terms: words, total: scored.length, components: scored.slice(0, limit).map((x) => ({ ...x.s, why: x.why })),
        ...(scored.length > limit ? { more: `${scored.length - limit} more match: pass a larger limit, or no query for the whole library (names only)` } : {}) };
}

export function listCapabilities({ prefix = "", query = "", with_counts = true } = {}) {
    const C = loadCatalog();
    // A query (words or a sentence) narrows the list to the capabilities its terms resolve to,
    // and says how they resolved; a page of loosely matched vocabulary helps nobody.
    const resolved = query ? resolveTerms(query) : null;
    const arr = (x) => (Array.isArray(x) ? x : [...(x ?? [])]);
    const wanted = resolved ? new Set(arr(resolved.capabilities)) : null;
    const caps = Object.entries(C.vocab.capabilities)
        .filter(([id]) => id.startsWith(prefix) && (!wanted || wanted.has(id))).map(([id, c]) => {
        const row = { id, label: c.label, synonyms: c.synonyms, evidence: c.evidence };
        if (with_counts) {
            row.examples = C.examples.filter((e) => exampleCaps(e).primary.includes(id)).map((e) => e.id);
            row.also_in = C.examples.filter((e) => exampleCaps(e).secondary.includes(id)).length;
        }
        return row;
    });
    if (resolved) {
        return {
            query, matched: resolved.matched, unmatched_terms: resolved.unmatched_terms,
            capabilities: caps,
            ...(arr(resolved.use_cases).length ? { use_cases: arr(resolved.use_cases) } : {}),
            ...(arr(resolved.components).length ? { components: arr(resolved.components) } : {}),
            ...(caps.length ? {} : { note: "No capability matches these words. Try find kind \"examples\" with the request as written, or kind \"terms\"." }),
        };
    }
    return {
        capabilities: caps,
        use_cases: Object.keys(C.vocab.use_cases), form_factors: Object.keys(C.vocab.form_factors),
        components: [...C.library.components.keys()].sort(),
        examples: C.examples.length,
    };
}

/**
 * Material Symbols icons for a query: name words, Google's search tags and categories, most
 * popular first among equal scores. Each result carries its call snippet.
 */
export function findIcons({ query = "", category, limit = 12 } = {}) {
    const c = loadIconCatalog();
    // Only the emptiest words: "like", "show" or "new" are meaningful icon queries.
    const ICON_STOP = new Set(["a", "an", "the", "of", "for", "with", "and", "or", "to", "icon", "icons"]);
    const words = String(query).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !ICON_STOP.has(w));
    const stem = (w) => singular(w);
    const q = words.map(stem);
    const scored = [];
    for (const icon of c.icons) {
        if (category && !(icon.categories ?? []).some((x) => x.toLowerCase() === String(category).toLowerCase())) continue;
        const nameWords = icon.name.split("_").map(stem);
        const tags = (icon.tags ?? []).map((t) => t.toLowerCase());
        const tagWords = new Set(tags.flatMap((t) => t.split(/[^a-z0-9]+/)).map(stem));
        let score = 0;
        if (q.length && icon.name === q.join("_")) score += 10;
        for (const w of q) {
            if (nameWords.includes(w)) score += 2;
            else if (tagWords.has(w)) score += 1.5;
        }
        if (q.length > 1 && tags.includes(words.join(" "))) score += 3;
        if (!q.length) score = 1;
        // Popularity (Google's usage count, median ~240, max ~180k) as up to ~4.4 points: a
        // common icon tagged with the word ("favorite" for heart) beats a rare one named with it.
        if (score > 0) scored.push({ icon, score: score + Math.log10(1 + (icon.popularity ?? 0)) / 1.2 });
    }
    scored.sort((a, b) => b.score - a.score || (b.icon.popularity ?? 0) - (a.icon.popularity ?? 0));
    return {
        count: scored.length,
        icons: scored.slice(0, limit).map(({ icon }) => ({
            name: icon.name, categories: icon.categories ?? [], tags: (icon.tags ?? []).slice(0, 12),
            styles: icon.styles, filled: (icon.fills ?? []).length > 1,
            call: { Icon: { name: icon.name } },
        })),
        usage: "Call {\"Icon\": {\"name\": ...}} (style outlined|rounded|sharp, filled, size, color, label); see get Icon.",
    };
}

/** The examples whose own doc.json defines a component of this name (a Panel of their own). */
export function examplesDefining(name) {
    return loadCatalog().examples.filter((e) => inlineComponents(e).includes(name)).map((e) => e.id);
}
