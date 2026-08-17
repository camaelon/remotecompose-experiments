#include "rccore/d3/SoftwarePaint3DContext.h"

#include "rccore/d3/Matrix4.h"
#include "rccore/d3/Paint3DContext.h"
#include "rccore/d3/Rasterizer.h"

#include <algorithm>
#include "rccore/d3/JavaMath.h"

#include <cmath>

namespace rccore::d3 {
namespace {

/** Near-plane rejection: a vertex with clip w below this is behind or on the eye. */
constexpr float NEAR_W_EPSILON = 0.0001f;

/** Ambient floor, so triangles facing away from every light still show their color. */
constexpr float AMBIENT = 0.2f;

/** Cap on accumulated lights, guarding a document that re-adds without clearing. */
constexpr int MAX_LIGHTS = 32;

/**
 * Window-z bias for wireframe edges: an edge sits exactly on its own triangle's plane, so
 * without a small camera-ward bias it fails the depth test against the depth its own face wrote.
 */
constexpr float WIRE_DEPTH_BIAS = 6e-4f;

} // namespace

SoftwarePaint3DContext::SoftwarePaint3DContext() {
    identity(mProj);
    identity(mView);
    identity(mModel);
}

void SoftwarePaint3DContext::setSize(int width, int height) {
    if (width <= 0 || height <= 0) return;
    if (mColor.empty() || mWidth != width || mHeight != height) {
        mColor.assign((size_t) width * height, 0);
        mZbuf.assign((size_t) width * height, 0.f);
        mWidth = width;
        mHeight = height;
        clearDepth(mZbuf.data(), (int) mZbuf.size());
    }
}

void SoftwarePaint3DContext::defineMesh3D(int id, const std::vector<int32_t>& indices,
                                          const std::vector<float>& verts,
                                          const std::vector<float>& normals,
                                          const std::vector<float>& uv) {
    mMeshes[id] = Mesh{indices, verts, normals, uv};
}

void SoftwarePaint3DContext::setCamera3D(int projection, const std::vector<float>& p,
                                         const std::vector<float>& v) {
    if (projection == PROJECTION_PERSPECTIVE) {
        if (p.size() != 4) return;
        perspective(mProj, p[0], p[1], p[2], p[3]);
    } else {
        if (p.size() != 6) return;
        ortho(mProj, p[0], p[1], p[2], p[3], p[4], p[5]);
    }
    if (v.size() != 9) return;
    lookAt(mView, v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7], v[8]);
    identity(mModel);
}

void SoftwarePaint3DContext::matrix3Op(int sub, const std::vector<float>& a) {
    switch (sub) {
        case M3_IDENTITY: identity(mModel); break;
        case M3_TRANSLATE: if (a.size() == 3) translate(mModel, a[0], a[1], a[2]); break;
        case M3_SCALE: if (a.size() == 3) scaleM(mModel, a[0], a[1], a[2]); break;
        case M3_ROTATE_AXIS: if (a.size() == 4) rotateAxis(mModel, a[0], a[1], a[2], a[3]); break;
        case M3_MULTIPLY: if (a.size() == 16) multiply(mModel, mModel, a.data()); break;
        default: break;
    }
}

void SoftwarePaint3DContext::clearDepth3D() {
    if (mZbuf.empty()) return;
    clearDepth(mZbuf.data(), (int) mZbuf.size());
    // Also clear the color buffer to transparent so the host's existing content shows through
    // where the 3D pass writes nothing.
    std::fill(mColor.begin(), mColor.end(), 0);
}

