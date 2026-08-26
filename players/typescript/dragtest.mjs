// dragtest.mjs — does a document actually respond to a drag, and does it keep the value?
//
//   node dragtest.mjs DOC.rc OUTDIR [--width N] [--height N]
//
// A still render cannot answer this: it paints the rest pose whether the document has a
// working TouchExpression, a broken one, or none at all.
//
// Nor can a single run. The first version of this file drove one drag and asserted the
// frames changed — and passed on a document with no touch handling whatsoever, because
// the clock advances every frame and any animated document changes on its own. Frames
// differing is not evidence that *touch* did anything.
//
// So: two runs of the same document on the same clock schedule, one dragged and one left
// alone, compared frame by frame. Every difference is then attributable to the touch and
// nothing else. What has to hold for an accumulating touch:
//
//   during the drag      dragged != idle    the drag moved it
//   after release        dragged != idle    the value PERSISTED past the finger lifting.
//                                           This is the discriminator: a plain expression
//                                           over touchX() snaps back to rest on release
//                                           and would match idle here.
//
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { createHash } from 'crypto';
import { createCanvas } from 'canvas';
class P { constructor(){this._commands=[];}
  moveTo(...a){this._commands.push(['moveTo',a]);} lineTo(...a){this._commands.push(['lineTo',a]);}
  quadraticCurveTo(...a){this._commands.push(['quadraticCurveTo',a]);}
  bezierCurveTo(...a){this._commands.push(['bezierCurveTo',a]);}
  arc(...a){this._commands.push(['arc',a]);} rect(...a){this._commands.push(['rect',a]);}
  closePath(){this._commands.push(['closePath',[]]);} addPath(){} }
globalThis.Path2D = P;

// Pin the clock. TimeVariables reads performance.now(), so the dragged and idle runs are
// created microseconds apart and an animated document is at a different phase in each —
// which shows up as the two runs disagreeing at rest and makes every later comparison
// meaningless. With a fake clock both runs see the identical time sequence, so the only
// difference left between them is the touch.
let NOW = 0;                       // seconds
const FIXED_EPOCH = 1735689600000; // 2025-01-01T00:00:00Z, so calendar vars are stable too
globalThis.performance = { now: () => NOW * 1000 };
const _Date = Date;
globalThis.Date = new Proxy(_Date, {
  apply: () => new _Date(FIXED_EPOCH + NOW * 1000),
  construct: (t, args) => args.length ? new t(...args) : new _Date(FIXED_EPOCH + NOW * 1000),
});
globalThis.Date.now = () => FIXED_EPOCH + NOW * 1000;
function patch(ctx) {
  const o = { fill: ctx.fill.bind(ctx), stroke: ctx.stroke.bind(ctx), clip: ctx.clip.bind(ctx) };
  const replay = p => { ctx.beginPath(); for (const [m,a] of p._commands||[]) ctx[m](...a); };
  ctx.fill = (p,r) => (p&&p._commands ? (replay(p), o.fill(r)) : o.fill(p,r));
  ctx.stroke = p => (p&&p._commands ? (replay(p), o.stroke()) : o.stroke(p));
  ctx.clip = (p,r) => (p&&p._commands ? (replay(p), o.clip(r)) : o.clip(p,r));
  return ctx;
}
const a = process.argv.slice(2);
const [file, outdir] = a;
const flag = (n,d) => { const i = a.indexOf('--'+n); return i>=0 ? a[i+1] : d; };
const { RemoteComposeBuffer, CoreDocument, CanvasPaintContext, WebRemoteContext } =
  await import('./build-node/node-entry.js');
const data = readFileSync(file);

