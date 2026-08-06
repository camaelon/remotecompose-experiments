// trace.mjs — run a document frame by frame in Node and watch its *state*.
//
// Pixels are a terrible instrument for debugging a document: a frame that looks alive
// can be entirely driven by `continuousSeconds()` while every action in the document is
// a no-op, and a frame that looks frozen may just be a headless browser that painted
// once. This drives the real player over N frames and reports what actually changed:
// which float variables moved, and which operations ran.
//
//   node trace.mjs DOC.rc [--frames 30] [--fps 30] [--hold] [--ops] [--watch id,id]
//
//   --hold   press and keep pressing at the centre from frame 2 (touch/impulse tests)
//   --tap    simulate discrete taps: --tap 30:120:200,90:300:260  (frame:x:y, ...)
//   --ops    also count how many times each operation class was applied
//   --dump   print `frame N id=value ...` for diffing against the reference tracer
//   --width/--height  viewport for a document that declares no size (default 400x800)
//   --watch  print these float ids every frame instead of only the ones that change
//
// --tap exists because `--hold` alone cannot drive a touch-reactive document. It calls
// `doc.touchDown`, which moves touchX/touchY (13/14) but never writes the touch event
// time (29) — that is done by the *web* player (`web/main.ts`), not the core. A document
// that derives "is the finger down" the way the working Flappy Droid demo does,
//
//     sign(max(0, touchTime - animationTime + 0.15))
//
// therefore reads a touch that never ends under --hold and never begins otherwise.
// --tap writes both clocks itself, so the whole input path is testable headlessly:
// animation time (30) advances at exactly --fps, and touch time (29) is stamped on each
// tap. Without it, the only way to know a tap works is to play the document by hand.
//
// Exit code is 1 if nothing changed at all, so it can be used as a regression check.

import { readFileSync } from 'fs';
import { createCanvas } from 'canvas';

// node-canvas has no Path2D; the paint context needs one.
if (typeof globalThis.Path2D === 'undefined') {
    class Path2DPolyfill {
        constructor() { this._commands = []; }
        moveTo(...a) { this._commands.push(['moveTo', a]); }
        lineTo(...a) { this._commands.push(['lineTo', a]); }
        quadraticCurveTo(...a) { this._commands.push(['quadraticCurveTo', a]); }
        bezierCurveTo(...a) { this._commands.push(['bezierCurveTo', a]); }
        arc(...a) { this._commands.push(['arc', a]); }
        rect(...a) { this._commands.push(['rect', a]); }
        closePath() { this._commands.push(['closePath', []]); }
        addPath(p) { if (p?._commands) this._commands.push(...p._commands); }
    }
    globalThis.Path2D = Path2DPolyfill;
}
function patchPath2D(ctx) {
    const fill = ctx.fill.bind(ctx), stroke = ctx.stroke.bind(ctx), clip = ctx.clip.bind(ctx);
    const replay = (p) => { ctx.beginPath(); for (const [c, a] of p._commands) ctx[c](...a); };
    ctx.fill = (p, rule) => (p?._commands ? (replay(p), fill(rule)) : fill(p, rule));
    ctx.stroke = (p) => (p?._commands ? (replay(p), stroke()) : stroke());
    ctx.clip = (p, rule) => (p?._commands ? (replay(p), clip(rule)) : clip(p, rule));
    return ctx;
}

// The player reaches for `document.createElement('canvas')` for offscreen layers and
// for the shader renderer. Node has no DOM, and without this a document that uses
// either dies with `ReferenceError: document is not defined` — which looks like a
// player bug and is not one.
if (typeof globalThis.document === 'undefined') {
    globalThis.document = {
        createElement(tag) {
            if (tag !== 'canvas') return {};
            const c = createCanvas(1, 1);
            const orig = c.getContext.bind(c);
            c.getContext = (kind, opts) => (kind === '2d' ? patchPath2D(orig('2d', opts)) : null);
            return c;
        },
    };
}

