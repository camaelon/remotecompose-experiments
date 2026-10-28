#!/usr/bin/env node
// MCP server: render a RemoteCompose .rc document to one PNG with the C++/Skia player
// (players/cpp/tools/rc2image). RC2IMAGE overrides the binary; otherwise the default CMake
// build location is used, then `rc2image` on PATH.
// stdio by default; `--http [PORT]` for Streamable HTTP (see lib/mcp-server.mjs).

import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, documentFeatures, formatFindings } from "./lib/analysis.mjs";
import { jsonToRc } from "./lib/json2rc.mjs";
import { isMain, serve } from "./lib/mcp-server.mjs";
import { displayPath, outputFile, resolvePath, workspaceRoot } from "./lib/workspace.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BIN = path.join(HERE, "..", "players", "cpp", "build", "tools", "rc2image", "rc2image");
const RC2IMAGE = process.env.RC2IMAGE ?? (existsSync(DEFAULT_BIN) ? DEFAULT_BIN : "rc2image");

// Renders are CPU-bound child processes; a small VPS should not run a dozen at once.
const MAX_RENDERS = Math.max(1, Number(process.env.MCP_MAX_RENDERS ?? 2));
let running = 0;
const waiting = [];
async function withRenderSlot(fn) {
    if (running >= MAX_RENDERS) await new Promise((r) => waiting.push(r));
    running++;
    try { return await fn(); } finally { running--; waiting.shift()?.(); }
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

function run(bin, args, env) {
    return new Promise((resolve) => {
        execFile(bin, args, { env, timeout: 120_000, maxBuffer: 16 << 20 },
                 (err, stdout, stderr) => resolve({ err, stdout, stderr }));
    });
}

// ── Inputs shared by both tools ──────────────────────────────────────

const DOCUMENT_PROPS = {
    rc_path: { type: "string", description: "Path to a binary .rc file." },
    rc_base64: { type: "string", description: "The .rc bytes, base64." },
    json: {
        description: "A RemoteCompose JSON document (object or string), converted with json2rc first.",
        anyOf: [{ type: "object" }, { type: "string" }],
    },
    json_path: { type: "string", description: "Path to a RemoteCompose JSON document, converted with json2rc first." },
    base_dir: {
        type: "string",
        description: "For json/json_path: the folder {\"file\": ...} bitmaps resolve against " +
                     "(default: json_path's folder, or the working directory/workspace).",
    },
};

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

/**
 * Resolve whichever document input was given to an .rc file on disk. A conversion failure
 * is returned, not thrown, so `validate` can report it as a finding.
 */
function prepareDocument(a) {
    const given = ["rc_path", "rc_base64", "json", "json_path"].filter((k) => a[k] !== undefined);
    if (given.length !== 1) {
        throw new Error("give exactly one of `rc_path`, `rc_base64`, `json` or `json_path`");
    }
    if (a.rc_path !== undefined) {
        const rcPath = resolvePath(a.rc_path, "rc_path");
        if (!existsSync(rcPath)) throw new Error(`no such file: ${a.rc_path}`);
        return { rcPath, temp: false, source: "rc" };
    }
    let bytes, source = "rc";
    if (a.rc_base64 !== undefined) {
        bytes = Buffer.from(a.rc_base64, "base64");
    } else {
        source = "json";
        const jsonFile = a.json_path !== undefined ? resolvePath(a.json_path, "json_path") : null;
        if (jsonFile && !existsSync(jsonFile)) throw new Error(`no such file: ${a.json_path}`);
        const dir = a.base_dir !== undefined ? resolvePath(a.base_dir, "base_dir")
            : jsonFile ? path.dirname(jsonFile) : resolvePath(".");
        try {
            bytes = jsonToRc(jsonFile ? readFileSync(jsonFile, "utf8") : a.json, dir);
        } catch (e) {
            return { conversionError: String(e?.message ?? e), source };
        }
    }
    if (!bytes.length) throw new Error("the document is empty");
    const rcPath = outputFile("input", ".rc");
    writeFileSync(rcPath, bytes);
    return { rcPath, temp: true, source, bytes: bytes.length };
}

/** Run rc2image with a --report, returning the parsed report alongside the outcome. */
async function renderWithReport(a, rcPath, pngPath, { check = false } = {}) {
    const reportPath = outputFile("report", ".json");
    const args = [...buildArgs(a, rcPath, pngPath), "--report", reportPath, ...(check ? ["--check"] : [])];
    const env = { ...process.env };
    if (a.background !== undefined) env.RC_BG = a.background.replace(/^#/, "");
    try {
        const { err, stdout, stderr } = await withRenderSlot(() => run(RC2IMAGE, args, env));
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
    tapped: Boolean(a.touch_events?.some((e) => e.type === "tap" || e.type === "up")),
});

export const definition = {
    name: "rc-render",
    version: "1.2.0",
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
        "sanity findings (blank image, missing fonts, …); read them before trusting a picture.",
    tools: [{
        name: "render_rc",
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
            "includes sanity findings: a blank or solid image, text with no fonts, a " +
            "particle document rendered as one frame, taps that hit nothing." +
            (workspaceRoot() ? " Paths are relative to the server's workspace." : ""),
        inputSchema: {
            type: "object",
            properties: {
                ...DOCUMENT_PROPS,
                output_path: { type: "string", description: "Where to write the PNG (default: a generated file)." },
                ...RENDER_PROPS,
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
                const text = [`png_path: ${displayPath(pngPath)}`, shown,
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
