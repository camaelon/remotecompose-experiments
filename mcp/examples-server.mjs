#!/usr/bin/env node
// MCP server: the RemoteCompose example catalog and component library, for building a
// document from scratch. Given topics, keywords or capabilities, it points at the few
// examples (and components) worth copying from, with the exact JSON fragments that show
// each thing. Read-only. See docs/EXAMPLES_TAXONOMY.md, "The retrieval tool".
// stdio by default; `--http [PORT]` for Streamable HTTP (see lib/mcp-server.mjs).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isMain, serve } from "./lib/mcp-server.mjs";
import {
    EXAMPLES_DIR, buildKit, componentSummary, exampleDoc, findComponents, findExamples,
    listCapabilities, loadCatalog, resolveTerms, summarizeExample, findIcons, canvasOnly } from "./lib/catalog.mjs";
import { lintComponent, loadLibrary } from "./lib/components.mjs";
import { compileComponents, jsonToRc } from "./lib/json2rc.mjs";
import { definition as renderServer } from "./rc-render-server.mjs";
import { publicRoute } from "./lib/examples-web.mjs";

const json = (v) => [{ type: "text", text: JSON.stringify(v, null, 1) }];
const RO = { readOnlyHint: true, openWorldHint: false };
const STR_LIST = { type: "array", items: { type: "string" } };

function exampleById(id) {
    const C = loadCatalog();
    const e = C.byId.get(String(id).toUpperCase()) ?? C.examples.find((x) => x.folder === id);
    if (!e) throw new Error(`no example ${id} (find_examples or list_capabilities list them)`);
    return e;
}

