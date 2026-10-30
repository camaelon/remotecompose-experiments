#!/usr/bin/env node
// MCP server: JSON -> RemoteCompose (.rc), via the TypeScript json2rc converter.
// stdio by default; `--http [PORT]` for Streamable HTTP (see lib/mcp-server.mjs).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { jsonToRc } from "./lib/json2rc.mjs";
import { designNotes } from "./lib/design-audit.mjs";
import { isMain, serve } from "./lib/mcp-server.mjs";
import { displayPath, outputFile, resolvePath, workspaceRoot } from "./lib/workspace.mjs";

export const definition = {
    name: "json2rc",
    version: "1.1.0",
    // Read by the guide server (guide-server.mjs); not part of the MCP protocol.
    guide: {
        summary: "Converts RemoteCompose JSON documents to binary .rc files.",
        useWhen: [
            "you need the .rc file itself — to ship to a player, store, or diff",
            "you want to know whether a JSON document converts, without rendering it",
        ],
        notFor: [
            "looking at a document: rc-render's render_rc takes JSON directly",
            "checking a document in depth: rc-render's validate also parses and sanity-renders",
        ],
    },
    instructions:
        "Converts RemoteCompose JSON documents to binary .rc files. The converter refuses " +
        "anything outside its implemented surface rather than approximating, so an error " +
        "names the unsupported construct. Pass the resulting rc_path to the rc-render " +
        "server's render_rc tool (on the same machine) to see it — or give render_rc the " +
        "JSON directly.",
    tools: [{
        name: "json2rc",
        // Writes the output file (in the workspace, over HTTP); never deletes or edits anything
        // else, and the same inputs give the same file.
        annotations: { title: "Convert RemoteCompose JSON to .rc", readOnlyHint: false, destructiveHint: false,
                       idempotentHint: true, openWorldHint: false },
        examples: [
            { what: "Convert a file next to itself", arguments: { input_path: "docs/clock.json" } },
            { what: "Convert inline JSON and get the bytes back",
              arguments: { json: { header: { width: 200, height: 200 }, root: [] }, include_base64: true } },
        ],
        description:
            "Convert a RemoteCompose JSON document to a binary .rc file. Give the document " +
            "either inline (`json`, as an object or a string) or as `input_path`. Writes " +
            "`output_path` (default: next to input_path with a .rc extension, or a generated " +
            "file for inline JSON) and returns its rc_path and size. Set include_base64 to " +
            "also get the bytes back. Bitmaps declared with {\"file\": ...} resolve against " +
            "`base_dir` (default: the input file's folder)." +
            (workspaceRoot() ? " Paths are relative to the server's workspace." : ""),
        inputSchema: {
            type: "object",
            properties: {
                json: {
                    description: "The document, as a JSON object or a JSON string.",
                    anyOf: [{ type: "object" }, { type: "string" }],
                },
                input_path: { type: "string", description: "Path to a .json document." },
                output_path: { type: "string", description: "Where to write the .rc file." },
                base_dir: { type: "string", description: "Folder that resource file paths resolve against." },
                include_base64: {
                    type: "boolean",
                    description: "Also return the .rc bytes as base64 (default false — they can be large).",
                },
            },
        },
        handler: async (args) => {
            const { json, input_path, output_path, base_dir, include_base64 } = args;
            if ((json === undefined) === (input_path === undefined)) {
                throw new Error("give exactly one of `json` or `input_path`");
            }
            const input = input_path !== undefined ? resolvePath(input_path, "input_path") : null;
            const source = input ? readFileSync(input, "utf8") : json;
            const dir = base_dir !== undefined ? resolvePath(base_dir, "base_dir")
                : input ? path.dirname(input) : resolvePath(".");
            const out = output_path !== undefined ? resolvePath(output_path, "output_path")
                : input ? input.replace(/\.json$/i, "") + ".rc"
                : outputFile("doc", ".rc");

            const bytes = jsonToRc(source, dir);
            writeFileSync(out, Buffer.from(bytes));
            // The source JSON beside the .rc (x.rc -> x.json), unless it is already there: a page
            // published from the .rc is then made from its JSON (the JSON viewer, the design check).
            const sidecar = out.replace(/\.rc$/i, ".json");
            if (sidecar !== out && sidecar !== input) {
                try { writeFileSync(sidecar, typeof source === "string" ? source : JSON.stringify(source)); } catch { /* best effort */ }
            }
            const result = { rc_path: displayPath(out), bytes: bytes.length };
            if (include_base64) result.rc_base64 = Buffer.from(bytes).toString("base64");
            // The design warnings (a UI hand-drawn on a canvas, glyph icons, hard-coded dates...):
            // here, because converting is the one step every client takes.
            let notes = "";
            try { notes = designNotes(typeof source === "string" ? JSON.parse(source) : source); } catch { /* not JSON we can read */ }
            return [{ type: "text", text: JSON.stringify(result) }, ...(notes ? [{ type: "text", text: notes }] : [])];
        },
    }],
};

if (isMain(import.meta.url)) serve(definition);
