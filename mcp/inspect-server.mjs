#!/usr/bin/env node
// MCP server: the RemoteCompose inspector's analyses (inspector/src/panels), headless.
// Audit a document, and inspect its operations, layout, variables and expression graph,
// bytes, accessibility, interaction targets, repaint scheduling and per-frame work — and
// drive it with taps and drags to see what they change.
//
// Runs the TypeScript player and the inspector's own code in Node, no browser (see
// lib/inspector.mjs). Text is measured with Helvetica metrics, so layout sizes involving
// text are close to a browser's but not exact; pixels come from rc-render's C++ engine.
// stdio by default; `--http [PORT]` for Streamable HTTP (see lib/mcp-server.mjs).

import { rmSync, readFileSync } from "node:fs";
import { DOCUMENT_PROPS, prepareDocument } from "./lib/document.mjs";
import { inspect } from "./lib/inspector.mjs";
import { isMain, serve } from "./lib/mcp-server.mjs";
import { resolvePath, workspaceRoot } from "./lib/workspace.mjs";

// RC.pinClock counts seconds from this instant (players/typescript/src/core/ClockPin.ts).
const PIN_EPOCH = new Date(2026, 0, 1, 0, 0, 0, 0).getTime();

/** rc-render's clock forms -> epoch ms (local time). */
function clockMs(spec) {
    if (spec === undefined || spec === null) return Date.now();
    if (typeof spec === "number") return spec;
    const s = String(spec).trim();
    let m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
    if (m) {
        const d = new Date();
        d.setHours(+m[1], +m[2], +(m[3] ?? 0), 0);
        return d.getTime();
    }
    m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)).getTime();
    throw new Error(`clock: expected "HH:MM[:SS]", "YYYY-MM-DD", "YYYY-MM-DDTHH:MM[:SS]" or epoch milliseconds, got ${JSON.stringify(spec)}`);
}

const VIEW_PROPS = {
    width: { type: "number", description: "Width to lay the document out at, in dp (default: the document's declared width)." },
    height: { type: "number", description: "Height to lay the document out at, in dp (default: the declared height)." },
    density: { type: "number", description: "Display density; layout space is width x density pixels. Default 1, so coordinates are dp." },
    theme: { type: "string", enum: ["light", "dark"], description: "Colour theme (default: the player's, which follows the document)." },
    clock: {
        description:
            "Pin the clock (date and time of day) the document sees: \"HH:MM[:SS]\" (today), \"YYYY-MM-DD\", " +
            "\"YYYY-MM-DDTHH:MM[:SS]\", or epoch milliseconds. Default: the time of the call. It is " +
            "pinned for the whole run either way, advancing only with simulated frames.",
        anyOf: [{ type: "string" }, { type: "number" }],
    },
    variables: {
        type: "object",
        description: "Host variables to set before anything runs, {name: value} (float, int, colour \"#AARRGGBB\", string).",
        additionalProperties: { anyOf: [{ type: "number" }, { type: "string" }] },
    },
};

const BASE_PROPS = { ...DOCUMENT_PROPS, ...VIEW_PROPS };

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/** Every tool: prepare the document (JSON converts with json2rc), run one inspector task. */
function tool(name, title, description, task, extraProps = {}, { required = [], examples = [], mapOptions } = {}) {
    return {
        name,
        annotations: { title, ...READ_ONLY },
        description: description + (workspaceRoot() ? " Paths are relative to the server's workspace." : ""),
        examples,
        inputSchema: { type: "object", properties: { ...BASE_PROPS, ...extraProps }, ...(required.length ? { required } : {}) },
        handler: async (a) => {
            const doc = prepareDocument(a);
            if (doc.conversionError) throw new Error(doc.conversionError);
            try {
                const bytes = new Uint8Array(readFileSync(doc.rcPath));
                const options = {
                    width: a.width, height: a.height, density: a.density, theme: a.theme, variables: a.variables,
                    clock: (clockMs(a.clock) - PIN_EPOCH) / 1000,
                    ...(mapOptions ? mapOptions(a) : {}),
                    // The JSON as written, for the design audit (before library components expand).
                    ...(doc.source === "json" && (task === "audit" || task === "summary") ? { source_json: sourceJson(a) } : {}),
                };
                for (const k of ["width", "height", "density"]) {
                    if (options[k] !== undefined && !(typeof options[k] === "number" && options[k] > 0)) throw new Error(`${k} must be a number > 0`);
                }
                const result = await inspect(bytes, task, options);
                const text = typeof result === "string" ? result : JSON.stringify(result, null, 1);
                return [{ type: "text", text }];
            } finally {
                if (doc.temp) rmSync(doc.rcPath, { force: true });
            }
        },
    };
}

/** The JSON document given (json or json_path), parsed; undefined when it cannot be read. */
function sourceJson(a) {
    try {
        if (a.json !== undefined) return typeof a.json === "string" ? JSON.parse(a.json) : a.json;
        if (a.json_path !== undefined) return JSON.parse(readFileSync(resolvePath(a.json_path, "json_path"), "utf8"));
    } catch {}
    return undefined;
}