export const definition = {
    name: "rc-examples",
    version: "1.0.0",
    // Read by the guide server (guide-server.mjs); not part of the MCP protocol.
    guide: {
        summary:
            "A catalog of verified RemoteCompose JSON examples (each byte-identical to the Java " +
            "parser's output, rendered and audited), searchable by capability with synonyms, and a " +
            "library of reusable components (Button, Switch, Card, ProgressRing, Stepper, ...) that " +
            "any document can call by name.",
        useWhen: [
            "you are writing a new document and want working fragments to start from (build_kit)",
            "you need to know how to do one thing in RemoteCompose JSON: a slider, a clock hand, a gradient",
            "you want a ready-made component instead of drawing it by hand",
            "you are writing your own reusable component (check_component)",
        ],
        notFor: [
            "converting, rendering or checking a document: json2rc, rc-render, rc-inspect (they all accept component calls)",
        ],
    },
    instructions:
        "A catalog of verified RemoteCompose JSON examples and a library of reusable components " +
        "(Button, Switch, Card, ProgressRing, ...). To build a document from scratch, call " +
        "`build_kit` with the goal in plain words: it returns the components to call and the " +
        "smallest set of examples covering the goal, each with the JSON fragments to copy, design " +
        "rules for the goal, and `needs_component` for anything to show that the library lacks: write " +
        "that component yourself (inline, under top-level `components`) and check it across its whole " +
        "range with `check_component` and a `sweep` before building the screen around it. Use " +
        "`find_examples` to search, `get_example` for a whole document, `find_components` / " +
        "`get_component` for the library. To write your own component, read " +
        "`component_authoring_guide` and get_component (definition: true) of a similar one, then " +
        "iterate with `check_component`; a document can " +
        "define components inline under a top-level `components` object. Documents that call components work directly in " +
        "every other RemoteCompose tool (json2rc, render_rc, validate, inspect); " +
        "`expand_components` shows the plain JSON they become.",
    tools: [
        {
            name: "build_kit",
            annotations: { title: "Examples and components for a goal", ...RO },
            description:
                "The starting point for a new document. From a goal in plain words (\"4x2 weather widget " +
                "with a tap to refresh\") or capability ids, return: the library components that fit " +
                "(their call snippet and params), then the smallest set of examples that together cover " +
                "the rest, simplest first, each with the capabilities it contributes and the JSON " +
                "snippet showing each, its pitfalls, and `not_covered` for anything the catalog has no " +
                "example of. `unmatched_terms` are words the vocabulary does not know. Read `design` (rules " +
                "for THIS goal: draw meaning rather than use glyphs, repeat by component not by copy, " +
                "compute dates from the clock, theme colours, render and look) and, when present, " +
                "`needs_component`: the things in the goal the library has no component for, with a recipe " +
                "to write one inline and verify it with check_component's sweep before using it.",
            inputSchema: {
                type: "object",
                properties: {
                    goal: { type: "string", description: "What to build, in plain words." },
                    capabilities: { ...STR_LIST, description: "Capability ids (or prefixes such as \"input\") to cover as well." },
                    max_examples: { type: "number", description: "At most this many examples (default 4)." },
                },
            },
            examples: [{ goal: "a settings card with switches and a slider" }],
            handler: async (a) => json(buildKit(a)),
        },
        {
            name: "find_examples",
            annotations: { title: "Search the example catalog", ...RO },
            description:
                "Rank catalog examples for a query (free text, resolved through the vocabulary's " +
                "synonyms) and/or explicit capability, use-case, form-factor or component ids. Each " +
                "result says why it matched, which asked-for capabilities it lacks, and carries the " +
                "snippets for the matched capabilities.",
            inputSchema: {
                type: "object",
                properties: {
                    query: { type: "string" },
                    capabilities: STR_LIST, use_cases: STR_LIST, components: STR_LIST,
                    form_factor: { type: "string" },
                    family: { type: "string", description: "Only this family (LAY, TXT, DRW, CMP, ...)." },
                    max_level: { type: "number", description: "Only examples at this level (1–5) or simpler." },
                    limit: { type: "number", description: "Default 5." },
                },
            },
            examples: [{ query: "donut progress ring" }, { capabilities: ["input.drag"], max_level: 3 }],
            handler: async (a) => json(findExamples(a)),
        },
        {
            name: "get_example",
            annotations: { title: "One example", ...RO },
            description:
                "An example by id (\"INT-04\"): its metadata, its JSON document, and optionally the " +
                "expanded JSON (for examples calling components), its render, or the .rc bytes.",
            inputSchema: {
                type: "object",
                properties: {
                    id: { type: "string" },
                    parts: { ...STR_LIST, description: "Any of meta, json, expanded_json, snippets, render, rc_base64 (default meta, json)." },
                },
                required: ["id"],
            },
            handler: async ({ id, parts = ["meta", "json"] }) => {
                const e = exampleById(id);
                // A canvas-only demo says so whatever parts are asked for: models fetch an
                // example's JSON alone and copy its structure.
                const out = { id: e.id, folder: e.folder,
                    ...(canvasOnly(e) ? { structure: "canvas", structure_note: "A canvas-only feature demo: take the technique (the drawing, the expressions), NOT the structure. Lay a screen out with column/row/text and components (see build_kit's layout_model, e.g. TIM-12) and keep a canvas only for the drawing itself." } : {}) };
                if (parts.includes("meta")) Object.assign(out, summarizeExample(e), { prompt: e.prompt, check: e.check, related: e.related, derived: e.derived });
                if (parts.includes("snippets") && !parts.includes("meta")) out.snippets = summarizeExample(e).snippets;
                if (parts.includes("json")) out.json = exampleDoc(e);
                if (parts.includes("expanded_json")) out.expanded_json = exampleDoc(e, "doc.expanded.json") ?? exampleDoc(e);
                const content = json(out);
                const dir = path.join(EXAMPLES_DIR, e.folder);
                if (parts.includes("rc_base64") && existsSync(path.join(dir, "doc.rc"))) {
                    content.push({ type: "text", text: `rc_base64: ${readFileSync(path.join(dir, "doc.rc")).toString("base64")}` });
                }
                if (parts.includes("render") && existsSync(path.join(dir, "render.png"))) {
                    content.push({ type: "image", mimeType: "image/png", data: readFileSync(path.join(dir, "render.png")).toString("base64") });
                }
                return content;
            },
        },
        {
            name: "find_components",
            annotations: { title: "Search the component library", ...RO },
            description:
                "Search the component library by name, synonym (\"toggle\", \"seek bar\", \"kpi\"), " +
                "capability or text. With no arguments, lists every component.",
            inputSchema: { type: "object", properties: { query: { type: "string" }, capabilities: STR_LIST, limit: { type: "number" } } },
            handler: async (a) => json(findComponents(a)),
        },
        {
            name: "find_icons",
            annotations: { title: "Search Material Symbols icons", ...RO },
            description:
                "Search the 4,157 Material Symbols icons by meaning (name words, Google's search tags, " +
                "categories), most relevant and popular first. Each result has its call, " +
                "{\"Icon\": {\"name\": ...}}: use an icon for every symbol on screen instead of a text " +
                "glyph or emoji. The Icon component takes style (outlined, rounded, sharp), filled, size, color and label.",
            inputSchema: {
                type: "object",
                properties: {
                    query: { type: "string", description: "What the icon should mean: \"wifi\", \"battery charging\", \"like\", \"arrow back\"." },
                    category: { type: "string", description: "Only this category (e.g. Android, Maps, Social, Audio&Video)." },
                    limit: { type: "number", description: "Default 12." },
                },
            },
            handler: async (a) => json(findIcons(a)),
        },
        {
            name: "get_component",
            annotations: { title: "One component", ...RO },
            description:
                "A library component: its params (types, defaults, which are static variants), slots, " +
                "a minimal call snippet, pitfalls, its gallery example, its demo document, and " +
                "optionally its definition (how it is built), the demo's JSON and its renders: the " +
                "default one, then light, dark, mono (componentTheme \"mono\": light on black, for " +
                "always-on displays) and mono-inverted (dark on white, for e-ink), each after a text line naming it.",
            inputSchema: {
                type: "object",
                properties: {
                    name: { type: "string" },
                    definition: { type: "boolean", description: "Include the whole definition: body and locals (default false)." },
                    parts: { ...STR_LIST, description: "Also any of demo_json (the demo document calling it), render (its PNGs: default, light, dark, mono, mono-inverted)." },
                },
                required: ["name"],
            },
            handler: async ({ name, definition: withDef, parts = [] }) => {
                const lib = loadLibrary();
                const key = [...lib.components.keys()].find((k) => k.toLowerCase() === String(name).toLowerCase());
                if (!key) throw new Error(`no component ${name} (it has ${[...lib.components.keys()].sort().join(", ")})`);
                const s = componentSummary(key);
                if (withDef) {
                    const { dir: _, ...def } = lib.components.get(key);
                    s.definition = def;
                }
                const dir = path.join(EXAMPLES_DIR, "components", key);
                if (parts.includes("demo_json") && existsSync(path.join(dir, "doc.json"))) s.demo_json = JSON.parse(readFileSync(path.join(dir, "doc.json"), "utf8"));
                const modes = ["light", "dark", "mono", "mono-inverted"].filter((m) => existsSync(path.join(dir, `render-${m}.png`)));
                if (modes.length) s.renders = ["default", ...modes];
                const content = json(s);
                if (parts.includes("render")) {
                    const png = (f) => ({ type: "image", mimeType: "image/png", data: readFileSync(path.join(dir, f)).toString("base64") });
                    if (existsSync(path.join(dir, "render.png"))) content.push({ type: "text", text: "render.png: the default render (dark theme)" }, png("render.png"));
                    for (const m of modes) {
                        content.push({ type: "text", text: m.startsWith("mono") ? `render-${m}.png: componentTheme "${m}" (its own document, doc.${m}.rc)` : `render-${m}.png: theme ${m}` }, png(`render-${m}.png`));
                    }
                }
                return content;
            },
        },
        {
            name: "component_authoring_guide",
            annotations: { title: "How to write a component", ...RO },
            description:
                "The guide to writing your own component: where it can live (inline in a document " +
                "under `components`, or in the library), the definition (params and their types, " +
                "slots, locals, body syntax: @param, $if, $each, $slot, theme colours and numbers), " +
                "rules that keep each instance small, the format's traps, and the workflow with " +
                "check_component. Read it before writing a component.",
            inputSchema: { type: "object", properties: {} },
            handler: async () => [{ type: "text", text: readFileSync(path.join(EXAMPLES_DIR, "..", "docs", "COMPONENT_AUTHORING.md"), "utf8") }],
        },
        {
            name: "check_component",
            annotations: { title: "Check a component you are writing", ...RO },
            description:
                "Try a component definition before using it: lint it (unknown types, params never " +
                "used, references that are neither params nor locals, undeclared slots, theme names " +
                "that don't exist, and the format's traps: clamp's argument order, border with a theme " +
                "colour, SVG path strings, animationTime() never repainting), then expand a call, " +
                "convert it, render it, and measure what each extra instance costs in .rc bytes, in " +
                "both compile modes: `modes.expand` (each call written in full) and `modes.pattern` " +
                "(one definePattern template, each call a pattern call; with the reason when the call " +
                "can't be one, e.g. U7 for a component with a text). `bytes` is what auto mode writes; " +
                "`themes` gives the bytes per componentTheme (auto: themed light/dark colours, mono, mono-inverted). " +
                "The render comes four times, each after a text line naming it: light and dark " +
                "theme, and the mono and mono-inverted expansions (check the component's {\"$if\": \"theme.mono\"} variant). " +
                "For a component drawn from a value, pass `sweep` ({param, values}) to see every state in one " +
                "captioned contact sheet; a single render at the default value hides most geometry bugs. " +
                "Give `call` (the args of one call, default the definition's own `call`) or a whole " +
                "`doc` that calls it. Variables the call references (\"@cpu\") are declared for the " +
                "demo; set their values with `variables`. A definition that passes can be pasted into " +
                "any document under a top-level `components` object, or added to the library as " +
                "examples/components/<Name>/component.json.",
            inputSchema: {
                type: "object",
                properties: {
                    definition: { description: "The component definition (component.json shape: summary, params, slots, locals, body, call).", anyOf: [{ type: "object" }, { type: "string" }] },
                    name: { type: "string", description: "Its PascalCase name (default definition.component)." },
                    call: { type: "object", description: "Arguments of one call (default: from definition.call)." },
                    doc: { description: "Instead of `call`: a whole document calling it.", anyOf: [{ type: "object" }, { type: "string" }] },
                    variables: { type: "object", description: "Values for the variables the call references, e.g. {\"cpu\": 72}." },
                    width: { type: "number", description: "Demo width (default 360)." },
                    height: { type: "number", description: "Demo height (default 200)." },
                    render: { type: "boolean", description: "Render the demo in light, dark and mono (default true)." },
                    sweep: {
                        type: "object",
                        description: "Also render a contact sheet: the component once per value of one param, captioned, in a grid. Use it for anything drawn from a value: cover both ends, the middle and both halves of a cycle (e.g. {\"param\": \"phase\", \"values\": [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875]}).",
                        properties: {
                            param: { type: "string" },
                            values: { type: "array", description: "Values to try (numbers, strings for an enum, colours)." },
                            columns: { type: "number", description: "Cells per row (default 4)." },
                            themes: { type: "array", items: { type: "string" }, description: "Default [\"light\"]; any of light, dark, mono, mono-inverted." },
                        },
                        required: ["param", "values"],
                    },
                },
                required: ["definition"],
            },
            examples: [{
                definition: { component: "PriceTag", summary: "A price in a pill", params: { price: { type: "string", required: true, doc: "e.g. 9.99" } },
                              body: { text: { value: "$ @price", color: "@colors.onPrimary", modifiers: [{ background: "@colors.primary" }, { padding: [10, 4] }] } },
                              call: { PriceTag: { price: "9.99" } } },
            }],
            handler: async (a) => checkComponent(a),
        },
        {
            name: "expand_components",
            annotations: { title: "Expand component calls to plain JSON", ...RO },
            description:
                "Turn a document that calls library components (or defines its own under a top-level " +
                "`components` object) into the plain RemoteCompose JSON it stands for (what json2rc and " +
                "the Java parser convert). Theme colours it uses are added to resources.colors unless " +
                "the document defines them, which is how a document re-themes the library; they are " +
                "themed {light, dark} colours the player picks by the system theme. `theme` (or the " +
                "document's `componentTheme`) picks light, dark, mono or mono-inverted instead. `mode` (or " +
                "the document's `componentMode`): expand (every call inlined), pattern (definePattern " +
                "templates where the players render them like the expansion), auto (default: a template " +
                "for a variant used twice or more when the converted document is smaller). `report` says " +
                "per variant which mode it got and why; `modes` sums it per component.",
            inputSchema: {
                type: "object",
                properties: {
                    json: { description: "The document (object or string).", anyOf: [{ type: "object" }, { type: "string" }] },
                    mode: { type: "string", enum: ["auto", "expand", "pattern"], description: "Overrides the document's componentMode." },
                    theme: { type: "string", enum: ["auto", "all", "light", "dark", "mono", "mono-inverted"], description: "Overrides the document's componentTheme: auto (default: each theme colour a themed light/dark colour), light or dark (that palette only, plain colours), mono (light on black, one grey, the components' mono variants, no animation: always-on displays), mono-inverted (the same dark on white: e-ink), all (every look in one larger document, mono switched by the host's theme.mono float)." },
                },
                required: ["json"],
            },
            handler: async ({ json: doc, mode, theme }) => {
                const r = compileComponents(typeof doc === "string" ? JSON.parse(doc) : doc, ".", { ...(mode ? { mode } : {}), ...(theme ? { theme } : {}) });
                return json({ components: r.components, instances: r.instances, mode: r.mode, theme: r.theme, modes: r.modes, report: r.report,
                    ...(r.motion_removed ? { motion_removed: r.motion_removed } : {}), json: r.doc });
            },
        },
        {
            name: "resolve_terms",
            annotations: { title: "Map words to vocabulary ids", ...RO },
            description:
                "Map user words (\"seek bar\", \"donut\", \"material you\") to capability, use-case, " +
                "form-factor and component ids through the synonyms, and list the words nothing matched.",
            inputSchema: { type: "object", properties: { terms: { ...STR_LIST, description: "Words or phrases." } }, required: ["terms"] },
            handler: async ({ terms }) => json(resolveTerms(terms)),
        },
        {
            name: "list_capabilities",
            annotations: { title: "The vocabulary", ...RO },
            description:
                "The capability vocabulary (ids, labels, synonyms, the JSON evidence for each) with the " +
                "examples demonstrating each, plus the use cases, form factors and components.",
            inputSchema: { type: "object", properties: { prefix: { type: "string" }, with_counts: { type: "boolean" } } },
            handler: async (a) => json(listCapabilities(a)),
        },
    ],
};

