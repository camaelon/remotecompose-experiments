// Primitive3D: parametric mesh generators for MESH_PRIMITIVE_3D.
//
// Port of the reference Primitive3D.java. Each generator returns a MeshData that goes straight
// into defineMesh3D, so a document can name a shape instead of shipping its vertices — a sphere
// is ~40 bytes on the wire instead of ~20 KB, and because the parameters may be NaN-boxed
// variables, the shape can be driven by an expression and rebuilt when it changes.
//
// Outputs are Float32Array so every store rounds to 32 bits exactly as the Java float[] does.
// Where a value is built up across several operations before being stored, the arithmetic is
// written to round at each step (see Matrix4.ts for why).
//
// Winding is CCW-from-outside throughout. The triangle *order* inside each quad is deliberate
// and must not be "tidied": each triple lists its two grid edges first and closes on the
// diagonal, which is what makes the wireframe edge-selection bits (WIRE_EDGE0/1/2) draw
// meridians, parallels or the full grid rather than an arbitrary subset.

import { MonotonicCurveFit } from './MonotonicCurveFit';

export interface MeshData {
    verts: Float32Array;
    normals: Float32Array;
    indices: Int32Array;
    uv: Float32Array | null;
}

// ---- type ids (must match Primitive3D.java) --------------------------------

export const SPHERE = 0;
export const CYLINDER = 1;
export const CONE = 2;
export const CUBE = 3;
export const ROUNDED_CUBE = 4;
export const SPHERICAL_SECTOR = 5;
export const SPHERICAL_DOME = 6;
export const TUBE = 7;
export const CAP_TUBE = 8;
export const PROFILE_TUBE = 9;
export const TORUS = 10;
export const PLANE = 11;
export const EXTRUDE_CIRCLE = 12;
export const EXTRUDE_SECTOR = 13;
export const EXTRUDE_SEGMENT = 14;
export const EXTRUDE_ARC = 15;
export const EXTRUDE_ROUNDED_RECT = 16;
export const EXTRUDE_SQUIRCLE = 17;
export const EXTRUDE_PATH = 18;
export const LATHE = 19;
export const SWEEP = 20;
export const HELIX = 21;
export const ICOSPHERE = 22;

export const FLAG_SPLINE = 0x1;
export const FLAG_TUBE_LEGACY = 0x2;
export const FLAG_TUBE_PATH_DENSITY = 0x4;
export const FLAG_TUBE_CAP = 0x8;
export const FLAG_UV_SHIFT = 4;
export const FLAG_UV_MASK = 0x3 << FLAG_UV_SHIFT;
export const UV_NONE = 0;

export function uvMode(flags: number): number {
    return (flags & FLAG_UV_MASK) >> FLAG_UV_SHIFT;
}

const DEFAULT_RADIAL = 24;
const DEFAULT_TUBE_SIDES = 14;
/** Ceiling on rings emitted per control span, so a pathological path cannot blow up memory. */
const MAX_TUBE_PER_SPAN = 256;
const DEFAULT_ROUND_SEG = 4;

const fround = Math.fround;
function fm(a: number, b: number): number { return fround(a * b); }
function fa(a: number, b: number): number { return fround(a + b); }

function clampF(x: number, lo: number, hi: number): number {
    return x < lo ? lo : (x > hi ? hi : x);
}

function cross(ax: number, ay: number, az: number,
               bx: number, by: number, bz: number, out: Float32Array): void {
    out[0] = fround(fm(ay, bz) - fm(az, by));
    out[1] = fround(fm(az, bx) - fm(ax, bz));
    out[2] = fround(fm(ax, by) - fm(ay, bx));
}

function clampInt(x: number, lo: number, hi: number): number {
    return x < lo ? lo : (x > hi ? hi : x);
}

/**
 * Catmull-Rom interpolation of the span p1..p2 (with neighbours p0,p3) at t.
 *
 * Written to match the reference's left-to-right float evaluation term by term. Regrouping the
 * coefficient sums — even into algebraically identical pairs — rounds differently and moves
 * silhouette pixels.
 */
function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const t2 = fm(t, t);
    const t3 = fm(t2, t);
    // 2*p0 - 5*p1 + 4*p2 - p3, evaluated left to right.
    const c2 = fround(fa(fround(fm(2, p0) - fm(5, p1)), fm(4, p2)) - p3);
    // -p0 + 3*p1 - 3*p2 + p3, evaluated left to right.
    const c3 = fa(fround(fa(-p0, fm(3, p1)) - fm(3, p2)), p3);
    return fm(0.5, fa(fa(fa(
        fm(2, p1),
        fm(fa(-p0, p2), t)),
        fm(c2, t2)),
        fm(c3, t3)));
}

/** Round segments to an int, falling back to dflt when <= 0, clamped to min. */
function segCount(segments: number, dflt: number, min: number): number {
    const n = segments > 0 ? Math.round(segments) : dflt;
    return Math.max(min, n);
}

/**
 * Merge several meshes into one, re-basing each part's indices — lets a primitive be assembled
 * from reusable pieces (a cylinder is a side wall plus two cap disks). UV survives only if every
 * part carries it.
 */
export function concat(parts: MeshData[]): MeshData {
    let vc = 0;
    let ic = 0;
    let allUv = parts.length > 0;
    for (const m of parts) {
        vc += m.verts.length;
        ic += m.indices.length;
        if (m.uv === null) {
            allUv = false;
        }
    }
    const v = new Float32Array(vc);
    const n = new Float32Array(vc);
    const idx = new Int32Array(ic);
    const uvOut = allUv ? new Float32Array(vc / 3 * 2) : null;
    let vo = 0, io = 0, uvo = 0, base = 0;
    for (const m of parts) {
        v.set(m.verts, vo);
        n.set(m.normals, vo);
        for (let k = 0; k < m.indices.length; k++) {
            idx[io + k] = m.indices[k] + base;
        }
        if (uvOut !== null && m.uv !== null) {
            uvOut.set(m.uv, uvo);
            uvo += m.uv.length;
        }
        base += m.verts.length / 3;
        vo += m.verts.length;
        io += m.indices.length;
    }
    return { verts: v, normals: n, indices: idx, uv: uvOut };
}

/** Orthonormal basis perpendicular to the unit vector d. */
function perpBasis(dx: number, dy: number, dz: number,
                   u: Float32Array, v: Float32Array): void {
    const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
    let rx: number, ry: number, rz: number;
    if (ax <= ay && ax <= az) {
        rx = 1; ry = 0; rz = 0;
    } else if (ay <= az) {
        rx = 0; ry = 1; rz = 0;
    } else {
        rx = 0; ry = 0; rz = 1;
    }
    const ux = fround(fm(dy, rz) - fm(dz, ry));
    const uy = fround(fm(dz, rx) - fm(dx, rz));
    const uz = fround(fm(dx, ry) - fm(dy, rx));
    let ul = fround(Math.sqrt(fa(fa(fm(ux, ux), fm(uy, uy)), fm(uz, uz))));
    if (ul < 1e-6) {
        ul = 1e-6;
    }
    u[0] = fround(ux / ul);
    u[1] = fround(uy / ul);
    u[2] = fround(uz / ul);
    cross(dx, dy, dz, u[0], u[1], u[2], v);
}

// ---- solids ----------------------------------------------------------------

/** A latitude band of a sphere for polar angle thetaMin..thetaMax (0 = +Y pole). */
export function sphereBand(radius: number, thetaMin: number, thetaMax: number,
                           stacks: number, slices: number,
                           cx: number, cy: number, cz: number, uvm: number): MeshData {
    const rows = stacks + 1;
    const cols = slices + 1;
    const verts = new Float32Array(rows * cols * 3);
    const normals = new Float32Array(rows * cols * 3);
    const uv = uvm !== 0 ? new Float32Array(rows * cols * 2) : null;
    let p = 0, q = 0;
    for (let i = 0; i <= stacks; i++) {
        const theta = fa(thetaMin, fround(fm(fround(thetaMax - thetaMin), i) / stacks));
        const sinT = fround(Math.sin(theta));
        const cosT = fround(Math.cos(theta));
        for (let j = 0; j <= slices; j++) {
            const phi = 2.0 * Math.PI * j / slices;
            const nx = fm(sinT, fround(Math.cos(phi)));
            const ny = cosT;
            const nz = fm(sinT, fround(Math.sin(phi)));
            normals[p] = nx;
            normals[p + 1] = ny;
            normals[p + 2] = nz;
            verts[p] = fa(cx, fm(nx, radius));
            verts[p + 1] = fa(cy, fm(ny, radius));
            verts[p + 2] = fa(cz, fm(nz, radius));
            p += 3;
            if (uv !== null) {
                // Longitude/latitude globe mapping: U reversed so text reads left-to-right on
                // the camera-facing front; north pole at the top.
                uv[q] = fround(1 - j / slices);
                uv[q + 1] = fround(1 - i / stacks);
                q += 2;
            }
        }
    }
    const indices = new Int32Array(stacks * slices * 6);
    let k = 0;
    for (let i = 0; i < stacks; i++) {
        for (let j = 0; j < slices; j++) {
            const a = i * cols + j;
            const b = (i + 1) * cols + j;
            const c = (i + 1) * cols + (j + 1);
            const d = i * cols + (j + 1);
            // First edge of each triangle is a meridian, second a parallel, diagonal last.
            indices[k++] = d; indices[k++] = c; indices[k++] = b;
            indices[k++] = b; indices[k++] = a; indices[k++] = d;
        }
    }
    return { verts, normals, indices, uv };
}

export function sphere(radius: number, cx: number, cy: number, cz: number,
                       slices: number, stacks: number, uvm: number): MeshData {
    return sphereBand(radius, 0, Math.PI, stacks, slices, cx, cy, cz, uvm);
}

/** Torus in the XZ plane (hole along +Y). */
export function torus(majorR: number, minorR: number, cx: number, cy: number, cz: number,
                      segU: number, segV: number, uvm: number): MeshData {
    const cols = segV + 1;
    const rows = segU + 1;
    const verts = new Float32Array(rows * cols * 3);
    const normals = new Float32Array(rows * cols * 3);
    const uv = uvm !== 0 ? new Float32Array(rows * cols * 2) : null;
    let p = 0, q = 0;
    for (let i = 0; i <= segU; i++) {
        const u = 2.0 * Math.PI * i / segU;
        const cu = fround(Math.cos(u));
        const su = fround(Math.sin(u));
        for (let j = 0; j <= segV; j++) {
            const v = 2.0 * Math.PI * j / segV;
            const cv = fround(Math.cos(v));
            const sv = fround(Math.sin(v));
            normals[p] = fm(cv, cu);
            normals[p + 1] = sv;
            normals[p + 2] = fm(cv, su);
            verts[p] = fa(cx, fm(fa(majorR, fm(minorR, cv)), cu));
            verts[p + 1] = fa(cy, fm(minorR, sv));
            verts[p + 2] = fa(cz, fm(fa(majorR, fm(minorR, cv)), su));
            p += 3;
            if (uv !== null) {
                uv[q] = fround(i / segU);
                uv[q + 1] = fround(j / segV);
                q += 2;
            }
        }
    }
    const indices = new Int32Array(segU * segV * 6);
    let k = 0;
    for (let i = 0; i < segU; i++) {
        for (let j = 0; j < segV; j++) {
            const a = i * cols + j;
            const b = (i + 1) * cols + j;
            const c = (i + 1) * cols + (j + 1);
            const d = i * cols + (j + 1);
            indices[k++] = d; indices[k++] = c; indices[k++] = b;
            indices[k++] = b; indices[k++] = a; indices[k++] = d;
        }
    }
    return { verts, normals, indices, uv };
}

