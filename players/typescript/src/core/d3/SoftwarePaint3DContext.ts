// SoftwarePaint3DContext: the pure-software 3D renderer.
//
// Port of the reference JavaPaint3DContext. Owns an ARGB color buffer and a float depth buffer,
// transforms and lights each triangle, and hands it to the Rasterizer. Nothing here touches a
// canvas, a GPU or the DOM — the host reads getColorBuffer() and composites.
//
// This is the backend every player must have. The mode word in DRAW_MESH_3D selects a backend,
// but an unimplemented backend falls back here, so a document renders the same picture whether
// or not the platform has GL. See Paint3DContext.ts for the mode encoding.
//
// Conventions: right-handed, +Y up, -Z forward; column-major 4x4; clip = P x V x M; matrix ops
// post-multiply the modelview; CCW front-facing; window-z in [0,1], smaller = closer.

import {
    Mat4, mat4, identity, multiply, translate, scale, rotateAxis,
    perspective, ortho, lookAt, transformPoint, transformDirection,
} from './Matrix4';
import {
    clearDepth, fillTriangle, fillTriangleGouraud, fillTriangleTextured,
    fillTriangleDepthOnly, drawLineDepthTested,
} from './Rasterizer';
import {
    PROJECTION_PERSPECTIVE, LIGHT_POINT, LIGHT_DIRECTIONAL,
    M3_IDENTITY, M3_TRANSLATE, M3_SCALE, M3_ROTATE_AXIS, M3_MULTIPLY,
    MODE_SMOOTH_MASK, MODE_WIREFRAME, WIRE_EDGE0, WIRE_EDGE1, WIRE_EDGE2, WIRE_EDGE_MASK,
} from './Paint3DContext';

const fround = Math.fround;

/** float32 multiply / add — see Matrix4.ts for why every step rounds. */
function fm(a: number, b: number): number { return fround(a * b); }
function fa(a: number, b: number): number { return fround(a + b); }

/** Java's `1f/255f` — a float32 constant, not float64 1/255. */
const INV_255 = Math.fround(1 / 255);

/** Near-plane rejection: a vertex with clip w below this is behind or on the eye. */
const NEAR_W_EPSILON = 0.0001;

/**
 * Ambient floor, so triangles facing away from every light still show their color.
 *
 * fround matters: the reference declares this `0.2f`, and float32(0.2) != float64(0.2). Seeded
 * into every shaded pixel's accumulator, that difference alone shifted whole faces by one 8-bit
 * level against the oracle. The lighting math below rounds at each step for the same reason —
 * Java accumulates these sums in float32.
 */
const AMBIENT = Math.fround(0.2);

/** Cap on accumulated lights, guarding a document that re-adds without clearing. */
const MAX_LIGHTS = 32;

/**
 * Window-z bias for wireframe edge lines: an edge sits exactly on its own triangle's plane, so
 * without a small camera-ward bias it fails the depth test against the depth its own face wrote.
 */
const WIRE_DEPTH_BIAS = 6e-4;

interface Mesh {
    indices: Int32Array;
    verts: Float32Array;
    normals: Float32Array | null;
    uv: Float32Array | null;
}

interface Light {
    type: number;
    r: number; g: number; b: number;
    wx: number; wy: number; wz: number;
    intensity: number;
}

export class SoftwarePaint3DContext {
    private mProj: Mat4 = mat4();
    private mView: Mat4 = mat4();
    private mModel: Mat4 = mat4();
    private mPV: Mat4 = mat4();
    private mMVP: Mat4 = mat4();
    private mMV: Mat4 = mat4();

    private mMeshes = new Map<number, Mesh>();

    private mColor: Int32Array | null = null;
    private mZbuf: Float32Array | null = null;
    private mWidth = 0;
    private mHeight = 0;

    private mBaseColorArgb = 0xFFFFFFFF | 0;

    // Lighting state. Until a light op runs we use a default headlight, so an untouched
    // document is never unlit.
    private mLights: Light[] = [];
    private mLightsTouched = false;

