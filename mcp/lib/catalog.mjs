// The example catalog (examples/catalog.json, built by examples/tools/build.mjs) and its
// vocabulary (docs/examples-vocabulary.json): term resolution, ranking and kit building for
// the rc-examples server. Phase 1 of docs/EXAMPLES_TAXONOMY.md, "The retrieval tool":
// deterministic, tags and synonyms only, every pick explained.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "./components.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
export const EXAMPLES_DIR = process.env.RC_EXAMPLES_DIR ?? path.join(ROOT, "examples");
const VOCAB_PATH = process.env.RC_EXAMPLES_VOCAB ?? path.join(ROOT, "docs", "examples-vocabulary.json");

const STOP = new Set(["a", "an", "the", "and", "or", "with", "of", "for", "to", "in", "on", "that", "it",
    "my", "me", "some", "show", "showing", "make", "build", "create", "want", "need", "like", "using",
    "use", "which", "when", "from", "by", "as", "at", "is", "be", "can", "should", "one", "two", "into"]);

let cache = null;

/** Lower case; - _ / and spaces equivalent; a trailing plural s dropped from each word. */
export function normalizeWords(s) {
    return String(s).toLowerCase().replace(/[-_/]+/g, " ").replace(/[^a-z0-9.+ ]+/g, " ")
        .split(/\s+/).filter(Boolean).map(singular);
}
function singular(w) {
    if (w.length <= 3 || !w.endsWith("s") || w.endsWith("ss") || w.includes(".")) return w;
    if (/(ch|sh|x|z|ss)es$/.test(w)) return w.slice(0, -2);   // switches, boxes
    if (/[^aeiou]ies$/.test(w)) return w.slice(0, -3) + "y";  // entries
    return w.slice(0, -1);
    return w;
}

/** The catalog, vocabulary, component library and phrase index, reloaded when a file changes. */
export function loadCatalog() {
    const catPath = path.join(EXAMPLES_DIR, "catalog.json");
    const stamp = [catPath, VOCAB_PATH].map((p) => (existsSync(p) ? statSync(p).mtimeMs : 0)).join(":");
    if (cache && cache.stamp === stamp) return cache;
    const vocab = JSON.parse(readFileSync(VOCAB_PATH, "utf8"));
    const catalog = existsSync(catPath) ? JSON.parse(readFileSync(catPath, "utf8")) : { examples: [] };
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
                } else if (!STOP.has(w) && !/^\d+$/.test(w)) out.unmatched_terms.push(w);
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

export function summarizeExample(e, { matched = [] } = {}) {
    const snippets = (e.snippets ?? []).filter((s) => !matched.length || matched.includes(s.shows));
    return {
        id: e.id, folder: e.folder, title: e.title, summary: e.summary, level: e.level, family: e.family,
        kind: e.kind ?? "example",
        capabilities: e.capabilities, use_cases: e.use_cases, form_factor: e.form_factor,
        components: e.derived?.components ?? [],
        ...((e.components ?? []).some((c) => !(e.derived?.components ?? []).includes(c))
            ? { hand_built: (e.components ?? []).filter((c) => !(e.derived?.components ?? []).includes(c)) } : {}),
        teaches: e.teaches, pitfalls: e.pitfalls,
        snippets: snippets.map((s) => ({ ...s, json: snippetJson(e, s.pointer) })),
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
    return cur ?? null;
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

/** The smallest set of examples (greedy set cover) that together demonstrate the goal. */
export function buildKit({ goal = "", capabilities = [], max_examples = 4 } = {}) {
    const C = loadCatalog();
    const r = resolveTerms(goal);
    const needed = new Set([...r.capabilities, ...expandCapIds(capabilities, C)]);
    // Components first: a goal that names a component gets its call, not a hand-drawn copy.
    const comps = r.components.map((n) => componentSummary(n)).filter(Boolean);
    for (const c of comps) for (const cap of c.capabilities ?? []) needed.delete(cap);
    const kit = [];
    const remaining = new Set(needed);
    const pool = [...C.examples];
    while (remaining.size && kit.length < max_examples) {
        let best = null;
        for (const e of pool) {
            const { primary, secondary } = exampleCaps(e);
            const covers = [...remaining].filter((c) => primary.includes(c) || secondary.includes(c));
            if (!covers.length) continue;
            const useBonus = (r.use_cases.some((u) => (e.use_cases ?? []).includes(u)) ? 0.5 : 0)
                + (r.form_factors.includes(e.form_factor) ? 0.5 : 0);
            const value = (covers.length + useBonus) / (1 + 0.25 * (e.level ?? 1));
            if (!best || value > best.value || (value === best.value && (e.derived?.op_count ?? 0) < (best.e.derived?.op_count ?? 0))) {
                best = { e, covers, value };
            }
        }
        if (!best) break;
        best.covers.forEach((c) => remaining.delete(c));
        pool.splice(pool.indexOf(best.e), 1);
        kit.push(best);
    }
    kit.sort((a, b) => a.e.level - b.e.level);
    return {
        resolved: { capabilities: [...needed], use_cases: r.use_cases, form_factors: r.form_factors,
                    components: r.components, matched: r.matched },
        unmatched_terms: r.unmatched_terms,
        components: comps,
        examples: kit.map((k) => ({ ...summarizeExample(k.e, { matched: k.covers }), contributes: k.covers })),
        not_covered: [...remaining],
        next_steps: "Copy the snippets (and component calls) into one document, then rc-render.validate, " +
                    "render_rc and rc-inspect.audit it. Components expand automatically in every tool.",
    };
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
                java_identical: C.demos.get(name).derived?.java_identical }
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
    return { unmatched_terms: words, components: scored.slice(0, limit).map((x) => ({ ...x.s, why: x.why })) };
}

export function listCapabilities({ prefix = "", with_counts = true } = {}) {
    const C = loadCatalog();
    const caps = Object.entries(C.vocab.capabilities).filter(([id]) => id.startsWith(prefix)).map(([id, c]) => {
        const row = { id, label: c.label, synonyms: c.synonyms, evidence: c.evidence };
        if (with_counts) {
            row.examples = C.examples.filter((e) => exampleCaps(e).primary.includes(id)).map((e) => e.id);
            row.also_in = C.examples.filter((e) => exampleCaps(e).secondary.includes(id)).length;
        }
        return row;
    });
    return {
        capabilities: caps,
        use_cases: Object.keys(C.vocab.use_cases), form_factors: Object.keys(C.vocab.form_factors),
        components: [...C.library.components.keys()].sort(),
        examples: C.examples.length,
    };
}
