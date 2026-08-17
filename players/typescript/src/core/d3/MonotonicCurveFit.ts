// MonotonicCurveFit: monotone cubic Hermite spline over N-dimensional samples.
//
// Port of the reference MonotonicCurveFit.java (the same class the easing curves use). The tube
// family fits its centreline to one of these: chord-length parametrized, so the spline passes
// through every control point without the overshoot a plain Catmull-Rom gives on a tight corner.
//
// Everything here is double arithmetic in the reference too, so — unlike the rasterizer — there
// is no float32 rounding to reproduce. JS numbers are IEEE-754 doubles and +,-,*,/ and sqrt are
// correctly rounded in both languages, so this port is exact by construction. The one hazard is
// Math.hypot, whose implementations may differ in the last bit; it feeds only a `> 9.0`
// comparison used to damp overshoot, so a last-bit difference cannot change the result unless a
// sample sits exactly on that threshold.

export class MonotonicCurveFit {
    private mT: Float64Array;
    private mY: Float64Array[];
    private mTangent: Float64Array[];
    private mExtrapolate = true;
    private mSlopeTemp: Float64Array;

    constructor(time: Float64Array | number[], y: (Float64Array | number[])[]) {
        const n = time.length;
        const dim = y[0].length;
        this.mSlopeTemp = new Float64Array(dim);
        const slope: Float64Array[] = [];
        const tangent: Float64Array[] = [];
        for (let i = 0; i < n - 1; i++) {
            slope.push(new Float64Array(dim));
        }
        for (let i = 0; i < n; i++) {
            tangent.push(new Float64Array(dim));
        }
        for (let j = 0; j < dim; j++) {
            for (let i = 0; i < n - 1; i++) {
                const dt = time[i + 1] - time[i];
                slope[i][j] = (y[i + 1][j] - y[i][j]) / dt;
                if (i === 0) {
                    tangent[i][j] = slope[i][j];
                } else {
                    tangent[i][j] = (slope[i - 1][j] + slope[i][j]) * 0.5;
                }
            }
            tangent[n - 1][j] = slope[n - 2][j];
        }
        // Fritsch-Carlson limiter: clamp tangents that would make the segment non-monotone.
        for (let i = 0; i < n - 1; i++) {
            for (let j = 0; j < dim; j++) {
                if (slope[i][j] === 0) {
                    tangent[i][j] = 0;
                    tangent[i + 1][j] = 0;
                } else {
                    const a = tangent[i][j] / slope[i][j];
                    const b = tangent[i + 1][j] / slope[i][j];
                    const h = Math.hypot(a, b);
                    if (h > 9.0) {
                        const t = 3.0 / h;
                        tangent[i][j] = t * a * slope[i][j];
                        tangent[i + 1][j] = t * b * slope[i][j];
                    }
                }
            }
        }
        this.mT = time instanceof Float64Array ? time : new Float64Array(time);
        this.mY = y.map((r) => (r instanceof Float64Array ? r : new Float64Array(r)));
        this.mTangent = tangent;
    }

    /** Position of every curve at t, written into v. Extrapolates linearly beyond the ends. */
    getPos(t: number, v: Float64Array | Float32Array | number[]): void {
        const n = this.mT.length;
        const dim = this.mY[0].length;
        if (this.mExtrapolate) {
            if (t <= this.mT[0]) {
                this.getSlope(this.mT[0], this.mSlopeTemp);
                for (let j = 0; j < dim; j++) {
                    v[j] = this.mY[0][j] + (t - this.mT[0]) * this.mSlopeTemp[j];
                }
                return;
            }
            if (t >= this.mT[n - 1]) {
                this.getSlope(this.mT[n - 1], this.mSlopeTemp);
                for (let j = 0; j < dim; j++) {
                    v[j] = this.mY[n - 1][j] + (t - this.mT[n - 1]) * this.mSlopeTemp[j];
                }
                return;
            }
        } else {
            if (t <= this.mT[0]) {
                for (let j = 0; j < dim; j++) {
                    v[j] = this.mY[0][j];
                }
                return;
            }
            if (t >= this.mT[n - 1]) {
                for (let j = 0; j < dim; j++) {
                    v[j] = this.mY[n - 1][j];
                }
                return;
            }
        }
        for (let i = 0; i < n - 1; i++) {
            if (t === this.mT[i]) {
                for (let j = 0; j < dim; j++) {
                    v[j] = this.mY[i][j];
                }
            }
            if (t < this.mT[i + 1]) {
                const h = this.mT[i + 1] - this.mT[i];
                const x = (t - this.mT[i]) / h;
                for (let j = 0; j < dim; j++) {
                    v[j] = interpolate(h, x, this.mY[i][j], this.mY[i + 1][j],
                        this.mTangent[i][j], this.mTangent[i + 1][j]);
                }
                return;
            }
        }
    }

