/**
 * Port of `remote-core`'s `PathGenerator`.
 *
 * Three generators, selected by `mode` — `SPLINE` (0), `MONOTONIC` (2), `LINEAR` (4) — and
 * they are genuinely different curves, not variations on a theme. The previous code here
 * had one hand-written spline and used it for every mode, so a document asking for a linear
 * or monotonic path silently got a smooth C1 spline: overshoot where the reference is flat,
 * and rounded corners where it draws straight segments.
 *
 * ## Precision
 *
 * This is the part that has to be copied rather than reimplemented. Java rounds to float32
 * at every assignment to a `float`, and the reference is not uniform about where it works
 * in `double`:
 *
 *   - `Monotonic` widens `h` to `double`, computes each control point in double, and casts
 *     to float **once** at `cubicTo`.
 *   - `Spline` does the same arithmetic entirely in `float`, so it rounds after *every*
 *     operation.
 *
 * Those two produce different last bits from identical inputs, so `Math.fround` is placed
 * to match each one exactly rather than applied uniformly. `Float32Array` is used for the
 * intermediate arrays because a store to one rounds the same way a Java `float[]` store
 * does; `Math.fround` covers the values Java keeps in local `float` variables.
 *
 * ## Output
 *
 * The emitted buffer matches the reference layout exactly — `MOVE x y` (3), then `CUBIC cx
 * cy x1 y1 x2 y2 x3 y3` (9) per segment, then `CLOSE` (1) when looping — but is built as
 * raw int bits rather than floats. The command markers are NaN-with-payload, and storing
 * those through a JS float canonicalises the payload on some engines, which would destroy
 * the marker. Coordinates go through `Math.fround` before `floatToRawIntBits`, so the
 * values are bit-identical to the reference's `float[]`.
 */

import { floatToRawIntBits } from '../Utils';

/** Path command markers, as raw float32 int bits (NaN with a payload). */
const MOVE_BITS = (10 | -0x800000) | 0;
const CUBIC_BITS = (14 | -0x800000) | 0;
const CLOSE_BITS = (15 | -0x800000) | 0;

export const PATH_SPLINE = 0;
export const PATH_MONOTONIC = 2;
export const PATH_LINEAR = 4;
/** Mask the reference applies before dispatching: `(mFlags & 0x6)`. */
export const PATH_MODE_MASK = 0x6;

const fr = Math.fround;

/**
 * The reference's inner `Path` buffer.
 *
 * Holds int bits rather than floats — see the note on markers above — but is otherwise the
 * same shape, including carrying the current point so `cubicTo` can emit it as the first
 * pair of the segment.
 */
class PathBuf {
    private mPath: Int32Array;
    private mSize = 0;
    private mCx = 0;
    private mCy = 0;

    constructor(bufferSize: number) {
        this.mPath = new Int32Array(Math.max(10, bufferSize));
    }

    reset(): void { this.mSize = 0; }

    private ensure(extra: number): void {
        if (this.mSize + extra <= this.mPath.length) return;
        const grown = new Int32Array(Math.max(this.mPath.length * 2, this.mSize + extra));
        grown.set(this.mPath.subarray(0, this.mSize));
        this.mPath = grown;
    }

    moveTo(x: number, y: number): void {
        this.ensure(3);
        this.mPath[this.mSize++] = MOVE_BITS;
        this.mPath[this.mSize++] = floatToRawIntBits(fr(x));
        this.mPath[this.mSize++] = floatToRawIntBits(fr(y));
        this.mCx = fr(x);
        this.mCy = fr(y);
    }

    cubicTo(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): void {
        this.ensure(9);
        this.mPath[this.mSize++] = CUBIC_BITS;
        this.mPath[this.mSize++] = floatToRawIntBits(this.mCx);
        this.mPath[this.mSize++] = floatToRawIntBits(this.mCy);
        this.mPath[this.mSize++] = floatToRawIntBits(fr(x1));
        this.mPath[this.mSize++] = floatToRawIntBits(fr(y1));
        this.mPath[this.mSize++] = floatToRawIntBits(fr(x2));
        this.mPath[this.mSize++] = floatToRawIntBits(fr(y2));
        this.mPath[this.mSize++] = floatToRawIntBits(fr(x3));
        this.mPath[this.mSize++] = floatToRawIntBits(fr(y3));
        this.mCx = fr(x3);
        this.mCy = fr(y3);
    }

    closePath(): void {
        this.ensure(1);
        this.mPath[this.mSize++] = CLOSE_BITS;
    }

    copyPoints(): Int32Array {
        return this.mPath.slice(0, this.mSize);
    }
}

