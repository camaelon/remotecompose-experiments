#!/usr/bin/env node
// MCP server: package RemoteCompose documents for delivery. First format: a single-file
// web page played by the TypeScript engine — optionally published, i.e. hosted by this
// server at a public URL.
// stdio by default; `--http [PORT]` for Streamable HTTP (see lib/mcp-server.mjs).
//
// Publishing needs HTTP mode and MCP_PUBLIC_URL, this server's own public base (e.g.
// https://mcp.example.com/deploy). Pages are then served WITHOUT auth at
// <MCP_PUBLIC_URL>/pages/<id>/ — the id is 128 random bits, so a page is reachable by
// whoever has its link and by nobody else. They live in MCP_ROOT/pages until unpublished.
// Unless MCP_PAGE_INDEX=0, <MCP_PUBLIC_URL>/pages/ is also a public index of every page,
// which makes them all discoverable: the ids then no longer keep anything private.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DOCUMENT_PROPS, prepareDocument } from "./lib/document.mjs";
import { isMain, serve } from "./lib/mcp-server.mjs";
import { checkReport } from "./lib/rc2image.mjs";
import { buildPage, formatBytes } from "./lib/web-page.mjs";
import { playerBundle } from "./lib/web-player.mjs";
import { displayPath, outputFile, resolvePath, workspaceRoot } from "./lib/workspace.mjs";

const PUBLIC_URL = (process.env.MCP_PUBLIC_URL ?? "").replace(/\/+$/, "");
const HTTP_MODE = process.argv.includes("--http") || Boolean(process.env.MCP_HTTP_PORT);
const CAN_PUBLISH = HTTP_MODE && Boolean(PUBLIC_URL) && Boolean(workspaceRoot());
const PAGES_DIR = workspaceRoot() ? path.join(workspaceRoot(), "pages") : null;
const PAGE_ID = /^[A-Za-z0-9_-]{22}$/;
const PAGE_INDEX = process.env.MCP_PAGE_INDEX !== "0";

const pageUrl = (id) => `${PUBLIC_URL}/pages/${id}/`;

// The engine stores these types; the web player can override all but long and arrays.
const WEB_SETTABLE = new Set(["float", "int", "color", "string"]);

function coerceVariable(name, type, value) {
    if (type === "float" || type === "int") {
        const n = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(n)) throw new Error(`variables.${name}: ${type} variable needs a number, got ${JSON.stringify(value)}`);
        return type === "int" ? Math.trunc(n) : n;
    }
    if (type === "color") {
        if (!/^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.test(String(value).trim())) {
            throw new Error(`variables.${name}: colour variable needs "#RRGGBB" or "#AARRGGBB", got ${JSON.stringify(value)}`);
        }
        return String(value).trim();
    }
    return String(value);
}

function readMeta(id) {
    try { return JSON.parse(readFileSync(path.join(PAGES_DIR, id, "meta.json"), "utf8")); } catch { return null; }
}

