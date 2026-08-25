// MeshExpression (op 117): a procedural mesh generated from RPN float-expressions.
//
// Port of the reference MeshExpression.java — the 3D analogue of PathExpression. Expressions are
// evaluated over a (u,v) grid every frame with VAR1 = u and VAR2 = v, and the result is uploaded
// under this op's mesh id, so the ordinary drawMesh3D draws it. Because the expressions can
// reference `time`, the *surface itself* animates rather than just its transform — a wave field
// or a deforming sphere costs a few dozen bytes and no per-frame traffic.
//
// The `type` selects the surface family, which fixes how many position expressions are evaluated
// per vertex. That is an efficiency decision, not a convenience one: SURFACE_GENERAL evaluates
// three expressions per vertex, the specialized families evaluate one over an analytic base.

import { PaintOperation } from '../../PaintOperation';
import { Operation } from '../../Operation';
import type { PaintContext } from '../../PaintContext';
import type { RemoteContext } from '../../RemoteContext';
import type { VariableSupport } from '../../VariableSupport';
import type { WireBuffer } from '../../WireBuffer';
import { isNaNBits, idFromBits, floatToRawIntBits, idFromNan } from '../Utils';
import { AnimatedFloatExpression } from '../utilities/AnimatedFloatExpression';
import { isPaint3DContext } from '../../d3/Paint3DContext';

/** Surface families. */
export const SURFACE_GENERAL = 0;
export const SURFACE_HEIGHT_FIELD = 1;
export const SURFACE_SPHERE = 2;
export const SURFACE_CYLINDER = 3;

/** Reverse triangle winding (front/back), per surface orientation. */
export const FLAG_FLIP_WINDING = 0x1;

const MAX_ARRAY = 4096;
const MAX_GROUP = 8;

/** Guard against a grid that would allocate unreasonably; the reference has no such cap. */
const MAX_GRID = 1024;

const ID_REGION_MASK = 0x3 << 20;
const ID_REGION_ARRAY = 0x2 << 20;

function isDataVariableBits(b: number): boolean {
    if (!isNaNBits(b)) {
        return false;
    }
    return (idFromBits(b) & ID_REGION_MASK) === ID_REGION_ARRAY;
}

/**
 * A global variable reference that must be resolved to a literal before evaluation.
 *
 * Operators and data (array) variables are also NaN-boxed but must survive untouched — an
 * operator resolved as if it were a variable would turn the expression into gibberish.
 */
function isResolvable(v: number): boolean {
    if (!Number.isNaN(v)) {
        return false;
    }
    const bits = floatToRawIntBits(v);
    return !AnimatedFloatExpression.isMathOperator(v) && !isDataVariableBits(bits);
}

function lerp(a: number, b: number, t: number): number {
    return Math.fround(a + Math.fround(Math.fround(b - a) * t));
}

export class MeshExpression extends PaintOperation implements VariableSupport {
    static readonly OP_CODE = 117;

    // Variable-resolved copies: globals replaced by literals, VAR1/VAR2 and operators kept.
    private mOutParams: Float32Array;
    private mOutPos: Float32Array[];
    private mOutNormal: Float32Array[];
    private mOutUv: Float32Array[];

    private mEval = new AnimatedFloatExpression();

    // Output buffers, resized when the grid resolution changes.
    private mVerts = new Float32Array(0);
    private mNormalsBuf = new Float32Array(0);
    private mUvBuf = new Float32Array(0);
    private mIndices = new Int32Array(0);
    private mGridU = -1;
    private mGridV = -1;

    // The two parameters last fed to the position/normal/uv expressions (u,v or x,z).
    private mLastA = 0;
    private mLastB = 0;

    constructor(
        readonly mId: number,
        readonly mType: number,
        readonly mFlags: number,
        readonly mParams: Float32Array,
        readonly mPos: Float32Array[],
        readonly mNormal: Float32Array[],
        readonly mUv: Float32Array[],
    ) {
        super();
        this.mOutParams = mParams.slice();
        this.mOutPos = mPos.map((e) => e.slice());
        this.mOutNormal = mNormal.map((e) => e.slice());
        this.mOutUv = mUv.map((e) => e.slice());
    }

    // ----- variable support -------------------------------------------------

