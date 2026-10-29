// The component library (docs/EXAMPLES_TAXONOMY.md, "Component templates"): reusable
// components such as Button, Switch or Gauge, defined once in
// examples/components/<Name>/component.json and invoked by name from any document:
//
//   { "Button": { "label": "Save", "onClick": { ... }, "slots": { "icon": [ ... ] } } }
//   { "type": "Button", "label": "Save" }                      // the same call
//
// `expandComponents` turns such a document into plain RemoteCompose JSON, which json2rc and
// the Java parser both accept ("expand" mode). Inside a component's body:
//   "@param"            the argument, whatever its JSON type (a whole-string reference)
//   "... @param ..."    inside an expression: a number, a "@variable" or a parenthesised
//                       expression, spliced into the text. A `string` (or `enum`) param is
//                       text and is spliced as written: "Decrease @label" -> "Decrease guests"
//                       (one bound to a runtime "@variable" cannot be joined into text: error)
//   a `variable` param  bound to the caller's "@variable", or, when not given (or given a
//                       number), to a fresh per-call variable starting at that number, else
//                       at `initial` (state the call owns)
//   "locals": {...}     names private to each call, used as "@name" in the body:
//       "count": 0                  a number (or {"value": 0, "anim": ...}): per-call state, a
//                                   variable declared in resources.variables under a unique name
//       "frac": "@value / @max"     an expression (or a {"$if"} choosing one) computed once per
//                                   call: substituted like the body (params, theme, earlier
//                                   locals), then a literal if it folds to a number, an alias if
//                                   it is one "@variable", else ONE float expression in
//                                   resources.variables that every use reads ("@frac * 240").
//                                   When it names something resources cannot see (a variable
//                                   declared in the tree, componentWidth()), each use gets the
//                                   parenthesised expression instead
//       "p": {"value": "@checked", "anim": 0.25}
//                                   an animated local: eases (standard cubic, `anim` seconds)
//                                   to the expression whenever it changes, at paint time. A
//                                   tree `variable` in the body (first in a canvas's commands
//                                   or the top container's children), read only below it;
//                                   mono writes the plain value (no motion)
//       "n": {"$count": "labels"}   the number of items of a static list param, a literal
//   "@colors.primary"   a theme colour, added to resources.colors unless the document
//                       defines it (which is how a document re-themes the library)
//   "@theme.radius_md"  a theme number, substituted as a literal; arithmetic on static
//                       numbers ("@size / 2", "clamp(0, 240, 0.72 * 240)", with min, max,
//                       abs, clamp and step) folds to a number
//   {"$slot": "icon"}   the call's slot content, spliced in (dropped when not given)
//   {"$each": "labels", "as": "label", "index": "i", "count": "n", "do": X}
//                       X repeated for each item of a static list param (or a count), with
//                       @label, @i and (when `count` is given) @n, the number of items
//   {"$if": "style == 'outlined'", "then": X, "else": Y}
//                       compile-time choice on `static` params (also `a != 'x'`, `a`, `!a`);
//                       `a` on a slot, or on a param bound to a "@variable", tests whether it was
//                       given; on a literal it tests the value ("" and 0 are false).
//                       "theme.mono" / "!theme.mono" test a theme number: the mono variant
// An optional param with no default, used as a whole value ("onClick": "@onClick"), drops
// the key it sits in, and the object around it if that leaves it empty.
//
// A document can also define its own components, next to header/resources/root:
//   { "components": { "PriceTag": { "params": {...}, "body": {...} } }, "root": ... }
// Each has the shape of a library component.json (the `component` name is the key) and is
// called the same way. A document definition wins over a library one of the same name. The
// `components` key is removed by the expansion. `lintComponent` checks a definition.
//
// How calls reach the wire: "componentMode" at the top of the document (removed), or in one
// call's args to override it there:
//   "expand"   every call is replaced by its body, as above
//   "pattern"  each call that can be is compiled to a definePattern template (written once, at
//              the head of a root array) and a call of it. Arguments, resolved per inflation:
//              numbers (a whole number goes through a float variable "_n2", since the parsers
//              read an integer argument as an id), "@variable"s (a bound `variable` param),
//              strings and text objects, colours ("#..." or "@colors.x", for `background`).
//              Written into the template instead: enum/static/bool/list params, $if branches,
//              $each, $count, theme numbers, actions, and any value no argument can carry.
//              Calls whose templates come out identical share one, so each static combination
//              used is a template of its own: Button__outlined_icon. Slots are patternArgument /
//              patternBlock; per-call state (an unbound `variable` param, a number local) is
//              a pattern local; a computed local is inlined at each use.
//              Where the format or a player mishandles a parameter (PATTERN_TRAPS; by default
//              DEFAULT_TRAPS: a colour outside `background`, and any text component (U7, a Java
//              runtime bug: on until the fix ships; "componentTraps" overrides), the value is
//              written in, or the call expands when even that can't work.
//   "auto"     (default) a variant used twice or more becomes a pattern only when the whole
//              document converts smaller that way (both are converted and measured).
// The result's `report` gives each variant's mode and why; `modes` sums it per component.
//
// Light, dark and mono: "componentTheme" at the top of the document (removed; the `theme`
// option overrides it) picks the palette the theme colours take (theme/default.json):
//   "auto"     (default) each theme colour as the theme gives it, {light, dark}: a themed colour
//              the player picks by the system theme (~100 B more than a plain one); one value
//              for both stays plain
//   "light"    / "dark": that side only, as plain colours ("dark" is the library's old look)
//   "mono"     always-on display and e-ink: the theme's modes.mono palette (black, white, one
//              grey) and numbers (@theme.mono is 1, so {"$if": "theme.mono"} picks each
//              component's mono variant), and no motion: every `anim` of an animated value and
//              every animationSpec modifier is removed (reported as `motion_removed`)
//   "mono-inverted"  the same for a reflective display (e-ink, a memory LCD): the theme's
//              modes.mono-inverted palette, the mono one with black and white swapped (dark
//              text and strokes on white); the same mono variants, no motion
// A document's own colour wins, in either form; it may add a `mono` value ({"light", "dark",
// "mono"} or {"value", "mono"}) and a `mono-inverted` one, and in mono (mono-inverted) a
// colour of a theme name without one takes that palette's value. The result's `theme` is the
// mode used.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LIBRARY_DIR = process.env.RC_COMPONENTS_DIR
    ?? path.join(HERE, "..", "..", "examples", "components");

const DROP = Symbol("drop");
let cached = null;

/** { components: Map<name, definition>, theme: {colors, numbers} } */
export function loadLibrary(dir = LIBRARY_DIR) {
    if (cached && cached.dir === dir) return cached;
    const components = new Map();
    if (existsSync(dir)) {
        for (const d of readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, d.name, "component.json");
            if (!d.isDirectory() || !existsSync(file)) continue;
            const def = JSON.parse(readFileSync(file, "utf8"));
            components.set(def.component, { ...def, dir: path.join(dir, d.name) });
        }
    }
    const themeFile = path.join(dir, "theme", "default.json");
    const theme = existsSync(themeFile) ? JSON.parse(readFileSync(themeFile, "utf8")) : { colors: {}, numbers: {} };
    cached = { dir, components, theme };
    return cached;
}

/** Whether `doc` defines components or calls any library component (walks the JSON once). */
export function usesComponents(doc, library = loadLibrary()) {
    if (localDefinitions(doc) || doc?.componentMode !== undefined || doc?.componentTheme !== undefined) return true;
    let found = false;
    walk(doc, (node) => { if (callOf(node, library)) found = true; });
    return found;
}

