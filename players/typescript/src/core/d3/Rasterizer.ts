// Rasterizer: 28.4 fixed-point edge-function triangle rasterizer with a depth buffer.
//
// Port of the reference Rasterizer.java — the hot path of the software 3D backend.
// Convention: smaller z = closer; clearDepth fills with +Infinity.
//
// Two Java-isms have to be reproduced deliberately, because JS `number` neither wraps nor
// rounds where Java's `int` and `float` do:
//
//   * Java int arithmetic wraps at 32 bits. The edge-function constants are products of 28.4
//     fixed-point coordinates and overflow on large off-screen triangles, where the wrap is
//     load-bearing: the edge functions stay consistent with each other because they all wrap
//     the same way. Math.imul reproduces it exactly; plain `*` would silently produce a
//     different (mathematically "better") answer and a different picture.
//   * Java float arithmetic rounds to 32 bits at every step. The plane coefficients and the
//     interpolated z run through Math.fround so that a depth comparison between two coplanar
//     surfaces resolves the same way it does in the reference. This is the whole ballgame for
//     z-fighting: 64-bit residue turns a deterministic tie into a coin flip.
//
// The textured path is the exception: the reference widens its edge accumulators to `long`, so
// there the plain JS number is the faithful port.

const fround = Math.fround;

/** float32 multiply / add — see Matrix4.ts. */
function fm(a: number, b: number): number { return fround(a * b); }
function fa(a: number, b: number): number { return fround(a + b); }

/** Java's `(int)` cast of a float: truncate toward zero, saturating, NaN to 0. */
function f2i(v: number): number {
    if (Number.isNaN(v)) {
        return 0;
    }
    if (v >= 2147483647) {
        return 2147483647;
    }
    if (v <= -2147483648) {
        return -2147483648;
    }
    return Math.trunc(v);
}

/**
 * `w1*v1 + w2*v2 + w3*v3` evaluated the way Java evaluates it: left to right, rounding to
 * float32 after every multiply and every add.
 *
 * This is not pedantry. The barycentric weights do not sum to exactly 1, so on a flat-shaded
 * face where all three vertex colors are equal the reference still produces a faint dither
 * (255 next to 254). Accumulating in float64 and rounding once at the end erases it, and the
 * image stops matching the oracle even though it arguably looks "cleaner".
 */
function lerp3(w1: number, v1: number, w2: number, v2: number,
               w3: number, v3: number): number {
    return fround(fround(fround(fround(w1 * v1) + fround(w2 * v2))) + fround(w3 * v3));
}

function min3(x1: number, x2: number, x3: number): number {
    return (x1 > x2) ? ((x2 > x3) ? x3 : x2) : ((x1 > x3) ? x3 : x1);
}

function max3(x1: number, x2: number, x3: number): number {
    return (x1 < x2) ? ((x2 < x3) ? x3 : x2) : ((x1 < x3) ? x3 : x1);
}

/** Clear the depth buffer to +Infinity, so any rasterized z wins on first write. */
export function clearDepth(zbuf: Float32Array): void {
    zbuf.fill(Number.POSITIVE_INFINITY);
}

/**
 * Shared setup: winding fix, plane equation, fixed-point bounds and edge constants.
 * Returned as a reusable record to keep the five entry points byte-identical in behaviour
 * without repeating sixty lines of index algebra five times.
 */
interface Setup {
    ok: boolean;
    dx: number; dy: number; zoff: number;
    minx: number; maxx: number; miny: number; maxy: number;
    fdx12: number; fdx23: number; fdx31: number;
    fdy12: number; fdy23: number; fdy31: number;
    cy1: number; cy2: number; cy3: number;
    swapped: boolean;
}

const SETUP: Setup = {
    ok: false, dx: 0, dy: 0, zoff: 0,
    minx: 0, maxx: 0, miny: 0, maxy: 0,
    fdx12: 0, fdx23: 0, fdx31: 0, fdy12: 0, fdy23: 0, fdy31: 0,
    cy1: 0, cy2: 0, cy3: 0, swapped: false,
};

/** Vertex coordinates after the winding swap, so callers can swap their attributes to match. */
const V = new Float32Array(9);

