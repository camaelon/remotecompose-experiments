// vecrpn.mjs — run a VectorRpn program and print the result as raw float bits, matching the
// output of the Java DumpVec so the two can be compared directly.
import { VectorRpn, MAX_DIM, OFFSET } from './build-node/vecrpn.mjs';

const OPS = {
    '+': 1, '-': 2, '*': 3, '/': 4, '%': 5, min: 6, max: 7, pow: 8, sqrt: 9, abs: 10,
    floor: 14, round: 17, sin: 18, cos: 19, ceil: 31, square: 45, inv: 52, nop: 55,
    neg: 73, vec2: 100, vec3: 101, vec4: 102, dot: 103, cross: 104, len: 105,
    lensq: 106, norm: 107,
};
const dv = new DataView(new ArrayBuffer(4));
const op = (code) => { dv.setInt32(0, code | -8388608); return dv.getFloat32(0); };
const bits = (f) => { dv.setFloat32(0, f); return dv.getInt32(0); };

const argv = process.argv.slice(2);
const soft = argv[0] === '--soft';
const prog = argv[soft ? 1 : 0];
const tokens = prog.trim().split(/\s+/);
const p = new Float32Array(tokens.map((s) => (s in OPS ? op(OFFSET + OPS[s]) : parseFloat(s))));

const rpn = new VectorRpn();
rpn.mSoftDomain = soft;
const out = new Float32Array(MAX_DIM);
const lanes = rpn.apply(p, p.length, out);
console.log([lanes, ...Array.from(out, bits)].join(' '));