/** The document's own definitions ({Name: def} under a top-level `components`), or null. */
function localDefinitions(doc) {
    const c = doc?.components;
    return c && typeof c === "object" && !Array.isArray(c) && Object.keys(c).length ? c : null;
}

/** The library plus the document's own definitions (which win). */
function withLocal(library, local) {
    if (!local) return library;
    const components = new Map(library.components);
    for (const [name, def] of Object.entries(local)) {
        if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) throw new Error(`component name '${name}' must be PascalCase`);
        if (!def || typeof def !== "object" || def.body === undefined) throw new Error(`${name}: a definition needs a body`);
        components.set(name, { ...def, component: name, local: true });
    }
    return { ...library, components };
}

function walk(node, visit) {
    if (Array.isArray(node)) node.forEach((x) => walk(x, visit));
    else if (node && typeof node === "object") {
        visit(node);
        Object.values(node).forEach((v) => walk(v, visit));
    }
}

/** A component call's {name, args}, or null. Names are exact (PascalCase), so they never
 *  shadow the format's own lower-case components. */
function callOf(node, library, patterns = new Set()) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return null;
    if (typeof node.type === "string" && library.components.has(node.type) && !patterns.has(node.type)) {
        const { type, ...args } = node;
        return { name: type, args };
    }
    const keys = Object.keys(node);
    if (keys.length === 1 && library.components.has(keys[0]) && !patterns.has(keys[0])) {
        const v = node[keys[0]];
        return { name: keys[0], args: v && typeof v === "object" && !Array.isArray(v) ? v : {} };
    }
    return null;
}

/**
 * Compile every component call in `doc` (not modified) to plain RemoteCompose JSON. Returns
 * { doc, components: [names used, sorted], instances: n, mode, report, modes }:
 *   mode     the document's mode ("auto", "expand" or "pattern")
 *   report   one entry per component variant (and per call that could not be a pattern):
 *            { component, pattern (its definePattern name, or null), calls, mode, reason,
 *              bytes: { expand, pattern } when auto measured it }
 *   modes    { Component: "expand" | "pattern" | "mixed" }
 * Options: mode (overrides the document's "componentMode"), measure (doc -> bytes, used by
 * auto; the default converts with json2rc, without bitmap files), traps (the PATTERN_TRAPS
 * honoured, default all: leave one out once the players handle it).
 */
export function expandComponents(doc, { library = loadLibrary(), mode, theme, measure, traps } = {}) {
    const src = structuredClone(doc);
    // The traps honoured: the option, else the document's "componentTraps", else DEFAULT_TRAPS.
    traps ??= src.componentTraps ?? DEFAULT_TRAPS;
    delete src.componentTraps;
    for (const t of traps) if (!(t in PATTERN_TRAPS)) throw new Error(`componentTraps: unknown trap '${t}' (${Object.keys(PATTERN_TRAPS).join(", ")})`);
    const docMode = mode ?? src.componentMode ?? "auto";
    const themeMode = theme ?? src.componentTheme ?? "auto";
    delete src.componentMode;
    delete src.componentTheme;
    if (!MODES.includes(docMode)) throw new Error(`componentMode must be one of ${MODES.join(", ")}, not ${JSON.stringify(docMode)}`);
    library = withLocal(library, localDefinitions(src));
    delete src.components;
    const ctx = { library, traps: new Set(traps), docMode, theme: resolveTheme(library.theme, themeMode) };

    // The survey: every call expanded, and each one's pattern form compiled on the side.
    const survey = compileDoc(src, ctx, new Set());
    const variants = [...survey.variants.values()];
    const forced = new Set(variants.filter((v) => v.forced).map((v) => v.key));
    let chosen = new Set(forced);
    const bytes = new Map();
    if (docMode === "pattern") {
        for (const v of variants) chosen.add(v.key);
    } else if (docMode === "auto") {
        // Measure, don't guess: each variant used twice or more becomes a pattern only when
        // the whole document converts smaller that way (greedily, most-used first).
        measure ??= defaultMeasure;
        const size = (d) => { try { return measure(d); } catch { return Infinity; } };
        let best = size(chosen.size ? compileDoc(src, ctx, chosen).doc : survey.doc);
        for (const v of variants.filter((x) => x.calls >= 2 && !chosen.has(x.key)).sort((a, b) => b.calls - a.calls)) {
            const trial = new Set([...chosen, v.key]);
            const b = size(compileDoc(src, ctx, trial).doc);
            bytes.set(v.key, { expand: best, pattern: b });
            if (b < best) { chosen = trial; best = b; }
        }
    }
    const out = chosen.size ? compileDoc(src, ctx, chosen) : survey;

    const report = [];
    for (const v of variants) {
        const isPattern = chosen.has(v.key);
        const b = bytes.get(v.key);
        let reason;
        if (isPattern) {
            reason = v.forced && docMode !== "pattern" ? "componentMode: \"pattern\" on the call"
                : docMode === "pattern" ? "componentMode: \"pattern\""
                : `${v.calls} calls: ${b.pattern} B as a pattern, ${b.expand} B expanded`;
        } else if (docMode === "expand") reason = "componentMode: \"expand\"";
        else if (v.calls < 2) reason = "used once: a definition would only add bytes";
        else if (b) reason = b.pattern === Infinity ? "the pattern form did not convert" : `${v.calls} calls: ${b.pattern} B as a pattern, not smaller than ${b.expand} B expanded`;
        else reason = "not measured";
        report.push({ component: v.component, pattern: isPattern ? out.names.get(v.key) : null, calls: v.calls,
            mode: isPattern ? "pattern" : "expand", reason, ...(b ? { bytes: b } : {}), ...(v.demoted.length ? { static: v.demoted } : {}) });
    }
    for (const f of survey.fallbacks) report.push({ component: f.component, pattern: null, calls: f.calls, mode: "expand", reason: f.reason });
    const modes = {};
    for (const r of report) modes[r.component] = modes[r.component] && modes[r.component] !== r.mode ? "mixed" : r.mode;
    return { doc: out.doc, components: [...out.used].sort(), instances: out.instances, mode: docMode, theme: themeMode,
        ...(out.motion ? { motion_removed: out.motion } : {}), report, modes };
}

const MODES = ["auto", "expand", "pattern"];
export const THEME_MODES = ["auto", "light", "dark", "mono", "mono-inverted"];
/** Both monochrome modes: mono (light on black) and mono-inverted (dark on white). */
export const isMonoMode = (mode) => mode === "mono" || mode === "mono-inverted";

/**
 * The theme a document expands with, for one componentTheme:
 *   auto   every colour as the theme gives it: {light, dark} (a themed colour, picked by the
 *          player from the system theme), or one value for both
 *   light  / dark: that side of each colour, as a plain colour
 *   mono   the theme's modes.mono palette (plain colours) and numbers (@theme.mono is 1)
 *   mono-inverted  modes["mono-inverted"] (dark on white), its numbers (@theme.mono is 1 too)
 * Returns { mode, colors: {name: "#..." | {light, dark}}, numbers }.
 */
