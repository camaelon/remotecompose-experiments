#include "rccore/d3/Primitive3D.h"

#include "rccore/d3/MonotonicCurveFit.h"

#include <algorithm>
#include "rccore/d3/JavaMath.h"

#include <cmath>
#include <array>
#include <map>
#include <stdexcept>

namespace rccore::d3 {
namespace {

constexpr int DEFAULT_RADIAL = 24;
constexpr int DEFAULT_TUBE_SIDES = 14;
constexpr int DEFAULT_ROUND_SEG = 4;
/** Ceiling on rings emitted per control span, so a pathological path cannot blow up memory. */
constexpr int MAX_TUBE_PER_SPAN = 256;

int uvModeOf(int flags) { return (flags & FLAG_UV_MASK) >> FLAG_UV_SHIFT; }

float clampF(float x, float lo, float hi) { return x < lo ? lo : (x > hi ? hi : x); }
int clampInt(int x, int lo, int hi) { return x < lo ? lo : (x > hi ? hi : x); }

void cross3(float ax, float ay, float az, float bx, float by, float bz, float* out) {
    out[0] = ay * bz - az * by;
    out[1] = az * bx - ax * bz;
    out[2] = ax * by - ay * bx;
}

/** Round segments to an int, falling back to dflt when <= 0, clamped to min. */
int segCount(float segments, int dflt, int mn) {
    int n = segments > 0.f ? (int) std::lround(segments) : dflt;
    return std::max(mn, n);
}

/** Catmull-Rom interpolation of the span p1..p2 (with neighbours p0,p3) at t. */
float catmull(float p0, float p1, float p2, float p3, float t) {
    float t2 = t * t;
    float t3 = t2 * t;
    return 0.5f * ((2.f * p1) + (-p0 + p2) * t
                 + (2.f * p0 - 5.f * p1 + 4.f * p2 - p3) * t2
                 + (-p0 + 3.f * p1 - 3.f * p2 + p3) * t3);
}

/** Merge several meshes, re-basing indices. UV survives only if every part carries it. */
MeshData concatMeshes(const std::vector<MeshData>& parts) {
    MeshData out;
    bool allUv = !parts.empty();
    for (const MeshData& m : parts) if (m.uv.empty()) allUv = false;
    int base = 0;
    for (const MeshData& m : parts) {
        out.verts.insert(out.verts.end(), m.verts.begin(), m.verts.end());
        out.normals.insert(out.normals.end(), m.normals.begin(), m.normals.end());
        for (int32_t i : m.indices) out.indices.push_back(i + base);
        if (allUv) out.uv.insert(out.uv.end(), m.uv.begin(), m.uv.end());
        base += (int) m.verts.size() / 3;
    }
    return out;
}

/** Orthonormal basis perpendicular to the unit vector d. */
void perpBasis(float dx, float dy, float dz, float* u, float* v) {
    float ax = std::fabs(dx), ay = std::fabs(dy), az = std::fabs(dz);
    float rx, ry, rz;
    if (ax <= ay && ax <= az) { rx = 1; ry = 0; rz = 0; }
    else if (ay <= az) { rx = 0; ry = 1; rz = 0; }
    else { rx = 0; ry = 0; rz = 1; }
    float ux = dy * rz - dz * ry;
    float uy = dz * rx - dx * rz;
    float uz = dx * ry - dy * rx;
    float ul = (float) jsqrt((double)(ux * ux + uy * uy + uz * uz));
    if (ul < 1e-6f) ul = 1e-6f;
    u[0] = ux / ul; u[1] = uy / ul; u[2] = uz / ul;
    cross3(dx, dy, dz, u[0], u[1], u[2], v);
}

// ---- solids ---------------------------------------------------------------

MeshData sphereBand(float radius, float thetaMin, float thetaMax, int stacks, int slices,
                    float cx, float cy, float cz, int uvm) {
    int rows = stacks + 1, cols = slices + 1;
    MeshData m;
    m.verts.resize((size_t) rows * cols * 3);
    m.normals.resize((size_t) rows * cols * 3);
    if (uvm != 0) m.uv.resize((size_t) rows * cols * 2);
    int p = 0, q = 0;
    for (int i = 0; i <= stacks; i++) {
        float theta = thetaMin + (thetaMax - thetaMin) * i / stacks;
        float sinT = (float) jsin((double)(theta));
        float cosT = (float) jcos((double)(theta));
        for (int j = 0; j <= slices; j++) {
            double phi = 2.0 * M_PI * j / slices;
            float nx = sinT * (float) jcos((double)(phi));
            float ny = cosT;
            float nz = sinT * (float) jsin((double)(phi));
            m.normals[p] = nx; m.normals[p + 1] = ny; m.normals[p + 2] = nz;
            m.verts[p] = cx + nx * radius;
            m.verts[p + 1] = cy + ny * radius;
            m.verts[p + 2] = cz + nz * radius;
            p += 3;
            if (uvm != 0) {
                // Globe mapping: U reversed so text reads left-to-right on the facing side.
                m.uv[q] = 1.f - (float) j / slices;
                m.uv[q + 1] = 1.f - (float) i / stacks;
                q += 2;
            }
        }
    }
    m.indices.resize((size_t) stacks * slices * 6);
    int k = 0;
    for (int i = 0; i < stacks; i++) {
        for (int j = 0; j < slices; j++) {
            int a = i * cols + j, b = (i + 1) * cols + j;
            int c = (i + 1) * cols + (j + 1), d = i * cols + (j + 1);
            // First edge is a meridian, second a parallel, diagonal last.
            m.indices[k++] = d; m.indices[k++] = c; m.indices[k++] = b;
            m.indices[k++] = b; m.indices[k++] = a; m.indices[k++] = d;
        }
    }
    return m;
}

MeshData torusM(float majorR, float minorR, float cx, float cy, float cz,
                int segU, int segV, int uvm) {
    int cols = segV + 1, rows = segU + 1;
    MeshData m;
    m.verts.resize((size_t) rows * cols * 3);
    m.normals.resize((size_t) rows * cols * 3);
    if (uvm != 0) m.uv.resize((size_t) rows * cols * 2);
    int p = 0, q = 0;
    for (int i = 0; i <= segU; i++) {
        double u = 2.0 * M_PI * i / segU;
        float cu = (float) jcos((double)(u)), su = (float) jsin((double)(u));
        for (int j = 0; j <= segV; j++) {
            double v = 2.0 * M_PI * j / segV;
            float cv = (float) jcos((double)(v)), sv = (float) jsin((double)(v));
            m.normals[p] = cv * cu; m.normals[p + 1] = sv; m.normals[p + 2] = cv * su;
            m.verts[p] = cx + (majorR + minorR * cv) * cu;
            m.verts[p + 1] = cy + minorR * sv;
            m.verts[p + 2] = cz + (majorR + minorR * cv) * su;
            p += 3;
            if (uvm != 0) { m.uv[q] = (float) i / segU; m.uv[q + 1] = (float) j / segV; q += 2; }
        }
    }
    m.indices.resize((size_t) segU * segV * 6);
    int k = 0;
    for (int i = 0; i < segU; i++) {
        for (int j = 0; j < segV; j++) {
            int a = i * cols + j, b = (i + 1) * cols + j;
            int c = (i + 1) * cols + (j + 1), d = i * cols + (j + 1);
            m.indices[k++] = d; m.indices[k++] = c; m.indices[k++] = b;
            m.indices[k++] = b; m.indices[k++] = a; m.indices[k++] = d;
        }
    }
    return m;
}

MeshData planeM(float width, float height, float cx, float cy, float cz, int uvm) {
    float hw = width * 0.5f, hh = height * 0.5f;
    MeshData m;
    m.verts = {cx - hw, cy - hh, cz, cx + hw, cy - hh, cz,
               cx + hw, cy + hh, cz, cx - hw, cy + hh, cz};
    m.normals = {0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1};
    m.indices = {0, 1, 2, 0, 2, 3};   // CCW from +Z
    if (uvm != 0) m.uv = {0, 0, 1, 0, 1, 1, 0, 1};
    return m;
}

MeshData cubeM(float dx, float dy, float dz, float cx, float cy, float cz, int uvm) {
    float hx = dx * 0.5f, hy = dy * 0.5f, hz = dz * 0.5f;
    static const float face[6][3] = {{0,0,1},{0,0,-1},{1,0,0},{-1,0,0},{0,1,0},{0,-1,0}};
    static const int corners[6][4][3] = {
        {{-1,-1,1},{1,-1,1},{1,1,1},{-1,1,1}},
        {{1,-1,-1},{-1,-1,-1},{-1,1,-1},{1,1,-1}},
        {{1,-1,1},{1,-1,-1},{1,1,-1},{1,1,1}},
        {{-1,-1,-1},{-1,-1,1},{-1,1,1},{-1,1,-1}},
        {{-1,1,1},{1,1,1},{1,1,-1},{-1,1,-1}},
        {{-1,-1,-1},{1,-1,-1},{1,-1,1},{-1,-1,1}},
    };
    static const float faceUv[4][2] = {{0,0},{1,0},{1,1},{0,1}};
    MeshData m;
    m.verts.resize(24 * 3); m.normals.resize(24 * 3); m.indices.resize(36);
    if (uvm != 0) m.uv.resize(24 * 2);
    int vp = 0, ip = 0, qp = 0;
    for (int f = 0; f < 6; f++) {
        int base = f * 4;
        for (int c = 0; c < 4; c++) {
            m.verts[vp] = cx + corners[f][c][0] * hx;
            m.verts[vp + 1] = cy + corners[f][c][1] * hy;
            m.verts[vp + 2] = cz + corners[f][c][2] * hz;
            m.normals[vp] = face[f][0]; m.normals[vp+1] = face[f][1]; m.normals[vp+2] = face[f][2];
            vp += 3;
            if (uvm != 0) { m.uv[qp] = faceUv[c][0]; m.uv[qp + 1] = faceUv[c][1]; qp += 2; }
        }
        m.indices[ip++] = base; m.indices[ip++] = base + 1; m.indices[ip++] = base + 2;
        m.indices[ip++] = base; m.indices[ip++] = base + 2; m.indices[ip++] = base + 3;
    }
    return m;
}

MeshData diskM(float cx, float cy, float cz, float ux, float uy, float uz,
               float vx, float vy, float vz, float radius, int sides, bool flip) {
    float nrm[3];
    cross3(ux, uy, uz, vx, vy, vz, nrm);
    if (flip) { nrm[0] = -nrm[0]; nrm[1] = -nrm[1]; nrm[2] = -nrm[2]; }
    MeshData m;
    m.verts.resize((size_t)(sides + 1) * 3);
    m.normals.resize((size_t)(sides + 1) * 3);
    for (int j = 0; j < sides; j++) {
        double phi = 2.0 * M_PI * j / sides;
        float c = (float) jcos((double)(phi)), s = (float) jsin((double)(phi));
        int p = j * 3;
        m.verts[p] = cx + radius * (c * ux + s * vx);
        m.verts[p + 1] = cy + radius * (c * uy + s * vy);
        m.verts[p + 2] = cz + radius * (c * uz + s * vz);
        m.normals[p] = nrm[0]; m.normals[p + 1] = nrm[1]; m.normals[p + 2] = nrm[2];
    }
    int center = sides;
    m.verts[center * 3] = cx; m.verts[center * 3 + 1] = cy; m.verts[center * 3 + 2] = cz;
    m.normals[center * 3] = nrm[0];
    m.normals[center * 3 + 1] = nrm[1];
    m.normals[center * 3 + 2] = nrm[2];
    m.indices.resize((size_t) sides * 3);
    int k = 0;
    for (int j = 0; j < sides; j++) {
        int j1 = (j + 1) % sides;
        if (flip) { m.indices[k++] = center; m.indices[k++] = j1; m.indices[k++] = j; }
        else { m.indices[k++] = center; m.indices[k++] = j; m.indices[k++] = j1; }
    }
    return m;
}

MeshData coneM(float radius, float height, float cx, float cy, float cz, int seg) {
    float slant = (float) jsqrt((double)(height * height + radius * radius));
    float nY = radius / slant, nS = height / slant;
    MeshData side;
    side.verts.resize((size_t)(seg + 1) * 2 * 3);
    side.normals.resize((size_t)(seg + 1) * 2 * 3);
    for (int j = 0; j <= seg; j++) {
        double phi = 2.0 * M_PI * j / seg;
        float c = (float) jcos((double)(phi)), s = (float) jsin((double)(phi));
        int b = j * 3, a = (seg + 1 + j) * 3;
        side.verts[b] = cx + radius * c; side.verts[b + 1] = cy; side.verts[b + 2] = cz + radius * s;
        side.normals[b] = nS * c; side.normals[b + 1] = nY; side.normals[b + 2] = nS * s;
        side.verts[a] = cx;   // apex, duplicated per slice for a crisp slant normal
        side.verts[a + 1] = cy + height;
        side.verts[a + 2] = cz;
        side.normals[a] = nS * c; side.normals[a + 1] = nY; side.normals[a + 2] = nS * s;
    }
    side.indices.resize((size_t) seg * 3);
    int k = 0;
    for (int j = 0; j < seg; j++) {
        side.indices[k++] = j; side.indices[k++] = seg + 1 + j; side.indices[k++] = j + 1;
    }
    MeshData base = diskM(cx, cy, cz, 1, 0, 0, 0, 0, 1, radius, seg, false);
    return concatMeshes({side, base});
}

MeshData cylinderM(float radius, float x1, float y1, float z1,
                   float x2, float y2, float z2, int seg) {
    float ax = x2 - x1, ay = y2 - y1, az = z2 - z1;
    float len = (float) jsqrt((double)(ax * ax + ay * ay + az * az));
    if (len < 1e-6f) len = 1e-6f;
    ax /= len; ay /= len; az /= len;
    float u[3], v[3];
    perpBasis(ax, ay, az, u, v);
    MeshData side;
    side.verts.resize((size_t)(seg + 1) * 2 * 3);
    side.normals.resize((size_t)(seg + 1) * 2 * 3);
    for (int j = 0; j <= seg; j++) {
        double phi = 2.0 * M_PI * j / seg;
        float c = (float) jcos((double)(phi)), s = (float) jsin((double)(phi));
        float dx = c * u[0] + s * v[0];
        float dy = c * u[1] + s * v[1];
        float dz = c * u[2] + s * v[2];
        int bi = j * 3, ti = (seg + 1 + j) * 3;
        side.verts[bi] = x1 + radius * dx;
        side.verts[bi + 1] = y1 + radius * dy;
        side.verts[bi + 2] = z1 + radius * dz;
        side.verts[ti] = x2 + radius * dx;
        side.verts[ti + 1] = y2 + radius * dy;
        side.verts[ti + 2] = z2 + radius * dz;
        side.normals[bi] = dx; side.normals[bi + 1] = dy; side.normals[bi + 2] = dz;
        side.normals[ti] = dx; side.normals[ti + 1] = dy; side.normals[ti + 2] = dz;
    }
    side.indices.resize((size_t) seg * 6);
    int k = 0;
    for (int j = 0; j < seg; j++) {
        int bj = j, bj1 = j + 1, tj = seg + 1 + j, tj1 = seg + 1 + j + 1;
        // edge0 = the vertical seam, edge1 = around the ring, diagonal last.
        side.indices[k++] = tj; side.indices[k++] = bj; side.indices[k++] = bj1;
        side.indices[k++] = bj1; side.indices[k++] = tj1; side.indices[k++] = tj;
    }
    MeshData capB = diskM(x1, y1, z1, u[0], u[1], u[2], v[0], v[1], v[2], radius, seg, true);
    MeshData capT = diskM(x2, y2, z2, u[0], u[1], u[2], v[0], v[1], v[2], radius, seg, false);
    return concatMeshes({side, capB, capT});
}

MeshData roundedCubeM(float dx, float dy, float dz, float cx, float cy, float cz,
                      float r, int seg) {
    float ex = std::max(dx * 0.5f - r, 0.f);
    float ey = std::max(dy * 0.5f - r, 0.f);
    float ez = std::max(dz * 0.5f - r, 0.f);
    float ox = ex + r, oy = ey + r, oz = ez + r;
    static const int faces[6][2] = {{0,1},{0,-1},{1,1},{1,-1},{2,1},{2,-1}};
    int perFace = (seg + 1) * (seg + 1);
    MeshData m;
    m.verts.resize((size_t) 6 * perFace * 3);
    m.normals.resize((size_t) 6 * perFace * 3);
    m.indices.resize((size_t) 6 * seg * seg * 6);
    int vp = 0, ip = 0, vbase = 0;
    for (const auto& fc : faces) {
        int axis = fc[0], sign = fc[1];
        float uDir[3] = {0,0,0}, vDir[3] = {0,0,0}, nDir[3] = {0,0,0};
        nDir[axis] = (float) sign;
        if (axis == 0) {
            if (sign > 0) { uDir[1] = 1; vDir[2] = 1; } else { uDir[2] = 1; vDir[1] = 1; }
        } else if (axis == 1) {
            if (sign > 0) { uDir[2] = 1; vDir[0] = 1; } else { uDir[0] = 1; vDir[2] = 1; }
        } else {
            if (sign > 0) { uDir[0] = 1; vDir[1] = 1; } else { uDir[1] = 1; vDir[0] = 1; }
        }
        for (int s = 0; s <= seg; s++) {
            float u = (s / (float) seg) * 2.f - 1.f;
            for (int t = 0; t <= seg; t++) {
                float w = (t / (float) seg) * 2.f - 1.f;
                float px = nDir[0] * ox + uDir[0] * (u * ox) + vDir[0] * (w * ox);
                float py = nDir[1] * oy + uDir[1] * (u * oy) + vDir[1] * (w * oy);
                float pz = nDir[2] * oz + uDir[2] * (u * oz) + vDir[2] * (w * oz);
                float qx = clampF(px, -ex, ex), qy = clampF(py, -ey, ey), qz = clampF(pz, -ez, ez);
                float ddx = px - qx, ddy = py - qy, ddz = pz - qz;
                float l = (float) jsqrt((double)(ddx * ddx + ddy * ddy + ddz * ddz));
                if (l < 1e-6f) { ddx = nDir[0]; ddy = nDir[1]; ddz = nDir[2]; l = 1.f; }
                float inv = 1.f / l;
                m.verts[vp] = cx + qx + r * ddx * inv;
                m.verts[vp + 1] = cy + qy + r * ddy * inv;
                m.verts[vp + 2] = cz + qz + r * ddz * inv;
                m.normals[vp] = ddx * inv;
                m.normals[vp + 1] = ddy * inv;
                m.normals[vp + 2] = ddz * inv;
                vp += 3;
            }
        }
        int stride = seg + 1;
        for (int s = 0; s < seg; s++) {
            for (int t = 0; t < seg; t++) {
                int a = vbase + s * stride + t;
                int b = vbase + (s + 1) * stride + t;
                int c = vbase + (s + 1) * stride + (t + 1);
                int d = vbase + s * stride + (t + 1);
                m.indices[ip++] = a; m.indices[ip++] = b; m.indices[ip++] = c;
                m.indices[ip++] = c; m.indices[ip++] = d; m.indices[ip++] = a;
            }
        }
        vbase += perFace;
    }
    return m;
}

MeshData sphericalSectorM(float radius, float angle, float cx, float cy, float cz,
                          int slices, int stacks) {
    MeshData cap = sphereBand(radius, 0.f, angle, stacks, slices, cx, cy, cz, 0);
    int seg = slices;
    float ca = (float) jcos((double)(angle)), sa = (float) jsin((double)(angle));
    float ringY = radius * ca, ringR = radius * sa;
    MeshData cone;
    cone.verts.resize((size_t)(seg + 1) * 2 * 3);
    cone.normals.resize((size_t)(seg + 1) * 2 * 3);
    for (int j = 0; j <= seg; j++) {
        double phi = 2.0 * M_PI * j / seg;
        float c = (float) jcos((double)(phi)), s = (float) jsin((double)(phi));
        int ri = j * 3, ai = (seg + 1 + j) * 3;
        cone.verts[ri] = cx + ringR * c;
        cone.verts[ri + 1] = cy + ringY;
        cone.verts[ri + 2] = cz + ringR * s;
        cone.verts[ai] = cx; cone.verts[ai + 1] = cy; cone.verts[ai + 2] = cz;
        float nx = ca * c, ny = -sa, nz = ca * s;
        cone.normals[ri] = nx; cone.normals[ri + 1] = ny; cone.normals[ri + 2] = nz;
        cone.normals[ai] = nx; cone.normals[ai + 1] = ny; cone.normals[ai + 2] = nz;
    }
    cone.indices.resize((size_t) seg * 3);
    int k = 0;
    for (int j = 0; j < seg; j++) {
        cone.indices[k++] = j; cone.indices[k++] = j + 1; cone.indices[k++] = seg + 1 + j;
    }
    return concatMeshes({cap, cone});
}

MeshData sphericalDomeM(float radius, float angle, float cx, float cy, float cz,
                        int slices, int stacks) {
    MeshData cap = sphereBand(radius, 0.f, angle, stacks, slices, cx, cy, cz, 0);
    float ringY = radius * (float) jcos((double)(angle));
    float ringR = radius * (float) jsin((double)(angle));
    MeshData base = diskM(cx, cy + ringY, cz, 1, 0, 0, 0, 0, 1, ringR, slices, false);
    return concatMeshes({cap, base});
}

MeshData icosphereM(float radius, float cx, float cy, float cz, int subdiv) {
    float t = (float) ((1.0 + jsqrt((double)(5.0))) / 2.0);
    std::vector<std::vector<float>> dirs;
    const float base[12][3] = {
        {-1,t,0},{1,t,0},{-1,-t,0},{1,-t,0},
        {0,-1,t},{0,1,t},{0,-1,-t},{0,1,-t},
        {t,0,-1},{t,0,1},{-t,0,-1},{-t,0,1},
    };
    for (const auto& v : base) {
        float len = (float) jsqrt((double)(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]));
        dirs.push_back({v[0]/len, v[1]/len, v[2]/len});
    }
    std::vector<std::array<int,3>> tris;
    const int faces[20][3] = {
        {0,11,5},{0,5,1},{0,1,7},{0,7,10},{0,10,11},
        {1,5,9},{5,11,4},{11,10,2},{10,7,6},{7,1,8},
        {3,9,4},{3,4,2},{3,2,6},{3,6,8},{3,8,9},
        {4,9,5},{2,4,11},{6,2,10},{8,6,7},{9,8,1},
    };
    for (const auto& f : faces) tris.push_back({f[0], f[1], f[2]});
    std::map<long long, int> mid;
    auto icoMid = [&](int i, int j) {
        long long key = i < j ? (((long long) i) << 32) | (unsigned) j
                              : (((long long) j) << 32) | (unsigned) i;
        auto it = mid.find(key);
        if (it != mid.end()) return it->second;
        const auto& a = dirs[i];
        const auto& b = dirs[j];
        float mx = (a[0] + b[0]) * 0.5f, my = (a[1] + b[1]) * 0.5f, mz = (a[2] + b[2]) * 0.5f;
        float len = (float) jsqrt((double)(mx*mx + my*my + mz*mz));
        int idx = (int) dirs.size();
        dirs.push_back({mx/len, my/len, mz/len});
        mid[key] = idx;
        return idx;
    };
    for (int s = 0; s < subdiv; s++) {
        std::vector<std::array<int,3>> next;
        for (const auto& tr : tris) {
            int a = icoMid(tr[0], tr[1]);
            int b = icoMid(tr[1], tr[2]);
            int c = icoMid(tr[2], tr[0]);
            next.push_back({tr[0], a, c});
            next.push_back({tr[1], b, a});
            next.push_back({tr[2], c, b});
            next.push_back({a, b, c});
        }
        tris = next;
    }
    MeshData m;
    int nv = (int) dirs.size();
    m.verts.resize((size_t) nv * 3);
    m.normals.resize((size_t) nv * 3);
    for (int i = 0; i < nv; i++) {
        const auto& d = dirs[i];
        m.verts[i*3] = cx + radius * d[0];
        m.verts[i*3+1] = cy + radius * d[1];
        m.verts[i*3+2] = cz + radius * d[2];
        m.normals[i*3] = d[0]; m.normals[i*3+1] = d[1]; m.normals[i*3+2] = d[2];
    }
    m.indices.resize(tris.size() * 3);
    int k = 0;
    for (const auto& tr : tris) {
        m.indices[k++] = tr[0]; m.indices[k++] = tr[1]; m.indices[k++] = tr[2];
    }
    return m;
}

MeshData latheM(const std::vector<float>& profile, float cx, float cy, float cz, int seg) {
    int nProf = (int) profile.size() / 2;
    if (nProf < 2) throw std::runtime_error("MeshPrimitive lathe: need >= 2 profile points");
    int cols = seg + 1;   // duplicate the seam column for clean normals
    MeshData m;
    m.verts.resize((size_t) nProf * cols * 3);
    m.normals.resize((size_t) nProf * cols * 3);
    std::vector<float> pnr(nProf, 0.f), pny(nProf, 0.f);
    for (int e = 0; e < nProf - 1; e++) {
        float dr = profile[(e + 1) * 2] - profile[e * 2];
        float dy = profile[(e + 1) * 2 + 1] - profile[e * 2 + 1];
        float nr = dy, ny = -dr;
        float len = (float) jsqrt((double)(nr * nr + ny * ny));
        if (len > 1e-9f) { nr /= len; ny /= len; }
        pnr[e] += nr; pny[e] += ny;
        pnr[e + 1] += nr; pny[e + 1] += ny;
    }
    for (int i = 0; i < nProf; i++) {
        float len = (float) jsqrt((double)(pnr[i] * pnr[i] + pny[i] * pny[i]));
        if (len > 1e-9f) { pnr[i] /= len; pny[i] /= len; }
        else { pnr[i] = 1.f; pny[i] = 0.f; }
    }
    for (int i = 0; i < nProf; i++) {
        float r = profile[i * 2], y = profile[i * 2 + 1];
        for (int j = 0; j <= seg; j++) {
            double phi = 2.0 * M_PI * j / seg;
            float c = (float) jcos((double)(phi)), s = (float) jsin((double)(phi));
            int idx = (i * cols + j) * 3;
            m.verts[idx] = cx + r * c;
            m.verts[idx + 1] = cy + y;
            m.verts[idx + 2] = cz + r * s;
            m.normals[idx] = pnr[i] * c;
            m.normals[idx + 1] = pny[i];
            m.normals[idx + 2] = pnr[i] * s;
        }
    }
    m.indices.resize((size_t)(nProf - 1) * seg * 6);
    int k = 0;
    for (int i = 0; i < nProf - 1; i++) {
        for (int j = 0; j < seg; j++) {
            int a = i * cols + j, b = i * cols + j + 1;
            int c = (i + 1) * cols + j, d = (i + 1) * cols + j + 1;
            // edge0 = around the revolution, edge1 = along the profile, diagonal last.
            m.indices[k++] = b; m.indices[k++] = a; m.indices[k++] = c;
            m.indices[k++] = c; m.indices[k++] = d; m.indices[k++] = b;
        }
    }
    return m;
}

// ---- extruded 2D shapes ---------------------------------------------------

void setSideVert(std::vector<float>& verts, std::vector<float>& normals, int i,
                 float x, float y, float z, float nx, float ny) {
    int p = i * 3;
    verts[p] = x; verts[p + 1] = y; verts[p + 2] = z;
    normals[p] = nx; normals[p + 1] = ny;
}

MeshData extrudeM(const std::vector<float>& poly2D, const std::vector<int32_t>& capTris,
                  const std::vector<int32_t>& loop, float depth,
                  float cx, float cy, float cz) {
    int np = (int) poly2D.size() / 2;
    float hd = depth * 0.5f;
    int le = (int) loop.size();
    MeshData m;
    int vcount = np * 2 + le * 4;
    m.verts.assign((size_t) vcount * 3, 0.f);
    m.normals.assign((size_t) vcount * 3, 0.f);
    for (int i = 0; i < np; i++) {
        float x = poly2D[i * 2], y = poly2D[i * 2 + 1];
        int f = i * 3;
        m.verts[f] = cx + x; m.verts[f + 1] = cy + y; m.verts[f + 2] = cz + hd;
        m.normals[f + 2] = 1.f;
        int b = (np + i) * 3;
        m.verts[b] = cx + x; m.verts[b + 1] = cy + y; m.verts[b + 2] = cz - hd;
        m.normals[b + 2] = -1.f;
    }
    m.indices.resize(capTris.size() * 2 + (size_t) le * 6);
    int io = 0;
    for (size_t t = 0; t < capTris.size(); t += 3) {
        m.indices[io++] = capTris[t]; m.indices[io++] = capTris[t+1]; m.indices[io++] = capTris[t+2];
    }
    for (size_t t = 0; t < capTris.size(); t += 3) {   // back cap, reversed
        m.indices[io++] = np + capTris[t];
        m.indices[io++] = np + capTris[t+2];
        m.indices[io++] = np + capTris[t+1];
    }
    int sideBase = np * 2;
    for (int e = 0; e < le; e++) {
        int ia = loop[e], ib = loop[(e + 1) % le];
        float ax = poly2D[ia*2], ay = poly2D[ia*2+1];
        float bx = poly2D[ib*2], by = poly2D[ib*2+1];
        float dx = bx - ax, dy = by - ay;
        float nx = dy, ny = -dx;   // outward normal = right of travel for a CCW loop
        float len = (float) jsqrt((double)(nx * nx + ny * ny));
        if (len > 1e-9f) { nx /= len; ny /= len; }
        int base = sideBase + e * 4;
        setSideVert(m.verts, m.normals, base, cx + ax, cy + ay, cz + hd, nx, ny);
        setSideVert(m.verts, m.normals, base + 1, cx + bx, cy + by, cz + hd, nx, ny);
        setSideVert(m.verts, m.normals, base + 2, cx + ax, cy + ay, cz - hd, nx, ny);
        setSideVert(m.verts, m.normals, base + 3, cx + bx, cy + by, cz - hd, nx, ny);
        m.indices[io++] = base; m.indices[io++] = base + 2; m.indices[io++] = base + 3;
        m.indices[io++] = base; m.indices[io++] = base + 3; m.indices[io++] = base + 1;
    }
    return m;
}

MeshData extrudeCircleM(float radius, float depth, float cx, float cy, float cz, int sides) {
    std::vector<float> poly((size_t)(sides + 1) * 2, 0.f);
    for (int j = 0; j < sides; j++) {
        double phi = 2.0 * M_PI * j / sides;
        poly[j*2] = radius * (float) jcos((double)(phi));
        poly[j*2+1] = radius * (float) jsin((double)(phi));
    }
    int center = sides;
    std::vector<int32_t> cap((size_t) sides * 3), loop((size_t) sides);
    int k = 0;
    for (int j = 0; j < sides; j++) {
        int j1 = (j + 1) % sides;
        cap[k++] = center; cap[k++] = j; cap[k++] = j1;
        loop[j] = j;
    }
    return extrudeM(poly, cap, loop, depth, cx, cy, cz);
}

MeshData extrudeSectorM(float radius, float a0, float sweepA, float depth,
                        float cx, float cy, float cz, int n) {
    std::vector<float> poly((size_t)(n + 2) * 2, 0.f);
    for (int k = 0; k <= n; k++) {
        double phi = a0 + sweepA * k / n;
        poly[(1 + k) * 2] = radius * (float) jcos((double)(phi));
        poly[(1 + k) * 2 + 1] = radius * (float) jsin((double)(phi));
    }
    std::vector<int32_t> cap((size_t) n * 3);
    int mI = 0;
    for (int k = 0; k < n; k++) { cap[mI++] = 0; cap[mI++] = 1 + k; cap[mI++] = 2 + k; }
    std::vector<int32_t> loop((size_t) n + 2);
    loop[0] = 0;
    for (int k = 0; k <= n; k++) loop[1 + k] = 1 + k;
    return extrudeM(poly, cap, loop, depth, cx, cy, cz);
}

MeshData extrudeSegmentM(float radius, float a0, float sweepA, float depth,
                         float cx, float cy, float cz, int n) {
    std::vector<float> poly((size_t)(n + 1) * 2, 0.f);
    for (int k = 0; k <= n; k++) {
        double phi = a0 + sweepA * k / n;
        poly[k*2] = radius * (float) jcos((double)(phi));
        poly[k*2+1] = radius * (float) jsin((double)(phi));
    }
    std::vector<int32_t> cap((size_t) std::max(0, n - 1) * 3);
    int mI = 0;
    for (int k = 1; k < n; k++) { cap[mI++] = 0; cap[mI++] = k; cap[mI++] = k + 1; }
    std::vector<int32_t> loop((size_t) n + 1);
    for (int k = 0; k <= n; k++) loop[k] = k;
    return extrudeM(poly, cap, loop, depth, cx, cy, cz);
}

MeshData extrudeArcM(float r0, float r1, float a0, float sweepA, float depth,
                     float cx, float cy, float cz, int n) {
    int inner = n + 1;
    std::vector<float> poly((size_t)(2 * (n + 1)) * 2, 0.f);
    for (int k = 0; k <= n; k++) {
        double phi = a0 + sweepA * k / n;
        float c = (float) jcos((double)(phi)), s = (float) jsin((double)(phi));
        poly[k*2] = r1 * c; poly[k*2+1] = r1 * s;
        int ii = inner + k;
        poly[ii*2] = r0 * c; poly[ii*2+1] = r0 * s;
    }
    std::vector<int32_t> cap((size_t) n * 2 * 3);
    int mI = 0;
    for (int k = 0; k < n; k++) {
        int o0 = k, o1 = k + 1, i0 = inner + k, i1 = inner + k + 1;
        cap[mI++] = o0; cap[mI++] = o1; cap[mI++] = i1;
        cap[mI++] = o0; cap[mI++] = i1; cap[mI++] = i0;
    }
    std::vector<int32_t> loop((size_t) 2 * (n + 1));
    int li = 0;
    for (int k = 0; k <= n; k++) loop[li++] = k;
    for (int k = n; k >= 0; k--) loop[li++] = inner + k;
    return extrudeM(poly, cap, loop, depth, cx, cy, cz);
}

MeshData extrudeRoundedRectM(float width, float height, float cr, float depth,
                             float cx, float cy, float cz, int cseg) {
    float hw = width * 0.5f, hh = height * 0.5f;
    cr = clampF(cr, 0.f, std::min(hw, hh));
    float ix = hw - cr, iy = hh - cr;
    float ccx[4] = {ix, ix, -ix, -ix};
    float ccy[4] = {-iy, iy, iy, -iy};
    float startA[4] = {-(float)(M_PI / 2), 0.f, (float)(M_PI / 2), (float) M_PI};
    int per = cseg + 1;
    int pcount = 4 * per;
    std::vector<float> poly((size_t)(pcount + 1) * 2, 0.f);
    int pi = 0;
    for (int corner = 0; corner < 4; corner++) {
        for (int s = 0; s <= cseg; s++) {
            double ang = startA[corner] + (M_PI / 2) * s / cseg;
            poly[pi*2] = ccx[corner] + cr * (float) jcos((double)(ang));
            poly[pi*2+1] = ccy[corner] + cr * (float) jsin((double)(ang));
            pi++;
        }
    }
    int center = pcount;
    std::vector<int32_t> cap((size_t) pcount * 3), loop((size_t) pcount);
    int k = 0;
    for (int j = 0; j < pcount; j++) {
        int j1 = (j + 1) % pcount;
        cap[k++] = center; cap[k++] = j; cap[k++] = j1;
        loop[j] = j;
    }
    return extrudeM(poly, cap, loop, depth, cx, cy, cz);
}

MeshData extrudeSquircleM(float radius, float exponent, float depth,
                          float cx, float cy, float cz, int samples) {
    float e = exponent <= 0.f ? 4.f : exponent;
    float p2 = 2.f / e;
    std::vector<float> poly((size_t)(samples + 1) * 2, 0.f);
    for (int j = 0; j < samples; j++) {
        double phi = 2.0 * M_PI * j / samples;
        float ct = (float) jcos((double)(phi)), st = (float) jsin((double)(phi));
        float sct = (ct > 0.f) ? 1.f : ((ct < 0.f) ? -1.f : 0.f);
        float sst = (st > 0.f) ? 1.f : ((st < 0.f) ? -1.f : 0.f);
        poly[j*2] = radius * sct * (float) jpow((double)(std::fabs(ct)), p2);
        poly[j*2+1] = radius * sst * (float) jpow((double)(std::fabs(st)), p2);
    }
    int center = samples;
    std::vector<int32_t> cap((size_t) samples * 3), loop((size_t) samples);
    int k = 0;
    for (int j = 0; j < samples; j++) {
        int j1 = (j + 1) % samples;
        cap[k++] = center; cap[k++] = j; cap[k++] = j1;
        loop[j] = j;
    }
    return extrudeM(poly, cap, loop, depth, cx, cy, cz);
}

} // namespace