    // Per-draw eye-space light scratch (parallel arrays, filled by prepareLightsEyeSpace).
    private mNumEyeLights = 0;
    private mEType = new Int32Array(0);
    private mElx = new Float32Array(0);
    private mEly = new Float32Array(0);
    private mElz = new Float32Array(0);
    private mElr = new Float32Array(0);
    private mElg = new Float32Array(0);
    private mElb = new Float32Array(0);

    private mScratch4 = new Float32Array(4);
    private mLightScratch3 = new Float32Array(3);
    private mNormal3 = new Float32Array(3);

    // Software texture (host-decoded ARGB pixels).
    private mTexPixels: Int32Array | null = null;
    private mTexW = 0;
    private mTexH = 0;

    // Specular material (Blinn-Phong). 0 strength => matte (default, no specular cost).
    private mSpecStrength = 0;
    private mShininess = 32;

    // Polygon-offset depth bias (window-z units). Both 0 => no bias.
    private mDepthBiasC = 0;
    private mDepthBiasS = 0;

    /** Per-triangle screen-space output of projectTriangle: sx,sy,sz x 3. */
    private mTriScreen = new Float32Array(9);
    /** Per-vertex shaded ARGB of the last accepted triangle, in vertex order. */
    private mTriColor = new Int32Array(3);
    /** Per-vertex 1/clipW, for perspective-correct attribute interpolation. */
    private mTriInvW = new Float32Array(3);

    // ----- Buffers ----------------------------------------------------------

    /**
     * (Re)allocate the color and depth buffers if the size changed. Pixels are NOT cleared
     * here — call clearDepth3D() to start a new 3D pass.
     */
    setSize(width: number, height: number): void {
        if (width <= 0 || height <= 0) {
            return;
        }
        if (this.mColor === null || this.mWidth !== width || this.mHeight !== height) {
            this.mColor = new Int32Array(width * height);
            this.mZbuf = new Float32Array(width * height);
            this.mWidth = width;
            this.mHeight = height;
            clearDepth(this.mZbuf);
        }
    }

    getWidth(): number { return this.mWidth; }
    getHeight(): number { return this.mHeight; }

    /** Engine color buffer (ARGB, length w*h). Null before setSize. */
    getColorBuffer(): Int32Array | null { return this.mColor; }

    setBaseColorArgb(argb: number): void { this.mBaseColorArgb = argb | 0; }
    getBaseColorArgb(): number { return this.mBaseColorArgb; }

    // ----- Paint3DContext ---------------------------------------------------

    defineMesh3D(id: number, indices: Int32Array, verts: Float32Array,
                 normals: Float32Array | null, uv: Float32Array | null = null): void {
        this.mMeshes.set(id, { indices, verts, normals, uv });
    }

    setCamera3D(projection: number, projParams: Float32Array | number[],
                viewParams: Float32Array | number[]): void {
        if (projection === PROJECTION_PERSPECTIVE) {
            if (projParams.length !== 4) {
                return;
            }
            perspective(this.mProj, projParams[0], projParams[1], projParams[2], projParams[3]);
        } else {
            if (projParams.length !== 6) {
                return;
            }
            ortho(this.mProj, projParams[0], projParams[1], projParams[2],
                projParams[3], projParams[4], projParams[5]);
        }
        if (viewParams.length !== 9) {
            return;
        }
        lookAt(this.mView,
            viewParams[0], viewParams[1], viewParams[2],
            viewParams[3], viewParams[4], viewParams[5],
            viewParams[6], viewParams[7], viewParams[8]);
        identity(this.mModel);
    }

