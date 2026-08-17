// The ten 3D operations, ported from the androidx `operations/d3` package.
//
// Each op decodes its payload and dispatches to a Paint3DContext. The dispatch is guarded: a
// paint context without 3D capability makes every one of these a no-op, which is how a 3D
// document degrades on a 2D-only player rather than failing to load.
//
// Six of the ten implement VariableSupport, so any float in the payload may be a NaN-boxed
// variable id that re-resolves each frame. That is what separates this from a mesh format — a
// primitive's radius, a camera's eye position and a light's direction are all expressions.
//
// Wire layout for each op is documented on its read(); it matches the reference byte for byte.

import { PaintOperation } from '../../PaintOperation';
import { Operation } from '../../Operation';
import type { PaintContext } from '../../PaintContext';
import type { RemoteContext } from '../../RemoteContext';
import type { VariableSupport } from '../../VariableSupport';
import type { WireBuffer } from '../../WireBuffer';
import { isVariable, idFromNan } from '../Utils';
import { isPaint3DContext, P3_CLEAR_DEPTH, P3_MATERIAL, P3_DEPTH_BIAS } from '../../d3/Paint3DContext';
import { build as buildPrimitive, MeshData } from '../../d3/Primitive3D';

/** Guards against a malformed or hostile document allocating unbounded buffers. */
const MAX_INDICES = 600_000;
const MAX_VERTS_FLOATS = 3 * 200_000;
const MAX_LIGHTS = 32;
const MAX_CHANNELS = 8;
const MAX_PRIMITIVE_FLOATS = 200_000;

/** `len` followed by the floats — the shape every variable-length 3D payload uses. */
function writeArray(buffer: WireBuffer, a: Float32Array): void {
    buffer.writeInt(a.length);
    for (const v of a) {
        buffer.writeFloat(v);
    }
}

/** An absent optional channel is encoded as a zero length, not as a missing field. */
function writeOptional(buffer: WireBuffer, a: Float32Array | null): void {
    if (a === null) {
        buffer.writeInt(0);
    } else {
        writeArray(buffer, a);
    }
}

function readFloats(buffer: WireBuffer, max: number, what: string): Float32Array {
    const len = buffer.readInt();
    if (len < 0 || len > max) {
        throw new Error(`${what}: bad length ${len}`);
    }
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
        out[i] = buffer.readFloat();
    }
    return out;
}

/** Resolve NaN-boxed variable ids in `src` into `dst`, leaving literals alone. */
function resolve(context: RemoteContext, src: Float32Array, dst: Float32Array): void {
    for (let i = 0; i < src.length; i++) {
        const v = src[i];
        dst[i] = isVariable(v) ? context.getFloat(idFromNan(v)) : v;
    }
}

function listen(context: RemoteContext, src: Float32Array, self: VariableSupport): void {
    for (const v of src) {
        if (isVariable(v)) {
            context.listensTo(idFromNan(v), self);
        }
    }
}

// ---------------------------------------------------------------------------
// DEFINE_MESH_3D (110)

/** Upload (or replace) a cached mesh keyed by id. */
export class DefineMesh3D extends PaintOperation {
    static readonly OP_CODE = 110;

    constructor(
        readonly mId: number,
        readonly mIndices: Int32Array,
        readonly mVerts: Float32Array,
        readonly mNormals: Float32Array | null,
        readonly mUv: Float32Array | null,
    ) {
        super();
    }

    paint(context: PaintContext): void {
        if (isPaint3DContext(context)) {
            context.defineMesh3D(this.mId, this.mIndices, this.mVerts, this.mNormals, this.mUv);
        }
    }

    write(buffer: WireBuffer): void {
        buffer.start(DefineMesh3D.OP_CODE);
        buffer.writeInt(this.mId);
        buffer.writeInt(this.mIndices.length);
        for (const v of this.mIndices) { buffer.writeInt(v); }
        buffer.writeInt(this.mVerts.length);
        for (const v of this.mVerts) { buffer.writeFloat(v); }
        writeOptional(buffer, this.mNormals);
        writeOptional(buffer, this.mUv);
    }