export function resolveTheme(theme = {}, mode = "auto") {
    if (!THEME_MODES.includes(mode)) throw new Error(`componentTheme must be one of ${THEME_MODES.join(", ")}, not ${JSON.stringify(mode)}`);
    const over = theme.modes?.[mode] ?? {};
    const colors = {};
    for (const [k, v] of Object.entries(theme.colors ?? {})) {
        const themed = v && typeof v === "object";
        if (over.colors?.[k] !== undefined) colors[k] = over.colors[k];
        else if (!themed) colors[k] = v;
        else if (mode === "light" || mode === "dark") colors[k] = v[mode];
        else if (mode === "mono") colors[k] = v.dark;
        else if (mode === "mono-inverted") colors[k] = v.light;
        else colors[k] = v.light === v.dark ? v.light : { light: v.light, dark: v.dark };
    }
    return { mode, colors, numbers: { ...(theme.numbers ?? {}), ...(over.numbers ?? {}) } };
}

/** resources.colors as [name, value] pairs, in either form ({name: v} or [{name: v} | {name, value}]). */
function colorEntries(colors) {
    if (!colors) return [];
    if (!Array.isArray(colors)) return Object.entries(colors);
    return colors.map((e) => (!("name" in e) && Object.keys(e).length === 1 ? Object.entries(e)[0] : [String(e.name), e.value]));
}

/**
 * The document's own colours for this theme mode. A value may be one colour, {light, dark}
 * (themed), and either may carry a `mono` value: {"light": .., "dark": .., "mono": ..} or
 * {"value": .., "mono": ..}. In mono a colour of the theme's name takes its `mono` value, else
 * the mono palette's (a brand colour does not survive a 1-bit display unless the document
 * says so); colours the theme does not name are kept. mono-inverted does the same with a
 * `mono-inverted` value and its own palette, and takes the light side of a themed colour.
 * light / dark take their side of a themed colour. The `mono` and `mono-inverted` keys never
 * reach the converter.
 */
function docColors(colors, theme) {
    const one = (name, v) => {
        const obj = v && typeof v === "object" && !Array.isArray(v);
        if (isMonoMode(theme.mode)) {
            if (obj && v[theme.mode] !== undefined) return v[theme.mode];
            if (theme.colors[name] !== undefined) return theme.colors[name];
        }
        if (!obj) return v;
        const { mono, "mono-inverted": monoInverted, ...rest } = v;
        if ("light" in rest && "dark" in rest) {
            if (theme.mode === "light" || theme.mode === "dark") return rest[theme.mode];
            if (theme.mode === "mono") return rest.dark;
            if (theme.mode === "mono-inverted") return rest.light;
            return rest;
        }
        return "value" in rest && Object.keys(rest).length === 1 ? rest.value : rest;
    };
    if (!Array.isArray(colors)) return Object.fromEntries(Object.entries(colors).map(([k, v]) => [k, one(k, v)]));
    return colors.map((e) => {
        if (!("name" in e) && Object.keys(e).length === 1) { const [k, v] = Object.entries(e)[0]; return { [k]: one(k, v) }; }
        return { ...e, value: one(String(e.name), e.value) };
    });
}

/** Mono (e-ink, always-on): no motion. Drops every `anim` of an animated value ({value, anim})
 *  and every animationSpec modifier, in the document and the expanded bodies; returns how many. */
function stripMotion(doc) {
    let n = 0;
    const visit = (node) => {
        if (Array.isArray(node)) {
            for (let i = node.length - 1; i >= 0; i--) {
                const x = node[i];
                const spec = x === "animationSpec" || (x && typeof x === "object" && !Array.isArray(x)
                    && ("animationSpec" in x || String(x.type ?? "").toLowerCase() === "animationspec") && Object.keys(x).length <= 2);
                if (spec) { node.splice(i, 1); n++; } else visit(x);
            }
        } else if (node && typeof node === "object") {
            for (const [k, v] of Object.entries(node)) {
                if (v && typeof v === "object" && !Array.isArray(v) && "anim" in v && "value" in v) {
                    delete v.anim; n++;
                    // {value, anim} without its anim is the plain value ({"alpha": "@selected"}).
                    if (Object.keys(v).length === 1 && (typeof v.value === "string" || typeof v.value === "number")) { node[k] = v.value; continue; }
                }
                visit(v);
            }
        }
    };
    visit(doc);
    return n;
}
let converter = null;
/** The bytes json2rc writes for a plain document (bitmap files are not read). */
function defaultMeasure(doc) {
    converter ??= createRequire(import.meta.url)(path.join(process.env.JSON2RC_DIR
        ?? path.join(HERE, "..", "..", "players", "typescript", "build-json2rc"), "Parser.js"));
    return converter.convert(doc).length;
}

/**
 * One compilation of the document: the variants in `patterns` (keys) become definePattern
 * templates and calls, every other call is expanded.
 */
function compileDoc(src, { library, traps, docMode, theme }, patterns) {
    const out = structuredClone(src);
    const existing = new Set();
    walk(out, (n) => {
        const t = String(n.type ?? "").toLowerCase();
        if (t === "definepattern" && n.name) existing.add(n.name);
        if (n.definePattern?.name) existing.add(n.definePattern.name);
    });
    // Names a resources.variables expression may refer to: the document's own resource
    // variables, then every local declared so far (they are written after them, in order).
    const docVars = out.resources?.variables;
    const resourceNames = new Set(Array.isArray(docVars)
        ? docVars.map((v) => v?.name ?? Object.keys(v ?? {})[0])
        : Object.keys(docVars ?? {}));
    // Every name the document refers to, so a pattern parameter never shadows one.
    const reserved = new Set(resourceNames);
    walk(out, (n) => { for (const v of Object.values(n)) if (typeof v === "string") for (const m of v.matchAll(/[@$]([A-Za-z_]\w*)/g)) reserved.add(m[1]); });
    const state = { library, theme, patterns: existing, counters: new Map(), used: new Set(), locals: {}, colors: new Set(), instances: 0, resourceNames,
        reserved, traps, docMode, chosen: patterns, variants: new Map(), fallbacks: new Map(), defs: new Map(), names: new Map(), hoisted: new Map() };
    const expanded = expandNode(out, state, []);
    expanded.resources ??= {};
    const res = expanded.resources;
    const hoisted = Object.fromEntries([...state.hoisted].map(([v, n]) => [n, v]));
    if (Object.keys(state.locals).length || Object.keys(hoisted).length) {
        res.variables = { ...(res.variables ?? {}), ...hoisted, ...state.locals };
    }
    if (res.colors) res.colors = docColors(res.colors, theme);
    const defined = new Set(colorEntries(res.colors).map(([n]) => n));
    const missing = [...state.colors].filter((c) => !defined.has(c));
    if (missing.length) {
        const colors = {};
        for (const c of missing.sort()) {
            const v = theme.colors[c];
            if (v === undefined) throw new Error(`theme colour '${c}' is not in the theme`);
            colors[c] = v;
        }
        res.colors = Array.isArray(res.colors)
            ? [...Object.entries(colors).map(([k, v]) => ({ [k]: v })), ...res.colors]
            : { ...colors, ...(res.colors ?? {}) };
    }
    if (!Object.keys(res).length) delete expanded.resources;
    if (state.defs.size) {
        // The templates go first in a root array, where the parser records them in its first
        // pass, before any call.
        const defs = [...state.defs.values()];
        const root = expanded.root;
        expanded.root = [...defs, ...(root === undefined ? [] : Array.isArray(root) ? root : [root])];
    }
    const motion = isMonoMode(theme.mode) ? stripMotion(expanded) : 0;
    return { doc: expanded, used: state.used, instances: state.instances, variants: state.variants,
        fallbacks: [...state.fallbacks.values()], names: state.names, motion };
}