// The tube/sweep/extrude-path family lives in Primitive3DSweep.cpp; declared here so the
// dispatch below can reach it without exposing the machinery in the public header.
MeshData tubeM(const std::vector<float>& params, bool capped, float segments, int flags);
MeshData profileTubeM(const std::vector<float>& params, int sides, int flags);
MeshData sweepM(const std::vector<float>& scalars, const std::vector<float>& xsec,
                const std::vector<float>& path, const std::vector<float>* scales,
                const std::vector<float>* twists);
MeshData helixM(float coilR, float tubeR, float pitch, float turns,
                float cx, float cy, float cz, int sides);
MeshData extrudePathM(const std::vector<float>& p);

MeshData buildPrimitive(int type, float segments, int flags,
                        const std::vector<std::vector<float>>& data) {
    const std::vector<float>& p = data[0];
    int uvm = uvModeOf(flags);
    static const std::vector<float> kEmpty;
    switch (type) {
        case P_SPHERE: {
            int slices = segCount(segments, DEFAULT_RADIAL, 3);
            int stacks = std::max(2, (int) std::lround(slices * 0.5f));
            return sphereBand(p[0], 0.f, (float) M_PI, stacks, slices, p[1], p[2], p[3], uvm);
        }
        case P_CYLINDER:
            return cylinderM(p[0], p[1], p[2], p[3], p[4], p[5], p[6],
                             segCount(segments, DEFAULT_RADIAL, 3));
        case P_CONE:
            return coneM(p[0], p[1], p[2], p[3], p[4], segCount(segments, DEFAULT_RADIAL, 3));
        case P_CUBE:
            return cubeM(p[0], p[1], p[2], p[3], p[4], p[5], uvm);
        case P_ROUNDED_CUBE:
            return roundedCubeM(p[0], p[1], p[2], p[3], p[4], p[5], p[6],
                                segCount(segments, DEFAULT_ROUND_SEG, 1));
        case P_SPHERICAL_SECTOR: {
            int slices = segCount(segments, DEFAULT_RADIAL, 3);
            int stacks = std::max(2, (int) std::lround(slices / 3.f));
            return sphericalSectorM(p[0], p[1], p[2], p[3], p[4], slices, stacks);
        }
        case P_SPHERICAL_DOME: {
            int slices = segCount(segments, DEFAULT_RADIAL, 3);
            int stacks = std::max(2, (int) std::lround(slices / 3.f));
            return sphericalDomeM(p[0], p[1], p[2], p[3], p[4], slices, stacks);
        }
        case P_TUBE: return tubeM(p, false, segments, flags);
        case P_CAP_TUBE: return tubeM(p, true, segments, flags);
        case P_PROFILE_TUBE:
            return profileTubeM(p, segCount(segments, DEFAULT_TUBE_SIDES, 3), flags);
        case P_TORUS: {
            float majorR = p[0], minorR = p[1];
            int majorSeg = segCount(segments, DEFAULT_RADIAL, 3);
            // Minor segments scale with the radius ratio so the quads stay roughly square.
            float ratio = std::fabs(majorR) > 1e-6f ? std::fabs(minorR / majorR) : 0.5f;
            int minorSeg = std::max(3, (int) std::lround(majorSeg * ratio));
            return torusM(majorR, minorR, p[2], p[3], p[4], majorSeg, minorSeg, uvm);
        }
        case P_PLANE: return planeM(p[0], p[1], p[2], p[3], p[4], uvm);
        case P_EXTRUDE_CIRCLE:
            return extrudeCircleM(p[0], p[1], p[2], p[3], p[4],
                                  segCount(segments, DEFAULT_RADIAL, 3));
        case P_EXTRUDE_SECTOR:
            return extrudeSectorM(p[0], p[1], p[2], p[3], p[4], p[5], p[6],
                                  segCount(segments, DEFAULT_RADIAL, 1));
        case P_EXTRUDE_SEGMENT:
            return extrudeSegmentM(p[0], p[1], p[2], p[3], p[4], p[5], p[6],
                                   segCount(segments, DEFAULT_RADIAL, 1));
        case P_EXTRUDE_ARC:
            return extrudeArcM(p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7],
                               segCount(segments, DEFAULT_RADIAL, 1));
        case P_EXTRUDE_ROUNDED_RECT:
            return extrudeRoundedRectM(p[0], p[1], p[2], p[3], p[4], p[5], p[6],
                                       segCount(segments, 6, 1));
        case P_EXTRUDE_SQUIRCLE:
            return extrudeSquircleM(p[0], p[1], p[2], p[3], p[4], p[5],
                                    segCount(segments, 48, 8));
        case P_EXTRUDE_PATH: return extrudePathM(p);
        case P_LATHE:
            return latheM(data.size() > 1 ? data[1] : kEmpty,
                          p.size() > 0 ? p[0] : 0.f, p.size() > 1 ? p[1] : 0.f,
                          p.size() > 2 ? p[2] : 0.f,
                          segCount(segments, DEFAULT_RADIAL, 3));
        case P_SWEEP:
            return sweepM(p, data.size() > 1 ? data[1] : kEmpty,
                          data.size() > 2 ? data[2] : kEmpty,
                          data.size() > 3 ? &data[3] : nullptr,
                          data.size() > 4 ? &data[4] : nullptr);
        case P_HELIX:
            return helixM(p[0], p[1], p[2], p[3],
                          p.size() > 4 ? p[4] : 0.f, p.size() > 5 ? p[5] : 0.f,
                          p.size() > 6 ? p[6] : 0.f, segCount(segments, 12, 3));
        case P_ICOSPHERE:
            return icosphereM(p[0], p.size() > 1 ? p[1] : 0.f, p.size() > 2 ? p[2] : 0.f,
                              p.size() > 3 ? p[3] : 0.f,
                              std::max(0, std::min(4, segments > 0.f
                                  ? (int) std::lround(segments) : 2)));
        default:
            throw std::runtime_error("MeshPrimitive: unknown type " + std::to_string(type));
    }
}

// Shared helpers used by Primitive3DSweep.cpp.
namespace detail {
MeshData concatMeshesX(const std::vector<MeshData>& parts) { return concatMeshes(parts); }
void perpBasisX(float dx, float dy, float dz, float* u, float* v) { perpBasis(dx, dy, dz, u, v); }
void cross3X(float ax, float ay, float az, float bx, float by, float bz, float* o) {
    cross3(ax, ay, az, bx, by, bz, o);
}
MeshData diskX(float cx, float cy, float cz, float ux, float uy, float uz,
               float vx, float vy, float vz, float radius, int sides, bool flip) {
    return diskM(cx, cy, cz, ux, uy, uz, vx, vy, vz, radius, sides, flip);
}
int segCountX(float s, int d, int m) { return segCount(s, d, m); }
int clampIntX(int x, int lo, int hi) { return clampInt(x, lo, hi); }
float catmullX(float a, float b, float c, float d, float t) { return catmull(a, b, c, d, t); }
} // namespace detail

} // namespace rccore::d3
