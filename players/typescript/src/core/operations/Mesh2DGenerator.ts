// Mesh2DGenerator: the geometry shared by every 2D vertex mesh.
//
// Ported from androidx remote-core operations/utilities/Mesh2DGenerator.java (2026-09). The
// generated vertices are part of the contract, not an implementation detail: a document is
// authored against one player and drawn on another, so these have to match the reference for
// the same input rather than merely look similar.

export const LAYOUT_GRID = 0;
export const LAYOUT_POLAR = 1;
export const LAYOUT_RING = 2;
export const LAYOUT_STRIP = 3;
export const LAYOUT_FAN = 4;
export const LAYOUT_PATH_STRIP = 5;

export const TYPE_EXPRESSION = 0;
export const TYPE_VALUES = 1;
export const TYPE_F16_VALUES = 2;
export const TYPE_PATH_SPLINE_STRIP = 3;
export const TYPE_SPLINE_ROUND_STRIP = 4;

export const BLEND_COLORS_ONLY = 0;
export const BLEND_MODULATE = 1;
export const NO_IMAGE = 0;

export const FLAG_ORIGIN = 0;
export const FLAG_ROTATION = 1;
export const FLAG_SCALE = 2;
export const FLAG_FULL = 3;

export const EXPRESSION_GROUPS = 9;
export const EXP_X = 0, EXP_Y = 1, EXP_TEX_U = 2, EXP_TEX_V = 3;
export const EXP_COLOR_A = 4, EXP_COLOR_R = 5, EXP_COLOR_G = 6, EXP_COLOR_B = 7;
export const EXP_WIDTH = 8;

export const MIN_ROUND_CAP_SEGMENTS = 3;
export const MAX_ROUND_CAP_SEGMENTS = 16;
const DEFAULT_RING_INNER_RADIUS = 0.5;
const TWO_PI = 6.2831855;
const HALF_PI = 1.5707964;
const DEGENERATE_EPSILON = 1e-6;

// Limits.java, mirrored so a malformed document is refused rather than allocating wildly.
export const MAX_MESH_2D_VERTICES = 16384;
export const MAX_MESH_2D_INDICES = 49152;
export const MAX_MESH_2D_GRID = 16384;

export function wrapsU(layout: number): boolean {
    return layout === LAYOUT_POLAR || layout === LAYOUT_RING || layout === LAYOUT_FAN;
}

export function vertexCount(layout: number, uCount: number, vCount: number): number {
    if (layout === LAYOUT_FAN) return uCount + 1;   // shared centre plus a rim
    return uCount * vCount;
}

export function indexCount(layout: number, uCount: number, vCount: number): number {
    if (layout === LAYOUT_FAN) return uCount * 3;
    if (vCount < 2 || uCount < 2) return 0;
    const columns = wrapsU(layout) ? uCount : uCount - 1;
    return columns * (vCount - 1) * 6;
}

// A wrapping layout divides by uCount so the sample after the last is the first; a
// non-wrapping one divides by uCount-1 so the domain is closed at both ends.
export function domainU(layout: number, i: number, uCount: number): number {
    if (uCount <= 1) return 0;
    if (wrapsU(layout)) return i / uCount;
    return i / (uCount - 1);
}

export function domainV(j: number, vCount: number): number {
    if (vCount <= 1) return 0;
    return j / (vCount - 1);
}

export function generateIndices(layout: number, uCount: number,
                                vCount: number): Int32Array<ArrayBuffer> {
    const out = new Int32Array(Math.max(0, indexCount(layout, uCount, vCount)));
    let k = 0;
    if (layout === LAYOUT_FAN) {
        for (let i = 0; i < uCount; i++) {         // vertex 0 is the centre
            out[k++] = 0;
            out[k++] = 1 + i;
            out[k++] = 1 + ((i + 1) % uCount);
        }
        return out;
    }
    if (vCount < 2 || uCount < 2) return out;
    const wrap = wrapsU(layout);
    const columns = wrap ? uCount : uCount - 1;
    for (let j = 0; j < vCount - 1; j++) {
        for (let i = 0; i < columns; i++) {
            const i1 = wrap ? (i + 1) % uCount : i + 1;
            const topLeft = j * uCount + i;
            const topRight = j * uCount + i1;
            const bottomLeft = (j + 1) * uCount + i;
            const bottomRight = (j + 1) * uCount + i1;
            out[k++] = topLeft;  out[k++] = bottomLeft; out[k++] = topRight;
            out[k++] = topRight; out[k++] = bottomLeft; out[k++] = bottomRight;
        }
    }
    return out;
}

