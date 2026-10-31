// mcp-cli.mjs: call the RemoteCompose MCP tools from the shell, as an MCP client would. It is
// how the eval prompts (prompt.md) are run blind: an assistant that sees only these commands.
//   node eval/mcp-cli.mjs list                         servers, their instructions and tools
//   node eval/mcp-cli.mjs describe <server> <tool>     a tool's description and input schema
//   node eval/mcp-cli.mjs call <server> <tool> ARGS    ARGS: inline JSON or @file.json
// Text results print to stdout; images are saved under ./out/ and their paths printed. Paths in
// ARGS are relative to the current directory (MCP_ROOT), so run it from the eval run's folder.
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
const R = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "mcp");
const SERVERS = { "remotecompose": "remotecompose-server.mjs", "rc-examples": "examples-server.mjs", "rc-render": "rc-render-server.mjs", "rc-inspect": "inspect-server.mjs",
                  "json2rc": "json2rc-server.mjs", "guide": "guide-server.mjs" };
process.env.MCP_ROOT ??= process.cwd();
process.env.MCP_ALLOW_NO_AUTH = "1";
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
            console.log(`  ${t.name}(${params})\n      ${String(t.description ?? "").split(/(?<=\.)\s/)[0].slice(0, 200)}`);
        }
        console.log("");
    }
} else if (cmd === "describe") {
    const t = (await load(server)).tools.find((x) => x.name === tool);
    console.log(t.description + "\n" + JSON.stringify(t.inputSchema, null, 1));
} else if (cmd === "call") {
    const t = (await load(server)).tools.find((x) => x.name === tool);
    const args = raw ? JSON.parse(raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw) : {};
    const res = await t.handler(args);
    mkdirSync("out", { recursive: true });
    let n = 0;
    const stamp = Date.now();
    for (const c of Array.isArray(res) ? res : res.content ?? [res]) {
        if (c.type === "image") { const f = `out/${tool}-${stamp}-${n++}.png`; writeFileSync(f, Buffer.from(c.data, "base64")); console.log(`[image saved: ${f}]`); }
        else if (c.type === "text") console.log(c.text);
        else console.log(JSON.stringify(c));
    }
} else console.log("usage: node mcp.mjs list | describe <server> <tool> | call <server> <tool> '<json>'|@file");
