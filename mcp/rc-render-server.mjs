#!/usr/bin/env node
// MCP server: render a RemoteCompose .rc document to one PNG with the C++/Skia player
// (players/cpp/tools/rc2image). RC2IMAGE overrides the binary; otherwise the default CMake
// build location is used, then `rc2image` on PATH.
// stdio by default; `--http [PORT]` for Streamable HTTP (see lib/mcp-server.mjs).

import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { analyze, documentFeatures, formatFindings } from "./lib/analysis.mjs";
import { DOCUMENT_PROPS, prepareDocument } from "./lib/document.mjs";
import { isMain, serve } from "./lib/mcp-server.mjs";
import { RC2IMAGE, runRc2image } from "./lib/rc2image.mjs";
import { displayPath, outputFile, resolvePath, workspaceRoot } from "./lib/workspace.mjs";

// ── Public image links ───────────────────────────────────────────────
// Some clients (ChatGPT) cannot turn an MCP image block into something they can show. In
// HTTP mode with MCP_PUBLIC_URL (this server's public base, e.g. https://host/rc-render),
// each render is also stored under MCP_ROOT/images and served WITHOUT auth at
// <MCP_PUBLIC_URL>/images/<id>.png — 128 random bits per id, so only whoever has the link
// can fetch it. Renders are throwaway: links expire after MCP_IMAGE_TTL_HOURS (default 24).
const PUBLIC_URL = (process.env.MCP_PUBLIC_URL ?? "").replace(/\/+$/, "");
const HTTP_MODE = process.argv.includes("--http") || Boolean(process.env.MCP_HTTP_PORT);
const CAN_LINK = HTTP_MODE && Boolean(PUBLIC_URL) && Boolean(workspaceRoot());
const IMAGES_DIR = workspaceRoot() ? path.join(workspaceRoot(), "images") : null;
const IMAGE_TTL_MS = Number(process.env.MCP_IMAGE_TTL_HOURS ?? 24) * 3600_000;
const IMAGE_FILE = /^[A-Za-z0-9_-]{22}\.png$/;

let lastImagePrune = 0;
function pruneImages() {
    const now = Date.now();
    if (now - lastImagePrune < 600_000) return;
    lastImagePrune = now;
    for (const f of readdirSync(IMAGES_DIR)) {
        const p = path.join(IMAGES_DIR, f);
        try { if (now - statSync(p).mtimeMs > IMAGE_TTL_MS) rmSync(p, { force: true }); } catch {}
    }
}

/** Copy a render to the public folder; returns its URL. */
function publishImage(pngPath) {
    mkdirSync(IMAGES_DIR, { recursive: true });
    pruneImages();
    const name = `${randomBytes(16).toString("base64url")}.png`;
    copyFileSync(pngPath, path.join(IMAGES_DIR, name));
    return `${PUBLIC_URL}/images/${name}`;
}

/** GET <base>/images/<id>.png — no auth; see above. */
function publicRoute(req, url, res) {
    const m = /^\/images\/([^/]+)$/.exec(url.pathname);
    if (!m || !IMAGES_DIR) return false;
    const file = IMAGE_FILE.test(m[1]) ? path.join(IMAGES_DIR, m[1]) : null;
    if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD" });
        res.end();
        return true;
    }
    if (!file || !existsSync(file) || Date.now() - statSync(file).mtimeMs > IMAGE_TTL_MS) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found (render links expire)\n");
        return true;
    }
    const body = readFileSync(file);
    res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": body.length,
        "Cache-Control": "public, max-age=3600, immutable",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex",
        // Let clients' own pages embed it; it is just an image.
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
    });
    res.end(req.method === "HEAD" ? undefined : body);
    return true;
}

