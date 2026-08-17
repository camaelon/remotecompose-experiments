// VectorExpression (op 116): a vec2/3/4-valued expression.
//
// Port of the reference VectorExpression.java. It evaluates a VectorRpn program and writes the
// components to *consecutive* scalar variable ids — id, id+1, ... id+dimension-1. Every existing
// consumer (draw ops, transforms, colour and scalar expressions) reads those as ordinary
// scalars, so this op is purely a compact producer and nothing downstream needs to know vectors
// exist.
//
// Deliberately simpler than FloatExpression: no animation, spring or easing. Animation is
// compositional — feed it animated input variables.

import { Operation } from '../Operation';
import type { RemoteContext } from '../RemoteContext';
import type { VariableSupport } from '../VariableSupport';
import type { WireBuffer } from '../WireBuffer';
import { idFromNan, isNaNBits, idFromBits, floatToRawIntBits } from './Utils';
import { AnimatedFloatExpression } from './utilities/AnimatedFloatExpression';
import { VectorRpn, MAX_DIM, isVectorOp } from './utilities/VectorRpn';

const ID_REGION_MASK = 0x3 << 20;
const ID_REGION_ARRAY = 0x2 << 20;

/**
 * A variable reference that must be resolved to its current value before evaluation. Operators
 * and array references are also NaN-boxed but must survive untouched — arrays are resolved at
 * eval time, and an operator resolved as if it were a variable turns the program into gibberish.
 *
 * KNOWN DIVERGENCE FROM THE REFERENCE. VectorExpression.java classifies with
 * `isMathOperator` and `isDataVariable` only. The vector opcodes (OFFSET+100..107 — vec2/3/4,
 * dot, cross, len, lensq, norm) sit *above* the scalar op range, so `isMathOperator` returns
 * false for them and `updateVariables` overwrites each one with `context.getFloat(id)` — 0 for
 * an unset id. Verified against the reference: a program `[3, 4, 0, vec3]` has its `vec3` token
 * replaced by 0.0 on the first updateVariables, so every vector program silently evaluates to
 * zeros. VectorOpCodes.isVectorOp exists and its own docstring says callers classifying
 * operator-vs-variable "must treat these as operators too"; VectorExpression simply does not
 * call it. Including the check here is what the reference documents as intended, and without it
 * the operation cannot do the one thing it is for. Reported upstream — see 3D_PLAN.md.
 */
function isResolvable(v: number): boolean {
    if (!Number.isNaN(v)) {
        return false;
    }
    const bits = floatToRawIntBits(v);
    const isArray = isNaNBits(bits) && (idFromBits(bits) & ID_REGION_MASK) === ID_REGION_ARRAY;
    return !AnimatedFloatExpression.isMathOperator(v) && !isVectorOp(v) && !isArray;
}

export class VectorExpression extends Operation implements VariableSupport {
    static readonly OP_CODE = 116;

    private mPreCalc: Float32Array;
    private mRpn = new VectorRpn();
    private mOut = new Float32Array(MAX_DIM);

    constructor(
        readonly mId: number,
        readonly mDimension: number,
        readonly mFlags: number,
        readonly mSrcValue: Float32Array,
    ) {
        super();
        this.mPreCalc = mSrcValue.slice();
    }

    /** Components this expression produces (vec2/3/4). Used for scalar-vs-vector typing. */
    getDimension(): number {
        return this.mDimension;
    }

    updateVariables(context: RemoteContext): void {
        for (let i = 0; i < this.mSrcValue.length; i++) {
            const v = this.mSrcValue[i];
            this.mPreCalc[i] = isResolvable(v) ? context.getFloat(idFromNan(v)) : v;
        }
    }

    registerListening(context: RemoteContext): void {
        // Register as the object owning these ids, so another op can discover that this is a
        // vector and how wide it is.
        context.putObject(this.mId, this);
        for (const v of this.mSrcValue) {
            if (isResolvable(v)) {
                context.listensTo(idFromNan(v), this);
            }
        }
    }

    apply(context: RemoteContext): void {
        let lanes = this.mRpn.apply(this.mPreCalc, this.mPreCalc.length, this.mOut);
        if (!this.allFinite(lanes)) {
            // A divide or normalize hit (near-)zero: retry with the soft-domain denominator.
            this.mRpn.mSoftDomain = true;
            try {
                lanes = this.mRpn.apply(this.mPreCalc, this.mPreCalc.length, this.mOut);
            } finally {
                this.mRpn.mSoftDomain = false;
            }
        }
        for (let k = 0; k < this.mDimension; k++) {
            let c = (k < lanes) ? this.mOut[k] : 0;
            if (!Number.isFinite(c)) {
                c = 0;   // never store a non-finite value; it would corrupt downstream reads
            }
            context.loadFloat(this.mId + k, c);
        }
    }

    private allFinite(lanes: number): boolean {
        for (let k = 0; k < lanes; k++) {
            if (!Number.isFinite(this.mOut[k])) {
                return false;
            }
        }
        return true;
    }

    write(buffer: WireBuffer): void {
        buffer.start(VectorExpression.OP_CODE);
        buffer.writeInt(this.mId);
        buffer.writeByte(this.mDimension);
        buffer.writeByte(this.mFlags);
        buffer.writeShort(this.mSrcValue.length);
        for (const v of this.mSrcValue) {
            buffer.writeFloat(v);
        }
    }

    deepToString(indent: string): string {
        return `${indent}VectorExpression[${this.mId}] dim=${this.mDimension}`;
    }

    /**
     * `id (int), dimension (byte), flags (byte), length (short), program (floats)`.
     *
     * The program is read with readNanId, not readFloat: operators and variable references are
     * NaN payloads that must survive the round trip bit for bit.
     */
    static read(buffer: WireBuffer, operations: Operation[]): void {
        const id = buffer.declareId();
        const dimension = buffer.readByte();
        const flags = buffer.readByte();
        const len = buffer.readShort();
        const values = new Float32Array(len);
        for (let i = 0; i < len; i++) {
            values[i] = buffer.readNanId();
        }
        operations.push(new VectorExpression(id, dimension, flags, values));
    }
}