/** Flat rect in the XY plane facing +Z. */
export function plane(width: number, height: number,
                      cx: number, cy: number, cz: number, uvm: number): MeshData {
    const hw = fm(width, 0.5);
    const hh = fm(height, 0.5);
    const verts = new Float32Array([
        fround(cx - hw), fround(cy - hh), cz,
        fa(cx, hw), fround(cy - hh), cz,
        fa(cx, hw), fa(cy, hh), cz,
        fround(cx - hw), fa(cy, hh), cz,
    ]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const indices = new Int32Array([0, 1, 2, 0, 2, 3]);   // CCW from +Z
    const uv = uvm !== 0 ? new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]) : null;
    return { verts, normals, indices, uv };
}

const CUBE_FACE = [
    [0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0],
];
const CUBE_CORNERS = [
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],       // +Z
    [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]],   // -Z
    [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]],       // +X
    [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]],   // -X
    [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]],       // +Y
    [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]],   // -Y
];
const CUBE_FACE_UV = [[0, 0], [1, 0], [1, 1], [0, 1]];

/** Box of full dimensions (dx,dy,dz); 24 verts so each face keeps its own normal. */
export function cube(dx: number, dy: number, dz: number,
                     cx: number, cy: number, cz: number, uvm: number): MeshData {
    const hx = fm(dx, 0.5), hy = fm(dy, 0.5), hz = fm(dz, 0.5);
    const verts = new Float32Array(24 * 3);
    const normals = new Float32Array(24 * 3);
    const indices = new Int32Array(6 * 6);
    const uv = uvm !== 0 ? new Float32Array(24 * 2) : null;
    let vp = 0, ip = 0, qp = 0;
    for (let f = 0; f < 6; f++) {
        const base = f * 4;
        for (let c = 0; c < 4; c++) {
            verts[vp] = fa(cx, fm(CUBE_CORNERS[f][c][0], hx));
            verts[vp + 1] = fa(cy, fm(CUBE_CORNERS[f][c][1], hy));
            verts[vp + 2] = fa(cz, fm(CUBE_CORNERS[f][c][2], hz));
            normals[vp] = CUBE_FACE[f][0];
            normals[vp + 1] = CUBE_FACE[f][1];
            normals[vp + 2] = CUBE_FACE[f][2];
            vp += 3;
            if (uv !== null) {
                uv[qp] = CUBE_FACE_UV[c][0];
                uv[qp + 1] = CUBE_FACE_UV[c][1];
                qp += 2;
            }
        }
        indices[ip++] = base; indices[ip++] = base + 1; indices[ip++] = base + 2;
        indices[ip++] = base; indices[ip++] = base + 2; indices[ip++] = base + 3;
    }
    return { verts, normals, indices, uv };
}

/** Flat triangle-fan disk in the plane spanned by unit u,v; faces +(u x v) unless flipped. */
export function disk(cx: number, cy: number, cz: number,
                     ux: number, uy: number, uz: number,
                     vx: number, vy: number, vz: number,
                     radius: number, sides: number, flip: boolean): MeshData {
    const nrm = new Float32Array(3);
    cross(ux, uy, uz, vx, vy, vz, nrm);
    if (flip) {
        nrm[0] = -nrm[0]; nrm[1] = -nrm[1]; nrm[2] = -nrm[2];
    }
    const verts = new Float32Array((sides + 1) * 3);
    const normals = new Float32Array((sides + 1) * 3);
    for (let j = 0; j < sides; j++) {
        const phi = 2.0 * Math.PI * j / sides;
        const c = fround(Math.cos(phi));
        const s = fround(Math.sin(phi));
        const p = j * 3;
        verts[p] = fa(cx, fm(radius, fa(fm(c, ux), fm(s, vx))));
        verts[p + 1] = fa(cy, fm(radius, fa(fm(c, uy), fm(s, vy))));
        verts[p + 2] = fa(cz, fm(radius, fa(fm(c, uz), fm(s, vz))));
        normals[p] = nrm[0]; normals[p + 1] = nrm[1]; normals[p + 2] = nrm[2];
    }
    const center = sides;
    verts[center * 3] = cx; verts[center * 3 + 1] = cy; verts[center * 3 + 2] = cz;
    normals[center * 3] = nrm[0];
    normals[center * 3 + 1] = nrm[1];
    normals[center * 3 + 2] = nrm[2];
    const indices = new Int32Array(sides * 3);
    let k = 0;
    for (let j = 0; j < sides; j++) {
        const j1 = (j + 1) % sides;
        if (flip) {
            indices[k++] = center; indices[k++] = j1; indices[k++] = j;
        } else {
            indices[k++] = center; indices[k++] = j; indices[k++] = j1;
        }
    }
    return { verts, normals, indices, uv: null };
}

/** Cone with base at (cx,cy,cz) and apex up; smooth slant normals plus a flat base. */
export function cone(radius: number, height: number,
                     cx: number, cy: number, cz: number, seg: number): MeshData {
    const slant = fround(Math.sqrt(fa(fm(height, height), fm(radius, radius))));
    const nY = fround(radius / slant);
    const nS = fround(height / slant);
    const sv = new Float32Array((seg + 1) * 2 * 3);
    const sn = new Float32Array((seg + 1) * 2 * 3);
    for (let j = 0; j <= seg; j++) {
        const phi = 2.0 * Math.PI * j / seg;
        const c = fround(Math.cos(phi));
        const s = fround(Math.sin(phi));
        const b = j * 3;
        const a = (seg + 1 + j) * 3;
        sv[b] = fa(cx, fm(radius, c));
        sv[b + 1] = cy;
        sv[b + 2] = fa(cz, fm(radius, s));
        sn[b] = fm(nS, c); sn[b + 1] = nY; sn[b + 2] = fm(nS, s);
        sv[a] = cx;                          // apex, duplicated per slice for a crisp normal
        sv[a + 1] = fa(cy, height);
        sv[a + 2] = cz;
        sn[a] = fm(nS, c); sn[a + 1] = nY; sn[a + 2] = fm(nS, s);
    }
    const si = new Int32Array(seg * 3);
    let k = 0;
    for (let j = 0; j < seg; j++) {
        si[k++] = j; si[k++] = seg + 1 + j; si[k++] = j + 1;
    }
    const side: MeshData = { verts: sv, normals: sn, indices: si, uv: null };
    const base = disk(cx, cy, cz, 1, 0, 0, 0, 0, 1, radius, seg, false);
    return concat([side, base]);
}

/** Cylinder of `radius` between two points, with end caps. */
export function cylinder(radius: number, x1: number, y1: number, z1: number,
                         x2: number, y2: number, z2: number, seg: number): MeshData {
    let ax = fround(x2 - x1), ay = fround(y2 - y1), az = fround(z2 - z1);
    let len = fround(Math.sqrt(fa(fa(fm(ax, ax), fm(ay, ay)), fm(az, az))));
    if (len < 1e-6) {
        len = 1e-6;
    }
    ax = fround(ax / len); ay = fround(ay / len); az = fround(az / len);
    const u = new Float32Array(3);
    const v = new Float32Array(3);
    perpBasis(ax, ay, az, u, v);
    const sv = new Float32Array((seg + 1) * 2 * 3);
    const sn = new Float32Array((seg + 1) * 2 * 3);
    for (let j = 0; j <= seg; j++) {
        const phi = 2.0 * Math.PI * j / seg;
        const c = fround(Math.cos(phi));
        const s = fround(Math.sin(phi));
        const dx = fa(fm(c, u[0]), fm(s, v[0]));
        const dy = fa(fm(c, u[1]), fm(s, v[1]));
        const dz = fa(fm(c, u[2]), fm(s, v[2]));
        const bi = j * 3;
        const ti = (seg + 1 + j) * 3;
        sv[bi] = fa(x1, fm(radius, dx));
        sv[bi + 1] = fa(y1, fm(radius, dy));
        sv[bi + 2] = fa(z1, fm(radius, dz));
        sv[ti] = fa(x2, fm(radius, dx));
        sv[ti + 1] = fa(y2, fm(radius, dy));
        sv[ti + 2] = fa(z2, fm(radius, dz));
        sn[bi] = dx; sn[bi + 1] = dy; sn[bi + 2] = dz;
        sn[ti] = dx; sn[ti + 1] = dy; sn[ti + 2] = dz;
    }
    const si = new Int32Array(seg * 6);
    let k = 0;
    for (let j = 0; j < seg; j++) {
        const bj = j, bj1 = j + 1, tj = seg + 1 + j, tj1 = seg + 1 + j + 1;
        // edge0 = the vertical seam, edge1 = around the ring, diagonal last.
        si[k++] = tj; si[k++] = bj; si[k++] = bj1;
        si[k++] = bj1; si[k++] = tj1; si[k++] = tj;
    }
    const side: MeshData = { verts: sv, normals: sn, indices: si, uv: null };
    const capB = disk(x1, y1, z1, u[0], u[1], u[2], v[0], v[1], v[2], radius, seg, true);
    const capT = disk(x2, y2, z2, u[0], u[1], u[2], v[0], v[1], v[2], radius, seg, false);
    return concat([side, capB, capT]);
}

/** Rounded box: each face is a grid pushed out to the rounded surface by a clamped offset. */
export function roundedCube(dx: number, dy: number, dz: number,
                            cx: number, cy: number, cz: number,
                            r: number, seg: number): MeshData {
    const ex = Math.max(fround(fm(dx, 0.5) - r), 0);
    const ey = Math.max(fround(fm(dy, 0.5) - r), 0);
    const ez = Math.max(fround(fm(dz, 0.5) - r), 0);
    const ox = fa(ex, r), oy = fa(ey, r), oz = fa(ez, r);
    const faces = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
    const perFace = (seg + 1) * (seg + 1);
    const vc = 6 * perFace;
    const verts = new Float32Array(vc * 3);
    const normals = new Float32Array(vc * 3);
    const indices = new Int32Array(6 * seg * seg * 6);
    let vp = 0, ip = 0, vbase = 0;
    for (const fc of faces) {
        const axis = fc[0];
        const sign = fc[1];
        const uDir = [0, 0, 0], vDir = [0, 0, 0], nDir = [0, 0, 0];
        nDir[axis] = sign;
        if (axis === 0) {
            if (sign > 0) { uDir[1] = 1; vDir[2] = 1; } else { uDir[2] = 1; vDir[1] = 1; }
        } else if (axis === 1) {
            if (sign > 0) { uDir[2] = 1; vDir[0] = 1; } else { uDir[0] = 1; vDir[2] = 1; }
        } else {
            if (sign > 0) { uDir[0] = 1; vDir[1] = 1; } else { uDir[1] = 1; vDir[0] = 1; }
        }
        for (let s = 0; s <= seg; s++) {
            const u = fround(fround(s / seg) * 2 - 1);
            for (let t = 0; t <= seg; t++) {
                const w = fround(fround(t / seg) * 2 - 1);
                const px = fa(fa(fm(nDir[0], ox), fm(uDir[0], fm(u, ox))), fm(vDir[0], fm(w, ox)));
                const py = fa(fa(fm(nDir[1], oy), fm(uDir[1], fm(u, oy))), fm(vDir[1], fm(w, oy)));
                const pz = fa(fa(fm(nDir[2], oz), fm(uDir[2], fm(u, oz))), fm(vDir[2], fm(w, oz)));
                const qx = clampF(px, -ex, ex);
                const qy = clampF(py, -ey, ey);
                const qz = clampF(pz, -ez, ez);
                let ddx = fround(px - qx), ddy = fround(py - qy), ddz = fround(pz - qz);
                let l = fround(Math.sqrt(fa(fa(fm(ddx, ddx), fm(ddy, ddy)), fm(ddz, ddz))));
                if (l < 1e-6) {
                    ddx = nDir[0]; ddy = nDir[1]; ddz = nDir[2]; l = 1;
                }
                const inv = fround(1 / l);
                verts[vp] = fa(fa(cx, qx), fm(r, fm(ddx, inv)));
                verts[vp + 1] = fa(fa(cy, qy), fm(r, fm(ddy, inv)));
                verts[vp + 2] = fa(fa(cz, qz), fm(r, fm(ddz, inv)));
                normals[vp] = fm(ddx, inv);
                normals[vp + 1] = fm(ddy, inv);
                normals[vp + 2] = fm(ddz, inv);
                vp += 3;
            }
        }
        const stride = seg + 1;
        for (let s = 0; s < seg; s++) {
            for (let t = 0; t < seg; t++) {
                const a = vbase + s * stride + t;
                const b = vbase + (s + 1) * stride + t;
                const c = vbase + (s + 1) * stride + (t + 1);
                const d = vbase + s * stride + (t + 1);
                indices[ip++] = a; indices[ip++] = b; indices[ip++] = c;
                indices[ip++] = c; indices[ip++] = d; indices[ip++] = a;
            }
        }
        vbase += perFace;
    }
    return { verts, normals, indices, uv: null };
}

