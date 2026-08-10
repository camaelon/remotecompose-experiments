// measure.mjs — exercise the operation measurement hooks headlessly.
//
//   node measure.mjs doc.rc [more.rc ...]        summary per document
//   node measure.mjs --verify doc.rc [...]       check the invariants and report failures
//   node measure.mjs --top 12 doc.rc             show the 12 hottest types and instances
//
// This is the negative control for the demo page: if the numbers are wrong they are wrong
// here too, in a place where nothing about canvas, layout or the DOM can be blamed.
//
// Invariants checked by --verify, all of which must hold on every frame:
//
//   1. report.total === doc.getOpsPerFrame()
//        The measured frame window is the same window the pre-existing counter uses.
//        If these ever diverge, measurement is counting a different thing than the
//        20,000-op limit is enforced against, and every number a profiler shows is
//        answering a question nobody asked.
//   2. sum(byType.count) + unattributed === total
//   3. sum(byInstance.count) + unattributed === total
//        A breakdown that does not add up to its own total is worse than no breakdown.
//   4. instance ids are stable across frames for an unchanged document.

import { readFileSync } from 'fs';
import { createCanvas } from 'canvas';

if (typeof globalThis.Path2D === 'undefined') {
    class P {
        constructor() { this._commands = []; }
        moveTo() {} lineTo() {} quadraticCurveTo() {} bezierCurveTo() {}
        arc() {} rect() {} closePath() {} addPath() {}
    }
    globalThis.Path2D = P;
}

const { RemoteComposeBuffer, CoreDocument, CanvasPaintContext, WebRemoteContext } =
    await import('./build-node/node-entry.js');

const argv = process.argv.slice(2);
const verify = argv.includes('--verify');
const topIdx = argv.indexOf('--top');
const TOP = topIdx >= 0 ? parseInt(argv[topIdx + 1], 10) : 0;
const files = argv.filter((a, i) =>
    !a.startsWith('--') && !(topIdx >= 0 && i === topIdx + 1));

const W = 400, H = 400, FRAMES = 10;

function load(file) {
    const data = readFileSync(file);
    const doc = new CoreDocument();
    doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
    doc.setWidth(W); doc.setHeight(H);
    const canvas = createCanvas(W, H);
    const x = canvas.getContext('2d');
    const paint = new CanvasPaintContext(null, x);
    const remote = new WebRemoteContext(paint);
    remote.mWidth = W; remote.mHeight = H;
    doc.initializeContext(remote);
    remote.loadFloat(5, W); remote.loadFloat(6, H);
    remote.setPaintContext(paint); paint.setContext(remote);
    paint.createLayerCanvas = (w, h) => createCanvas(Math.max(1, w), Math.max(1, h)).getContext('2d');
    paint.loadBitmap = () => {};
    doc.applyDataOperations(remote);
    return { doc, remote, paint };
}

let failures = 0;

for (const file of files) {
    const name = file.split('/').pop();
    let env;
    try {
        env = load(file);
    } catch (e) {
        console.log(`  LOAD FAILED  ${name}  ${String(e.message).slice(0, 70)}`);
        failures++;
        continue;
    }
    const { doc, remote, paint } = env;

    const frames = [];
    remote.setMeasurementSink((r) => {
        // The report is reused/cleared by the collector after the sink returns, so a
        // consumer that wants to keep a frame must copy what it needs. Copying here is
        // also what a real profiler would do before accumulating.
        frames.push({
            frame: r.frame, total: r.total, unattributed: r.unattributed,
            inPaint: r.inPaint, betweenFrames: r.betweenFrames,
            byType: r.byType.map((t) => ({ ...t })),
            byInstance: r.byInstance.map((i) => ({ ...i })),
        });
    });

    const problems = [];
    try {
        for (let f = 0; f < FRAMES; f++) {
            remote.setAnimationTime?.(f / 60);
            paint.reset?.();
            doc.paint(remote, -1);
            const r = frames[frames.length - 1];
            if (!r) { problems.push(`frame ${f}: no report emitted`); continue; }
            const ops = doc.getOpsPerFrame();
            // inPaint, not total: `total` also carries work done *between* frames (click
            // and touch handlers running their actions), which the engine's own counter
            // discards. inPaint is the part that must agree with it.
            if (r.inPaint !== ops) problems.push(`frame ${f}: inPaint ${r.inPaint} != getOpsPerFrame ${ops}`);
            if (r.total !== r.inPaint + r.betweenFrames)
                problems.push(`frame ${f}: total ${r.total} != inPaint ${r.inPaint} + between ${r.betweenFrames}`);
            const st = r.byType.reduce((a, t) => a + t.count, 0) + r.unattributed;
            const si = r.byInstance.reduce((a, i) => a + i.count, 0) + r.unattributed;
            if (st !== r.total) problems.push(`frame ${f}: byType sums to ${st}, total ${r.total}`);
            if (si !== r.total) problems.push(`frame ${f}: byInstance sums to ${si}, total ${r.total}`);
        }
    } catch (e) {
        problems.push(`paint threw: ${String(e.message).slice(0, 70)}`);
    }

    // Instance-id stability: an id seen in an early frame must mean the same operation
    // later. Checked as "ids do not get reassigned to a different type".
    const idType = new Map();
    for (const r of frames) {
        for (const i of r.byInstance) {
            const prev = idType.get(i.id);
            if (prev !== undefined && prev !== i.key) {
                problems.push(`instance id ${i.id} changed type ${prev} -> ${i.key}`);
            }
            idType.set(i.id, i.key);
        }
    }

    // Measurement off must emit nothing. Guarded: some documents cannot paint headlessly
    // at all (WebGL shaders need a DOM), and one of those must not end the sweep.
    remote.setMeasurementSink(null);
    const before = frames.length;
    try {
        paint.reset?.();
        doc.paint(remote, -1);
    } catch { /* the frame loop above already recorded why this document cannot paint */ }
    if (frames.length !== before) problems.push('sink called after measurement disabled');

    const last = frames[frames.length - 1];
    const peak = Math.max(...frames.map((r) => r.total));
    const types = last ? last.byType.length : 0;
    const insts = last ? last.byInstance.length : 0;

    if (verify) {
        if (problems.length) {
            failures++;
            console.log(`FAIL  ${name}`);
            for (const p of problems) console.log(`        ${p}`);
        } else {
            console.log(`ok    ${name}  peak=${peak} types=${types} instances=${insts}`);
        }
    } else {
        console.log(`${name}: peak ${peak} ops/frame, ${types} types, ${insts} instances`
            + (last?.unattributed ? `, ${last.unattributed} unattributed` : ''));
        if (TOP && last) {
            console.log('  by type:');
            for (const t of last.byType.slice(0, TOP)) {
                console.log(`    ${String(t.count).padStart(6)}  ${t.name}`
                    + (t.opCode >= 0 ? ` (op ${t.opCode})` : ''));
            }
            console.log('  by instance:');
            for (const i of last.byInstance.slice(0, TOP)) {
                console.log(`    ${String(i.count).padStart(6)}  #${i.id} ${i.name}`);
            }
        }
        if (problems.length) {
            failures++;
            for (const p of problems) console.log(`  PROBLEM: ${p}`);
        }
    }
}

process.exit(failures ? 1 : 0);
