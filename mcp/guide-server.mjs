#!/usr/bin/env node
// MCP server: the single entry point that explains the other RemoteCompose MCP servers —
// what each is for, when to use it, how to connect, and every tool's options.
//
// Built from the servers' own definitions (imported, not copied), so the options it lists
// are the schemas the servers actually accept. Adding a server = adding it to SERVERS.
// stdio by default; `--http [PORT]` for Streamable HTTP (see lib/mcp-server.mjs).

import { isMain, serve } from "./lib/mcp-server.mjs";
import { definition as deploy } from "./deploy-server.mjs";
import { definition as inspector } from "./inspect-server.mjs";
import { definition as json2rc } from "./json2rc-server.mjs";
import { definition as rcRender } from "./rc-render-server.mjs";
import { definition as examples } from "./examples-server.mjs";

// Where each server lives: its entry file, and its path under MCP_PUBLIC_BASE_URL on a
// deployment (mcp/deploy/Caddyfile routes /<route>/mcp to it).
const SERVERS = [
    { def: json2rc, file: "mcp/json2rc-server.mjs", route: "json2rc" },
    { def: rcRender, file: "mcp/rc-render-server.mjs", route: "rc-render" },
    { def: inspector, file: "mcp/inspect-server.mjs", route: "inspect" },
    { def: deploy, file: "mcp/deploy-server.mjs", route: "deploy" },
    { def: examples, file: "mcp/examples-server.mjs", route: "examples" },
];

const SELF = {
    name: "rc-guide",
    file: "mcp/guide-server.mjs",
    route: "guide",
    summary: "Describes the RemoteCompose MCP servers: what each does, when to use it, and every option.",
};

const WORKFLOWS = [
    {
        title: "Build a document from scratch",
        steps: ["rc-examples.build_kit with the goal in plain words: the components to call and the " +
                "examples (with their JSON snippets and pitfalls) that cover it.",
                "Write the document, calling components by name ({\"Button\": {...}}).",
                "rc-render.validate, then render_rc; rc-inspect.audit before calling it done."],
    },
    {
        title: "See what a JSON document looks like",
        steps: ["rc-render.render_rc with `json` or `json_path` — no separate conversion step.",
                "Pin `clock` (and `seed` if it uses rand()) so the picture is reproducible."],
    },
    {
        title: "Find out why a document renders wrong, or not at all",
        steps: ["rc-render.validate — conversion error, parse failure location, or sanity findings " +
                "(blank image, missing fonts, single-frame particles).",
                "Fix, then render_rc and read its findings before trusting the picture."],
    },
    {
        title: "Review a document: what is wrong, what could be better",
        steps: ["rc-inspect.inspect_summary — size, structure, variables, interactions, repaint, and the audit's top findings.",
                "rc-inspect.audit — every finding with severity, explanation and the components or operations involved. " +
                "Re-run at other sizes (width/height): many layout problems only show at some sizes.",
                "Drill into a finding: inspect_layout for geometry, get_operation for an op index, " +
                "inspect_variables with `variable` to trace a value."],
    },
    {
        title: "Understand a document you did not write",
        steps: ["rc-inspect.inspect_structure (component tree) and inspect_layout (geometry at a size).",
                "rc-inspect.inspect_variables — every expression with its formula; `variable` traces one up and down.",
                "rc-inspect.list_interactions, then interact — what each tap or drag actually changes."],
    },
    {
        title: "Drive a document's host variables",
        steps: ["rc-render.validate with render: false — `namedVariables` lists each name, type and initial value.",
                "rc-render.render_rc with `variables: {name: value}`."],
    },
    {
        title: "Show a document after interaction",
        steps: ["rc-render.render_rc with `touch_events` in document coordinates (the layout size, " +
                "not output pixels) and a `duration` long enough for flings/animations to settle.",
                "The captured frame is the last one, at `clock`."],
    },
    {
        title: "Share a document as a web page, or explore how it behaves",
        steps: ["rc-render.validate first — package only what validates.",
                "rc-deploy.package_web — one self-contained HTML page (TypeScript player + document). " +
                "On a deployment it is published and the public link returned; ?name=value in that " +
                "link sets host variables.",
                "By default the page is a playground: resize freely, try device presets, edit host " +
                "variables live, change density/theme — then copy a link to exactly that state. " +
                "controls: false for the bare player (embedding, kiosks).",
                "Open the page to check it: it runs the TypeScript engine, which can differ from rc-render's C++ one.",
                "rc-deploy.list_pages / unpublish_page to manage what is live."],
    },
    {
        title: "Produce the .rc file",
        steps: ["json2rc.json2rc — writes the file and returns rc_path; render_rc on the same machine can read that path."],
    },
];