    matrix3Op(sub: number, args: Float32Array | number[]): void {
        switch (sub) {
            case M3_IDENTITY:
                identity(this.mModel);
                break;
            case M3_TRANSLATE:
                if (args.length === 3) {
                    translate(this.mModel, args[0], args[1], args[2]);
                }
                break;
            case M3_SCALE:
                if (args.length === 3) {
                    scale(this.mModel, args[0], args[1], args[2]);
                }
                break;
            case M3_ROTATE_AXIS:
                if (args.length === 4) {
                    rotateAxis(this.mModel, args[0], args[1], args[2], args[3]);
                }
                break;
            case M3_MULTIPLY:
                if (args.length === 16) {
                    const m = args instanceof Float32Array ? args : new Float32Array(args);
                    multiply(this.mModel, this.mModel, m);
                }
                break;
            default:
                break;
        }
    }

    clearDepth3D(): void {
        if (this.mZbuf === null || this.mColor === null) {
            return;
        }
        clearDepth(this.mZbuf);
        // Also clear the color buffer to transparent so the host's existing canvas content
        // shows through where the 3D pass writes nothing.
        this.mColor.fill(0);
    }

    setLights3D(types: Int32Array | number[], colors: Int32Array | number[],
                params: Float32Array | number[]): void {
        this.mLights = [];
        const n = types.length;
        for (let i = 0; i < n && this.mLights.length < MAX_LIGHTS; i++) {
            const p = i * 4;
            if (p + 3 >= params.length) {
                break;
            }
            const argb = colors[i] | 0;
            this.mLights.push({
                type: types[i],
                r: fround(((argb >>> 16) & 0xFF) * INV_255),
                g: fround(((argb >>> 8) & 0xFF) * INV_255),
                b: fround((argb & 0xFF) * INV_255),
                wx: params[p], wy: params[p + 1], wz: params[p + 2],
                intensity: params[p + 3],
            });
        }
        this.mLightsTouched = true;
    }

    /** The software engine has no bitmap store; the host supplies pixels via setTextureData. */
    setTexture3D(_bitmapId: number): void { /* nothing to do */ }

    setMaterial3D(specStrength: number, shininess: number): void {
        this.mSpecStrength = specStrength;
        this.mShininess = shininess > 0 ? shininess : 1;
    }

    setDepthBias3D(constant: number, slope: number): void {
        this.mDepthBiasC = constant;
        this.mDepthBiasS = slope;
    }

    /** Host-supplied texture pixels (ARGB, length w*h); null clears the texture. */
    setTextureData(pixels: Int32Array | null, w: number, h: number): void {
        this.mTexPixels = pixels;
        this.mTexW = w;
        this.mTexH = h;
    }

    // ----- Lighting ---------------------------------------------------------

    private ensureEyeLightCapacity(n: number): void {
        if (this.mEType.length < n) {
            this.mEType = new Int32Array(n);
            this.mElx = new Float32Array(n);
            this.mEly = new Float32Array(n);
            this.mElz = new Float32Array(n);
            this.mElr = new Float32Array(n);
            this.mElg = new Float32Array(n);
            this.mElb = new Float32Array(n);
        }
    }

    /**
     * Resolve the active lights into eye space for the current view. Directional lights store
     * the unit vector *toward* the light; point lights store their eye-space position. Color is
     * premultiplied by intensity.
     */
    private prepareLightsEyeSpace(): void {
        if (!this.mLightsTouched) {
            this.ensureEyeLightCapacity(1);
            this.mEType[0] = LIGHT_DIRECTIONAL;
            this.mElx[0] = 0;
            this.mEly[0] = 0;
            this.mElz[0] = 1;
            this.mElr[0] = 1 - AMBIENT;
            this.mElg[0] = 1 - AMBIENT;
            this.mElb[0] = 1 - AMBIENT;
            this.mNumEyeLights = 1;
            return;
        }
        const n = this.mLights.length;
        this.ensureEyeLightCapacity(n);
        for (let i = 0; i < n; i++) {
            const l = this.mLights[i];
            this.mEType[i] = l.type;
            if (l.type === LIGHT_POINT) {
                transformPoint(this.mView, l.wx, l.wy, l.wz, this.mScratch4);
                this.mElx[i] = this.mScratch4[0];
                this.mEly[i] = this.mScratch4[1];
                this.mElz[i] = this.mScratch4[2];
            } else {
                // Directional: world travel direction -> eye, store the unit vector to the light.
                transformDirection(this.mView, l.wx, l.wy, l.wz, this.mLightScratch3);
                let x = -this.mLightScratch3[0];
                let y = -this.mLightScratch3[1];
                let z = -this.mLightScratch3[2];
                const len = fround(Math.sqrt(fa(fa(fm(x, x), fm(y, y)), fm(z, z))));
                if (len > 0) {
                    x = fround(x / len); y = fround(y / len); z = fround(z / len);
                }
                this.mElx[i] = x;
                this.mEly[i] = y;
                this.mElz[i] = z;
            }
            this.mElr[i] = l.r * l.intensity;
            this.mElg[i] = l.g * l.intensity;
            this.mElb[i] = l.b * l.intensity;
        }
        this.mNumEyeLights = n;
    }

