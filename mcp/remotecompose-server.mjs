// remotecompose-server.mjs — one MCP front door over every RemoteCompose server.
//
//   node remotecompose-server.mjs            stdio
//   node remotecompose-server.mjs --http     HTTP on MCP_HTTP_PORT (deployed on 8814)
//
// The single-purpose servers (json2rc, rc-render, rc-inspect, rc-deploy, rc-examples, guide)
// stay as they are; this one imports their tool definitions and regroups them into a dozen
// tools with one workflow, so a client configures one URL and one token, and a model reads
// one set of instructions instead of assembling the process from six. Tools that were
// variations of one another become one tool with a selector (`inspect` + `task`, `find` +
// `kind`): a long tool list costs context and makes the choice worse.
//
// Public routes (no token) are those of the servers it includes: the example gallery and
// playgrounds (/, /components/, /play/...), published pages (/pages/...) and rendered images
// (/images/...), all under this server's own MCP_PUBLIC_URL.

import { definition as json2rc } from "./json2rc-server.mjs";
import { definition as render } from "./rc-render-server.mjs";
import { definition as inspect } from "./inspect-server.mjs";
import { definition as deploy } from "./deploy-server.mjs";
import { definition as examples } from "./examples-server.mjs";
import { serve, isMain } from "./lib/mcp-server.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolvePath } from "./lib/workspace.mjs";
import { designNotes, blockingFindings, readsClock } from "./lib/design-audit.mjs";

const resolveIn = (p) => resolvePath(p, "json_path");

/** The JSON document a call is about (inline or a file), or null for binary input. */
function jsonOf(args) {
    try {
        const j = args.json ?? ((args.json_path ?? args.input_path) ? readFileSync(resolveIn(args.json_path ?? args.input_path), "utf8") : null);
        return typeof j === "string" ? JSON.parse(j) : j;
    } catch { return null; }
}
/** A tool's content with the document's design warnings appended (see designNotes). */
function withDesign(content, args, { first = false } = {}) {
    const json = jsonOf(args);
    const notes = json ? designNotes(json) : "";
    if (!notes) return content;
    const block = { type: "text", text: "NOT DONE YET: this document has design problems to fix before it is shown or published.\n" + notes };
    return first ? [block, ...content] : [...content, block];
}

const tool = (def, name) => {
    const t = def.tools.find((x) => x.name === name);
    if (!t) throw new Error(`${def.name} has no tool ${name}`);
    return t;
};
const text = (s) => [{ type: "text", text: s }];

/**
 * One tool that dispatches on a selector argument to several underlying tools. Its schema is
 * the union of theirs plus the selector; each underlying tool gets the arguments minus the
 * selector, so they keep their own validation and messages.
 */
function dispatcher({ name, title, description, selector, choices, fallback, annotations }) {
    const properties = { [selector]: { type: "string", enum: Object.keys(choices), description: `Which ${selector}.` } };
    for (const t of Object.values(choices)) {
        for (const [k, v] of Object.entries(t.inputSchema?.properties ?? {})) properties[k] ??= v;
    }
    return {
        name,
        annotations: { title, ...(annotations ?? {}) },
        description,
        inputSchema: { type: "object", properties, ...(fallback ? {} : { required: [selector] }) },
        handler: async (args = {}) => {
            const { [selector]: which = fallback, ...rest } = args;
            const t = choices[which];
            if (!t) throw new Error(`${name}: unknown ${selector} '${which}' (one of ${Object.keys(choices).join(", ")})`);
            return t.handler(rest);
        },
    };
}

const RO = { readOnlyHint: true, openWorldHint: false };

