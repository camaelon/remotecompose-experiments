// Run the RemoteCompose inspector's analyses (inspector/src/panels) on a document, in Node,
// with no browser: each call is one worker thread (lib/inspector-worker.mjs) holding the
// TypeScript player and the panels under a small browser shim.

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { BUNDLE_PATH, playerBundle } from "./web-player.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PANELS_DIR = process.env.RC_INSPECTOR_PANELS ??
    path.join(HERE, "..", "..", "inspector", "src", "panels");
const WORKER = path.join(HERE, "inspector-worker.mjs");
const TIMEOUT_MS = Number(process.env.MCP_INSPECT_TIMEOUT_MS ?? 30_000);
const MAX_PARALLEL = Math.max(1, Number(process.env.MCP_MAX_INSPECTIONS ?? 2));

let running = 0;
const queue = [];
async function slot(fn) {
    if (running >= MAX_PARALLEL) await new Promise((r) => queue.push(r));
    running++;
    try { return await fn(); } finally { running--; queue.shift()?.(); }
}

/** Run one inspector task on .rc bytes. Resolves to the task's JSON result; rejects with its error. */
export async function inspect(bytes, task, options = {}) {
    if (!existsSync(PANELS_DIR)) throw new Error(`the inspector sources are missing (${PANELS_DIR})`);
    await playerBundle();   // builds the TypeScript player bundle when missing or stale
    return slot(() => new Promise((resolve, reject) => {
        const w = new Worker(WORKER, {
            workerData: { bundlePath: BUNDLE_PATH, panelsDir: PANELS_DIR, bytes, task, options },
            resourceLimits: { maxOldGenerationSizeMb: 768 },
            stdout: true, stderr: true,
        });
        let settled = false;
        const done = (fn, v) => { if (!settled) { settled = true; clearTimeout(timer); w.terminate(); fn(v); } };
        const timer = setTimeout(() => done(reject, new Error(`inspection timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);
        w.on("message", (m) => (m.ok ? done(resolve, m.result) : done(reject, new Error(m.error))));
        // An error thrown while the worker sets up (loading the document) arrives here.
        w.on("error", (e) => done(reject, new Error(e?.message ?? String(e))));
        w.on("exit", (code) => done(reject, new Error(`inspector exited (${code}) without a result`)));
    }));
}