const EVENT_TYPES = ["down", "move", "up", "tap"];
const num = (v, what) => {
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${what} must be a finite number`);
    return String(v);
};

function buildArgs(a, rcPath, pngPath) {
    const args = [rcPath, pngPath];
    if (a.width !== undefined || a.height !== undefined) {
        if (a.width === undefined || a.height === undefined) {
            throw new Error("give both width and height, or neither");
        }
        args.push(num(a.width, "width"), num(a.height, "height"));
    }
    if (a.output_width !== undefined || a.output_height !== undefined) {
        if (a.output_width === undefined || a.output_height === undefined) {
            throw new Error("give both output_width and output_height, or neither");
        }
        args.push("--fit", num(a.output_width, "output_width"), num(a.output_height, "output_height"));
    }
    if (a.density !== undefined) args.push("--density", num(a.density, "density"));
    if (a.theme !== undefined) args.push("--theme", a.theme);
    if (a.clock !== undefined) {
        if (typeof a.clock === "number") args.push("--time", String(Math.trunc(a.clock)));
        else args.push("--clock", String(a.clock));
    }
    if (a.animation_time !== undefined) args.push("--anim", num(a.animation_time, "animation_time"));
    if (a.seed !== undefined) args.push("--seed", num(a.seed, "seed"));
    for (const [name, value] of Object.entries(a.variables ?? {})) {
        const text = Array.isArray(value) ? value.join(",") : String(value);
        args.push("--var", `${name}=${text}`);
    }
    for (const [id, value] of Object.entries(a.system_variables ?? {})) {
        args.push("--var-id", `${id}=${num(value, `system_variables.${id}`)}`);
    }
    if (a.touch_events?.length) {
        const spec = a.touch_events.map((e, i) => {
            if (!EVENT_TYPES.includes(e.type)) {
                throw new Error(`touch_events[${i}].type must be one of ${EVENT_TYPES.join(", ")}`);
            }
            const parts = [num(e.t, `touch_events[${i}].t`), e.type,
                           num(e.x, `touch_events[${i}].x`), num(e.y, `touch_events[${i}].y`)];
            if (e.vx !== undefined || e.vy !== undefined) {
                parts.push(num(e.vx ?? 0, `touch_events[${i}].vx`), num(e.vy ?? 0, `touch_events[${i}].vy`));
            }
            return parts.join(" ");
        }).join(";");
        args.push("--events", spec);
    }
    if (a.duration !== undefined) args.push("--duration", num(a.duration, "duration"));
    if (a.fps !== undefined) args.push("--fps", num(a.fps, "fps"));
    return args;
}

// ── Inputs shared by both tools ──────────────────────────────────────

const RENDER_PROPS = {
    width: { type: "number", description: "Layout width the document sees, px (default: the document's own)." },
    height: { type: "number", description: "Layout height the document sees, px." },
    output_width: { type: "number", description: "PNG width; the document is scaled to fit, centred." },
    output_height: { type: "number", description: "PNG height." },
    density: { type: "number", description: "Display density (dpi/160), e.g. 2.625. Default 1." },
    theme: { type: "string", enum: ["light", "dark"], description: "Colour theme. Default dark." },
    clock: {
        description:
            "Pin the clock. A string \"HH:MM[:SS]\" (today, local), \"YYYY-MM-DD\", " +
            "\"YYYY-MM-DDTHH:MM[:SS]\", or a number of epoch milliseconds.",
        anyOf: [{ type: "string" }, { type: "number" }],
    },
    animation_time: {
        type: "number",
        description: "Pin animationTime (seconds) for a single-frame render. Ignored when simulating.",
    },
    seed: { type: "integer", description: "Seed the random stream (rand())." },
    variables: {
        type: "object",
        description:
            "Host variables the document exposes by name (NAMED_VARIABLE): {name: value}. The " +
            "document's declared type decides the parsing: numbers for float/int/long, " +
            "\"#RRGGBB\"/\"#AARRGGBB\" for colours, text for strings, an array of numbers for " +
            "float arrays. `validate` lists what a document declares.",
        additionalProperties: {
            anyOf: [{ type: "number" }, { type: "string" }, { type: "array", items: { type: "number" } }],
        },
    },
    system_variables: {
        type: "object",
        description: "Floats overridden by raw variable id, e.g. {\"38\": 15} for battery level.",
        additionalProperties: { type: "number" },
    },
    touch_events: {
        type: "array",
        description:
            "Scripted touch sequence, dispatched as the simulated clock reaches each `t` " +
            "(seconds from the start). `up` releases (and clicks); `tap` is down+up at once. " +
            "vx/vy set the release velocity in px/s; without them it is measured from the " +
            "previous event (this drives flings).",
        items: {
            type: "object",
            properties: {
                t: { type: "number" },
                type: { type: "string", enum: EVENT_TYPES },
                x: { type: "number" },
                y: { type: "number" },
                vx: { type: "number" },
                vy: { type: "number" },
            },
            required: ["t", "type", "x", "y"],
        },
    },
    duration: {
        type: "number",
        description:
            "Seconds to simulate (default with touch_events: last event + 0.5). Also useful " +
            "alone, for animations and particles that need real frames.",
    },
    fps: { type: "integer", description: "Simulation frame rate. Default 60." },
    background: { type: "string", description: "Clear colour: \"transparent\" or AARRGGBB hex. Default white." },
};

/** Run rc2image with a --report, returning the parsed report alongside the outcome. */
async function renderWithReport(a, rcPath, pngPath, { check = false } = {}) {
    const reportPath = outputFile("report", ".json");
    const args = [...buildArgs(a, rcPath, pngPath), "--report", reportPath, ...(check ? ["--check"] : [])];
    const env = { ...process.env };
    if (a.background !== undefined) env.RC_BG = a.background.replace(/^#/, "");
    try {
        const { err, stdout, stderr } = await runRc2image(args, env);
        if (err?.code === "ENOENT") {
            throw new Error(`rc2image not found (${RC2IMAGE}). Build players/cpp or set RC2IMAGE.`);
        }
        let report = null;
        try { report = JSON.parse(readFileSync(reportPath, "utf8")); } catch {}
        const log = [stdout, stderr].map((x) => x.trim()).filter(Boolean).join("\n");
        return { err, log, report };
    } finally {
        rmSync(reportPath, { force: true });
    }
}

// Logs name the server's own absolute paths; show them as the caller names them.
const cleanLog = (log, doc, pngPath) =>
    log.split(doc.rcPath).join(doc.temp ? "<input>" : displayPath(doc.rcPath))
       .split(pngPath ?? "\0").join(displayPath(pngPath ?? ""));

const analysisOpts = (a) => ({
    simulated: Boolean(a.touch_events?.length) || a.duration !== undefined,
    tapped: hasTap(a.touch_events),
});

/** Whether the events hold a tap: a "tap", or a down and up that stay within a few dp of
 *  each other. A drag (down, moves, up) is not one, so it doesn't make `taps_missed` fire. */
function hasTap(events = []) {
    let down = null, moved = false;
    for (const e of events ?? []) {
        if (e.type === "tap") return true;
        if (e.type === "down") { down = e; moved = false; }
        else if (e.type === "move" && down && Math.hypot(e.x - down.x, e.y - down.y) > 10) moved = true;
        else if (e.type === "up" && down) {
            if (!moved && Math.hypot(e.x - down.x, e.y - down.y) <= 10) return true;
            down = null;
        }
    }
    return false;
}

export const definition = {
    name: "rc-render",
    version: "1.3.0",
    publicRoute,
    // Read by the guide server (guide-server.mjs); not part of the MCP protocol.
    guide: {
        summary: "Renders RemoteCompose documents (.rc or JSON) to a PNG with the C++/Skia player, and validates them.",
        useWhen: [
            "you want to see what a document looks like — at a given size, density, theme or time",
            "you want to see a document after interaction: a drag, a fling, a tap",
            "you want to know a document's host variables, or why it does not render",
        ],
        notFor: [
            "producing the .rc file to keep: use json2rc",
        ],
    },
    instructions:
        "Renders RemoteCompose documents (.rc or JSON) to a PNG with the C++/Skia player, and " +
        "validates them. Without `clock` every time variable reads the wall clock, so pin it " +
        "for reproducible output. Touch coordinates are in document coordinates (the " +
        "width/height the document is laid out at), not output pixels. Each render carries " +
        "sanity findings (blank image, missing fonts, text cut off or truncated, a component drawn past its box, …); read them before trusting a picture.",
    tools: [{
        name: "render_rc",
        // Writes the output file (in the workspace, over HTTP); never deletes or edits anything
        // else, and the same inputs give the same file.
        annotations: { title: "Render a RemoteCompose document to PNG", readOnlyHint: false, destructiveHint: false,
                       idempotentHint: true, openWorldHint: false },
        examples: [
            { what: "Render JSON at phone density with the clock pinned",
              arguments: { json_path: "docs/clock.json", density: 2.625, clock: "2026-01-01T10:10:00" } },
            { what: "Set host variables and render larger",
              arguments: { rc_path: "docs/card.rc", variables: { title: "Hello", accent: "#FF0066CC" },
                           output_width: 800, output_height: 600 } },
            { what: "Drag horizontally and let it fling, then capture",
              arguments: { rc_path: "samples/3d/04_bars.rc", touch_events: [
                  { t: 0, type: "down", x: 100, y: 170 }, { t: 0.1, type: "move", x: 180, y: 170 },
                  { t: 0.15, type: "up", x: 220, y: 170 }], duration: 1.5 } },
        ],
        description:
            "Render a RemoteCompose document to a single PNG image and return it. The document " +
            "can be a binary .rc (rc_path / rc_base64) or RemoteCompose JSON (json / json_path), " +
            "which is converted with json2rc first — no separate conversion step needed. " +
            "Options: layout size (width/height), output resolution (output_width/" +
            "output_height scale the document to fit), density, theme, host variables by " +
            "name, system variables by id, the clock, and a scripted touch sequence. With " +
            "touch_events or duration the document is simulated frame by frame with the " +
            "clock advancing, and the captured last frame lands at `clock`. The result " +
            "includes sanity findings: a blank or solid image, text with no fonts, text cut off or losing lines to maxLines, a component past its box, a " +
            "particle document rendered as one frame, taps that hit nothing." +
            (CAN_LINK ? " It also returns image_url, a public link to the PNG (24 h), for clients that cannot " +
                        "display MCP image content." : "") +
            (workspaceRoot() ? " Paths are relative to the server's workspace." : ""),
        inputSchema: {
            type: "object",
            properties: {
                ...DOCUMENT_PROPS,
                output_path: { type: "string", description: "Where to write the PNG (default: a generated file)." },
                ...RENDER_PROPS,
                public_link: {
                    type: "boolean",
                    description: CAN_LINK
                        ? "Also return image_url, a public link to the PNG that expires in 24 h (default true). " +
                          "Use it when the client cannot show the image content directly — e.g. as a markdown image."
                        : "Return a public image link. Not available on this server (needs HTTP mode and MCP_PUBLIC_URL).",
                },
            },
        },
        handler: async (a) => {
            const doc = prepareDocument(a);
            if (doc.conversionError) throw new Error(doc.conversionError);
            const pngPath = a.output_path !== undefined ? resolvePath(a.output_path, "output_path")
                                                        : outputFile("render", ".png");
            try {
                const { err, log, report } = await renderWithReport(a, doc.rcPath, pngPath);
                const shown = cleanLog(log, doc, pngPath);
                const findings = analyze(report, { ...analysisOpts(a), log })
                    .filter((x) => x.level !== "info");
                if (err) {
                    const why = findings.length ? formatFindings(findings) : shown || err.message;
                    throw new Error(`rc2image failed${err.killed ? " (timed out)" : ""}:\n${why}`);
                }
                const link = CAN_LINK && a.public_link !== false ? publishImage(pngPath) : null;
                const text = [link && `image_url: ${link}\n(public link to this render, valid for ` +
                                      `${Math.round(IMAGE_TTL_MS / 3600_000)} h — show it as ![render](${link}) ` +
                                      "if the image above does not display)",
                              `png_path: ${displayPath(pngPath)} (on the server)`, shown,
                              findings.length ? "findings:\n" + formatFindings(findings) : "findings: none"]
                    .filter(Boolean).join("\n");
                return [
                    { type: "image", data: readFileSync(pngPath).toString("base64"), mimeType: "image/png" },
                    { type: "text", text },
                ];
            } finally {
                if (doc.temp) rmSync(doc.rcPath, { force: true });
            }
        },
    }, {
        name: "validate",
        // Clients such as ChatGPT gate tools on these: read-only ones run without a write
        // confirmation. Only scratch files it deletes again are written.
        annotations: { title: "Validate a RemoteCompose document", readOnlyHint: true, openWorldHint: false },
        examples: [
            { what: "Check a JSON document converts and parses, without rendering",
              arguments: { json_path: "docs/clock.json", render: false } },
            { what: "Full check, with a sanity render at the clock you care about",
              arguments: { rc_path: "docs/clock.rc", clock: "10:10" } },
        ],
        description:
            "Check a RemoteCompose document without returning an image: does the JSON convert " +
            "(json2rc), does the C++ engine parse the .rc (and if not, at which byte and opcode), " +
            "its size, operation counts, the host variables it declares (name, type, initial " +
            "value — what render_rc's `variables` can set), whether it is interactive, and, " +
            "unless render is false, a sanity render (blank image, missing fonts, …) with the " +
            "same options as render_rc. Returns JSON with `ok`, `findings` and the details." +
            (workspaceRoot() ? " Paths are relative to the server's workspace." : ""),
        inputSchema: {
            type: "object",
            properties: {
                ...DOCUMENT_PROPS,
                render: {
                    type: "boolean",
                    description: "Also do a sanity render with the options below (default true). " +
                                 "false stops after parsing and the data pass.",
                },
                include_image: { type: "boolean", description: "Return the sanity render's PNG too (default false)." },
                ...RENDER_PROPS,
            },
        },
        handler: async (a) => {
            const result = { ok: false };
            const doc = prepareDocument(a);
            if (doc.conversionError) {
                result.conversion = { ok: false, error: doc.conversionError };
                result.findings = [{ level: "error", code: "conversion_failed", message: doc.conversionError }];
                return [{ type: "text", text: JSON.stringify(result, null, 1) }];
            }
            if (doc.source === "json") result.conversion = { ok: true, bytes: doc.bytes };

            const doRender = a.render !== false;
            const pngPath = doRender ? outputFile("validate", ".png") : null;
            try {
                const { err, log, report } = await renderWithReport(
                    a, doc.rcPath, pngPath ?? "/dev/null", { check: !doRender });
                const findings = analyze(report, { ...analysisOpts(a), log });
                if (err && !findings.some((x) => x.level === "error")) {
                    // rc2image failed for a reason the report does not cover (a bad option,
                    // an unknown variable name): that message is the finding.
                    const msg = cleanLog(log, doc, pngPath).split("\n").filter((l) => /^Error:/.test(l))
                        .map((l) => l.replace(/^Error:\s*/, "")).join("; ") || err.message;
                    findings.unshift({ level: "error", code: "render_failed", message: msg });
                }
                Object.assign(result, {
                    ok: !findings.some((x) => x.level === "error"),
                    findings,
                    parse: report?.parse,
                    header: report?.header,
                    features: report?.parse?.ok ? documentFeatures(report) : undefined,
                    namedVariables: report?.namedVariables,
                    ops: report?.ops,
                    fonts: report?.fonts,
                    render: report?.render,
                });
                const content = [{ type: "text", text: JSON.stringify(result, null, 1) }];
                if (a.include_image && pngPath && existsSync(pngPath) && !err) {
                    content.unshift({ type: "image", data: readFileSync(pngPath).toString("base64"), mimeType: "image/png" });
                }
                return content;
            } finally {
                if (doc.temp) rmSync(doc.rcPath, { force: true });
                if (pngPath) rmSync(pngPath, { force: true });
            }
        },
    }],
};

if (isMain(import.meta.url)) serve(definition);