function setup(w: number, h: number,
               fx3: number, fy3: number, fz3: number,
               fx2: number, fy2: number, fz2: number,
               fx1: number, fy1: number, fz1: number): Setup {
    const s = SETUP;
    s.swapped = false;
    if (((fx1 - fx2) * (fy3 - fy2) - (fy1 - fy2) * (fx3 - fx2)) < 0) {
        const tx = fx1, ty = fy1, tz = fz1;
        fx1 = fx2; fy1 = fy2; fz1 = fz2;
        fx2 = tx; fy2 = ty; fz2 = tz;
        s.swapped = true;
    }
    V[0] = fx3; V[1] = fy3; V[2] = fz3;
    V[3] = fx2; V[4] = fy2; V[5] = fz2;
    V[6] = fx1; V[7] = fy1; V[8] = fz1;

    // Plane equation z = dx*x + dy*y + zoff solved at the three triangle vertices.
    //
    // Solved in full float64. This used to emulate the reference's float arithmetic step for
    // step, because `d` was declared double there but initialised from an all-float
    // expression — evaluated in float, widened only on assignment — and the numerators were
    // float too, so matching one and not the other was worse than matching neither: the two
    // errors partly cancelled.
    //
    // The reference has since been corrected to solve the plane in double (see the note in
    // Rasterizer.java), which removes the reason for the emulation. It also removes a real
    // defect: this determinant is twice the projected signed area, and it cancels
    // catastrophically for the sliver triangles along a grazing silhouette. Dividing the
    // numerators by a `d` that has lost most of its significant bits gave those triangles a
    // depth plane missing their own vertices by a large multiple of the entire [0,1] depth
    // range, so they rasterised at a nonsense depth and lost the depth test to whatever was
    // behind them — scattered triangles simply vanishing from a surface.
    //
    // fround stays on the three results, which the reference stores as float.
    const d = fx1 * (fy3 - fy2) - fx2 * fy3 + fx3 * fy2 + (fx2 - fx3) * fy1;
    if (d === 0) {
        s.ok = false;
        return s;
    }
    const numDx = -(fy1 * (fz3 - fz2) - fy2 * fz3 + fy3 * fz2 + (fy2 - fy3) * fz1);
    const numDy = fx1 * (fz3 - fz2) - fx2 * fz3 + fx3 * fz2 + (fx2 - fx3) * fz1;
    const numZ = fx1 * (fy3 * fz2 - fy2 * fz3)
        + fy1 * (fx2 * fz3 - fx3 * fz2)
        + (fx3 * fy2 - fx2 * fy3) * fz1;
    s.dx = fround(numDx / d);
    s.dy = fround(numDy / d);
    s.zoff = fround(numZ / d);

    // 28.4 fixed-point coordinates
    const y1 = f2i(fround(fround(16.0 * fy1) + 0.5));
    const y2 = f2i(fround(fround(16.0 * fy2) + 0.5));
    const y3 = f2i(fround(fround(16.0 * fy3) + 0.5));
    const x1 = f2i(fround(fround(16.0 * fx1) + 0.5));
    const x2 = f2i(fround(fround(16.0 * fx2) + 0.5));
    const x3 = f2i(fround(fround(16.0 * fx3) + 0.5));

    const dx12 = (x1 - x2) | 0;
    const dx23 = (x2 - x3) | 0;
    const dx31 = (x3 - x1) | 0;
    const dy12 = (y1 - y2) | 0;
    const dy23 = (y2 - y3) | 0;
    const dy31 = (y3 - y1) | 0;

    s.fdx12 = dx12 << 4;
    s.fdx23 = dx23 << 4;
    s.fdx31 = dx31 << 4;
    s.fdy12 = dy12 << 4;
    s.fdy23 = dy23 << 4;
    s.fdy31 = dy31 << 4;

    let minx = (min3(x1, x2, x3) + 0xF) >> 4;
    let maxx = (max3(x1, x2, x3) + 0xF) >> 4;
    let miny = (min3(y1, y2, y3) + 0xF) >> 4;
    let maxy = (max3(y1, y2, y3) + 0xF) >> 4;
    if (miny < 0) { miny = 0; }
    if (minx < 0) { minx = 0; }
    if (maxx > w) { maxx = w; }
    if (maxy > h) { maxy = h; }
    s.minx = minx; s.maxx = maxx; s.miny = miny; s.maxy = maxy;

    // Exact, not 32-bit. The textured path needs the true value: a grazing triangle whose
    // vertex sits just past the near-w epsilon projects to six-figure screen coordinates, and
    // 28.4 fixed point squares that past 2^31. The reference widens these to long in
    // fillTriangleTextured for exactly that reason, and Math.imul would wrap instead.
    // A double holds these products exactly — the largest is well under 2^53.
    //
    // The other four entry points are int in the reference and must keep wrapping, so they
    // apply `| 0` themselves: two's complement +,-,* agree modulo 2^32, so computing exactly
    // and truncating afterwards reproduces 32-bit arithmetic.
    let c1 = dy12 * x1 - dx12 * y1;
    let c2 = dy23 * x2 - dx23 * y2;
    let c3 = dy31 * x3 - dx31 * y3;

    // Top-left fill rule: bias the shared edges so adjacent triangles neither double-cover
    // nor leave a seam.
    if (dy12 < 0 || (dy12 === 0 && dx12 > 0)) { c1 = c1 + 1; }
    if (dy23 < 0 || (dy23 === 0 && dx23 > 0)) { c2 = c2 + 1; }
    if (dy31 < 0 || (dy31 === 0 && dx31 > 0)) { c3 = c3 + 1; }

    s.cy1 = c1 + dx12 * (miny << 4) - dy12 * (minx << 4);
    s.cy2 = c2 + dx23 * (miny << 4) - dy23 * (minx << 4);
    s.cy3 = c3 + dx31 * (miny << 4) - dy31 * (minx << 4);

    s.ok = true;
    return s;
}