// Every default lives in the unit square or unit circle at the origin; the canvas matrix is
// what places and sizes it. This is what makes `layout: polar` useful without the author
// spending scarce expression tokens on trigonometry.
export function defaultPosition(layout: number, u: number, v: number, out: Float32Array): void {
    switch (layout) {
        case LAYOUT_POLAR:
        case LAYOUT_FAN: {
            const angle = u * TWO_PI;
            out[0] = v * Math.cos(angle);
            out[1] = v * Math.sin(angle);
            break;
        }
        case LAYOUT_RING: {
            const angle = u * TWO_PI;
            const radius = DEFAULT_RING_INNER_RADIUS + (1 - DEFAULT_RING_INNER_RADIUS) * v;
            out[0] = radius * Math.cos(angle);
            out[1] = radius * Math.sin(angle);
            break;
        }
        default:
            out[0] = u;
            out[1] = v;
            break;
    }
}

export function roundCapSegments(segments: number): number {
    const cap = Math.trunc(segments / 4);
    if (cap < MIN_ROUND_CAP_SEGMENTS) return MIN_ROUND_CAP_SEGMENTS;
    return Math.min(cap, MAX_ROUND_CAP_SEGMENTS);
}

const _f32 = new Float32Array(1);
const _i32 = new Int32Array(_f32.buffer);

/** Widen a 16-bit half to a float. The wire format is f16; everything above it is f32. */
export function halfToFloat(half: number): number {
    const sign = (half & 0x8000) << 16;
    const exponent = (half >> 10) & 0x1f;
    let mantissa = half & 0x3ff;
    let bits: number;
    if (exponent === 0) {
        if (mantissa === 0) {
            bits = sign;
        } else {
            let shift = 0;
            while ((mantissa & 0x400) === 0) { mantissa <<= 1; shift++; }
            mantissa &= 0x3ff;
            bits = sign | ((127 - 15 - shift) << 23) | (mantissa << 13);
        }
    } else if (exponent === 0x1f) {
        bits = sign | 0x7f800000 | (mantissa << 13);
    } else {
        bits = sign | ((exponent - 15 + 127) << 23) | (mantissa << 13);
    }
    _i32[0] = bits;
    return _f32[0];
}

// ── path flattening ─────────────────────────────────────────────────────────────────────

export const PATH_MOVE = 10, PATH_LINE = 11, PATH_QUAD = 12, PATH_CONIC = 13;
export const PATH_CUBIC = 14, PATH_CLOSE = 15, PATH_DONE = 16;
const PATH_CURVE_STEPS = 16;

export function pathNanId(v: number): number {
    _f32[0] = v;
    return _i32[0] & 0x3fffff;
}

export function isPathCommand(v: number): boolean {
    if (!Number.isNaN(v)) return false;
    const id = pathNanId(v);
    return id >= PATH_MOVE && id <= PATH_DONE;
}

/** Flatten a stored path into a polyline of x,y pairs.
 *
 * The layout is the one PathData writes: a NaN-tagged verb, then for every verb EXCEPT move
 * and close two PADDING floats, then the coordinates. The padding is easy to miss — skip it
 * only for `line` and a straight path still flattens plausibly while a curved one silently
 * reads its first control point out of the padding.
 */