    updateVariables(context: RemoteContext): void {
        for (let i = 0; i < this.mParams.length; i++) {
            this.mOutParams[i] = isResolvable(this.mParams[i])
                ? context.getFloat(idFromNan(this.mParams[i])) : this.mParams[i];
        }
        MeshExpression.resolveGroup(context, this.mPos, this.mOutPos);
        MeshExpression.resolveGroup(context, this.mNormal, this.mOutNormal);
        MeshExpression.resolveGroup(context, this.mUv, this.mOutUv);
    }

    private static resolveGroup(context: RemoteContext,
                                src: Float32Array[], dst: Float32Array[]): void {
        for (let e = 0; e < src.length; e++) {
            const inArr = src[e];
            const out = dst[e];
            for (let i = 0; i < inArr.length; i++) {
                out[i] = isResolvable(inArr[i])
                    ? context.getFloat(idFromNan(inArr[i])) : inArr[i];
            }
        }
    }

    registerListening(context: RemoteContext): void {
        for (const v of this.mParams) {
            if (isResolvable(v)) {
                context.listensTo(idFromNan(v), this);
            }
        }
        this.listenGroup(context, this.mPos);
        this.listenGroup(context, this.mNormal);
        this.listenGroup(context, this.mUv);
    }

    private listenGroup(context: RemoteContext, group: Float32Array[]): void {
        for (const e of group) {
            for (const v of e) {
                if (isResolvable(v)) {
                    context.listensTo(idFromNan(v), this);
                }
            }
        }
    }

    // ----- evaluation -------------------------------------------------------

    paint(context: PaintContext): void {
        if (!isPaint3DContext(context)) {
            return;
        }
        const ca = context.getContext().getCollectionsAccess();

        const uCount = this.gridCount(0);
        const vCount = this.gridCount(1);
        if (uCount < 2 || vCount < 2 || uCount > MAX_GRID || vCount > MAX_GRID) {
            return;
        }
        this.ensureBuffers(uCount, vCount);

        // Pass 1: positions and (optional) UV.
        const hasUv = this.mOutUv.length >= 2;
        for (let i = 0; i < uCount; i++) {
            const fu = Math.fround(i / (uCount - 1));
            for (let j = 0; j < vCount; j++) {
                const fv = Math.fround(j / (vCount - 1));
                const idx = i * vCount + j;
                this.position(idx * 3, fu, fv, ca);
                if (hasUv) {
                    this.mUvBuf[idx * 2] = this.eval(this.mOutUv[0], this.mLastA, this.mLastB, ca);
                    this.mUvBuf[idx * 2 + 1] =
                        this.eval(this.mOutUv[1], this.mLastA, this.mLastB, ca);
                } else {
                    this.mUvBuf[idx * 2] = fu;
                    this.mUvBuf[idx * 2 + 1] = fv;
                }
            }
        }

        // Pass 2: normals — explicit expressions, else finite differences of the grid.
        if (this.mOutNormal.length >= 3) {
            for (let i = 0; i < uCount; i++) {
                const fu = Math.fround(i / (uCount - 1));
                for (let j = 0; j < vCount; j++) {
                    const fv = Math.fround(j / (vCount - 1));
                    const n = (i * vCount + j) * 3;
                    this.paramsFor(fu, fv);
                    this.mNormalsBuf[n] =
                        this.eval(this.mOutNormal[0], this.mLastA, this.mLastB, ca);
                    this.mNormalsBuf[n + 1] =
                        this.eval(this.mOutNormal[1], this.mLastA, this.mLastB, ca);
                    this.mNormalsBuf[n + 2] =
                        this.eval(this.mOutNormal[2], this.mLastA, this.mLastB, ca);
                }
            }
        } else {
            this.computeFiniteDifferenceNormals(uCount, vCount);
        }

        context.defineMesh3D(this.mId, this.mIndices, this.mVerts, this.mNormalsBuf, this.mUvBuf);
    }

    private gridCount(axis: number): number {
        switch (this.mType) {
            case SURFACE_HEIGHT_FIELD:
                return Math.trunc(this.mOutParams[axis === 0 ? 2 : 5]);
            case SURFACE_SPHERE:
                return Math.trunc(this.mOutParams[axis === 0 ? 1 : 2]);
            case SURFACE_CYLINDER:
                return Math.trunc(this.mOutParams[axis === 0 ? 2 : 3]);
            default:
                return Math.trunc(this.mOutParams[axis === 0 ? 2 : 5]);
        }
    }