/** Spherical cap plus the cone joining its rim back to the centre (an ice-cream solid). */
export function sphericalSector(radius: number, angle: number,
                                cx: number, cy: number, cz: number,
                                slices: number, stacks: number): MeshData {
    const cap = sphereBand(radius, 0, angle, stacks, slices, cx, cy, cz, UV_NONE);
    const seg = slices;
    const ca = fround(Math.cos(angle));
    const sa = fround(Math.sin(angle));
    const ringY = fm(radius, ca);
    const ringR = fm(radius, sa);
    const cv = new Float32Array((seg + 1) * 2 * 3);
    const cn = new Float32Array((seg + 1) * 2 * 3);
    for (let j = 0; j <= seg; j++) {
        const phi = 2.0 * Math.PI * j / seg;
        const c = fround(Math.cos(phi));
        const s = fround(Math.sin(phi));
        const ri = j * 3;
        const ai = (seg + 1 + j) * 3;
        cv[ri] = fa(cx, fm(ringR, c));
        cv[ri + 1] = fa(cy, ringY);
        cv[ri + 2] = fa(cz, fm(ringR, s));
        cv[ai] = cx; cv[ai + 1] = cy; cv[ai + 2] = cz;   // apex = sector centre
        const nx = fm(ca, c), ny = -sa, nz = fm(ca, s);
        cn[ri] = nx; cn[ri + 1] = ny; cn[ri + 2] = nz;
        cn[ai] = nx; cn[ai + 1] = ny; cn[ai + 2] = nz;
    }
    const ci = new Int32Array(seg * 3);
    let k = 0;
    for (let j = 0; j < seg; j++) {
        ci[k++] = j; ci[k++] = j + 1; ci[k++] = seg + 1 + j;
    }
    return concat([cap, { verts: cv, normals: cn, indices: ci, uv: null }]);
}

/** Spherical cap closed by a flat disk at the rim plane (a hemisphere at angle = PI/2). */
export function sphericalDome(radius: number, angle: number,
                              cx: number, cy: number, cz: number,
                              slices: number, stacks: number): MeshData {
    const cap = sphereBand(radius, 0, angle, stacks, slices, cx, cy, cz, UV_NONE);
    const ringY = fm(radius, fround(Math.cos(angle)));
    const ringR = fm(radius, fround(Math.sin(angle)));
    const base = disk(cx, fa(cy, ringY), cz, 1, 0, 0, 0, 0, 1, ringR, slices, false);
    return concat([cap, base]);
}

const ICO_BASE = [
    [-1, 0, 0], [1, 0, 0], [-1, 0, 0], [1, 0, 0],
    [0, -1, 0], [0, 1, 0], [0, -1, 0], [0, 1, 0],
    [0, 0, -1], [0, 0, 1], [0, 0, -1], [0, 0, 1],
];
const ICO_FACES = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