const CONCEPTS = [
    "Coordinates: touch x/y are in document space — the width/height the document is laid out at. " +
    "output_width/output_height only scale the final image.",
    "Time: without `clock` every time variable reads the wall clock, so two renders differ. " +
    "With touch_events or duration the clock advances frame by frame and the last frame lands at `clock`.",
    "Paths: on a remote (HTTP) deployment every path is relative to the server's workspace and " +
    "cannot leave it; prefer inline `json` / `rc_base64` there. Both servers share the workspace.",
    "Errors: the converter refuses what it does not support rather than approximating, so an " +
    "error names the construct. Tool errors come back as isError results with the message.",
];

// ── Rendering a JSON schema as readable option docs ──────────────────

function typeOf(s) {
    if (!s) return "any";
    if (s.enum) return s.enum.map((v) => JSON.stringify(v)).join(" | ");
    if (s.anyOf) return s.anyOf.map(typeOf).join(" | ");
    if (s.type === "array") return `${s.items ? typeOf(s.items) : "any"}[]`;
    if (s.type === "object" && s.additionalProperties) return `{name: ${typeOf(s.additionalProperties)}}`;
    if (s.type === "object" && s.properties) return "object";
    return s.type ?? "any";
}

function optionLines(schema, indent = "") {
    const required = new Set(schema.required ?? []);
    const lines = [];
    for (const [name, s] of Object.entries(schema.properties ?? {})) {
        lines.push(`${indent}- \`${name}\` (${typeOf(s)}${required.has(name) ? ", required" : ""})` +
                   (s.description ? ` — ${s.description}` : ""));
        const item = s.type === "array" ? s.items : null;
        if (item?.properties) lines.push(...optionLines(item, indent + "  "));
    }
    return lines;
}

const firstSentence = (text) => (text.match(/^.*?[.!?](\s|$)/)?.[0] ?? text).trim();