export function flattenPath(data: Float32Array,
                            resolve: (v: number) => number): Float32Array<ArrayBuffer> {
    const out: number[] = [];
    let startX = 0, startY = 0, curX = 0, curY = 0, open = false;
    const push = (x: number, y: number) => {
        const n = out.length;
        if (n >= 2 && out[n - 2] === x && out[n - 1] === y) return;
        out.push(x, y);
    };

    let i = 0;
    const n = data.length;
    while (i < n) {
        if (!isPathCommand(data[i])) { i++; continue; }
        switch (pathNanId(data[i])) {
            case PATH_MOVE:
                i++;
                if (i + 1 < n) {
                    curX = startX = resolve(data[i]);
                    curY = startY = resolve(data[i + 1]);
                    push(curX, curY);
                    open = true;
                    i += 2;
                }
                break;
            case PATH_LINE:
                i += 3;                             // verb + 2 padding
                if (i + 1 < n) {
                    curX = resolve(data[i]);
                    curY = resolve(data[i + 1]);
                    push(curX, curY);
                    i += 2;
                }
                break;
            case PATH_QUAD:
                i += 3;
                if (i + 3 < n) {
                    const cx = resolve(data[i]), cy = resolve(data[i + 1]);
                    const x = resolve(data[i + 2]), y = resolve(data[i + 3]);
                    for (let s = 1; s <= PATH_CURVE_STEPS; s++) {
                        const t = s / PATH_CURVE_STEPS, mt = 1 - t;
                        push(mt * mt * curX + 2 * mt * t * cx + t * t * x,
                             mt * mt * curY + 2 * mt * t * cy + t * t * y);
                    }
                    curX = x; curY = y;
                    i += 4;
                }
                break;
            case PATH_CONIC:
                i += 3;
                if (i + 4 < n) {
                    const cx = resolve(data[i]), cy = resolve(data[i + 1]);
                    const x = resolve(data[i + 2]), y = resolve(data[i + 3]);
                    const w = resolve(data[i + 4]);
                    for (let s = 1; s <= PATH_CURVE_STEPS; s++) {
                        const t = s / PATH_CURVE_STEPS, mt = 1 - t;
                        const w0 = mt * mt, w1 = 2 * mt * t * w, w2 = t * t;
                        const denom = w0 + w1 + w2;
                        if (denom === 0) continue;
                        push((w0 * curX + w1 * cx + w2 * x) / denom,
                             (w0 * curY + w1 * cy + w2 * y) / denom);
                    }
                    curX = x; curY = y;
                    i += 5;
                }
                break;
            case PATH_CUBIC:
                i += 3;
                if (i + 5 < n) {
                    const c1x = resolve(data[i]), c1y = resolve(data[i + 1]);
                    const c2x = resolve(data[i + 2]), c2y = resolve(data[i + 3]);
                    const x = resolve(data[i + 4]), y = resolve(data[i + 5]);
                    for (let s = 1; s <= PATH_CURVE_STEPS; s++) {
                        const t = s / PATH_CURVE_STEPS, mt = 1 - t;
                        const a = mt * mt * mt, b = 3 * mt * mt * t;
                        const c = 3 * mt * t * t, d = t * t * t;
                        push(a * curX + b * c1x + c * c2x + d * x,
                             a * curY + b * c1y + c * c2y + d * y);
                    }
                    curX = x; curY = y;
                    i += 6;
                }
                break;
            case PATH_CLOSE:
                i++;
                if (open) push(startX, startY);
                curX = startX; curY = startY;
                break;
            case PATH_DONE:
            default:
                return new Float32Array(out);
        }
    }
    return new Float32Array(out);
}