function makeDoc() {
  const doc = new CoreDocument();
  doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(
    data.buffer.slice(data.byteOffset, data.byteOffset+data.byteLength)));
  const W = Number(flag('width',0)) || doc.getWidth?.() || 340;
  const H = Number(flag('height',0)) || doc.getHeight?.() || 340;
  doc.setWidth?.(W); doc.setHeight?.(H);
  const canvas = createCanvas(W,H);
  const ctx = patch(canvas.getContext('2d'));
  const paint = new CanvasPaintContext(null, ctx);
  const remote = new WebRemoteContext(paint);
  remote.mWidth = W; remote.mHeight = H;
  doc.initializeContext(remote);
  remote.loadFloat(5,W); remote.loadFloat(6,H);
  remote.setPaintContext(paint); paint.setContext(remote);
  paint.createLayerCanvas = (w,h) =>
    patch(createCanvas(Math.max(1,w),Math.max(1,h)).getContext('2d'));
  paint.loadBitmap = () => {};
  doc.applyDataOperations(remote);
  return { doc, remote, paint, canvas };
}

// The identical schedule both runs follow. `drag` is null for the idle run, so the two
// differ in exactly one respect.
const STEPS = [
  ['00_rest',    null],
  ['01_down',    d => d.touchDown(d.$r, 60, 170)],
  ['02_drag1',   d => d.touchDrag(d.$r, 105, 170)],
  ['03_drag2',   d => d.touchDrag(d.$r, 150, 170)],
  ['04_drag3',   d => d.touchDrag(d.$r, 195, 170)],
  ['05_drag4',   d => d.touchDrag(d.$r, 240, 170)],
  ['06_up',      d => d.touchUp(d.$r, 240, 170, 45, 0)],
  ['07_after1',  null],
  ['08_after2',  null],
  ['09_after3',  null],
  ['10_after4',  null],
];

function run(withTouch, tag) {
  NOW = 0;
  const { doc, remote, paint, canvas } = makeDoc();
  doc.$r = remote;
  mkdirSync(`${outdir}/${tag}`, { recursive: true });
  const out = {};
  let t = 0;
  for (const [name, act] of STEPS) {
    if (withTouch && act) act(doc);
    t += 1/60; NOW = t;
    remote.setAnimationTime?.(t);
    paint.reset?.(); paint.clearNeedsRepaint?.();
    doc.paint(remote, -3);
    const buf = canvas.toBuffer('image/png');
    writeFileSync(`${outdir}/${tag}/${name}.png`, buf);
    out[name] = createHash('sha1').update(buf).digest('hex').slice(0,10);
  }
  return out;
}

const dragged = run(true, 'dragged');
const idle = run(false, 'idle');
console.log(`  ${'step'.padEnd(10)} ${'dragged'.padEnd(11)} ${'idle'.padEnd(11)} differs`);
for (const [name] of STEPS) {
  const d = dragged[name] !== idle[name];
  console.log(`  ${name.padEnd(10)} ${dragged[name].padEnd(11)} ${idle[name].padEnd(11)} ${d?'yes':'no'}`);
}
const during = ['02_drag1','03_drag2','04_drag3','05_drag4']
  .some(k => dragged[k] !== idle[k]);
const AFTER = ['07_after1','08_after2','09_after3','10_after4'];
const after = AFTER.some(k => dragged[k] !== idle[k]);
// Does the value keep moving after the finger lifts? This is what actually separates a
// TouchExpression from a plain expression over touchX(): BOTH differ from the idle run
// after release, because touchX() simply retains its last value — so "it persisted" is
// not the discriminator it looks like. Only the accumulating op decelerates to a stop.
// It is a fair question only on a document whose idle run is otherwise still; an
// animated one changes every frame regardless, so that case is reported, not scored.
const idleStill = AFTER.every(k => idle[k] === idle[AFTER[0]]);
const coasts = new Set(AFTER.map(k => dragged[k])).size > 1;
console.log('');
const ok = (n,v) => { console.log(`  ${v?'PASS':'FAIL'}  ${n}`); return v; };
let good = true;
good = ok('the two runs start identical (control is sound)',
          dragged['00_rest'] === idle['00_rest']) && good;
good = ok('drag changes the frame vs an untouched run', during) && good;
good = ok('the drag is still felt after release', after) && good;
if (idleStill) {
  good = ok('release coasts rather than stopping dead (accumulating, not absolute)',
            coasts) && good;
} else {
  console.log('  n/a   release-coast check: the document animates on its own, so a '
            + 'changing frame proves nothing here');
}
process.exit(good ? 0 : 1);