/**
 * Chord lengths and unit segment slopes, shared by the spline and monotonic generators.
 * `dist == 0` is replaced by 1e-12 exactly as the reference does, so a repeated point
 * produces the same degenerate tangent rather than a NaN.
 */
function segments(x: Float32Array, y: Float32Array, segs: number, n: number,
                  h: Float32Array, dxSeg: Float32Array, dySeg: Float32Array): void {
    for (let i0 = 0; i0 < segs; i0++) {
        const i1 = (i0 + 1) % n;
        const sx = fr(x[i1] - x[i0]);
        const sy = fr(y[i1] - y[i0]);
        let dist = fr(Math.hypot(sx, sy));   // Java: (float) Math.hypot(...)
        if (dist === 0) dist = 1e-12;
        h[i0] = dist;
        dxSeg[i0] = fr(sx / dist);
        dySeg[i0] = fr(sy / dist);
    }
}

/**
 * Fritsch–Carlson monotone tangents plus the Hyman overshoot filter, from the reference's
 * `Monotonic.monotoneTangents`.
 *
 * The two guards are the whole point of the mode and are what a plain weighted average
 * lacks: a zero slope or a sign change on either side pins the tangent to zero, so the
 * curve cannot overshoot through an extremum; and the `s > 9` rescale bounds the tangents
 * to the Fritsch–Carlson monotonicity region.
 */
function monotoneTangents(d: Float32Array, delta: Float32Array, h: Float32Array,
                          loop: boolean): void {
    const segs = delta.length;
    const n = loop ? segs : segs + 1;

    // 1) initial (unfiltered) guesses
    for (let i = 0; i < n; i++) {
        const prev = ((i - 1 + segs) % segs + segs) % segs;
        const next = i % segs;
        if (!loop && i === 0) {
            d[i] = delta[0];
        } else if (!loop && i === n - 1) {
            d[i] = delta[segs - 1];
        } else {
            const dp = delta[prev];
            const dn = delta[next];
            if (dp === 0.0 || dn === 0.0 || Math.sign(dp) !== Math.sign(dn)) {
                d[i] = 0.0;
            } else {
                const w1 = fr(fr(2 * h[next]) + h[prev]);
                const w2 = fr(h[next] + fr(2 * h[prev]));
                d[i] = fr(fr(w1 + w2) / fr(fr(w1 / dp) + fr(w2 / dn)));
            }
        }
    }

    // 2) Fritsch–Carlson "Hyman filter" to prevent overshoot
    for (let i = 0; i < segs; i++) {
        if (delta[i] === 0.0) {
            d[i] = 0.0;
            d[(i + 1) % n] = 0.0;
        } else {
            const a = fr(d[i] / delta[i]);
            const b = fr(d[(i + 1) % n] / delta[i]);
            const s = fr(fr(a * a) + fr(b * b));
            if (s > 9.0) {
                // Java: 3.0f / (float) Math.sqrt(s) — sqrt in double, then one narrowing.
                const t = fr(3.0 / fr(Math.sqrt(s)));
                d[i] = fr(fr(t * a) * delta[i]);
                d[(i + 1) % n] = fr(fr(t * b) * delta[i]);
            }
        }
    }
}

/** Weighted average of adjacent segment slopes — the reference's `Spline.smoothTangents`. */
function smoothTangents(d: Float32Array, delta: Float32Array, h: Float32Array,
                        loop: boolean): void {
    const segs = delta.length;
    const n = loop ? segs : segs + 1;
    if (loop) {
        for (let i = 0; i < n; i++) {
            const im1 = ((i - 1 + segs) % segs + segs) % segs;
            const ip0 = i % segs;
            d[i] = fr(fr(fr(h[im1] * delta[ip0]) + fr(h[ip0] * delta[im1]))
                / fr(h[im1] + h[ip0]));
        }
    } else {
        d[0] = delta[0];
        d[n - 1] = delta[segs - 1];
        for (let i = 1; i < n - 1; i++) {
            const hm1 = h[i - 1];
            const hi = h[i];
            d[i] = fr(fr(fr(hm1 * delta[i]) + fr(hi * delta[i - 1])) / fr(hm1 + hi));
        }
    }
}

/** Scratch arrays, reused across calls exactly as the reference's generators do. */
class Scratch {
    h = new Float32Array(0);
    dxSeg = new Float32Array(0);
    dySeg = new Float32Array(0);
    dxTan = new Float32Array(0);
    dyTan = new Float32Array(0);
    path = new PathBuf(10);