/** Sample a flattened path at a fraction of arclength: out gets x, y, tangentX, tangentY. */
export function samplePolyline(poly: Float32Array, pointCount: number, fraction: number,
                               out: Float32Array): void {
    out[0] = 0; out[1] = 0; out[2] = 1; out[3] = 0;
    if (pointCount < 2) {
        if (pointCount === 1) { out[0] = poly[0]; out[1] = poly[1]; }
        return;
    }
    let total = 0;
    for (let i = 0; i + 1 < pointCount; i++) {
        const dx = poly[(i + 1) * 2] - poly[i * 2];
        const dy = poly[(i + 1) * 2 + 1] - poly[i * 2 + 1];
        total += Math.sqrt(dx * dx + dy * dy);
    }
    if (total <= 0) { out[0] = poly[0]; out[1] = poly[1]; return; }

    const target = Math.min(Math.max(fraction, 0), 1) * total;
    let walked = 0;
    for (let i = 0; i + 1 < pointCount; i++) {
        const x0 = poly[i * 2], y0 = poly[i * 2 + 1];
        const x1 = poly[(i + 1) * 2], y1 = poly[(i + 1) * 2 + 1];
        const dx = x1 - x0, dy = y1 - y0;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len <= 0) continue;
        if (walked + len >= target || i + 2 === pointCount) {
            const t = Math.min(Math.max((target - walked) / len, 0), 1);
            out[0] = x0 + dx * t;
            out[1] = y0 + dy * t;
            out[2] = dx / len;
            out[3] = dy / len;
            return;
        }
        walked += len;
    }
}

/** A point on a round end cap: direction -1 at the strip's start, +1 at its end. */
export function roundCapPoint(sample: Float32Array, halfWidth: number, t: number, v: number,
                              direction: number, out: Float32Array): void {
    const tx = sample[2] * direction, ty = sample[3] * direction;
    const nx = -sample[3], ny = sample[2];
    const angle = (1 - t) * HALF_PI;
    const along = Math.sin(angle) * halfWidth;
    const across = Math.cos(angle) * halfWidth;
    const side = (v - 0.5) * 2;
    out[0] = sample[0] + tx * along + nx * across * side;
    out[1] = sample[1] + ty * along + ny * across * side;
}

/** A monotone cubic through the width control points.
 *
 * A plain Catmull-Rom would overshoot and bulge the ribbon past the widths the author gave;
 * the Fritsch-Carlson limiter keeps the fit monotone between samples.
 */
export class MonotonicSpline {
    private x: number[] = [];
    private y: number[] = [];
    private m: number[] = [];

    fit(xs: number[], ys: number[]): void {
        this.x = xs; this.y = ys;
        const n = xs.length;
        this.m = new Array(n).fill(0);
        if (n < 2) return;
        const d = new Array(n - 1).fill(0);
        for (let i = 0; i + 1 < n; i++) {
            const dx = xs[i + 1] - xs[i];
            d[i] = dx !== 0 ? (ys[i + 1] - ys[i]) / dx : 0;
        }
        this.m[0] = d[0];
        this.m[n - 1] = d[n - 2];
        for (let i = 1; i + 1 < n; i++) {
            this.m[i] = (d[i - 1] * d[i] <= 0) ? 0 : (d[i - 1] + d[i]) * 0.5;
        }
        for (let i = 0; i + 1 < n; i++) {
            if (d[i] === 0) { this.m[i] = 0; this.m[i + 1] = 0; continue; }
            const a = this.m[i] / d[i], b = this.m[i + 1] / d[i];
            const s = a * a + b * b;
            if (s > 9) {
                const t = 3 / Math.sqrt(s);
                this.m[i] = t * a * d[i];
                this.m[i + 1] = t * b * d[i];
            }
        }
    }

    get isEmpty(): boolean { return this.x.length === 0; }

    at(x: number): number {
        const n = this.x.length;
        if (n === 0) return 0;
        if (n === 1 || x <= this.x[0]) return this.y[0];
        if (x >= this.x[n - 1]) return this.y[n - 1];
        let i = 0;
        while (i + 2 < n && x > this.x[i + 1]) i++;
        const h = this.x[i + 1] - this.x[i];
        if (h <= 0) return this.y[i];
        const t = (x - this.x[i]) / h, t2 = t * t, t3 = t2 * t;
        return (2 * t3 - 3 * t2 + 1) * this.y[i] + (t3 - 2 * t2 + t) * h * this.m[i]
             + (-2 * t3 + 3 * t2) * this.y[i + 1] + (t3 - t2) * h * this.m[i + 1];
    }
}

