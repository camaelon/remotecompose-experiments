// render.mjs — render a document to PNG headlessly with the TypeScript player.
//
//   node render.mjs DOC.rc OUT.png [--width N] [--height N] [--frames N]
//
// Exists so a TypeScript rendering can be put beside a device screenshot. Note the
// caveat that applies to every still: a frame proves what was painted, not that the
// document's logic ran — use trace.mjs/layout.mjs for that.
import { readFileSync, writeFileSync } from 'fs';
import { createCanvas } from 'canvas';
if (typeof globalThis.Path2D === 'undefined') {
    class P {
        constructor() { this._commands = []; }
        moveTo(...a){this._commands.push(['moveTo',a]);} lineTo(...a){this._commands.push(['lineTo',a]);}
        quadraticCurveTo(...a){this._commands.push(['quadraticCurveTo',a]);}
        bezierCurveTo(...a){this._commands.push(['bezierCurveTo',a]);}
        arc(...a){this._commands.push(['arc',a]);} rect(...a){this._commands.push(['rect',a]);}
        closePath(){this._commands.push(['closePath',[]]);} addPath(){}
    }
    globalThis.Path2D = P;
}
function patch(ctx) {
    const o = { fill: ctx.fill.bind(ctx), stroke: ctx.stroke.bind(ctx), clip: ctx.clip.bind(ctx) };
    const replay = p => { ctx.beginPath(); for (const [m, a] of p._commands || []) ctx[m](...a); };
    ctx.fill = (p, r) => (p && p._commands ? (replay(p), o.fill(r)) : o.fill(p, r));
    ctx.stroke = p => (p && p._commands ? (replay(p), o.stroke()) : o.stroke(p));
    ctx.clip = (p, r) => (p && p._commands ? (replay(p), o.clip(r)) : o.clip(p, r));
    return ctx;
}
const a = process.argv.slice(2);
const [file, out] = a;
const flag = (n, d) => { const i = a.indexOf('--' + n); return i >= 0 ? a[i + 1] : d; };
const { RemoteComposeBuffer, CoreDocument, CanvasPaintContext, WebRemoteContext } =
    await import('./build-node/node-entry.js');
const data = readFileSync(file);
const doc = new CoreDocument();
doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
const W = Number(flag('width', 0)) || doc.getWidth?.() || 400;
const H = Number(flag('height', 0)) || doc.getHeight?.() || 400;
doc.setWidth?.(W); doc.setHeight?.(H);
const canvas = createCanvas(W, H);
const ctx = patch(canvas.getContext('2d'));
const paint = new CanvasPaintContext(null, ctx);
const remote = new WebRemoteContext(paint);
remote.mWidth = W; remote.mHeight = H;
doc.initializeContext(remote);
remote.loadFloat(5, W); remote.loadFloat(6, H);
remote.setPaintContext(paint); paint.setContext(remote);
paint.createLayerCanvas = (w, h) => patch(createCanvas(Math.max(1, w), Math.max(1, h)).getContext('2d'));
paint.loadBitmap = () => {};
doc.applyDataOperations(remote);
const frames = Number(flag('frames', 3));
// Theme matters for any document carrying Theme ops or themed colours: painting with
// UNSPECIFIED (-1) is NOT the same as what a device shows, and comparing a -1 render
// against a light-mode phone reports a difference that is purely the harness's.
//   --theme light | dark | unspecified   (default: light, which is the phone's default)
const THEMES = { light: -3, dark: -2, unspecified: -1 };  // Theme.LIGHT/DARK/UNSPECIFIED
const theme = THEMES[String(flag('theme', 'light'))] ?? -1;
for (let f = 0; f < frames; f++) {
    remote.setAnimationTime?.(f / 60);
    paint.reset?.(); paint.clearNeedsRepaint?.();
    doc.paint(remote, theme);
}
writeFileSync(out, canvas.toBuffer('image/png'));
console.error(`${out} ${W}x${H} ${frames} frames`);