void SoftwarePaint3DContext::setLights3D(const std::vector<int>& types,
                                         const std::vector<int32_t>& colors,
                                         const std::vector<float>& params) {
    mLights.clear();
    int n = (int) types.size();
    for (int i = 0; i < n && (int) mLights.size() < MAX_LIGHTS; i++) {
        int p = i * 4;
        if (p + 3 >= (int) params.size()) break;
        int32_t argb = colors[i];
        Light l{};
        l.type = types[i];
        l.r = ((argb >> 16) & 0xFF) * (1.f / 255.f);
        l.g = ((argb >> 8) & 0xFF) * (1.f / 255.f);
        l.b = (argb & 0xFF) * (1.f / 255.f);
        l.wx = params[p]; l.wy = params[p + 1]; l.wz = params[p + 2];
        l.intensity = params[p + 3];
        mLights.push_back(l);
    }
    mLightsTouched = true;
}

void SoftwarePaint3DContext::setMaterial3D(float specStrength, float shininess) {
    mSpecStrength = specStrength;
    mShininess = shininess > 0.f ? shininess : 1.f;
}

void SoftwarePaint3DContext::setDepthBias3D(float constant, float slope) {
    mDepthBiasC = constant;
    mDepthBiasS = slope;
}

void SoftwarePaint3DContext::setTextureData(const std::vector<int32_t>& pixels, int w, int h) {
    mTexPixels = pixels;
    mTexW = w;
    mTexH = h;
}

void SoftwarePaint3DContext::ensureEyeLightCapacity(int n) {
    if ((int) mEType.size() < n) {
        mEType.assign(n, 0);
        mElx.assign(n, 0.f); mEly.assign(n, 0.f); mElz.assign(n, 0.f);
        mElr.assign(n, 0.f); mElg.assign(n, 0.f); mElb.assign(n, 0.f);
    }
}

void SoftwarePaint3DContext::prepareLightsEyeSpace() {
    if (!mLightsTouched) {
        ensureEyeLightCapacity(1);
        mEType[0] = LIGHT_DIRECTIONAL;
        mElx[0] = 0.f; mEly[0] = 0.f; mElz[0] = 1.f;
        mElr[0] = 1.f - AMBIENT; mElg[0] = 1.f - AMBIENT; mElb[0] = 1.f - AMBIENT;
        mNumEyeLights = 1;
        return;
    }
    int n = (int) mLights.size();
    ensureEyeLightCapacity(n);
    for (int i = 0; i < n; i++) {
        const Light& l = mLights[i];
        mEType[i] = l.type;
        if (l.type == LIGHT_POINT) {
            transformPoint(mView, l.wx, l.wy, l.wz, mScratch4);
            mElx[i] = mScratch4[0]; mEly[i] = mScratch4[1]; mElz[i] = mScratch4[2];
        } else {
            // Directional: world travel direction -> eye, store the unit vector to the light.
            transformDirection(mView, l.wx, l.wy, l.wz, mLightScratch3);
            float x = -mLightScratch3[0], y = -mLightScratch3[1], z = -mLightScratch3[2];
            float len = (float) jsqrt((double)((double) (x * x + y * y + z * z)));
            if (len > 0.f) { x /= len; y /= len; z /= len; }
            mElx[i] = x; mEly[i] = y; mElz[i] = z;
        }
        mElr[i] = l.r * l.intensity;
        mElg[i] = l.g * l.intensity;
        mElb[i] = l.b * l.intensity;
    }
    mNumEyeLights = n;
}

