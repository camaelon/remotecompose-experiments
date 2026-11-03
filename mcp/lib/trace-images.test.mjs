import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openAccounts } from "./accounts.mjs";
import { encodePng } from "./thumbs.mjs";
import { keptPng, saveTraceImages, sessionDir, traceImagePath } from "./trace-images.mjs";

const png = (w, h) => encodePng({ width: w, height: h, rgba: new Uint8Array(w * h * 4).fill(200) });
const img = (w, h) => ({ type: "image", mimeType: "image/png", data: png(w, h).toString("base64") });

test("result images are kept per call, scaled to 960 px wide, capped per session", () => {
    const root = mkdtempSync(path.join(tmpdir(), "rc-timg-"));
    const env = { RC_TRACE_DIR: root, RC_TRACE_IMAGES: "3" };
    try {
        const r = saveTraceImages({ accountId: 7, client: "abcd1234", callId: 41, env,
            content: [{ type: "text", text: "x" }, img(1920, 1080), img(320, 200)] });
        assert.deepEqual(r, { files: ["41-0.png", "41-1.png"], skipped: 0 }, "named by call id and picture number");
        const big = readFileSync(path.join(sessionDir(7, "abcd1234", env), "41-0.png"));
        assert.equal(big.readUInt32BE(16), 960, "scaled down");
        assert.equal(big.readUInt32BE(20), 540);
        assert.equal(readFileSync(path.join(sessionDir(7, "abcd1234", env), "41-1.png")).readUInt32BE(16), 320, "small ones as they are");
        // The cap (3 here): one more fits, the rest are counted as skipped.
        assert.deepEqual(saveTraceImages({ accountId: 7, client: "abcd1234", callId: 42, env, content: [img(10, 10), img(10, 10)] }), { files: ["42-0.png"], skipped: 1 });
        assert.equal(saveTraceImages({ accountId: 7, client: "abcd1234", callId: 43, env, content: [{ type: "text", text: "no pictures" }] }), null);
        // Megabytes cap.
        assert.deepEqual(saveTraceImages({ accountId: 7, client: "other", callId: 1, env: { ...env, RC_TRACE_MB: "0" }, content: [img(10, 10)] }), { files: [], skipped: 1 });
        // Not a PNG: not kept. A client id with odd characters: a safe folder name.
        assert.equal(keptPng(Buffer.from("GIF89a....................")), null);
        assert.ok(sessionDir(1, "../../etc", env).startsWith(root));
        assert.equal(traceImagePath(1, "c", "../x.png", env), null);
    } finally { rmSync(root, { recursive: true, force: true }); }
});

test("retention deletes the picture files with the trace", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "rc-timg-"));
    const saved = process.env.RC_TRACE_DIR;
    process.env.RC_TRACE_DIR = root;
    try {
        const s = await openAccounts(":memory:");
        const old = s.recordCall({ accountId: 3, server: "rc-render", tool: "render_rc", ms: 5, ok: true, client: "sess0001", args: "{}", result: "r", ts: "2020-01-01T00:00:00.000Z" });
        const fresh = s.recordCall({ accountId: 3, server: "rc-render", tool: "render_rc", ms: 5, ok: true, client: "sess0001", args: "{}", result: "r" });
        s.setCallImages(old, saveTraceImages({ accountId: 3, client: "sess0001", callId: old, content: [img(4, 4)] }));
        s.setCallImages(fresh, saveTraceImages({ accountId: 3, client: "sess0001", callId: fresh, content: [img(4, 4)] }));
        assert.ok(s.sessionHasImage(3, "sess0001", `${old}-0.png`));
        assert.equal(s.sessionHasImage(4, "sess0001", `${old}-0.png`), false, "another account's");
        assert.equal(s.sessionHasImage(3, "other", `${old}-0.png`), false, "another session's");
        s.cleanup();
        const dir = sessionDir(3, "sess0001");
        assert.deepEqual(readdirSync(dir), [`${fresh}-0.png`]);
        assert.equal(s.db.prepare("SELECT images FROM calls WHERE id = ?").get(old).images, null);
        assert.equal(s.sessionHasImage(3, "sess0001", `${old}-0.png`), false);
        assert.ok(existsSync(path.join(dir, `${fresh}-0.png`)));
    } finally {
        if (saved === undefined) delete process.env.RC_TRACE_DIR; else process.env.RC_TRACE_DIR = saved;
        rmSync(root, { recursive: true, force: true });
    }
});