/** Rasterize a flat-shaded triangle with a depth test. `color` is packed ARGB. */
export function fillTriangle(zbuff: Float32Array, img: Int32Array, color: number,
                             w: number, h: number,
                             fx3: number, fy3: number, fz3: number,
                             fx2: number, fy2: number, fz2: number,
                             fx1: number, fy1: number, fz1: number): void {
    const s = setup(w, h, fx3, fy3, fz3, fx2, fy2, fz2, fx1, fy1, fz1);
    if (!s.ok) {
        return;
    }
    const { dx, dy, zoff, minx, maxx, miny, maxy, fdx12, fdx23, fdx31, fdy12, fdy23, fdy31 } = s;
    let cy1 = s.cy1 | 0, cy2 = s.cy2 | 0, cy3 = s.cy3 | 0;   // int in the reference
    let off = miny * w;

    for (let y = miny; y < maxy; y++) {
        let cx1 = cy1, cx2 = cy2, cx3 = cy3;
        const p = fround(zoff + dy * y);
        for (let x = minx; x < maxx; x++) {
            if (cx1 > 0 && cx2 > 0 && cx3 > 0) {
                const point = x + off;
                const zval = fround(p + dx * x);
                if (zbuff[point] > zval) {
                    zbuff[point] = zval;
                    img[point] = color;
                }
            }
            cx1 = (cx1 - fdy12) | 0;
            cx2 = (cx2 - fdy23) | 0;
            cx3 = (cx3 - fdy31) | 0;
        }
        cy1 = (cy1 + fdx12) | 0;
        cy2 = (cy2 + fdx23) | 0;
        cy3 = (cy3 + fdx31) | 0;
        off += w;
    }
}

/**
 * Rasterize a Gouraud-shaded triangle. Identical coverage/winding/Z handling to fillTriangle;
 * each covered pixel's ARGB is barycentrically interpolated from the three vertex colors.
 * c3/c2/c1 pair with (fx3,..)/(fx2,..)/(fx1,..).
 */