/** Every published page's metadata, newest first. */
function publishedPages() {
    if (!PAGES_DIR || !existsSync(PAGES_DIR)) return [];
    return readdirSync(PAGES_DIR).filter((id) => PAGE_ID.test(id)).map(readMeta).filter(Boolean)
        .map((m) => ({ ...m, url: pageUrl(m.id) }))
        .sort((x, y) => (x.created < y.created ? 1 : -1));
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function kb(n) { return n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`; }

function indexHtml(pages) {
    const rows = pages.map((p) => `<tr>
  <td><a href="${esc(p.url)}">${esc(p.title || p.id)}</a></td>
  <td>${esc(p.source)}</td>
  <td>${p.controls === false ? "player" : p.controls ? "playground" : "–"}</td>
  <td class="n">${p.rc_bytes ? esc(formatBytes(p.rc_bytes)) : "–"}</td>
  <td class="n">${p.bytes ? kb(p.bytes) : ""}</td>
  <td class="n"><time datetime="${esc(p.created)}">${esc(String(p.created ?? "").replace("T", " ").slice(0, 16))}</time></td>
</tr>`).join("\n");
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Published pages</title>
<style>
  :root { color-scheme: light dark; --bg: #f6f6f8; --text: #1d1d22; --muted: #6b6b76; --line: #dcdce2; --accent: #3a63e0; }
  @media (prefers-color-scheme: dark) { :root { --bg: #17171b; --text: #ececf0; --muted: #9a9aa6; --line: #34343c; --accent: #7c9cff; } }
  body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, -apple-system, sans-serif; }
  main { max-width: 960px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p { color: var(--muted); margin: 0 0 18px; }
  .wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; }
  td:first-child { white-space: normal; overflow-wrap: anywhere; }
  th { color: var(--muted); font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: .05em; }
  .n { text-align: right; font-variant-numeric: tabular-nums; }
  a { color: var(--accent); text-decoration: none; font-weight: 500; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
<main>
<h1>Published pages</h1>
<p>${pages.length} page${pages.length === 1 ? "" : "s"} published with rc-deploy, newest first.</p>
${pages.length ? `<div class="wrap"><table>
<thead><tr><th>Title</th><th>Source</th><th>Kind</th><th class="n">Document</th><th class="n">Page</th><th class="n">Published (UTC)</th></tr></thead>
<tbody>
${rows}
</tbody>
</table></div>` : ""}
</main>
</body>
</html>
`;
}

/** GET <base>/pages/ — the index; GET <base>/pages/<id>/ — the published page itself. No auth. */
function publicRoute(req, url, res) {
    if (PAGE_INDEX && PAGES_DIR && (url.pathname === "/pages" || url.pathname === "/pages/")) {
        if (req.method !== "GET" && req.method !== "HEAD") {
            res.writeHead(405, { Allow: "GET, HEAD" });
            res.end();
            return true;
        }
        const body = Buffer.from(indexHtml(publishedPages()));
        res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Length": body.length,
            "Cache-Control": "no-cache",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "X-Robots-Tag": "noindex",
        });
        res.end(req.method === "HEAD" ? undefined : body);
        return true;
    }
    const m = /^\/pages\/([^/]+)(\/(index\.html)?)?$/.exec(url.pathname);
    if (!m || !PAGES_DIR) return false;
    const [, id, slash] = m;
    const file = PAGE_ID.test(id) ? path.join(PAGES_DIR, id, "index.html") : null;
    if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD" });
        res.end();
        return true;
    }
    if (!file || !existsSync(file)) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found\n");
        return true;
    }
    if (!slash) {   // relative URLs inside the page resolve against the folder
        res.writeHead(301, { Location: `${url.pathname}/${url.search}` });
        res.end();
        return true;
    }
    const body = readFileSync(file);
    res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": body.length,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
        "X-Robots-Tag": "noindex",
    });
    res.end(req.method === "HEAD" ? undefined : body);
    return true;
}

