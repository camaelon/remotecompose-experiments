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
import { readFileSync } from "node:fs";
import { resolvePath } from "./lib/workspace.mjs";
import { designNotes, blockingFindings } from "./lib/design-audit.mjs";

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
- Colours: theme colours "@colors.onSurface" etc. (light, dark and mono follow); literal "#AARRGGBB" otherwise.
- Expressions are strings: "componentWidth() / 2", "@progress * 360"; Android rejects one over 32 entries:
  split long formulas into named variables.
- Anything that depends on the date or time (today, this month, "in 3 days") is computed from the clock
  (dayOfMonth(), calendarMonth(), year(), timeInMin(), ...), never typed in.
- Icons: {"Icon": {"name": "wifi"}} (find kind "icons"), never text glyphs or emoji.`;

const tools = [
    {
        ...tool(examples, "build_kit"),
        description: "START HERE for a new document. " + tool(examples, "build_kit").description,
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
            },
        },
        handler: async ({ id, name, ...rest } = {}) => {
            const key = id ?? name;
            if (!key) throw new Error("get: give an example id or a component name");
            return /^[A-Z0-9]+-\d+/.test(key)
                ? tool(examples, "get_example").handler({ id: key, ...rest })
                : tool(examples, "get_component").handler({ name: key, ...rest });
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
        // render, plus componentTheme: the mono variants are chosen when the document is
        // expanded (not a player theme), so they are set on the JSON before rendering it.
        const t = tool(render, "render_rc");
        return {
            ...t, name: "render",
            description: t.description + " The result ends with the document's design warnings, if any (a UI hand-drawn on a canvas, " +
                "glyph icons, hard-coded dates or colours): fix them. componentTheme (\"mono\" or \"mono-inverted\") renders the monochrome variant " +
                "of a JSON document (always-on displays, e-ink) without editing it.",
            inputSchema: { ...t.inputSchema, properties: { ...t.inputSchema.properties,
                componentTheme: { type: "string", enum: ["auto", "light", "dark", "mono", "mono-inverted"], description: "For JSON input: the component theme to expand with." } } },
            handler: async ({ componentTheme, ...args } = {}) => withDesign(await (async () => {
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
        return { ...t, name: "publish",
            description: t.description + " A JSON document with structural design problems (the whole UI drawn on one canvas, " +
                "fixed coordinates that don't relayout, text cut by its anchor, glyph icons, expressions Android rejects) is " +
                "NOT published: fix them first (the result says how). Only if the user explicitly wants it as it is, pass " +
                "accept_design_warnings: true with a reason.",
            // Always the playground (controls): the bare-player page (controls: false) hides the
            // document's JSON, the variables and the theme, so it is not offered for now.
            inputSchema: { ...t.inputSchema, properties: { ...Object.fromEntries(Object.entries(t.inputSchema.properties).filter(([k]) => k !== "controls")),
                accept_design_warnings: { type: "boolean", description: "Publish despite blocking design warnings (only when the user asked for it as it is)." },
                reason: { type: "string", description: "With accept_design_warnings: why (logged)." } } },
            handler: async ({ accept_design_warnings, reason, controls: _ignored, ...args } = {}) => {
                args = { ...args, controls: true };
                const json = jsonOf(args);
                const blocking = json ? blockingFindings(json) : [];
                if (blocking.length && !(accept_design_warnings && reason)) {
                    throw new Error("Not published: the document has design problems that make it break on other screens or devices. " +
                        "Fix them, render again to check, then publish.\n" +
                        blocking.map((f) => `- [${f.code}] ${f.title}. ${f.message}`).join("\n") +
                        "\n(build_kit's layout_model shows the structure to use; reference topic \"format\" has the rules.)");
                }
                return withDesign(await t.handler(args), args, { first: true });
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