const WORKFLOW = `RemoteCompose: server-driven UI as a compact binary document (.rc), written as JSON.

The workflow for a new document:
1. build_kit with the goal in plain words. It returns the library components to call, the
   smallest set of verified examples (with JSON snippets and pitfalls), design rules for this
   goal, and needs_component: things to show that the library has no component for.
2. For each needs_component entry, write an inline component and check_component it with a
   sweep over its parameter range until every rendered state is right. Never use text glyphs
   or emoji as icons, and never paste the same drawing once per occurrence.
3. Assemble the document: components (library and inline), the examples' snippets, values
   computed in the document (from the clock, host variables, expressions) rather than pasted.
4. convert (with check: true) to validate it, render to look at it (other states too: other
   dates, values, light and dark, a narrow and a wide size), and audit it: the audit flags
   glyph icons, repeated subtrees, hard-coded dates and colours, and expressions Android
   rejects (over 32 entries). Fix and repeat.
5. publish to package it as a web page (a playground) when the user wants to see or share it.

Look things up with find (examples, components, capabilities) and get; reference has the
component authoring guide and full documentation for every tool. inspect answers questions
about a document (layout, variables, accessibility, interactions, bytes, runtime).`;

const FORMAT = `RemoteCompose JSON essentials (get an example with \`get\` for full syntax):

Structure
- {"header": {"apiLevel": 7, "width", "height", "profiles": 513, "contentDescription"}, "resources": {...}, "root": {...}}.
- Lay a UI out with components: column, row, box, flow, text, spacer, image, statelayout, collapsibleRow/Column,
  and library components (Card, ListItem, StatTile, Icon, Gauge, ...: find kind "components"). They measure and
  wrap text, follow the font scale and the screen size, and expose text to screen readers.
- A canvas is for drawings (a chart, a dial, an arc), sized by its modifiers inside the layout. Do not draw a
  whole screen on one canvas: its texts are placed by hand and nothing relayouts when the size changes.
- Modifiers are a list: ["fillMaxWidth", {"padding": 16}, {"spacedBy": 8}, {"background": "@colors.surface"},
  {"clip": {"roundedRect": 16}}, {"weight": 1} (in a row), {"verticalWeight": 1} (in a column)].
- Smaller sizes: a widget is resized by its host. Drop content by priority with a collapsibleColumn inside a padded
  box: {"box": {"modifiers": ["fillMaxSize", {"padding": 16}], "children": [{"collapsibleColumn": {"modifiers":
  ["fillMaxSize"], "horizontalAlignment": "start", "verticalArrangement": "top", "children": [...]}}]}}, with
  {"collapsiblePriority": {"orientation": "vertical", "priority": N}} on the optional children (lowest N dropped first;
  none = kept). collapsibleColumn ignores its own padding and centres by default. Or a StateLayout, or verticalScroll.
- Text picked by a runtime index (a phase name, a weekday, "Rising"/"Falling"): the TextChoice component
  ({"TextChoice": {"items": ["New moon", ...], "index": "@phaseIndex"}}). A layout text cannot take textSubtext /
  textTransform / textLookup (only canvas commands can); numbers go through textFromFloat, joins through textMerge.
  A word joined to other text in one wrapping line ("Waning gibbous, 57% lit") is not a TextChoice: compute it as a
  named text in a canvas "global" block (textSubtext over fixed-width names, then textTransform to trim; see
  TIM-11), then use "@name" in a layout text's textMerge.
- Trap: weighted children ignore spacedBy (the weights share the whole width, then the gaps overflow it). In a
  row or column with weights, put fixed spacer boxes ({"box": {"modifiers": [{"width": 8}]}}) between them.

Canvas (when you do draw)
- Derive coordinates from componentWidth() / componentHeight() (named "variable" commands, then reused), or
  scale a fixed design box to the size: literal coordinates only fit the header size.
- The paint is sticky: set color/style/strokeWidth/textSize before each kind of draw.
- drawTextAnchored {text, x, y, panX, panY}: the pan says where the TEXT goes relative to (x, y):
  panX -1 = to the right of x (left-aligned), 0 = centred on x, 1 = to the left of x (right-aligned);
  panY -1 = above y, 0 = centred on y, 1 = below y.
- Never SVG path strings: use pathExpression or the components (Java writes SVG strings as empty paths).

Values
- Colours: theme colours "@colors.onSurface" etc.; literal "#AARRGGBB" otherwise. Write each component call once:
  the same JSON expands for every look. Light and dark follow the system theme; mono and mono-inverted
  (always-on, e-ink) are the same JSON expanded with the components' mono implementation (render with
  componentTheme "mono" to check it; the published playground's Mono buttons switch to it).
- Expressions are strings: "componentWidth() / 2", "@progress * 360"; Android rejects one over 32 entries:
  split long formulas into named variables.
- Anything that depends on the date or time (today, this month, "in 3 days") is computed from the clock
  (dayOfMonth(), calendarMonth(), year(), timeInMin(), ...), never typed in.
- Icons: {"Icon": {"name": "wifi"}} (find kind "icons"), never text glyphs or emoji.`;

