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
    listCapabilities, loadCatalog, resolveTerms, summarizeExample,
} from "./lib/catalog.mjs";
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
        "smallest set of examples covering the goal, each with the JSON fragments to copy. Use " +
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
                "example of. `unmatched_terms` are words the vocabulary does not know.",
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
                const out = { id: e.id, folder: e.folder };
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
                    theme: { type: "string", enum: ["auto", "light", "dark", "mono", "mono-inverted"], description: "Overrides the document's componentTheme: auto (default: each theme colour a themed light/dark colour), light or dark (that palette only, plain colours), mono (light on black, one grey, the components' mono variants, no animation: always-on displays), mono-inverted (the same dark on white: e-ink)." },
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
async function checkComponent({ definition: def, name, call, doc, variables = {}, width = 360, height = 200, render = true }) {
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
