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
// Unless MCP_PAGE_INDEX=0, <MCP_PUBLIC_URL>/pages/ is also an index of the pages. Without
// accounts it is public and lists every page, which makes them all discoverable. With accounts
// (lib/accounts.mjs) each page belongs to the account that published it (meta.json "owner",
// and the pages table): list_pages and unpublish_page see only the caller's own (the admin
// key and admin accounts: all), and the index shows a signed-in visitor (the website's session
// cookie) their own pages, a signed-out one a link to sign in. MCP_PAGE_INDEX=public keeps the
// public list of every page.

import { createHash, randomBytes } from "node:crypto";
import { brotliCompressSync, gzipSync, constants as zlibConstants } from "node:zlib";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadLibrary, usesComponents } from "./lib/components.mjs";
import { DOCUMENT_PROPS, prepareDocument } from "./lib/document.mjs";
import { compileComponents, jsonToRc } from "./lib/json2rc.mjs";
import { currentCall, isMain, serve } from "./lib/mcp-server.mjs";
import { accounts, accountsEnabled, requestAccount } from "./lib/accounts.mjs";
import { checkReport, runRc2image } from "./lib/rc2image.mjs";
import { keptPng } from "./lib/trace-images.mjs";
import { PAGE_CARD_CSS, pageCards } from "./lib/page-cards.mjs";
import { buildPage } from "./lib/web-page.mjs";
import { APP_VAR, checkAppScript, compileAppScript, describeCheck, documentActions, embedAppScript, embeddedAppScript, SCRIPT_NOTE, SCRIPT_PROPS, scriptsAllowed, scriptsOffMessage } from "./lib/app-script.mjs";
import { blockingFindings } from "./lib/design-audit.mjs";
import { playerBundle } from "./lib/web-player.mjs";
import { displayPath, outputFile, resolvePath, workspaceRoot } from "./lib/workspace.mjs";

/** The playground's JSON buttons for a document given as JSON: the text, and the expanded
 *  form when it calls library components. Empty for an .rc. */
function jsonViews(a, name) {
    if (a.json === undefined && a.json_path === undefined) return [];
    try {
        const file = a.json_path !== undefined ? resolvePath(a.json_path, "json_path") : null;
        const text = file ? readFileSync(file, "utf8") : typeof a.json === "string" ? a.json : JSON.stringify(a.json);
        const out = [{ label: "JSON", text, file: `${name}.json`, title: "The document as published" }];
        try {
            const doc = JSON.parse(text);
            if (usesComponents(doc)) {
                const dir = a.base_dir !== undefined ? resolvePath(a.base_dir, "base_dir") : file ? path.dirname(file) : resolvePath(".");
                out.push({ label: "Expanded JSON", text: JSON.stringify(compileComponents(doc, dir).doc, null, 1),
                    file: `${name}.expanded.json`, title: "The document with its components expanded: what the converter sees" });
            }
        } catch { /* not JSON the expander reads: the text alone */ }
        return out;
    } catch { return []; }
}

/** The same JSON expanded for each mono look, as base64 .rc: the call sites unchanged, the
 *  components' mono implementation picked. Null when the document calls no component, already
 *  picks one look, or carries every look itself (componentTheme "all"). */
function lookExpansions(a) {
    if (a.json === undefined && a.json_path === undefined) return null;
    try {
        const file = a.json_path !== undefined ? resolvePath(a.json_path, "json_path") : null;
        const doc = JSON.parse(file ? readFileSync(file, "utf8") : typeof a.json === "string" ? a.json : JSON.stringify(a.json));
        if (!usesComponents(doc) || ![undefined, "auto", "light-dark"].includes(doc.componentTheme)) return null;
        const dir = a.base_dir !== undefined ? resolvePath(a.base_dir, "base_dir") : file ? path.dirname(file) : resolvePath(".");
        const out = {};
        for (const look of ["mono-dark", "mono-light"]) {
            out[look] = Buffer.from(jsonToRc(compileComponents(structuredClone(doc), dir, { theme: look }).doc, dir)).toString("base64");
        }
        return out;
    } catch { return null; }   // the main document still publishes; the looks are a bonus
}