const args = process.argv.slice(2);
function flagLater(n) {
    const i = args.indexOf(`--${n}`);
    return i === -1 ? null : args[i + 1];
}
const file = args.find((a) => !a.startsWith('--'));
const BATCH = flagLater('batch');
const flag = (n, d) => {
    const i = args.indexOf(`--${n}`);
    return i === -1 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true);
};
if (!file) {
    console.error('usage: node trace.mjs DOC.rc [--frames N] [--fps N] [--hold] [--ops] [--watch a,b]');
    process.exit(2);
}
const FRAMES = Number(flag('frames', 30));
const FPS = Number(flag('fps', 30));
const HOLD = Boolean(flag('hold', false));
// --tap 30:120:200,90:300:260 -> [{frame, x, y}, ...]
const TAP_ARG = flag('tap', null);
const TAPS = TAP_ARG && TAP_ARG !== true
    ? TAP_ARG.split(',').map((s) => {
        const [frame, x, y] = s.split(':').map(Number);
        return { frame, x, y };
    })
    : null;
const TAP_HOLD_FRAMES = Number(flag('tapHold', 3));
// Synthetic document clock, shared by the tap stamp and the animationTime slot below.
let synthTime = 0;
const OPS = Boolean(flag('ops', false));
const DUMP = Boolean(flag('dump', false));
const WATCH = flag('watch', null);
const watchIds = WATCH && WATCH !== true ? WATCH.split(',').map(Number) : null;

const {
    RemoteComposeBuffer, CoreDocument, CanvasPaintContext, WebRemoteContext,
} = await import('./build-node/node-entry.js');

const data = readFileSync(file);
const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
const doc = new CoreDocument();
doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(ab));

// A document that declares no size reports the 256x256 default; the *host* supplies
// the viewport, exactly as the browser player uses the canvas size. Tracing at 256
// while the reference traces at 400x800 makes every position differ for no reason.
const W = Number(flag('width', 0)) || doc.getWidth?.() || 400;
const H = Number(flag('height', 0)) || doc.getHeight?.() || 800;
doc.setWidth?.(W); doc.setHeight?.(H);
const canvas = createCanvas(W, H);
const ctx = patchPath2D(canvas.getContext('2d'));
const paint = new CanvasPaintContext(null, ctx);
const remote = new WebRemoteContext(paint);
// Size the context BEFORE initializeContext: that call seeds the system
// windowWidth/windowHeight variables, and setting the size afterwards leaves them at
// the document's 256 default while everything else lays out at the real viewport.
remote.mWidth = W;
remote.mHeight = H;
doc.initializeContext(remote);
// windowWidth/windowHeight (ids 5/6) are plain float slots; the reference host writes
// them, and without that they keep the document's 256 default and every expression
// built on window size is wrong.
remote.loadFloat(5, W);
remote.loadFloat(6, H);
remote.setPaintContext(paint);
paint.setContext(remote);
paint.createLayerCanvas = (w, h) => patchPath2D(createCanvas(Math.max(1, w), Math.max(1, h)).getContext('2d'));
paint.loadBitmap = () => {};
doc.applyDataOperations(remote);

// Count operation applications by class, so "did this op ever run" is answerable
// directly instead of inferred from pixels.
const opCounts = new Map();
if (OPS) {
    const seen = new Set();
    const instrument = (ops, depth) => {
        if (!ops || depth > 16) return;
        for (const op of ops) {
            if (!op || seen.has(op)) continue;
            seen.add(op);
            const name = op.constructor?.name ?? '?';
            const original = op.apply?.bind(op);
            if (original) {
                op.apply = (c) => { opCounts.set(name, (opCounts.get(name) || 0) + 1); return original(c); };
            }
            if (typeof op.getList === 'function') instrument(op.getList(), depth + 1);
        }
    };
    instrument(doc.mOperations, 0);
}

/**
 * Every float the context currently holds, as id -> value.
 *
 * The store is an open-addressed `IntFloatMap` (parallel Int32Array/Float32Array), not
 * a JS Map, so it is read through its own arrays rather than iterated.
 */
