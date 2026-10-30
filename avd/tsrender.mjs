// tsrender.mjs — render .rc documents at chosen animation times with the TypeScript player.
//
//   echo '[["doc.rc", "out.png", W, H, seconds], ...]' | node avd/tsrender.mjs [--theme dark|light]
//
// One node process for a whole batch. It combines what players/typescript/render.mjs and
// frames.mjs each do half of: render.mjs's Path2D polyfill (frames.mjs stubs Path2D, so
// path documents come out blank there) and frames.mjs's performance.now() stub (the only way
// to set animationTime). Transparent background, like rc2image with RC_BG=transparent.
import { readFileSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TS = path.join(HERE, '..', 'players', 'typescript');
const { createCanvas } = createRequire(path.join(TS, 'package.json'))('canvas');

class P {
    constructor() { this._commands = []; }
    moveTo(...a) { this._commands.push(['moveTo', a]); } lineTo(...a) { this._commands.push(['lineTo', a]); }
    quadraticCurveTo(...a) { this._commands.push(['quadraticCurveTo', a]); }
    bezierCurveTo(...a) { this._commands.push(['bezierCurveTo', a]); }
    arc(...a) { this._commands.push(['arc', a]); } rect(...a) { this._commands.push(['rect', a]); }
    ellipse(...a) { this._commands.push(['ellipse', a]); }
    closePath() { this._commands.push(['closePath', []]); }
    addPath(p) { if (p && p._commands) this._commands.push(...p._commands); }
}
globalThis.Path2D = P;
function patch(ctx) {
    const o = { fill: ctx.fill.bind(ctx), stroke: ctx.stroke.bind(ctx), clip: ctx.clip.bind(ctx) };
    const replay = p => { ctx.beginPath(); for (const [m, a] of p._commands || []) ctx[m](...a); };
    ctx.fill = (p, r) => (p && p._commands ? (replay(p), o.fill(r)) : o.fill(p, r));
    ctx.stroke = p => (p && p._commands ? (replay(p), o.stroke()) : o.stroke(p));
    ctx.clip = (p, r) => (p && p._commands ? (replay(p), o.clip(r)) : o.clip(p, r));
    return ctx;
}
// --android-trim: the TypeScript player ignores DRAW_TWEEN_PATH's start / stop (it always
// draws the whole path; docs/EXAMPLES_FINDINGS.md). With this flag the harness trims the
// recorded path itself the way Android's player does (PathMeasure over the first contour
// with a length, getSegment(start, stop)), so trim animations can be checked on this player.
function flattenFirstContour(cmds) {
    const contours = [];
    let cur = null, sx = 0, sy = 0, cx = 0, cy = 0;
    const bez = (p0, p1, p2, p3, t) => { const u = 1 - t; return u*u*u*p0 + 3*u*u*t*p1 + 3*u*t*t*p2 + t*t*t*p3; };
    for (const [m, a] of cmds) {
        if (m === 'moveTo') { cur = [[a[0], a[1]]]; contours.push(cur); sx = cx = a[0]; sy = cy = a[1]; continue; }
        if (!cur) { cur = [[cx, cy]]; contours.push(cur); }
        if (m === 'lineTo') { cur.push([a[0], a[1]]); cx = a[0]; cy = a[1]; }
        else if (m === 'quadraticCurveTo') {
            for (let i = 1; i <= 48; i++) { const t = i / 48, u = 1 - t;
                cur.push([u*u*cx + 2*u*t*a[0] + t*t*a[2], u*u*cy + 2*u*t*a[1] + t*t*a[3]]); }
            cx = a[2]; cy = a[3];
        } else if (m === 'bezierCurveTo') {
            for (let i = 1; i <= 48; i++) { const t = i / 48;
                cur.push([bez(cx, a[0], a[2], a[4], t), bez(cy, a[1], a[3], a[5], t)]); }
            cx = a[4]; cy = a[5];
        } else if (m === 'closePath') { cur.push([sx, sy]); cx = sx; cy = sy; cur = null; }
    }
    const len = pts => { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]); return l; };
    for (const c of contours) if (c.length > 1 && len(c) > 0) return [c, len(c)];
    return [null, 0];
}
function trimCommands(cmds, start, end) {
    if (!(start > 0 || end < 1)) return cmds;
    if (!(start < end)) return [];
    const [pts, total] = flattenFirstContour(cmds);
    if (!pts) return [];
    const d0 = Math.max(0, start) * total, d1 = Math.min(1, end) * total;
    const out = [];
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i-1], b = pts[i], l = Math.hypot(b[0]-a[0], b[1]-a[1]);
        if (l > 0 && acc + l >= d0 && acc <= d1) {
            const u0 = Math.max(0, (d0 - acc) / l), u1 = Math.min(1, (d1 - acc) / l);
            if (!out.length) out.push(['moveTo', [a[0] + (b[0]-a[0])*u0, a[1] + (b[1]-a[1])*u0]]);
            out.push(['lineTo', [a[0] + (b[0]-a[0])*u1, a[1] + (b[1]-a[1])*u1]]);
        }
        acc += l;
    }
    return out;
}
const ANDROID_TRIM = process.argv.includes('--android-trim');
let fakeNow = 0;
globalThis.performance = { now: () => fakeNow };
const { RemoteComposeBuffer, CoreDocument, CanvasPaintContext, WebRemoteContext } =
    await import(path.join(TS, 'build-node', 'node-entry.js'));

if (ANDROID_TRIM) {
    const orig = CanvasPaintContext.prototype.buildPath2D;
    CanvasPaintContext.prototype.buildPath2D = function (data, start = 0, end = 1) {
        const p = orig.call(this, data, 0, 1);
        if (p && p._commands) p._commands = trimCommands(p._commands, start, end);
        return p;
    };
}
const argv = process.argv.slice(2);
const themeName = argv.includes('--theme') ? argv[argv.indexOf('--theme') + 1] : 'dark';
const THEME = { light: -3, dark: -2 }[themeName] ?? -2;
const jobs = JSON.parse(readFileSync(0, 'utf8'));
const results = {};
for (const [file, out, W, H, t] of jobs) {
    try {
        const data = readFileSync(file);
        fakeNow = 0;      // before new CoreDocument: TimeVariables anchors its start here
        const doc = new CoreDocument();
        doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
        doc.setWidth?.(W); doc.setHeight?.(H);
        const canvas = createCanvas(W, H);
        const ctx = patch(canvas.getContext('2d'));
        const paint = new CanvasPaintContext(null, ctx);
        const remote = new WebRemoteContext(paint);
        remote.mWidth = W; remote.mHeight = H;
        doc.initializeContext(remote);
        remote.loadFloat(5, W); remote.loadFloat(6, H);
        remote.setDensity?.(1);
        remote.setPaintContext(paint); paint.setContext(remote);
        paint.createLayerCanvas = (w, h) => patch(createCanvas(Math.max(1, w), Math.max(1, h)).getContext('2d'));
        paint.loadBitmap = () => {};
        doc.applyDataOperations(remote);
        fakeNow = t * 1000;
        paint.reset?.();
        doc.paint(remote, THEME);
        writeFileSync(out, canvas.toBuffer('image/png'));
        results[out] = null;
    } catch (e) {
        results[out] = String(e && e.stack || e).slice(0, 300);
    }
}
process.stdout.write(JSON.stringify(results));