// ── frame sampling and the matrix built from it ──────────────────────────────────────────

function bilinear(verts: Float32Array, uCount: number, i0: number, j0: number,
                  i1: number, j1: number, tu: number, tv: number, c: number): number {
    const v00 = verts[(j0 * uCount + i0) * 2 + c];
    const v10 = verts[(j0 * uCount + i1) * 2 + c];
    const v01 = verts[(j1 * uCount + i0) * 2 + c];
    const v11 = verts[(j1 * uCount + i1) * 2 + c];
    const top = v00 + (v10 - v00) * tu;
    const bottom = v01 + (v11 - v01) * tu;
    return top + (bottom - top) * tv;
}

export function sampleMeshPosition(layout: number, uCount: number, vCount: number,
                                   verts: Float32Array, u: number, v: number,
                                   out: Float32Array): void {
    const vc = verts.length / 2;
    if (vc === 0) { out[0] = 0; out[1] = 0; return; }

    if (layout === LAYOUT_FAN && uCount >= 1 && vc === uCount + 1) {
        const uNorm = ((u % 1) + 1) % 1;
        const fu = uNorm * uCount;
        const i0 = Math.floor(fu) % uCount;
        const i1 = (i0 + 1) % uCount;
        const tu = fu - Math.floor(fu);
        const rimX = (1 - tu) * verts[(1 + i0) * 2] + tu * verts[(1 + i1) * 2];
        const rimY = (1 - tu) * verts[(1 + i0) * 2 + 1] + tu * verts[(1 + i1) * 2 + 1];
        const vClamp = Math.min(Math.max(v, 0), 1);
        out[0] = (1 - vClamp) * verts[0] + vClamp * rimX;
        out[1] = (1 - vClamp) * verts[1] + vClamp * rimY;
        return;
    }

    if (uCount >= 2 && vCount >= 2 && uCount * vCount === vc) {
        let i0: number, i1: number, tu: number;
        if (wrapsU(layout)) {
            const uNorm = ((u % 1) + 1) % 1;
            const fu = uNorm * uCount;
            i0 = Math.floor(fu) % uCount;
            i1 = (i0 + 1) % uCount;
            tu = fu - Math.floor(fu);
        } else {
            const fu = Math.min(Math.max(u, 0), 1) * (uCount - 1);
            i0 = Math.floor(fu);
            i1 = Math.min(uCount - 1, i0 + 1);
            tu = fu - i0;
        }
        const fv = Math.min(Math.max(v, 0), 1) * (vCount - 1);
        const j0 = Math.floor(fv);
        const j1 = Math.min(vCount - 1, j0 + 1);
        const tv = fv - j0;
        out[0] = bilinear(verts, uCount, i0, j0, i1, j1, tu, tv, 0);
        out[1] = bilinear(verts, uCount, i0, j0, i1, j1, tu, tv, 1);
        return;
    }

    const nearest = Math.max(0, Math.min(vc - 1,
        Math.round(Math.min(Math.max(u, 0), 1) * (vc - 1))));
    out[0] = verts[nearest * 2];
    out[1] = verts[nearest * 2 + 1];
}