/** Geodesic sphere: an icosahedron midpoint-subdivided and projected onto the sphere. */
export function icosphere(radius: number, cx: number, cy: number, cz: number,
                          subdiv: number): MeshData {
    const t = fround((1.0 + Math.sqrt(5.0)) / 2.0);
    // The base icosahedron's 12 vertices, in the reference's order.
    const base: number[][] = [
        [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
        [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
        [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ];
    const dirs: number[][] = [];
    for (const v of base) {
        const len = fround(Math.sqrt(fa(fa(fm(v[0], v[0]), fm(v[1], v[1])), fm(v[2], v[2]))));
        dirs.push([fround(v[0] / len), fround(v[1] / len), fround(v[2] / len)]);
    }
    let tris: number[][] = ICO_FACES.map((f) => [f[0], f[1], f[2]]);
    const mid = new Map<number, number>();
    const icoMid = (i: number, j: number): number => {
        // Unordered edge key. JS numbers hold this exactly for vertex counts below 2^26.
        const key = i < j ? i * 67108864 + j : j * 67108864 + i;
        const e = mid.get(key);
        if (e !== undefined) {
            return e;
        }
        const a = dirs[i];
        const b = dirs[j];
        const mx = fm(fa(a[0], b[0]), 0.5);
        const my = fm(fa(a[1], b[1]), 0.5);
        const mz = fm(fa(a[2], b[2]), 0.5);
        const len = fround(Math.sqrt(fa(fa(fm(mx, mx), fm(my, my)), fm(mz, mz))));
        const idx = dirs.length;
        dirs.push([fround(mx / len), fround(my / len), fround(mz / len)]);
        mid.set(key, idx);
        return idx;
    };
    for (let s = 0; s < subdiv; s++) {
        const next: number[][] = [];
        for (const tr of tris) {
            const a = icoMid(tr[0], tr[1]);
            const b = icoMid(tr[1], tr[2]);
            const c = icoMid(tr[2], tr[0]);
            next.push([tr[0], a, c], [tr[1], b, a], [tr[2], c, b], [a, b, c]);
        }
        tris = next;
    }
    const nv = dirs.length;
    const verts = new Float32Array(nv * 3);
    const normals = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) {
        const d = dirs[i];
        verts[i * 3] = fa(cx, fm(radius, d[0]));
        verts[i * 3 + 1] = fa(cy, fm(radius, d[1]));
        verts[i * 3 + 2] = fa(cz, fm(radius, d[2]));
        normals[i * 3] = d[0];
        normals[i * 3 + 1] = d[1];
        normals[i * 3 + 2] = d[2];
    }
    const indices = new Int32Array(tris.length * 3);
    let k = 0;
    for (const tr of tris) {
        indices[k++] = tr[0]; indices[k++] = tr[1]; indices[k++] = tr[2];
    }
    return { verts, normals, indices, uv: null };
}

/**
 * Revolve a 2D profile (r,y pairs) around the Y axis. Per-vertex normals come from the profile's
 * 2D outward normal rotated around the axis, so the surface shades smoothly; a profile point at
 * r = 0 collapses its ring to a point (a closed tip).
 */
export function lathe(profile: Float32Array | number[], cx: number, cy: number, cz: number,
                      seg: number): MeshData {
    const nProf = Math.floor(profile.length / 2);
    if (nProf < 2) {
        throw new Error('MeshPrimitive lathe: need >= 2 profile points');
    }
    const cols = seg + 1;   // duplicate the seam column for clean normals
    const nv = nProf * cols;
    const verts = new Float32Array(nv * 3);
    const normals = new Float32Array(nv * 3);

    const pnr = new Float32Array(nProf);
    const pny = new Float32Array(nProf);
    for (let e = 0; e < nProf - 1; e++) {
        const dr = fround(profile[(e + 1) * 2] - profile[e * 2]);
        const dy = fround(profile[(e + 1) * 2 + 1] - profile[e * 2 + 1]);
        let nr = dy;        // outward perpendicular of the (dr,dy) edge
        let ny = -dr;
        const len = fround(Math.sqrt(fa(fm(nr, nr), fm(ny, ny))));
        if (len > 1e-9) {
            nr = fround(nr / len);
            ny = fround(ny / len);
        }
        pnr[e] = fa(pnr[e], nr);
        pny[e] = fa(pny[e], ny);
        pnr[e + 1] = fa(pnr[e + 1], nr);
        pny[e + 1] = fa(pny[e + 1], ny);
    }
    for (let i = 0; i < nProf; i++) {
        const len = fround(Math.sqrt(fa(fm(pnr[i], pnr[i]), fm(pny[i], pny[i]))));
        if (len > 1e-9) {
            pnr[i] = fround(pnr[i] / len);
            pny[i] = fround(pny[i] / len);
        } else {
            pnr[i] = 1;
            pny[i] = 0;
        }
    }
    for (let i = 0; i < nProf; i++) {
        const r = profile[i * 2];
        const y = profile[i * 2 + 1];
        for (let j = 0; j <= seg; j++) {
            const phi = 2.0 * Math.PI * j / seg;
            const c = fround(Math.cos(phi));
            const s = fround(Math.sin(phi));
            const idx = (i * cols + j) * 3;
            verts[idx] = fa(cx, fm(r, c));
            verts[idx + 1] = fa(cy, y);
            verts[idx + 2] = fa(cz, fm(r, s));
            normals[idx] = fm(pnr[i], c);
            normals[idx + 1] = pny[i];
            normals[idx + 2] = fm(pnr[i], s);
        }
    }
    const indices = new Int32Array((nProf - 1) * seg * 6);
    let k = 0;
    for (let i = 0; i < nProf - 1; i++) {
        for (let j = 0; j < seg; j++) {
            const a = i * cols + j;
            const b = i * cols + j + 1;
            const c = (i + 1) * cols + j;
            const d = (i + 1) * cols + j + 1;
            // edge0 = around the revolution, edge1 = along the profile, diagonal last.
            indices[k++] = b; indices[k++] = a; indices[k++] = c;
            indices[k++] = c; indices[k++] = d; indices[k++] = b;
        }
    }
    return { verts, normals, indices, uv: null };
}

// ---- extruded 2D shapes ----------------------------------------------------

function setSideVert(verts: Float32Array, normals: Float32Array, i: number,
                     x: number, y: number, z: number, nx: number, ny: number): void {
    const p = i * 3;
    verts[p] = x; verts[p + 1] = y; verts[p + 2] = z;
    normals[p] = nx; normals[p + 1] = ny;
}

/**
 * Extrude a 2D profile along Z: a front cap (+Z), a back cap (-Z), and a side wall swept along
 * the closed boundary. `capTris` is wound CCW seen from +Z; `loop` is CCW with material on the
 * left, so the wall normal is the right of travel.
 */
function extrude(poly2D: Float32Array, capTris: Int32Array, loop: Int32Array,
                 depth: number, cx: number, cy: number, cz: number): MeshData {
    const np = poly2D.length / 2;
    const hd = fm(depth, 0.5);
    const le = loop.length;
    const vcount = np * 2 + le * 4;
    const verts = new Float32Array(vcount * 3);
    const normals = new Float32Array(vcount * 3);
    for (let i = 0; i < np; i++) {
        const x = poly2D[i * 2];
        const y = poly2D[i * 2 + 1];
        const f = i * 3;
        verts[f] = fa(cx, x); verts[f + 1] = fa(cy, y); verts[f + 2] = fa(cz, hd);
        normals[f + 2] = 1;
        const b = (np + i) * 3;
        verts[b] = fa(cx, x); verts[b + 1] = fa(cy, y); verts[b + 2] = fround(cz - hd);
        normals[b + 2] = -1;
    }
    const indices = new Int32Array(capTris.length * 2 + le * 6);
    let io = 0;
    for (let t = 0; t < capTris.length; t += 3) {          // front cap
        indices[io++] = capTris[t];
        indices[io++] = capTris[t + 1];
        indices[io++] = capTris[t + 2];
    }
    for (let t = 0; t < capTris.length; t += 3) {          // back cap, reversed
        indices[io++] = np + capTris[t];
        indices[io++] = np + capTris[t + 2];
        indices[io++] = np + capTris[t + 1];
    }
    const sideBase = np * 2;
    for (let e = 0; e < le; e++) {
        const ia = loop[e];
        const ib = loop[(e + 1) % le];
        const ax = poly2D[ia * 2], ay = poly2D[ia * 2 + 1];
        const bx = poly2D[ib * 2], by = poly2D[ib * 2 + 1];
        const dx = fround(bx - ax);
        const dy = fround(by - ay);
        let nx = dy;
        let ny = -dx;
        const len = fround(Math.sqrt(fa(fm(nx, nx), fm(ny, ny))));
        if (len > 1e-9) {
            nx = fround(nx / len);
            ny = fround(ny / len);
        }
        const base = sideBase + e * 4;      // 0=front_a 1=front_b 2=back_a 3=back_b
        setSideVert(verts, normals, base, fa(cx, ax), fa(cy, ay), fa(cz, hd), nx, ny);
        setSideVert(verts, normals, base + 1, fa(cx, bx), fa(cy, by), fa(cz, hd), nx, ny);
        setSideVert(verts, normals, base + 2, fa(cx, ax), fa(cy, ay), fround(cz - hd), nx, ny);
        setSideVert(verts, normals, base + 3, fa(cx, bx), fa(cy, by), fround(cz - hd), nx, ny);
        indices[io++] = base; indices[io++] = base + 2; indices[io++] = base + 3;
        indices[io++] = base; indices[io++] = base + 3; indices[io++] = base + 1;
    }
    return { verts, normals, indices, uv: null };
}

/** Extruded disk (a coin). */
export function extrudeCircle(radius: number, depth: number,
                              cx: number, cy: number, cz: number, sides: number): MeshData {
    const poly = new Float32Array((sides + 1) * 2);
    for (let j = 0; j < sides; j++) {
        const phi = 2.0 * Math.PI * j / sides;
        poly[j * 2] = fm(radius, fround(Math.cos(phi)));
        poly[j * 2 + 1] = fm(radius, fround(Math.sin(phi)));
    }
    const center = sides;    // (0,0), already zero
    const cap = new Int32Array(sides * 3);
    const loop = new Int32Array(sides);
    let k = 0;
    for (let j = 0; j < sides; j++) {
        const j1 = (j + 1) % sides;
        cap[k++] = center; cap[k++] = j; cap[k++] = j1;
        loop[j] = j;
    }
    return extrude(poly, cap, loop, depth, cx, cy, cz);
}

/** Extruded pie slice, fan apex at the centre. */
export function extrudeSector(radius: number, a0: number, sweepA: number, depth: number,
                              cx: number, cy: number, cz: number, n: number): MeshData {
    const poly = new Float32Array((n + 2) * 2);     // index 0 = centre, 1..n+1 = arc
    for (let k = 0; k <= n; k++) {
        const phi = a0 + sweepA * k / n;
        poly[(1 + k) * 2] = fm(radius, fround(Math.cos(phi)));
        poly[(1 + k) * 2 + 1] = fm(radius, fround(Math.sin(phi)));
    }
    const cap = new Int32Array(n * 3);
    let m = 0;
    for (let k = 0; k < n; k++) {
        cap[m++] = 0; cap[m++] = 1 + k; cap[m++] = 2 + k;
    }
    const loop = new Int32Array(n + 2);
    loop[0] = 0;
    for (let k = 0; k <= n; k++) {
        loop[1 + k] = 1 + k;
    }
    return extrude(poly, cap, loop, depth, cx, cy, cz);
}

/** Extruded circular segment (the region between an arc and its chord). */
export function extrudeSegment(radius: number, a0: number, sweepA: number, depth: number,
                               cx: number, cy: number, cz: number, n: number): MeshData {
    const poly = new Float32Array((n + 1) * 2);
    for (let k = 0; k <= n; k++) {
        const phi = a0 + sweepA * k / n;
        poly[k * 2] = fm(radius, fround(Math.cos(phi)));
        poly[k * 2 + 1] = fm(radius, fround(Math.sin(phi)));
    }
    const cap = new Int32Array(Math.max(0, n - 1) * 3);
    let m = 0;
    for (let k = 1; k < n; k++) {
        cap[m++] = 0; cap[m++] = k; cap[m++] = k + 1;
    }
    const loop = new Int32Array(n + 1);
    for (let k = 0; k <= n; k++) {
        loop[k] = k;
    }
    return extrude(poly, cap, loop, depth, cx, cy, cz);
}

/** Extruded annular sector (a curved bar / ring slice). */
export function extrudeArc(r0: number, r1: number, a0: number, sweepA: number, depth: number,
                           cx: number, cy: number, cz: number, n: number): MeshData {
    const inner = n + 1;
    const poly = new Float32Array((2 * (n + 1)) * 2);
    for (let k = 0; k <= n; k++) {
        const phi = a0 + sweepA * k / n;
        const c = fround(Math.cos(phi));
        const s = fround(Math.sin(phi));
        poly[k * 2] = fm(r1, c);
        poly[k * 2 + 1] = fm(r1, s);
        const ii = inner + k;
        poly[ii * 2] = fm(r0, c);
        poly[ii * 2 + 1] = fm(r0, s);
    }
    const cap = new Int32Array(n * 2 * 3);
    let m = 0;
    for (let k = 0; k < n; k++) {
        const o0 = k, o1 = k + 1, i0 = inner + k, i1 = inner + k + 1;
        cap[m++] = o0; cap[m++] = o1; cap[m++] = i1;
        cap[m++] = o0; cap[m++] = i1; cap[m++] = i0;
    }
    const loop = new Int32Array(2 * (n + 1));
    let li = 0;
    for (let k = 0; k <= n; k++) {
        loop[li++] = k;
    }
    for (let k = n; k >= 0; k--) {
        loop[li++] = inner + k;
    }
    return extrude(poly, cap, loop, depth, cx, cy, cz);
}

/** Extruded rounded rectangle. */
export function extrudeRoundedRect(width: number, height: number, cr: number, depth: number,
                                   cx: number, cy: number, cz: number, cseg: number): MeshData {
    const hw = fm(width, 0.5);
    const hh = fm(height, 0.5);
    cr = clampF(cr, 0, Math.min(hw, hh));
    const ix = fround(hw - cr);
    const iy = fround(hh - cr);
    const ccx = [ix, ix, -ix, -ix];
    const ccy = [-iy, iy, iy, -iy];
    const startA = [-fround(Math.PI / 2), 0, fround(Math.PI / 2), fround(Math.PI)];
    const per = cseg + 1;
    const pcount = 4 * per;
    const poly = new Float32Array((pcount + 1) * 2);   // perimeter + centre
    let pi = 0;
    for (let corner = 0; corner < 4; corner++) {
        for (let s = 0; s <= cseg; s++) {
            const ang = startA[corner] + (Math.PI / 2) * s / cseg;
            poly[pi * 2] = fa(ccx[corner], fm(cr, fround(Math.cos(ang))));
            poly[pi * 2 + 1] = fa(ccy[corner], fm(cr, fround(Math.sin(ang))));
            pi++;
        }
    }
    const center = pcount;
    const cap = new Int32Array(pcount * 3);
    const loop = new Int32Array(pcount);
    let k = 0;
    for (let j = 0; j < pcount; j++) {
        const j1 = (j + 1) % pcount;
        cap[k++] = center; cap[k++] = j; cap[k++] = j1;
        loop[j] = j;
    }
    return extrude(poly, cap, loop, depth, cx, cy, cz);
}

/** Extruded squircle (superellipse |x/R|^n + |y/R|^n = 1). */
export function extrudeSquircle(radius: number, exponent: number, depth: number,
                                cx: number, cy: number, cz: number, samples: number): MeshData {
    const e = exponent <= 0 ? 4 : exponent;
    const p2 = fround(2 / e);
    const poly = new Float32Array((samples + 1) * 2);
    for (let j = 0; j < samples; j++) {
        const phi = 2.0 * Math.PI * j / samples;
        const ct = fround(Math.cos(phi));
        const st = fround(Math.sin(phi));
        poly[j * 2] = fm(fm(radius, Math.sign(ct)), fround(Math.pow(Math.abs(ct), p2)));
        poly[j * 2 + 1] = fm(fm(radius, Math.sign(st)), fround(Math.pow(Math.abs(st), p2)));
    }
    const center = samples;
    const cap = new Int32Array(samples * 3);
    const loop = new Int32Array(samples);
    let k = 0;
    for (let j = 0; j < samples; j++) {
        const j1 = (j + 1) % samples;
        cap[k++] = center; cap[k++] = j; cap[k++] = j1;
        loop[j] = j;
    }
    return extrude(poly, cap, loop, depth, cx, cy, cz);
}


// ---- tube family -----------------------------------------------------------

/**
 * Sweep a tube along a centreline with unit tangents and a per-ring radius. A
 * parallel-transport frame (carry u forward, re-orthogonalize against each new tangent) places
 * a `sides`-gon ring normal to the tangent at each sample, avoiding the spin a naive
 * recomputed basis would introduce. `capped` adds end disks sized by the end radii.
 */
function buildTubeFromCenterline(px: Float32Array, py: Float32Array, pz: Float32Array,
                                 tx: Float32Array, ty: Float32Array, tz: Float32Array,
                                 radii: Float32Array, n: number, sides: number,
                                 capped: boolean): MeshData {
    const u = new Float32Array(3);
    const vv = new Float32Array(3);
    perpBasis(tx[0], ty[0], tz[0], u, vv);
    const verts = new Float32Array(n * (sides + 1) * 3);
    const normals = new Float32Array(n * (sides + 1) * 3);
    for (let i = 0; i < n; i++) {
        if (i > 0) {
            const dot = fa(fa(fm(u[0], tx[i]), fm(u[1], ty[i])), fm(u[2], tz[i]));
            u[0] = fround(u[0] - fm(dot, tx[i]));
            u[1] = fround(u[1] - fm(dot, ty[i]));
            u[2] = fround(u[2] - fm(dot, tz[i]));
            const ul = fround(Math.sqrt(fa(fa(fm(u[0], u[0]), fm(u[1], u[1])), fm(u[2], u[2]))));
            if (ul < 1e-6) {
                perpBasis(tx[i], ty[i], tz[i], u, vv);
            } else {
                u[0] = fround(u[0] / ul);
                u[1] = fround(u[1] / ul);
                u[2] = fround(u[2] / ul);
                cross(tx[i], ty[i], tz[i], u[0], u[1], u[2], vv);
            }
        }
        for (let j = 0; j <= sides; j++) {
            const phi = 2.0 * Math.PI * j / sides;
            const c = fround(Math.cos(phi));
            const s = fround(Math.sin(phi));
            const dx = fa(fm(c, u[0]), fm(s, vv[0]));
            const dy = fa(fm(c, u[1]), fm(s, vv[1]));
            const dz = fa(fm(c, u[2]), fm(s, vv[2]));
            const p = (i * (sides + 1) + j) * 3;
            const ri = radii[i];
            verts[p] = fa(px[i], fm(ri, dx));
            verts[p + 1] = fa(py[i], fm(ri, dy));
            verts[p + 2] = fa(pz[i], fm(ri, dz));
            normals[p] = dx; normals[p + 1] = dy; normals[p + 2] = dz;
        }
    }
    const cols = sides + 1;
    const indices = new Int32Array((n - 1) * sides * 6);
    let k = 0;
    for (let i = 0; i < n - 1; i++) {
        for (let j = 0; j < sides; j++) {
            const a = i * cols + j;
            const b = i * cols + j + 1;
            const cc = (i + 1) * cols + j;
            const d = (i + 1) * cols + j + 1;
            // edge0 = longitudinal along the path, edge1 = around the section, diagonal last.
            indices[k++] = cc; indices[k++] = a; indices[k++] = b;
            indices[k++] = b; indices[k++] = d; indices[k++] = cc;
        }
    }
    const wall: MeshData = { verts, normals, indices, uv: null };
    if (!capped) {
        return wall;
    }
    const u0 = new Float32Array(3), v0 = new Float32Array(3);
    perpBasis(tx[0], ty[0], tz[0], u0, v0);
    const u1 = new Float32Array(3), v1 = new Float32Array(3);
    perpBasis(tx[n - 1], ty[n - 1], tz[n - 1], u1, v1);
    const cap0 = disk(px[0], py[0], pz[0], u0[0], u0[1], u0[2], v0[0], v0[1], v0[2],
        radii[0], sides, true);
    const cap1 = disk(px[n - 1], py[n - 1], pz[n - 1], u1[0], u1[1], u1[2], v1[0], v1[1], v1[2],
        radii[n - 1], sides, false);
    return concat([wall, cap0, cap1]);
}

/** Chord-length-parametrized position spline; fills `knot` (strictly increasing). */
function buildPositionFit(cxp: Float32Array, cyp: Float32Array, czp: Float32Array,
                          cn: number, knot: Float64Array): MonotonicCurveFit {
    const y: Float64Array[] = [];
    for (let i = 0; i < cn; i++) {
        y.push(new Float64Array(3));
    }
    y[0][0] = cxp[0]; y[0][1] = cyp[0]; y[0][2] = czp[0];
    for (let i = 1; i < cn; i++) {
        const dx = fround(cxp[i] - cxp[i - 1]);
        const dy = fround(cyp[i] - cyp[i - 1]);
        const dz = fround(czp[i] - czp[i - 1]);
        // The reference sums the squares in *float* and only widens for the sqrt, so the knot
        // spacing carries float32 residue. Computing the sum in float64 here shifted spline
        // samples by a ULP and moved a handful of silhouette pixels.
        const d = Math.sqrt(fa(fa(fm(dx, dx), fm(dy, dy)), fm(dz, dz)));
        // A floor on the knot spacing: coincident control points would divide by zero.
        knot[i] = knot[i - 1] + Math.max(d, 1e-4);
        y[i][0] = cxp[i]; y[i][1] = cyp[i]; y[i][2] = czp[i];
    }
    return new MonotonicCurveFit(knot, y);
}

function radiusAt(radiusFit: MonotonicCurveFit | null, t: number, constRadius: number): number {
    if (radiusFit === null) {
        return constRadius;
    }
    const r = fround(radiusFit.getPosAt(t, 0));
    return r < 0 ? 0 : r;   // the monotone fit will not overshoot, but guard anyway
}

/**
 * Evaluate the spline at t: store position and the unit tangent (falling back to the previous
 * direction when the slope is degenerate). Returns w + 1.
 */
function sampleCenterline(fit: MonotonicCurveFit, t: number,
                          pos: Float32Array, slope: Float64Array,
                          px: Float32Array, py: Float32Array, pz: Float32Array,
                          tx: Float32Array, ty: Float32Array, tz: Float32Array,
                          w: number, pTx: number, pTy: number, pTz: number): number {
    fit.getPos(t, pos);
    fit.getSlope(t, slope);
    px[w] = pos[0]; py[w] = pos[1]; pz[w] = pos[2];
    const sx = fround(slope[0]);
    const sy = fround(slope[1]);
    const sz = fround(slope[2]);
    const l = fround(Math.sqrt(fa(fa(fm(sx, sx), fm(sy, sy)), fm(sz, sz))));
    if (l < 1e-6) {
        tx[w] = pTx; ty[w] = pTy; tz[w] = pTz;
    } else {
        tx[w] = fround(sx / l); ty[w] = fround(sy / l); tz[w] = fround(sz / l);
    }
    return w + 1;
}

/**
 * Sample the centreline with an adaptive (or explicit) ring count and build the tube. The
 * adaptive count matches the lengthwise step to the cross-section edge length using the local
 * radius, so long or sharply curved spans densify automatically and the quads stay near-square.
 */
function splineSweep(fit: MonotonicCurveFit, knot: Float64Array, cn: number, sides: number,
                     capped: boolean, pathPerSpan: number,
                     radiusFit: MonotonicCurveFit | null, constRadius: number): MeshData {
    const manual = pathPerSpan > 0;
    const fixedNs = manual ? clampInt(Math.round(pathPerSpan), 1, MAX_TUBE_PER_SPAN) : 0;
    const arcSubSamples = 6;
    const perSpan = new Int32Array(cn - 1);
    let total = 1;   // + the final endpoint
    const a = new Float64Array(3);
    const b = new Float64Array(3);
    for (let i = 0; i < cn - 1; i++) {
        let ns: number;
        if (manual) {
            ns = fixedNs;
        } else {
            const k0 = knot[i];
            const k1 = knot[i + 1];
            const rMid = radiusFit !== null
                ? fround(radiusFit.getPosAt((k0 + k1) * 0.5, 0)) : constRadius;
            const step = Math.max(2.0 * Math.abs(rMid) * Math.sin(Math.PI / sides), 1e-4);
            let arc = 0.0;
            fit.getPos(k0, a);
            for (let s = 1; s <= arcSubSamples; s++) {
                fit.getPos(k0 + (k1 - k0) * s / arcSubSamples, b);
                const dx = b[0] - a[0];
                const dy = b[1] - a[1];
                const dz = b[2] - a[2];
                arc += Math.sqrt(dx * dx + dy * dy + dz * dz);
                a[0] = b[0]; a[1] = b[1]; a[2] = b[2];
            }
            ns = clampInt(Math.trunc(Math.round(arc / step)), 1, MAX_TUBE_PER_SPAN);
        }
        perSpan[i] = ns;
        total += ns;
    }
    const n = total;
    const px = new Float32Array(n), py = new Float32Array(n), pz = new Float32Array(n);
    const tx = new Float32Array(n), ty = new Float32Array(n), tz = new Float32Array(n);
    const radii = new Float32Array(n);
    const pos = new Float32Array(3);
    const slope = new Float64Array(3);
    let pTx = 0, pTy = 1, pTz = 0;
    let w = 0;
    for (let i = 0; i < cn - 1; i++) {
        const k0 = knot[i];
        const k1 = knot[i + 1];
        const ns = perSpan[i];
        for (let s = 0; s < ns; s++) {
            // Each span emits its start and interior but not its end — that is the next span's
            // start, or the final endpoint below — so rings are not duplicated at the joins.
            const t = k0 + (k1 - k0) * s / ns;
            w = sampleCenterline(fit, t, pos, slope, px, py, pz, tx, ty, tz, w, pTx, pTy, pTz);
            radii[w - 1] = radiusAt(radiusFit, t, constRadius);
            pTx = tx[w - 1]; pTy = ty[w - 1]; pTz = tz[w - 1];
        }
    }
    const tEnd = knot[cn - 1];
    w = sampleCenterline(fit, tEnd, pos, slope, px, py, pz, tx, ty, tz, w, pTx, pTy, pTz);
    radii[w - 1] = radiusAt(radiusFit, tEnd, constRadius);
    return buildTubeFromCenterline(px, py, pz, tx, ty, tz, radii, n, sides, capped);
}

/**
 * Legacy tube: parallel-transport sweep over the raw control polyline (optionally Catmull-Rom
 * densified by FLAG_SPLINE); tangents are the average of adjacent segment directions.
 */
function tubeLegacy(cxp: Float32Array, cyp: Float32Array, czp: Float32Array, cn: number,
                    radius: number, sides: number, capped: boolean, segments: number,
                    flags: number, pathPerSpan: number): MeshData {
    let px: Float32Array, py: Float32Array, pz: Float32Array;
    if ((flags & FLAG_SPLINE) !== 0) {
        const per = pathPerSpan > 0
            ? clampInt(Math.round(pathPerSpan), 1, MAX_TUBE_PER_SPAN)
            : segCount(segments, 8, 1);
        const n = (cn - 1) * per + 1;
        px = new Float32Array(n); py = new Float32Array(n); pz = new Float32Array(n);
        let w = 0;
        for (let i = 0; i < cn - 1; i++) {
            const i0 = Math.max(0, i - 1);
            const i2 = i + 1;
            const i3 = Math.min(cn - 1, i + 2);
            for (let s = 0; s < per; s++) {
                const t = fround(s / per);
                px[w] = catmull(cxp[i0], cxp[i], cxp[i2], cxp[i3], t);
                py[w] = catmull(cyp[i0], cyp[i], cyp[i2], cyp[i3], t);
                pz[w] = catmull(czp[i0], czp[i], czp[i2], czp[i3], t);
                w++;
            }
        }
        px[w] = cxp[cn - 1]; py[w] = cyp[cn - 1]; pz[w] = czp[cn - 1];
    } else {
        px = cxp; py = cyp; pz = czp;
    }
    const n = px.length;
    const tx = new Float32Array(n), ty = new Float32Array(n), tz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        let ax = 0, ay = 0, az = 0;
        if (i > 0) {
            ax = fa(ax, fround(px[i] - px[i - 1]));
            ay = fa(ay, fround(py[i] - py[i - 1]));
            az = fa(az, fround(pz[i] - pz[i - 1]));
        }
        if (i < n - 1) {
            ax = fa(ax, fround(px[i + 1] - px[i]));
            ay = fa(ay, fround(py[i + 1] - py[i]));
            az = fa(az, fround(pz[i + 1] - pz[i]));
        }
        let l = fround(Math.sqrt(fa(fa(fm(ax, ax), fm(ay, ay)), fm(az, az))));
        if (l < 1e-6) {
            ax = 0; ay = 1; az = 0; l = 1;
        }
        tx[i] = fround(ax / l); ty[i] = fround(ay / l); tz[i] = fround(az / l);
    }
    const radii = new Float32Array(n).fill(radius);
    return buildTubeFromCenterline(px, py, pz, tx, ty, tz, radii, n, sides, capped);
}

/**
 * Tube of `radius` following the points in params[1..] as x,y,z triples. By default the points
 * are fit to a monotone cubic spline and the shell is swept as rings normal to the tangent;
 * FLAG_TUBE_LEGACY selects the older parallel-transport sweep over the raw polyline.
 */
export function tube(params: Float32Array, capped: boolean, segments: number,
                     flags: number): MeshData {
    const radius = params[0];
    // FLAG_TUBE_PATH_DENSITY inserts an explicit "rings per span" float at params[1], so the
    // points then start at params[2]. <= 0 means adaptive.
    const manualDensity = (flags & FLAG_TUBE_PATH_DENSITY) !== 0;
    const off = manualDensity ? 2 : 1;
    const pathPerSpan = manualDensity ? params[1] : 0;
    const cn = Math.floor((params.length - off) / 3);
    if (cn < 2) {
        throw new Error('MeshPrimitive tube: need >= 2 points');
    }
    const cxp = new Float32Array(cn), cyp = new Float32Array(cn), czp = new Float32Array(cn);
    for (let i = 0; i < cn; i++) {
        cxp[i] = params[off + i * 3];
        cyp[i] = params[off + i * 3 + 1];
        czp[i] = params[off + i * 3 + 2];
    }
    const sides = segCount(segments, DEFAULT_TUBE_SIDES, 3);
    if ((flags & FLAG_TUBE_LEGACY) !== 0) {
        return tubeLegacy(cxp, cyp, czp, cn, radius, sides, capped, segments, flags, pathPerSpan);
    }
    const knot = new Float64Array(cn);
    const fit = buildPositionFit(cxp, cyp, czp, cn, knot);
    return splineSweep(fit, knot, cn, sides, capped, pathPerSpan, null, radius);
}

/**
 * Profile tube: positions and an independent radius list are each fit to a spline, the radius
 * profile spread uniformly by path fraction, so the counts may differ and the tube can taper,
 * bulge or pinch along its length.
 *
 * Params: [nPoints, (ringsPerSpan if FLAG_TUBE_PATH_DENSITY), x0,y0,z0, ..., r0, r1, ...].
 */
export function profileTube(params: Float32Array, sides: number, flags: number): MeshData {
    const nPoints = Math.round(params[0]);
    const manualDensity = (flags & FLAG_TUBE_PATH_DENSITY) !== 0;
    const capped = (flags & FLAG_TUBE_CAP) !== 0;
    const posOff = manualDensity ? 2 : 1;
    const pathPerSpan = manualDensity ? params[1] : 0;
    if (nPoints < 2) {
        throw new Error('MeshPrimitive profile tube: need >= 2 points');
    }
    const rOff = posOff + 3 * nPoints;
    const nR = params.length - rOff;
    if (nR < 1) {
        throw new Error('MeshPrimitive profile tube: need >= 1 radius');
    }
    const cxp = new Float32Array(nPoints);
    const cyp = new Float32Array(nPoints);
    const czp = new Float32Array(nPoints);
    for (let i = 0; i < nPoints; i++) {
        cxp[i] = params[posOff + i * 3];
        cyp[i] = params[posOff + i * 3 + 1];
        czp[i] = params[posOff + i * 3 + 2];
    }
    const knot = new Float64Array(nPoints);
    const fit = buildPositionFit(cxp, cyp, czp, nPoints, knot);
    const pathLen = knot[nPoints - 1];

    let radiusFit: MonotonicCurveFit | null = null;
    if (nR >= 2) {
        const rk = new Float64Array(nR);
        const rv: Float64Array[] = [];
        for (let j = 0; j < nR; j++) {
            rk[j] = pathLen * j / (nR - 1);
            const row = new Float64Array(1);
            row[0] = params[rOff + j];
            rv.push(row);
        }
        radiusFit = new MonotonicCurveFit(rk, rv);
    }
    return splineSweep(fit, knot, nPoints, sides, capped, pathPerSpan, radiusFit, params[rOff]);
}

// ---- sweep -----------------------------------------------------------------

/**
 * Flat end cap for sweep(): a centroid fan over the cross-section ring, all normals set to the
 * face direction, with the winding chosen to agree with it (works for convex / star-convex
 * sections).
 */
function sweepCap(verts: Float32Array, normals: Float32Array, indices: Int32Array, io: number,
                  vbase: number, stationRow: number, cols: number, m: number,
                  fnx: number, fny: number, fnz: number): number {
    let ccx = 0, ccy = 0, ccz = 0;
    for (let k = 0; k < m; k++) {
        const p = (stationRow * cols + k) * 3;
        ccx = fa(ccx, verts[p]);
        ccy = fa(ccy, verts[p + 1]);
        ccz = fa(ccz, verts[p + 2]);
    }
    ccx = fround(ccx / m); ccy = fround(ccy / m); ccz = fround(ccz / m);
    const centroid = vbase;
    verts[centroid * 3] = ccx;
    verts[centroid * 3 + 1] = ccy;
    verts[centroid * 3 + 2] = ccz;
    normals[centroid * 3] = fnx;
    normals[centroid * 3 + 1] = fny;
    normals[centroid * 3 + 2] = fnz;
    for (let k = 0; k < m; k++) {
        const src = (stationRow * cols + k) * 3;
        const dst = (vbase + 1 + k) * 3;
        verts[dst] = verts[src];
        verts[dst + 1] = verts[src + 1];
        verts[dst + 2] = verts[src + 2];
        normals[dst] = fnx; normals[dst + 1] = fny; normals[dst + 2] = fnz;
    }
    const r0 = vbase + 1;
    const r1 = vbase + 1 + (1 % m);
    const ux = fround(verts[r0 * 3] - ccx);
    const uy = fround(verts[r0 * 3 + 1] - ccy);
    const uz = fround(verts[r0 * 3 + 2] - ccz);
    const wx = fround(verts[r1 * 3] - ccx);
    const wy = fround(verts[r1 * 3 + 1] - ccy);
    const wz = fround(verts[r1 * 3 + 2] - ccz);
    const gx = fround(fm(uy, wz) - fm(uz, wy));
    const gy = fround(fm(uz, wx) - fm(ux, wz));
    const gz = fround(fm(ux, wy) - fm(uy, wx));
    const flip = fa(fa(fm(gx, fnx), fm(gy, fny)), fm(gz, fnz)) < 0;
    for (let k = 0; k < m; k++) {
        const aa = vbase + 1 + k;
        const bb = vbase + 1 + ((k + 1) % m);
        indices[io++] = centroid;
        if (flip) {
            indices[io++] = bb; indices[io++] = aa;
        } else {
            indices[io++] = aa; indices[io++] = bb;
        }
    }
    return io;
}

/**
 * Sweep a 2D cross-section along a 3D path with optional per-station scale and twist.
 * Parallel-transport frames keep the section from spinning.
 * scalars = [closed, capStart, capEnd, cx, cy, cz].
 */
export function sweep(scalars: Float32Array, xsec: Float32Array, path: Float32Array,
                      scales: Float32Array | null, twists: Float32Array | null): MeshData {
    const m = Math.floor(xsec.length / 2);
    const n = Math.floor(path.length / 3);
    if (m < 2 || n < 2) {
        throw new Error(
            'MeshPrimitive sweep: need >= 2 cross-section points and >= 2 path points');
    }
    const closed = scalars.length > 0 && scalars[0] !== 0;
    const capStart = scalars.length > 1 && scalars[1] !== 0;
    const capEnd = scalars.length > 2 && scalars[2] !== 0;
    const cx = scalars.length > 3 ? scalars[3] : 0;
    const cy = scalars.length > 4 ? scalars[4] : 0;
    const cz = scalars.length > 5 ? scalars[5] : 0;

    const px = new Float32Array(n), py = new Float32Array(n), pz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        px[i] = fa(cx, path[i * 3]);
        py[i] = fa(cy, path[i * 3 + 1]);
        pz[i] = fa(cz, path[i * 3 + 2]);
    }
    const tx = new Float32Array(n), ty = new Float32Array(n), tz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - 1);
        const b = Math.min(n - 1, i + 1);
        const dx = fround(px[b] - px[a]);
        const dy = fround(py[b] - py[a]);
        const dz = fround(pz[b] - pz[a]);
        let l = fround(Math.sqrt(fa(fa(fm(dx, dx), fm(dy, dy)), fm(dz, dz))));
        if (l < 1e-9) {
            l = 1e-9;
        }
        tx[i] = fround(dx / l); ty[i] = fround(dy / l); tz[i] = fround(dz / l);
    }

    // Cross-section per-vertex 2D outward normals, averaged from adjacent edges.
    const nlx = new Float32Array(m);
    const nly = new Float32Array(m);
    const xEdges = closed ? m : m - 1;
    for (let e = 0; e < xEdges; e++) {
        const k0 = e;
        const k1 = (e + 1) % m;
        const dx = fround(xsec[k1 * 2] - xsec[k0 * 2]);
        const dy = fround(xsec[k1 * 2 + 1] - xsec[k0 * 2 + 1]);
        let ex = dy;
        let ey = -dx;
        const l = fround(Math.sqrt(fa(fm(ex, ex), fm(ey, ey))));
        if (l > 1e-9) {
            ex = fround(ex / l); ey = fround(ey / l);
        }
        nlx[k0] = fa(nlx[k0], ex); nly[k0] = fa(nly[k0], ey);
        nlx[k1] = fa(nlx[k1], ex); nly[k1] = fa(nly[k1], ey);
    }
    for (let k = 0; k < m; k++) {
        const l = fround(Math.sqrt(fa(fm(nlx[k], nlx[k]), fm(nly[k], nly[k]))));
        if (l > 1e-9) {
            nlx[k] = fround(nlx[k] / l); nly[k] = fround(nly[k] / l);
        } else {
            nlx[k] = 1; nly[k] = 0;
        }
    }

    const cols = closed ? m + 1 : m;    // duplicate the seam column when closed
    const wallV = n * cols;
    const capV = (capStart ? m + 1 : 0) + (capEnd ? m + 1 : 0);
    const verts = new Float32Array((wallV + capV) * 3);
    const normals = new Float32Array((wallV + capV) * 3);
    const wallStrips = closed ? m : m - 1;
    const wallTris = (n - 1) * wallStrips * 2;
    const capTris = (capStart ? m : 0) + (capEnd ? m : 0);
    const indices = new Int32Array((wallTris + capTris) * 3);

    const u = new Float32Array(3);
    const v = new Float32Array(3);
    perpBasis(tx[0], ty[0], tz[0], u, v);
    for (let i = 0; i < n; i++) {
        if (i > 0) {
            const dot = fa(fa(fm(u[0], tx[i]), fm(u[1], ty[i])), fm(u[2], tz[i]));
            u[0] = fround(u[0] - fm(dot, tx[i]));
            u[1] = fround(u[1] - fm(dot, ty[i]));
            u[2] = fround(u[2] - fm(dot, tz[i]));
            const ul = fround(Math.sqrt(fa(fa(fm(u[0], u[0]), fm(u[1], u[1])), fm(u[2], u[2]))));
            if (ul < 1e-6) {
                perpBasis(tx[i], ty[i], tz[i], u, v);
            } else {
                u[0] = fround(u[0] / ul);
                u[1] = fround(u[1] / ul);
                u[2] = fround(u[2] / ul);
                cross(tx[i], ty[i], tz[i], u[0], u[1], u[2], v);
            }
        }
        const s = (scales !== null && scales.length > i) ? scales[i] : 1;
        const tw = (twists !== null && twists.length > i) ? twists[i] : 0;
        const ct = fround(Math.cos(tw));
        const st = fround(Math.sin(tw));
        for (let j = 0; j < cols; j++) {
            const k = j % m;
            const lx = xsec[k * 2];
            const ly = xsec[k * 2 + 1];
            const rx = fround(fm(ct, lx) - fm(st, ly));   // twist the section in its own plane
            const ry = fa(fm(st, lx), fm(ct, ly));
            const p = (i * cols + j) * 3;
            verts[p] = fa(px[i], fm(s, fa(fm(rx, u[0]), fm(ry, v[0]))));
            verts[p + 1] = fa(py[i], fm(s, fa(fm(rx, u[1]), fm(ry, v[1]))));
            verts[p + 2] = fa(pz[i], fm(s, fa(fm(rx, u[2]), fm(ry, v[2]))));
            const nrx = fround(fm(ct, nlx[k]) - fm(st, nly[k]));
            const nry = fa(fm(st, nlx[k]), fm(ct, nly[k]));
            let nx = fa(fm(nrx, u[0]), fm(nry, v[0]));
            let ny = fa(fm(nrx, u[1]), fm(nry, v[1]));
            let nz = fa(fm(nrx, u[2]), fm(nry, v[2]));
            const nl = fround(Math.sqrt(fa(fa(fm(nx, nx), fm(ny, ny)), fm(nz, nz))));
            if (nl > 1e-9) {
                nx = fround(nx / nl); ny = fround(ny / nl); nz = fround(nz / nl);
            }
            normals[p] = nx; normals[p + 1] = ny; normals[p + 2] = nz;
        }
    }

    let io = 0;
    for (let i = 0; i < n - 1; i++) {
        for (let j = 0; j < wallStrips; j++) {
            const a = i * cols + j;
            const b = i * cols + j + 1;
            const cc = (i + 1) * cols + j;
            const d = (i + 1) * cols + j + 1;
            indices[io++] = cc; indices[io++] = a; indices[io++] = b;
            indices[io++] = b; indices[io++] = d; indices[io++] = cc;
        }
    }
    let capBase = wallV;
    if (capStart) {
        io = sweepCap(verts, normals, indices, io, capBase, 0, cols, m, -tx[0], -ty[0], -tz[0]);
        capBase += m + 1;
    }
    if (capEnd) {
        io = sweepCap(verts, normals, indices, io, capBase, n - 1, cols, m,
            tx[n - 1], ty[n - 1], tz[n - 1]);
    }
    return { verts, normals, indices, uv: null };
}