    /** The (a,b) expression parameters for grid fractions (fu,fv), per surface type. */
    private paramsFor(fu: number, fv: number): void {
        const p = this.mOutParams;
        switch (this.mType) {
            case SURFACE_HEIGHT_FIELD:
                this.mLastA = lerp(p[0], p[1], fu);      // x
                this.mLastB = lerp(p[3], p[4], fv);      // z
                break;
            case SURFACE_SPHERE:
                this.mLastA = Math.fround(fu * Math.fround(2.0 * Math.PI));   // longitude
                this.mLastB = Math.fround(fv * Math.fround(Math.PI));        // latitude
                break;
            case SURFACE_CYLINDER:
                this.mLastA = Math.fround(fu * Math.fround(2.0 * Math.PI));   // angle
                this.mLastB = lerp(Math.fround(-p[1] * 0.5), Math.fround(p[1] * 0.5), fv);
                break;
            default:
                this.mLastA = lerp(p[0], p[1], fu);
                this.mLastB = lerp(p[3], p[4], fv);
                break;
        }
    }

    /** Evaluate the position into mVerts at `off`; also sets mLastA/mLastB. */
    private position(off: number, fu: number, fv: number, ca: unknown): void {
        this.paramsFor(fu, fv);
        const a = this.mLastA;
        const b = this.mLastB;
        switch (this.mType) {
            case SURFACE_HEIGHT_FIELD: {
                let h = this.eval(this.mOutPos[0], a, b, ca);
                const yMin = this.mOutParams[6];
                const yMax = this.mOutParams[7];
                if (h < yMin) { h = yMin; }
                if (h > yMax) { h = yMax; }
                this.mVerts[off] = a;
                this.mVerts[off + 1] = h;
                this.mVerts[off + 2] = b;
                break;
            }
            case SURFACE_SPHERE: {
                const r = Math.fround(this.mOutParams[0] + this.eval(this.mOutPos[0], a, b, ca));
                const sinV = Math.fround(Math.sin(b));
                this.mVerts[off] = Math.fround(Math.fround(r * sinV) * Math.fround(Math.cos(a)));
                this.mVerts[off + 1] = Math.fround(r * Math.fround(Math.cos(b)));
                this.mVerts[off + 2] =
                    Math.fround(Math.fround(r * sinV) * Math.fround(Math.sin(a)));
                break;
            }
            case SURFACE_CYLINDER: {
                const r = Math.fround(this.mOutParams[0] + this.eval(this.mOutPos[0], a, b, ca));
                this.mVerts[off] = Math.fround(r * Math.fround(Math.cos(a)));
                this.mVerts[off + 1] = b;
                this.mVerts[off + 2] = Math.fround(r * Math.fround(Math.sin(a)));
                break;
            }
            default: {
                this.mVerts[off] = this.eval(this.mOutPos[0], a, b, ca);
                this.mVerts[off + 1] = this.eval(this.mOutPos[1], a, b, ca);
                this.mVerts[off + 2] = this.eval(this.mOutPos[2], a, b, ca);
                break;
            }
        }
    }

    /** Central-difference surface normals from the sampled grid, clamped at the edges. */
    private computeFiniteDifferenceNormals(uCount: number, vCount: number): void {
        const fr = Math.fround;
        const V = this.mVerts;
        for (let i = 0; i < uCount; i++) {
            const ip = Math.min(i + 1, uCount - 1);
            const im = Math.max(i - 1, 0);
            for (let j = 0; j < vCount; j++) {
                const jp = Math.min(j + 1, vCount - 1);
                const jm = Math.max(j - 1, 0);
                const a = (ip * vCount + j) * 3;
                const b = (im * vCount + j) * 3;
                const c = (i * vCount + jp) * 3;
                const d = (i * vCount + jm) * 3;
                const dux = fr(V[a] - V[b]);
                const duy = fr(V[a + 1] - V[b + 1]);
                const duz = fr(V[a + 2] - V[b + 2]);
                const dvx = fr(V[c] - V[d]);
                const dvy = fr(V[c + 1] - V[d + 1]);
                const dvz = fr(V[c + 2] - V[d + 2]);
                const nx = fr(fr(duy * dvz) - fr(duz * dvy));
                const ny = fr(fr(duz * dvx) - fr(dux * dvz));
                const nz = fr(fr(dux * dvy) - fr(duy * dvx));
                const len = fr(Math.sqrt(fr(fr(fr(nx * nx) + fr(ny * ny)) + fr(nz * nz))));
                const n = (i * vCount + j) * 3;
                if (len > 1e-8) {
                    this.mNormalsBuf[n] = fr(nx / len);
                    this.mNormalsBuf[n + 1] = fr(ny / len);
                    this.mNormalsBuf[n + 2] = fr(nz / len);
                } else {
                    this.mNormalsBuf[n] = 0;
                    this.mNormalsBuf[n + 1] = 1;
                    this.mNormalsBuf[n + 2] = 0;
                }
            }
        }
    }

