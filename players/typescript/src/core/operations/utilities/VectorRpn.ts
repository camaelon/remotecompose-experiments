// VectorRpn: reverse-polish evaluator for vector-valued expressions.
//
// Port of the reference VectorRpn.java — the vector analogue of AnimatedFloatExpression, sharing
// only the opcode numbering. Every stack value occupies MAX_DIM (4) lanes; a scalar is broadcast
// across all four, so an operator never has to branch on whether its operands are scalars or
// vectors. Unused high lanes are zero-padded, which is what makes dot and length correct over
// all four lanes regardless of the logical dimensionality.
//
// The stack is a Float32Array, so `s[a] += s[b]` rounds to 32 bits on store exactly as Java's
// float[] does. Locals that accumulate across several operations (dot, cross, length) still need
// explicit fround — see Matrix4.ts for why that matters.

const fround = Math.fround;
function fm(a: number, b: number): number { return fround(a * b); }
function fa(a: number, b: number): number { return fround(a + b); }

export const OFFSET = 0x310000;

export const OP_ADD = OFFSET + 1;
export const OP_SUB = OFFSET + 2;
export const OP_MUL = OFFSET + 3;
export const OP_DIV = OFFSET + 4;
export const OP_MOD = OFFSET + 5;
export const OP_MIN = OFFSET + 6;
export const OP_MAX = OFFSET + 7;
export const OP_POW = OFFSET + 8;
export const OP_SQRT = OFFSET + 9;
export const OP_ABS = OFFSET + 10;
export const OP_FLOOR = OFFSET + 14;
export const OP_ROUND = OFFSET + 17;
export const OP_SIN = OFFSET + 18;
export const OP_COS = OFFSET + 19;
export const OP_CEIL = OFFSET + 31;
export const OP_SQUARE = OFFSET + 45;
export const OP_INV = OFFSET + 52;
export const OP_NOP = OFFSET + 55;
export const OP_CHANGE_SIGN = OFFSET + 73;
export const OP_VBUILD2 = OFFSET + 100;
export const OP_VBUILD3 = OFFSET + 101;
export const OP_VBUILD4 = OFFSET + 102;
export const OP_VDOT = OFFSET + 103;
export const OP_VCROSS = OFFSET + 104;
export const OP_VLEN = OFFSET + 105;
export const OP_VLENSQ = OFFSET + 106;
export const OP_VNORM = OFFSET + 107;

/** Fixed vector width (vec4 / rgba). Every stack value occupies this many lanes. */
export const MAX_DIM = 4;

const MAX_STACK = 64;
const MAX_PROGRAM = 512;
const SOFT_DOMAIN_EPS = 1e-6;

const _dv = new DataView(new ArrayBuffer(4));

/**
 * The opcode carried by a NaN payload.
 *
 * The reference masks 23 bits (0x7FFFFF); this masks 22 (0x3FFFFF), matching the rest of the
 * TypeScript player. The difference is bit 22, the quiet-NaN flag. `op()` builds a *signaling*
 * NaN, and JS quiets it the moment it passes through a `number` — which every value does here,
 * since a Float32Array read widens to float64. Java preserves the raw bits, so it never sees
 * the flag set and can afford the wider mask; we cannot. Utils.idFromNan already made this
 * choice for the scalar evaluator.
 */
export function fromNaN(v: number): number {
    _dv.setFloat32(0, v);
    return _dv.getInt32(0) & 0x3FFFFF;
}

/**
 * True iff `v` is one of the vector-specific opcodes (OFFSET+100..107). These live *above* the
 * scalar op range, so `AnimatedFloatExpression.isMathOperator` does not recognize them and any
 * caller classifying tokens as operator-vs-variable has to check this as well.
 */
export function isVectorOp(v: number): boolean {
    if (!Number.isNaN(v)) {
        return false;
    }
    const pos = fromNaN(v);
    return pos >= OP_VBUILD2 && pos <= OP_VNORM;
}