/** Coil/spring: a helical centreline swept with a circular, capped cross-section. */
export function helix(coilR: number, tubeR: number, pitch: number, turns: number,
                      cx: number, cy: number, cz: number, sides: number): MeshData {
    const perTurn = Math.max(8, sides * 2);
    const stations = Math.max(2, Math.round(perTurn * Math.abs(turns)) + 1);
    const path = new Float32Array(stations * 3);
    const totalRise = fm(pitch, turns);
    for (let i = 0; i < stations; i++) {
        const f = fround(i / (stations - 1));
        const ang = 2.0 * Math.PI * turns * f;
        path[i * 3] = fm(coilR, fround(Math.cos(ang)));
        path[i * 3 + 1] = fm(totalRise, fround(f - 0.5));   // centre the coil vertically
        path[i * 3 + 2] = fm(coilR, fround(Math.sin(ang)));
    }
    const xsec = new Float32Array(sides * 2);
    for (let k = 0; k < sides; k++) {
        const a = 2.0 * Math.PI * k / sides;
        xsec[k * 2] = fm(tubeR, fround(Math.cos(a)));
        xsec[k * 2 + 1] = fm(tubeR, fround(Math.sin(a)));
    }
    const scalars = new Float32Array([1, 1, 1, cx, cy, cz]);   // closed, both ends capped
    return sweep(scalars, xsec, path, null, null);
}