const NOT_PRESENT = -1;
function snapshot() {
    const out = new Map();
    const state = remote.mRemoteComposeState;
    const fm = state && state.mFloatMap;
    if (!fm || !fm.mKeys) return out;
    for (let i = 0; i < fm.mKeys.length; i++) {
        const k = fm.mKeys[i];
        if (k !== NOT_PRESENT) out.set(k, fm.mValues[i]);
    }
    return out;
}

// The player derives animationTime (slot 30) from wall-clock elapsed seconds, and a
// trace runs hundreds of frames in a few milliseconds — so a document that measures a
// 0.15s window against it sees a clock that never advances, and a tap never expires.
// Under --tap the slot is forced to the synthetic frame clock instead, which is what
// makes "the finger came up" observable at all.
if (TAPS) {
    const realLoadFloat = remote.loadFloat.bind(remote);
    remote.loadFloat = (id, value) => realLoadFloat(id, id === 30 ? synthTime : value);
}

const changed = new Map();     // id -> how many frames it changed on
let prev = null;
const centre = { x: W / 2, y: H / 2 };

for (let f = 0; f < FRAMES; f++) {
    const t = (f * 1000) / FPS;
    remote.setAnimationTime?.(t / 1000);
    if (HOLD && f === 2) doc.touchDown?.(remote, centre.x, centre.y);
    if (HOLD && f > 2) doc.touchDrag?.(remote, centre.x, centre.y);
    if (TAPS) {
        synthTime = t / 1000;
        for (const tap of TAPS) {
            if (f === tap.frame) {
                remote.loadFloat?.(29, synthTime);   // touch event time, as web/main.ts does
                doc.touchDown?.(remote, tap.x, tap.y);
            } else if (f > tap.frame && f < tap.frame + TAP_HOLD_FRAMES) {
                remote.loadFloat?.(29, synthTime);
                doc.touchDrag?.(remote, tap.x, tap.y);
            } else if (f === tap.frame + TAP_HOLD_FRAMES) {
                doc.touchUp?.(remote, tap.x, tap.y, 0, 0);
            }
        }
    }
    paint.reset?.();
    paint.clearNeedsRepaint?.();
    doc.paint(remote, -1);

    const now = snapshot();
    if (prev) {
        for (const [id, v] of now) {
            const before = prev.get(id);
            if (before !== undefined && before !== v) changed.set(id, (changed.get(id) || 0) + 1);
        }
    }
    if (DUMP) {
        // Same shape as the reference tracer in remote-core, so the two runs diff
        // line by line: `frame N id=value ...`, zeros omitted.
        const parts = [];
        for (const [id, v] of [...now].sort((a, b) => a[0] - b[0])) {
            if (v === 0) continue;
            parts.push(`${id}=${v}`);
        }
        console.log(`TSTRACE frame ${f} ${parts.join(' ')}`);
    }
    if (watchIds) {
        console.log(`frame ${String(f).padStart(3)} ` +
            watchIds.map((id) => `${id}=${(now.get(id) ?? NaN).toFixed(3)}`).join('  '));
    }
    prev = now;
}

const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', X = '\x1b[0m';
console.log(`\n${file}  ${FRAMES} frames @ ${FPS}fps${HOLD ? '  (holding from frame 2)' : ''}`);
console.log(`${changed.size ? G : R}${changed.size} float variables changed${X}` +
            ` ${D}of ${prev.size} tracked${X}`);
for (const [id, n] of [...changed].sort((a,b)=>a[0]-b[0])) {
    console.log(`  id ${String(id).padStart(6)}  changed on ${n}/${FRAMES - 1} frames  ` +
                `${D}now ${prev.get(id)}${X}`);
}
if (OPS) {
    console.log('\noperations applied:');
    for (const [name, n] of [...opCounts].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${n === 0 ? R : G}${String(n).padStart(6)}${X}  ${name}`);
    }
    // A bundler renames classes (esbuild prefixes `_`), so match on the suffix.
    for (const name of ['RunActionOperation', 'ValueFloatExpressionChangeAction']) {
        const seen = [...opCounts.keys()].some((k) => k.endsWith(name));
        if (!seen) console.log(`  ${R}     0${X}  ${name} ${D}(never applied)${X}`);
    }
}
process.exit(changed.size ? 0 : 1);
