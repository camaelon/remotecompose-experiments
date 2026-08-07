import { readFileSync } from 'fs';
import { createCanvas } from 'canvas';
if (typeof globalThis.Path2D === 'undefined') {
  class P { constructor(){this._commands=[];} moveTo(){} lineTo(){} quadraticCurveTo(){}
    bezierCurveTo(){} arc(){} rect(){} closePath(){} addPath(){} }
  globalThis.Path2D = P;
}
const { RemoteComposeBuffer, CoreDocument, CanvasPaintContext, WebRemoteContext } =
  await import('./build-node/node-entry.js');
for (const file of process.argv.slice(2)) {
  try {
    const data = readFileSync(file);
    const doc = new CoreDocument();
    doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
    const W=400,H=400; doc.setWidth(W); doc.setHeight(H);
    const c=createCanvas(W,H), x=c.getContext('2d');
    const paint=new CanvasPaintContext(null,x), remote=new WebRemoteContext(paint);
    remote.mWidth=W; remote.mHeight=H;
    doc.initializeContext(remote);
    remote.loadFloat(5,W); remote.loadFloat(6,H);
    remote.setPaintContext(paint); paint.setContext(remote);
    paint.createLayerCanvas=(w,h)=>createCanvas(Math.max(1,w),Math.max(1,h)).getContext('2d');
    paint.loadBitmap=()=>{};
    doc.applyDataOperations(remote);
    let peak = 0;
    for (let f = 0; f < 10; f++) {
      remote.setAnimationTime?.(f/60);
      paint.reset?.(); doc.paint(remote, -1);
      peak = Math.max(peak, doc.getOpsPerFrame?.() ?? -1);
    }
    console.log(`${String(peak).padStart(7)}  ${file.split('/').pop()}`);
  } catch (e) {
    console.log(`  ERROR  ${file.split('/').pop()}  ${String(e.message).slice(0,60)}`);
  }
}