    /**
     * Lambert-light a vertex: base modulated by ambient plus each light's (two-sided) N.L.
     * (nx,ny,nz) is the eye-space normal (need not be unit); (px,py,pz) the eye-space position.
     */
    private litColor(base: number, nx: number, ny: number, nz: number,
                     px: number, py: number, pz: number): number {
        const nlen = fround(Math.sqrt(fa(fa(fm(nx, nx), fm(ny, ny)), fm(nz, nz))));
        const inv = (nlen === 0) ? 0 : fround(1 / nlen);
        if (this.mSpecStrength > 0) {
            return this.litColorSpecular(base, nx * inv, ny * inv, nz * inv, px, py, pz);
        }
        let lr = AMBIENT, lg = AMBIENT, lb = AMBIENT;
        for (let i = 0; i < this.mNumEyeLights; i++) {
            let lx: number, ly: number, lz: number;
            if (this.mEType[i] === LIGHT_POINT) {
                lx = this.mElx[i] - px;
                ly = this.mEly[i] - py;
                lz = this.mElz[i] - pz;
                const ll = fround(Math.sqrt(fa(fa(fm(lx, lx), fm(ly, ly)), fm(lz, lz))));
                if (ll > 0) {
                    lx = fround(lx / ll); ly = fround(ly / ll); lz = fround(lz / ll);
                }
            } else {
                lx = this.mElx[i]; ly = this.mEly[i]; lz = this.mElz[i];
            }
            let d = fm(fa(fa(fm(nx, lx), fm(ny, ly)), fm(nz, lz)), inv);
            if (d < 0) {
                d = -d; // two-sided at this profile (no per-face material sidedness)
            }
            lr = fround(lr + fround(this.mElr[i] * d));
            lg = fround(lg + fround(this.mElg[i] * d));
            lb = fround(lb + fround(this.mElb[i] * d));
        }
        const a = (base >>> 24) & 0xFF;
        let r = Math.trunc(fm((base >>> 16) & 0xFF, lr));
        let g = Math.trunc(fm((base >>> 8) & 0xFF, lg));
        let b = Math.trunc(fm(base & 0xFF, lb));
        if (r > 255) { r = 255; }
        if (g > 255) { g = 255; }
        if (b > 255) { b = 255; }
        return ((a << 24) | (r << 16) | (g << 8) | b) | 0;
    }