// ---- extrude path ----------------------------------------------------------

/** Signed area (shoelace); > 0 = CCW in a y-up frame. */
function signedArea(ring: Float32Array): number {
    const n = Math.floor(ring.length / 2);
    let a = 0;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        a = fa(a, fround(fm(ring[i * 2], ring[j * 2 + 1]) - fm(ring[j * 2], ring[i * 2 + 1])));
    }
    return fm(a, 0.5);
}

/** Standard ray-cast point-in-polygon. */
function pointInPolygon(ring: Float32Array, px: number, py: number): boolean {
    const n = Math.floor(ring.length / 2);
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = ring[i * 2], yi = ring[i * 2 + 1];
        const xj = ring[j * 2], yj = ring[j * 2 + 1];
        const crosses = (yi > py) !== (yj > py);
        if (crosses && px < fa(fround(fm(fround(xj - xi), fround(py - yi)) / fround(yj - yi)), xi)) {
            inside = !inside;
        }
    }
    return inside;
}

/** Even-odd hole test: a contour is a hole if it lies inside an odd number of the others. */
function isHole(contours: Float32Array[], ringIndex: number): boolean {
    const ring = contours[ringIndex];
    if (ring.length < 2) {
        return false;
    }
    const px = ring[0];
    const py = ring[1];
    let inside = 0;
    for (let c = 0; c < contours.length; c++) {
        if (c === ringIndex) {
            continue;
        }
        if (pointInPolygon(contours[c], px, py)) {
            inside++;
        }
    }
    return (inside & 1) === 1;
}