function expandNode(node, state, stack) {
    if (Array.isArray(node)) {
        const out = [];
        for (const x of node) {
            const call = callOf(x, state.library, state.patterns);
            const v = call ? instantiate(call, state, stack) : expandNode(x, state, stack);
            if (v === DROP) continue;
            if (call && Array.isArray(v)) out.push(...v); else out.push(v);
        }
        return out;
    }
    if (node && typeof node === "object") {
        const call = callOf(node, state.library, state.patterns);
        if (call) {
            const v = instantiate(call, state, stack);
            if (Array.isArray(v)) {
                if (v.length !== 1) throw new Error(`${call.name} expands to ${v.length} nodes where one is expected`);
                return v[0];
            }
            return v;
        }
        const out = {};
        for (const [k, v] of Object.entries(node)) out[k] = expandNode(v, state, stack);
        return out;
    }
    if (typeof node === "string") collectThemeColors(node, state);
    return node;
}

function collectThemeColors(s, state) {
    for (const m of s.matchAll(/[@$]colors\.([A-Za-z_]\w*)/g)) state.colors.add(m[1]);
}

/**
 * The call's arguments checked against the definition: { given, slots, callMode }.
 */
function checkCall(name, def, args) {
    const { slots: slotArgs = {}, children, componentMode: callMode, ...given } = args;
    const slots = { ...slotArgs };
    if (children !== undefined && def.slots?.content && slots.content === undefined) slots.content = children;
    for (const k of Object.keys(given)) {
        if (!def.params?.[k]) throw new Error(`${name}: unknown parameter '${k}' (has ${Object.keys(def.params ?? {}).join(", ") || "none"})`);
    }
    for (const k of Object.keys(slots)) {
        if (!def.slots?.[k]) throw new Error(`${name}: unknown slot '${k}'`);
    }
    if (callMode !== undefined && !MODES.includes(callMode)) throw new Error(`${name}: componentMode must be one of ${MODES.join(", ")}`);
    return { given, slots, callMode };
}

/** One call: in pattern mode when its variant was chosen, else expanded. */
function instantiate({ name, args }, state, stack) {
    if (stack.includes(name)) throw new Error(`component cycle: ${[...stack, name].join(" -> ")}`);
    const def = state.library.components.get(name);
    state.used.add(name);
    state.instances++;
    const n = (state.counters.get(name) ?? 0) + 1;
    state.counters.set(name, n);
    const { given, slots, callMode } = checkCall(name, def, args);

    // In an expand document only the calls that ask for pattern mode are templates.
    if ((callMode ?? (state.docMode === "expand" ? "expand" : null)) !== "expand") {
        let compiled = null;
        try { compiled = compilePattern(name, def, given, slots, state); }
        catch (e) {
            // PatternUnfit names the trap; any other error is the expansion's too, and is
            // reported by it.
            const reason = e instanceof PatternUnfit ? e.message : `the pattern form failed: ${e.message}`;
            const key = `${name}\n${reason}`;
            const f = state.fallbacks.get(key) ?? { component: name, calls: 0, reason };
            f.calls++;
            state.fallbacks.set(key, f);
            if (callMode === "pattern") throw new Error(`${name}: componentMode "pattern", but ${reason}`);
        }
        if (compiled) {
            const v = state.variants.get(compiled.key) ?? { key: compiled.key, component: name, calls: 0, forced: false, demoted: compiled.demoted };
            v.calls++;
            if (callMode === "pattern") v.forced = true;
            state.variants.set(compiled.key, v);
            if (state.chosen.has(compiled.key)) return emitPatternCall(compiled, slots, state, [...stack, name]);
        }
    }
    return expandCall(name, def, given, slots, n, state, stack);
}

/** A call that cannot be a pattern (the message says why); it is expanded instead. */
class PatternUnfit extends Error {}

function expandCall(name, def, given, slots, n, state, stack) {
    const env = { params: {}, missing: new Set(), locals: {}, statics: {}, text: new Set(), theme: state.theme.numbers };
    for (const [k, spec] of Object.entries(def.params ?? {})) {
        let v = given[k];
        if (spec.type === "variable" && (v === undefined || typeof v === "number")) {
            // Not bound by the caller: the call owns its state, in a variable of its own,
            // starting at the number given (`"value": 2.5`), else the definition's initial.
            const unique = `${name.toLowerCase()}${n}_${k}`;
            state.locals[unique] = v ?? spec.initial ?? 0;
            state.resourceNames.add(unique);
            v = `@${unique}`;
        }
        if (v === undefined) v = spec.default;
        if (v === undefined) {
            if (spec.required) throw new Error(`${name}: missing required parameter '${k}'`);
            env.missing.add(k);
            continue;
        }
        if (spec.type === "enum" && !spec.values.includes(v)) {
            throw new Error(`${name}: ${k} must be one of ${spec.values.join(", ")}, not ${JSON.stringify(v)}`);
        }
        env.params[k] = v;
        if (spec.static || spec.type === "enum") env.statics[k] = v;
        if (spec.type === "string" || spec.type === "enum") env.text.add(k);
    }
    env.slots = slots;
    env.slotNames = new Set(Object.keys(def.slots ?? {}));
    const animated = [];
    for (const [k, v] of Object.entries(def.locals ?? {})) {
        const unique = `${name.toLowerCase()}${n}_${k}`;
        if (v && typeof v === "object" && typeof v.value === "string" && "anim" in v) {
            // An animated local {"value": "@checked", "anim": 0.25}: a float expression that
            // eases to the value whenever its inputs change (FloatExpression with an
            // animation, paint time). Resources cannot carry the animation (the parsers drop
            // `anim` there), so it is a tree `variable` command written into the body.
            // Mono has no motion: the local is the plain value, a computed local.
            if (isMonoMode(state.theme.mode)) { env.locals[k] = computedLocal(k, v.value, unique, env, state, name); continue; }
            const val = substitute(v.value, env, state, name);
            if (val === DROP || val === undefined) throw new Error(`${name}: local '${k}' has no value`);
            if (typeof val === "number") { env.locals[k] = { literal: val }; continue; }
            env.locals[k] = { ref: `@${unique}` };
            animated.push({ variable: { name: unique, value: { value: String(val), anim: v.anim } } });
            continue;
        }
        if (typeof v === "number" || (v && typeof v === "object" && !("$if" in v) && !("$count" in v))) {
            // State the call owns: a variable of its own, starting at v.
            env.locals[k] = { ref: `@${unique}` };
            state.locals[unique] = v;
            state.resourceNames.add(unique);
            continue;
        }
        env.locals[k] = computedLocal(k, v, unique, env, state, name);
    }
    const body = substitute(structuredClone(def.body), env, state, name);
    const nodes = (Array.isArray(body) ? body : [body]).filter((x) => x !== DROP);
    if (animated.length) declareInBody(nodes, animated, name);
    return expandNode(nodes, state, [...stack, name]);
}

/**
 * Animated locals go where the body reads them, ahead of every use: first in a canvas's
 * commands, else first among the children of the body's top node (a `variable` there is
 * written at its first use). Not in the top node's own modifiers: they are parsed before it.
 */
function declareInBody(nodes, decls, name) {
    const top = nodes[0];
    const key = top && typeof top === "object" && !Array.isArray(top) ? Object.keys(top).find((k) => top[k] && typeof top[k] === "object") : undefined;
    const inner = key && (key === "type" ? top : top[key]);
    const kind = key === "type" ? String(top.type).toLowerCase() : key?.toLowerCase();
    if (inner && kind === "canvas" && Array.isArray(inner.commands)) { inner.commands.unshift(...decls); return; }
    if (inner && ["box", "row", "column", "flow", "fitbox", "statelayout"].includes(kind ?? "")) {
        inner.children = [...decls, ...(inner.children ?? [])];
        return;
    }
    throw new Error(`${name}: an animated local needs a canvas or a container body`);
}