    /** Position of curve j at t. */
    getPosAt(t: number, j: number): number {
        const n = this.mT.length;
        if (this.mExtrapolate) {
            if (t <= this.mT[0]) {
                return this.mY[0][j] + (t - this.mT[0]) * this.getSlopeAt(this.mT[0], j);
            }
            if (t >= this.mT[n - 1]) {
                return this.mY[n - 1][j]
                    + (t - this.mT[n - 1]) * this.getSlopeAt(this.mT[n - 1], j);
            }
        } else {
            if (t <= this.mT[0]) {
                return this.mY[0][j];
            }
            if (t >= this.mT[n - 1]) {
                return this.mY[n - 1][j];
            }
        }
        for (let i = 0; i < n - 1; i++) {
            if (t === this.mT[i]) {
                return this.mY[i][j];
            }
            if (t < this.mT[i + 1]) {
                const h = this.mT[i + 1] - this.mT[i];
                const x = (t - this.mT[i]) / h;
                return interpolate(h, x, this.mY[i][j], this.mY[i + 1][j],
                    this.mTangent[i][j], this.mTangent[i + 1][j]);
            }
        }
        return 0;
    }

    /** Slope of every curve at t, written into v. Clamped to the knot range (no extrapolation). */
    getSlope(t: number, v: Float64Array | number[]): void {
        const n = this.mT.length;
        const dim = this.mY[0].length;
        if (t <= this.mT[0]) {
            t = this.mT[0];
        } else if (t >= this.mT[n - 1]) {
            t = this.mT[n - 1];
        }
        for (let i = 0; i < n - 1; i++) {
            if (t <= this.mT[i + 1]) {
                const h = this.mT[i + 1] - this.mT[i];
                const x = (t - this.mT[i]) / h;
                for (let j = 0; j < dim; j++) {
                    v[j] = diff(h, x, this.mY[i][j], this.mY[i + 1][j],
                        this.mTangent[i][j], this.mTangent[i + 1][j]) / h;
                }
                break;
            }
        }
    }

    getSlopeAt(t: number, j: number): number {
        const n = this.mT.length;
        if (t <= this.mT[0]) {
            t = this.mT[0];
        } else if (t >= this.mT[n - 1]) {
            t = this.mT[n - 1];
        }
        for (let i = 0; i < n - 1; i++) {
            if (t <= this.mT[i + 1]) {
                const h = this.mT[i + 1] - this.mT[i];
                const x = (t - this.mT[i]) / h;
                return diff(h, x, this.mY[i][j], this.mY[i + 1][j],
                    this.mTangent[i][j], this.mTangent[i + 1][j]) / h;
            }
        }
        return 0;
    }
}

/** Cubic Hermite basis, written in the reference's exact term order. */
function interpolate(h: number, x: number, y1: number, y2: number,
                     t1: number, t2: number): number {
    const x2 = x * x;
    const x3 = x2 * x;
    return -2 * x3 * y2
        + 3 * x2 * y2
        + 2 * x3 * y1
        - 3 * x2 * y1
        + y1
        + h * t2 * x3
        + h * t1 * x3
        - h * t2 * x2
        - 2 * h * t1 * x2
        + h * t1 * x;
}

/** Derivative of the Hermite basis with respect to x. */
function diff(h: number, x: number, y1: number, y2: number,
              t1: number, t2: number): number {
    const x2 = x * x;
    return -6 * x2 * y2
        + 6 * x * y2
        + 6 * x2 * y1
        - 6 * x * y1
        + 3 * h * t2 * x2
        + 3 * h * t1 * x2
        - 2 * h * t2 * x
        - 4 * h * t1 * x
        + h * t1;
}