export function fillTriangleGouraud(zbuff: Float32Array, img: Int32Array,
                                    c3: number, c2: number, c1: number,
                                    w: number, h: number,
                                    fx3: number, fy3: number, fz3: number,
                                    fx2: number, fy2: number, fz2: number,
                                    fx1: number, fy1: number, fz1: number): void {
    const s = setup(w, h, fx3, fy3, fz3, fx2, fy2, fz2, fx1, fy1, fz1);
    if (!s.ok) {
        return;
    }
    if (s.swapped) {
        const t = c1; c1 = c2; c2 = t;
    }
    const { dx, dy, zoff, minx, maxx, miny, maxy, fdx12, fdx23, fdx31, fdy12, fdy23, fdy31 } = s;
    let cy1 = s.cy1 | 0, cy2 = s.cy2 | 0, cy3 = s.cy3 | 0;   // int in the reference

    // The edge sum is constant across the triangle and proportional to twice its area; it
    // normalizes the edge functions into barycentric weights. CX1 <-> v3, CX2 <-> v1, CX3 <-> v2.
    const sum = cy1 + cy2 + cy3;
    if (sum === 0) {
        return;
    }
    // The reference writes `float inv = 1.0f / s` with s a long, so the *divisor* is rounded to
    // float32 before the division. Above 2^24 that conversion is lossy, and dividing by the
    // exact integer instead gives a different reciprocal — which is why a full-screen triangle
    // (edge sum ~5.5e8) disagreed while every smaller one matched.
    const inv = fround(1.0 / fround(sum));

    const a1 = (c1 >>> 24) & 0xFF, r1 = (c1 >>> 16) & 0xFF, g1 = (c1 >>> 8) & 0xFF, b1 = c1 & 0xFF;
    const a2 = (c2 >>> 24) & 0xFF, r2 = (c2 >>> 16) & 0xFF, g2 = (c2 >>> 8) & 0xFF, b2 = c2 & 0xFF;
    const a3 = (c3 >>> 24) & 0xFF, r3 = (c3 >>> 16) & 0xFF, g3 = (c3 >>> 8) & 0xFF, b3 = c3 & 0xFF;

    let off = miny * w;
    for (let y = miny; y < maxy; y++) {
        let cx1 = cy1, cx2 = cy2, cx3 = cy3;
        const p = fround(zoff + dy * y);
        for (let x = minx; x < maxx; x++) {
            if (cx1 > 0 && cx2 > 0 && cx3 > 0) {
                const point = x + off;
                const zval = fround(p + dx * x);
                if (zbuff[point] > zval) {
                    zbuff[point] = zval;
                    // Same lossy-promotion rule as `inv` above: `cx2 * inv` converts the
                    // integer edge value to float32 first, which rounds above 2^24.
                    const w1 = fround(fround(cx2) * inv);
                    const w2 = fround(fround(cx3) * inv);
                    const w3 = fround(fround(cx1) * inv);
                    const a = f2i(lerp3(w1, a1, w2, a2, w3, a3));
                    const r = f2i(lerp3(w1, r1, w2, r2, w3, r3));
                    const g = f2i(lerp3(w1, g1, w2, g2, w3, g3));
                    const b = f2i(lerp3(w1, b1, w2, b2, w3, b3));
                    img[point] = ((a << 24) | (r << 16) | (g << 8) | b) | 0;
                }
            }
            cx1 = (cx1 - fdy12) | 0;
            cx2 = (cx2 - fdy23) | 0;
            cx3 = (cx3 - fdy31) | 0;
        }
        cy1 = (cy1 + fdx12) | 0;
        cy2 = (cy2 + fdx23) | 0;
        cy3 = (cy3 + fdx31) | 0;
        off += w;
    }
}

/**
 * Rasterize a textured triangle with perspective-correct UV: u/w, v/w and 1/w interpolate
 * linearly in screen space and divide per pixel (iwK = 1/clipW of vertex K), so the texture
 * stays attached to the surface under foreshortening. Sampled nearest with v flipped
 * (top-down bitmap) and CLAMP, then modulated by the interpolated per-vertex lighting color.
 *
 * Fully-transparent texels are cutouts: neither color nor depth is written, so a textured
 * cutout never occludes what shows through its holes.
 */
