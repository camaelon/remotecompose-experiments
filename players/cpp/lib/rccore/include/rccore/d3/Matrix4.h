#pragma once
// Matrix4: 4x4 column-major float math for the software 3D renderer.
//
// Port of the reference Matrix4.java. Indexing is m[col*4 + row] — the OpenGL layout.
// Right-handed, +Y up, -Z forward.
//
// Unlike the TypeScript port, nothing here needs explicit rounding: C++ `float` is genuinely
// 32-bit, so transcribing the reference's expressions verbatim reproduces its arithmetic
// exactly. (The TS port had to wrap every operation in Math.fround because JS carries
// intermediates in float64 — see players/3D_PLAN.md.)

namespace rccore::d3 {

void identity(float* out);
void copyMat(float* dst, const float* src);

/** out = a x b (column-major). out may alias a or b. */
void multiply(float* out, const float* a, const float* b);

/** Post-multiply by a translation — glTranslate semantics. */
void translate(float* m, float tx, float ty, float tz);

/** Post-multiply by a non-uniform scale — glScale semantics. */
void scaleM(float* m, float sx, float sy, float sz);

/** Post-multiply by a rotation about a (possibly unnormalized) axis — glRotate, radians. */
void rotateAxis(float* m, float angleRadians, float x, float y, float z);

/** gluPerspective. fovYRadians is the full vertical field of view. */
void perspective(float* out, float fovYRadians, float aspect, float near, float far);

/** glOrtho. */
void ortho(float* out, float left, float right, float bottom, float top,
           float near, float far);

/** gluLookAt, right-handed. */
void lookAt(float* out, float eyeX, float eyeY, float eyeZ,
            float centerX, float centerY, float centerZ,
            float upX, float upY, float upZ);

/** Transform the homogeneous point (x,y,z,1), writing x',y',z',w' into out4. */
void transformPoint(const float* m, float x, float y, float z, float* out4);

/** Transform the direction (x,y,z,0) — ignores translation — writing 3 floats into out3. */
void transformDirection(const float* m, float x, float y, float z, float* out3);

} // namespace rccore::d3
