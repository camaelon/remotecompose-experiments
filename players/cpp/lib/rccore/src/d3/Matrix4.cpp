#include "rccore/d3/Matrix4.h"

#include "rccore/d3/JavaMath.h"

#include <cmath>
#include <cstring>

namespace rccore::d3 {

void identity(float* out) {
    out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = 1; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
    out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
}

void copyMat(float* dst, const float* src) { std::memcpy(dst, src, 16 * sizeof(float)); }

void multiply(float* out, const float* a, const float* b) {
    float r[16];
    for (int col = 0; col < 4; col++) {
        int cb = col * 4;
        for (int row = 0; row < 4; row++) {
            r[cb + row] = a[row] * b[cb]
                        + a[4 + row] * b[cb + 1]
                        + a[8 + row] * b[cb + 2]
                        + a[12 + row] * b[cb + 3];
        }
    }
    std::memcpy(out, r, sizeof(r));
}

void translate(float* m, float tx, float ty, float tz) {
    m[12] += m[0] * tx + m[4] * ty + m[8] * tz;
    m[13] += m[1] * tx + m[5] * ty + m[9] * tz;
    m[14] += m[2] * tx + m[6] * ty + m[10] * tz;
    m[15] += m[3] * tx + m[7] * ty + m[11] * tz;
}

void scaleM(float* m, float sx, float sy, float sz) {
    m[0] *= sx; m[1] *= sx; m[2] *= sx; m[3] *= sx;
    m[4] *= sy; m[5] *= sy; m[6] *= sy; m[7] *= sy;
    m[8] *= sz; m[9] *= sz; m[10] *= sz; m[11] *= sz;
}

void rotateAxis(float* m, float angleRadians, float x, float y, float z) {
    float len = (float) jsqrt((double)(x * x + y * y + z * z));
    if (len == 0.f) return;
    float ix = x / len, iy = y / len, iz = z / len;
    float c = (float) jcos((double)(angleRadians));
    float s = (float) jsin((double)(angleRadians));
    float omc = 1.f - c;

    float r00 = ix * ix * omc + c;
    float r01 = iy * ix * omc + iz * s;
    float r02 = iz * ix * omc - iy * s;
    float r10 = ix * iy * omc - iz * s;
    float r11 = iy * iy * omc + c;
    float r12 = iz * iy * omc + ix * s;
    float r20 = ix * iz * omc + iy * s;
    float r21 = iy * iz * omc - ix * s;
    float r22 = iz * iz * omc + c;

    float a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
    float a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    float a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];

    m[0] = a00 * r00 + a10 * r01 + a20 * r02;
    m[1] = a01 * r00 + a11 * r01 + a21 * r02;
    m[2] = a02 * r00 + a12 * r01 + a22 * r02;
    m[3] = a03 * r00 + a13 * r01 + a23 * r02;
    m[4] = a00 * r10 + a10 * r11 + a20 * r12;
    m[5] = a01 * r10 + a11 * r11 + a21 * r12;
    m[6] = a02 * r10 + a12 * r11 + a22 * r12;
    m[7] = a03 * r10 + a13 * r11 + a23 * r12;
    m[8] = a00 * r20 + a10 * r21 + a20 * r22;
    m[9] = a01 * r20 + a11 * r21 + a21 * r22;
    m[10] = a02 * r20 + a12 * r21 + a22 * r22;
    m[11] = a03 * r20 + a13 * r21 + a23 * r22;
}

void perspective(float* out, float fovYRadians, float aspect, float near, float far) {
    float f = (float) (1.0 / std::tan(fovYRadians * 0.5));
    float nf = 1.f / (near - far);
    out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = (far + near) * nf; out[11] = -1;
    out[12] = 0; out[13] = 0; out[14] = 2.f * far * near * nf; out[15] = 0;
}

void ortho(float* out, float left, float right, float bottom, float top,
           float near, float far) {
    float lr = 1.f / (left - right);
    float bt = 1.f / (bottom - top);
    float nf = 1.f / (near - far);
    out[0] = -2.f * lr; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = -2.f * bt; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = 2.f * nf; out[11] = 0;
    out[12] = (left + right) * lr;
    out[13] = (top + bottom) * bt;
    out[14] = (far + near) * nf;
    out[15] = 1;
}

void lookAt(float* out, float eyeX, float eyeY, float eyeZ,
            float centerX, float centerY, float centerZ,
            float upX, float upY, float upZ) {
    float fx = centerX - eyeX, fy = centerY - eyeY, fz = centerZ - eyeZ;
    float fl = (float) jsqrt((double)(fx * fx + fy * fy + fz * fz));
    if (fl == 0.f) { identity(out); return; }
    fx /= fl; fy /= fl; fz /= fl;

    float sx = fy * upZ - fz * upY;
    float sy = fz * upX - fx * upZ;
    float sz = fx * upY - fy * upX;
    float sl = (float) jsqrt((double)(sx * sx + sy * sy + sz * sz));
    if (sl == 0.f) { identity(out); return; }
    sx /= sl; sy /= sl; sz /= sl;

    float ux = sy * fz - sz * fy;
    float uy = sz * fx - sx * fz;
    float uz = sx * fy - sy * fx;

    out[0] = sx; out[1] = ux; out[2] = -fx; out[3] = 0;
    out[4] = sy; out[5] = uy; out[6] = -fy; out[7] = 0;
    out[8] = sz; out[9] = uz; out[10] = -fz; out[11] = 0;
    out[12] = -(sx * eyeX + sy * eyeY + sz * eyeZ);
    out[13] = -(ux * eyeX + uy * eyeY + uz * eyeZ);
    out[14] = fx * eyeX + fy * eyeY + fz * eyeZ;
    out[15] = 1;
}

void transformPoint(const float* m, float x, float y, float z, float* out4) {
    out4[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
    out4[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    out4[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    out4[3] = m[3] * x + m[7] * y + m[11] * z + m[15];
}

void transformDirection(const float* m, float x, float y, float z, float* out3) {
    out3[0] = m[0] * x + m[4] * y + m[8] * z;
    out3[1] = m[1] * x + m[5] * y + m[9] * z;
    out3[2] = m[2] * x + m[6] * y + m[10] * z;
}

} // namespace rccore::d3