    /**
     * Glossy shading (only when specStrength > 0): diffuse Lambert modulating the base color
     * plus an additive white Blinn-Phong highlight. The normal is unit and is flipped to face
     * the viewer, so highlights land on the lit side only.
     */
    private litColorSpecular(base: number, nfx: number, nfy: number, nfz: number,
                             px: number, py: number, pz: number): number {
        const vlen = fround(Math.sqrt(fa(fa(fm(px, px), fm(py, py)), fm(pz, pz))));
        let vx = 0, vy = 0, vz = 1;
        if (vlen > 0) {
            vx = fround(-px / vlen); vy = fround(-py / vlen); vz = fround(-pz / vlen);
        }
        if (fa(fa(fm(nfx, vx), fm(nfy, vy)), fm(nfz, vz)) < 0) {
            nfx = -nfx; nfy = -nfy; nfz = -nfz;
        }
        let lr = AMBIENT, lg = AMBIENT, lb = AMBIENT;
        let sr = 0, sg = 0, sb = 0;
        for (let i = 0; i < this.mNumEyeLights; i++) {
            let lx: number, ly: number, lz: number;
            if (this.mEType[i] === LIGHT_POINT) {
                lx = this.mElx[i] - px;
                ly = this.mEly[i] - py;
                lz = this.mElz[i] - pz;
                const ll = fround(Math.sqrt(lx * lx + ly * ly + lz * lz));
                if (ll > 0) {
                    lx /= ll; ly /= ll; lz /= ll;
                }
            } else {
                lx = this.mElx[i]; ly = this.mEly[i]; lz = this.mElz[i];
            }
            const ndl = fa(fa(fm(nfx, lx), fm(nfy, ly)), fm(nfz, lz));
            if (ndl <= 0) {
                continue; // facing away from this light: no diffuse, no highlight
            }
            lr = fa(lr, fm(this.mElr[i], ndl));
            lg = fa(lg, fm(this.mElg[i], ndl));
            lb = fa(lb, fm(this.mElb[i], ndl));
            const hx = lx + vx, hy = ly + vy, hz = lz + vz;
            const hlen = fround(Math.sqrt(fa(fa(fm(hx, hx), fm(hy, hy)), fm(hz, hz))));
            if (hlen <= 0) {
                continue;
            }
            const ndh = fround(fa(fa(fm(nfx, hx), fm(nfy, hy)), fm(nfz, hz)) / hlen);
            if (ndh <= 0) {
                continue;
            }
            const spec = fm(fround(Math.pow(ndh, this.mShininess)), this.mSpecStrength);
            sr = fa(sr, fm(this.mElr[i], spec));
            sg = fa(sg, fm(this.mElg[i], spec));
            sb = fa(sb, fm(this.mElb[i], spec));
        }
        const a = (base >>> 24) & 0xFF;
        let r = Math.trunc(((base >>> 16) & 0xFF) * lr + sr * 255);
        let g = Math.trunc(((base >>> 8) & 0xFF) * lg + sg * 255);
        let b = Math.trunc((base & 0xFF) * lb + sb * 255);
        if (r > 255) { r = 255; }
        if (g > 255) { g = 255; }
        if (b > 255) { b = 255; }
        return ((a << 24) | (r << 16) | (g << 8) | b) | 0;
    }

    // ----- Drawing ----------------------------------------------------------

    drawMesh3D(meshId: number, mode: number): void {
        const m = this.mMeshes.get(meshId);
        if (m === undefined || this.mColor === null || this.mZbuf === null) {
            return;
        }
        const w = this.mWidth;
        const h = this.mHeight;
        const pixels = this.mColor;

        multiply(this.mPV, this.mProj, this.mView);
        multiply(this.mMV, this.mView, this.mModel);
        multiply(this.mMVP, this.mPV, this.mModel);
        this.prepareLightsEyeSpace();

        const baseColor = this.mBaseColorArgb;
        const idx = m.indices;
        const verts = m.verts;
        const normals = m.normals;
        const uv = m.uv;

        if ((mode & MODE_WIREFRAME) !== 0) {
            this.drawMeshWireframe(idx, verts, normals, baseColor, w, h, pixels, mode);
            return;
        }

        // Smooth requested by mode, but only possible when the mesh carries normals.
        const smooth = (mode & MODE_SMOOTH_MASK) !== 0 && normals !== null;
        const textured = this.mTexPixels !== null && uv !== null;
        // Glossy flat faces carry a per-vertex specular gradient -> interpolate via Gouraud.
        const interpolate = smooth || this.mSpecStrength > 0;

        const ts = this.mTriScreen;
        const tc = this.mTriColor;
        for (let t = 0; t < idx.length; t += 3) {
            if (!this.projectTriangle(idx, verts, normals, smooth, textured, t, baseColor, w, h)) {
                continue;
            }
            if (textured) {
                const q0 = idx[t] * 2, q1 = idx[t + 1] * 2, q2 = idx[t + 2] * 2;
                fillTriangleTextured(
                    this.mZbuf, pixels, this.mTexPixels!, this.mTexW, this.mTexH,
                    tc[2], tc[1], tc[0], w, h,
                    ts[6], ts[7], ts[8], uv![q2], uv![q2 + 1], this.mTriInvW[2],
                    ts[3], ts[4], ts[5], uv![q1], uv![q1 + 1], this.mTriInvW[1],
                    ts[0], ts[1], ts[2], uv![q0], uv![q0 + 1], this.mTriInvW[0]);
            } else if (interpolate) {
                fillTriangleGouraud(this.mZbuf, pixels, tc[2], tc[1], tc[0], w, h,
                    ts[6], ts[7], ts[8], ts[3], ts[4], ts[5], ts[0], ts[1], ts[2]);
            } else {
                fillTriangle(this.mZbuf, pixels, tc[0], w, h,
                    ts[6], ts[7], ts[8], ts[3], ts[4], ts[5], ts[0], ts[1], ts[2]);
            }
        }
    }

