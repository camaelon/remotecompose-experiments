// Matrix4: 4x4 column-major float math for the 3D software renderer.
//
// Port of the reference Matrix4.java. Indexing is m[col*4 + row] — the OpenGL layout.
// Right-handed, +Y up, -Z forward.
//
// Every arithmetic step rounds to float32 through fm()/fa(), because Java evaluates these
// expressions in `float` and rounds after each operation, while JS would carry them in float64
// and round only on the store. That difference is not cosmetic: it moves a projected vertex by
// ~1e-6, which shifts the 28.4 fixed-point rasterizer coordinate by one step and changes which
// pixels a triangle covers. Validated by pixel-diff against the Java reference — the version of
// this file that rounded only on store disagreed on 1456 pixels.

export type Mat4 = Float32Array;

const fround = Math.fround;

/** float32 multiply. */
function fm(a: number, b: number): number {
    return fround(a * b);
}

/** float32 add. */
function fa(a: number, b: number): number {
    return fround(a + b);
}

/** float32 `sqrt(x*x + y*y + z*z)` — the reference computes the sum in float, then sqrts. */
function flen3(x: number, y: number, z: number): number {
    return fround(Math.sqrt(fa(fa(fm(x, x), fm(y, y)), fm(z, z))));
}

export function mat4(): Mat4 {
    const m = new Float32Array(16);
    identity(m);
    return m;
}

export function identity(out: Mat4): void {
    out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
    out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
}

export function copy(dst: Mat4, src: Mat4): void {
    dst.set(src);
}

const MUL_SCRATCH = new Float32Array(16);

/** out = a x b (column-major). out may alias a or b. */
export function multiply(out: Mat4, a: Mat4, b: Mat4): void {
    const r = MUL_SCRATCH;
    for (let col = 0; col < 4; col++) {
        const cb = col * 4;
        for (let row = 0; row < 4; row++) {
            r[cb + row] = fa(fa(fa(
                fm(a[row], b[cb]),
                fm(a[4 + row], b[cb + 1])),
                fm(a[8 + row], b[cb + 2])),
                fm(a[12 + row], b[cb + 3]));
        }
    }
    out.set(r);
}

/** Post-multiply m by a translation (m := m x T) — glTranslate semantics. */
export function translate(m: Mat4, tx: number, ty: number, tz: number): void {
    m[12] = fa(m[12], fa(fa(fm(m[0], tx), fm(m[4], ty)), fm(m[8], tz)));
    m[13] = fa(m[13], fa(fa(fm(m[1], tx), fm(m[5], ty)), fm(m[9], tz)));
    m[14] = fa(m[14], fa(fa(fm(m[2], tx), fm(m[6], ty)), fm(m[10], tz)));
    m[15] = fa(m[15], fa(fa(fm(m[3], tx), fm(m[7], ty)), fm(m[11], tz)));
}

/** Post-multiply m by a non-uniform scale — glScale semantics. */
export function scale(m: Mat4, sx: number, sy: number, sz: number): void {
    m[0] = fm(m[0], sx); m[1] = fm(m[1], sx); m[2] = fm(m[2], sx); m[3] = fm(m[3], sx);
    m[4] = fm(m[4], sy); m[5] = fm(m[5], sy); m[6] = fm(m[6], sy); m[7] = fm(m[7], sy);
    m[8] = fm(m[8], sz); m[9] = fm(m[9], sz); m[10] = fm(m[10], sz); m[11] = fm(m[11], sz);
}

/** Post-multiply m by a rotation about a (possibly unnormalized) axis — glRotate, radians. */
export function rotateAxis(m: Mat4, angleRadians: number, x: number, y: number, z: number): void {
    const len = flen3(x, y, z);
    if (len === 0) {
        return;
    }
    const ix = fround(x / len);
    const iy = fround(y / len);
    const iz = fround(z / len);
    // Java: (float) Math.cos(double) — computed in double, rounded once on assignment.
    const c = fround(Math.cos(angleRadians));
    const s = fround(Math.sin(angleRadians));
    const omc = fround(1 - c);

    const r00 = fa(fm(fm(ix, ix), omc), c);
    const r01 = fa(fm(fm(iy, ix), omc), fm(iz, s));
    const r02 = fround(fm(fm(iz, ix), omc) - fm(iy, s));

    const r10 = fround(fm(fm(ix, iy), omc) - fm(iz, s));
    const r11 = fa(fm(fm(iy, iy), omc), c);
    const r12 = fa(fm(fm(iz, iy), omc), fm(ix, s));

    const r20 = fa(fm(fm(ix, iz), omc), fm(iy, s));
    const r21 = fround(fm(fm(iy, iz), omc) - fm(ix, s));
    const r22 = fa(fm(fm(iz, iz), omc), c);

    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];

    m[0] = fa(fa(fm(a00, r00), fm(a10, r01)), fm(a20, r02));
    m[1] = fa(fa(fm(a01, r00), fm(a11, r01)), fm(a21, r02));
    m[2] = fa(fa(fm(a02, r00), fm(a12, r01)), fm(a22, r02));
    m[3] = fa(fa(fm(a03, r00), fm(a13, r01)), fm(a23, r02));

    m[4] = fa(fa(fm(a00, r10), fm(a10, r11)), fm(a20, r12));
    m[5] = fa(fa(fm(a01, r10), fm(a11, r11)), fm(a21, r12));
    m[6] = fa(fa(fm(a02, r10), fm(a12, r11)), fm(a22, r12));
    m[7] = fa(fa(fm(a03, r10), fm(a13, r11)), fm(a23, r12));

    m[8] = fa(fa(fm(a00, r20), fm(a10, r21)), fm(a20, r22));
    m[9] = fa(fa(fm(a01, r20), fm(a11, r21)), fm(a21, r22));
    m[10] = fa(fa(fm(a02, r20), fm(a12, r21)), fm(a22, r22));
    m[11] = fa(fa(fm(a03, r20), fm(a13, r21)), fm(a23, r22));
}

