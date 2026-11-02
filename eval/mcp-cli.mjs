// mcp-cli.mjs: call the RemoteCompose MCP tools from the shell, as an MCP client would. It is
// how the eval prompts (prompt.md) are run blind: an assistant that sees only these commands.
//   node eval/mcp-cli.mjs list                         servers, their instructions and tools
//   node eval/mcp-cli.mjs describe <server> <tool>     a tool's description and input schema
//   node eval/mcp-cli.mjs call <server> <tool> ARGS    ARGS: inline JSON or @file.json
// Text results print to stdout; images are saved under ./out/ and their paths printed. Paths in
// ARGS are relative to the current directory (MCP_ROOT), so run it from the eval run's folder.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
const R = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "mcp");
const SERVERS = { "remotecompose": "remotecompose-server.mjs", "rc-examples": "examples-server.mjs", "rc-render": "rc-render-server.mjs", "rc-inspect": "inspect-server.mjs",
                  "json2rc": "json2rc-server.mjs", "guide": "guide-server.mjs" };
process.env.MCP_ROOT ??= process.cwd();
process.env.MCP_ALLOW_NO_AUTH = "1";
// RC_TRACE=file: one JSON line per call, for eval/run-trace.py and by-hand reading: what was asked
// (documents as their size), what came back, and for a kit what it offered.
function trace({ tool, args, ms, res, error }) {
    if (!process.env.RC_TRACE) return;
    const small = Object.fromEntries(Object.entries(args).map(([k, v]) => { const s = typeof v === "string" ? v : JSON.stringify(v); return [k, s.length > 300 ? `<${s.length} chars>` : v]; }));
    const items = res ? (Array.isArray(res) ? res : res.content ?? [res]) : [];
    const text = items.filter((c) => c.type === "text").map((c) => c.text).join("\n");
    const line = { at: new Date().toISOString(), tool, args: small, ms, ...(error ? { error } : {}), result_chars: text.length, images: items.filter((c) => c.type === "image").length,
        no_faults: /NO FAULTS FOUND/.test(text), warnings: (text.match(/\bwarning\b/gi) ?? []).length };
    if (tool === "build_kit") { try { const k = JSON.parse(text); line.kit = { structure: k.structure?.id, model: k.layout_model?.id, components: (k.components ?? []).map((c) => c.name), examples: (k.examples ?? []).map((e) => e.id), rules: (k.rules ?? k.design_rules ?? []).map((r) => r.rule) }; } catch {} }
    appendFileSync(process.env.RC_TRACE, JSON.stringify(line) + "\n");
}
const load = async (s) => (await import(path.join(R, SERVERS[s]))).definition;
const [cmd, server, tool, raw] = process.argv.slice(2);
if (cmd === "list") {
    for (const s of Object.keys(SERVERS)) {
        const d = await load(s);
        console.log(`== ${s}\n${d.instructions ?? ""}\ntools:`);
        for (const t of d.tools) {
            const props = t.inputSchema?.properties ?? {};
            const req = new Set(t.inputSchema?.required ?? []);
            const params = Object.keys(props).map((k) => (req.has(k) ? k + "*" : k)).join(", ");
            console.log(`  ${t.name}(${params})\n      ${String(t.description ?? "").replace(/\n/g, "\n      ")}`);
        }
        console.log("");
    }
} else if (cmd === "describe") {
    const t = (await load(server)).tools.find((x) => x.name === tool);
    console.log(t.description + "\n" + JSON.stringify(t.inputSchema, null, 1));
} else if (cmd === "call") {
    const def = await load(server);
    const t = def.tools.find((x) => x.name === tool);
    if (!t) { console.log(`Error: ${server} has no tool "${tool}". Its tools: ${def.tools.map((x) => x.name).join(", ")}`); process.exit(1); }
    const args = raw ? JSON.parse(raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw) : {};
    // A tool error is what an MCP client shows: the message, not a stack trace.
    let res;
    const started = Date.now();
    try { res = await t.handler(args); } catch (e) { trace({ tool, args, ms: Date.now() - started, error: String(e?.message ?? e) }); console.log(`Error: ${e?.message ?? e}`); process.exit(1); }
    trace({ tool, args, ms: Date.now() - started, res });
    mkdirSync("out", { recursive: true });
    let n = 0;
    const stamp = Date.now();
    const items = Array.isArray(res) ? res : res.content ?? [res];
    // An image the server already wrote where the caller asked (png_path / "→ file") is not
    // saved a second time under a generated name.
    const named = items.some((c) => c.type === "text" && /png_path: |→ \S+\.png/.test(c.text));
    for (const c of items) {
        if (c.type === "image") { if (named) continue; const f = `out/${tool}-${stamp}-${n++}.png`; writeFileSync(f, Buffer.from(c.data, "base64")); console.log(`[image saved: ${f}]`); }
        else if (c.type === "text") console.log(c.text);
        else console.log(JSON.stringify(c));
    }
} else console.log("usage: node mcp.mjs list | describe <server> <tool> | call <server> <tool> '<json>'|@file");