    deepToString(indent: string): string {
        return `${indent}DefineMesh3D(id=${this.mId}, tris=${this.mIndices.length / 3}, `
            + `verts=${this.mVerts.length / 3}, normals=${this.mNormals !== null})`;
    }

    /** `id, len+indices[], len+verts[], len+normals[], len+uv[]` (0 length = absent). */
    static read(buffer: WireBuffer, operations: Operation[]): void {
        const id = buffer.readInt();
        const idxLen = buffer.readInt();
        if (idxLen < 0 || idxLen > MAX_INDICES || (idxLen % 3) !== 0) {
            throw new Error(`DefineMesh3D: bad indices length ${idxLen}`);
        }
        const indices = new Int32Array(idxLen);
        for (let i = 0; i < idxLen; i++) {
            indices[i] = buffer.readInt();
        }
        const vertLen = buffer.readInt();
        if (vertLen < 0 || vertLen > MAX_VERTS_FLOATS || (vertLen % 3) !== 0) {
            throw new Error(`DefineMesh3D: bad verts length ${vertLen}`);
        }
        const verts = new Float32Array(vertLen);
        for (let i = 0; i < vertLen; i++) {
            verts[i] = buffer.readFloat();
        }
        const normLen = buffer.readInt();
        let normals: Float32Array | null = null;
        if (normLen !== 0) {
            if (normLen !== vertLen) {
                throw new Error(`DefineMesh3D: normals length ${normLen} != verts ${vertLen}`);
            }
            normals = new Float32Array(normLen);
            for (let i = 0; i < normLen; i++) {
                normals[i] = buffer.readFloat();
            }
        }
        const uvLen = buffer.readInt();
        let uv: Float32Array | null = null;
        if (uvLen !== 0) {
            if (uvLen !== (vertLen / 3) * 2) {
                throw new Error(`DefineMesh3D: uv length ${uvLen} != 2/3 verts ${vertLen}`);
            }
            uv = new Float32Array(uvLen);
            for (let i = 0; i < uvLen; i++) {
                uv[i] = buffer.readFloat();
            }
        }
        operations.push(new DefineMesh3D(id, indices, verts, normals, uv));
    }
}

// ---------------------------------------------------------------------------
// SET_CAMERA_3D (111)

/** Set projection and view in one call. Reactive: any parameter may be a variable. */
export class SetCamera3D extends PaintOperation implements VariableSupport {
    static readonly OP_CODE = 111;

    private mOutProj: Float32Array;
    private mOutView: Float32Array;

    constructor(
        readonly mProjection: number,
        readonly mProjParams: Float32Array,
        readonly mViewParams: Float32Array,
    ) {
        super();
        this.mOutProj = mProjParams.slice();
        this.mOutView = mViewParams.slice();
    }

    updateVariables(context: RemoteContext): void {
        resolve(context, this.mProjParams, this.mOutProj);
        resolve(context, this.mViewParams, this.mOutView);
    }

    registerListening(context: RemoteContext): void {
        listen(context, this.mProjParams, this);
        listen(context, this.mViewParams, this);
    }

    paint(context: PaintContext): void {
        if (isPaint3DContext(context)) {
            context.setCamera3D(this.mProjection, this.mOutProj, this.mOutView);
        }
    }

    write(buffer: WireBuffer): void {
        buffer.start(SetCamera3D.OP_CODE);
        buffer.writeInt(this.mProjection);
        writeArray(buffer, this.mProjParams);
        writeArray(buffer, this.mViewParams);
    }

    deepToString(indent: string): string {
        return `${indent}SetCamera3D(proj=${this.mProjection})`;
    }