int32_t SoftwarePaint3DContext::litColor(int32_t base, float nx, float ny, float nz,
                                         float px, float py, float pz) {
    float nlen = (float) jsqrt((double)((double) (nx * nx + ny * ny + nz * nz)));
    float inv = (nlen == 0.f) ? 0.f : 1.f / nlen;
    if (mSpecStrength > 0.f) {
        return litColorSpecular(base, nx * inv, ny * inv, nz * inv, px, py, pz);
    }
    float lr = AMBIENT, lg = AMBIENT, lb = AMBIENT;
    for (int i = 0; i < mNumEyeLights; i++) {
        float lx, ly, lz;
        if (mEType[i] == LIGHT_POINT) {
            lx = mElx[i] - px; ly = mEly[i] - py; lz = mElz[i] - pz;
            float ll = (float) jsqrt((double)((double) (lx * lx + ly * ly + lz * lz)));
            if (ll > 0.f) { lx /= ll; ly /= ll; lz /= ll; }
        } else {
            lx = mElx[i]; ly = mEly[i]; lz = mElz[i];
        }
        float d = (nx * lx + ny * ly + nz * lz) * inv;
        if (d < 0.f) d = -d;   // two-sided at this profile
        lr += mElr[i] * d; lg += mElg[i] * d; lb += mElb[i] * d;
    }
    int a = (base >> 24) & 0xFF;
    int r = (int) (((base >> 16) & 0xFF) * lr);
    int g = (int) (((base >> 8) & 0xFF) * lg);
    int b = (int) ((base & 0xFF) * lb);
    if (r > 255) r = 255;
    if (g > 255) g = 255;
    if (b > 255) b = 255;
    return (a << 24) | (r << 16) | (g << 8) | b;
}

int32_t SoftwarePaint3DContext::litColorSpecular(int32_t base, float nfx, float nfy, float nfz,
                                                 float px, float py, float pz) {
    float vlen = (float) jsqrt((double)((double) (px * px + py * py + pz * pz)));
    float vx = 0.f, vy = 0.f, vz = 1.f;
    if (vlen > 0.f) { vx = -px / vlen; vy = -py / vlen; vz = -pz / vlen; }
    // Orient the normal toward the viewer so glossy faces light correctly from either side.
    if (nfx * vx + nfy * vy + nfz * vz < 0.f) { nfx = -nfx; nfy = -nfy; nfz = -nfz; }
    float lr = AMBIENT, lg = AMBIENT, lb = AMBIENT;
    float sr = 0.f, sg = 0.f, sb = 0.f;
    for (int i = 0; i < mNumEyeLights; i++) {
        float lx, ly, lz;
        if (mEType[i] == LIGHT_POINT) {
            lx = mElx[i] - px; ly = mEly[i] - py; lz = mElz[i] - pz;
            float ll = (float) jsqrt((double)((double) (lx * lx + ly * ly + lz * lz)));
            if (ll > 0.f) { lx /= ll; ly /= ll; lz /= ll; }
        } else {
            lx = mElx[i]; ly = mEly[i]; lz = mElz[i];
        }
        float ndl = nfx * lx + nfy * ly + nfz * lz;
        if (ndl <= 0.f) continue;   // facing away: no diffuse, no highlight
        lr += mElr[i] * ndl; lg += mElg[i] * ndl; lb += mElb[i] * ndl;
        float hx = lx + vx, hy = ly + vy, hz = lz + vz;
        float hlen = (float) jsqrt((double)((double) (hx * hx + hy * hy + hz * hz)));
        if (hlen <= 0.f) continue;
        float ndh = (nfx * hx + nfy * hy + nfz * hz) / hlen;
        if (ndh <= 0.f) continue;
        float spec = (float) jpow((double)((double) ndh), (double) mShininess) * mSpecStrength;
        sr += mElr[i] * spec; sg += mElg[i] * spec; sb += mElb[i] * spec;
    }
    int a = (base >> 24) & 0xFF;
    int r = (int) (((base >> 16) & 0xFF) * lr + sr * 255.f);
    int g = (int) (((base >> 8) & 0xFF) * lg + sg * 255.f);
    int b = (int) ((base & 0xFF) * lb + sb * 255.f);
    if (r > 255) r = 255;
    if (g > 255) g = 255;
    if (b > 255) b = 255;
    return (a << 24) | (r << 16) | (g << 8) | b;
}

