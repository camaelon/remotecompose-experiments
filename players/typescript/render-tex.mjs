// render-tex.mjs — render a document headlessly WITH its bitmaps decoded.
//
//   node render-tex.mjs DOC.rc OUT.png [--width N] [--height N] [--frames N]
//
// render.mjs stubs `paint.loadBitmap = () => {}` because the real one is written for a
// browser: it builds a Blob, calls URL.createObjectURL and waits on an Image `onload`,
// none of which exist in node. That stub is invisible until a document uses a texture —
// and then every textured surface renders flat grey and looks exactly like a player bug.
// It is not one. `surface_plot3d.rc` is all texture, and diagnosing it as a TypeScript 3D
// defect would have been the obvious wrong answer.
//
// The canvas package's Image decodes a Buffer synchronously (`img.src = buf` leaves
// `complete === true`), so here the cache is filled directly and the async path skipped.
import { readFileSync, writeFileSync } from 'fs';
import { createCanvas, Image } from 'canvas';
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

// setTexture3D extracts pixels via `document.createElement('canvas')` + getImageData.
// There is no `document` in node, so that line threw and every textured mesh fell back to
// untextured — the same visible symptom as the loadBitmap stub, one layer further in.
if (typeof globalThis.document === 'undefined') {
    globalThis.document = {
        createElement(tag) {
            if (String(tag).toLowerCase() !== 'canvas') {
                throw new Error(`document.createElement(${tag}) is not shimmed`);
            }
            return createCanvas(1, 1);
        },
    };
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
const density = Number(flag('density', 1));
if (density > 0) remote.setDensity(density);
remote.setPaintContext(paint); paint.setContext(remote);
paint.createLayerCanvas = (w, h) => patch(createCanvas(Math.max(1, w), Math.max(1, h)).getContext('2d'));
let loaded = 0;
paint.loadBitmap = (imageId, encoding, type, width, height, bitmap) => {
    const img = new Image();
    img.src = Buffer.from(bitmap.buffer, bitmap.byteOffset, bitmap.byteLength);
    // bitmapCache is `private` in TypeScript only; at runtime it is a plain Map.
    paint.bitmapCache.set(imageId, img);
    loaded++;
};
doc.applyDataOperations(remote);
const frames = Number(flag('frames', 3));
const THEMES = { light: -3, dark: -2, unspecified: -1 };
const theme = THEMES[String(flag('theme', 'light'))] ?? -1;
for (let f = 0; f < frames; f++) {
    remote.setAnimationTime?.(f / 60);
    paint.reset?.(); paint.clearNeedsRepaint?.();
    doc.paint(remote, theme);
}
writeFileSync(out, canvas.toBuffer('image/png'));
console.error(`${out} ${W}x${H} ${frames} frames, ${loaded} bitmap(s) decoded`);