export function fillTriangleTextured(zbuff: Float32Array, img: Int32Array,
                                     tex: Int32Array, texW: number, texH: number,
                                     c3: number, c2: number, c1: number,
                                     w: number, h: number,
                                     fx3: number, fy3: number, fz3: number,
                                     u3: number, v3: number, iw3: number,
                                     fx2: number, fy2: number, fz2: number,
                                     u2: number, v2: number, iw2: number,
                                     fx1: number, fy1: number, fz1: number,
                                     u1: number, v1: number, iw1: number): void {
    const s = setup(w, h, fx3, fy3, fz3, fx2, fy2, fz2, fx1, fy1, fz1);
    if (!s.ok) {
        return;
    }
    if (s.swapped) {
        let t = c1; c1 = c2; c2 = t;
        t = u1; u1 = u2; u2 = t;
        t = v1; v1 = v2; v2 = t;
        t = iw1; iw1 = iw2; iw2 = t;
    }
    const { dx, dy, zoff, minx, maxx, miny, maxy, fdx12, fdx23, fdx31, fdy12, fdy23, fdy31 } = s;
    let cy1 = s.cy1, cy2 = s.cy2, cy3 = s.cy3;   // long in the reference

    const sum = cy1 + cy2 + cy3;
    if (sum === 0) {
        return;
    }
    // The reference writes `float inv = 1.0f / s` with s a long, so the *divisor* is rounded to
    // float32 before the division. Above 2^24 that conversion is lossy, and dividing by the
    // exact integer instead gives a different reciprocal — which is why a full-screen triangle
    // (edge sum ~5.5e8) disagreed while every smaller one matched.
    const inv = fround(1.0 / fround(sum));

    const a1 = (c1 >>> 24) & 0xFF, r1 = (c1 >>> 16) & 0xFF, g1 = (c1 >>> 8) & 0xFF, b1 = c1 & 0xFF;
    const a2 = (c2 >>> 24) & 0xFF, r2 = (c2 >>> 16) & 0xFF, g2 = (c2 >>> 8) & 0xFF, b2 = c2 & 0xFF;
    const a3 = (c3 >>> 24) & 0xFF, r3 = (c3 >>> 16) & 0xFF, g3 = (c3 >>> 8) & 0xFF, b3 = c3 & 0xFF;

    const uiw1 = fround(u1 * iw1), uiw2 = fround(u2 * iw2), uiw3 = fround(u3 * iw3);
    const viw1 = fround(v1 * iw1), viw2 = fround(v2 * iw2), viw3 = fround(v3 * iw3);

    // The reference widens the edge accumulators to `long` here, so no |0 masking: plain
    // numbers are the faithful port in this function and only this one.
    let off = miny * w;
    for (let y = miny; y < maxy; y++) {
        let cx1 = cy1, cx2 = cy2, cx3 = cy3;
        const p = fround(zoff + dy * y);
        for (let x = minx; x < maxx; x++) {
            if (cx1 > 0 && cx2 > 0 && cx3 > 0) {
                const point = x + off;
                const zval = fround(p + dx * x);
                if (zbuff[point] > zval) {
                    const w1 = fround(fround(cx2) * inv), w2 = fround(fround(cx3) * inv),
                        w3 = fround(fround(cx1) * inv);
                    const invW = fround(1.0 / lerp3(w1, iw1, w2, iw2, w3, iw3));
                    const u = fround(lerp3(w1, uiw1, w2, uiw2, w3, uiw3) * invW);
                    const v = fround(lerp3(w1, viw1, w2, viw2, w3, viw3) * invW);
                    let tx = f2i(fround(u * texW));
                    let ty = f2i(fround(fround(1 - v) * texH));
                    if (tx < 0) { tx = 0; } else if (tx >= texW) { tx = texW - 1; }
                    if (ty < 0) { ty = 0; } else if (ty >= texH) { ty = texH - 1; }
                    const t = tex[ty * texW + tx];
                    const ta = (t >>> 24) & 0xFF;
                    if (ta !== 0) {
                        zbuff[point] = zval;
                        const la = f2i(lerp3(w1, a1, w2, a2, w3, a3));
                        const lr = f2i(lerp3(w1, r1, w2, r2, w3, r3));
                        const lg = f2i(lerp3(w1, g1, w2, g2, w3, g3));
                        const lb = f2i(lerp3(w1, b1, w2, b2, w3, b3));
                        const a = Math.trunc((ta * la) / 255);
                        const r = Math.trunc((((t >>> 16) & 0xFF) * lr) / 255);
                        const g = Math.trunc((((t >>> 8) & 0xFF) * lg) / 255);
                        const b = Math.trunc(((t & 0xFF) * lb) / 255);
                        img[point] = ((a << 24) | (r << 16) | (g << 8) | b) | 0;
                    }
                }
            }
            cx1 -= fdy12;
            cx2 -= fdy23;
            cx3 -= fdy31;
        }
        cy1 += fdx12;
        cy2 += fdx23;
        cy3 += fdx31;
        off += w;
    }
}