/**
 * render with variants: the states a user will reach, in one call, each captioned: the
 * themes (and mono for always-on and e-ink), a narrow and a wide size, another time of day
 * for a document that reads the clock. A model checks what is cheap to check.
 */
/**
 * Does the document still fit when the host makes it smaller (a widget resized down)? The
 * audit's layout overflow at 60% of the height and 75% of the width, as a note naming the
 * fixes, or "" when it fits.
 */
async function smallSizeNote(args) {
    const json = jsonOf(args);
    const header = json?.header ?? {};
    const W = args.width ?? header.width, H = args.height ?? header.height;
    if (!W || !H) return "";
    const src = json ? { json } : args.rc_path ? { rc_path: args.rc_path } : null;
    if (!src) return "";
    // What breaks at a smaller size and not at the design size: content past its box, or (a
    // column that runs out of room squeezes its last children to nothing) zero-size components.
    const broken = async (w, h) => {
        const r = await tool(inspect, "audit").handler({ ...src, width: w, height: h });
        const f = JSON.parse(r[0].text).findings ?? [];
        const n = (code) => f.filter((x) => x.code === code).reduce((k, x) => k + (x.count ?? 1), 0);
        return { overflow: n("layout_overflow"), zero: n("layout_zero_size") };
    };
    const over = [];
    try {
        const base = await broken(W, H);
        for (const [w, h] of [[W, Math.round(H * 0.6)], [Math.round(W * 0.75), H]]) {
            const b = await broken(w, h);
            if (b.overflow > base.overflow || b.zero > base.zero) over.push(`${w}×${h}`);
        }
    } catch { /* no verdict */ }
    if (!over.length) return "";
    return `size warning: at ${over.join(" and ")} the content no longer fits (cut off or squeezed to nothing). A widget is resized by its host, ` +
        "often smaller than designed: drop the least important content first (a collapsibleColumn with collapsiblePriority " +
        "on the optional children, inside a box that carries the padding, horizontalAlignment \"start\", lowest priority " +
        "dropped first: examples LAY-13, LAY-14; reference topic \"format\" has the snippet), switch to a compact layout " +
        "(StateLayout: LAY-15), or at minimum put the content in a verticalScroll.";
}

async function renderVariants(t, args) {
    const json = jsonOf(args);
    const header = json?.header ?? {};
    const W = args.width ?? header.width ?? 360, H = args.height ?? header.height ?? 640;
    const base = { ...args, width: W, height: H };
    const clockShift = () => {
        const c = args.clock ? new Date(args.clock) : new Date();
        const d = new Date(c.getTime() + 7 * 3600_000);
        const p = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    const plan = [
        ["dark theme", { ...base, theme: "dark" }],
        ["light theme", { ...base, theme: "light" }],
        ...(json ? [["mono (always-on displays)", { ...base, json: { ...json, componentTheme: "mono" }, json_path: undefined }]] : []),
        [`narrow ${Math.round(W * 0.72)}×${H}`, { ...base, width: Math.round(W * 0.72) }],
        [`wide ${Math.round(W * 1.6)}×${Math.round(H * 0.75)}`, { ...base, width: Math.round(W * 1.6), height: Math.round(H * 0.75) }],
        [`short ${W}×${Math.round(H * 0.6)} (a widget resized down)`, { ...base, height: Math.round(H * 0.6) }],
        ...(json && readsClock(json) ? [["seven hours later", { ...base, clock: clockShift() }]] : []),
    ];
    const content = [];
    for (const [label, a] of plan) {
        const clean = Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined));
        try {
            const r = await t.handler(clean);
            content.push({ type: "text", text: `── ${label}` }, ...r.filter((c) => c.type === "image"),
                ...r.filter((c) => c.type === "text" && /^(error|warning): /m.test(c.text)).map((c) => ({ type: "text", text: c.text })));
        } catch (e) { content.push({ type: "text", text: `── ${label}: ${String(e?.message ?? e).split("\n")[0]}` }); }
    }
    const small = await smallSizeNote(args);
    if (small) content.unshift({ type: "text", text: small });
    return withDesign(content, args, { first: true });
}