bool SoftwarePaint3DContext::projectTriangle(const Mesh& m, bool smooth, bool computeInvW,
                                             int t, int32_t baseColor, int w, int h) {
    const std::vector<int32_t>& idx = m.indices;
    const std::vector<float>& verts = m.verts;
    int i0 = idx[t] * 3, i1 = idx[t + 1] * 3, i2 = idx[t + 2] * 3;
    int nv = (int) verts.size();
    if (i0 < 0 || i1 < 0 || i2 < 0 || i0 + 2 >= nv || i1 + 2 >= nv || i2 + 2 >= nv) return false;

    transformPoint(mMVP, verts[i0], verts[i0 + 1], verts[i0 + 2], mScratch4);
    float cx0 = mScratch4[0], cy0 = mScratch4[1], cz0 = mScratch4[2], cw0 = mScratch4[3];
    transformPoint(mMVP, verts[i1], verts[i1 + 1], verts[i1 + 2], mScratch4);
    float cx1 = mScratch4[0], cy1 = mScratch4[1], cz1 = mScratch4[2], cw1 = mScratch4[3];
    transformPoint(mMVP, verts[i2], verts[i2 + 1], verts[i2 + 2], mScratch4);
    float cx2 = mScratch4[0], cy2 = mScratch4[1], cz2 = mScratch4[2], cw2 = mScratch4[3];

    if (cw0 < NEAR_W_EPSILON || cw1 < NEAR_W_EPSILON || cw2 < NEAR_W_EPSILON) return false;
    if (computeInvW) {
        mTriInvW[0] = 1.f / cw0; mTriInvW[1] = 1.f / cw1; mTriInvW[2] = 1.f / cw2;
    }

    float nx0 = cx0 / cw0, ny0 = cy0 / cw0, nz0 = cz0 / cw0;
    float nx1 = cx1 / cw1, ny1 = cy1 / cw1, nz1 = cz1 / cw1;
    float nx2 = cx2 / cw2, ny2 = cy2 / cw2, nz2 = cz2 / cw2;

    float sx0 = (nx0 * 0.5f + 0.5f) * w;
    float sy0 = (1.f - (ny0 * 0.5f + 0.5f)) * h;
    float sz0 = nz0 * 0.5f + 0.5f;
    float sx1 = (nx1 * 0.5f + 0.5f) * w;
    float sy1 = (1.f - (ny1 * 0.5f + 0.5f)) * h;
    float sz1 = nz1 * 0.5f + 0.5f;
    float sx2 = (nx2 * 0.5f + 0.5f) * w;
    float sy2 = (1.f - (ny2 * 0.5f + 0.5f)) * h;
    float sz2 = nz2 * 0.5f + 0.5f;

    // Backface cull in screen space (Y down): CCW-in-NDC becomes CW after the flip, so a
    // positive signed area means back-facing.
    float signedArea = (sx1 - sx0) * (sy2 - sy0) - (sx2 - sx0) * (sy1 - sy0);
    if (signedArea > 0.f) return false;

    if ((mDepthBiasC != 0.f || mDepthBiasS != 0.f) && signedArea != 0.f) {
        float invA = 1.f / signedArea;
        float dzdx = ((sz1 - sz0) * (sy2 - sy0) - (sz2 - sz0) * (sy1 - sy0)) * invA;
        float dzdy = ((sz2 - sz0) * (sx1 - sx0) - (sz1 - sz0) * (sx2 - sx0)) * invA;
        float slope = std::max(std::fabs(dzdx), std::fabs(dzdy));
        float bias = mDepthBiasC + mDepthBiasS * slope;
        sz0 += bias; sz1 += bias; sz2 += bias;
    }

    mTriScreen[0] = sx0; mTriScreen[1] = sy0; mTriScreen[2] = sz0;
    mTriScreen[3] = sx1; mTriScreen[4] = sy1; mTriScreen[5] = sz1;
    mTriScreen[6] = sx2; mTriScreen[7] = sy2; mTriScreen[8] = sz2;

    // Eye-space positions: needed for point-light direction and the flat face normal.
    transformPoint(mMV, verts[i0], verts[i0 + 1], verts[i0 + 2], mScratch4);
    float ev0x = mScratch4[0], ev0y = mScratch4[1], ev0z = mScratch4[2];
    transformPoint(mMV, verts[i1], verts[i1 + 1], verts[i1 + 2], mScratch4);
    float ev1x = mScratch4[0], ev1y = mScratch4[1], ev1z = mScratch4[2];
    transformPoint(mMV, verts[i2], verts[i2 + 1], verts[i2 + 2], mScratch4);
    float ev2x = mScratch4[0], ev2y = mScratch4[1], ev2z = mScratch4[2];

    const std::vector<float>& normals = m.normals;
    int nn = (int) normals.size();
    if (smooth && nn > 0 && i0 + 2 < nn && i1 + 2 < nn && i2 + 2 < nn) {
        transformDirection(mMV, normals[i0], normals[i0 + 1], normals[i0 + 2], mNormal3);
        mTriColor[0] = litColor(baseColor, mNormal3[0], mNormal3[1], mNormal3[2],
                                ev0x, ev0y, ev0z);
        transformDirection(mMV, normals[i1], normals[i1 + 1], normals[i1 + 2], mNormal3);
        mTriColor[1] = litColor(baseColor, mNormal3[0], mNormal3[1], mNormal3[2],
                                ev1x, ev1y, ev1z);
        transformDirection(mMV, normals[i2], normals[i2 + 1], normals[i2 + 2], mNormal3);
        mTriColor[2] = litColor(baseColor, mNormal3[0], mNormal3[1], mNormal3[2],
                                ev2x, ev2y, ev2z);
    } else {
        float ax = ev1x - ev0x, ay = ev1y - ev0y, az = ev1z - ev0z;
        float bx = ev2x - ev0x, by = ev2y - ev0y, bz = ev2z - ev0z;
        float nxn = ay * bz - az * by;
        float nyn = az * bx - ax * bz;
        float nzn = ax * by - ay * bx;
        if (mSpecStrength > 0.f) {
            // Glossy: flat face normal but per-vertex eye positions, so the view-dependent
            // highlight gradates across the face.
            mTriColor[0] = litColor(baseColor, nxn, nyn, nzn, ev0x, ev0y, ev0z);
            mTriColor[1] = litColor(baseColor, nxn, nyn, nzn, ev1x, ev1y, ev1z);
            mTriColor[2] = litColor(baseColor, nxn, nyn, nzn, ev2x, ev2y, ev2z);
        } else {
            float cx = (ev0x + ev1x + ev2x) * (1.f / 3.f);
            float cy = (ev0y + ev1y + ev2y) * (1.f / 3.f);
            float cz = (ev0z + ev1z + ev2z) * (1.f / 3.f);
            int32_t shaded = litColor(baseColor, nxn, nyn, nzn, cx, cy, cz);
            mTriColor[0] = shaded; mTriColor[1] = shaded; mTriColor[2] = shaded;
        }
    }
    return true;
}