/**
 * Rasterize coverage into the depth buffer only — depth test and write, no color. The prepass
 * of the wireframe path: it lays down the solid's depth with transparent faces so
 * drawLineDepthTested can hide the edges behind it.
 */
export function fillTriangleDepthOnly(zbuff: Float32Array, w: number, h: number,
                                      fx3: number, fy3: number, fz3: number,
                                      fx2: number, fy2: number, fz2: number,
                                      fx1: number, fy1: number, fz1: number): void {
    const s = setup(w, h, fx3, fy3, fz3, fx2, fy2, fz2, fx1, fy1, fz1);
    if (!s.ok) {
        return;
    }
    const { dx, dy, zoff, minx, maxx, miny, maxy, fdx12, fdx23, fdx31, fdy12, fdy23, fdy31 } = s;
    let cy1 = s.cy1 | 0, cy2 = s.cy2 | 0, cy3 = s.cy3 | 0;   // int in the reference
    let off = miny * w;

    for (let y = miny; y < maxy; y++) {
        let cx1 = cy1, cx2 = cy2, cx3 = cy3;
        const p = fround(zoff + dy * y);
        for (let x = minx; x < maxx; x++) {
            if (cx1 > 0 && cx2 > 0 && cx3 > 0) {
                const point = x + off;
                const zval = fround(p + dx * x);
                if (zbuff[point] > zval) {
                    zbuff[point] = zval;
                }
            }
            cx1 = (cx1 - fdy12) | 0;
            cx2 = (cx2 - fdy23) | 0;
            cx3 = (cx3 - fdy31) | 0;
        }
        cy1 = (cy1 + fdx12) | 0;
        cy2 = (cy2 + fdx23) | 0;
        cy3 = (cy3 + fdx31) | 0;
        off += w;
    }
}

/**
 * Draw a depth-tested 3D line (color only — does not write depth). Screen-space DDA with
 * linearly interpolated z.
 *
 * `bias` (window-z units, smaller = closer) is subtracted from the line's z before the test so
 * an edge passes against its own face — which wrote the same z in the depth prepass — while
 * still being occluded by clearly nearer surface. This is the hidden-line removal behind
 * MODE_WIREFRAME.
 */
export function drawLineDepthTested(zbuff: Float32Array, img: Int32Array, color: number,
                                    w: number, h: number,
                                    x0: number, y0: number, z0: number,
                                    x1: number, y1: number, z1: number,
                                    bias: number): void {
    const dx = fround(x1 - x0);
    const dy = fround(y1 - y0);
    const adx = dx < 0 ? -dx : dx;
    const ady = dy < 0 ? -dy : dy;
    let steps = f2i(adx > ady ? adx : ady);
    if (steps < 1) {
        steps = 1;
    }
    const inv = fround(1 / steps);
    const sx = fround(dx * inv);
    const sy = fround(dy * inv);
    const sz = fround(fround(z1 - z0) * inv);
    let px = x0, py = y0, pz = z0;
    for (let i = 0; i <= steps; i++) {
        const ix = f2i(px);
        const iy = f2i(py);
        if (ix >= 0 && ix < w && iy >= 0 && iy < h) {
            const point = ix + iy * w;
            if (zbuff[point] >= pz - bias) {
                img[point] = color;
            }
        }
        px = fround(px + sx);
        py = fround(py + sy);
        pz = fround(pz + sz);
    }
}
