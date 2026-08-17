// d3scene.mjs — render a 3D scene script with the TypeScript software renderer.
//
//   npx esbuild src/core/d3/index.ts --bundle --outfile=build-node/d3.mjs --format=esm
//   node d3scene.mjs scene.txt out.png
//
// The scene script is the same file the Java oracle consumes (players/3d-oracle). Driving both
// from one script tests the *rasterizer* in isolation: no wire format is involved, so a pixel
// difference can only be a port bug. Wire-format parity is a separate test.

import { readFileSync, writeFileSync } from 'fs';
import { deflateSync } from 'zlib';
import {
    SoftwarePaint3DContext,
    PROJECTION_PERSPECTIVE, PROJECTION_ORTHO,
    M3_IDENTITY, M3_TRANSLATE, M3_SCALE, M3_ROTATE_AXIS, M3_MULTIPLY,
    LIGHT_DIRECTIONAL, LIGHT_POINT,
    build as buildPrimitive,
} from './build-node/d3.mjs';
import { MeshExpression } from './build-node/meshexpr.mjs';

// RPN token names -> AnimatedFloatExpression opcodes (OFFSET + n). Operators are NaN payloads,
// so they are constructed rather than parsed: writing them as decimals would lose the exact bit
// pattern the evaluator switches on.
const OP_OFFSET = 0x310000;
const OPS = {
    '+': 1, '-': 2, '*': 3, '/': 4, min: 6, max: 7, pow: 8, sqrt: 9, abs: 10,
    exp: 13, sin: 18, cos: 19, hypot: 47, u: 70, v: 71,
};
const _dv = new DataView(new ArrayBuffer(4));
function asNan(v) {
    _dv.setInt32(0, (v | 0) | -8388608);
    return _dv.getFloat32(0);
}
function token(s) {
    return s in OPS ? asNan(OP_OFFSET + OPS[s]) : parseFloat(s);
}
/** One group: semicolon-separated expressions, each comma-separated RPN tokens; '-' is empty. */
function exprGroup(s) {
    if (s === '-') return [];
    return s.split(';').map((e) => new Float32Array(e.split(',').map(token)));
}

const MATRIX_SUB = {
    identity: M3_IDENTITY, translate: M3_TRANSLATE, scale: M3_SCALE,
    rotate: M3_ROTATE_AXIS, multiply: M3_MULTIPLY,
};

/**
 * Axis-aligned cube of edge 2*s as six independent quads, so each face carries its own normal.
 * Shared corner vertices would average three normals and round the edges.
 * Must stay identical to Oracle.java's cube().
 */
function cube(s) {
    const faces = [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
    const verts = new Float32Array(6 * 4 * 3);
    const normals = new Float32Array(6 * 4 * 3);
    const uv = new Float32Array(6 * 4 * 2);
    const idx = new Int32Array(6 * 6);
    for (let f = 0; f < 6; f++) {
        const [nx, ny, nz] = faces[f];
        let ax, ay, az, bx, by, bz;
        if (nz !== 0) { ax = nz; ay = 0; az = 0; bx = 0; by = 1; bz = 0; }
        else if (nx !== 0) { ax = 0; ay = 0; az = -nx; bx = 0; by = 1; bz = 0; }
        else { ax = 1; ay = 0; az = 0; bx = 0; by = 0; bz = -ny; }
        const corner = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
        for (let c = 0; c < 4; c++) {
            const vi = (f * 4 + c) * 3;
            const [u, v] = corner[c];
            verts[vi] = (nx + ax * u + bx * v) * s;
            verts[vi + 1] = (ny + ay * u + by * v) * s;
            verts[vi + 2] = (nz + az * u + bz * v) * s;
            normals[vi] = nx; normals[vi + 1] = ny; normals[vi + 2] = nz;
            uv[(f * 4 + c) * 2] = (u + 1) * 0.5;
            uv[(f * 4 + c) * 2 + 1] = (v + 1) * 0.5;
        }
        const b = f * 4, o = f * 6;
        idx[o] = b; idx[o + 1] = b + 1; idx[o + 2] = b + 2;
        idx[o + 3] = b; idx[o + 4] = b + 2; idx[o + 5] = b + 3;
    }
    return { idx, verts, normals, uv };
}

function defineMesh(ctx, t) {
    const id = parseInt(t[1], 10);
    switch (t[2]) {
        case 'cube': {
            const c = cube(t.length > 3 ? parseFloat(t[3]) : 1);
            ctx.defineMesh3D(id, c.idx, c.verts, c.normals, c.uv);
            break;
        }
        case 'tri':
            ctx.defineMesh3D(id, new Int32Array([0, 1, 2]),
                new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]), null);
            break;
        case 'prim': {
            // prim <id> <type> <segments> <flags> <p0,p1,...> [<channel1...>]
            const ptype = parseInt(t[3], 10);
            const segs = parseFloat(t[4]);
            const pflags = parseInt(t[5], 10);
            const chans = [];
            for (let c = 6; c < t.length; c++) {
                chans.push(new Float32Array(t[c].split(',').map(Number)));
            }
            const m = buildPrimitive(ptype, segs, pflags, chans);
            ctx.defineMesh3D(id, m.indices, m.verts, m.normals, m.uv);
            break;
        }
        case 'raw': {
            const idx = [], verts = [], norms = [];
            for (let k = 3; k < t.length; k++) {
                const c = t[k].indexOf(':');
                const key = t[k].slice(0, c);
                for (const s of t[k].slice(c + 1).split(',')) {
                    if (key === 'i') idx.push(parseInt(s, 10));
                    else if (key === 'v') verts.push(parseFloat(s));
                    else norms.push(parseFloat(s));
                }
            }
            ctx.defineMesh3D(id, new Int32Array(idx), new Float32Array(verts),
                norms.length ? new Float32Array(norms) : null);
            break;
        }
        default:
            throw new Error('unknown mesh kind: ' + t[2]);
    }
}