/** gluPerspective. fovYRadians is the full vertical field of view. */
export function perspective(out: Mat4, fovYRadians: number, aspect: number,
                            near: number, far: number): void {
    // Java computes this one in double and casts: (float)(1.0 / Math.tan(fovY * 0.5)).
    const f = fround(1.0 / Math.tan(fovYRadians * 0.5));
    const nf = fround(1 / fround(near - far));
    out[0] = fround(f / aspect); out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = fm(fa(far, near), nf); out[11] = -1;
    out[12] = 0; out[13] = 0; out[14] = fm(fm(fm(2, far), near), nf); out[15] = 0;
}

/** glOrtho. */
export function ortho(out: Mat4, left: number, right: number, bottom: number,
                      top: number, near: number, far: number): void {
    const lr = fround(1 / fround(left - right));
    const bt = fround(1 / fround(bottom - top));
    const nf = fround(1 / fround(near - far));
    out[0] = fm(-2, lr); out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = fm(-2, bt); out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = fm(2, nf); out[11] = 0;
    out[12] = fm(fa(left, right), lr);
    out[13] = fm(fa(top, bottom), bt);
    out[14] = fm(fa(far, near), nf);
    out[15] = 1;
}

/** gluLookAt, right-handed. */
export function lookAt(out: Mat4,
                       eyeX: number, eyeY: number, eyeZ: number,
                       centerX: number, centerY: number, centerZ: number,
                       upX: number, upY: number, upZ: number): void {
    let fx = fround(centerX - eyeX);
    let fy = fround(centerY - eyeY);
    let fz = fround(centerZ - eyeZ);
    const fl = flen3(fx, fy, fz);
    if (fl === 0) {
        identity(out);
        return;
    }
    fx = fround(fx / fl); fy = fround(fy / fl); fz = fround(fz / fl);

    // s = f x up
    let sx = fround(fm(fy, upZ) - fm(fz, upY));
    let sy = fround(fm(fz, upX) - fm(fx, upZ));
    let sz = fround(fm(fx, upY) - fm(fy, upX));
    const sl = flen3(sx, sy, sz);
    if (sl === 0) {
        identity(out);
        return;
    }
    sx = fround(sx / sl); sy = fround(sy / sl); sz = fround(sz / sl);

    // u = s x f
    const ux = fround(fm(sy, fz) - fm(sz, fy));
    const uy = fround(fm(sz, fx) - fm(sx, fz));
    const uz = fround(fm(sx, fy) - fm(sy, fx));

    out[0] = sx; out[1] = ux; out[2] = -fx; out[3] = 0;
    out[4] = sy; out[5] = uy; out[6] = -fy; out[7] = 0;
    out[8] = sz; out[9] = uz; out[10] = -fz; out[11] = 0;
    out[12] = -fa(fa(fm(sx, eyeX), fm(sy, eyeY)), fm(sz, eyeZ));
    out[13] = -fa(fa(fm(ux, eyeX), fm(uy, eyeY)), fm(uz, eyeZ));
    out[14] = fa(fa(fm(fx, eyeX), fm(fy, eyeY)), fm(fz, eyeZ));
    out[15] = 1;
}

/** Transform the homogeneous point (x,y,z,1), writing x',y',z',w' into out4. */
export function transformPoint(m: Mat4, x: number, y: number, z: number,
                               out4: Float32Array): void {
    out4[0] = fa(fa(fa(fm(m[0], x), fm(m[4], y)), fm(m[8], z)), m[12]);
    out4[1] = fa(fa(fa(fm(m[1], x), fm(m[5], y)), fm(m[9], z)), m[13]);
    out4[2] = fa(fa(fa(fm(m[2], x), fm(m[6], y)), fm(m[10], z)), m[14]);
    out4[3] = fa(fa(fa(fm(m[3], x), fm(m[7], y)), fm(m[11], z)), m[15]);
}

/** Transform the direction (x,y,z,0) — ignores translation — writing 3 floats into out3. */
export function transformDirection(m: Mat4, x: number, y: number, z: number,
                                   out3: Float32Array): void {
    out3[0] = fa(fa(fm(m[0], x), fm(m[4], y)), fm(m[8], z));
    out3[1] = fa(fa(fm(m[1], x), fm(m[5], y)), fm(m[9], z));
    out3[2] = fa(fa(fm(m[2], x), fm(m[6], y)), fm(m[10], z));
}