    /**
     * `projection, len+projParams[], len+viewParams[]`. Perspective takes 4 floats
     * (fovYRadians, aspect, near, far), ortho 6 (l, r, b, t, n, f); view is always 9
     * (eye xyz, center xyz, up xyz) with gluLookAt semantics.
     */
    static read(buffer: WireBuffer, operations: Operation[]): void {
        const projection = buffer.readInt();
        const proj = readFloats(buffer, 16, 'SetCamera3D projParams');
        const view = readFloats(buffer, 16, 'SetCamera3D viewParams');
        operations.push(new SetCamera3D(projection, proj, view));
    }
}

// ---------------------------------------------------------------------------
// MATRIX_3D_OP (112)

/** Post-multiply the current modelview by a transform. Reactive. */
export class Matrix3DOp extends PaintOperation implements VariableSupport {
    static readonly OP_CODE = 112;

    private mOut: Float32Array;

    constructor(readonly mSub: number, readonly mArgs: Float32Array) {
        super();
        this.mOut = mArgs.slice();
    }

    updateVariables(context: RemoteContext): void {
        resolve(context, this.mArgs, this.mOut);
    }

    registerListening(context: RemoteContext): void {
        listen(context, this.mArgs, this);
    }

    paint(context: PaintContext): void {
        if (isPaint3DContext(context)) {
            context.matrix3Op(this.mSub, this.mOut);
        }
    }

    write(buffer: WireBuffer): void {
        buffer.start(Matrix3DOp.OP_CODE);
        buffer.writeInt(this.mSub);
        writeArray(buffer, this.mArgs);
    }

    deepToString(indent: string): string {
        return `${indent}Matrix3DOp(sub=${this.mSub}, args=${this.mOut.length})`;
    }

    /**
     * `sub, len+args[]`. IDENTITY takes 0 floats, TRANSLATE/SCALE 3 (x,y,z), ROTATE_AXIS 4
     * (angleRadians, axisX, axisY, axisZ), MULTIPLY 16 (column-major 4x4).
     */
    static read(buffer: WireBuffer, operations: Operation[]): void {
        const sub = buffer.readInt();
        const args = readFloats(buffer, 16, 'Matrix3DOp args');
        operations.push(new Matrix3DOp(sub, args));
    }
}

// ---------------------------------------------------------------------------
// DRAW_MESH_3D (113)

/** Draw a cached mesh with the current modelview, projection and paint color. */
export class DrawMesh3D extends PaintOperation {
    static readonly OP_CODE = 113;

    constructor(readonly mMeshId: number, readonly mMode: number) {
        super();
    }

    paint(context: PaintContext): void {
        if (isPaint3DContext(context)) {
            context.drawMesh3D(this.mMeshId, this.mMode);
        }
    }

    write(buffer: WireBuffer): void {
        buffer.start(DrawMesh3D.OP_CODE);
        buffer.writeInt(this.mMeshId);
        buffer.writeInt(this.mMode);
    }

    deepToString(indent: string): string {
        return `${indent}DrawMesh3D(mesh=${this.mMeshId}, mode=${this.mMode})`;
    }

    /** `meshId, mode`. Mode is `(backend << 1) | smoothBit`, plus wireframe flags. */
    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new DrawMesh3D(buffer.readInt(), buffer.readInt()));
    }
}

// ---------------------------------------------------------------------------
// PAINT_3D_STATE (114)

/** Consolidated render-state op: clear-depth, material, or depth-bias. Reactive. */
export class Paint3DState extends PaintOperation implements VariableSupport {
    static readonly OP_CODE = 114;

    private mOut: Float32Array;

    constructor(readonly mSub: number, readonly mParams: Float32Array) {
        super();
        this.mOut = mParams.slice();
    }

    updateVariables(context: RemoteContext): void {
        resolve(context, this.mParams, this.mOut);
    }

    registerListening(context: RemoteContext): void {
        listen(context, this.mParams, this);
    }

    paint(context: PaintContext): void {
        if (!isPaint3DContext(context)) {
            return;
        }
        switch (this.mSub) {
            case P3_CLEAR_DEPTH:
                context.clearDepth3D();
                break;
            case P3_MATERIAL:
                if (this.mOut.length >= 2) {
                    context.setMaterial3D(this.mOut[0], this.mOut[1]);
                }
                break;
            case P3_DEPTH_BIAS:
                if (this.mOut.length >= 2) {
                    context.setDepthBias3D(this.mOut[0], this.mOut[1]);
                }
                break;
            default:
                break;
        }
    }