const PACKAGE_WEB_PROPS = {
    ...DOCUMENT_PROPS,
    title: { type: "string", description: "Page title (default: the file name, or \"RemoteCompose document\")." },
    controls: {
        type: "boolean",
        description:
            "true (default): a playground page — the document in a frame that can be resized " +
            "freely (drag handles, typed sizes, phone/tablet/desktop/widget presets, or fill the " +
            "window), with an editor for every host variable (slider + number, colour picker, " +
            "text), density, theme, pause/restart, and a copy-link button; the view's state is " +
            "kept in the URL. false: the bare player, just the document.",
    },
    layout: {
        type: "string", enum: ["fill", "fixed"],
        description:
            "\"fill\": the document fills the browser window (or, with controls, the stage) and " +
            "re-lays out on resize, like an app screen. \"fixed\": a box of width x height CSS px " +
            "(default: the document's own size). Default: fill for the bare player; with controls, " +
            "the document's own size when it fits the window, else fill.",
    },
    width: { type: "number", description: "Box width in CSS px: layout \"fixed\", or the playground's starting size." },
    height: { type: "number", description: "Box height in CSS px: layout \"fixed\", or the playground's starting size." },
    background: {
        type: "string",
        description: "Page background, any CSS colour (default: black for fill, light grey for fixed; a checkerboard behind the frame with controls).",
    },
    theme: { type: "string", enum: ["light", "dark", "auto"], description: "Colour theme; \"auto\" follows the viewer's system setting. Default auto." },
    density: {
        description:
            "Display density the document is laid out at: \"device\" (default) uses the viewer's " +
            "devicePixelRatio — sharp, and right for documents authored in dp; a number pins it. " +
            "Documents drawn in raw pixels look smaller on high-DPI screens with \"device\"; use 1 " +
            "for those.",
        anyOf: [{ type: "number" }, { type: "string", enum: ["device"] }],
    },
    variables: {
        type: "object",
        description:
            "Initial values for the document's host variables, {name: value} (float, int, colour " +
            "\"#AARRGGBB\", string). rc-render's validate lists what a document declares.",
        additionalProperties: { anyOf: [{ type: "number" }, { type: "string" }] },
    },
    url_variables: {
        type: "boolean",
        description:
            "Let the page's URL override host variables: ?name=value for any declared variable " +
            "(default true). One published page can then show many variants; the playground " +
            "writes the values being edited into its URL the same way.",
    },
    output_path: { type: "string", description: "Also write the HTML file here." },
    publish: {
        type: "boolean",
        description: CAN_PUBLISH
            ? "Host the page at a public URL on this server (default true). Anyone with the link can open it" +
              (PAGE_INDEX ? `, and it is listed in the public index at ${PUBLIC_URL}/pages/.` : ".")
            : "Host the page at a public URL. Not available on this server (needs HTTP mode and MCP_PUBLIC_URL).",
    },
};