export class VectorRpn {
    private mProgram = new Float32Array(MAX_PROGRAM);
    private mStack = new Float32Array(MAX_STACK * MAX_DIM);
    /** Logical dimensionality of each stack value. */
    private mDim = new Int32Array(MAX_STACK);

    /**
     * When true, divide and normalize substitute a tiny denominator for a near-zero one instead
     * of producing Inf/NaN. Off by default (exact); the owning op flips it for a corrective retry.
     */
    mSoftDomain = false;

    /**
     * Evaluate program[0..len) and write the result's components into out (length >= MAX_DIM).
     * Returns the logical dimensionality of the result (1 = scalar, 2/3/4 = vector).
     */
    apply(program: Float32Array, len: number, out: Float32Array): number {
        if (len > MAX_PROGRAM) {
            // Java would throw out of arraycopy here. JS would silently truncate the copy and
            // evaluate a half-program, so the bound is made explicit.
            throw new Error(`VectorRpn: program length ${len} exceeds ${MAX_PROGRAM}`);
        }
        this.mProgram.set(program.subarray(0, len), 0);
        const s = this.mStack;
        let sp = -1;
        for (let i = 0; i < len; i++) {
            const v = this.mProgram[i];
            if (Number.isNaN(v)) {
                sp = this.opEval(sp, fromNaN(v));
            } else {
                sp++;
                if (sp >= MAX_STACK) {
                    // Writing past a Float32Array is a silent no-op in JS, where Java throws.
                    // Without this check a malformed program would quietly produce garbage
                    // instead of failing.
                    throw new Error('VectorRpn: stack overflow (malformed program)');
                }
                const p = sp * MAX_DIM;
                s[p] = v;
                s[p + 1] = v;
                s[p + 2] = v;
                s[p + 3] = v;      // a scalar broadcasts across all lanes
                this.mDim[sp] = 1;
            }
        }
        if (sp < 0) {
            throw new Error('VectorRpn: empty program');
        }
        const p = sp * MAX_DIM;
        out[0] = s[p];
        out[1] = s[p + 1];
        out[2] = s[p + 2];
        out[3] = s[p + 3];
        return this.mDim[sp];
    }