const pick = (...keys) => (a) => Object.fromEntries(keys.filter((k) => a[k] !== undefined).map((k) => [k, a[k]]));

export const definition = {
    name: "rc-inspect",
    version: "1.0.0",
    // Read by the guide server (guide-server.mjs); not part of the MCP protocol.
    guide: {
        summary:
            "The RemoteCompose inspector, headless: audits a document (layout problems, dead code, " +
            "accessibility, repaint cost, size) and inspects its operations, layout tree, variables " +
            "and expression graph, bytes, interaction targets and per-frame work — and drives it with " +
            "taps and drags to show what they change.",
        useWhen: [
            "you want to know what is wrong with, or could be better in, a document (audit)",
            "you need to understand a document you did not write: its structure, layout, variables, expressions",
            "a value or layout is wrong and you want to trace which expression or operation produces it",
            "you want to know what a tap or drag does, or why a document repaints every frame",
            "a document is too big, and you want to know where the bytes are",
        ],
        notFor: [
            "a picture: rc-render's render_rc (this server lays out and runs documents but draws nothing)",
            "checking that the C++ engine parses a file: rc-render's validate",
        ],
    },
    instructions:
        "Inspects RemoteCompose documents (.rc or JSON; JSON goes through json2rc first) with the " +
        "inspector's own analysis code, running the TypeScript player headless. Start with " +
        "inspect_summary or audit; then drill down with list_operations / get_operation, " +
        "inspect_layout, inspect_variables (trace one with `variable`), inspect_bytes, " +
        "inspect_accessibility, list_interactions + interact, inspect_runtime. All coordinates are " +
        "layout space: dp at the default density 1. Text is measured with standard font metrics, " +
        "so text-dependent sizes are close to a device's, not exact. Results are deterministic: " +
        "the clock is pinned (default: the time of the call) and frames are simulated.",
    tools: [
        tool("inspect_summary", "Summarise a RemoteCompose document",
            "One-call overview of a document: header and size, operation counts, where the bytes go, " +
            "component tree size, variables and expressions, host variables with values, interaction " +
            "targets, accessibility, theme, repaint verdict, and the audit's counts and top findings. " +
            "Start here.",
            "summary", {}, { examples: [{ what: "Overview of a JSON document", arguments: { json_path: "docs/card.json" } }] }),

        tool("audit", "Audit a RemoteCompose document",
            "Find problems and improvements, each with severity, a code, an explanation and examples " +
            "(component ids and bounds, or operation indices): zero-size components, content overflowing " +
            "the layout box, deep nesting, empty containers; dead code (expressions nothing uses, unread " +
            "variables); clickable components without accessibility semantics or labels; continuous " +
            "repaints; operations never executed over a short run; size dominated by one category or op; " +
            "and design problems, each naming the fix: symbols/emoji drawn as text icons (glyph_icon), " +
            "the same subtree written out many times instead of an inline component (repeated_subtree, " +
            "JSON input only), dates typed in instead of read from the clock (hardcoded_date), and " +
            "literal colours that cannot follow light/dark/mono (hardcoded_colors, JSON input only). " +
            "Also float expressions longer than Android accepts (expression_too_long: over 32 entries, the document fails to load on a device although it renders here). " +
            "Re-run at other sizes (width/height) to find size-dependent problems.",
            "audit", { frames: { type: "integer", description: "Frames simulated for execution coverage (default 30)." } },
            { mapOptions: pick("frames"), examples: [{ what: "Audit at a phone size", arguments: { rc_path: "docs/card.rc", width: 360, height: 780 } }] }),

        tool("list_operations", "List a document's operations",
            "Disassembly: every operation in document order with its index (use with get_operation), " +
            "name, opcode, byte offset and size, decoded parameters, and the formula of expressions. " +
            "Filter by a regex over names and parameters, an index range, or a variable id that the " +
            "operation reads or writes. Paged: offset/limit (default 200).",
            "operations", {
                filter: { type: "string", description: "Regex matched against the operation name and its parameters, e.g. \"Text|Click\"." },
                from: { type: "integer", description: "First operation index (default 0)." },
                to: { type: "integer", description: "Last operation index (default: the last)." },
                references: { type: "integer", description: "Only operations that read or write this variable id." },
                offset: { type: "integer", description: "Skip this many matches (paging)." },
                limit: { type: "integer", description: "At most this many (default 200)." },
            }, { mapOptions: pick("filter", "from", "to", "references", "offset", "limit") }),

        tool("get_operation", "Describe one operation",
            "Everything about one operation by index: decoded parameters (with the variable each slot " +
            "reads), the variables it reads and writes, the operations that read what it writes, its " +
            "formula and current value for expressions.",
            "operation", { index: { type: "integer", description: "Operation index, from list_operations." } },
            { required: ["index"], mapOptions: (a) => {
                if (!Number.isInteger(a.index)) throw new Error("index (an integer from list_operations) is required");
                return { index: a.index };
            } }),

        tool("inspect_layout", "Show a document's layout",
            "The laid-out component tree at a size: each component's type, id, bounds (x, y, w, h in " +
            "layout space), padding, modifiers, text and visibility — as an indented outline (default) " +
            "or JSON — plus layout diagnostics. Change width/height to see how it responds.",
            "layout", {
                max_depth: { type: "integer", description: "Collapse components deeper than this." },
                format: { type: "string", enum: ["outline", "json"], description: "Default outline." },
            }, { mapOptions: pick("max_depth", "format"),
                 examples: [{ what: "Layout at tablet width, 4 levels", arguments: { rc_path: "docs/card.rc", width: 800, height: 1280, max_depth: 4 } }] }),

        tool("inspect_structure", "Decompile a document's component tree",
            "The document decompiled to a component tree with modifiers and their parameters (the " +
            "inspector's JSON view): the logical structure, independent of the laid-out geometry.",
            "structure"),

        tool("inspect_variables", "Inspect variables and expressions",
            "Every variable: id, name (host or system variables), kind (constant, expression, system...), " +
            "formula, current value, the variables it reads and feeds, the operations that consume it, " +
            "and whether it is unused; plus statistics (chain depth, fan-out, root drivers). With " +
            "`variable` (an id or a name), trace one instead: everything upstream it depends on, " +
            "everything downstream it affects, and the operations that read it.",
            "variables", {
                variable: { anyOf: [{ type: "integer" }, { type: "string" }], description: "Trace this variable (id, or host/system name)." },
                kind: { type: "string", description: "Only this kind, e.g. \"float_expr\", \"constant\", \"sys_var\"." },
                only_unused: { type: "boolean", description: "Only variables nothing uses." },
                only_named: { type: "boolean", description: "Only host and system variables." },
                limit: { type: "integer", description: "At most this many (default 300)." },
            }, { mapOptions: pick("variable", "kind", "only_unused", "only_named", "limit"),
                 examples: [{ what: "What drives the clock hand?", arguments: { rc_path: "docs/clock.rc", variable: 63 } }] }),

        tool("inspect_bytes", "Show where a document's bytes go",
            "Size breakdown: bytes and share per category (layout, modifiers, text, paths, bitmaps, " +
            "variables...), per operation type, and the largest single operations.",
            "bytes", { limit: { type: "integer", description: "How many of the largest operations (default 20)." } },
            { mapOptions: pick("limit") }),

        tool("inspect_accessibility", "Show a document's accessibility tree",
            "What a screen reader sees: each component with its role, label (contentDescription), text, " +
            "state, clickable/enabled flags and bounds, whether the document has semantics at all, and " +
            "its click areas.",
            "accessibility"),

        tool("list_interactions", "List interaction targets",
            "Everything that responds to input: click targets (component, bounds, centre, click type, the " +
            "actions they run), named click areas, and touch-driven variables. Feed a target's index or " +
            "centre to interact.",
            "interactions"),

        tool("interact", "Drive a document with input and see what changes",
            "Run a sequence of actions — wait, tap a target or a point, drag, set host variables — and " +
            "report what the input changed: every variable whose value differs from the same timeline " +
            "without the input (with its formula), host variables, and components whose bounds or " +
            "visibility changed. Time-driven changes are excluded by that comparison. Coordinates are " +
            "layout space.",
            "interact", {
                actions: {
                    type: "array",
                    description: "In order. Each is one of {wait: seconds}, {target: index from list_interactions}, " +
                        "{tap: [x, y]}, {drag: [x0, y0, x1, y1], steps?: n}, {variables: {name: value}}.",
                    items: { type: "object" },
                },
                settle: { type: "number", description: "Seconds simulated after the last action before comparing (default 0.5)." },
                include_layout: { type: "boolean", description: "Also return the layout outline afterwards." },
                max_depth: { type: "integer", description: "With include_layout: collapse deeper components." },
                limit: { type: "integer", description: "At most this many changed variables (default 40)." },
            }, { required: ["actions"], mapOptions: pick("actions", "settle", "include_layout", "max_depth", "limit"),
                 examples: [
                     { what: "Tap the first target, then let animations settle", arguments: { rc_path: "docs/toggle.rc", actions: [{ target: 0 }, { wait: 0.5 }] } },
                     { what: "Swipe a list up", arguments: { rc_path: "docs/list.rc", actions: [{ drag: [180, 600, 180, 200] }, { wait: 1 }] } },
                 ] }),

        tool("inspect_runtime", "Profile a document's frames",
            "What running the document costs and why it repaints: the repaint verdict (continuous, " +
            "scheduled, idle) with the operations causing it; operations executed per frame over a " +
            "simulated run (min/median/mean/max, by type, hottest operations); and execution coverage " +
            "(operations never executed).",
            "runtime", {
                frames: { type: "integer", description: "Frames to simulate (default 60)." },
                fps: { type: "number", description: "Simulated frame rate (default 60)." },
            }, { mapOptions: pick("frames", "fps") }),

        tool("inspect_theme", "Show a document's theme tokens",
            "Named colours (Material dynamic-colour roles and others) with their values and categories, " +
            "named floats such as the font scale, and the document's light/dark theme sections.",
            "theme"),
    ],
};

if (isMain(import.meta.url)) serve(definition);