const PUBLIC_URL = (process.env.MCP_PUBLIC_URL ?? "").replace(/\/+$/, "");
const HTTP_MODE = process.argv.includes("--http") || Boolean(process.env.MCP_HTTP_PORT);
const CAN_PUBLISH = HTTP_MODE && Boolean(PUBLIC_URL) && Boolean(workspaceRoot());
const PAGES_DIR = workspaceRoot() ? path.join(workspaceRoot(), "pages") : null;
const PAGE_ID = /^[A-Za-z0-9_-]{22}$/;
const PAGE_INDEX = process.env.MCP_PAGE_INDEX !== "0";
const ACCOUNTS = accountsEnabled();
// The index lists every page to anyone: without accounts, or when asked to (MCP_PAGE_INDEX=public).
const INDEX_PUBLIC = PAGE_INDEX && (!ACCOUNTS || process.env.MCP_PAGE_INDEX === "public");
// Where the sign-in page is: RC_ACCOUNT_URL, else the front door's, beside /pages/.
const ACCOUNT_URL = process.env.RC_ACCOUNT_URL || "../account/";

/** The caller's account in a tool call (null without accounts, or over stdio). */
const caller = () => (ACCOUNTS ? currentCall()?.account ?? null : null);
/** May this account see (and unpublish) the page? Everyone may without accounts. */
const owns = (account, meta) => !account || account.admin || (meta?.owner != null && meta.owner === account.id);

const pageUrl = (id) => `${PUBLIC_URL}/pages/${id}/`;
/** How long after publishing a document the same one published again gets the replace hint. */
const TWIN_WINDOW_MS = 30 * 60_000;

/** A published page of the caller's: {id, dir, meta}. Someone else's reads as no page at all. */
function ownPage(pageId) {
    if (!CAN_PUBLISH) throw new Error("this server does not publish pages");
    const id = String(pageId ?? "");
    const dir = PAGE_ID.test(id) ? path.join(PAGES_DIR, id) : null;
    if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`no published page ${id} (list_pages lists yours)`);
    const meta = readMeta(id);
    if (!owns(caller(), meta)) throw new Error(`no published page ${id} of yours (list_pages lists yours)`);
    return { id, dir, meta };
}

