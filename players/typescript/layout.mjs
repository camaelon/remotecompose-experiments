// layout.mjs — dump the computed layout tree of a document.
//
//   node layout.mjs DOC.rc [--width 400] [--height 400] [--frames 2]
//
// Prints one line per component, depth-ordered:
//
//   LAYOUT <depth> <kind> id=<n> x=<f> y=<f> w=<f> h=<f>
//
// Why bounds and not pixels: a layout disagreement between two engines is a disagreement
// about a *number* on a *component*. A rendered diff shows that something moved but not
// which component owns the mistake, and antialiasing makes small offsets invisible while
// making irrelevant ones loud. The C++ player's `rc2layout` and the Java reference's
// `RcLayoutTest` emit this exact format so all three diff line by line.
//
// --density N : display density. Documents are authored in dp, and a dimension modifier
// scales its min/max by this — `widthIn(120)` is 120dp, which is 315 physical pixels at
// 420dpi (density 2.625). A browser reads devicePixelRatio; headless there is no such
// thing, so this defaults to 1. Pass the device's density when comparing against a phone,
// or the layout differs for reasons that have nothing to do with the player.
// `adb shell wm density` reports it in dpi: 420 => 420/160 => 2.625.

import { readFileSync } from 'fs';
import { createCanvas } from 'canvas';

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
        addPath() {}
    }
    globalThis.Path2D = Path2DPolyfill;
}
function patchPath2D(ctx) {
    const orig = { fill: ctx.fill.bind(ctx), stroke: ctx.stroke.bind(ctx), clip: ctx.clip.bind(ctx) };
    const replay = (p) => { ctx.beginPath(); for (const [m, a] of p._commands || []) ctx[m](...a); };
    ctx.fill = (p, r) => (p && p._commands ? (replay(p), orig.fill(r)) : orig.fill(p, r));
    ctx.stroke = (p) => (p && p._commands ? (replay(p), orig.stroke()) : orig.stroke(p));
    ctx.clip = (p, r) => (p && p._commands ? (replay(p), orig.clip(r)) : orig.clip(p, r));
    return ctx;
}

const args = process.argv.slice(2);
const file = args[0];
if (!file) {
    console.error('usage: node layout.mjs DOC.rc [--width N] [--height N] [--frames N]');
    process.exit(1);
}
const flag = (name, dflt) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : dflt;
};

const { RemoteComposeBuffer, CoreDocument, CanvasPaintContext, WebRemoteContext, createSnapshot } =
    await import('./build-node/node-entry.js');

// Interactive steps (layout-specs' cases), applied in order after the first layout, on a
// manual clock that only moves when a step moves it (16 ms per painted frame when settling):
//   --click X Y, --click-frame X Y (one frame, the animation left in flight), --advance MS,
//   --settle, --resize W H; --anim enables layout animations (off otherwise, as the spec
//   harness does). With any of these the first layout settles too.
const STEPS = [];
let ANIM = false;
for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '--anim') ANIM = true;
    else if (a === '--click' || a === '--click-frame' || a === '--resize') { STEPS.push([a, +args[i + 1], +args[i + 2]]); i += 2; }
    else if (a === '--advance') { STEPS.push([a, +args[i + 1]]); i++; }
    else if (a === '--settle') STEPS.push([a]);
}
const SCRIPTED = ANIM || STEPS.length > 0;
let clockMs = Date.UTC(2025, 0, 1);
const manualClock = { millis: () => clockMs, snapshot: () => createSnapshot(clockMs) };
// animationTime (TimeVariables.getElapsedSeconds) reads performance.now(), not the clock: on the
// manual clock it would barely move, and an animated expression ({value, anim}) would never
// progress. Drive it from the manual clock too.
if (SCRIPTED) { const t0 = clockMs; performance.now = () => clockMs - t0; }

const data = readFileSync(file);
const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
const doc = SCRIPTED ? new CoreDocument(manualClock) : new CoreDocument();
doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(ab));

const W = Number(flag('width', 0)) || doc.getWidth?.() || 400;
const H = Number(flag('height', 0)) || doc.getHeight?.() || 400;
doc.setWidth?.(W); doc.setHeight?.(H);
const canvas = createCanvas(W, H);
const ctx = patchPath2D(canvas.getContext('2d'));
const paint = new CanvasPaintContext(null, ctx);
const remote = new WebRemoteContext(paint);
remote.mWidth = W;
remote.mHeight = H;
doc.initializeContext(remote);
remote.loadFloat(5, W);
remote.loadFloat(6, H);
// Density before the data pass: dimension modifiers scale their min/max in
// updateVariables, which runs there.
const density = Number(flag('density', 1));
if (density > 0) remote.setDensity(density);
remote.setPaintContext(paint);
paint.setContext(remote);
paint.createLayerCanvas = (w, h) =>
    patchPath2D(createCanvas(Math.max(1, w), Math.max(1, h)).getContext('2d'));