export const definition = {
    name: "rc-deploy",
    version: "1.1.0",
    // Read by the guide server (guide-server.mjs); not part of the MCP protocol.
    guide: {
        summary: "Packages RemoteCompose documents for delivery — first as a self-contained web page played by the TypeScript engine, optionally hosted at a public link.",
        useWhen: [
            "you want to share a document as something people can open and interact with in a browser",
            "you need a single HTML file that plays a document with no server or install",
            "you want one link that shows different variants through URL parameters (?name=value)",
            "you want to explore how a document behaves: resize it freely and edit its host variables live (the default playground page)",
        ],
        notFor: [
            "a still image: rc-render's render_rc",
            "checking a document: rc-render's validate — package only what validates",
        ],
    },
    instructions:
        "Packages RemoteCompose documents (.rc or JSON) for delivery. package_web builds a single " +
        "self-contained HTML page (TypeScript player + document inlined)" +
        (CAN_PUBLISH ? " and publishes it at a public URL" +
         (PAGE_INDEX ? `, listed in a public index at ${PUBLIC_URL}/pages/` : ", unguessable and unlisted") +
         "; list_pages and unpublish_page manage those." : ".") +
        " The page uses the TypeScript engine, which can differ from rc-render's C++ engine: " +
        "check the page itself, not only a render_rc picture.",
    publicRoute,
    tools: [{
        name: "package_web",
        annotations: {
            title: "Package a RemoteCompose document as a web page",
            readOnlyHint: false, destructiveHint: false, idempotentHint: false,
            openWorldHint: CAN_PUBLISH,
        },
        examples: [
            { what: "Publish a JSON document as a full-window page", arguments: { json_path: "docs/clock.json", title: "Clock" } },
            { what: "A fixed-size card with a host variable set, light theme",
              arguments: { rc_path: "docs/card.rc", layout: "fixed", width: 360, height: 240,
                           theme: "light", variables: { title: "Hello" } } },
            { what: "Just the HTML file, not published", arguments: { rc_path: "docs/card.rc", publish: false, output_path: "card.html" } },
        ],
        description:
            "Package a RemoteCompose document (.rc or JSON) as one self-contained HTML page that " +
            "plays it in the browser with the TypeScript engine — animation, touch and clicks " +
            "included; no server or install needed to open it. By default it is a playground: " +
            "the viewer can resize the document freely or pick device presets, edit each host " +
            "variable live, and switch density and theme — a quick way to see how the document " +
            "responds; controls: false gives the bare player. Options: controls, layout (fill " +
            "the window, or a fixed box), title, background, theme, density, initial host " +
            "variables, and whether ?name=value in the URL may override them. " +
            (CAN_PUBLISH
                ? "By default the page is also published at a public URL on this server, which is returned" +
                  (PAGE_INDEX ? ` (and listed at ${PUBLIC_URL}/pages/).` : " (unguessable, unlisted).")
                : "Returns the HTML file's path.") +
            (workspaceRoot() ? " Paths are relative to the server's workspace." : ""),
        inputSchema: { type: "object", properties: PACKAGE_WEB_PROPS },
        handler: async (a) => {
            const publish = a.publish ?? CAN_PUBLISH;
            if (publish && !CAN_PUBLISH) {
                throw new Error("publishing is not available on this server (it needs HTTP mode and MCP_PUBLIC_URL); " +
                                "pass publish: false and output_path to get the file");
            }
            const controls = a.controls !== false;
            const layout = a.layout ?? "fill";
            if (layout !== "fill" && layout !== "fixed") throw new Error('layout is "fill" or "fixed"');
            if (a.density !== undefined && a.density !== "device" && !(typeof a.density === "number" && a.density > 0)) {
                throw new Error('density is "device" or a number > 0');
            }

            const doc = prepareDocument(a);
            if (doc.conversionError) throw new Error(doc.conversionError);
            try {
                // The C++ engine reads the document once, for the facts the page needs: that it
                // parses at all, its natural size, and the type of each host variable.
                const { report, log } = await checkReport(doc.rcPath);
                if (!report?.parse?.ok) {
                    const p = report?.parse;
                    throw new Error(p ? `the .rc does not parse (${p.kind} at byte ${p.offset}, opcode ${p.opcode}): ${p.message}`
                                      : `could not read the document: ${log}`);
                }
                const declared = {};
                for (const v of report.namedVariables ?? []) declared[v.name] = v.type;

                const variables = [];
                for (const [name, value] of Object.entries(a.variables ?? {})) {
                    const type = declared[name];
                    if (!type) {
                        throw new Error(`variables.${name}: the document declares no such variable. It declares: ` +
                                        (Object.keys(declared).join(", ") || "none"));
                    }
                    if (!WEB_SETTABLE.has(type)) throw new Error(`variables.${name}: the web player cannot set ${type} variables`);
                    variables.push({ name, type, value: coerceVariable(name, type, value) });
                }
                const settable = Object.fromEntries(Object.entries(declared).filter(([, t]) => WEB_SETTABLE.has(t)));

                const { width: docW, height: docH } = report.header ?? {};
                const width = a.width ?? (docW > 0 ? docW : 400);
                const height = a.height ?? (docH > 0 ? docH : 400);
                for (const [k, v] of [["width", width], ["height", height]]) {
                    if (!(typeof v === "number" && v > 0)) throw new Error(`${k} must be a number > 0`);
                }
                const source = a.json_path ?? a.rc_path;
                const title = a.title ?? (source ? path.basename(source).replace(/\.(rc|rcd|json)$/i, "") : "RemoteCompose document");
                const rcBytes = readFileSync(doc.rcPath);
                // The download is named after the source file, else the title.
                const fileName = (source ? path.basename(source).replace(/\.(rc|rcd|json)$/i, "")
                                         : title.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "document") + ".rc";

                const html = buildPage({
                    bundle: await playerBundle(),
                    rcBase64: rcBytes.toString("base64"),
                    config: {
                        title, layout, width, height, controls,
                        rcBytes: rcBytes.length, fileName,
                        start: a.width !== undefined || a.height !== undefined || a.layout === "fixed" ? "size"
                             : a.layout === "fill" ? "fill" : "auto",
                        document: { width: docW, height: docH },
                        info: (report.namedVariables ?? []).map(({ name, type, value }) => ({ name, type, value })),
                        background: a.background,
                        theme: a.theme ?? "auto",
                        density: a.density ?? "device",
                        variables,
                        declared: settable,
                        urlVariables: a.url_variables !== false,
                    },
                });

                const result = { title, bytes: Buffer.byteLength(html), rc_bytes: rcBytes.length, controls, layout,
                                 document: { width: docW, height: docH }, variables: settable };
                if (a.output_path !== undefined) {
                    const out = resolvePath(a.output_path, "output_path");
                    writeFileSync(out, html);
                    result.html_path = displayPath(out);
                }
                if (publish) {
                    const id = randomBytes(16).toString("base64url");
                    const dir = path.join(PAGES_DIR, id);
                    mkdirSync(dir, { recursive: true });
                    writeFileSync(path.join(dir, "index.html"), html);
                    writeFileSync(path.join(dir, "meta.json"), JSON.stringify({
                        id, title, created: new Date().toISOString(), bytes: result.bytes, rc_bytes: rcBytes.length, controls,
                        source: source ?? (a.json !== undefined ? "inline json" : "inline rc"),
                    }));
                    result.page_id = id;
                    result.url = pageUrl(id);
                    const names = Object.keys(settable);
                    if (names.length && a.url_variables !== false) {
                        result.url_example = `${result.url}?${encodeURIComponent(names[0])}=...`;
                    }
                }
                if (!result.html_path && !publish) {
                    const out = outputFile("page", ".html");
                    writeFileSync(out, html);
                    result.html_path = displayPath(out);
                }
                return [{ type: "text", text: JSON.stringify(result, null, 1) }];
            } finally {
                if (doc.temp) rmSync(doc.rcPath, { force: true });
            }
        },
    }, {
        name: "list_pages",
        annotations: { title: "List published pages", readOnlyHint: true, openWorldHint: false },
        description: "List the pages this server has published: id, title, URL, source, size and when" +
            (CAN_PUBLISH && PAGE_INDEX ? `; the same list is public at ${PUBLIC_URL}/pages/.` : "."),
        inputSchema: { type: "object", properties: {} },
        handler: async () => {
            if (!CAN_PUBLISH) return [{ type: "text", text: "This server does not publish pages (needs HTTP mode and MCP_PUBLIC_URL)." }];
            const result = { pages: publishedPages() };
            if (PAGE_INDEX) result.index_url = `${PUBLIC_URL}/pages/`;
            return [{ type: "text", text: JSON.stringify(result, null, 1) }];
        },
    }, {
        name: "unpublish_page",
        annotations: { title: "Unpublish a page", readOnlyHint: false, destructiveHint: true, openWorldHint: false },
        description: "Take a published page down: its link stops working and its file is deleted. Cannot be undone.",
        inputSchema: {
            type: "object",
            properties: { page_id: { type: "string", description: "The id from package_web or list_pages." } },
            required: ["page_id"],
        },
        handler: async ({ page_id }) => {
            if (!CAN_PUBLISH) throw new Error("this server does not publish pages");
            const dir = PAGE_ID.test(String(page_id)) ? path.join(PAGES_DIR, page_id) : null;
            if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`no published page ${page_id}`);
            const meta = readMeta(page_id);
            rmSync(dir, { recursive: true, force: true });
            return [{ type: "text", text: `Unpublished ${page_id}${meta?.title ? ` (${meta.title})` : ""}.` }];
        },
    }],
};

if (isMain(import.meta.url)) serve(definition);