    private eval(expr: Float32Array, a: number, b: number, ca: unknown): number {
        if (ca) {
            return this.mEval.eval(ca, expr, expr.length, a, b);
        }
        return this.mEval.eval(expr, expr.length, a, b);
    }

    private ensureBuffers(uCount: number, vCount: number): void {
        const verts = uCount * vCount;
        if (this.mVerts.length !== verts * 3) {
            this.mVerts = new Float32Array(verts * 3);
            this.mNormalsBuf = new Float32Array(verts * 3);
            this.mUvBuf = new Float32Array(verts * 2);
        }
        if (this.mGridU !== uCount || this.mGridV !== vCount) {
            this.buildIndices(uCount, vCount);
            this.mGridU = uCount;
            this.mGridV = vCount;
        }
    }

    private buildIndices(uCount: number, vCount: number): void {
        this.mIndices = new Int32Array((uCount - 1) * (vCount - 1) * 6);
        const flip = (this.mFlags & FLAG_FLIP_WINDING) !== 0;
        let k = 0;
        for (let i = 0; i < uCount - 1; i++) {
            for (let j = 0; j < vCount - 1; j++) {
                const a = i * vCount + j;
                const b = i * vCount + (j + 1);
                const c = (i + 1) * vCount + (j + 1);
                const d = (i + 1) * vCount + j;
                if (flip) {
                    this.mIndices[k++] = a; this.mIndices[k++] = c; this.mIndices[k++] = b;
                    this.mIndices[k++] = c; this.mIndices[k++] = a; this.mIndices[k++] = d;
                } else {
                    this.mIndices[k++] = a; this.mIndices[k++] = b; this.mIndices[k++] = c;
                    this.mIndices[k++] = c; this.mIndices[k++] = d; this.mIndices[k++] = a;
                }
            }
        }
    }

    // ----- wire -------------------------------------------------------------

    write(buffer: WireBuffer): void {
        buffer.start(MeshExpression.OP_CODE);
        buffer.writeInt(this.mId);
        buffer.writeInt(this.mType);
        buffer.writeInt(this.mFlags);
        writeArray(buffer, this.mParams);
        writeGroup(buffer, this.mPos);
        writeGroup(buffer, this.mNormal);
        writeGroup(buffer, this.mUv);
    }

    deepToString(indent: string): string {
        return `${indent}MeshExpression(id=${this.mId}, type=${this.mType}, `
            + `params=${this.mParams.length}, pos=${this.mPos.length})`;
    }

    /**
     * `id, type, flags, params[], pos[][], normal[][], uv[][]`.
     *
     * Expression floats are read with readNanId, not readFloat: an operator or variable
     * reference is a NaN payload that must survive the round trip bit for bit.
     */
    static read(buffer: WireBuffer, operations: Operation[]): void {
        const id = buffer.readInt();
        const type = buffer.readInt();
        const flags = buffer.readInt();
        const params = readArray(buffer);
        const pos = readGroup(buffer);
        const normal = readGroup(buffer);
        const uv = readGroup(buffer);
        operations.push(new MeshExpression(id, type, flags, params, pos, normal, uv));
    }
}

function writeArray(buffer: WireBuffer, a: Float32Array): void {
    buffer.writeInt(a.length);
    for (const v of a) {
        buffer.writeFloat(v);
    }
}

function writeGroup(buffer: WireBuffer, group: Float32Array[]): void {
    buffer.writeInt(group.length);
    for (const e of group) {
        writeArray(buffer, e);
    }
}

function readArray(buffer: WireBuffer): Float32Array {
    const len = buffer.readInt();
    if (len < 0 || len > MAX_ARRAY) {
        throw new Error(`MeshExpression: bad array length ${len}`);
    }
    const a = new Float32Array(len);
    for (let i = 0; i < len; i++) {
        a[i] = buffer.readNanId();
    }
    return a;
}

function readGroup(buffer: WireBuffer): Float32Array[] {
    const n = buffer.readInt();
    if (n < 0 || n > MAX_GROUP) {
        throw new Error(`MeshExpression: bad group count ${n}`);
    }
    const g: Float32Array[] = [];
    for (let i = 0; i < n; i++) {
        g.push(readArray(buffer));
    }
    return g;
}