    /**
     * Hidden-line wireframe. Two passes over the front-facing triangles: rasterize each into the
     * depth buffer only (transparent faces), then draw the selected edges as depth-tested lines,
     * so edges on visible surface show and edges behind nearer surface are occluded.
     */
    private drawMeshWireframe(idx: Int32Array, verts: Float32Array,
                              normals: Float32Array | null, lineColor: number,
                              w: number, h: number, pixels: Int32Array, mode: number): void {
        let edges = mode & WIRE_EDGE_MASK;
        if (edges === 0) {
            edges = WIRE_EDGE_MASK; // no selection => all three edges
        }
        const e0 = (edges & WIRE_EDGE0) !== 0;
        const e1 = (edges & WIRE_EDGE1) !== 0;
        const e2 = (edges & WIRE_EDGE2) !== 0;
        const ts = this.mTriScreen;

        // Pass 1: depth prepass — fill front faces into the z-buffer, no color.
        for (let t = 0; t < idx.length; t += 3) {
            if (!this.projectTriangle(idx, verts, normals, false, false, t, lineColor, w, h)) {
                continue;
            }
            fillTriangleDepthOnly(this.mZbuf!, w, h,
                ts[6], ts[7], ts[8], ts[3], ts[4], ts[5], ts[0], ts[1], ts[2]);
        }
        // Pass 2: draw the selected edges, depth-tested against the prepass.
        for (let t = 0; t < idx.length; t += 3) {
            if (!this.projectTriangle(idx, verts, normals, false, false, t, lineColor, w, h)) {
                continue;
            }
            const ax = ts[0], ay = ts[1], az = ts[2];
            const bx = ts[3], by = ts[4], bz = ts[5];
            const cx = ts[6], cy = ts[7], cz = ts[8];
            if (e0) {
                drawLineDepthTested(this.mZbuf!, pixels, lineColor, w, h,
                    ax, ay, az, bx, by, bz, WIRE_DEPTH_BIAS);
            }
            if (e1) {
                drawLineDepthTested(this.mZbuf!, pixels, lineColor, w, h,
                    bx, by, bz, cx, cy, cz, WIRE_DEPTH_BIAS);
            }
            if (e2) {
                drawLineDepthTested(this.mZbuf!, pixels, lineColor, w, h,
                    cx, cy, cz, ax, ay, az, WIRE_DEPTH_BIAS);
            }
        }
    }