function endpoints(entry) {
    const base = (process.env.MCP_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
    const out = [`local (stdio): \`node ${entry.file}\``];
    if (base) out.push(`remote (HTTP): \`${base}/${entry.route}/mcp\` (Authorization: Bearer <token>, or the token as a last path segment)`);
    return out;
}

// ── Output ───────────────────────────────────────────────────────────

function overviewMarkdown() {
    const base = (process.env.MCP_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
    const md = ["# RemoteCompose MCP servers", "",
        "**One endpoint for everything: `remotecompose`** " + (base ? `(${base}/mcp)` : "(remotecompose-server.mjs)") +
        ". It regroups every tool below into eleven (build_kit, find, get, check_component, convert, render, audit, " +
        "inspect, publish, pages, reference) with one workflow in its instructions; prefer it to configuring the " +
        "single-purpose servers, which remain available.", "",
        `${SERVERS.length + 1} single-purpose servers follow. \`describe\` gives every option of a server or tool.`, ""];
    for (const entry of SERVERS) {
        const { def } = entry;
        md.push(`## ${def.name}`, "", def.guide?.summary ?? "", "");
        if (def.guide?.useWhen?.length) md.push("Use it when:", ...def.guide.useWhen.map((x) => `- ${x}`), "");
        if (def.guide?.notFor?.length) md.push("Not for:", ...def.guide.notFor.map((x) => `- ${x}`), "");
        md.push("Tools:", ...def.tools.map((t) => `- \`${t.name}\` — ${firstSentence(t.description)}`), "");
        md.push("Connect:", ...endpoints(entry).map((x) => `- ${x}`), "");
    }
    md.push(`## ${SELF.name}`, "", SELF.summary, "",
            "Tools:", "- `overview` — this page.", "- `describe` — full options and examples for a server or tool.", "",
            "Connect:", ...endpoints(SELF).map((x) => `- ${x}`), "");
    md.push("## Common tasks", "");
    for (const w of WORKFLOWS) md.push(`**${w.title}**`, ...w.steps.map((s, i) => `${i + 1}. ${s}`), "");
    md.push("## Things that apply everywhere", "", ...CONCEPTS.map((c) => `- ${c}`), "");
    return md.join("\n");
}

function toolMarkdown(serverName, tool) {
    const md = [`### ${serverName}.${tool.name}`, "", tool.description, "", "Options:",
                ...optionLines(tool.inputSchema), ""];
    if (tool.examples?.length) {
        md.push("Examples:");
        for (const ex of tool.examples) md.push(`- ${ex.what}:`, "  ```json", `  ${JSON.stringify(ex.arguments)}`, "  ```");
        md.push("");
    }
    return md.join("\n");
}

function findServer(name) {
    const entry = SERVERS.find((e) => e.def.name === name);
    if (!entry) {
        throw new Error(`unknown server "${name}". Servers: ${SERVERS.map((e) => e.def.name).join(", ")}`);
    }
    return entry;
}

function describeMarkdown(server, tool) {
    const entries = server ? [findServer(server)] : SERVERS;
    const md = [];
    for (const entry of entries) {
        const { def } = entry;
        let tools = def.tools;
        if (tool) {
            tools = tools.filter((t) => t.name === tool);
            if (!tools.length) {
                throw new Error(`server ${def.name} has no tool "${tool}". Tools: ${def.tools.map((t) => t.name).join(", ")}`);
            }
        }
        if (!tool) {
            md.push(`## ${def.name} (v${def.version})`, "", def.guide?.summary ?? "", "");
            if (def.instructions) md.push(def.instructions, "");
            md.push("Connect:", ...endpoints(entry).map((x) => `- ${x}`), "");
        }
        for (const t of tools) md.push(toolMarkdown(def.name, t));
    }
    return md.join("\n");
}

function catalogJson() {
    return {
        servers: SERVERS.map(({ def, file, route }) => ({
            name: def.name, version: def.version, file, route,
            ...def.guide, instructions: def.instructions,
            tools: def.tools.map(({ name, description, inputSchema, examples }) =>
                ({ name, description, inputSchema, examples })),
        })),
        workflows: WORKFLOWS,
        concepts: CONCEPTS,
    };
}

export const definition = {
    name: SELF.name,
    version: "1.0.0",
    instructions:
        "Start here to learn which RemoteCompose MCP server and tool fits a task. `overview` " +
        "summarises every server (what it does, when to use it, how to connect) and common " +
        "tasks; `describe` gives a server's or tool's full options with examples.",
    tools: [{
        name: "overview",
        // Clients such as ChatGPT gate tools on these: read-only ones run without a write
        // confirmation. Only scratch files it deletes again are written.
        annotations: { title: "Overview of the RemoteCompose MCP servers", readOnlyHint: true, openWorldHint: false },
        description:
            "Summarise the RemoteCompose MCP servers: what each one does, when to use it (and " +
            "when not), its tools, how to connect, and the common tasks with the tool to use " +
            "for each. Read this first.",
        inputSchema: { type: "object", properties: {} },
        handler: async () => [{ type: "text", text: overviewMarkdown() }],
    }, {
        name: "describe",
        // Clients such as ChatGPT gate tools on these: read-only ones run without a write
        // confirmation. Only scratch files it deletes again are written.
        annotations: { title: "Describe a server or tool", readOnlyHint: true, openWorldHint: false },
        description:
            "Full documentation for a server or one of its tools: every option with its type " +
            "and meaning, and example arguments. With no arguments, documents every tool of " +
            "every server. format \"json\" returns the raw schemas instead of markdown.",
        inputSchema: {
            type: "object",
            properties: {
                server: { type: "string", enum: SERVERS.map((e) => e.def.name), description: "Server to describe (default: all)." },
                tool: { type: "string", description: "One tool of that server (default: all its tools)." },
                format: { type: "string", enum: ["markdown", "json"], description: "Default markdown." },
            },
        },
        handler: async ({ server, tool, format }) => {
            if (tool && !server) {
                const owner = SERVERS.find((e) => e.def.tools.some((t) => t.name === tool));
                if (!owner) throw new Error(`no server has a tool "${tool}"`);
                server = owner.def.name;
            }
            if (format === "json") {
                let cat = catalogJson();
                if (server) {
                    findServer(server);
                    cat = { ...cat, servers: cat.servers.filter((s) => s.name === server)
                        .map((s) => (tool ? { ...s, tools: s.tools.filter((t) => t.name === tool) } : s)) };
                }
                return [{ type: "text", text: JSON.stringify(cat, null, 1) }];
            }
            return [{ type: "text", text: describeMarkdown(server, tool) }];
        },
    }],
};

if (isMain(import.meta.url)) serve(definition);