    private opEval(sp: number, id: number): number {
        const s = this.mStack;
        const d = this.mDim;
        const a = (sp - 1) * MAX_DIM;   // lhs / binary result base
        const b = sp * MAX_DIM;         // rhs / unary operand base
        switch (id) {
            case OP_ADD:
                s[a] += s[b]; s[a + 1] += s[b + 1]; s[a + 2] += s[b + 2]; s[a + 3] += s[b + 3];
                d[sp - 1] = Math.max(d[sp - 1], d[sp]);
                return sp - 1;
            case OP_SUB:
                s[a] -= s[b]; s[a + 1] -= s[b + 1]; s[a + 2] -= s[b + 2]; s[a + 3] -= s[b + 3];
                d[sp - 1] = Math.max(d[sp - 1], d[sp]);
                return sp - 1;
            case OP_MUL:
                s[a] *= s[b]; s[a + 1] *= s[b + 1]; s[a + 2] *= s[b + 2]; s[a + 3] *= s[b + 3];
                d[sp - 1] = Math.max(d[sp - 1], d[sp]);
                return sp - 1;
            case OP_DIV:
                s[a] /= this.softDenom(s[b]);
                s[a + 1] /= this.softDenom(s[b + 1]);
                s[a + 2] /= this.softDenom(s[b + 2]);
                s[a + 3] /= this.softDenom(s[b + 3]);
                d[sp - 1] = Math.max(d[sp - 1], d[sp]);
                return sp - 1;
            case OP_MOD:
                s[a] %= this.softDenom(s[b]);
                s[a + 1] %= this.softDenom(s[b + 1]);
                s[a + 2] %= this.softDenom(s[b + 2]);
                s[a + 3] %= this.softDenom(s[b + 3]);
                d[sp - 1] = Math.max(d[sp - 1], d[sp]);
                return sp - 1;
            case OP_MIN:
                s[a] = Math.min(s[a], s[b]);
                s[a + 1] = Math.min(s[a + 1], s[b + 1]);
                s[a + 2] = Math.min(s[a + 2], s[b + 2]);
                s[a + 3] = Math.min(s[a + 3], s[b + 3]);
                d[sp - 1] = Math.max(d[sp - 1], d[sp]);
                return sp - 1;
            case OP_MAX:
                s[a] = Math.max(s[a], s[b]);
                s[a + 1] = Math.max(s[a + 1], s[b + 1]);
                s[a + 2] = Math.max(s[a + 2], s[b + 2]);
                s[a + 3] = Math.max(s[a + 3], s[b + 3]);
                d[sp - 1] = Math.max(d[sp - 1], d[sp]);
                return sp - 1;
            case OP_POW:
                s[a] = Math.pow(s[a], s[b]);
                s[a + 1] = Math.pow(s[a + 1], s[b + 1]);
                s[a + 2] = Math.pow(s[a + 2], s[b + 2]);
                s[a + 3] = Math.pow(s[a + 3], s[b + 3]);
                d[sp - 1] = Math.max(d[sp - 1], d[sp]);
                return sp - 1;

            case OP_SQRT:
                s[b] = Math.sqrt(s[b]);
                s[b + 1] = Math.sqrt(s[b + 1]);
                s[b + 2] = Math.sqrt(s[b + 2]);
                s[b + 3] = Math.sqrt(s[b + 3]);
                return sp;
            case OP_ABS:
                s[b] = Math.abs(s[b]);
                s[b + 1] = Math.abs(s[b + 1]);
                s[b + 2] = Math.abs(s[b + 2]);
                s[b + 3] = Math.abs(s[b + 3]);
                return sp;
            case OP_SQUARE:
                s[b] *= s[b]; s[b + 1] *= s[b + 1]; s[b + 2] *= s[b + 2]; s[b + 3] *= s[b + 3];
                return sp;
            case OP_SIN:
                s[b] = Math.sin(s[b]);
                s[b + 1] = Math.sin(s[b + 1]);
                s[b + 2] = Math.sin(s[b + 2]);
                s[b + 3] = Math.sin(s[b + 3]);
                return sp;
            case OP_COS:
                s[b] = Math.cos(s[b]);
                s[b + 1] = Math.cos(s[b + 1]);
                s[b + 2] = Math.cos(s[b + 2]);
                s[b + 3] = Math.cos(s[b + 3]);
                return sp;
            case OP_FLOOR:
                s[b] = Math.floor(s[b]);
                s[b + 1] = Math.floor(s[b + 1]);
                s[b + 2] = Math.floor(s[b + 2]);
                s[b + 3] = Math.floor(s[b + 3]);
                return sp;
            case OP_CEIL:
                s[b] = Math.ceil(s[b]);
                s[b + 1] = Math.ceil(s[b + 1]);
                s[b + 2] = Math.ceil(s[b + 2]);
                s[b + 3] = Math.ceil(s[b + 3]);
                return sp;
            case OP_ROUND:
                s[b] = javaRound(s[b]);
                s[b + 1] = javaRound(s[b + 1]);
                s[b + 2] = javaRound(s[b + 2]);
                s[b + 3] = javaRound(s[b + 3]);
                return sp;
            case OP_CHANGE_SIGN:
                s[b] = -s[b]; s[b + 1] = -s[b + 1]; s[b + 2] = -s[b + 2]; s[b + 3] = -s[b + 3];
                return sp;
            case OP_INV:
                s[b] = 1 / this.softDenom(s[b]);
                s[b + 1] = 1 / this.softDenom(s[b + 1]);
                s[b + 2] = 1 / this.softDenom(s[b + 2]);
                s[b + 3] = 1 / this.softDenom(s[b + 3]);
                return sp;

            case OP_VBUILD2:
                return this.build(sp, 2);
            case OP_VBUILD3:
                return this.build(sp, 3);
            case OP_VBUILD4:
                return this.build(sp, 4);
            case OP_VDOT: {
                // Zero-padded high lanes contribute 0, so summing all four is correct for any
                // dimensionality.
                const dot = fa(fa(fa(fm(s[a], s[b]), fm(s[a + 1], s[b + 1])),
                    fm(s[a + 2], s[b + 2])), fm(s[a + 3], s[b + 3]));
                s[a] = dot; s[a + 1] = dot; s[a + 2] = dot; s[a + 3] = dot;
                d[sp - 1] = 1;
                return sp - 1;
            }
            case OP_VCROSS: {
                const ax = s[a], ay = s[a + 1], az = s[a + 2];
                const bx = s[b], by = s[b + 1], bz = s[b + 2];
                s[a] = fround(fm(ay, bz) - fm(az, by));
                s[a + 1] = fround(fm(az, bx) - fm(ax, bz));
                s[a + 2] = fround(fm(ax, by) - fm(ay, bx));
                s[a + 3] = 0;
                d[sp - 1] = 3;
                return sp - 1;
            }
            case OP_VLEN:
            case OP_VLENSQ: {
                const sq = fa(fa(fa(fm(s[b], s[b]), fm(s[b + 1], s[b + 1])),
                    fm(s[b + 2], s[b + 2])), fm(s[b + 3], s[b + 3]));
                const r = (id === OP_VLEN) ? fround(Math.sqrt(sq)) : sq;
                s[b] = r; s[b + 1] = r; s[b + 2] = r; s[b + 3] = r;
                d[sp] = 1;
                return sp;
            }
            case OP_VNORM: {
                const sq = fa(fa(fa(fm(s[b], s[b]), fm(s[b + 1], s[b + 1])),
                    fm(s[b + 2], s[b + 2])), fm(s[b + 3], s[b + 3]));
                const inv = fround(1 / this.softDenom(fround(Math.sqrt(sq))));
                s[b] *= inv; s[b + 1] *= inv; s[b + 2] *= inv; s[b + 3] *= inv;
                return sp;
            }

            case OP_NOP:
                return sp;   // produced by two-body first()/second() substitution

            default:
                throw new Error(`VectorRpn op not implemented: ${id - OFFSET}`);
        }
    }