    write(buffer: WireBuffer): void {
        buffer.start(Paint3DState.OP_CODE);
        buffer.writeInt(this.mSub);
        writeArray(buffer, this.mParams);
    }

    deepToString(indent: string): string {
        return `${indent}Paint3DState(sub=${this.mSub})`;
    }

    /** `sub, len+params[]` — CLEAR_DEPTH takes none, MATERIAL and DEPTH_BIAS two each. */
    static read(buffer: WireBuffer, operations: Operation[]): void {
        const sub = buffer.readInt();
        const params = readFloats(buffer, 8, 'Paint3DState params');
        operations.push(new Paint3DState(sub, params));
    }
}

// ---------------------------------------------------------------------------
// SET_LIGHTS_3D (115)

/** Define the entire light set in one op. Reactive in the parameter block. */
export class SetLights3D extends PaintOperation implements VariableSupport {
    static readonly OP_CODE = 115;

    private mOut: Float32Array;

    constructor(
        readonly mTypes: Int32Array,
        readonly mColors: Int32Array,
        readonly mParams: Float32Array,
    ) {
        super();
        this.mOut = mParams.slice();
    }

    updateVariables(context: RemoteContext): void {
        resolve(context, this.mParams, this.mOut);
    }

    registerListening(context: RemoteContext): void {
        listen(context, this.mParams, this);
    }

    paint(context: PaintContext): void {
        if (isPaint3DContext(context)) {
            context.setLights3D(this.mTypes, this.mColors, this.mOut);
        }
    }

    write(buffer: WireBuffer): void {
        buffer.start(SetLights3D.OP_CODE);
        buffer.writeInt(this.mTypes.length);
        for (let i = 0; i < this.mTypes.length; i++) {
            buffer.writeInt(this.mTypes[i]);
            buffer.writeInt(this.mColors[i]);
        }
        writeArray(buffer, this.mParams);
    }

    deepToString(indent: string): string {
        return `${indent}SetLights3D(n=${this.mTypes.length})`;
    }

    /**
     * `n, (type, colorArgb) x n, len+params[]` with 4 floats per light —
     * `dirX,dirY,dirZ,intensity` for directional, `posX,posY,posZ,intensity` for point.
     * An empty set means ambient only; never calling this leaves a default headlight.
     */
    static read(buffer: WireBuffer, operations: Operation[]): void {
        const n = buffer.readInt();
        if (n < 0 || n > MAX_LIGHTS) {
            throw new Error(`SetLights3D: bad light count ${n}`);
        }
        const types = new Int32Array(n);
        const colors = new Int32Array(n);
        for (let i = 0; i < n; i++) {
            types[i] = buffer.readInt();
            colors[i] = buffer.readInt();
        }
        const params = readFloats(buffer, MAX_LIGHTS * 4, 'SetLights3D params');
        operations.push(new SetLights3D(types, colors, params));
    }
}

// ---------------------------------------------------------------------------
// SET_TEXTURE_3D (118)

/** Set the active texture for subsequent draws; bitmapId 0 clears it. */
export class SetTexture3D extends PaintOperation {
    static readonly OP_CODE = 118;

    constructor(readonly mBitmapId: number) {
        super();
    }

    paint(context: PaintContext): void {
        if (isPaint3DContext(context)) {
            context.setTexture3D(this.mBitmapId);
        }
    }

    write(buffer: WireBuffer): void {
        buffer.start(SetTexture3D.OP_CODE);
        buffer.writeInt(this.mBitmapId);
    }

    deepToString(indent: string): string {
        return `${indent}SetTexture3D(bitmap=${this.mBitmapId})`;
    }

    /** `bitmapId`. */
    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new SetTexture3D(buffer.readInt()));
    }
}

