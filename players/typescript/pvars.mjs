// pvars.mjs — print every particle system in a document and the variable ids it owns.
//
//   node pvars.mjs DOC.rc
//
// Why this exists: particle variables are the only mutable state a JSON-authored
// document has, so reading a trace means mapping ids back to names. Inferring the base
// id from "lowest id >= 42" is wrong the moment one variable evaluates to NaN — a NaN
// result is never written to the float map, so the ids present shift and every label
// after the gap is off by one. This reads the assignment out of the document instead.
//
// The names are not in the binary (only ids are), so pass them in declaration order to
// get a labelled map:
//
//   node pvars.mjs DOC.rc --names a,b,c,d

import { readFileSync } from 'fs';

const file = process.argv[2];
if (!file) {
    console.error('usage: node pvars.mjs DOC.rc [--names a,b,c]');
    process.exit(1);
}
const namesArg = process.argv.indexOf('--names');
const names = namesArg > 0 ? process.argv[namesArg + 1].split(',') : null;

const { RemoteComposeBuffer, CoreDocument } = await import('./build-node/node-entry.js');
const data = readFileSync(file);
const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
const doc = new CoreDocument();
doc.initFromBuffer(RemoteComposeBuffer.fromArrayBuffer(ab));

// ParticlesCreate keeps the ids it allocated; the field name differs between builds, so
// take whichever integer array of plausible length is present.
function varIds(op) {
    for (const k of ['mVarId', 'mVariables', 'mIds', 'mVarIds']) {
        const v = op[k];
        if (Array.isArray(v) || ArrayBuffer.isView(v)) return Array.from(v);
    }
    return null;
}

const systems = [];
const seen = new Set();
(function walk(ops, depth) {
    if (!ops || depth > 20) return;
    for (const op of ops) {
        if (!op || seen.has(op)) continue;
        seen.add(op);
        const name = op.constructor?.name ?? '?';
        if (/ParticlesCreate/.test(name)) {
            const ids = varIds(op);
            if (ids) systems.push({ id: op.mId ?? op.mSystemId, count: op.mParticleCount ?? op.mCount, ids });
        }
        if (typeof op.getList === 'function') walk(op.getList(), depth + 1);
    }
})(doc.mOperations, 0);

if (!systems.length) {
    console.log('no particle systems found');
    process.exit(0);
}

let n = 0;
for (const s of systems) {
    console.log(`system id=${s.id} count=${s.count} vars=${s.ids.length}`);
    for (const id of s.ids) {
        const label = names && names[n] ? names[n] : `var${n}`;
        console.log(`  ${String(id).padStart(4)}  ${label}`);
        n++;
    }
}
if (names && n !== names.length) {
    console.log(`\nwarning: document has ${n} variables, ${names.length} names supplied`);
}
