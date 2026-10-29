// The TypeScript player as one minified script (an IIFE exposing `RC`), for embedding in
// pages. Built from players/typescript/src/web/main.ts with esbuild.
//
// The built file is cached at RC_PLAYER_BUNDLE (default players/typescript/build-mcp/
// player.min.js). It is rebuilt when a source file is newer, if esbuild is installed and
// the folder is writable. On a deployment neither is true for the service (the checkout is
// read-only to it), so setup.sh prebuilds it:
//
//   node mcp/lib/web-player.mjs --build

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isMain } from "./mcp-server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..");
const TS_DIR = path.join(REPO, "players", "typescript");
const ENTRY = path.join(TS_DIR, "src", "web", "main.ts");
export const BUNDLE_PATH = process.env.RC_PLAYER_BUNDLE ?? path.join(TS_DIR, "build-mcp", "player.min.js");

function newestSource(dir) {
    let newest = 0;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) newest = Math.max(newest, newestSource(p));
        else if (e.name.endsWith(".ts")) newest = Math.max(newest, statSync(p).mtimeMs);
    }
    return newest;
}

/** esbuild from the repo root's devDependencies, or the TS player's own; null if neither. */
function loadEsbuild() {
    for (const from of [REPO, TS_DIR]) {
        try { return createRequire(path.join(from, "package.json"))("esbuild"); } catch {}
    }
    return null;
}

async function build() {
    const esbuild = loadEsbuild();
    if (!esbuild) {
        throw new Error("the web player bundle is missing and esbuild is not installed: run `npm ci` " +
                        "at the repo root, then `node mcp/lib/web-player.mjs --build`");
    }
    const out = await esbuild.build({
        entryPoints: [ENTRY], bundle: true, minify: true, format: "iife", target: "es2020",
        globalName: "RC", write: false, logLevel: "silent",
    });
    const code = out.outputFiles[0].text;
    mkdirSync(path.dirname(BUNDLE_PATH), { recursive: true });
    writeFileSync(BUNDLE_PATH, code);
    return code;
}

let cached = null;   // {code, mtime}
let lastCheck = 0;

/** The player script, rebuilding it first when it is missing or out of date (and buildable). */
export async function playerBundle() {
    const now = Date.now();
    if (cached && now - lastCheck < 60_000) return cached.code;
    lastCheck = now;

    const have = existsSync(BUNDLE_PATH) ? statSync(BUNDLE_PATH).mtimeMs : 0;
    let stale = !have;
    if (have && existsSync(ENTRY)) stale = newestSource(path.dirname(path.dirname(ENTRY))) > have;
    if (stale) {
        try {
            const code = await build();
            cached = { code, mtime: statSync(BUNDLE_PATH).mtimeMs };
            return code;
        } catch (e) {
            if (!have) throw e;
            // Out of date but unbuildable here (read-only checkout, no esbuild): the prebuilt
            // one is still a working player, just not the newest.
        }
    }
    if (!cached || cached.mtime !== have) cached = { code: readFileSync(BUNDLE_PATH, "utf8"), mtime: have };
    return cached.code;
}

if (isMain(import.meta.url) && process.argv.includes("--build")) {
    const code = await build();
    console.error(`built ${BUNDLE_PATH} (${code.length} bytes)`);
}