// The engine stores these types; the web player can override all but long and arrays.
const WEB_SETTABLE = new Set(["float", "int", "color", "string", "float_array"]);

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
    if (type === "float_array") {
        const xs = Array.isArray(value) ? value.map(Number) : String(value).split(/[\s,;[\]]+/).filter(Boolean).map(Number);
        if (!xs.length || !xs.every(Number.isFinite)) throw new Error(`variables.${name}: float array needs numbers, got ${JSON.stringify(value)}`);
        return xs.join(", ");
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


/**
 * The page's preview picture: its document rendered once at publish time (rc2image, the
 * document's own size, light theme), at most 960 px wide, as pages/<id>/preview.png: public,
 * like the page. False when it could not be made (the publish goes on without it).
 */
async function writePreview(rcPath, width, height, dir) {
    const out = path.join(dir, "preview.png");
    try {
        const { err } = await runRc2image([rcPath, out, String(Math.round(width)), String(Math.round(height)), "--theme", "light"]);
        if (err || !existsSync(out)) return false;
        const png = keptPng(readFileSync(out));
        if (!png) { rmSync(out, { force: true }); return false; }
        writeFileSync(out, png);
        return true;
    } catch { return false; }
}

function indexHtml(pages, { who = null, signedOut = false } = {}) {
    const cards = pageCards(pages.map((p) => ({ ...p, url: `${p.id}/`, preview: p.preview ? `${p.id}/preview.png` : null })));
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
  :root { --card: #fff; --thumb: #e9ecf0; }
  @media (prefers-color-scheme: dark) { :root { --card: #1f1f25; --thumb: #101014; } }
  .pcard:hover { text-decoration: none; }
  ${PAGE_CARD_CSS}
</style>
</head>
<body>
<main>
<h1>${who && !who.admin ? "Your published pages" : "Published pages"}</h1>
${signedOut ? `<p>Published pages are listed for the account that published them. <a href="${esc(ACCOUNT_URL)}">Sign in</a> to see yours. (Each page's own link works for anyone who has it.)</p>`
    : `<p>${pages.length} page${pages.length === 1 ? "" : "s"} published with rc-deploy${who ? (who.admin ? ", every account's (you are an admin)" : ` by ${esc(who.email)}`) : ""}, newest first.${who ? ` <a href="${esc(ACCOUNT_URL)}">Your account</a>` : ""}</p>`}
${pages.length ? cards : ""}
</main>
</body>
</html>
`;
}

/** GET <base>/pages/ — the index; GET <base>/pages/<id>/ — the published page itself. No auth. */
/** The player bundle under pages/_player/<hash>.js (written once per bundle version). */
function sharedBundle(code) {
    const name = createHash("sha256").update(code).digest("hex").slice(0, 16) + ".js";
    const dir = path.join(PAGES_DIR, "_player");
    const file = path.join(dir, name);
    if (!existsSync(file)) { mkdirSync(dir, { recursive: true }); writeFileSync(file, code); }
    return name;
}

// Compressed copies of served files, by path and mtime: pages and the player bundle compress
// to about a quarter (brotli), whether or not a proxy in front compresses.
const compressed = new Map();
// `rewrite` (optional) is {key, apply(buffer) -> buffer}: the served bytes are apply(file's),
// cached under key as well as the file's mtime.
function sendFile(req, res, file, type, cache, rewrite = null) {
    const st = statSync(file);
    const accept = String(req.headers["accept-encoding"] ?? "");
    const enc = /\bbr\b/.test(accept) ? "br" : /\bgzip\b/.test(accept) ? "gzip" : null;
    const read = () => (rewrite ? rewrite.apply(readFileSync(file)) : readFileSync(file));
    let body;
    if (enc) {
        const key = `${file}|${st.mtimeMs}|${enc}|${rewrite?.key ?? ""}`;
        body = compressed.get(key);
        if (!body) {
            const raw = read();
            body = enc === "br" ? brotliCompressSync(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 9 } }) : gzipSync(raw, { level: 9 });
            if (compressed.size > 200) compressed.clear();
            compressed.set(key, body);
        }
    } else body = read();
    res.writeHead(200, {
        "Content-Type": type, "Content-Length": body.length, "Cache-Control": cache, "Vary": "Accept-Encoding",
        ...(enc ? { "Content-Encoding": enc } : {}),
        "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex",
    });
    res.end(req.method === "HEAD" ? undefined : body);
    return true;
}

async function publicRoute(req, url, res) {
    // The shared player script: named by its hash, so it never changes and caches for good.
    const pm = /^\/pages\/_player\/([0-9a-f]{16}\.js)$/.exec(url.pathname);
    if (pm && PAGES_DIR) {
        const file = path.join(PAGES_DIR, "_player", pm[1]);
        if (!existsSync(file)) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("not found\n"); return true; }
        return sendFile(req, res, file, "text/javascript; charset=utf-8", "public, max-age=31536000, immutable");
    }
    // A page's preview picture (public, like the page).
    const vm = /^\/pages\/([A-Za-z0-9_-]{22})\/preview\.png$/.exec(url.pathname);
    if (vm && PAGES_DIR) {
        const file = path.join(PAGES_DIR, vm[1], "preview.png");
        if (!existsSync(file)) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("not found\n"); return true; }
        return sendFile(req, res, file, "image/png", "public, max-age=300");
    }
    // A page's JSON documents (the viewer fetches them on click).
    const jm = /^\/pages\/([A-Za-z0-9_-]{22})\/([\w.-]+\.json)$/.exec(url.pathname);
    if (jm && PAGES_DIR && jm[2] !== "meta.json") {
        const file = path.join(PAGES_DIR, jm[1], jm[2]);
        if (!existsSync(file)) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("not found\n"); return true; }
        return sendFile(req, res, file, "application/json; charset=utf-8", "public, max-age=300");
    }
    // A page's document as an .rc (what the inspector loads): the bytes inlined in the page, so
    // every page has it, published before this route or not. Any <name>.rc names it.
    const rm = /^\/pages\/([A-Za-z0-9_-]{22})\/[\w.-]+\.rc$/.exec(url.pathname);
    if (rm && PAGES_DIR) {
        const bytes = pageDocument(path.join(PAGES_DIR, rm[1], "index.html"));
        if (!bytes) { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("not found\n"); return true; }
        res.writeHead(200, {
            "Content-Type": "application/octet-stream", "Content-Length": bytes.length, "Cache-Control": "public, max-age=300",
            "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex",
        });
        res.end(req.method === "HEAD" ? undefined : bytes);
        return true;
    }
    if (PAGE_INDEX && PAGES_DIR && (url.pathname === "/pages" || url.pathname === "/pages/")) {
        if (req.method !== "GET" && req.method !== "HEAD") {
            res.writeHead(405, { Allow: "GET, HEAD" });
            res.end();
            return true;
        }
        let html;
        if (INDEX_PUBLIC) html = indexHtml(publishedPages());
        else {
            const who = await requestAccount(req);
            html = who ? indexHtml(publishedPages().filter((p) => owns(who, p)), { who }) : indexHtml([], { signedOut: true });
        }
        const body = Buffer.from(html);
        res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Length": body.length,
            "Cache-Control": INDEX_PUBLIC ? "no-cache" : "private, no-store",
            ...(INDEX_PUBLIC ? {} : { "Vary": "Cookie" }),
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
    return sendFile(req, res, file, "text/html; charset=utf-8", "no-cache", await pageRewrite(id));
}

/** The document bytes inlined in a published page (its `var DATA = "<base64>"`), or null. */
const pageDocs = new Map();   // file -> {mtime, bytes}
function pageDocument(file) {
    if (!existsSync(file)) return null;
    const mtime = statSync(file).mtimeMs;
    const hit = pageDocs.get(file);
    if (hit?.mtime === mtime) return hit.bytes;
    const m = /\bvar DATA = "([A-Za-z0-9+/=]+)"/.exec(readFileSync(file, "latin1"));
    const bytes = m ? Buffer.from(m[1], "base64") : null;
    if (pageDocs.size > 100) pageDocs.clear();
    pageDocs.set(file, { mtime, bytes });
    return bytes;
}

// A published page is served rebuilt from what it stores (its config `var C` and document
// `var DATA`) with the current page template and player, so fixes to either reach pages
// already published: the old player bundles stay on disk for a page someone saved. A
// playground also gets an Inspect button when this server serves the inspector, and the site's
// logo link top left (definition.inspector and definition.home, set by the server that
// includes this one). A page that cannot be
// rebuilt (an old side-loaded app script, or no config) is served as it is, with only its
// player reference brought up to date.
async function pageRewrite(id) {
    let name = null;
    try { name = sharedBundle(await playerBundle()); } catch {}
    const inspector = definition.inspector === true;
    return {
        key: `${name}|${inspector}`,
        apply: (buf) => {
            const s = buf.toString("utf8");
            try {
                const out = rebuildPage(s, { id, player: name, inspector, home: definition.home ?? null });
                if (out) return Buffer.from(out, "utf8");
            } catch {}
            const out = name ? s.replace(/\.\.\/_player\/[0-9a-f]{16}\.js/g, () => `../_player/${name}`) : s;
            return out === s ? buf : Buffer.from(out, "utf8");
        },
    };
}

/** The page HTML rebuilt from its stored config and document, or null when it cannot be. */
export function rebuildPage(html, { id, player, inspector, home = null }) {
    const c = /\n {2}var C = (\{.*\});\n {2}var DATA = "([A-Za-z0-9+/=]*)";\n/.exec(html);
    const src = player ? `../_player/${player}` : /<script src="(\.\.\/_player\/[0-9a-f]{16}\.js)"><\/script>/.exec(html)?.[1];
    if (!c || !src) return null;
    let config = JSON.parse(c[1]);
    if (config.app && !config.app.embedded) return null;   // a side-loaded script: kept as published
    if (config.controls && home && !config.home) config = { ...config, home };
    if (config.controls && inspector && !config.inspectHref) {
        config = { ...config, inspectHref: `../../inspector/?url=${encodeURIComponent(`../pages/${id}/${config.fileName || "document.rc"}`)}` };
    }
    return buildPage({ bundle: { src }, rcBase64: c[2], config });
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
    accept_design_warnings: {
        type: "boolean",
        description: "A public page is refused when the document's structure breaks on other screens or devices " +
            "(the whole UI drawn on one canvas, fixed coordinates, text cut by its anchor, glyph icons, expressions " +
            "Android rejects). Fix them; only if the user explicitly wants it as it is, pass true with a reason.",
    },
    reason: { type: "string", description: "With accept_design_warnings: why (logged)." },
    variable_ranges: {
        type: "object",
        description: "Per host variable, the playground editor's {min, max, step, meaning}: the slider " +
            "covers min..max and typed values are clamped to it (e.g. {\"progress\": {\"min\": 0, " +
            "\"max\": 1, \"meaning\": \"completion\"}}). Without it a slider guesses its range from the value.",
    },
    density: {
        description:
            "Display density the document is laid out at: 1 (default), another number, or \"device\" for the " +
            "viewer's devicePixelRatio (documents drawn in raw pixels then look smaller on high-DPI screens). " +
            "The viewer can change it in the playground's Density menu.",
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
              (INDEX_PUBLIC ? `, and it is listed in the public index at ${PUBLIC_URL}/pages/.` : ".")
            : "Host the page at a public URL. Not available on this server (needs HTTP mode and MCP_PUBLIC_URL).",
    },
    page_id: {
        type: "string",
        description: "Replace this page of yours in place (an id from list_pages or an earlier publish): the same URL " +
            "shows the new document and options, and a stream post of it stays. Without it, publishing makes a new page.",
    },
};

/**
 * The rules for a public page (the front door and this server alike):
 * - it is made from the JSON, which the page's JSON viewer shows and the design check reads: a
 *   .rc that json2rc wrote has its JSON beside it; a bare binary is refused;
 * - it is always the playground (controls): the bare player hides the JSON and the variables;
 * - a document whose structure breaks on other screens or devices (blockingFindings) is refused,
 *   unless accept_design_warnings comes with a reason (both logged with the call).
 */
function publishable(a) {
    if (a.json === undefined && a.json_path === undefined) {
        const sibling = typeof a.rc_path === "string" ? a.rc_path.replace(/\.rc$/i, ".json") : null;
        if (!sibling || !existsSync(resolvePath(sibling, "rc_path"))) {
            throw new Error("publish takes the JSON document (json or json_path), not a binary .rc: the page shows its JSON " +
                            "and the design check reads it. Publish the JSON you converted.");
        }
        const { rc_path: _, rc_base64: __, ...rest } = a;
        a = { ...rest, json_path: sibling };
    }
    let json = a.json;
    if (json === undefined) json = readFileSync(resolvePath(a.json_path, "json_path"), "utf8");
    try { json = typeof json === "string" ? JSON.parse(json) : json; } catch { json = null; }
    const blocking = json ? blockingFindings(json) : [];
    if (blocking.length && !(a.accept_design_warnings && a.reason)) {
        throw new Error("Not published: the document has design problems that make it break on other screens or devices. " +
            "Fix them, render again to check, then publish.\n" +
            blocking.map((f) => `- [${f.code}] ${f.title}. ${f.message}`).join("\n") +
            "\n(build_kit's layout_model shows the structure to use; reference topic \"format\" has the rules.)");
    }
    return { ...a, controls: true };
}

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
         (INDEX_PUBLIC ? `, listed in a public index at ${PUBLIC_URL}/pages/` : ACCOUNTS ? ", unguessable, listed only for the account that published it" : ", unguessable and unlisted") +
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
                  (INDEX_PUBLIC ? ` (and listed at ${PUBLIC_URL}/pages/).` : ACCOUNTS ? " (unguessable; listed on your account's page)." : " (unguessable, unlisted).")
                : "Returns the HTML file's path.") +
            (workspaceRoot() ? " Paths are relative to the server's workspace." : ""),
        inputSchema: { type: "object", properties: PACKAGE_WEB_PROPS },
        // With app scripts on for the caller (opt-in), the script options are listed too.
        view(ctx) {
            if (!scriptsAllowed(ctx?.account ?? null)) return null;
            return { description: this.description + SCRIPT_NOTE, inputSchema: { type: "object", properties: { ...PACKAGE_WEB_PROPS, ...SCRIPT_PROPS } } };
        },
        handler: async (a) => {
            const publish = a.publish ?? CAN_PUBLISH;
            if (publish && !CAN_PUBLISH) {
                throw new Error("publishing is not available on this server (it needs HTTP mode and MCP_PUBLIC_URL); " +
                                "pass publish: false and output_path to get the file");
            }
            if (publish) a = publishable(a);
            // Replacing a page: it must exist and be the caller's (checked before any work).
            const replacing = a.page_id !== undefined ? ownPage(a.page_id) : null;
            if (replacing && !publish) throw new Error("page_id replaces a published page: it needs publish (not publish: false)");
            const controls = publish ? true : a.controls !== false;
            const layout = a.layout ?? "fill";
            if (layout !== "fill" && layout !== "fixed") throw new Error('layout is "fill" or "fixed"');
            if (a.density !== undefined && a.density !== "device" && !(typeof a.density === "number" && a.density > 0)) {
                throw new Error('density is "device" or a number > 0');
            }

            // An app script travels in the document (APP_VAR): compiled, then written into the JSON
            // before it is converted. A JSON that already carries one (republished) is the same.
            const given = a;
            let embedded = null, scriptIgnored = false;
            const readJson = () => (a.json !== undefined ? a.json : a.json_path !== undefined ? readFileSync(resolvePath(a.json_path, "json_path"), "utf8") : undefined);
            if (a.script !== undefined || a.script_path !== undefined) {
                if (!scriptsAllowed(currentCall()?.account ?? null)) throw new Error(scriptsOffMessage(caller(), ACCOUNT_URL.startsWith("http") ? ACCOUNT_URL : ""));
                if (a.json === undefined && a.json_path === undefined) throw new Error("script: the script is written into the document, so publish it from JSON (json or json_path), not from an .rc");
                const ts = a.script !== undefined ? String(a.script) : readFileSync(resolvePath(a.script_path, "script_path"), "utf8");
                let js;
                try { js = compileAppScript(ts); } catch (e) { throw new Error(`script: ${e.message}`); }
                let obj = readJson();
                if (typeof obj === "string") { try { obj = JSON.parse(obj); } catch (e) { throw new Error(`the document is not valid JSON (${e.message})`); } }
                a = { ...a, json: embedAppScript(obj, js), json_path: undefined,
                      base_dir: a.base_dir ?? (a.json_path !== undefined ? path.dirname(a.json_path) : undefined) };
                embedded = { js, ts };
            } else if (a.json !== undefined || a.json_path !== undefined) {
                let carried = null;
                try { carried = embeddedAppScript(readJson()); } catch { /* prepareDocument reports it */ }
                if (carried && scriptsAllowed(currentCall()?.account ?? null)) {
                    try { embedded = { js: compileAppScript(carried), ts: carried }; } catch (e) { throw new Error(`the document's ${APP_VAR} script: ${e.message}`); }
                } else if (carried) scriptIgnored = true;
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
                // The script is not a value: never set from the URL, the panel or variables.
                delete declared[APP_VAR];

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

                // An app script (opt-in): compiled (a syntax error refuses the publish), then
                // dry-run against the document's variables and actions (reported, not refused).
                let app = null, scriptCheck = null;
                const pageId = publish ? (replacing?.id ?? randomBytes(16).toString("base64url")) : null;
                if (embedded) {
                    scriptCheck = await checkAppScript(embedded.js, { variables: settable, actions: documentActions(a.json ?? readJson()) });
                    // (The page reads the script from the document; ts is what its Script button shows.)
                    app = { embedded: true, ts: embedded.ts, key: pageId ?? createHash("sha256").update(embedded.ts).digest("base64url").slice(0, 16) };
                }

                const { width: docW, height: docH } = report.header ?? {};
                const width = a.width ?? (docW > 0 ? docW : 400);
                const height = a.height ?? (docH > 0 ? docH : 400);
                for (const [k, v] of [["width", width], ["height", height]]) {
                    if (!(typeof v === "number" && v > 0)) throw new Error(`${k} must be a number > 0`);
                }
                const source = given.json_path ?? given.rc_path;
                const title = a.title ?? (source ? path.basename(source).replace(/\.(rc|rcd|json)$/i, "") : "RemoteCompose document");
                const rcBytes = readFileSync(doc.rcPath);
                // The download is named after the source file, else the title.
                const fileName = (source ? path.basename(source).replace(/\.(rc|rcd|json)$/i, "")
                                         : title.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "document") + ".rc";

                // A page published from JSON shows it (and its component expansion) in the
                // playground's JSON viewer; from an .rc there is no JSON to show.
                const json = controls ? jsonViews(a, fileName.replace(/\.rc$/, "")) : [];
                // A published page loads the shared player script and fetches its JSON on demand;
                // a file to keep (output_path, publish: false) carries everything inline.
                const bundleCode = await playerBundle();
                const shared = publish && a.output_path === undefined;
                const bundleFile = shared ? sharedBundle(bundleCode) : null;
                const jsonForPage = shared ? json.map((j) => ({ label: j.label, file: j.file, title: j.title, url: j.file })) : json;
                const looks = controls ? lookExpansions(a) : null;
                const html = buildPage({
                    bundle: shared ? { src: `../_player/${bundleFile}` } : bundleCode,
                    rcBase64: rcBytes.toString("base64"),
                    config: {
                        title, layout, width, height, controls,
                        rcBytes: rcBytes.length, fileName,
                        start: a.width !== undefined || a.height !== undefined || a.layout === "fixed" ? "size"
                             : a.layout === "fill" ? "fill" : "auto",
                        document: { width: docW, height: docH },
                        info: (report.namedVariables ?? []).filter((v) => v.name !== APP_VAR).map(({ name, type, value }) => ({ name, type, value })),
                        background: a.background,
                        theme: a.theme ?? "auto",
                        density: a.density ?? 1,
                        variables,
                        declared: settable,
                        urlVariables: a.url_variables !== false,
                        ranges: a.variable_ranges ?? {},
                        ...(jsonForPage.length ? { json: jsonForPage } : {}),
                        ...(looks ? { looks } : {}),
                        ...(app ? { app } : {}),
                    },
                });

                // The library's theme colours are named so a host can re-theme; they are not the
                // document's own variables, so they are listed apart (and not offered as the URL example).
                const themeNames = new Set(Object.keys(loadLibrary().theme?.colors ?? {}));
                const own = Object.fromEntries(Object.entries(settable).filter(([n]) => !themeNames.has(n)));
                const themed = Object.keys(settable).filter((n) => themeNames.has(n));
                const result = { title, bytes: Buffer.byteLength(html), rc_bytes: rcBytes.length, controls, layout,
                                 document: { width: docW, height: docH }, variables: own,
                                 ...(themed.length ? { theme_colors: themed } : {}) };
                if (a.output_path !== undefined) {
                    const out = resolvePath(a.output_path, "output_path");
                    writeFileSync(out, html);
                    result.html_path = displayPath(out);
                }
                if (publish) {
                    const id = pageId;
                    const dir = path.join(PAGES_DIR, id);
                    // A replaced page starts from an empty folder: no JSON or script of the old one lingers.
                    if (replacing) rmSync(dir, { recursive: true, force: true });
                    mkdirSync(dir, { recursive: true });
                    writeFileSync(path.join(dir, "index.html"), html);
                    if (shared) for (const j of json) writeFileSync(path.join(dir, j.file), j.text);
                    if (app) writeFileSync(path.join(dir, "app.ts"), app.ts);
                    const owner = caller();
                    // The same document published again soon after (a title or theme changed): it is
                    // most likely meant to replace that page, so the result says how.
                    const docSha = createHash("sha256").update(rcBytes).digest("hex").slice(0, 32);
                    const twin = replacing ? null : publishedPages().find((p) => p.id !== id && p.doc_sha === docSha && owns(owner, p)
                        && (!owner || p.owner === owner.id) && Date.now() - Date.parse(p.updated ?? p.created) < TWIN_WINDOW_MS);
                    const preview = await writePreview(doc.rcPath, docW > 0 ? docW : width, docH > 0 ? docH : height, dir);
                    writeFileSync(path.join(dir, "meta.json"), JSON.stringify({
                        id, title, created: replacing?.meta?.created ?? new Date().toISOString(),
                        ...(replacing ? { updated: new Date().toISOString() } : {}), bytes: result.bytes, rc_bytes: rcBytes.length, controls,
                        source: source ?? (given.json !== undefined ? "inline json" : "inline rc"),
                        document: { width: docW, height: docH }, preview, doc_sha: docSha, ...(app ? { app: true } : {}),
                        ...(replacing?.meta?.owner != null ? { owner: replacing.meta.owner } : owner ? { owner: owner.id } : {}),
                    }));
                    if (preview) result.preview_url = `${pageUrl(id)}preview.png`;
                    // (An admin replacing someone's page leaves it theirs.)
                    if (owner && !(replacing && replacing.meta?.owner != null && replacing.meta.owner !== owner.id)) {
                        (await accounts())?.recordPage({ id, accountId: owner.id, title, url: pageUrl(id) });
                    }
                    if (replacing) result.replaced = true;
                    if (twin) {
                        result.note = `You published this same document ${Math.max(1, Math.round((Date.now() - Date.parse(twin.updated ?? twin.created)) / 60000))} min ago ` +
                            `as ${twin.id} (${twin.url}), so two pages now show it. To change a page, publish with page_id: ` +
                            `it keeps the URL. Unless the user wants both, unpublish one (pages {"action": "unpublish", "page_id": ...}) ` +
                            `and next time pass page_id.`;
                        result.same_document_as = twin.id;
                    }
                    result.page_id = id;
                    result.url = pageUrl(id);
                    const names = Object.keys(own);
                    if (names.length && a.url_variables !== false) {
                        result.url_example = `${result.url}?${encodeURIComponent(names[0])}=...`;
                    }
                }
                if (scriptCheck) result.script = `Embedded in the document (${APP_VAR}, ${Buffer.byteLength(embedded.js)} bytes of the .rc). ${describeCheck(scriptCheck)}`;
                if (scriptIgnored) result.script = `The document carries an app script (${APP_VAR}), but app scripts are off for you: the page does not run it.`;
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
        description: (ACCOUNTS ? "List the pages you have published" : "List the pages this server has published") +
            ": id, title, URL, source, size and when" +
            (CAN_PUBLISH && INDEX_PUBLIC ? `; the same list is public at ${PUBLIC_URL}/pages/.` : "."),
        inputSchema: { type: "object", properties: {} },
        handler: async () => {
            if (!CAN_PUBLISH) return [{ type: "text", text: "This server does not publish pages (needs HTTP mode and MCP_PUBLIC_URL)." }];
            const who = caller();
            const result = { pages: publishedPages().filter((p) => owns(who, p)) };
            // Which are in the stream, under what name.
            if (ACCOUNTS && who) {
                const store = await accounts();
                for (const p of result.pages) {
                    const it = store?.streamItem(p.id);
                    if (it) p.stream = { title: it.title, score: it.score };
                }
            }
            if (PAGE_INDEX) result.index_url = `${PUBLIC_URL}/pages/`;
            return [{ type: "text", text: JSON.stringify(result, null, 1) }];
        },
    }, {
        name: "get_page",
        annotations: { title: "Get a published page's document", readOnlyHint: true, openWorldHint: false },
        description: "A published page of yours: its metadata, URL, the .rc URL, and the JSON it was published from " +
            "(when it was published from JSON) and its app script, so it can be edited and published again in place " +
            "(publish with page_id).",
        inputSchema: {
            type: "object",
            properties: { page_id: { type: "string", description: "The id from package_web or list_pages." } },
            required: ["page_id"],
        },
        handler: async ({ page_id }) => {
            const { id, dir, meta } = ownPage(page_id);
            const files = readdirSync(dir);
            const json = files.find((f) => f.endsWith(".json") && f !== "meta.json" && !f.endsWith(".expanded.json"));
            const result = { ...meta, url: pageUrl(id), rc_url: `${pageUrl(id)}document.rc` };
            const MAX = 400_000;
            if (json) {
                const text = readFileSync(path.join(dir, json), "utf8");
                result.json_url = `${pageUrl(id)}${json}`;
                if (text.length <= MAX) {
                    // A copy in the workspace, to edit and publish again (json_path + page_id).
                    const out = outputFile(`page-${id}`, ".json");
                    writeFileSync(out, text);
                    result.json_path = displayPath(out);
                    try { result.json = JSON.parse(text); } catch { result.json_text = text; }
                }
            } else result.json = null;   // published from an .rc: rc_url has the document
            if (files.includes("app.ts")) result.app_script = readFileSync(path.join(dir, "app.ts"), "utf8");
            if (ACCOUNTS) {
                const it = (await accounts())?.streamItem(id);
                if (it) result.stream = { title: it.title, score: it.score };
            }
            return [{ type: "text", text: JSON.stringify(result, null, 1) }];
        },
    }, {
        name: "share_page",
        annotations: { title: "Post a page to the stream", readOnlyHint: false, destructiveHint: false, openWorldHint: true },
        description: "Post a published page of yours to the public stream under a name (or rename it there): anyone can " +
            "open it there and signed-in people vote on it. Only when the user asks to share it. Needs an account with a " +
            "public name (set on the account page).",
        inputSchema: {
            type: "object",
            properties: {
                page_id: { type: "string", description: "The id from package_web or list_pages." },
                title: { type: "string", description: "The name it is shown under in the stream (at most 80 characters; default: the page's title)." },
            },
            required: ["page_id"],
        },
        handler: async ({ page_id, title }) => {
            const { id, meta } = ownPage(page_id);
            const who = caller();
            const store = ACCOUNTS ? await accounts() : null;
            if (!store || !who) throw new Error("the stream needs accounts: this server has none, or you are not signed in");
            store.streamPost({ pageId: id, account: who, title: title ?? meta?.title ?? "" });
            const it = store.streamItem(id);
            return [{ type: "text", text: JSON.stringify({ page_id: id, stream: { title: it?.title }, stream_url: `${PUBLIC_URL}/stream/` }, null, 1) }];
        },
    }, {
        name: "unshare_page",
        annotations: { title: "Take a page out of the stream", readOnlyHint: false, destructiveHint: true, openWorldHint: true },
        description: "Take a page of yours out of the public stream (its votes go with it). The page itself stays published.",
        inputSchema: {
            type: "object",
            properties: { page_id: { type: "string", description: "The id from package_web or list_pages." } },
            required: ["page_id"],
        },
        handler: async ({ page_id }) => {
            const { id } = ownPage(page_id);
            const store = ACCOUNTS ? await accounts() : null;
            if (!store?.streamItem(id)) return [{ type: "text", text: `${id} is not in the stream.` }];
            store.streamRemove(id);
            return [{ type: "text", text: `Took ${id} out of the stream.` }];
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
            const { dir, meta } = ownPage(page_id);
            rmSync(dir, { recursive: true, force: true });
            if (ACCOUNTS) (await accounts())?.deletePage(page_id);
            return [{ type: "text", text: `Unpublished ${page_id}${meta?.title ? ` (${meta.title})` : ""}.` }];
        },
    }],
};

if (isMain(import.meta.url)) serve(definition);
