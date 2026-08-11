// Feed the reference's own sampled points through the TypeScript PathGenerator and diff
// the emitted buffers bit for bit.
import {readFileSync} from 'fs';
import {PathGenerator} from './pg.mjs';
const lines = readFileSync(new URL('./oracle.txt', import.meta.url), 'utf8').trim().split('\n');
const bitsToF = (h) => { const b = new ArrayBuffer(4); new DataView(b).setUint32(0, parseInt(h,16)); return new DataView(b).getFloat32(0); };
const samples = new Map();
for (const l of lines) {
  if (!l.startsWith('SAMPLES')) continue;
  const m = l.match(/SAMPLES (\w+) count=(\d+) loop=(\w+) \|(.*)$/);
  const pts = m[4].trim().split(/\s+/).map(p => p.split(',').map(bitsToF));
  samples.set(`${m[1]}|${m[2]}|${m[3]}`, pts);
}
const g = new PathGenerator();
let skipped = 0, total = 0, exact = 0, worstUlp = 0, worstAbs = 0, structural = 0;
for (const l of lines) {
  if (l.startsWith('SAMPLES') || l.includes('THREW')) continue;
  const m = l.match(/^(\w+) count=(\d+) loop=(\w+) mode=(\d+) n=(\d+) \|(.*)$/);
  if (!m) continue;
  const [, name, count, loop, mode, n, rest] = m;
  const want = rest.trim().split(/\s+/);
  const pts = samples.get(`${name}|${count}|${loop}`);
  if (!pts) { skipped++; continue; }   // reference threw before emitting samples
  const x = new Float32Array(pts.map(p => p[0]));
  const y = new Float32Array(pts.map(p => p[1]));
  const got = g.getPath(x, y, Number(mode), loop === 'true');
  total++;
  if (got.length !== want.length) { structural++; console.log(`  LENGTH ${name} count=${count} loop=${loop} mode=${mode}: ts ${got.length} vs java ${want.length}`); continue; }
  let bad = 0, maxUlp = 0, maxAbs = 0;
  for (let i = 0; i < want.length; i++) {
    const w = (parseInt(want[i], 16) | 0);
    if (got[i] === w) continue;
    bad++;
    const a = bitsToF(want[i]);
    const b = (() => { const bb = new ArrayBuffer(4); new DataView(bb).setInt32(0, got[i]); return new DataView(bb).getFloat32(0); })();
    maxUlp = Math.max(maxUlp, Math.abs(w - got[i]));
    if (Number.isFinite(a) && Number.isFinite(b)) maxAbs = Math.max(maxAbs, Math.abs(a - b));
  }
  if (bad === 0) exact++;
  else console.log(`  ${name.padEnd(6)} count=${String(count).padStart(3)} loop=${loop===' true'?'true':loop} mode=${mode}: ${bad}/${want.length} differ, max ${maxUlp} ulp, max abs ${maxAbs.toExponential(2)}`);
  worstUlp = Math.max(worstUlp, maxUlp); worstAbs = Math.max(worstAbs, maxAbs);
}
console.log(`\n  ${exact}/${total} cases bit-identical to remote-core; worst ${worstUlp} ulp, worst abs ${worstAbs.toExponential(2)}` + (structural?`, ${structural} LENGTH mismatches`:'') + (skipped?`; ${skipped} skipped (reference threw)`:''));