/**
 * Offset a closed contour inward by b, mitering at corners so adjacent edges share the moved
 * vertex. Insets solids and grows holes consistently (from the ring's signed-area sign);
 * miterLimit caps the corner stretch at sharp spikes.
 */
function miterInset(ring: Float32Array, b: number, miterLimit: number): Float32Array {
    const n = Math.floor(ring.length / 2);
    const out = new Float32Array(ring.length);
    const sign = signedArea(ring) >= 0 ? 1 : -1;   // +1 CCW (interior on the left)
    for (let i = 0; i < n; i++) {
        const ip = (i - 1 + n) % n;
        const inx = (i + 1) % n;
        let pdx = fround(ring[i * 2] - ring[ip * 2]);
        let pdy = fround(ring[i * 2 + 1] - ring[ip * 2 + 1]);
        let ndx = fround(ring[inx * 2] - ring[i * 2]);
        let ndy = fround(ring[inx * 2 + 1] - ring[i * 2 + 1]);
        const pl = fround(Math.sqrt(fa(fm(pdx, pdx), fm(pdy, pdy))));
        if (pl > 1e-9) {
            pdx = fround(pdx / pl); pdy = fround(pdy / pl);
        }
        const nl = fround(Math.sqrt(fa(fm(ndx, ndx), fm(ndy, ndy))));
        if (nl > 1e-9) {
            ndx = fround(ndx / nl); ndy = fround(ndy / nl);
        }
        // Inward normal toward the interior = sign * left-of-travel.
        const n1x = fm(sign, -pdy), n1y = fm(sign, pdx);
        const n2x = fm(sign, -ndy), n2y = fm(sign, ndx);
        let mx = fa(n1x, n2x);
        let my = fa(n1y, n2y);
        const ml = fround(Math.sqrt(fa(fm(mx, mx), fm(my, my))));
        if (ml < 1e-6) {
            out[i * 2] = fa(ring[i * 2], fm(b, n2x));
            out[i * 2 + 1] = fa(ring[i * 2 + 1], fm(b, n2y));
            continue;
        }
        mx = fround(mx / ml); my = fround(my / ml);
        const cos = fa(fm(mx, n1x), fm(my, n1y));
        const l = fround(b / Math.max(cos, fround(1 / miterLimit)));
        out[i * 2] = fa(ring[i * 2], fm(l, mx));
        out[i * 2 + 1] = fa(ring[i * 2 + 1], fm(l, my));
    }
    return out;
}

/**
 * Triangulate the two flat caps: a scanline / trapezoid sweep over all contour edges using the
 * nonzero-winding rule — what fonts and Path use by default. Between every pair of adjacent
 * vertex-y values the sorted edge crossings are swept left to right accumulating each edge's
 * winding direction, and the interior spans become trapezoids. This needs no ear clipping and
 * handles holes and overlapping contours for free.
 */
function scanlineCaps(contours: Float32Array[], cx: number, cy: number,
                      frontZ: number, backZ: number): MeshData {
    let edgeCount = 0;
    for (const ring of contours) {
        edgeCount += ring.length / 2;
    }
    const eYlo = new Float32Array(edgeCount);
    const eYhi = new Float32Array(edgeCount);
    const eXlo = new Float32Array(edgeCount);
    const eSlope = new Float32Array(edgeCount);
    const eDir = new Int32Array(edgeCount);
    let ne = 0;
    const ys = new Float32Array(edgeCount * 2);
    let nys = 0;
    for (const ring of contours) {
        const n = ring.length / 2;
        for (let i = 0; i < n; i++) {
            const ay = ring[i * 2 + 1];
            const j = (i + 1) % n;
            const by = ring[j * 2 + 1];
            ys[nys++] = ay;
            if (ay === by) {
                continue;       // horizontal edges contribute no crossings
            }
            const ax = ring[i * 2];
            const bx = ring[j * 2];
            if (ay < by) {
                eYlo[ne] = ay; eYhi[ne] = by; eXlo[ne] = ax;
            } else {
                eYlo[ne] = by; eYhi[ne] = ay; eXlo[ne] = bx;
            }
            eSlope[ne] = fround(fround(bx - ax) / fround(by - ay));
            eDir[ne] = (by > ay) ? 1 : -1;
            ne++;
        }
    }
    const sorted = ys.subarray(0, nys);
    sorted.sort();
    let uy = 0;
    for (let i = 0; i < nys; i++) {
        if (uy === 0 || ys[i] > fa(ys[uy - 1], 1e-7)) {
            ys[uy++] = ys[i];
        }
    }
    const traps: Float32Array[] = [];
    const crossX = new Float32Array(ne);
    const crossE = new Int32Array(ne);
    for (let s = 0; s + 1 < uy; s++) {
        const yA = ys[s];
        const yB = ys[s + 1];
        if (fround(yB - yA) < 1e-7) {
            continue;
        }
        const ymid = fm(0.5, fa(yA, yB));
        let nx = 0;
        for (let e = 0; e < ne; e++) {
            if (eYlo[e] < ymid && ymid < eYhi[e]) {
                crossX[nx] = fa(eXlo[e], fm(fround(ymid - eYlo[e]), eSlope[e]));
                crossE[nx] = e;
                nx++;
            }
        }
        if (nx < 2) {
            continue;
        }
        // Insertion sort, matching the reference — a stable order matters because equal
        // crossings decide which edge pairs into which trapezoid.
        for (let a = 1; a < nx; a++) {
            const kx = crossX[a];
            const ke = crossE[a];
            let b = a - 1;
            while (b >= 0 && crossX[b] > kx) {
                crossX[b + 1] = crossX[b];
                crossE[b + 1] = crossE[b];
                b--;
            }
            crossX[b + 1] = kx;
            crossE[b + 1] = ke;
        }
        let winding = 0;
        for (let i = 0; i + 1 < nx; i++) {
            winding += eDir[crossE[i]];
            if (winding === 0) {
                continue;
            }
            const le = crossE[i];
            const re = crossE[i + 1];
            const xLtop = fa(eXlo[le], fm(fround(yB - eYlo[le]), eSlope[le]));
            const xLbot = fa(eXlo[le], fm(fround(yA - eYlo[le]), eSlope[le]));
            const xRtop = fa(eXlo[re], fm(fround(yB - eYlo[re]), eSlope[re]));
            const xRbot = fa(eXlo[re], fm(fround(yA - eYlo[re]), eSlope[re]));
            traps.push(new Float32Array([xLtop, yB, xRtop, yB, xRbot, yA, xLbot, yA]));
        }
    }
    const t = traps.length;
    const verts = new Float32Array(t * 8 * 3);
    const normals = new Float32Array(t * 8 * 3);
    const indices = new Int32Array(t * 12);
    let io = 0;
    const backBase = t * 4;
    for (let q = 0; q < t; q++) {
        const g = traps[q];
        const fb = q * 4;
        const bb = backBase + q * 4;
        for (let j = 0; j < 4; j++) {
            const x = g[j * 2];
            const y = g[j * 2 + 1];
            const f = (fb + j) * 3;
            verts[f] = fa(cx, x); verts[f + 1] = fa(cy, y); verts[f + 2] = frontZ;
            normals[f + 2] = 1;
            const bk = (bb + j) * 3;
            verts[bk] = fa(cx, x); verts[bk + 1] = fa(cy, y); verts[bk + 2] = backZ;
            normals[bk + 2] = -1;
        }
        indices[io++] = fb; indices[io++] = fb + 2; indices[io++] = fb + 1;
        indices[io++] = fb; indices[io++] = fb + 3; indices[io++] = fb + 2;
        indices[io++] = bb; indices[io++] = bb + 1; indices[io++] = bb + 2;
        indices[io++] = bb; indices[io++] = bb + 2; indices[io++] = bb + 3;
    }
    return { verts, normals, indices, uv: null };
}

function setV(verts: Float32Array, normals: Float32Array, i: number,
              x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
    const p = i * 3;
    verts[p] = x; verts[p + 1] = y; verts[p + 2] = z;
    normals[p] = nx; normals[p + 1] = ny; normals[p + 2] = nz;
}

/**
 * Side geometry for extrudePath: one outward quad per contour edge, or — when bevelled — three
 * rings per edge (front 45-degree chamfer, straight wall shortened by 2b, back chamfer).
 * Each contour is first normalized to "material on the left" so the wall normals point outward.
 */