    /** Pop n scalars (lane 0 of the top n slots) into one vec{n}; zero-pad the rest. */
    private build(sp: number, n: number): number {
        const s = this.mStack;
        const base = sp - n + 1;
        const c0 = s[base * MAX_DIM];
        const c1 = (n > 1) ? s[(base + 1) * MAX_DIM] : 0;
        const c2 = (n > 2) ? s[(base + 2) * MAX_DIM] : 0;
        const c3 = (n > 3) ? s[(base + 3) * MAX_DIM] : 0;
        const p = base * MAX_DIM;
        s[p] = c0;
        s[p + 1] = c1;
        s[p + 2] = c2;
        s[p + 3] = c3;   // unused high lanes stay zero so dot/len are correct over all four
        this.mDim[base] = n;
        return base;
    }

    private softDenom(denom: number): number {
        if (this.mSoftDomain && denom < SOFT_DOMAIN_EPS && denom > -SOFT_DOMAIN_EPS) {
            return (denom < 0) ? -SOFT_DOMAIN_EPS : SOFT_DOMAIN_EPS;
        }
        return denom;
    }
}

/**
 * Java's `Math.round(float)`: floor(x + 0.5) returning an int, so it saturates at the int range
 * and maps NaN to 0. JS Math.round agrees on the rounding rule but not on those edges.
 */
function javaRound(x: number): number {
    if (Number.isNaN(x)) {
        return 0;
    }
    const r = Math.floor(x + 0.5);
    if (r >= 2147483647) {
        return 2147483647;
    }
    if (r <= -2147483648) {
        return -2147483648;
    }
    return r;
}
