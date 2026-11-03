// The pictures of a session trace: every image a tool returned (render_rc, render variants,
// contact sheets, the front door's render), kept as a PNG next to the call that made it, so the
// session page can show what the assistant saw. Private: served only through the account pages
// (account/sessions/<client>/img/<file>), to the account and admins.
//
//   <RC_TRACE_DIR | MCP_ROOT/traces>/<account id>/<client>/<call id>-<n>.png
//
// Wider than 960 px: scaled down (lib/thumbs.mjs). At most RC_TRACE_IMAGES (200) images and
// RC_TRACE_MB (50) MB per session; past that the call records how many it skipped. Deleted with
// the call's arguments and result after 30 days (Accounts.cleanup).

import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { decodePng, downscale, encodePng } from "./thumbs.mjs";

export const MAX_WIDTH = 960;

export function traceRoot(env = process.env) {
    if (env.RC_TRACE_DIR) return path.resolve(env.RC_TRACE_DIR);
    return env.MCP_ROOT ? path.join(path.resolve(env.MCP_ROOT), "traces") : null;
}

/** A session id as a folder name: what ctx.client can hold (hex, a leading "~"). */
export const safeClient = (client) => String(client ?? "").replace(/[^A-Za-z0-9~_-]/g, "_").slice(0, 40) || "_";

export function sessionDir(accountId, client, env = process.env) {
    const root = traceRoot(env);
    return root ? path.join(root, String(Number(accountId)), safeClient(client)) : null;
}

/** The PNG to keep: the image itself, or scaled to MAX_WIDTH when wider. Null when not a PNG. */
export function keptPng(buf) {
    if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
    if (buf.readUInt32BE(16) <= MAX_WIDTH) return buf;
    try { return encodePng(downscale(decodePng(buf), MAX_WIDTH)); } catch { return buf; }   // a PNG thumbs.mjs cannot read: kept as it is
}

/**
 * Writes a call's result images: {files: [names], skipped: n} (null when it had none, or there
 * is nowhere to keep them). Never throws: a trace must not break a call.
 */
export function saveTraceImages({ accountId, client, callId, content, env = process.env }) {
    const images = Array.isArray(content) ? content.filter((c) => c?.type === "image" && typeof c.data === "string") : [];
    const dir = images.length ? sessionDir(accountId, client, env) : null;
    if (!dir) return null;
    const maxCount = Number(env.RC_TRACE_IMAGES ?? 200), maxBytes = Number(env.RC_TRACE_MB ?? 50) * (1 << 20);
    try {
        mkdirSync(dir, { recursive: true });
        let count = 0, bytes = 0;
        for (const f of readdirSync(dir)) { count++; try { bytes += statSync(path.join(dir, f)).size; } catch { /* gone */ } }
        const files = [];
        let skipped = 0;
        images.forEach((img, n) => {
            const png = keptPng(Buffer.from(img.data, "base64"));
            if (!png) { skipped++; return; }
            if (count >= maxCount || bytes + png.length > maxBytes) { skipped++; return; }
            const name = `${Number(callId)}-${n}.png`;
            writeFileSync(path.join(dir, name), png);
            files.push(name);
            count++; bytes += png.length;
        });
        return files.length || skipped ? { files, skipped } : null;
    } catch { return null; }
}

/** Deletes a call's image files (retention). */
export function deleteTraceImages(accountId, client, files, env = process.env) {
    const dir = sessionDir(accountId, client, env);
    if (!dir) return;
    for (const f of files ?? []) if (/^\d+-\d+\.png$/.test(f)) rmSync(path.join(dir, f), { force: true });
    try { if (existsSync(dir) && !readdirSync(dir).length) rmSync(dir, { recursive: true, force: true }); } catch { /* not empty */ }
}

/** The file of a session image, when the name is one we write; null otherwise. */
export function traceImagePath(accountId, client, file, env = process.env) {
    if (!/^\d+-\d+\.png$/.test(file)) return null;
    const dir = sessionDir(accountId, client, env);
    return dir ? path.join(dir, file) : null;
}