void SoftwarePaint3DContext::drawMeshWireframe(const Mesh& m, int32_t lineColor,
                                               int w, int h, int mode) {
    int edges = mode & WIRE_EDGE_MASK;
    if (edges == 0) edges = WIRE_EDGE_MASK;   // no selection => all three edges
    bool e0 = (edges & WIRE_EDGE0) != 0;
    bool e1 = (edges & WIRE_EDGE1) != 0;
    bool e2 = (edges & WIRE_EDGE2) != 0;
    int n = (int) m.indices.size();

    // Pass 1: depth prepass — fill front faces into the z-buffer, no color.
    for (int t = 0; t < n; t += 3) {
        if (!projectTriangle(m, false, false, t, lineColor, w, h)) continue;
        fillTriangleDepthOnly(mZbuf.data(), w, h,
            mTriScreen[6], mTriScreen[7], mTriScreen[8],
            mTriScreen[3], mTriScreen[4], mTriScreen[5],
            mTriScreen[0], mTriScreen[1], mTriScreen[2]);
    }
    // Pass 2: the selected edges, depth-tested against the prepass.
    for (int t = 0; t < n; t += 3) {
        if (!projectTriangle(m, false, false, t, lineColor, w, h)) continue;
        float ax = mTriScreen[0], ay = mTriScreen[1], az = mTriScreen[2];
        float bx = mTriScreen[3], by = mTriScreen[4], bz = mTriScreen[5];
        float cx = mTriScreen[6], cy = mTriScreen[7], cz = mTriScreen[8];
        if (e0) drawLineDepthTested(mZbuf.data(), mColor.data(), lineColor, w, h,
                                    ax, ay, az, bx, by, bz, WIRE_DEPTH_BIAS);
        if (e1) drawLineDepthTested(mZbuf.data(), mColor.data(), lineColor, w, h,
                                    bx, by, bz, cx, cy, cz, WIRE_DEPTH_BIAS);
        if (e2) drawLineDepthTested(mZbuf.data(), mColor.data(), lineColor, w, h,
                                    cx, cy, cz, ax, ay, az, WIRE_DEPTH_BIAS);
    }
}

