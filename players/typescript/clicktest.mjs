// clicktest.mjs — do a document's click actions execute, and are they counted?
//
//   node clicktest.mjs doc.rc [more.rc ...]
//
// The companion to coverage.mjs, which cannot answer this: coverage only exercises the
// paint path, so click and touch handlers never fire there and it reports a clean zero
// while every input-driven operation goes uncounted. That is exactly what happened.
//
// Dispatches through `doc.onClick(ctx, x, y)` — the click channel — over a grid, and
// reports where the document is clickable and how much work the tap did. A report's
// `betweenFrames` carries that work, because input runs outside the paint window.
//
// Note `doc.touchDown`/`touchUp` are a DIFFERENT channel and do not fire click
// modifiers; a document can use either, so testing one proves nothing about the other.

import { readFileSync } from 'fs';
import { createCanvas } from 'canvas';
class P { constructor(){this._commands=[];} moveTo(){} lineTo(){} quadraticCurveTo(){}
  bezierCurveTo(){} arc(){} rect(){} closePath(){} addPath(){} }
globalThis.Path2D = P;
const { RemoteComposeBuffer, CoreDocument, CanvasPaintContext, WebRemoteContext } =
  await import('./build-node/node-entry.js');
const W=400,H=400;
for (const file of process.argv.slice(2)) {
  const data = readFileSync(file);
  const doc = new CoreDocument();
  doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(
    data.buffer.slice(data.byteOffset, data.byteOffset+data.byteLength)));
  doc.setWidth(W); doc.setHeight(H);
  const c=createCanvas(W,H), x=c.getContext('2d');
  const paint=new CanvasPaintContext(null,x), remote=new WebRemoteContext(paint);
  remote.mWidth=W; remote.mHeight=H;
  doc.initializeContext(remote); remote.loadFloat(5,W); remote.loadFloat(6,H);
  remote.setPaintContext(paint); paint.setContext(remote);
  paint.createLayerCanvas=(w,h)=>createCanvas(Math.max(1,w),Math.max(1,h)).getContext('2d');
  paint.loadBitmap=()=>{};
  doc.applyDataOperations(remote);
  const reports=[];
  remote.setMeasurementSink(r=>reports.push({total:r.total,inPaint:r.inPaint,between:r.betweenFrames}));
  try {
    paint.reset?.(); doc.paint(remote,-1);                       // frame 1: no input
    // onClick is the click dispatch; touchDown/touchUp are a different path.
    let hit=false;
    for (let gx=40; gx<W && !hit; gx+=40) for (let gy=40; gy<H && !hit; gy+=40)
        hit = doc.onClick(remote, gx, gy) === true;
    paint.reset?.(); doc.paint(remote,-1);                       // frame 2: after tap
    const [a,b]=reports.slice(-2);
    const tag = b.between>0 ? `COUNTED (${b.between} action ops)` : (hit ? "click hit but NOTHING counted" : "no clickable region found");
    console.log(`${file.split('/').pop().padEnd(24)} frame1 total=${a.total} between=${a.between}`
      + ` | frame2 total=${b.total} inPaint=${b.inPaint} between=${b.between}  ${tag}`);
  } catch(e){ console.log(`${file.split('/').pop()}  ERROR ${String(e.message).slice(0,50)}`); }
}