/** The local frame at (u, v): duX, duY, dvX, dvY, originX, originY. */
export function sampleFrame(layout: number, uCount: number, vCount: number,
                            verts: Float32Array, u: number, v: number,
                            out: Float32Array): boolean {
    if (verts.length < 2) return false;
    const uc = Math.max(2, uCount);
    const vc = Math.max(2, vCount);
    const wrap = wrapsU(layout);
    const du = 1 / (wrap ? uc : uc - 1);
    const dv = 1 / (vc - 1);

    const centre = new Float32Array(2), uPlus = new Float32Array(2);
    const uMinus = new Float32Array(2), vPlus = new Float32Array(2), vMinus = new Float32Array(2);
    sampleMeshPosition(layout, uCount, vCount, verts, u, v, centre);

    let uSpan: number;
    if (wrap) {
        sampleMeshPosition(layout, uCount, vCount, verts, u + du * 0.5, v, uPlus);
        sampleMeshPosition(layout, uCount, vCount, verts, u - du * 0.5, v, uMinus);
        uSpan = du;
    } else {
        const uHi = Math.min(1, u + du * 0.5), uLo = Math.max(0, u - du * 0.5);
        sampleMeshPosition(layout, uCount, vCount, verts, uHi, v, uPlus);
        sampleMeshPosition(layout, uCount, vCount, verts, uLo, v, uMinus);
        uSpan = uHi - uLo;
        if (uSpan <= 0) uSpan = du;
    }
    const vHi = Math.min(1, v + dv * 0.5), vLo = Math.max(0, v - dv * 0.5);
    sampleMeshPosition(layout, uCount, vCount, verts, u, vHi, vPlus);
    sampleMeshPosition(layout, uCount, vCount, verts, u, vLo, vMinus);
    let vSpan = vHi - vLo;
    if (vSpan <= 0) vSpan = dv;

    out[0] = (uPlus[0] - uMinus[0]) / uSpan;
    out[1] = (uPlus[1] - uMinus[1]) / uSpan;
    out[2] = (vPlus[0] - vMinus[0]) / vSpan;
    out[3] = (vPlus[1] - vMinus[1]) / vSpan;
    out[4] = centre[0];
    out[5] = centre[1];
    return true;
}

/** Turn a frame into a 2x3 affine: duX, duY, dvX, dvY, originX, originY.
 *
 * Degrades rather than producing a singular matrix: a flattened patch loses its scale, a
 * collapsed one its rotation too. Without this a folded cell would concat a non-invertible
 * matrix and take every later draw with it.
 */
export function buildMatrix(frame: Float32Array, flags: number, out: Float32Array): void {
    const duX = frame[0], duY = frame[1], dvX = frame[2], dvY = frame[3];
    const originX = frame[4], originY = frame[5];
    const duLength = Math.hypot(duX, duY);
    const dvLength = Math.hypot(dvX, dvY);
    const cross = duX * dvY - duY * dvX;

    let effective = flags;
    if (effective >= FLAG_FULL && Math.abs(cross) < DEGENERATE_EPSILON) effective = FLAG_SCALE;
    if (effective >= FLAG_SCALE
        && (duLength < DEGENERATE_EPSILON || dvLength < DEGENERATE_EPSILON)) {
        effective = FLAG_ROTATION;
    }
    if (effective >= FLAG_ROTATION && duLength < DEGENERATE_EPSILON) effective = FLAG_ORIGIN;

    switch (effective) {
        case FLAG_FULL:
            out[0] = duX; out[1] = duY; out[2] = dvX; out[3] = dvY;
            break;
        case FLAG_SCALE: {
            const ux = duX / duLength, uy = duY / duLength;
            const sign = cross < 0 ? -1 : 1;
            out[0] = ux * duLength; out[1] = uy * duLength;
            out[2] = -uy * dvLength * sign; out[3] = ux * dvLength * sign;
            break;
        }
        case FLAG_ROTATION: {
            const ux = duX / duLength, uy = duY / duLength;
            const sign = cross < 0 ? -1 : 1;
            out[0] = ux; out[1] = uy; out[2] = -uy * sign; out[3] = ux * sign;
            break;
        }
        case FLAG_ORIGIN:
        default:
            out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 1;
            break;
    }
    out[4] = originX;
    out[5] = originY;
}

export function clamp255(f: number): number {
    const i = Math.trunc(f * 255 + 0.5);
    return i < 0 ? 0 : (i > 255 ? 255 : i);
}

export function packColor(a: number, r: number, g: number, b: number): number {
    return ((clamp255(a) << 24) | (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b)) | 0;
}