// ---- pattern mode ---------------------------------------------------------------------------
//
// A call compiles to a definePattern template plus a call of it. Values that can be
// arguments (pattern parameters, ids resolved at inflation) are: text, colours, numbers and
// variable references. Everything else is decided per call and written into the template
// itself: enums and static params, the $if branches taken, $each over static lists, folded
// theme numbers, actions. Two calls share a template exactly when their templates come out
// the same, so each static combination used becomes one template (Button__outlined_icon).
// The contexts where the format or a player mishandles a pattern parameter (PATTERN_TRAPS)
// take the call's value written in instead; where even that cannot work, the call expands.

export const PATTERN_TRAPS = {
    color: "a colour parameter is only resolved by `background`: text and paint colours write its id as a literal colour (Java parser)",
    text: "U7: a text component inside a pattern shares its component id across inflations (CoreText.read resolves instead of declaring it): inflated labels collide or vanish. Fixed in both players and in a proposed remote-core patch; honoured by default because shipped Java runtimes still have it",
    canvas: "a canvas inside a pattern did not resolve pattern parameters, locals or float expressions in its commands (C++ and TypeScript players; fixed, T22/C35a: off by default)",
    graphicsLayer: "graphicsLayer reading a pattern parameter or local drew nothing in the C++ player (fixed, C35b: off by default)",
};
// Honoured unless a document says otherwise ("componentTraps": [...]). canvas and graphicsLayer
// were bugs of our C++ and TS players only (Java's player, which Android runs, was right) and are
// fixed in both. text (U7) is a bug of the Java runtime itself: a template holding a text renders
// wrong on devices running today's remote-core, so it stays honoured until the fix ships; a
// document targeting a fixed runtime can drop it: "componentTraps": ["color"].
export const DEFAULT_TRAPS = ["color", "text"];

// What the compiler itself cannot express as a template (always expanded).
const PATTERN_LIMITS = {
    slot: "a slot placed outside a `children` list cannot be a patternArgument",
    nested: "the body calls another component",
    anim: "an animated local ({value, anim}) has no pattern-local form (mono, which has no motion, can still pattern)",
};

/** Whether a text param is joined into a longer text somewhere ("Decrease @label"). */
function spliced(def, k) {
    const re = new RegExp(`[@$]${k}(?![\\w.(])`);
    let found = false;
    const scan = (n) => {
        if (typeof n === "string") { if (re.test(n) && n !== `@${k}`) found = true; }
        else if (Array.isArray(n)) n.forEach(scan);
        else if (n && typeof n === "object") Object.values(n).forEach(scan);
    };
    scan(def.body); scan(def.locals ?? {});
    return found;
}

