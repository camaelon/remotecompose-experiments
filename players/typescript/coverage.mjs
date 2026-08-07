// coverage.mjs — which operations in a document does measurement never see?
//
//   node coverage.mjs doc.rc [more.rc ...]
//
// Walks the whole operation tree (following every child list, at any depth), paints a
// frame with measurement on, and reports the operations that executed but were never
// counted — and the containers they live in.
//
// This is the negative control for the measurement hooks. `measure.mjs --verify` proves
// the breakdowns are *self-consistent*: they sum to their own total. It cannot prove the
// total is *complete*, because a missing count site lowers the total and the breakdown
// equally, and everything still adds up. Completeness needs an independent source of
// truth for what should have been counted, which is what the tree walk provides.

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

const W = 400, H = 400;
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const showAll = process.argv.includes('--all');

function cls(op) {
    const n = (op && op.constructor && op.constructor.name) || 'Unknown';
    return n.startsWith('_') ? n.slice(1) : n;
}

/** Every operation reachable from the document root, with its container chain. */
function walk(doc) {
    const found = [];        // { op, depth, parent }
    const seen = new Set();
    (function rec(ops, depth, parent) {
        if (!Array.isArray(ops) || depth > 40) return;
        for (const op of ops) {
            if (!op || typeof op !== 'object' || seen.has(op)) continue;
            seen.add(op);
            found.push({ op, depth, parent });
            // Children hang off getList() on containers, and off a few operation-specific
            // fields. Follow every one: a child missed here would look like a coverage
            // gap that is really a walk gap.
            const lists = [];
            if (typeof op.getList === 'function') { try { lists.push(op.getList()); } catch {} }
            for (const f of ['mList', 'mChildren', 'mContentOps', 'mDrawContentOperations',
                             'mComponentModifiers']) {
                if (Array.isArray(op[f])) lists.push(op[f]);
            }
            for (const l of lists) rec(l, depth + 1, op);
        }
    })(doc.mOperations, 0, null);
    return found;
}

for (const file of files) {
    const name = file.split('/').pop();
    let doc, remote, paint;
    try {
        const data = readFileSync(file);
        doc = new CoreDocument();
        doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(
            data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
        doc.setWidth(W); doc.setHeight(H);
        const canvas = createCanvas(W, H);
        paint = new CanvasPaintContext(null, canvas.getContext('2d'));
        remote = new WebRemoteContext(paint);
        remote.mWidth = W; remote.mHeight = H;
        doc.initializeContext(remote);
        remote.loadFloat(5, W); remote.loadFloat(6, H);
        remote.setPaintContext(paint); paint.setContext(remote);
        paint.createLayerCanvas = (w, h) =>
            createCanvas(Math.max(1, w), Math.max(1, h)).getContext('2d');
        paint.loadBitmap = () => {};
        doc.applyDataOperations(remote);
    } catch (e) {
        console.log(`  LOAD FAILED  ${name}  ${String(e.message).slice(0, 70)}`);
        continue;
    }

    // Mark every operation the collector attributes. We cannot read its private symbol,
    // so instead wrap the sink and identify by (type, count) — no: identify directly by
    // patching incrementOpCount to record the object it was handed.
    const counted = new Set();
    const origInc = remote.incrementOpCount.bind(remote);
    remote.incrementOpCount = function (op) {
        if (op) counted.add(op);
        return origInc(op);
    };

    // Record which operations actually *ran* this frame, by wrapping their entry points.
    // Without this the report is meaningless: an operation that legitimately never
    // executes during paint (a layout-only modifier, a gone child) would be indicted as
    // an uncounted execution. The gap we are hunting is executed-but-not-counted, and
    // only an independent record of execution can isolate it.
    const executed = new Set();
    const treePre = walk(doc);
    for (const { op } of treePre) {
        for (const m of ['apply', 'paint']) {
            if (typeof op[m] !== 'function' || Object.hasOwn(op, m)) continue;
            const orig = op[m].bind(op);
            Object.defineProperty(op, m, {
                value: function (...a) { executed.add(op); return orig(...a); },
                writable: true, configurable: true, enumerable: false,
            });
        }
    }

    let report = null;
    remote.setMeasurementSink((r) => { report = r; });
    try {
        paint.reset?.();
        doc.paint(remote, -1);
    } catch (e) {
        console.log(`  PAINT FAILED ${name}  ${String(e.message).slice(0, 70)}`);
        continue;
    }

    const tree = treePre;
    // Only executed-and-uncounted is a defect. Uncounted-and-never-executed is correct.
    const missing = tree.filter((n) => executed.has(n.op) && !counted.has(n.op));
    const inert = tree.filter((n) => !executed.has(n.op) && !counted.has(n.op));

    // Group the uncounted by their immediate container: that is the thing whose paint
    // path lacks a count, which is what an implementer needs to know.
    const byParent = new Map();
    for (const m of missing) {
        const k = m.parent ? cls(m.parent) : '(document root)';
        if (!byParent.has(k)) byParent.set(k, new Map());
        const inner = byParent.get(k);
        inner.set(cls(m.op), (inner.get(cls(m.op)) || 0) + 1);
    }

    console.log(`\n${name}`);
    console.log(`  tree: ${tree.length} operations   measured this frame: `
        + `${report ? report.total : 0} executions over ${report ? report.byInstance.length : 0} instances`);
    console.log(`  EXECUTED BUT NOT COUNTED: ${missing.length}`
        + `   (did not execute this frame, correctly absent: ${inert.length})`);
    if (missing.length && (showAll || true)) {
        for (const [parent, kinds] of [...byParent.entries()]
                .sort((a, b) => [...b[1].values()].reduce((x, y) => x + y, 0)
                              - [...a[1].values()].reduce((x, y) => x + y, 0))) {
            const total = [...kinds.values()].reduce((a, b) => a + b, 0);
            const detail = [...kinds.entries()].sort((a, b) => b[1] - a[1])
                .map(([k, v]) => `${k}${v > 1 ? '×' + v : ''}`).join(', ');
            console.log(`    inside ${parent}: ${total}  — ${detail}`);
        }
    }
}