/**
 * Minimal PNG encoder for a non-premultiplied ARGB buffer.
 *
 * Deliberately not node-canvas: its ImageData is premultiplied, so putImageData of a pixel with
 * alpha 254 and blue 65 reads back as 64. That silently corrupted this harness into reporting
 * 1456 "port bugs" on pixels the renderer had got exactly right — every one of them a pixel
 * whose alpha was not 255. A comparison harness that mangles its own output is worse than no
 * harness, so the bytes go to disk untouched.
 */
function encodePng(argb, w, h) {
    const raw = Buffer.alloc((w * 4 + 1) * h);
    let o = 0;
    for (let y = 0; y < h; y++) {
        raw[o++] = 0;                       // filter type 0 (none) per scanline
        for (let x = 0; x < w; x++) {
            const p = argb[y * w + x];
            raw[o++] = (p >>> 16) & 0xFF;
            raw[o++] = (p >>> 8) & 0xFF;
            raw[o++] = p & 0xFF;
            raw[o++] = (p >>> 24) & 0xFF;
        }
    }
    const chunk = (type, data) => {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const crc = Buffer.alloc(4);
        crc.writeUInt32BE(crc32(body) >>> 0);
        return Buffer.concat([len, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;    // bit depth
    ihdr[9] = 6;    // color type: RGBA
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

let CRC_TABLE = null;
function crc32(buf) {
    if (CRC_TABLE === null) {
        CRC_TABLE = new Int32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            CRC_TABLE[n] = c;
        }
    }
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return c ^ -1;
}

function main() {
    const [scenePath, outPath] = process.argv.slice(2);
    if (!scenePath || !outPath) {
        console.error('usage: node d3scene.mjs <scene.txt> <out.png>');
        process.exit(2);
    }
    const ctx = new SoftwarePaint3DContext();
    let w = 256, h = 256;
    ctx.setSize(w, h);

    for (const raw of readFileSync(scenePath, 'utf8').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const t = line.split(/\s+/);
        switch (t[0]) {
            case 'size':
                w = parseInt(t[1], 10); h = parseInt(t[2], 10);
                ctx.setSize(w, h);
                break;
            case 'color':
                ctx.setBaseColorArgb(parseInt(t[1], 16) | 0);
                break;
            case 'clearDepth':
                ctx.clearDepth3D();
                break;
            case 'camera': {
                const proj = t[1] === 'ortho' ? PROJECTION_ORTHO : PROJECTION_PERSPECTIVE;
                const bar = t.indexOf('|');
                if (bar < 0) throw new Error("camera needs a '|' between proj and view params");
                ctx.setCamera3D(proj,
                    new Float32Array(t.slice(2, bar).map(Number)),
                    new Float32Array(t.slice(bar + 1).map(Number)));
                break;
            }
            case 'matrix': {
                const sub = MATRIX_SUB[t[1]];
                if (sub === undefined) throw new Error('bad matrix sub: ' + t[1]);
                ctx.matrix3Op(sub, new Float32Array(t.slice(2).map(Number)));
                break;
            }
            case 'mesh':
                defineMesh(ctx, t);
                break;
            case 'meshexpr': {
                // meshexpr <id> <type> <flags> <params> <pos> <normal> <uv>
                const op = new MeshExpression(
                    parseInt(t[1], 10), parseInt(t[2], 10), parseInt(t[3], 10),
                    exprGroup(t[4])[0], exprGroup(t[5]), exprGroup(t[6]), exprGroup(t[7]));
                // No host variables in a scene script, so the resolved copies are the originals;
                // a stub context keeps the op on its normal path.
                op.updateVariables({ getFloat: () => 0, listensTo: () => {} });
                op.paint({
                    getContext: () => ({ getCollectionsAccess: () => null }),
                    defineMesh3D: (id, i, v, n, uv) => ctx.defineMesh3D(id, i, v, n, uv),
                    drawMesh3D: () => {},
                });
                break;
            }
            case 'lights': {
                const n = (t.length - 1) / 6;
                const types = new Int32Array(n);
                const colors = new Int32Array(n);
                const params = new Float32Array(n * 4);
                for (let i = 0; i < n; i++) {
                    const b = 1 + i * 6;
                    types[i] = t[b] === 'point' ? LIGHT_POINT : LIGHT_DIRECTIONAL;
                    colors[i] = parseInt(t[b + 1], 16) | 0;
                    for (let k = 0; k < 4; k++) params[i * 4 + k] = parseFloat(t[b + 2 + k]);
                }
                ctx.setLights3D(types, colors, params);
                break;
            }
            case 'material':
                ctx.setMaterial3D(parseFloat(t[1]), parseFloat(t[2]));
                break;
            case 'depthBias':
                ctx.setDepthBias3D(parseFloat(t[1]), parseFloat(t[2]));
                break;
            case 'draw':
                ctx.drawMesh3D(parseInt(t[1], 10), parseInt(t[2], 10));
                break;
            default:
                // An unknown command is a scene-script bug, not something to skip: a typo that
                // drops a draw call renders an empty image that still "passes".
                throw new Error('unknown scene command: ' + t[0]);
        }
    }

    writeFileSync(outPath, encodePng(ctx.getColorBuffer(), w, h));
    console.log(`wrote ${outPath} (${w}x${h})`);
}

main();
