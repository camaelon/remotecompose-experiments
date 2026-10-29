// Running the C++ renderer, rc2image (players/cpp/tools/rc2image). RC2IMAGE overrides the
// binary; otherwise the default CMake build location is used, then `rc2image` on PATH.

import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { outputFile } from "./workspace.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BIN = path.join(HERE, "..", "..", "players", "cpp", "build", "tools", "rc2image", "rc2image");
export const RC2IMAGE = process.env.RC2IMAGE ?? (existsSync(DEFAULT_BIN) ? DEFAULT_BIN : "rc2image");

// Renders are CPU-bound child processes; a small VPS should not run a dozen at once.
const MAX_RENDERS = Math.max(1, Number(process.env.MCP_MAX_RENDERS ?? 2));
let running = 0;
const waiting = [];
export async function withRenderSlot(fn) {
    if (running >= MAX_RENDERS) await new Promise((r) => waiting.push(r));
    running++;
    try { return await fn(); } finally { running--; waiting.shift()?.(); }
}

/** Run rc2image; resolves (never rejects) with {err, stdout, stderr}. */
export function runRc2image(args, env = process.env) {
    return withRenderSlot(() => new Promise((resolve) => {
        execFile(RC2IMAGE, args, { env, timeout: 120_000, maxBuffer: 16 << 20 },
                 (err, stdout, stderr) => resolve({ err, stdout, stderr }));
    }));
}

/**
 * Parse an .rc and run its data pass only (rc2image --check), returning the --report facts:
 * parse result, header, op counts, named variables with types and initial values.
 */
export async function checkReport(rcPath) {
    const reportPath = outputFile("report", ".json");
    try {
        const { err, stdout, stderr } = await runRc2image([rcPath, "/dev/null", "--check", "--report", reportPath]);
        if (err?.code === "ENOENT") {
            throw new Error(`rc2image not found (${RC2IMAGE}). Build players/cpp or set RC2IMAGE.`);
        }
        let report = null;
        try { report = JSON.parse(readFileSync(reportPath, "utf8")); } catch {}
        return { report, err, log: [stdout, stderr].map((x) => x.trim()).filter(Boolean).join("\n") };
    } finally {
        rmSync(reportPath, { force: true });
    }
}
