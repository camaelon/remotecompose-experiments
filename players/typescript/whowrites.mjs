// whowrites.mjs — which operations write a given variable id, and what contains them.
//
//   node whowrites.mjs DOC.rc
//
// State tracing localises a problem to a *variable*; this localises it to an
// *operation*. Seeing that a `setValue` sat at canvas level rather than inside the
// impulse that was supposed to gate it is what ended a multi-day hunt.
// Requires: npx esbuild src/node-entry.ts --bundle --outfile=build-node/node-entry.js \
//           --format=esm --platform=node --external:canvas
import { readFileSync } from 'fs';
import { createCanvas } from 'canvas';
if (typeof globalThis.Path2D === 'undefined') {
  class P { constructor(){this._commands=[];} moveTo(){} lineTo(){} quadraticCurveTo(){}
    bezierCurveTo(){} arc(){} rect(){} closePath(){} addPath(){} }
  globalThis.Path2D = P;
}
if (typeof globalThis.document === 'undefined') {
  globalThis.document = { createElement: () => createCanvas(1,1) };
}
const { RemoteComposeBuffer, CoreDocument, CanvasPaintContext, WebRemoteContext } =
  await import('./build-node/node-entry.js');
const data = readFileSync(process.argv[2]);
const doc = new CoreDocument();
doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(
  data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
const ctx = createCanvas(400,800).getContext('2d');
const paint = new CanvasPaintContext(null, ctx);
const remote = new WebRemoteContext(paint);
remote.mWidth = 400; remote.mHeight = 800;
doc.initializeContext(remote);

const path = [];
function walk(ops, d, trail) {
  if (!ops || d > 18) return;
  for (const op of ops) {
    if (!op) continue;
    const n = op.constructor?.name ?? '?';
    if (/ValueFloatExpressionChangeAction/.test(n)) {
      console.log(`setValue  target=${op.mTargetValueId}  fromExpr=${op.mValueExpressionId}`);
      console.log(`   under: ${trail.join(' > ')}`);
    }
    if (/ConditionalOperations/.test(n)) {
      console.log(`conditional type=${op.mType} a=${op.mVarA} b=${op.mVarB}`);
    }
    if (typeof op.getList === 'function') walk(op.getList(), d + 1, [...trail, n]);
  }
}
walk(doc.mOperations, 0, []);