function extrudePathSides(contours: Float32Array[], inset: Float32Array[] | null,
                          cx: number, cy: number, cz: number, hd: number, b: number): MeshData {
    const beveled = b > 0 && inset !== null;
    const wallHd = fround(hd - b);
    const inv = 0.70710678;    // 1/sqrt(2), the 45-degree chamfer normal split
    let edgeCount = 0;
    for (const ring of contours) {
        edgeCount += ring.length / 2;
    }
    const vpe = beveled ? 12 : 4;
    const tpe = beveled ? 6 : 2;
    const verts = new Float32Array(edgeCount * vpe * 3);
    const normals = new Float32Array(edgeCount * vpe * 3);
    const indices = new Int32Array(edgeCount * tpe * 3);
    let io = 0;
    let se = 0;
    for (let c = 0; c < contours.length; c++) {
        const ring = contours[c];
        const n = ring.length / 2;
        if (n < 3) {
            se += n;
            continue;
        }
        const ins = beveled ? inset![c] : null;
        const hole = isHole(contours, c);
        const reverse = (signedArea(ring) > 0) === hole;
        for (let i = 0; i < n; i++) {
            const ia = reverse ? (n - i) % n : i;
            const ib = reverse ? (n - i - 1 + n) % n : (i + 1) % n;
            const ax = ring[ia * 2], ay = ring[ia * 2 + 1];
            const bx = ring[ib * 2], by = ring[ib * 2 + 1];
            let nx = fround(by - ay);
            let ny = -fround(bx - ax);
            const len = fround(Math.sqrt(fa(fm(nx, nx), fm(ny, ny))));
            if (len > 1e-9) {
                nx = fround(nx / len); ny = fround(ny / len);
            }
            if (!beveled) {
                const v = se * 4;
                setV(verts, normals, v, fa(cx, ax), fa(cy, ay), fa(cz, hd), nx, ny, 0);
                setV(verts, normals, v + 1, fa(cx, bx), fa(cy, by), fa(cz, hd), nx, ny, 0);
                setV(verts, normals, v + 2, fa(cx, ax), fa(cy, ay), fround(cz - hd), nx, ny, 0);
                setV(verts, normals, v + 3, fa(cx, bx), fa(cy, by), fround(cz - hd), nx, ny, 0);
                indices[io++] = v; indices[io++] = v + 2; indices[io++] = v + 3;
                indices[io++] = v; indices[io++] = v + 3; indices[io++] = v + 1;
            } else {
                const iax = ins![ia * 2], iay = ins![ia * 2 + 1];
                const ibx = ins![ib * 2], iby = ins![ib * 2 + 1];
                const v = se * 12;
                const cnx = fm(nx, inv), cny = fm(ny, inv);
                // Front chamfer: inset cap edge (+hd) to full wall top (+wallHd).
                setV(verts, normals, v, fa(cx, iax), fa(cy, iay), fa(cz, hd), cnx, cny, inv);
                setV(verts, normals, v + 1, fa(cx, ibx), fa(cy, iby), fa(cz, hd), cnx, cny, inv);
                setV(verts, normals, v + 2, fa(cx, ax), fa(cy, ay), fa(cz, wallHd), cnx, cny, inv);
                setV(verts, normals, v + 3, fa(cx, bx), fa(cy, by), fa(cz, wallHd), cnx, cny, inv);
                indices[io++] = v; indices[io++] = v + 2; indices[io++] = v + 3;
                indices[io++] = v; indices[io++] = v + 3; indices[io++] = v + 1;
                // Straight wall.
                setV(verts, normals, v + 4, fa(cx, ax), fa(cy, ay), fa(cz, wallHd), nx, ny, 0);
                setV(verts, normals, v + 5, fa(cx, bx), fa(cy, by), fa(cz, wallHd), nx, ny, 0);
                setV(verts, normals, v + 6, fa(cx, ax), fa(cy, ay), fround(cz - wallHd), nx, ny, 0);
                setV(verts, normals, v + 7, fa(cx, bx), fa(cy, by), fround(cz - wallHd), nx, ny, 0);
                indices[io++] = v + 4; indices[io++] = v + 6; indices[io++] = v + 7;
                indices[io++] = v + 4; indices[io++] = v + 7; indices[io++] = v + 5;
                // Back chamfer.
                setV(verts, normals, v + 8, fa(cx, ax), fa(cy, ay), fround(cz - wallHd),
                    cnx, cny, -inv);
                setV(verts, normals, v + 9, fa(cx, bx), fa(cy, by), fround(cz - wallHd),
                    cnx, cny, -inv);
                setV(verts, normals, v + 10, fa(cx, iax), fa(cy, iay), fround(cz - hd),
                    cnx, cny, -inv);
                setV(verts, normals, v + 11, fa(cx, ibx), fa(cy, iby), fround(cz - hd),
                    cnx, cny, -inv);
                indices[io++] = v + 8; indices[io++] = v + 10; indices[io++] = v + 11;
                indices[io++] = v + 8; indices[io++] = v + 11; indices[io++] = v + 9;
            }
            se++;
        }
    }
    return { verts, normals, indices, uv: null };
}

/**
 * Extrude an arbitrary 2D path — the general case, which unlike the analytic extrudes can be
 * concave and can contain holes (the counters of e, o, d) or overlapping contours.
 *
 * Params: [depth, cx, cy, cz, bevel, contourCount, (count, x0,y0, x1,y1, ...)*] — closed
 * contours with no repeated closing point. bevel > 0 chamfers the cap-to-wall edge.
 */
export function extrudePath(p: Float32Array): MeshData {
    const depth = p[0];
    const cx = p[1];
    const cy = p[2];
    const cz = p[3];
    const bevel = p[4];
    const nc = Math.round(p[5]);
    const contours: Float32Array[] = [];
    let idx = 6;
    for (let c = 0; c < nc; c++) {
        const cnt = Math.round(p[idx++]);
        const ring = new Float32Array(cnt * 2);
        for (let k = 0; k < cnt * 2 && idx < p.length; k++) {
            ring[k] = p[idx++];
        }
        contours.push(ring);
    }
    const hd = fm(depth, 0.5);

    if (bevel <= 0) {
        // Sharp (default): flat caps over the full contours plus straight walls. The bevel path
        // below is skipped entirely, so it costs nothing.
        const caps = scanlineCaps(contours, cx, cy, fa(cz, hd), fround(cz - hd));
        const sides = extrudePathSides(contours, null, cx, cy, cz, hd, 0);
        return concat([caps, sides]);
    }
    const b = Math.min(bevel, fm(hd, 0.9));
    const inset: Float32Array[] = contours.map((ring) => miterInset(ring, b, 4));
    const caps = scanlineCaps(inset, cx, cy, fa(cz, hd), fround(cz - hd));
    const sides = extrudePathSides(contours, inset, cx, cy, cz, hd, b);
    return concat([caps, sides]);
}

// ---- dispatch --------------------------------------------------------------

/**
 * Dispatch a (type, segments, flags, data) tuple to the matching builder. `segments` is the
 * primary division count; <= 0 means "the type's default". `data[0]` is the scalar params;
 * channels 1+ carry geometry streams for the multi-channel types.
 */
export function build(type: number, segments: number, flags: number,
                      data: Float32Array[]): MeshData {
    const p = data[0];
    const uvm = uvMode(flags);
    switch (type) {
        case SPHERE: {
            const slices = segCount(segments, DEFAULT_RADIAL, 3);
            const stacks = Math.max(2, Math.round(slices * 0.5));
            return sphere(p[0], p[1], p[2], p[3], slices, stacks, uvm);
        }
        case CYLINDER:
            return cylinder(p[0], p[1], p[2], p[3], p[4], p[5], p[6],
                segCount(segments, DEFAULT_RADIAL, 3));
        case CONE:
            return cone(p[0], p[1], p[2], p[3], p[4], segCount(segments, DEFAULT_RADIAL, 3));
        case CUBE:
            return cube(p[0], p[1], p[2], p[3], p[4], p[5], uvm);
        case ROUNDED_CUBE:
            return roundedCube(p[0], p[1], p[2], p[3], p[4], p[5], p[6],
                segCount(segments, DEFAULT_ROUND_SEG, 1));
        case SPHERICAL_SECTOR: {
            const slices = segCount(segments, DEFAULT_RADIAL, 3);
            const stacks = Math.max(2, Math.round(slices / 3));
            return sphericalSector(p[0], p[1], p[2], p[3], p[4], slices, stacks);
        }
        case SPHERICAL_DOME: {
            const slices = segCount(segments, DEFAULT_RADIAL, 3);
            const stacks = Math.max(2, Math.round(slices / 3));
            return sphericalDome(p[0], p[1], p[2], p[3], p[4], slices, stacks);
        }
        case TUBE:
            return tube(p, false, segments, flags);
        case CAP_TUBE:
            return tube(p, true, segments, flags);
        case PROFILE_TUBE:
            return profileTube(p, segCount(segments, DEFAULT_TUBE_SIDES, 3), flags);
        case EXTRUDE_PATH:
            return extrudePath(p);
        case SWEEP:
            // data[0]=[closed,capStart,capEnd,cx,cy,cz]; [1]=cross-section; [2]=path;
            // [3]=per-station scale (optional); [4]=per-station twist (optional).
            return sweep(p, data.length > 1 ? data[1] : new Float32Array(0),
                data.length > 2 ? data[2] : new Float32Array(0),
                data.length > 3 ? data[3] : null,
                data.length > 4 ? data[4] : null);
        case HELIX:
            return helix(p[0], p[1], p[2], p[3],
                p.length > 4 ? p[4] : 0, p.length > 5 ? p[5] : 0, p.length > 6 ? p[6] : 0,
                segCount(segments, 12, 3));
        case TORUS: {
            const majorR = p[0];
            const minorR = p[1];
            const majorSeg = segCount(segments, DEFAULT_RADIAL, 3);
            // Minor segments scale with the radius ratio so the quads stay roughly square.
            const ratio = Math.abs(majorR) > 1e-6 ? Math.abs(minorR / majorR) : 0.5;
            const minorSeg = Math.max(3, Math.round(majorSeg * ratio));
            return torus(majorR, minorR, p[2], p[3], p[4], majorSeg, minorSeg, uvm);
        }
        case PLANE:
            return plane(p[0], p[1], p[2], p[3], p[4], uvm);
        case EXTRUDE_CIRCLE:
            return extrudeCircle(p[0], p[1], p[2], p[3], p[4],
                segCount(segments, DEFAULT_RADIAL, 3));
        case EXTRUDE_SECTOR:
            return extrudeSector(p[0], p[1], p[2], p[3], p[4], p[5], p[6],
                segCount(segments, DEFAULT_RADIAL, 1));
        case EXTRUDE_SEGMENT:
            return extrudeSegment(p[0], p[1], p[2], p[3], p[4], p[5], p[6],
                segCount(segments, DEFAULT_RADIAL, 1));
        case EXTRUDE_ARC:
            return extrudeArc(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7],
                segCount(segments, DEFAULT_RADIAL, 1));
        case EXTRUDE_ROUNDED_RECT:
            return extrudeRoundedRect(p[0], p[1], p[2], p[3], p[4], p[5], p[6],
                segCount(segments, 6, 1));
        case EXTRUDE_SQUIRCLE:
            return extrudeSquircle(p[0], p[1], p[2], p[3], p[4], p[5],
                segCount(segments, 48, 8));
        case LATHE:
            return lathe(data.length > 1 ? data[1] : new Float32Array(0),
                p.length > 0 ? p[0] : 0, p.length > 1 ? p[1] : 0, p.length > 2 ? p[2] : 0,
                segCount(segments, DEFAULT_RADIAL, 3));
        case ICOSPHERE:
            return icosphere(p[0], p.length > 1 ? p[1] : 0, p.length > 2 ? p[2] : 0,
                p.length > 3 ? p[3] : 0,
                Math.max(0, Math.min(4, segments > 0 ? Math.round(segments) : 2)));
        default:
            throw new Error(`MeshPrimitive: unknown type ${type}`);
    }
}