definition.publicRoute = publicRoute;

const renderRc = renderServer.tools.find((t) => t.name === "render_rc").handler;

/** check_component: lint, expand one call (or a doc), convert, render, measure per-instance bytes. */
/**
 * A contact sheet: the component once per value of one param, in a grid, each cell captioned
 * with its value. One image shows the whole range, which is where a drawing that depends on a
 * value goes wrong (the other half of a cycle, the far end of a range) and a single render,
 * at the default value, looks fine.
 */
function sweepDoc(name, body, args, { param, values, columns = 4, cell = 0 }, width) {
    let cols = Math.max(1, Math.min(columns, values.length));
    // The cells are as wide as the grid allows and as tall as the component asks: its `size`
    // (the call's, else the param default) or its `height`, else square.
    const dim = (k) => [args[k], body.params?.[k]?.default].find((v) => typeof v === "number");
    // A component wider than a cell gets fewer columns, so cells never overlap.
    const want = dim("size") ?? dim("width");
    if (want) cols = Math.max(1, Math.min(cols, Math.floor((width - 24) / (want + 8))));
    const rows = Math.ceil(values.length / cols);
    const cellW = (width - 32 - 8 * (cols - 1)) / cols;
    const cellH = Math.round(cell || Math.max(dim("size") ?? dim("height") ?? cellW, 24)) + 22;
    const label = (v) => `${param} ${typeof v === "number" ? +v.toFixed(4) : String(v)}`;
    const cellOf = (v) => ({ column: { horizontalAlignment: "center",
        modifiers: [{ weight: 1 }, { spacedBy: 4 }],
        children: [
            { box: { modifiers: ["fillMaxWidth", { height: cellH - 22 }], horizontalAlignment: "center", verticalAlignment: "center",
                     children: [{ [name]: { ...structuredClone(args), [param]: v } }] } },
            { text: { value: label(v), fontSize: 11, color: "@colors.muted" } }] } });
    const grid = [];
    for (let r = 0; r < rows; r++) {
        const vs = values.slice(r * cols, r * cols + cols);
        const cells = vs.map(cellOf);
        // Pad the last row so every cell keeps the same width.
        for (let i = vs.length; i < cols; i++) cells.push({ box: { modifiers: [{ weight: 1 }, { height: cellH }] } });
        grid.push({ row: { modifiers: ["fillMaxWidth", { spacedBy: 8 }], children: cells } });
    }
    return {
        header: { apiLevel: 7, width, height: rows * cellH + (rows - 1) * 8 + 32, profiles: 513 },
        components: { [name]: body },
        root: { column: { modifiers: ["fillMaxSize", { background: "@colors.background" }, { padding: 16 }, { spacedBy: 8 }], children: grid } },
    };
}