paint.loadBitmap = () => {};
doc.applyDataOperations(remote);

// Two passes by default: the first frame is where measure happens, and a document whose
// size depends on a measured child is not settled until the pass after that.
const FRAMES = Number(flag('frames', 2));
if (!SCRIPTED) {
    for (let f = 0; f < FRAMES; f++) {
        remote.setAnimationTime?.(f / 60);
        paint.reset?.();
        paint.clearNeedsRepaint?.();
        doc.paint(remote, -1);
    }
} else {
    remote.setAnimationEnabled(ANIM);
    remote.setClock?.(manualClock);
    const frame = () => {
        paint.reset?.();
        paint.clearNeedsRepaint?.();
        doc.paint(remote, -1);
        return doc.needsRepaint() === 1;
    };
    const settle = () => {
        let again = frame();
        for (let n = 0; again && n < 200; n++) { clockMs += 16; again = frame(); }
    };
    frame();
    settle();
    for (const [kind, a, b] of STEPS) {
        if (kind === '--click' || kind === '--click-frame') {
            doc.onClick(remote, a, b);
            if (kind === '--click') settle(); else frame();
        } else if (kind === '--advance') { clockMs += a; frame(); }
        else if (kind === '--settle') settle();
        else if (kind === '--resize') {
            canvas.width = a; canvas.height = b;
            remote.mWidth = a; remote.mHeight = b;
            doc.setWidth?.(a); doc.setHeight?.(b);
            remote.loadFloat(5, a); remote.loadFloat(6, b);
            doc.invalidateMeasure?.();
            settle();
        }
    }
}

// toFixed switches to exponent notation from 1e21 (a gone child measured against an unbounded
// Number.MAX_VALUE); print those as plain integers so the line format stays parseable.
const num = (v) => (!Number.isFinite(v) ? 'nan'
    : Math.abs(v) >= 1e21 ? `${BigInt(Math.trunc(v))}.00` : (Math.round(v * 100) / 100).toFixed(2));

// A component is anything carrying the bounds quadruple; the class name is the kind.
// Containers expose children through getList(), which is also how the paint pass walks.
const seen = new Set();
const found = new Map();     // id -> {kind, depth, x, y, w, h}
// --all: every component in tree order, duplicate ids included. Ids are not unique in every
// document (the reference itself shares a CoreText id across pattern inflations), and a map
// keyed by id keeps only the last; conformance/compare.mjs uses this form.
const ALL = process.argv.includes('--all');
const inOrder = [];
function walk(op, depth) {
    if (!op || seen.has(op) || depth > 24) return;
    seen.add(op);
    const kind = op.constructor?.name ?? '?';
    const isComponent = typeof op.getComponentId === 'function'
        && typeof op.getWidth === 'function' && typeof op.getX === 'function';
    if (isComponent) {
        const entry = { id: op.getComponentId(), kind, depth, x: op.getX(), y: op.getY(), w: op.getWidth(), h: op.getHeight() };
        found.set(entry.id, entry);
        inOrder.push(entry);
        depth++;
    }
    if (typeof op.getList === 'function') for (const c of op.getList() || []) walk(c, depth);
    else if (Array.isArray(op.mList)) for (const c of op.mList) walk(c, depth);
}
for (const op of doc.mOperations || []) walk(op, 0);

// stdout is the canonical comparison form, sorted by id and identical across the three
// engines. The readable tree goes to stderr so a human can see structure without the
// diff having to care about it.
if (ALL) {
    console.log(inOrder.map((c) => `LAYOUT id=${c.id} x=${num(c.x)} y=${num(c.y)} w=${num(c.w)} h=${num(c.h)} ${c.kind.replace(/^_/, '')}`).join('\n'));
    process.exit(0);
}
const ids = [...found.keys()].sort((a, b) => a - b);
console.log(ids.map((id) => {
    const c = found.get(id);
    return `LAYOUT id=${id} x=${num(c.x)} y=${num(c.y)} w=${num(c.w)} h=${num(c.h)}`;
}).join('\n'));
for (const id of ids) {
    const c = found.get(id);
    console.error(`  ${'  '.repeat(c.depth)}${c.kind} id=${id} ` +
                  `${num(c.x)},${num(c.y)} ${num(c.w)}x${num(c.h)}`);
}
console.error(`${ids.length} components  ${W}x${H}  ${FRAMES} frames`);