    fit(segs: number, loop: boolean, n: number): void {
        if (segs !== this.h.length) {
            this.path = new PathBuf(n * 10);
            this.h = new Float32Array(segs);
            this.dxSeg = new Float32Array(segs);
            this.dySeg = new Float32Array(segs);
            const tans = loop ? segs : segs + 1;
            this.dxTan = new Float32Array(tans);
            this.dyTan = new Float32Array(tans);
        }
    }
}

export class PathGenerator {
    private mMonotonic = new Scratch();
    private mSpline = new Scratch();
    private mLinear = new PathBuf(10);

    /** Length of the buffer `getPath` will fill — the reference's `getReturnLength`. */
    getReturnLength(len: number, loop: boolean): number {
        let ret = 3;
        ret += loop ? len * 9 + 1 : (len - 1) * 9;
        return ret;
    }

    /**
     * Build the path for the given sampled points.
     *
     * `mode` is the already-masked `flags & 0x6`; anything that is not LINEAR or MONOTONIC
     * falls through to the spline, matching the reference's `default:` branch.
     */
    getPath(x: Float32Array, y: Float32Array, mode: number, loop: boolean): Int32Array {
        switch (mode) {
            case PATH_LINEAR: return this.linearPath(x, y, loop);
            case PATH_MONOTONIC: return this.curvePath(x, y, loop, this.mMonotonic, true);
            default: return this.curvePath(x, y, loop, this.mSpline, false);
        }
    }

    /** Straight segments, emitted as cubics whose controls sit on the end points. */
    private linearPath(x: Float32Array, y: Float32Array, loop: boolean): Int32Array {
        const n = x.length;
        // The reference reallocates when the point count changes; PathBuf grows on demand,
        // so resetting is enough and the emitted bytes are unaffected either way.
        this.mLinear.reset();
        if (n === 0) return this.mLinear.copyPoints();
        this.mLinear.moveTo(x[0], y[0]);
        if (n === 1) return this.mLinear.copyPoints();
        const segs = loop ? n : n - 1;
        for (let i0 = 0; i0 < segs; i0++) {
            const i1 = (i0 + 1) % n;
            this.mLinear.cubicTo(x[i0], y[i0], x[i1], y[i1], x[i1], y[i1]);
        }
        if (loop) this.mLinear.closePath();
        return this.mLinear.copyPoints();
    }

    /**
     * Shared body of the spline and monotonic generators. They differ only in which tangent
     * rule runs and in whether the control points are computed in double (monotonic) or
     * float (spline) — see the precision note at the top of the file.
     */
    private curvePath(x: Float32Array, y: Float32Array, loop: boolean,
                      sc: Scratch, monotonic: boolean): Int32Array {
        const n = x.length;
        const segs = loop ? n : n - 1;
        sc.fit(segs, loop, n);
        sc.path.reset();
        if (n === 0) return sc.path.copyPoints();
        sc.path.moveTo(x[0], y[0]);
        if (n === 1) return sc.path.copyPoints();

        segments(x, y, segs, n, sc.h, sc.dxSeg, sc.dySeg);
        if (monotonic) {
            monotoneTangents(sc.dxTan, sc.dxSeg, sc.h, loop);
            monotoneTangents(sc.dyTan, sc.dySeg, sc.h, loop);
        } else {
            smoothTangents(sc.dxTan, sc.dxSeg, sc.h, loop);
            smoothTangents(sc.dyTan, sc.dySeg, sc.h, loop);
        }

        for (let i0 = 0; i0 < segs; i0++) {
            const i1 = (i0 + 1) % n;
            const hi = sc.h[i0];
            let c1x: number, c1y: number, c2x: number, c2y: number;
            if (monotonic) {
                // double throughout, narrowed once by cubicTo
                c1x = x[i0] + sc.dxTan[i0] * hi / 3.0;
                c1y = y[i0] + sc.dyTan[i0] * hi / 3.0;
                c2x = x[i1] - sc.dxTan[i1] * hi / 3.0;
                c2y = y[i1] - sc.dyTan[i1] * hi / 3.0;
            } else {
                // float at every step
                c1x = fr(x[i0] + fr(fr(sc.dxTan[i0] * hi) / 3.0));
                c1y = fr(y[i0] + fr(fr(sc.dyTan[i0] * hi) / 3.0));
                c2x = fr(x[i1] - fr(fr(sc.dxTan[i1] * hi) / 3.0));
                c2y = fr(y[i1] - fr(fr(sc.dyTan[i1] * hi) / 3.0));
            }
            sc.path.cubicTo(c1x, c1y, c2x, c2y, x[i1], y[i1]);
        }
        if (loop) sc.path.closePath();
        return sc.path.copyPoints();
    }
}
