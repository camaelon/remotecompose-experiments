// Where tool file paths may point.
//
// Locally (no MCP_ROOT) paths are taken as given, relative to the working directory — the
// tools act for the person running them. With MCP_ROOT set, which HTTP mode requires, every
// path resolves inside that folder and anything that escapes it (.., an absolute path
// elsewhere, a symlink out) is refused: over a network the caller is not the machine's owner.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ROOT = process.env.MCP_ROOT ? realpathOrSelf(path.resolve(process.env.MCP_ROOT)) : null;
// Generated files older than this are pruned from the output folder (MCP_ROOT mode only).
const OUT_TTL_MS = Number(process.env.MCP_OUT_TTL_HOURS ?? 24) * 3600_000;

function realpathOrSelf(p) {
    try { return realpathSync(p); } catch { return p; }
}

export const workspaceRoot = () => ROOT;

/** Resolve a caller-supplied path, confined to MCP_ROOT when there is one. */
export function resolvePath(p, what = "path") {
    if (typeof p !== "string" || !p) throw new Error(`${what} must be a non-empty string`);
    if (!ROOT) return path.resolve(p);
    const abs = path.resolve(ROOT, p);
    // Check the real location of the deepest part that exists, so a symlink inside the root
    // that points out of it is caught too.
    let probe = abs;
    while (!existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
    const real = path.join(realpathOrSelf(probe), path.relative(probe, abs));
    if (real !== ROOT && !real.startsWith(ROOT + path.sep)) {
        throw new Error(`${what} "${p}" is outside the workspace`);
    }
    return real;
}

/** How a path is shown back to the caller: relative to the root, which is how they name it. */
export const displayPath = (abs) => (ROOT ? path.relative(ROOT, abs) || "." : abs);

let localScratch = null;

/** Folder for generated files the caller did not name. */
export function outputDir() {
    if (!ROOT) return (localScratch ??= mkdtempSync(path.join(tmpdir(), "rc-mcp-")));
    const dir = path.join(ROOT, "out");
    mkdirSync(dir, { recursive: true });
    prune(dir);
    return dir;
}

let lastPrune = 0;
function prune(dir) {
    const now = Date.now();
    if (now - lastPrune < 600_000) return;
    lastPrune = now;
    for (const f of readdirSync(dir)) {
        const p = path.join(dir, f);
        try { if (now - statSync(p).mtimeMs > OUT_TTL_MS) rmSync(p, { force: true }); } catch {}
    }
}

/** A fresh file name in the output folder. */
export function outputFile(prefix, ext) {
    const rand = Math.random().toString(36).slice(2, 8);
    return path.join(outputDir(), `${prefix}-${Date.now()}-${rand}${ext}`);
}
