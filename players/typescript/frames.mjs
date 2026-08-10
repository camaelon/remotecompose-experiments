// frames.mjs — render one document at chosen points in time, side by side.
//
//   node frames.mjs DOC.rc OUT.png 0 1.5 3.0 [--width N] [--height N]
//
// render.mjs cannot do this: it advances 1/60 s per frame, so a slow animation looks
// static. Stepping time needs the clock injected, and which clock depends on what the
// document uses — see docs in rcJson/docs/RC_JSON_AUTHORING.md §8:
//
//   continuousSec() / time / seconds  <- the RemoteClock, injected below
//   animationTime                     <- performance.now(), stubbed below
//
// Both are handled here. Getting either wrong is quiet, not loud: frames come out
// differing only by float noise and a working animation reads as broken.

import { readFileSync, writeFileSync } from 'fs';
import { createCanvas } from 'canvas';
class P { constructor(){this._commands=[];} moveTo(){} lineTo(){} quadraticCurveTo(){}
  bezierCurveTo(){} arc(){} rect(){} closePath(){} addPath(){} }
globalThis.Path2D = P;
// animationTime comes from TimeVariables.getElapsedSeconds(), which reads
// performance.now() directly and ignores the RemoteClock entirely. Overriding it is the
// ONLY way to step a document's animation. Must be installed before the module loads.
let fakeNow = 0;
globalThis.performance = { now: () => fakeNow };
const { RemoteComposeBuffer, CoreDocument, CanvasPaintContext, WebRemoteContext } =
  await import('./build-node/node-entry.js');
const [file, out] = process.argv.slice(2);
const times = process.argv.slice(4).filter(a => !a.startsWith('--') &&
    !['--width','--height'].includes(process.argv[process.argv.indexOf(a) - 1])).map(Number);
const flag = (n, d) => { const i = process.argv.indexOf('--' + n);
    return i > 0 ? process.argv[i + 1] : d; };
const W = Number(flag('width', 400)), H = Number(flag('height', 400));
const sheet = createCanvas(W*times.length, H), sctx = sheet.getContext('2d');
for (let k=0;k<times.length;k++){
  const data = readFileSync(file);
  // CoreDocument.paint overwrites ID_ANIMATION_TIME from the clock, so setAnimationTime
  // alone cannot drive the document. Feed it a fake clock instead.
  const base = 1700000000000;
  const snap = (ms) => { const d=new Date(ms), y=d.getFullYear(), jd=d.getDay();
    return { getMillis:()=>ms, getYear:()=>y, getMonth:()=>d.getMonth()+1,
      getDayOfMonth:()=>d.getDate(), getDayOfYear:()=>Math.floor((ms-new Date(y,0,1).getTime())/86400000)+1,
      getHour:()=>d.getHours(), getMinute:()=>d.getMinutes(), getSecond:()=>d.getSeconds(),
      getMillisOfSecond:()=>d.getMilliseconds(), getDayOfWeek:()=>jd===0?7:jd,
      getOffsetSeconds:()=>-d.getTimezoneOffset()*60,
      getContinuousSeconds:()=>d.getMinutes()*60+d.getSeconds()+d.getMilliseconds()*1e-3,
      getEpochSeconds:()=>Math.floor(ms/1000), getTimeInSec:()=>d.getMinutes()*60+d.getSeconds(),
      getTimeInMin:()=>d.getHours()*60+d.getMinutes() }; };
  let cur = base;
  const clock = { millis: () => cur, snapshot: () => snap(cur) };
  // MUST precede `new CoreDocument`: its TimeVariables captures mStartTime =
  // performance.now() in the constructor, so anchoring elapsed=0 any later measures from
  // the previous frame's time and every frame after the first comes out the same.
  fakeNow = 0;
  const doc = new CoreDocument(clock);
  doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(
    data.buffer.slice(data.byteOffset, data.byteOffset+data.byteLength)));
  doc.setWidth(W); doc.setHeight(H);
  const c=createCanvas(W,H), x=c.getContext('2d');
  const paint=new CanvasPaintContext(null,x), remote=new WebRemoteContext(paint);
  remote.mWidth=W; remote.mHeight=H;
  doc.setClock?.(clock); remote.setClock?.(clock); doc.initializeContext(remote); remote.loadFloat(5,W); remote.loadFloat(6,H);
  remote.setPaintContext(paint); paint.setContext(remote);
  paint.createLayerCanvas=(w,h)=>createCanvas(Math.max(1,w),Math.max(1,h)).getContext('2d');
  paint.loadBitmap=()=>{};
  doc.applyDataOperations(remote);
  fakeNow = times[k] * 1000;    // advance to the frame we want
  cur = base + times[k] * 1000;
  paint.reset?.(); doc.paint(remote,-1);
  sctx.drawImage(c, k*W, 0);
  if (k===0) console.error('ops/frame:', doc.getOpsPerFrame());
}
writeFileSync(out, sheet.toBuffer('image/png'));
console.error(out, 't =', times.join(', '));