    /**
     * Project, near-reject, backface-cull and Lambert shade one triangle. On acceptance fills
     * mTriScreen with the three screen-space vertices (Y already flipped for a top-down buffer)
     * and mTriColor with the per-vertex shaded ARGB, and returns true. Returns false — leaving
     * the scratch untouched — when the triangle is degenerate, crosses the near plane, or is
     * back-facing.
     */
    private projectTriangle(idx: Int32Array, verts: Float32Array,
                            normals: Float32Array | null, smooth: boolean,
                            computeInvW: boolean, t: number, baseColor: number,
                            w: number, h: number): boolean {
        const i0 = idx[t] * 3;
        const i1 = idx[t + 1] * 3;
        const i2 = idx[t + 2] * 3;
        if (i0 < 0 || i1 < 0 || i2 < 0
            || i0 + 2 >= verts.length || i1 + 2 >= verts.length || i2 + 2 >= verts.length) {
            return false;
        }
        const s4 = this.mScratch4;

        transformPoint(this.mMVP, verts[i0], verts[i0 + 1], verts[i0 + 2], s4);
        const cx0 = s4[0], cy0 = s4[1], cz0 = s4[2], cw0 = s4[3];
        transformPoint(this.mMVP, verts[i1], verts[i1 + 1], verts[i1 + 2], s4);
        const cx1 = s4[0], cy1 = s4[1], cz1 = s4[2], cw1 = s4[3];
        transformPoint(this.mMVP, verts[i2], verts[i2 + 1], verts[i2 + 2], s4);
        const cx2 = s4[0], cy2 = s4[1], cz2 = s4[2], cw2 = s4[3];

        if (cw0 < NEAR_W_EPSILON || cw1 < NEAR_W_EPSILON || cw2 < NEAR_W_EPSILON) {
            return false;
        }
        if (computeInvW) {
            // Only the textured path needs 1/w; skip these divisions otherwise.
            this.mTriInvW[0] = 1 / cw0;
            this.mTriInvW[1] = 1 / cw1;
            this.mTriInvW[2] = 1 / cw2;
        }

        // Perspective divide and viewport map, rounding after every operation to match the
        // reference's float arithmetic. Rounding only the final store left these coordinates a
        // single ULP off, which is enough to move the 28.4 fixed-point cell and change coverage.
        const nx0 = fround(cx0 / cw0), ny0 = fround(cy0 / cw0), nz0 = fround(cz0 / cw0);
        const nx1 = fround(cx1 / cw1), ny1 = fround(cy1 / cw1), nz1 = fround(cz1 / cw1);
        const nx2 = fround(cx2 / cw2), ny2 = fround(cy2 / cw2), nz2 = fround(cz2 / cw2);

        const sx0 = fm(fa(fm(nx0, 0.5), 0.5), w);
        const sy0 = fm(fround(1 - fa(fm(ny0, 0.5), 0.5)), h);
        let sz0 = fa(fm(nz0, 0.5), 0.5);
        const sx1 = fm(fa(fm(nx1, 0.5), 0.5), w);
        const sy1 = fm(fround(1 - fa(fm(ny1, 0.5), 0.5)), h);
        let sz1 = fa(fm(nz1, 0.5), 0.5);
        const sx2 = fm(fa(fm(nx2, 0.5), 0.5), w);
        const sy2 = fm(fround(1 - fa(fm(ny2, 0.5), 0.5)), h);
        let sz2 = fa(fm(nz2, 0.5), 0.5);

        // Backface cull in screen space (Y down). CCW-in-NDC becomes CW after the Y flip, so a
        // positive signed area means the triangle is back-facing.
        const signedArea = fround(fm(fround(sx1 - sx0), fround(sy2 - sy0))
            - fm(fround(sx2 - sx0), fround(sy1 - sy0)));
        if (signedArea > 0) {
            return false;
        }

        // Polygon-offset depth bias: shift all three vertices' depth by the same amount, which
        // is exactly a shift of the triangle's z-plane constant, so there is no per-pixel cost.
        if ((this.mDepthBiasC !== 0 || this.mDepthBiasS !== 0) && signedArea !== 0) {
            const invA = fround(1 / signedArea);
            const dzdx = fm(fround(fm(fround(sz1 - sz0), fround(sy2 - sy0))
                - fm(fround(sz2 - sz0), fround(sy1 - sy0))), invA);
            const dzdy = fm(fround(fm(fround(sz2 - sz0), fround(sx1 - sx0))
                - fm(fround(sz1 - sz0), fround(sx2 - sx0))), invA);
            const slope = Math.max(Math.abs(dzdx), Math.abs(dzdy));
            const bias = fa(this.mDepthBiasC, fm(this.mDepthBiasS, slope));
            sz0 = fa(sz0, bias);
            sz1 = fa(sz1, bias);
            sz2 = fa(sz2, bias);
        }

        const ts = this.mTriScreen;
        ts[0] = sx0; ts[1] = sy0; ts[2] = sz0;
        ts[3] = sx1; ts[4] = sy1; ts[5] = sz1;
        ts[6] = sx2; ts[7] = sy2; ts[8] = sz2;

        // Eye-space positions: needed for point-light direction and the flat face normal.
        transformPoint(this.mMV, verts[i0], verts[i0 + 1], verts[i0 + 2], s4);
        const ev0x = s4[0], ev0y = s4[1], ev0z = s4[2];
        transformPoint(this.mMV, verts[i1], verts[i1 + 1], verts[i1 + 2], s4);
        const ev1x = s4[0], ev1y = s4[1], ev1z = s4[2];
        transformPoint(this.mMV, verts[i2], verts[i2 + 1], verts[i2 + 2], s4);
        const ev2x = s4[0], ev2y = s4[1], ev2z = s4[2];

        const tc = this.mTriColor;
        const n3 = this.mNormal3;
        if (smooth && normals !== null
            && i0 + 2 < normals.length && i1 + 2 < normals.length && i2 + 2 < normals.length) {
            // Smooth (Gouraud): light each vertex by its own eye-space normal and position.
            transformDirection(this.mMV, normals[i0], normals[i0 + 1], normals[i0 + 2], n3);
            tc[0] = this.litColor(baseColor, n3[0], n3[1], n3[2], ev0x, ev0y, ev0z);
            transformDirection(this.mMV, normals[i1], normals[i1 + 1], normals[i1 + 2], n3);
            tc[1] = this.litColor(baseColor, n3[0], n3[1], n3[2], ev1x, ev1y, ev1z);
            transformDirection(this.mMV, normals[i2], normals[i2 + 1], normals[i2 + 2], n3);
            tc[2] = this.litColor(baseColor, n3[0], n3[1], n3[2], ev2x, ev2y, ev2z);
        } else {
            // Flat: one eye-space face normal (cross product of two edges).
            const ax = fround(ev1x - ev0x), ay = fround(ev1y - ev0y), az = fround(ev1z - ev0z);
            const bx = fround(ev2x - ev0x), by = fround(ev2y - ev0y), bz = fround(ev2z - ev0z);
            const nxn = fround(fm(ay, bz) - fm(az, by));
            const nyn = fround(fm(az, bx) - fm(ax, bz));
            const nzn = fround(fm(ax, by) - fm(ay, bx));
            if (this.mSpecStrength > 0) {
                // Glossy: keep the flat face normal but light each vertex at its own eye
                // position, so the view-dependent highlight gradates across the face.
                tc[0] = this.litColor(baseColor, nxn, nyn, nzn, ev0x, ev0y, ev0z);
                tc[1] = this.litColor(baseColor, nxn, nyn, nzn, ev1x, ev1y, ev1z);
                tc[2] = this.litColor(baseColor, nxn, nyn, nzn, ev2x, ev2y, ev2z);
            } else {
                const third = fround(1 / 3);
                const cx = fm(fa(fa(ev0x, ev1x), ev2x), third);
                const cy = fm(fa(fa(ev0y, ev1y), ev2y), third);
                const cz = fm(fa(fa(ev0z, ev1z), ev2z), third);
                const shaded = this.litColor(baseColor, nxn, nyn, nzn, cx, cy, cz);
                tc[0] = shaded;
                tc[1] = shaded;
                tc[2] = shaded;
            }
        }
        return true;
    }
}