const tools = [
    {
        ...tool(examples, "build_kit"),
        description: "START HERE for a new document. Pass the user's request as they wrote it (not a rewritten or " +
            "embellished version: extra adjectives only add noise). " + tool(examples, "build_kit").description,
    },
    dispatcher({
        name: "find", title: "Search examples, components, icons, capabilities", selector: "kind", fallback: "examples", annotations: RO,
        description:
            "Search the verified catalog. kind \"examples\" (default): rank examples for a query and/or " +
            "capability, use-case, component ids, each with why it matched and its snippets. kind " +
            "\"components\": library components for a query or capabilities. kind \"icons\": Material Symbols " +
            "icons (4,157) by name, tag or category, each with its {\"Icon\": ...} call. kind \"capabilities\": the " +
            "capability ids (optionally under a prefix) with example counts. kind \"terms\": how words " +
            "resolve to capabilities, use cases and components.",
        choices: {
            examples: tool(examples, "find_examples"),
            components: tool(examples, "find_components"),
            capabilities: tool(examples, "list_capabilities"),
            terms: tool(examples, "resolve_terms"),
            icons: tool(examples, "find_icons"),
        },
    }),
    {
        name: "get",
        annotations: { title: "Get an example or a component", ...RO },
        description:
            "Fetch one catalog entry: an example by id (\"TIM-10\") with its JSON, meta, pitfalls and " +
            "renders (`parts` selects which), or a library component by name (\"Gauge\") with its call, " +
            "params and pitfalls (definition: true adds the full definition, to copy its structure).",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "Example id (e.g. \"EXP-06\") or component name (e.g. \"ProgressRing\")." },
                ...tool(examples, "get_example").inputSchema.properties,
                ...tool(examples, "get_component").inputSchema.properties,
                parts: { type: "array", items: { type: "string" }, description:
                    "For an example (default [\"meta\", \"json\"]): meta, json, expanded_json, snippets, render, rc_base64. " +
                    "For a component: demo_json, render (and definition: true for its full definition)." },
            },
        },
        handler: async ({ id, name, ...rest } = {}) => {
            const key = id ?? name;
            if (!key) throw new Error("get: give an example id or a component name");
            const out = await (/^[A-Z0-9]+-\d+/.test(key)
                ? tool(examples, "get_example").handler({ id: key, ...rest })
                : tool(examples, "get_component").handler({ name: key, ...rest }));
            // Compact JSON: documents are half the size without the indentation, which matters
            // in a model's context (and clients that re-fetch large results).
            return out.map((c) => {
                if (c.type !== "text") return c;
                try { return { ...c, text: JSON.stringify(JSON.parse(c.text)) }; } catch { return c; }
            });
        },
    },
    tool(examples, "check_component"),
    {
        name: "convert",
        annotations: { title: "Convert JSON to .rc (and check it)", ...RO },
        description:
            "Before writing a new document, call build_kit: it returns the components, layout patterns and " +
            "design rules for the goal (a UI is laid out with column/row/text and library components, not drawn " +
            "on one canvas). " +
            "Convert a RemoteCompose JSON document to a binary .rc (component calls expand " +
            "automatically). check: true also parses and runs the document like a player and reports " +
            "problems (and renders it unless render: false). expanded: true returns the plain JSON that " +
            "component calls become instead of converting.",
        inputSchema: {
            type: "object",
            properties: {
                json_path: { type: "string", description: "Path to the JSON document (same as input_path)." },
                ...tool(json2rc, "json2rc").inputSchema.properties,
                ...tool(examples, "expand_components").inputSchema.properties,
                check: { type: "boolean", description: "Also validate the result (parse, data pass, findings)." },
                render: { type: "boolean", description: "With check: also render it (default true)." },
                expanded: { type: "boolean", description: "Return the expanded JSON instead of converting." },
            },
        },
        handler: async ({ check, expanded, render: doRender, json_path, ...args } = {}) => {
            // One name for a JSON file everywhere: json2rc calls it input_path, the others json_path.
            const file = json_path ?? args.input_path;
            if (expanded) {
                const json = args.json ?? (file ? JSON.parse(readFileSync(resolveIn(file), "utf8")) : undefined);
                return tool(examples, "expand_components").handler({ ...args, json });
            }
            const out = await tool(json2rc, "json2rc").handler({ ...args, ...(file ? { input_path: file } : {}) });
            if (!check) return out;   // json2rc already appends the design warnings
            const { input_path: _, output_path: __, include_base64: ___, ...vargs } = args;
            const v = await tool(render, "validate").handler({ ...vargs, ...(file ? { json_path: file } : {}), render: doRender ?? true });
            return [...out, ...v];
        },
    },
    (() => {
        // render, plus componentTheme: the same JSON expanded for another look (the components'
        // mono, light or dark implementation), set on the JSON before rendering it. By default
        // ("auto") light and dark, by the system theme; "all" carries mono too, switched at run time.
        const t = tool(render, "render_rc");
        return {
            ...t, name: "render",
            description: t.description + " The result ends with the document's design warnings, if any (a UI hand-drawn on a canvas, " +
                "glyph icons, hard-coded dates or colours): fix them. componentTheme (\"mono\" or \"mono-inverted\") renders the monochrome look " +
                "of a JSON document (always-on displays, e-ink) without editing it: the same component calls, expanded with the components' mono " +
                "implementation. By default the document follows the system's light or dark theme.",
            inputSchema: { ...t.inputSchema, properties: { ...t.inputSchema.properties,
                variants: { type: "boolean", description: "Check every state in one call: light, dark and mono, narrow and wide, and (when the document reads the clock) another time of day, each image captioned. Use it before publishing." },
                componentTheme: { type: "string", enum: ["auto", "all", "light", "dark", "mono", "mono-inverted"], description: "For JSON input: the look to expand the components for. auto (default): light and dark by the system theme; mono / mono-inverted: the components' monochrome implementation; light / dark: that side only; all: every look in one larger document, mono switched by the host's theme.mono float." } } },
            handler: async ({ componentTheme, variants, ...args } = {}) => variants ? renderVariants(t, args) : withDesign(await (async () => {
                // One of width/height: the other from the document's own aspect ratio.
                if ((args.width === undefined) !== (args.height === undefined)) {
                    const h = jsonOf(args)?.header;
                    const r = h?.width && h?.height ? h.height / h.width : null;
                    if (!r) throw new Error("render: give both width and height (the document's header has no size to keep the ratio of)");
                    if (args.height === undefined) args = { ...args, height: Math.round(args.width * r) };
                    else args = { ...args, width: Math.round(args.height / r) };
                }
                if (!componentTheme) return t.handler(args);
                const json = args.json ?? (args.json_path ? JSON.parse(readFileSync(resolveIn(args.json_path), "utf8")) : null);
                if (!json) throw new Error("render: componentTheme needs a JSON document (json or json_path)");
                const { json_path: _, ...rest } = args;
                return t.handler({ ...rest, json: { ...(typeof json === "string" ? JSON.parse(json) : json), componentTheme } });
            })(), args, { first: true }),
        };
    })(),
    tool(inspect, "audit"),
    dispatcher({
        name: "inspect", title: "Inspect a document", selector: "task", fallback: "summary", annotations: RO,
        description:
            "Answer a question about a document (.rc or JSON). task: summary (default; what it is, sizes, " +
            "top findings), layout (the laid-out component tree with bounds), structure, variables, " +
            "theme, accessibility, interactions (click and touch targets), interact (run actions: taps, " +
            "variable changes, then report), runtime (repaint and per-frame cost), bytes (what the size " +
            "is made of), operations (list, filterable) and operation (one, by index).",
        choices: {
            summary: tool(inspect, "inspect_summary"),
            layout: tool(inspect, "inspect_layout"),
            structure: tool(inspect, "inspect_structure"),
            variables: tool(inspect, "inspect_variables"),
            theme: tool(inspect, "inspect_theme"),
            accessibility: tool(inspect, "inspect_accessibility"),
            interactions: tool(inspect, "list_interactions"),
            interact: tool(inspect, "interact"),
            runtime: tool(inspect, "inspect_runtime"),
            bytes: tool(inspect, "inspect_bytes"),
            operations: tool(inspect, "list_operations"),
            operation: tool(inspect, "get_operation"),
        },
    }),
    (() => {
        const t = tool(deploy, "package_web");
        // The publishing rules (JSON only, playground only, the design gate) are package_web's own,
        // for this server and rc-deploy alike. Here: no controls option, warnings at the top.
        return { ...t, name: "publish",
            description: t.description + " A public page is always the playground, made from the JSON (given a .rc that " +
                "convert wrote, its JSON beside it), and is refused while the document has structural design problems " +
                "(the result lists the fixes).",
            inputSchema: { ...t.inputSchema, properties: {
                ...Object.fromEntries(Object.entries(t.inputSchema.properties).filter(([k]) => k !== "controls")),
                layout: { type: "string", enum: ["fill", "fixed"], description: "Leave it out: the page fills the window and the document relayouts to it (the viewer can still pick sizes). \"fixed\" only when the user asks for one fixed size." } } },
            handler: async ({ controls: _ignored, ...args } = {}) => {
                // The layout: the page fills the window unless the user asked for a fixed size.
                args = { layout: "fill", ...args };
                const out = await t.handler(args);
                const src = args.json || args.json_path ? args : (args.rc_path ? { json_path: args.rc_path.replace(/\.rc$/i, ".json") } : args);
                const small = await smallSizeNote(src);
                return withDesign(small ? [{ type: "text", text: small }, ...out] : out, src, { first: true });
            } };
    })(),
    dispatcher({
        name: "pages", title: "Published pages", selector: "action", fallback: "list",
        description: "The pages published with publish: action \"list\" (default) or \"unpublish\" (with page_id).",
        choices: { list: tool(deploy, "list_pages"), unpublish: tool(deploy, "unpublish_page") },
    }),
];