async function checkComponent({ definition: def, name, call, doc, variables = {}, width = 360, height = 200, render = true, sweep }) {
    if (sweep) render = true;   // a sweep is a render: asking for one is asking to see it
    if (typeof def === "string") def = JSON.parse(def);
    name ??= def?.component;
    const lint = lintComponent(def, name);
    const out = { name, errors: lint.errors, warnings: lint.warnings };
    if (lint.errors.length) return json({ ...out, ok: false });
    const { component: _, ...body } = def;
    const args = call ?? def.call?.[name] ?? {};
    const refs = (v) => [...JSON.stringify(v).matchAll(/"@([A-Za-z_]\w*)"/g)].map((m) => m[1]);
    const make = (n) => {
        if (doc) {
            const d = typeof doc === "string" ? JSON.parse(doc) : structuredClone(doc);
            d.components = { ...(d.components ?? {}), [name]: body };
            return d;
        }
        const vars = Object.fromEntries(refs(args).map((v) => [v, variables[v] ?? 0]));
        return {
            header: { apiLevel: 7, width, height, profiles: 513 },
            components: { [name]: body },
            ...(Object.keys(vars).length ? { resources: { variables: vars } } : {}),
            root: { type: "column", modifiers: ["fillMaxSize", { background: "@colors.background" }, { padding: 16 }, { spacedBy: 12 }],
                    children: Array.from({ length: n }, () => ({ [name]: structuredClone(args) })) },
        };
    };
    try {
        const one = make(1);
        out.expanded = compileComponents(one, ".", { mode: "expand" }).doc;
        const bytes = jsonToRc(one);
        out.bytes = bytes.length;
        if (!doc) out.bytes_per_extra_instance = jsonToRc(make(2)).length - bytes.length;
        // Both compile modes: what one call costs, and each extra one.
        out.modes = {};
        for (const mode of ["expand", "pattern"]) {
            const size = (d) => jsonToRc({ ...d, componentMode: mode }).length;
            const m = { bytes: size(one) };
            if (!doc) m.bytes_per_extra_instance = size(make(2)) - m.bytes;
            if (mode === "pattern") {
                const r = compileComponents(one, ".", { mode });
                const mine = r.report.filter((x) => x.component === name);
                m.templates = mine.filter((x) => x.mode === "pattern").map((x) => x.pattern);
                const why = mine.filter((x) => x.mode === "expand").map((x) => x.reason);
                if (why.length) m.expanded_because = [...new Set(why)];
                const written = [...new Set(mine.flatMap((x) => x.static ?? []))];
                if (written.length) m.params_written_in = written;
            }
            out.modes[mode] = m;
        }
        // The bytes per componentTheme (the mono expansion also checks the mono variant).
        const mono = { ...one, componentTheme: "mono" };
        const inverted = { ...one, componentTheme: "mono-inverted" };
        out.themes = { auto: bytes.length, mono: jsonToRc(mono).length, "mono-inverted": jsonToRc(inverted).length };
        if (render) {
            const images = [];
            out.render_findings = {};
            for (const [label, args] of [["light", { json: one, theme: "light" }], ["dark", { json: one, theme: "dark" }], ["mono", { json: mono }], ["mono-inverted", { json: inverted }]]) {
                const r = await renderRc({ ...args, public_link: false });
                const text = r.filter((c) => c.type === "text").map((c) => c.text).join("\n");
                out.render_findings[label] = text.split("\n").filter((l) => /^(error|warning|info): |^findings: /.test(l));
                images.push({ type: "text", text: label.startsWith("mono") ? `${label} (componentTheme "${label}")` : `${label} theme` }, ...r.filter((c) => c.type === "image"));
            }
            if (sweep) {
                if (!sweep.param || !Array.isArray(sweep.values) || !sweep.values.length) throw new Error("sweep needs {param, values: [...]}");
                if (!(sweep.param in (def.params ?? {}))) throw new Error(`sweep: '${sweep.param}' is not a param of ${name}`);
                const sheet = sweepDoc(name, body, args, sweep, Math.max(width, 360));
                // The other inline components the document defines (helpers this one calls).
                const docComps = doc ? (typeof doc === "string" ? JSON.parse(doc) : doc).components : null;
                if (docComps) sheet.components = { ...docComps, [name]: body };
                out.sweep = { param: sweep.param, values: sweep.values, bytes: jsonToRc(sheet).length };
                for (const theme of sweep.themes ?? ["light"]) {
                    const mono = theme.startsWith("mono");
                    const r = await renderRc({ json: mono ? { ...sheet, componentTheme: theme } : sheet, ...(mono ? {} : { theme }), public_link: false });
                    images.push({ type: "text", text: `sweep of ${sweep.param} (${theme}): one cell per value, captioned. Check EVERY cell against what it should look like.` },
                                ...r.filter((c) => c.type === "image"));
                }
            }
            out.ok = true;
            return [...json(out), ...images];
        }
    } catch (e) {
        out.ok = false;
        out.error = e.message;
        return json(out);
    }
    out.ok = true;
    return json(out);
}

if (isMain(import.meta.url)) serve(definition);
