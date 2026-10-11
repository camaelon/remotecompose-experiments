// nanbits.mjs — prove NaN-boxed variable ids survive decoding on Safari's engine.
//
//   node nanbits.mjs
//
// RemoteCompose encodes a variable reference as a float32 NaN with the id in the mantissa.
// That payload does NOT survive being read as a float: ECMAScript lets an implementation
// canonicalize any NaN, and JavaScriptCore does — Safari rewrites every NaN, signaling or
// quiet, either sign, to 0x7FC00000. V8 only sets the quiet bit, and because the id mask is
// 0x3FFFFF the payload happens to survive there, so a bug of this kind looks like "works in
// Chrome, blank in Safari" and no amount of testing in node will show it.
//
// This runs the REAL decode path — WireBuffer plus the operation's own read() — over bytes
// written the way the writer writes them, in both engines, and fails if an id comes back
// wrong. JavaScriptCore is reached through `osascript -l JavaScript`, which is the same
// engine family Safari ships; it is a proxy, not Safari itself, and the one thing it cannot
// tell you is whether a given Safari build differs.
//
// Add a case here whenever an operation starts carrying a variable.

import { execFileSync } from 'child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const dir = mkdtempSync(join(tmpdir(), 'nanbits-'));
const entry = join(dir, 'probe.ts');
const bundle = join(dir, 'probe.js');

// Each case: a name, the op's read(), and the field that must come back as a variable id.
writeFileSync(entry, `
import { WireBuffer } from ${JSON.stringify(join(process.cwd(), 'src/core/WireBuffer'))};
import { Matrix3DOp, SetCamera3D, SetLights3D, Paint3DState }
    from ${JSON.stringify(join(process.cwd(), 'src/core/operations/d3/Operations3D'))};
import { VectorExpression }
    from ${JSON.stringify(join(process.cwd(), 'src/core/operations/VectorExpression'))};
import { asNanBits, isVariableBits, idFromBits }
    from ${JSON.stringify(join(process.cwd(), 'src/core/operations/Utils'))};

function reader(build) {
    const w = new WireBuffer(256);
    build(w);
    return WireBuffer.fromArrayBuffer(w.cloneBytes().buffer);
}

/** Decode one op and report the id recovered from \`field\`, or -1 if it was lost. */
function one(name, build, read, field) {
    const ops = [];
    read(reader(build), ops);
    const arr = ops[0][field];
    const bits = typeof arr === 'number' ? arr : arr[0];
    return name + ' ' + (isVariableBits(bits) ? idFromBits(bits) : -1);
}

export function probe(id) {
    const n = asNanBits(id);
    const out = [];
    out.push(one('Matrix3DOp', (w) => {
        w.writeInt(2); w.writeInt(4); w.writeInt(n);
        w.writeFloat(0); w.writeFloat(1); w.writeFloat(0);
    }, Matrix3DOp.read, 'mArgs'));
    out.push(one('SetCamera3D', (w) => {
        w.writeInt(0); w.writeInt(1); w.writeInt(n); w.writeInt(0);
    }, SetCamera3D.read, 'mProjParams'));
    out.push(one('SetLights3D', (w) => {
        w.writeInt(0); w.writeInt(1); w.writeInt(n);
    }, SetLights3D.read, 'mParams'));
    out.push(one('Paint3DState', (w) => {
        w.writeInt(1); w.writeInt(1); w.writeInt(n);
    }, Paint3DState.read, 'mParams'));
    out.push(one('VectorExpression', (w) => {
        w.writeInt(7); w.writeByte(2); w.writeByte(0); w.writeShort(1); w.writeInt(n);
    }, VectorExpression.read, 'mSrcValue'));
    return out.join('|');
}
`);

execFileSync('npx', ['esbuild', entry, '--bundle', `--outfile=${bundle}`,
                     '--format=iife', '--global-name=NP', '--target=es2020'],
             { stdio: 'pipe' });

const IDS = [1, 5, 42, 300, 0x3FFF];
const src = readFileSync(bundle, 'utf8');

function run(engine) {
    const script = join(dir, `run-${engine}.js`);
    const tail = `var o=[];${JSON.stringify(IDS)}.forEach(function(i){o.push(NP.probe(i));});`;
    if (engine === 'jsc') {
        writeFileSync(script, src + tail + 'JSON.stringify(o);');
        return JSON.parse(execFileSync('osascript', ['-l', 'JavaScript', script],
                                       { encoding: 'utf8' }));
    }
    writeFileSync(script, src + tail + 'console.log(JSON.stringify(o));');
    return JSON.parse(execFileSync('node', [script], { encoding: 'utf8' }));
}

// --self-test: route an id through a JS float the way the pre-2026-10-05 code did, and
// confirm this harness notices. Without it a green run only proves the harness ran, not
// that it can tell a lost id from a kept one — and on V8 the old code passes anyway, so
// the discrimination has to be demonstrated on JSC specifically.
if (process.argv.includes('--self-test')) {
    const old = join(dir, 'old.js');
    writeFileSync(old, `
        var dv = new DataView(new ArrayBuffer(8));
        function asNan(id){ dv.setInt32(0,(id|0)|(-0x800000),false);
                            return dv.getFloat32(0,false); }
        function idFromNan(v){ dv.setFloat32(4,v,false); return dv.getInt32(4,false)&0x3FFFFF; }
        var o=[]; ${JSON.stringify(IDS)}.forEach(function(i){ o.push(idFromNan(asNan(i))); });
        JSON.stringify(o);`);
    const got = JSON.parse(execFileSync('osascript', ['-l', 'JavaScript', old],
                                        { encoding: 'utf8' }));
    const lost = got.filter((g, k) => g !== IDS[k]).length;
    console.log('  self-test — the old float path, on JSC:');
    console.log(`      ids in  ${JSON.stringify(IDS)}`);
    console.log(`      ids out ${JSON.stringify(got)}`);
    console.log(lost === IDS.length
        ? `      all ${lost} lost, as expected — the harness can tell the difference\n`
        : `      only ${lost} of ${IDS.length} lost — THIS HARNESS PROVES NOTHING\n`);
    if (lost !== IDS.length) process.exit(1);
}

let failures = 0;
for (const engine of ['v8', 'jsc']) {
    const rows = run(engine);
    console.log(`  ${engine === 'v8' ? 'V8 (node)      ' : 'JSC (Safari)   '}`);
    rows.forEach((row, k) => {
        const want = IDS[k];
        for (const part of row.split('|')) {
            const [op, got] = part.split(' ');
            const ok = Number(got) === want;
            if (!ok) failures++;
            if (!ok || want === IDS[0]) {
                console.log(`      ${ok ? 'ok  ' : 'FAIL'} ${op.padEnd(17)}`
                            + `id ${want} -> ${got}`);
            }
        }
    });
}
if (failures) {
    console.log(`\n  ${failures} id(s) lost. A NaN-boxed id reached a JS float somewhere on`
                + ` the decode path.`);
    process.exit(1);
}
console.log('\n  every id recovered in both engines');