void SoftwarePaint3DContext::drawMesh3D(int meshId, int mode) {
    auto it = mMeshes.find(meshId);
    if (it == mMeshes.end() || mColor.empty()) return;
    const Mesh& m = it->second;
    int w = mWidth, h = mHeight;

    multiply(mPV, mProj, mView);
    multiply(mMV, mView, mModel);
    multiply(mMVP, mPV, mModel);
    prepareLightsEyeSpace();

    int32_t baseColor = mBaseColorArgb;
    if ((mode & MODE_WIREFRAME) != 0) {
        drawMeshWireframe(m, baseColor, w, h, mode);
        return;
    }

    bool smooth = (mode & MODE_SMOOTH_MASK) != 0 && !m.normals.empty();
    bool textured = !mTexPixels.empty() && !m.uv.empty();
    // Glossy flat faces carry a per-vertex specular gradient -> interpolate via Gouraud.
    bool interpolate = smooth || mSpecStrength > 0.f;

    int n = (int) m.indices.size();
    for (int t = 0; t < n; t += 3) {
        if (!projectTriangle(m, smooth, textured, t, baseColor, w, h)) continue;
        if (textured) {
            int q0 = m.indices[t] * 2, q1 = m.indices[t + 1] * 2, q2 = m.indices[t + 2] * 2;
            fillTriangleTextured(mZbuf.data(), mColor.data(), mTexPixels.data(), mTexW, mTexH,
                mTriColor[2], mTriColor[1], mTriColor[0], w, h,
                mTriScreen[6], mTriScreen[7], mTriScreen[8], m.uv[q2], m.uv[q2 + 1], mTriInvW[2],
                mTriScreen[3], mTriScreen[4], mTriScreen[5], m.uv[q1], m.uv[q1 + 1], mTriInvW[1],
                mTriScreen[0], mTriScreen[1], mTriScreen[2], m.uv[q0], m.uv[q0 + 1], mTriInvW[0]);
        } else if (interpolate) {
            fillTriangleGouraud(mZbuf.data(), mColor.data(),
                mTriColor[2], mTriColor[1], mTriColor[0], w, h,
                mTriScreen[6], mTriScreen[7], mTriScreen[8],
                mTriScreen[3], mTriScreen[4], mTriScreen[5],
                mTriScreen[0], mTriScreen[1], mTriScreen[2]);
        } else {
            fillTriangle(mZbuf.data(), mColor.data(), mTriColor[0], w, h,
                mTriScreen[6], mTriScreen[7], mTriScreen[8],
                mTriScreen[3], mTriScreen[4], mTriScreen[5],
                mTriScreen[0], mTriScreen[1], mTriScreen[2]);
        }
    }
}

} // namespace rccore::d3