/** Whether a value can be a pattern argument (resolveTextId turns it into the right id). */
function passable(type, v) {
    if (typeof v === "string" && /^[@$][A-Za-z_]\w*$/.test(v)) return true;   // a variable
    if (type === "float") return typeof v === "number" && Number.isFinite(v);
    if (type === "color") return typeof v === "string" && (/^#[0-9A-Fa-f]{6,8}$/.test(v) || /^[@$]colors\.\w+$/.test(v));
    if (type === "string" || type === "text") {
        if (v && typeof v === "object") return ["textfromfloat", "textmerge"].includes(String(v.type).toLowerCase());
        // resolveTextId reads "#..." as a colour and "@a + 1" as an integer expression.
        return typeof v === "string" && !v.startsWith("#") && !/[@$]/.test(v);
    }
    return false;
}

function compilePattern(name, def, given, slots, state) {
    const pname = (k) => (state.reserved.has(k) ? `${k}_p` : k);
    const values = {}, missing = new Set();
    const runtime = new Set(), locals = [];
    for (const [k, spec] of Object.entries(def.params ?? {})) {
        let v = given[k];
        if (spec.type === "variable" && (v === undefined || typeof v === "number")) {
            // Per-call state: a pattern local, which each inflation gets a fresh id for.
            locals.push({ k, name: pname(k), value: v ?? spec.initial ?? 0 });
            values[k] = `@${pname(k)}`;
            continue;
        }
        if (v === undefined) v = spec.default;
        if (v === undefined) {
            if (spec.required) throw new Error(`${name}: missing required parameter '${k}'`);
            missing.add(k);
            continue;
        }
        if (spec.type === "enum" && !spec.values.includes(v)) {
            throw new Error(`${name}: ${k} must be one of ${spec.values.join(", ")}, not ${JSON.stringify(v)}`);
        }
        values[k] = v;
        if (!spec.static && ["float", "color", "string", "text", "variable"].includes(spec.type) && passable(spec.type, v)
            && !((spec.type === "string" || spec.type === "text") && spliced(def, k))) runtime.add(k);
    }
    for (const [k, v] of Object.entries(def.locals ?? {})) {
        if (typeof v === "number") locals.push({ k, name: pname(k), value: v, local: true });
        else if (isMonoMode(state.theme.mode) && v && typeof v === "object" && typeof v.value === "string" && "anim" in v) continue;   // mono: computed
        else if (v && typeof v === "object" && !("$if" in v) && !("$count" in v)) throw new PatternUnfit(PATTERN_LIMITS.anim);
    }
    const slotOrder = Object.keys(def.slots ?? {}).filter((s) => slots[s] !== undefined);
    const demoted = [];
    for (;;) {
        const params = [...runtime];
        const slotIndex = Object.fromEntries(slotOrder.map((s, i) => [s, params.length + i]));
        const colors = new Set();
        const scratch = { ...state, colors, locals: {}, resourceNames: new Set() };
        // What the call's $if, $each and $count read: its actual values.
        const cond = { params: {}, statics: {}, missing, text: new Set(), slots, slotNames: new Set(Object.keys(def.slots ?? {})), theme: state.theme.numbers };
        const env = { params: {}, missing, locals: {}, statics: {}, text: new Set(), slots, slotNames: cond.slotNames, slotIndex, inPattern: true, cond, theme: state.theme.numbers };
        for (const [k, v] of Object.entries(values)) {
            const spec = def.params[k];
            cond.params[k] = v;
            env.params[k] = runtime.has(k) ? `@${pname(k)}` : v;
            if (spec.static || spec.type === "enum") { cond.statics[k] = v; env.statics[k] = v; }
            if (spec.type === "string" || spec.type === "enum") { cond.text.add(k); env.text.add(k); }
        }
        for (const l of locals) if (l.local) env.locals[l.k] = { ref: `@${l.name}` };
        cond.locals = env.locals;
        for (const [k, v] of Object.entries(def.locals ?? {})) {
            if (typeof v === "number") continue;
            // Mono drops the motion of an animated local: its plain value, computed.
            env.locals[k] = computedLocal(k, v && typeof v === "object" && typeof v.value === "string" && "anim" in v ? v.value : v, k, env, scratch, name);
        }
        const body = substitute(structuredClone(def.body), env, scratch, name);
        const nodes = (Array.isArray(body) ? body : [body]).filter((x) => x !== DROP);
        // Check the template against the traps: a parameter in a trap is written in instead
        // (and the template compiled again); a local or an expression in one is fatal.
        const P = new Set(params.map(pname)), L = new Set(locals.map((l) => l.name));
        const hits = patternTraps(nodes, P, L, state);
        if (hits.fatal) throw new PatternUnfit(hits.fatal);
        const demote = [...runtime].filter((k) => hits.params.has(pname(k)));
        if (demote.length) {
            for (const k of demote) { runtime.delete(k); demoted.push({ param: k, why: hits.params.get(pname(k)) }); }
            continue;
        }
        const children = [...locals.map((l) => ({ variable: { name: l.name, value: l.value } })), ...nodes];
        walk(children, (n) => { for (const v of Object.values(n)) if (typeof v === "string") collectThemeColors(v, { colors }); });
        const spec = { parameters: [...params.map(pname), ...slotOrder.map((s) => `slot_${s}`)], ...(locals.length ? { locals: locals.map((l) => l.name) } : {}), children };
        const key = JSON.stringify({ component: name, ...spec });
        const args = params.map((k) => values[k]);
        for (const a of args) if (typeof a === "string") collectThemeColors(a, { colors });
        return { key, name, def, spec, args, slotOrder, colors, demoted: demoted.map((d) => d.param), static: values, slotIndex };
    }
}

/**
 * Where a template body uses something a pattern cannot carry: { params: Map(name -> trap)
 * of parameters to write in, fatal: the reason the call must expand, or null }.
 */
function patternTraps(nodes, P, L, state) {
    const params = new Map();
    let fatal = null;
    const refs = (x) => {
        const out = [];
        const s = typeof x === "string" ? x : JSON.stringify(x ?? null);
        for (const m of s.matchAll(/[@$]([A-Za-z_]\w*)(?![\w.(])/g)) out.push(m[1]);
        return out;
    };
    const on = (trap) => state.traps.has(trap);
    const hit = (names, trap) => {
        if (!on(trap)) return;
        for (const r of names) {
            if (P.has(r)) { if (!params.has(r)) params.set(r, trap); }
            else if (L.has(r)) fatal ??= PATTERN_TRAPS[trap];
        }
    };
    const visit = (node, key, top) => {
        if (Array.isArray(node)) { node.forEach((x) => visit(x, key, top && key === undefined)); return; }
        if (!node || typeof node !== "object") return;
        if ("patternArgument" in node && key !== "children" && !top) fatal ??= PATTERN_LIMITS.slot;
        if (callOf(node, state.library, state.patterns)) fatal ??= PATTERN_LIMITS.nested;
        const [type, props] = componentOf(node);
        // Any text component: inflated texts share component ids, with each other and with
        // other texts of the same string anywhere in the document (U7).
        if (type === "text" && on("text")) fatal ??= PATTERN_TRAPS.text;
        if (type === "canvas" && props.commands !== undefined && on("canvas")) {
            const scan = (c) => {
                if (typeof c === "string") {
                    const r = refs(c);
                    hit(r, "canvas");
                    // A float expression (operators or functions over a variable, or componentWidth()).
                    // One over parameters only may fold once they are written in.
                    if (/\w+\(\)/.test(c) || (!/^[@$][A-Za-z_]\w*$/.test(c) && r.some((x) => !P.has(x)))) fatal ??= PATTERN_TRAPS.canvas;
                } else if (Array.isArray(c)) c.forEach(scan);
                else if (c && typeof c === "object") Object.values(c).forEach(scan);
            };
            scan(props.commands);
        }
        for (const [k, v] of Object.entries(node)) {
            const lk = k.toLowerCase();
            if (lk === "graphicslayer") hit(refs(v), "graphicsLayer");
            if (lk === "color") hit(refs(v), "color");
            if (lk === "commands" && type === "canvas") continue;
            visit(v, ["then", "else"].includes(k) ? key : k, false);
        }
    };
    visit(nodes, undefined, true);
    return { params, fatal };
}

/** A layout component's [type, props]: {"text": {...}} or {"type": "text", ...}. */
function componentOf(node) {
    if (typeof node.type === "string") return [node.type.toLowerCase(), node];
    const keys = Object.keys(node);
    if (keys.length === 1 && node[keys[0]] && typeof node[keys[0]] === "object" && !Array.isArray(node[keys[0]])) return [keys[0].toLowerCase(), node[keys[0]]];
    return [null, node];
}

/** The template (defined once) and this call of it. */
function emitPatternCall(c, slots, state, stack) {
    let pat = state.names.get(c.key);
    if (!pat) {
        pat = patternName(c, state);
        state.names.set(c.key, pat);
        state.defs.set(c.key, { definePattern: { name: pat, ...c.spec } });
        state.patterns.add(pat);
        for (const col of c.colors) state.colors.add(col);
    }
    for (const a of c.args) if (typeof a === "string") collectThemeColors(a, state);
    // An integer is read as an id by the parsers (resolveTextId), so a whole-number argument
    // is passed as a float variable, one per value: "_n2": 2.
    const args = c.args.map((a) => {
        if (typeof a !== "number" || !Number.isInteger(a)) return a;
        let n = state.hoisted.get(a);
        if (!n) { n = `_n${String(a).replace("-", "m")}`; state.hoisted.set(a, n); }
        return `@${n}`;
    });
    const call = { arguments: args };
    const blocks = c.slotOrder.map((s) => ({ patternBlock: { parameterIndex: c.slotIndex[s],
        children: expandNode(Array.isArray(slots[s]) ? slots[s] : [slots[s]], state, stack) } }));
    if (blocks.length) call.children = blocks;
    return { [pat]: call };
}

/** Button__outlined_icon: the component, its enum values, bools off their default and the slots given. */
function patternName(c, state) {
    const parts = [];
    for (const [k, spec] of Object.entries(c.def.params ?? {})) {
        const v = c.static[k];
        if (spec.type === "enum" && v !== undefined) parts.push(String(v));
        else if (spec.type === "bool" && v !== undefined && v !== (spec.default ?? false)) parts.push(v ? k : `no${k[0].toUpperCase()}${k.slice(1)}`);
    }
    parts.push(...c.slotOrder);
    const base = `${c.name}__${parts.length ? parts.join("_").replace(/[^A-Za-z0-9_]/g, "_") : "p"}`;
    const taken = new Set(state.names.values());
    let pat = base;
    for (let i = 2; taken.has(pat) || state.patterns.has(pat); i++) pat = `${base}_${i}`;
    return pat;
}

/**
 * A computed local ("frac": "@value / @max", or a {"$if"} choosing one): substituted once
 * with the call's params, theme numbers and earlier locals, then
 *   - a number when it folds to one (static params only): spliced as a literal;
 *   - the reference itself when it is a single "@variable": an alias, nothing is written;
 *   - otherwise one float expression in resources.variables under a unique name, so every
 *     use reads the same variable instead of compiling its own copy;
 *   - or, when it names something resources cannot see (a variable declared in the tree, a
 *     pattern parameter, componentWidth()), the parenthesised text at every use.
 */
function computedLocal(k, v, unique, env, state, name) {
    const val = substitute(v, env, state, name);
    if (val === DROP || val === undefined) throw new Error(`${name}: local '${k}' has no value`);
    if (typeof val === "number") return { literal: val };
    if (typeof val === "boolean") return { literal: val ? 1 : 0 };
    if (typeof val !== "string") throw new Error(`${name}: local '${k}' must be a number or an expression, not ${JSON.stringify(val).slice(0, 40)}`);
    if (/^[@$][A-Za-z_]\w*$/.test(val)) return { ref: val };
    // In a template, a local reads pattern parameters, which resources cannot see.
    if (env.inPattern) return { inline: val };
    const names = [...val.matchAll(/[@$]([A-Za-z_][\w.]*)/g)].map((m) => m[1]);
    const global = !/component(Width|Height)/i.test(val) && names.every((x) => state.resourceNames.has(x));
    if (!global) return { inline: val };
    state.locals[unique] = val;
    state.resourceNames.add(unique);
    return { ref: `@${unique}` };
}

function localText(l, whole) {
    if ("literal" in l) return whole ? l.literal : String(l.literal);
    if ("ref" in l) return l.ref;
    return whole ? l.inline : `(${l.inline})`;
}

function substitute(node, env, state, name) {
    if (Array.isArray(node)) {
        const out = [];
        for (const x of node) {
            if (x && typeof x === "object" && !Array.isArray(x) && "$slot" in x) {
                const content = env.slots[x.$slot];
                if (content === undefined) continue;
                // In a template the slot is the patternArgument the call's patternBlock fills.
                if (env.slotIndex) { out.push({ patternArgument: { parameterIndex: env.slotIndex[x.$slot] } }); continue; }
                // Slot content belongs to the caller: it is expanded with the caller's
                // names, not substituted with this component's params.
                out.push(...(Array.isArray(content) ? content : [content]));
                continue;
            }
            if (x && typeof x === "object" && !Array.isArray(x) && "$each" in x) {
                // {"$each": "labels", "as": "label", "index": "i", "do": X}: X once per item of
                // a static list param (or a count), with @label and @i bound to literals.
                // "count": "n" also binds @n to the number of items.
                const list = paramValue(x.$each, env.cond ?? env, name);
                const items = typeof list === "number" ? Array.from({ length: list }, (_, k) => k) : list;
                if (!Array.isArray(items)) throw new Error(`${name}: $each needs a list or a count, '${x.$each}' is ${JSON.stringify(list)}`);
                items.forEach((item, k) => {
                    const bound = { [x.as ?? "item"]: item, [x.index ?? "index"]: k };
                    if (x.count) bound[x.count] = items.length;
                    const text = new Set(env.text);
                    if (typeof item === "string") text.add(x.as ?? "item"); else text.delete(x.as ?? "item");
                    const inner = { ...env, params: { ...env.params, ...bound }, statics: { ...env.statics, ...bound }, text };
                    if (env.cond) inner.cond = { ...env.cond, params: { ...env.cond.params, ...bound }, statics: { ...env.cond.statics, ...bound }, text };
                    const v = substitute(structuredClone(x.do), inner, state, name);
                    if (Array.isArray(v)) out.push(...v.filter((y) => y !== DROP));
                    else if (v !== DROP) out.push(v);
                });
                continue;
            }
            if (x && typeof x === "object" && !Array.isArray(x) && "$if" in x) {
                const branch = evalIf(x.$if, env.cond ?? env, name) ? x.then : x.else;
                if (branch === undefined) continue;
                const v = substitute(branch, env, state, name);
                if (Array.isArray(v)) out.push(...v.filter((y) => y !== DROP));
                else if (v !== DROP) out.push(v);
                continue;
            }
            const v = substitute(x, env, state, name);
            if (v !== DROP) out.push(v);
        }
        return out;
    }
    if (node && typeof node === "object") {
        if ("$if" in node) {
            const branch = evalIf(node.$if, env.cond ?? env, name) ? node.then : node.else;
            return branch === undefined ? DROP : substitute(branch, env, state, name);
        }
        if ("$count" in node) {
            // {"$count": "labels"}: the number of items of a static list param, as a literal.
            const list = paramValue(node.$count, env.cond ?? env, name);
            if (!Array.isArray(list)) throw new Error(`${name}: $count needs a list, '${node.$count}' is ${JSON.stringify(list)}`);
            return list.length;
        }
        if ("$slot" in node) {
            const content = env.slots[node.$slot];
            if (content === undefined) return DROP;
            if (env.slotIndex) return { patternArgument: { parameterIndex: env.slotIndex[node.$slot] } };
            return Array.isArray(content) && content.length === 1 ? content[0] : content;
        }
        const out = {};
        let had = 0;
        for (const [k, v] of Object.entries(node)) {
            had++;
            const s = substitute(v, env, state, name);
            if (s !== DROP) out[k] = s;
        }
        return had && !Object.keys(out).length ? DROP : out;
    }
    if (typeof node === "string") return substituteString(node, env, state, name);
    return node;
}

function substituteString(s, env, state, name) {
    const whole = /^@([A-Za-z_]\w*)$/.exec(s);
    if (whole) {
        const k = whole[1];
        if (k in env.params) return env.params[k];
        if (env.missing.has(k)) return DROP;
        if (k in env.locals) return localText(env.locals[k], true);
    }
    let out = s.replace(/@theme\.([A-Za-z_]\w*)/g, (m, k) => {
        const v = state.theme.numbers[k];
        if (v === undefined) throw new Error(`${name}: theme number '${k}' is not in the theme`);
        return String(v);
    });
    if (/^-?\d+(\.\d+)?$/.test(out) && out !== s) return Number(out);
    out = out.replace(/@([A-Za-z_]\w*)(?![\w.(])/g, (m, k) => {
        if (k in env.locals) return localText(env.locals[k], false);
        if (!(k in env.params)) {
            if (env.missing.has(k)) throw new Error(`${name}: parameter '${k}' is used in "${s}" but has no value`);
            return m;
        }
        const v = env.params[k];
        if (typeof v === "number") return String(v);
        if (typeof v === "boolean") return v ? "1" : "0";
        if (typeof v === "string" && env.text.has(k)) {
            // Text spliced into text ("Decrease @label"), as written. A runtime text cannot
            // be joined this way: the result would be literal text naming the variable.
            if (isRuntimeRef(v)) throw new Error(`${name}: '${k}' is bound to ${v}, a runtime value, and cannot be joined into "${s}"; pass literal text`);
            return v;
        }
        if (typeof v === "string") return /^[@$][\w.]+$/.test(v) || /^-?\d+(\.\d+)?$/.test(v) ? v : `(${v})`;
        throw new Error(`${name}: parameter '${k}' (${JSON.stringify(v).slice(0, 40)}) cannot be used inside "${s}"`);
    });
    collectThemeColors(out, state);
    // Arithmetic on static numbers only ("@size / 2" with size 40, "clamp(0, 240, 0.72 * 240)")
    // folds to a literal, so it also works in fields that take a plain number (clip radii,
    // sizes given as pairs) and costs no expression.
    if (out !== s) {
        const v = foldStatic(out);
        if (v !== undefined) return v;
    }
    return out;
}

// The expression functions foldStatic evaluates, with the player's semantics.
const FOLD = {
    min: Math.min, max: Math.max, abs: Math.abs,
    clamp: (lo, hi, v) => Math.min(Math.max(lo, v), hi),
    step: (x, edge) => (x > edge ? 1 : 0),
};

/** The value of an expression made only of number literals, + - * / and FOLD calls, else undefined. */
export function foldStatic(text) {
    const t = text.trim();
    if (!/^[\d.\s+\-*/(),a-z]+$/.test(t)) return undefined;
    const words = t.match(/[a-z]+/g) ?? [];
    if (!words.every((w) => w in FOLD)) return undefined;
    if (!words.length && !/[+\-*/]/.test(t.replace(/^-/, ""))) return undefined;
    try {
        const v = Function(...Object.keys(FOLD), `"use strict"; return (${t});`)(...Object.values(FOLD));
        return Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : undefined;
    } catch { return undefined; }
}

function evalIf(cond, env, name) {
    const c = String(cond).trim();
    // "theme.mono", "!theme.mono": a theme number (0 is false), the same in every call.
    let m = /^(!?)\s*@?theme\.([A-Za-z_]\w*)$/.exec(c);
    if (m) {
        const v = env.theme?.[m[2]];
        if (v === undefined) throw new Error(`${name}: $if reads theme.${m[2]}, which is not a theme number`);
        return m[1] ? !v : Boolean(v);
    }
    m = /^([A-Za-z_]\w*)\s*(==|!=)\s*'([^']*)'$/.exec(c);
    if (m) {
        const v = String(paramValue(m[1], env, name));
        return m[2] === "==" ? v === m[3] : v !== m[3];
    }
    m = /^(!?)\s*([A-Za-z_]\w*)$/.exec(c);
    if (m) {
        // A slot, or a runtime param, tests whether the call gave it; a static param its value.
        const k = m[2];
        const v = env.slotNames.has(k) ? k in env.slots
            : (k in env.statics || !(k in env.params) && !env.missing.has(k)) ? paramValue(k, env, name)
            : k in env.params && !isRuntimeRef(env.params[k]) ? env.params[k]
            : k in env.params;
        const truthy = Boolean(v) && v !== "0" && v !== 0;
        return m[1] ? !truthy : truthy;
    }
    throw new Error(`${name}: unsupported $if condition "${c}" (use p == 'x', p != 'x', p, !p, theme.mono or !theme.mono)`);
}

const isRuntimeRef = (v) => typeof v === "string" && /^[@$]/.test(v);

function paramValue(k, env, name) {
    if (k in env.statics) return env.statics[k];
    if (k in env.params) {
        const v = env.params[k];
        if (typeof v === "string" && /^[@$]/.test(v)) {
            throw new Error(`${name}: $if on '${k}', which is bound to a runtime value (${v}); mark it static or use a runtime condition`);
        }
        return v;
    }
    if (env.missing.has(k)) return undefined;
    throw new Error(`${name}: $if names '${k}', which is not a parameter`);
}

const PARAM_TYPES = new Set(["float", "bool", "color", "string", "text", "enum", "action", "variable", "list"]);

/**
 * Check a component definition before (or without) calling it: { errors, warnings }.
 * Errors make it unusable; warnings are the traps the library hit while it was written.
 */
export function lintComponent(def, name = def?.component, { library = loadLibrary() } = {}) {
    const errors = [], warnings = [];
    if (!def || typeof def !== "object") return { errors: ["a definition is a JSON object"], warnings };
    if (!name || !/^[A-Z][A-Za-z0-9]*$/.test(name)) errors.push(`name '${name}' must be PascalCase (lower-case names are the format's own components)`);
    if (def.body === undefined) errors.push("no body");
    if (!def.summary) warnings.push("no summary (find_components and get_component show it)");
    const params = def.params ?? {};
    for (const [k, p] of Object.entries(params)) {
        if (!p || typeof p !== "object") { errors.push(`param ${k}: a {type, ...} object`); continue; }
        if (!PARAM_TYPES.has(p.type)) errors.push(`param ${k}: type '${p.type}' is not one of ${[...PARAM_TYPES].join(", ")}`);
        if (p.type === "enum" && !Array.isArray(p.values)) errors.push(`param ${k}: an enum needs values`);
        if (p.type === "enum" && p.default !== undefined && !p.values?.includes(p.default)) errors.push(`param ${k}: default ${JSON.stringify(p.default)} is not one of its values`);
        if (p.required && p.default !== undefined) warnings.push(`param ${k}: required and has a default; the default is never used`);
        if (!p.doc) warnings.push(`param ${k}: no doc`);
    }
    // Every "@name" in the body and the locals, and the names $each / $count / $if read.
    const refs = new Set(), slotsUsed = new Set(), bound = new Set(), ifNames = new Set();
    const strings = [];
    const scan = (n) => {
        if (typeof n === "string") { strings.push(n); for (const m of n.matchAll(/[@$]([A-Za-z_][\w]*(?:\.[\w]+)?)/g)) refs.add(m[1]); }
        else if (Array.isArray(n)) n.forEach(scan);
        else if (n && typeof n === "object") {
            if (typeof n.$slot === "string") slotsUsed.add(n.$slot);
            if (typeof n.$each === "string") refs.add(n.$each);
            if (typeof n.$count === "string") refs.add(n.$count);
            for (const k of ["as", "index", "count"]) if (n.$each !== undefined && typeof n[k] === "string") bound.add(n[k]);
            if (typeof n.$if === "string") {
                const t = n.$if.replace(/'[^']*'|"[^"]*"/g, "");
                for (const m of t.matchAll(/@?theme\.([A-Za-z_]\w*)/g)) refs.add(`theme.${m[1]}`);
                for (const m of t.replace(/@?theme\.[A-Za-z_]\w*/g, "").matchAll(/([A-Za-z_]\w*)/g)) ifNames.add(m[1]);
            }
            for (const [k, v] of Object.entries(n)) { if (k !== "$if") scan(v); }
            if (n.border && JSON.stringify(n.border).includes("colors.")) errors.push("border can't take a theme colour (the Java parser reads its color as a literal); draw an outline with two backgrounds or a canvas");
        }
    };
    scan(def.body);
    scan(def.locals ?? {});
    const locals = new Set(Object.keys(def.locals ?? {}));
    const theme = library.theme ?? { colors: {}, numbers: {} };
    for (const r of refs) {
        if (r.startsWith("colors.")) { if (!(r.slice(7) in (theme.colors ?? {}))) warnings.push(`@${r} is not a theme colour: every caller must define it in resources.colors`); continue; }
        if (r.startsWith("theme.")) { if (!(r.slice(6) in (theme.numbers ?? {}))) errors.push(`@${r} is not a theme number (${Object.keys(theme.numbers ?? {}).join(", ")})`); continue; }
        if (r in params || locals.has(r) || bound.has(r)) continue;
        warnings.push(`@${r} is neither a param nor a local: it must be a variable every calling document declares; make it a \`variable\` param instead`);
    }
    for (const k of ifNames) if (!(k in params) && !(def.slots ?? {})[k] && !["then", "else"].includes(k)) warnings.push(`$if reads '${k}', which is not a param or slot`);
    for (const k of Object.keys(params)) {
        if (!refs.has(k) && !ifNames.has(k)) warnings.push(`param ${k} is never used in the body`);
    }
    for (const sl of slotsUsed) if (!(def.slots ?? {})[sl]) errors.push(`{"$slot": "${sl}"} is not declared in slots`);
    for (const sl of Object.keys(def.slots ?? {})) if (!slotsUsed.has(sl)) warnings.push(`slot ${sl} is declared but never placed with {"$slot": "${sl}"}`);
    const text = strings.join("\n");
    if (/clamp\(\s*@\w+\s*,\s*[-\d.]+\s*,\s*[-\d.]+\s*\)/.test(text)) warnings.push("clamp takes (min, max, value): the value goes last");
    if (/animationTime\(\)/.test(text) && !/continuousSec\(\)/.test(text)) warnings.push("animationTime() alone never schedules a repaint; use continuousSec() for motion");
    if (JSON.stringify(def.body ?? null).match(/"(drawPath|path)"\s*:\s*\{[^}]*"path"\s*:\s*"M/)) warnings.push("an SVG path string costs ~4 KB in Java (padded to 1024 floats); use drawLine/primitives or the op-list path form");
    if (!def.call) warnings.push("no `call` example (get_component and check_component use it)");
    return { errors, warnings };
}
