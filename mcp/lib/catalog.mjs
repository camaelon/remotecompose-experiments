// The example catalog (examples/catalog.json, built by examples/tools/build.mjs) and its
// vocabulary (docs/examples-vocabulary.json): term resolution, ranking and kit building for
// the rc-examples server. Phase 1 of docs/EXAMPLES_TAXONOMY.md, "The retrieval tool":
// deterministic, tags and synonyms only, every pick explained.

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLibrary, loadIconCatalog } from "./components.mjs";
import { designAudit } from "./design-audit.mjs";

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
        .split(/\s+/).filter(Boolean).map(singular);
}
function singular(w) {
    // Not plurals: this, status, bus, analysis, canvas, gps.
    if (w.length <= 3 || !w.endsWith("s") || /(ss|is|us|as|ps)$/.test(w) || w.includes(".")) return w;
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

export function summarizeExample(e, { matched = [] } = {}) {
    const snippets = (e.snippets ?? []).filter((s) => !matched.length || matched.includes(s.shows));
    return {
        ...(canvasOnly(e) ? { structure: "canvas", structure_note: CANVAS_NOTE } : {}),
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
    // Words too generic to name a subject ("current", "today", "screen").
    const GENERIC = new Set(["current", "today", "time", "screen", "app", "page", "view", "data", "value", "values", "info", "information", "smart", "make", "can", "adjust"]);
    const goalWords = normalizeWords(goal).filter((w) => w.length > 2 && !STOP.has(w) && !GENERIC.has(w));
    const textScore = (e) => {
        const t = ` ${normalizeWords(e.title ?? "").join(" ")} `, k = ` ${normalizeWords((e.keywords ?? []).join(" ")).join(" ")} `,
              p = ` ${normalizeWords(e.prompt ?? "").join(" ")} `;
        const hits = goalWords.filter((w) => t.includes(` ${w}`) || k.includes(` ${w}`) || p.includes(` ${w}`));
        const score = goalWords.reduce((n, w) => n + (t.includes(` ${w}`) ? 2 : 0) + (k.includes(` ${w}`) ? 1.5 : 0) + (p.includes(` ${w}`) ? 1 : 0), 0);
        return { hits, score };
    };
    // Not promoted: examples that knowingly show an anti-pattern (an expected design finding:
    // a fixed date, glyph stars); a canvas-only demo counts for less than a laid-out screen.
    const DESIGN_CODES = new Set(["hardcoded_date", "glyph_icon", "absolute_layout", "fixed_coordinates", "text_anchor"]);
    const byText = C.examples.filter((e) => e.kind !== "gallery" && !(e.expect_findings ?? []).some((c) => DESIGN_CODES.has(c)))
        .map((e) => { const t = textScore(e); return { e, ...t, score: t.score * (canvasOnly(e) ? 0.6 : 1) }; })
        // Two of the goal's words, or one in the title: a single shared word in passing ("target"
        // in a touch-target example for a thermostat's target) is not the subject.
        .filter((x) => x.score >= 3 && (new Set(x.hits).size >= 2
            || (goalWords.length <= 3 && goalWords.some((w) => ` ${normalizeWords(x.e.title ?? "").join(" ")} `.includes(` ${w} `)))))
        .sort((a, b) => b.score - a.score);
    for (const x of byText.slice(0, 2)) {
        if (kit.some((k) => k.e.id === x.e.id) || kit.length >= max_examples + 1) continue;
        kit.unshift({ e: x.e, covers: [], value: x.score, about: x.hits });
    }
    // The goal's own subject first, best match first; then the capability picks, simplest first.
    kit.sort((a, b) => (b.about ? 1 : 0) - (a.about ? 1 : 0) || (a.about && b.about ? b.value - a.value : 0) || a.e.level - b.e.level);
    // How to structure the screen: the best-matching example that is laid out with components
    // (not a canvas-only demo), else the reference app layout.
    const model = byText.find((x) => !canvasOnly(x.e) && (x.e.level ?? 1) >= 3)?.e
        ?? LAYOUT_MODELS.map((id) => C.examples.find((e) => e.id === id)).find(Boolean);
    // Words an example is about, and proper nouns (capitalised mid-goal: "San Francisco"), are not
    // things the library lacks.
    const covered = new Set(byText.slice(0, 2).flatMap((x) => x.hits));
    const proper = new Set(String(goal).split(/\s+/).slice(1).filter((w) => /^[A-Z][a-z]/.test(w)).flatMap((w) => normalizeWords(w)));
    const needs = needsComponent({ ...r, unmatched_terms: r.unmatched_terms.filter((w) => !covered.has(w) && !proper.has(w) && !GENERIC.has(w)) }, C);
    const icons = suggestIcons(goal, r);
    // Suggested icons are drawn with the Icon component: list it with its call and params.
    if (icons?.suggestions.length && !comps.some((c) => c.name === "Icon")) {
        const icon = componentSummary("Icon");
        if (icon) comps.push(icon);
    }
    return {
        resolved: { capabilities: [...needed], use_cases: r.use_cases, form_factors: r.form_factors,
                    components: r.components, matched: r.matched },
        unmatched_terms: r.unmatched_terms,
        components: comps,
        examples: kit.map((k) => ({ ...summarizeExample(k.e, { matched: k.covers }), contributes: k.covers,
            ...(k.about ? { about: `the goal's subject: ${k.about.join(", ")}` } : {}) })),
        ...(model ? { layout_model: {
            id: model.id, title: model.title, folder: model.folder,
            why: "Structure the screen like this: layout components (column, row, text, library components) for the " +
                 "structure and every text, a canvas only for a drawing, values computed in the document. get it for the full JSON.",
        } } : {}),
        not_covered: [...remaining],
        ...(needs ? { needs_component: needs } : {}),
        ...(icons ? { icons } : {}),
        design: designRules(goal, r, needed),
        next_steps: [
            needs ? `Write the component(s) in needs_component first and check_component each with a sweep until every rendered state is right.` : null,
            "Assemble one document structured like layout_model (components for layout and text, canvases only for drawings): library and inline component calls, the examples' techniques, values computed in the document rather than pasted.",
            "rc-render.validate and render_rc it, look at the image, and rc-inspect.audit it (it flags glyph icons, repeated subtrees, hard-coded dates and colours).",
            "Components expand automatically in every tool.",
        ].filter(Boolean),
    };
}

/**
 * Icons for the goal: Material Symbols matching its content words (the matched terms and the
 * unmatched ones), so a symbol on screen is an {"Icon": ...} call, not a glyph or a drawing.
 */
function suggestIcons(goal, r) {
    let out = [];
    const terms = [...new Set([...r.unmatched_terms, ...r.matched.map((m) => m.term)])].filter((t) => t.length > 2);
    try {
        for (const t of terms) {
            const hit = findIcons({ query: t, limit: 3 }).icons.map((i) => i.name);
            if (hit.length) out.push({ for: t, icons: hit });
        }
    } catch { return undefined; }   // no icon catalog on this install
    return {
        suggestions: out.slice(0, 8),
        how: "Every symbol on screen (status, action, navigation, category) is {\"Icon\": {\"name\": ...}} (style outlined|rounded|sharp, filled for a selected state, size, color, label). find kind \"icons\" searches 4,157 Material Symbols by meaning.",
    };
}

// Reference screens laid out with components, with a drawing in a canvas and values computed
// from the clock: the default layout_model when no better-matching one exists.
const LAYOUT_MODELS = ["TIM-12", "TIM-11", "CMP-05", "CMP-08"];

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
// Words for a quantity worth a visual.
const QUANTITY_WORDS = /\b(percent|progress|levels?|phases?|usage|scores?|ratings?|budgets?|battery|temperatures?|speed|counts?|stats?|trends?|history|remaining|left)\b/;

/** Design rules for this goal: when to use which capability, not only how. */
function designRules(goal, r, needed) {
    const g = String(goal).toLowerCase();
    const rules = [
        { rule: "Show meaning with drawing, not characters", how: "A symbol (status, action, navigation, category) is an Icon ({\"Icon\": {\"name\": \"wifi\"}}; see icons, and find kind \"icons\"); a visual that depends on a value (a phase, a level, a progress) is a library component or one you define (see needs_component). Never text glyphs or emoji (◐ ★ ☀ ✓): they render inconsistently, can't be themed, sized or animated, and are usually approximations." },
        { rule: "Repeat by definition, not by copy", how: "A cell, row or tile that appears N times is one inline component (top-level `components`) or a loop, called with its value. N pasted copies are large and drift: one wrong copy goes unnoticed." },
        { rule: "Theme colours", how: "Use @colors.* (and the library's components) so light, dark and mono (always-on, e-ink) work; literal hex colours lock one look. The theme's colours: background, surface, surfaceHigh, onSurface, muted, outline, track, primary, onPrimary, secondary, success, warning, error, disabled, onDisabled; numbers (@theme.*): space_1..4, radius_sm/md/lg, text_sm/md/lg/xl, control_height, stroke." },
        { rule: "Adapt to the size", how: "Fill the width, scale drawings to their box (componentWidth()/componentHeight()), and check a narrow and a wide render." },
    ];
    if (NOW_WORDS.test(g) || needed.has("time.date") || needed.has("time.clock")) rules.push({
        rule: "Compute dates from the clock",
        how: "\"this month\", \"today\", \"now\": the month name, its number of days, the weekday of the 1st, today's highlight and anything derived (a moon phase, a countdown) are expressions over the time variables, so the document stays right tomorrow and next month. Don't paste values computed offline, and don't state precise data (event times) you cannot compute or source.",
    });
    if (QUANTITY_WORDS.test(g)) rules.push({
        rule: "Give quantities a visual",
        how: "A value with a range or a meaning (percent, level, phase, trend) gets a drawing: ProgressBar, ProgressRing, Gauge, Sparkline, BarChart, or your own component; the number as text is secondary.",
    });
    rules.push({
        rule: "Look before answering",
        how: "Render the document (render_rc) and look at it; for every component you wrote, check_component with a sweep over its parameter range. Check the states a user will reach (other days, other values, light and dark), not only the first render.",
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