// reference: the workflow, the authoring guide, or any tool's full documentation.
const describeTool = (t) => [`## ${t.name}`, "", t.description, "", "```json", JSON.stringify(t.inputSchema, null, 1), "```",
    ...(t.examples?.length ? ["", "Example arguments:", "```json", JSON.stringify(t.examples[0], null, 1), "```"] : [])].join("\n");
tools.push({
    name: "reference",
    annotations: { title: "Workflow, guides and tool documentation", ...RO },
    description:
        "topic \"workflow\" (default): how to go from a request to a verified document. topic \"format\": the " +
        "JSON essentials and its traps (layout vs canvas, text anchoring, sizes, expressions). topic " +
        "\"components\": the component authoring guide (syntax, light/dark/mono, animation, drawing " +
        "something the library lacks). topic \"tools\": every tool's full schema and options, or one " +
        "with tool: <name>.",
    inputSchema: {
        type: "object",
        properties: {
            topic: { type: "string", enum: ["workflow", "format", "components", "tools"] },
            tool: { type: "string", description: "With topic \"tools\": one tool name." },
        },
    },
    handler: async ({ topic = "workflow", tool: name } = {}) => {
        if (topic === "components") return tool(examples, "component_authoring_guide").handler({});
        if (topic === "format") return text(FORMAT);
        if (topic === "tools") {
            const list = name ? tools.filter((t) => t.name === name) : tools;
            if (!list.length) throw new Error(`no tool '${name}'`);
            return text(list.map(describeTool).join("\n\n"));
        }
        return text(WORKFLOW + "\n\nTools: " + tools.map((t) => t.name).join(", "));
    },
});

export const definition = {
    name: "remotecompose",
    version: "1.0.0",
    instructions: WORKFLOW,
    tools,
    // The public pages of the servers it includes, under this server's own base URL.
    async publicRoute(req, url, res) {
        for (const d of [render, deploy, examples]) {
            if (d.publicRoute && (await d.publicRoute(req, url, res))) return true;
        }
        return false;
    },
};

if (isMain(import.meta.url)) serve(definition);