// ---------------------------------------------------------------------------
// MESH_PRIMITIVE_3D (120)

/**
 * Define a mesh from a parametric primitive. The geometry math lives in Primitive3D; this op
 * carries only the type, a sampling control and the parameter channels, and builds the mesh on
 * first paint. Reactive: any parameter may be a variable, and a change invalidates the cached
 * geometry so it is regenerated on the next frame.
 *
 * `segments` is a type-dependent sampling control — the number of radial/longitudinal divisions
 * (a cylinder with segments = 3 is a triangular prism); secondary subdivisions are derived from
 * it. A value <= 0 means "the type's default".
 */
export class MeshPrimitive extends PaintOperation implements VariableSupport {
    static readonly OP_CODE = 120;

    private mOutSegments: number;
    private mOutData: Float32Array[];
    /** Built from the resolved params; nulled when a watched variable changes. */
    private mMesh: MeshData | null = null;
    /** Set once if the build throws, so a broken shape is reported once and not every frame. */
    private mFailed = false;

    constructor(
        readonly mId: number,
        readonly mType: number,
        readonly mSegments: number,
        readonly mFlags: number,
        readonly mData: Float32Array[],
    ) {
        super();
        this.mOutSegments = mSegments;
        this.mOutData = mData.map((c) => c.slice());
    }

    updateVariables(context: RemoteContext): void {
        this.mOutSegments = isVariable(this.mSegments)
            ? context.getFloat(idFromNan(this.mSegments)) : this.mSegments;
        for (let c = 0; c < this.mData.length; c++) {
            resolve(context, this.mData[c], this.mOutData[c]);
        }
        // A driving variable changed, so the geometry must be regenerated on the next paint.
        this.mMesh = null;
        this.mFailed = false;
    }

    registerListening(context: RemoteContext): void {
        if (isVariable(this.mSegments)) {
            context.listensTo(idFromNan(this.mSegments), this);
        }
        for (const channel of this.mData) {
            listen(context, channel, this);
        }
    }

    paint(context: PaintContext): void {
        if (!isPaint3DContext(context) || this.mFailed) {
            return;
        }
        if (this.mMesh === null) {
            try {
                this.mMesh = buildPrimitive(this.mType, this.mOutSegments, this.mFlags,
                    this.mOutData);
            } catch (e) {
                this.mFailed = true;
                console.warn(`MeshPrimitive(id=${this.mId}): ${(e as Error).message}`);
                return;
            }
        }
        const m = this.mMesh;
        context.defineMesh3D(this.mId, m.indices, m.verts, m.normals, m.uv);
    }

    write(buffer: WireBuffer): void {
        buffer.start(MeshPrimitive.OP_CODE);
        buffer.writeInt(this.mId);
        buffer.writeInt(this.mType);
        buffer.writeFloat(this.mSegments);
        buffer.writeInt(this.mFlags);
        buffer.writeInt(this.mData.length);
        for (const ch of this.mData) {
            writeArray(buffer, ch);
        }
    }

    deepToString(indent: string): string {
        return `${indent}MeshPrimitive(id=${this.mId}, type=${this.mType}, `
            + `segments=${this.mSegments}, channels=${this.mData.length})`;
    }

    /** `id, type, segments, flags, channelCount, (len + floats) x channelCount`. */
    static read(buffer: WireBuffer, operations: Operation[]): void {
        const id = buffer.readInt();
        const type = buffer.readInt();
        const segments = buffer.readFloat();
        const flags = buffer.readInt();
        const channels = buffer.readInt();
        if (channels < 0 || channels > MAX_CHANNELS) {
            throw new Error(`MeshPrimitive: bad channel count ${channels}`);
        }
        const data: Float32Array[] = [];
        for (let c = 0; c < channels; c++) {
            data.push(readFloats(buffer, MAX_PRIMITIVE_FLOATS, 'MeshPrimitive channel'));
        }
        operations.push(new MeshPrimitive(id, type, segments, flags, data));
    }
}
