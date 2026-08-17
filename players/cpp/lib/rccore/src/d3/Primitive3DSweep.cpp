// The six generators that need machinery rather than a formula: the tube family (monotone-spline
// centrelines with adaptive ring counts and parallel-transport frames), sweep and helix (swept
// cross-sections with per-station scale and twist), and extrudePath (scanline / nonzero-winding
// trapezoid triangulation, so concave outlines, holes and overlapping contours all work).
//
// Split out of Primitive3D.cpp only for file size; it is the same translation unit's worth of
// semantics and shares its helpers through the `detail` namespace.
#include "rccore/d3/Primitive3D.h"

#include "rccore/d3/MonotonicCurveFit.h"

#include <algorithm>
#include "rccore/d3/JavaMath.h"

#include <cmath>
#include <array>
#include <memory>
#include <stdexcept>

namespace rccore::d3 {

namespace detail {
MeshData concatMeshesX(const std::vector<MeshData>& parts);
void perpBasisX(float dx, float dy, float dz, float* u, float* v);
void cross3X(float ax, float ay, float az, float bx, float by, float bz, float* o);
MeshData diskX(float cx, float cy, float cz, float ux, float uy, float uz,
               float vx, float vy, float vz, float radius, int sides, bool flip);
int segCountX(float s, int d, int m);
int clampIntX(int x, int lo, int hi);
float catmullX(float a, float b, float c, float d, float t);
} // namespace detail

using detail::catmullX;
using detail::clampIntX;
using detail::concatMeshesX;
using detail::cross3X;
using detail::diskX;
using detail::perpBasisX;
using detail::segCountX;

namespace {

constexpr int DEFAULT_TUBE_SIDES = 14;
constexpr int MAX_TUBE_PER_SPAN = 256;

/**
 * Sweep a tube along a centreline with unit tangents and a per-ring radius. A
 * parallel-transport frame (carry u forward, re-orthogonalize against each new tangent) avoids
 * the spin a recomputed basis would introduce.
 */
MeshData buildTubeFromCenterline(const std::vector<float>& px, const std::vector<float>& py,
                                 const std::vector<float>& pz,
                                 const std::vector<float>& tx, const std::vector<float>& ty,
                                 const std::vector<float>& tz,
                                 const std::vector<float>& radii, int n, int sides,
                                 bool capped) {
    float u[3], vv[3];
    perpBasisX(tx[0], ty[0], tz[0], u, vv);
    MeshData wall;
    wall.verts.resize((size_t) n * (sides + 1) * 3);
    wall.normals.resize((size_t) n * (sides + 1) * 3);
    for (int i = 0; i < n; i++) {
        if (i > 0) {
            float dot = u[0] * tx[i] + u[1] * ty[i] + u[2] * tz[i];
            u[0] -= dot * tx[i]; u[1] -= dot * ty[i]; u[2] -= dot * tz[i];
            float ul = (float) jsqrt((double)(u[0]*u[0] + u[1]*u[1] + u[2]*u[2]));
            if (ul < 1e-6f) perpBasisX(tx[i], ty[i], tz[i], u, vv);
            else {
                u[0] /= ul; u[1] /= ul; u[2] /= ul;
                cross3X(tx[i], ty[i], tz[i], u[0], u[1], u[2], vv);
            }
        }
        for (int j = 0; j <= sides; j++) {
            double phi = 2.0 * M_PI * j / sides;
            float c = (float) jcos((double)(phi)), s = (float) jsin((double)(phi));
            float dx = c * u[0] + s * vv[0];
            float dy = c * u[1] + s * vv[1];
            float dz = c * u[2] + s * vv[2];
            int p = (i * (sides + 1) + j) * 3;
            float ri = radii[i];
            wall.verts[p] = px[i] + ri * dx;
            wall.verts[p + 1] = py[i] + ri * dy;
            wall.verts[p + 2] = pz[i] + ri * dz;
            wall.normals[p] = dx; wall.normals[p + 1] = dy; wall.normals[p + 2] = dz;
        }
    }
    int cols = sides + 1;
    wall.indices.resize((size_t)(n - 1) * sides * 6);
    int k = 0;
    for (int i = 0; i < n - 1; i++) {
        for (int j = 0; j < sides; j++) {
            int a = i * cols + j, b = i * cols + j + 1;
            int cc = (i + 1) * cols + j, d = (i + 1) * cols + j + 1;
            // edge0 = longitudinal along the path, edge1 = around the section, diagonal last.
            wall.indices[k++] = cc; wall.indices[k++] = a; wall.indices[k++] = b;
            wall.indices[k++] = b; wall.indices[k++] = d; wall.indices[k++] = cc;
        }
    }
    if (!capped) return wall;
    float u0[3], v0[3], u1[3], v1[3];
    perpBasisX(tx[0], ty[0], tz[0], u0, v0);
    perpBasisX(tx[n-1], ty[n-1], tz[n-1], u1, v1);
    MeshData cap0 = diskX(px[0], py[0], pz[0], u0[0], u0[1], u0[2], v0[0], v0[1], v0[2],
                          radii[0], sides, true);
    MeshData cap1 = diskX(px[n-1], py[n-1], pz[n-1], u1[0], u1[1], u1[2], v1[0], v1[1], v1[2],
                          radii[n-1], sides, false);
    return concatMeshesX({wall, cap0, cap1});
}

/** Chord-length-parametrized position spline; fills `knot` (strictly increasing). */
MonotonicCurveFit buildPositionFit(const std::vector<float>& cxp, const std::vector<float>& cyp,
                                   const std::vector<float>& czp, int cn,
                                   std::vector<double>& knot) {
    std::vector<std::vector<double>> y((size_t) cn, std::vector<double>(3, 0.0));
    y[0][0] = cxp[0]; y[0][1] = cyp[0]; y[0][2] = czp[0];
    for (int i = 1; i < cn; i++) {
        float dx = cxp[i] - cxp[i-1];
        float dy = cyp[i] - cyp[i-1];
        float dz = czp[i] - czp[i-1];
        // The sum of squares is a float expression, widened only for the sqrt.
        double d = jsqrt((double)(dx * dx + dy * dy + dz * dz));
        knot[i] = knot[i-1] + std::max(d, 1e-4);   // floor: coincident points would divide by 0
        y[i][0] = cxp[i]; y[i][1] = cyp[i]; y[i][2] = czp[i];
    }
    return MonotonicCurveFit(knot, y);
}

float radiusAt(const MonotonicCurveFit* radiusFit, double t, float constRadius) {
    if (!radiusFit) return constRadius;
    float r = (float) radiusFit->getPosAt(t, 0);
    return r < 0.f ? 0.f : r;
}

int sampleCenterline(const MonotonicCurveFit& fit, double t, float* pos,
                     std::vector<double>& slope,
                     std::vector<float>& px, std::vector<float>& py, std::vector<float>& pz,
                     std::vector<float>& tx, std::vector<float>& ty, std::vector<float>& tz,
                     int w, float pTx, float pTy, float pTz) {
    fit.getPos(t, pos);
    fit.getSlope(t, slope);
    px[w] = pos[0]; py[w] = pos[1]; pz[w] = pos[2];
    float sx = (float) slope[0], sy = (float) slope[1], sz = (float) slope[2];
    float l = (float) jsqrt((double)(sx * sx + sy * sy + sz * sz));
    if (l < 1e-6f) { tx[w] = pTx; ty[w] = pTy; tz[w] = pTz; }
    else { tx[w] = sx / l; ty[w] = sy / l; tz[w] = sz / l; }
    return w + 1;
}

/**
 * Sample the centreline with an adaptive (or explicit) ring count and build the tube. The
 * adaptive count matches the lengthwise step to the cross-section edge length using the local
 * radius, so long or sharply curved spans densify automatically.
 */
MeshData splineSweep(const MonotonicCurveFit& fit, const std::vector<double>& knot, int cn,
                     int sides, bool capped, float pathPerSpan,
                     const MonotonicCurveFit* radiusFit, float constRadius) {
    bool manual = pathPerSpan > 0.f;
    int fixedNs = manual ? clampIntX((int) std::lround(pathPerSpan), 1, MAX_TUBE_PER_SPAN) : 0;
    const int arcSubSamples = 6;
    std::vector<int> perSpan((size_t) cn - 1);
    int total = 1;   // + the final endpoint
    std::vector<double> a(3), b(3);
    for (int i = 0; i < cn - 1; i++) {
        int ns;
        if (manual) ns = fixedNs;
        else {
            double k0 = knot[i], k1 = knot[i + 1];
            float rMid = radiusFit ? (float) radiusFit->getPosAt((k0 + k1) * 0.5, 0) : constRadius;
            double step = std::max(2.0 * std::fabs(rMid) * jsin((double)(M_PI / sides)), 1e-4);
            double arc = 0.0;
            fit.getPos(k0, a);
            for (int s = 1; s <= arcSubSamples; s++) {
                fit.getPos(k0 + (k1 - k0) * s / arcSubSamples, b);
                double dx = b[0]-a[0], dy = b[1]-a[1], dz = b[2]-a[2];
                arc += jsqrt((double)(dx*dx + dy*dy + dz*dz));
                a[0] = b[0]; a[1] = b[1]; a[2] = b[2];
            }
            ns = clampIntX((int) std::lround(arc / step), 1, MAX_TUBE_PER_SPAN);
        }
        perSpan[i] = ns;
        total += ns;
    }
    int n = total;
    std::vector<float> px(n), py(n), pz(n), tx(n), ty(n), tz(n), radii(n);
    float pos[3];
    std::vector<double> slope(3);
    float pTx = 0.f, pTy = 1.f, pTz = 0.f;
    int w = 0;
    for (int i = 0; i < cn - 1; i++) {
        double k0 = knot[i], k1 = knot[i + 1];
        int ns = perSpan[i];
        for (int s = 0; s < ns; s++) {
            // Each span emits its start and interior but not its end — that is the next span's
            // start, or the final endpoint below — so rings are not duplicated at the joins.
            double t = k0 + (k1 - k0) * s / ns;
            w = sampleCenterline(fit, t, pos, slope, px, py, pz, tx, ty, tz, w, pTx, pTy, pTz);
            radii[w - 1] = radiusAt(radiusFit, t, constRadius);
            pTx = tx[w-1]; pTy = ty[w-1]; pTz = tz[w-1];
        }
    }
    double tEnd = knot[cn - 1];
    w = sampleCenterline(fit, tEnd, pos, slope, px, py, pz, tx, ty, tz, w, pTx, pTy, pTz);
    radii[w - 1] = radiusAt(radiusFit, tEnd, constRadius);
    return buildTubeFromCenterline(px, py, pz, tx, ty, tz, radii, n, sides, capped);
}

MeshData tubeLegacy(std::vector<float> cxp, std::vector<float> cyp, std::vector<float> czp,
                    int cn, float radius, int sides, bool capped, float segments,
                    int flags, float pathPerSpan) {
    std::vector<float> px, py, pz;
    if ((flags & FLAG_SPLINE) != 0) {
        int per = pathPerSpan > 0.f
            ? clampIntX((int) std::lround(pathPerSpan), 1, MAX_TUBE_PER_SPAN)
            : segCountX(segments, 8, 1);
        int n = (cn - 1) * per + 1;
        px.assign(n, 0.f); py.assign(n, 0.f); pz.assign(n, 0.f);
        int w = 0;
        for (int i = 0; i < cn - 1; i++) {
            int i0 = std::max(0, i - 1), i2 = i + 1, i3 = std::min(cn - 1, i + 2);
            for (int s = 0; s < per; s++) {
                float t = s / (float) per;
                px[w] = catmullX(cxp[i0], cxp[i], cxp[i2], cxp[i3], t);
                py[w] = catmullX(cyp[i0], cyp[i], cyp[i2], cyp[i3], t);
                pz[w] = catmullX(czp[i0], czp[i], czp[i2], czp[i3], t);
                w++;
            }
        }
        px[w] = cxp[cn-1]; py[w] = cyp[cn-1]; pz[w] = czp[cn-1];
    } else {
        px = cxp; py = cyp; pz = czp;
    }
    int n = (int) px.size();
    std::vector<float> tx(n), ty(n), tz(n);
    for (int i = 0; i < n; i++) {
        float ax = 0, ay = 0, az = 0;
        if (i > 0) { ax += px[i]-px[i-1]; ay += py[i]-py[i-1]; az += pz[i]-pz[i-1]; }
        if (i < n-1) { ax += px[i+1]-px[i]; ay += py[i+1]-py[i]; az += pz[i+1]-pz[i]; }
        float l = (float) jsqrt((double)(ax*ax + ay*ay + az*az));
        if (l < 1e-6f) { ax = 0; ay = 1; az = 0; l = 1; }
        tx[i] = ax / l; ty[i] = ay / l; tz[i] = az / l;
    }
    std::vector<float> radii((size_t) n, radius);
    return buildTubeFromCenterline(px, py, pz, tx, ty, tz, radii, n, sides, capped);
}

// ---- extrude path helpers -------------------------------------------------

float signedArea(const std::vector<float>& ring) {
    int n = (int) ring.size() / 2;
    float a = 0.f;
    for (int i = 0; i < n; i++) {
        int j = (i + 1) % n;
        a += ring[i*2] * ring[j*2+1] - ring[j*2] * ring[i*2+1];
    }
    return a * 0.5f;
}

bool pointInPolygon(const std::vector<float>& ring, float px, float py) {
    int n = (int) ring.size() / 2;
    bool in = false;
    for (int i = 0, j = n - 1; i < n; j = i++) {
        float xi = ring[i*2], yi = ring[i*2+1];
        float xj = ring[j*2], yj = ring[j*2+1];
        bool crosses = (yi > py) != (yj > py);
        if (crosses && px < (xj - xi) * (py - yi) / (yj - yi) + xi) in = !in;
    }
    return in;
}

/** Even-odd hole test: a contour is a hole if it lies inside an odd number of the others. */
bool isHole(const std::vector<std::vector<float>>& contours, size_t ringIndex) {
    const std::vector<float>& ring = contours[ringIndex];
    if (ring.size() < 2) return false;
    float px = ring[0], py = ring[1];
    int inside = 0;
    for (size_t c = 0; c < contours.size(); c++) {
        if (c == ringIndex) continue;
        if (pointInPolygon(contours[c], px, py)) inside++;
    }
    return (inside & 1) == 1;
}

/** Offset a closed contour inward by b, mitering at corners so adjacent edges share the vertex. */
std::vector<float> miterInset(const std::vector<float>& ring, float b, float miterLimit) {
    int n = (int) ring.size() / 2;
    std::vector<float> out(ring.size(), 0.f);
    float sign = signedArea(ring) >= 0.f ? 1.f : -1.f;   // +1 CCW (interior on the left)
    for (int i = 0; i < n; i++) {
        int ip = (i - 1 + n) % n, in = (i + 1) % n;
        float pdx = ring[i*2] - ring[ip*2];
        float pdy = ring[i*2+1] - ring[ip*2+1];
        float ndx = ring[in*2] - ring[i*2];
        float ndy = ring[in*2+1] - ring[i*2+1];
        float pl = (float) jsqrt((double)(pdx*pdx + pdy*pdy));
        if (pl > 1e-9f) { pdx /= pl; pdy /= pl; }
        float nl = (float) jsqrt((double)(ndx*ndx + ndy*ndy));
        if (nl > 1e-9f) { ndx /= nl; ndy /= nl; }
        float n1x = sign * -pdy, n1y = sign * pdx;
        float n2x = sign * -ndy, n2y = sign * ndx;
        float mx = n1x + n2x, my = n1y + n2y;
        float ml = (float) jsqrt((double)(mx*mx + my*my));
        if (ml < 1e-6f) {
            out[i*2] = ring[i*2] + b * n2x;
            out[i*2+1] = ring[i*2+1] + b * n2y;
            continue;
        }
        mx /= ml; my /= ml;
        float cosv = mx * n1x + my * n1y;
        float l = b / std::max(cosv, 1.f / miterLimit);
        out[i*2] = ring[i*2] + l * mx;
        out[i*2+1] = ring[i*2+1] + l * my;
    }
    return out;
}

/**
 * Triangulate the two flat caps: a scanline / trapezoid sweep over all contour edges using the
 * nonzero-winding rule — what fonts and Path use by default. Needs no ear clipping and handles
 * holes and overlapping contours for free.
 */
MeshData scanlineCaps(const std::vector<std::vector<float>>& contours,
                      float cx, float cy, float frontZ, float backZ) {
    int edgeCount = 0;
    for (const auto& ring : contours) edgeCount += (int) ring.size() / 2;
    std::vector<float> eYlo(edgeCount), eYhi(edgeCount), eXlo(edgeCount), eSlope(edgeCount);
    std::vector<int> eDir(edgeCount);
    int ne = 0;
    std::vector<float> ys((size_t) edgeCount * 2);
    int nys = 0;
    for (const auto& ring : contours) {
        int n = (int) ring.size() / 2;
        for (int i = 0; i < n; i++) {
            float ay = ring[i*2+1];
            int j = (i + 1) % n;
            float by = ring[j*2+1];
            ys[nys++] = ay;
            if (ay == by) continue;   // horizontal edges contribute no crossings
            float ax = ring[i*2], bx = ring[j*2];
            if (ay < by) { eYlo[ne] = ay; eYhi[ne] = by; eXlo[ne] = ax; }
            else { eYlo[ne] = by; eYhi[ne] = ay; eXlo[ne] = bx; }
            eSlope[ne] = (bx - ax) / (by - ay);
            eDir[ne] = (by > ay) ? 1 : -1;
            ne++;
        }
    }
    std::sort(ys.begin(), ys.begin() + nys);
    int uy = 0;
    for (int i = 0; i < nys; i++) {
        if (uy == 0 || ys[i] > ys[uy - 1] + 1e-7f) ys[uy++] = ys[i];
    }
    std::vector<std::array<float, 8>> traps;
    std::vector<float> crossX(ne);
    std::vector<int> crossE(ne);
    for (int s = 0; s + 1 < uy; s++) {
        float yA = ys[s], yB = ys[s + 1];
        if (yB - yA < 1e-7f) continue;
        float ymid = 0.5f * (yA + yB);
        int nx = 0;
        for (int e = 0; e < ne; e++) {
            if (eYlo[e] < ymid && ymid < eYhi[e]) {
                crossX[nx] = eXlo[e] + (ymid - eYlo[e]) * eSlope[e];
                crossE[nx] = e;
                nx++;
            }
        }
        if (nx < 2) continue;
        // Insertion sort, matching the reference: a stable order decides which edges pair.
        for (int a = 1; a < nx; a++) {
            float kx = crossX[a];
            int ke = crossE[a];
            int b = a - 1;
            while (b >= 0 && crossX[b] > kx) {
                crossX[b+1] = crossX[b]; crossE[b+1] = crossE[b]; b--;
            }
            crossX[b+1] = kx; crossE[b+1] = ke;
        }
        int winding = 0;
        for (int i = 0; i + 1 < nx; i++) {
            winding += eDir[crossE[i]];
            if (winding == 0) continue;
            int le = crossE[i], re = crossE[i + 1];
            float xLtop = eXlo[le] + (yB - eYlo[le]) * eSlope[le];
            float xLbot = eXlo[le] + (yA - eYlo[le]) * eSlope[le];
            float xRtop = eXlo[re] + (yB - eYlo[re]) * eSlope[re];
            float xRbot = eXlo[re] + (yA - eYlo[re]) * eSlope[re];
            traps.push_back({xLtop, yB, xRtop, yB, xRbot, yA, xLbot, yA});
        }
    }
    int t = (int) traps.size();
    MeshData m;
    m.verts.assign((size_t) t * 8 * 3, 0.f);
    m.normals.assign((size_t) t * 8 * 3, 0.f);
    m.indices.resize((size_t) t * 12);
    int io = 0;
    int backBase = t * 4;
    for (int q = 0; q < t; q++) {
        const auto& g = traps[q];
        int fb = q * 4, bb = backBase + q * 4;
        for (int j = 0; j < 4; j++) {
            float x = g[j*2], y = g[j*2+1];
            int f = (fb + j) * 3;
            m.verts[f] = cx + x; m.verts[f+1] = cy + y; m.verts[f+2] = frontZ;
            m.normals[f+2] = 1.f;
            int bk = (bb + j) * 3;
            m.verts[bk] = cx + x; m.verts[bk+1] = cy + y; m.verts[bk+2] = backZ;
            m.normals[bk+2] = -1.f;
        }
        m.indices[io++] = fb; m.indices[io++] = fb+2; m.indices[io++] = fb+1;
        m.indices[io++] = fb; m.indices[io++] = fb+3; m.indices[io++] = fb+2;
        m.indices[io++] = bb; m.indices[io++] = bb+1; m.indices[io++] = bb+2;
        m.indices[io++] = bb; m.indices[io++] = bb+2; m.indices[io++] = bb+3;
    }
    return m;
}

void setV(std::vector<float>& verts, std::vector<float>& normals, int i,
          float x, float y, float z, float nx, float ny, float nz) {
    int p = i * 3;
    verts[p] = x; verts[p+1] = y; verts[p+2] = z;
    normals[p] = nx; normals[p+1] = ny; normals[p+2] = nz;
}

MeshData extrudePathSides(const std::vector<std::vector<float>>& contours,
                          const std::vector<std::vector<float>>* inset,
                          float cx, float cy, float cz, float hd, float b) {
    bool beveled = b > 0.f && inset != nullptr;
    float wallHd = hd - b;
    float inv = (float) 0.70710678;   // 1/sqrt(2), the 45-degree chamfer normal split
    int edgeCount = 0;
    for (const auto& ring : contours) edgeCount += (int) ring.size() / 2;
    int vpe = beveled ? 12 : 4;
    int tpe = beveled ? 6 : 2;
    MeshData m;
    m.verts.assign((size_t) edgeCount * vpe * 3, 0.f);
    m.normals.assign((size_t) edgeCount * vpe * 3, 0.f);
    m.indices.resize((size_t) edgeCount * tpe * 3);
    int io = 0, se = 0;
    for (size_t c = 0; c < contours.size(); c++) {
        const std::vector<float>& ring = contours[c];
        int n = (int) ring.size() / 2;
        if (n < 3) { se += n; continue; }
        const std::vector<float>* ins = beveled ? &(*inset)[c] : nullptr;
        bool hole = isHole(contours, c);
        bool reverse = (signedArea(ring) > 0.f) == hole;
        for (int i = 0; i < n; i++) {
            int ia = reverse ? (n - i) % n : i;
            int ib = reverse ? (n - i - 1 + n) % n : (i + 1) % n;
            float ax = ring[ia*2], ay = ring[ia*2+1];
            float bx = ring[ib*2], by = ring[ib*2+1];
            float nx = by - ay;   // outward = right of travel for a material-on-left loop
            float ny = -(bx - ax);
            float len = (float) jsqrt((double)(nx*nx + ny*ny));
            if (len > 1e-9f) { nx /= len; ny /= len; }
            if (!beveled) {
                int v = se * 4;
                setV(m.verts, m.normals, v, cx+ax, cy+ay, cz+hd, nx, ny, 0.f);
                setV(m.verts, m.normals, v+1, cx+bx, cy+by, cz+hd, nx, ny, 0.f);
                setV(m.verts, m.normals, v+2, cx+ax, cy+ay, cz-hd, nx, ny, 0.f);
                setV(m.verts, m.normals, v+3, cx+bx, cy+by, cz-hd, nx, ny, 0.f);
                m.indices[io++] = v; m.indices[io++] = v+2; m.indices[io++] = v+3;
                m.indices[io++] = v; m.indices[io++] = v+3; m.indices[io++] = v+1;
            } else {
                float iax = (*ins)[ia*2], iay = (*ins)[ia*2+1];
                float ibx = (*ins)[ib*2], iby = (*ins)[ib*2+1];
                int v = se * 12;
                setV(m.verts, m.normals, v, cx+iax, cy+iay, cz+hd, nx*inv, ny*inv, inv);
                setV(m.verts, m.normals, v+1, cx+ibx, cy+iby, cz+hd, nx*inv, ny*inv, inv);
                setV(m.verts, m.normals, v+2, cx+ax, cy+ay, cz+wallHd, nx*inv, ny*inv, inv);
                setV(m.verts, m.normals, v+3, cx+bx, cy+by, cz+wallHd, nx*inv, ny*inv, inv);
                m.indices[io++] = v; m.indices[io++] = v+2; m.indices[io++] = v+3;
                m.indices[io++] = v; m.indices[io++] = v+3; m.indices[io++] = v+1;
                setV(m.verts, m.normals, v+4, cx+ax, cy+ay, cz+wallHd, nx, ny, 0.f);
                setV(m.verts, m.normals, v+5, cx+bx, cy+by, cz+wallHd, nx, ny, 0.f);
                setV(m.verts, m.normals, v+6, cx+ax, cy+ay, cz-wallHd, nx, ny, 0.f);
                setV(m.verts, m.normals, v+7, cx+bx, cy+by, cz-wallHd, nx, ny, 0.f);
                m.indices[io++] = v+4; m.indices[io++] = v+6; m.indices[io++] = v+7;
                m.indices[io++] = v+4; m.indices[io++] = v+7; m.indices[io++] = v+5;
                setV(m.verts, m.normals, v+8, cx+ax, cy+ay, cz-wallHd, nx*inv, ny*inv, -inv);
                setV(m.verts, m.normals, v+9, cx+bx, cy+by, cz-wallHd, nx*inv, ny*inv, -inv);
                setV(m.verts, m.normals, v+10, cx+iax, cy+iay, cz-hd, nx*inv, ny*inv, -inv);
                setV(m.verts, m.normals, v+11, cx+ibx, cy+iby, cz-hd, nx*inv, ny*inv, -inv);
                m.indices[io++] = v+8; m.indices[io++] = v+10; m.indices[io++] = v+11;
                m.indices[io++] = v+8; m.indices[io++] = v+11; m.indices[io++] = v+9;
            }
            se++;
        }
    }
    return m;
}

/** Flat end cap for sweep(): a centroid fan, wound to agree with the face direction. */
int sweepCap(std::vector<float>& verts, std::vector<float>& normals,
             std::vector<int32_t>& indices, int io, int vbase, int stationRow,
             int cols, int m, float fnx, float fny, float fnz) {
    float ccx = 0.f, ccy = 0.f, ccz = 0.f;
    for (int k = 0; k < m; k++) {
        int p = (stationRow * cols + k) * 3;
        ccx += verts[p]; ccy += verts[p+1]; ccz += verts[p+2];
    }
    ccx /= m; ccy /= m; ccz /= m;
    int centroid = vbase;
    verts[centroid*3] = ccx; verts[centroid*3+1] = ccy; verts[centroid*3+2] = ccz;
    normals[centroid*3] = fnx; normals[centroid*3+1] = fny; normals[centroid*3+2] = fnz;
    for (int k = 0; k < m; k++) {
        int src = (stationRow * cols + k) * 3;
        int dst = (vbase + 1 + k) * 3;
        verts[dst] = verts[src]; verts[dst+1] = verts[src+1]; verts[dst+2] = verts[src+2];
        normals[dst] = fnx; normals[dst+1] = fny; normals[dst+2] = fnz;
    }
    int r0 = vbase + 1, r1 = vbase + 1 + (1 % m);
    float ux = verts[r0*3] - ccx, uy = verts[r0*3+1] - ccy, uz = verts[r0*3+2] - ccz;
    float wx = verts[r1*3] - ccx, wy = verts[r1*3+1] - ccy, wz = verts[r1*3+2] - ccz;
    float gx = uy*wz - uz*wy, gy = uz*wx - ux*wz, gz = ux*wy - uy*wx;
    bool flip = (gx*fnx + gy*fny + gz*fnz) < 0.f;
    for (int k = 0; k < m; k++) {
        int aa = vbase + 1 + k;
        int bb = vbase + 1 + ((k + 1) % m);
        indices[io++] = centroid;
        if (flip) { indices[io++] = bb; indices[io++] = aa; }
        else { indices[io++] = aa; indices[io++] = bb; }
    }
    return io;
}

} // namespace

MeshData tubeM(const std::vector<float>& params, bool capped, float segments, int flags) {
    float radius = params[0];
    // FLAG_TUBE_PATH_DENSITY inserts an explicit rings-per-span float at params[1], so the
    // points then start at params[2]. <= 0 means adaptive.
    bool manualDensity = (flags & FLAG_TUBE_PATH_DENSITY) != 0;
    int off = manualDensity ? 2 : 1;
    float pathPerSpan = manualDensity ? params[1] : 0.f;
    int cn = ((int) params.size() - off) / 3;
    if (cn < 2) throw std::runtime_error("MeshPrimitive tube: need >= 2 points");
    std::vector<float> cxp(cn), cyp(cn), czp(cn);
    for (int i = 0; i < cn; i++) {
        cxp[i] = params[off + i*3];
        cyp[i] = params[off + i*3 + 1];
        czp[i] = params[off + i*3 + 2];
    }
    int sides = segCountX(segments, DEFAULT_TUBE_SIDES, 3);
    if ((flags & FLAG_TUBE_LEGACY) != 0) {
        return tubeLegacy(cxp, cyp, czp, cn, radius, sides, capped, segments, flags, pathPerSpan);
    }
    std::vector<double> knot((size_t) cn, 0.0);
    MonotonicCurveFit fit = buildPositionFit(cxp, cyp, czp, cn, knot);
    return splineSweep(fit, knot, cn, sides, capped, pathPerSpan, nullptr, radius);
}

MeshData profileTubeM(const std::vector<float>& params, int sides, int flags) {
    int nPoints = (int) std::lround(params[0]);
    bool manualDensity = (flags & FLAG_TUBE_PATH_DENSITY) != 0;
    bool capped = (flags & FLAG_TUBE_CAP) != 0;
    int posOff = manualDensity ? 2 : 1;
    float pathPerSpan = manualDensity ? params[1] : 0.f;
    if (nPoints < 2) throw std::runtime_error("MeshPrimitive profile tube: need >= 2 points");
    int rOff = posOff + 3 * nPoints;
    int nR = (int) params.size() - rOff;
    if (nR < 1) throw std::runtime_error("MeshPrimitive profile tube: need >= 1 radius");
    std::vector<float> cxp(nPoints), cyp(nPoints), czp(nPoints);
    for (int i = 0; i < nPoints; i++) {
        cxp[i] = params[posOff + i*3];
        cyp[i] = params[posOff + i*3 + 1];
        czp[i] = params[posOff + i*3 + 2];
    }
    std::vector<double> knot((size_t) nPoints, 0.0);
    MonotonicCurveFit fit = buildPositionFit(cxp, cyp, czp, nPoints, knot);
    double pathLen = knot[nPoints - 1];
    std::unique_ptr<MonotonicCurveFit> radiusFit;
    if (nR >= 2) {
        std::vector<double> rk((size_t) nR);
        std::vector<std::vector<double>> rv((size_t) nR, std::vector<double>(1, 0.0));
        for (int j = 0; j < nR; j++) {
            rk[j] = pathLen * j / (nR - 1);
            rv[j][0] = params[rOff + j];
        }
        radiusFit = std::make_unique<MonotonicCurveFit>(rk, rv);
    }
    return splineSweep(fit, knot, nPoints, sides, capped, pathPerSpan, radiusFit.get(),
                       params[rOff]);
}

MeshData sweepM(const std::vector<float>& scalars, const std::vector<float>& xsec,
                const std::vector<float>& path, const std::vector<float>* scales,
                const std::vector<float>* twists) {
    int m = (int) xsec.size() / 2;
    int n = (int) path.size() / 3;
    if (m < 2 || n < 2) {
        throw std::runtime_error(
            "MeshPrimitive sweep: need >= 2 cross-section points and >= 2 path points");
    }
    bool closed = scalars.size() > 0 && scalars[0] != 0.f;
    bool capStart = scalars.size() > 1 && scalars[1] != 0.f;
    bool capEnd = scalars.size() > 2 && scalars[2] != 0.f;
    float cx = scalars.size() > 3 ? scalars[3] : 0.f;
    float cy = scalars.size() > 4 ? scalars[4] : 0.f;
    float cz = scalars.size() > 5 ? scalars[5] : 0.f;

    std::vector<float> px(n), py(n), pz(n);
    for (int i = 0; i < n; i++) {
        px[i] = cx + path[i*3];
        py[i] = cy + path[i*3+1];
        pz[i] = cz + path[i*3+2];
    }
    std::vector<float> tx(n), ty(n), tz(n);
    for (int i = 0; i < n; i++) {
        int a = std::max(0, i - 1), b = std::min(n - 1, i + 1);
        float dx = px[b]-px[a], dy = py[b]-py[a], dz = pz[b]-pz[a];
        float l = (float) jsqrt((double)(dx*dx + dy*dy + dz*dz));
        if (l < 1e-9f) l = 1e-9f;
        tx[i] = dx / l; ty[i] = dy / l; tz[i] = dz / l;
    }
    std::vector<float> nlx((size_t) m, 0.f), nly((size_t) m, 0.f);
    int xEdges = closed ? m : m - 1;
    for (int e = 0; e < xEdges; e++) {
        int k0 = e, k1 = (e + 1) % m;
        float dx = xsec[k1*2] - xsec[k0*2];
        float dy = xsec[k1*2+1] - xsec[k0*2+1];
        float ex = dy, ey = -dx;
        float l = (float) jsqrt((double)(ex*ex + ey*ey));
        if (l > 1e-9f) { ex /= l; ey /= l; }
        nlx[k0] += ex; nly[k0] += ey;
        nlx[k1] += ex; nly[k1] += ey;
    }
    for (int k = 0; k < m; k++) {
        float l = (float) jsqrt((double)(nlx[k]*nlx[k] + nly[k]*nly[k]));
        if (l > 1e-9f) { nlx[k] /= l; nly[k] /= l; }
        else { nlx[k] = 1.f; nly[k] = 0.f; }
    }
    int cols = closed ? m + 1 : m;   // duplicate the seam column when closed
    int wallV = n * cols;
    int capV = (capStart ? m + 1 : 0) + (capEnd ? m + 1 : 0);
    MeshData res;
    res.verts.assign((size_t)(wallV + capV) * 3, 0.f);
    res.normals.assign((size_t)(wallV + capV) * 3, 0.f);
    int wallStrips = closed ? m : m - 1;
    int wallTris = (n - 1) * wallStrips * 2;
    int capTris = (capStart ? m : 0) + (capEnd ? m : 0);
    res.indices.resize((size_t)(wallTris + capTris) * 3);

    float u[3], v[3];
    perpBasisX(tx[0], ty[0], tz[0], u, v);
    for (int i = 0; i < n; i++) {
        if (i > 0) {
            float dot = u[0]*tx[i] + u[1]*ty[i] + u[2]*tz[i];
            u[0] -= dot*tx[i]; u[1] -= dot*ty[i]; u[2] -= dot*tz[i];
            float ul = (float) jsqrt((double)(u[0]*u[0] + u[1]*u[1] + u[2]*u[2]));
            if (ul < 1e-6f) perpBasisX(tx[i], ty[i], tz[i], u, v);
            else {
                u[0] /= ul; u[1] /= ul; u[2] /= ul;
                cross3X(tx[i], ty[i], tz[i], u[0], u[1], u[2], v);
            }
        }
        float s = (scales && (int) scales->size() > i) ? (*scales)[i] : 1.f;
        float tw = (twists && (int) twists->size() > i) ? (*twists)[i] : 0.f;
        float ct = (float) jcos((double)(tw)), st = (float) jsin((double)(tw));
        for (int j = 0; j < cols; j++) {
            int k = j % m;
            float lx = xsec[k*2], ly = xsec[k*2+1];
            float rx = ct * lx - st * ly;   // twist the section in its own plane
            float ry = st * lx + ct * ly;
            int p = (i * cols + j) * 3;
            res.verts[p] = px[i] + s * (rx*u[0] + ry*v[0]);
            res.verts[p+1] = py[i] + s * (rx*u[1] + ry*v[1]);
            res.verts[p+2] = pz[i] + s * (rx*u[2] + ry*v[2]);
            float nrx = ct * nlx[k] - st * nly[k];
            float nry = st * nlx[k] + ct * nly[k];
            float nx = nrx*u[0] + nry*v[0];
            float ny = nrx*u[1] + nry*v[1];
            float nz = nrx*u[2] + nry*v[2];
            float nl = (float) jsqrt((double)(nx*nx + ny*ny + nz*nz));
            if (nl > 1e-9f) { nx /= nl; ny /= nl; nz /= nl; }
            res.normals[p] = nx; res.normals[p+1] = ny; res.normals[p+2] = nz;
        }
    }
    int io = 0;
    for (int i = 0; i < n - 1; i++) {
        for (int j = 0; j < wallStrips; j++) {
            int a = i*cols + j, b = i*cols + j + 1;
            int cc = (i+1)*cols + j, d = (i+1)*cols + j + 1;
            res.indices[io++] = cc; res.indices[io++] = a; res.indices[io++] = b;
            res.indices[io++] = b; res.indices[io++] = d; res.indices[io++] = cc;
        }
    }
    int capBase = wallV;
    if (capStart) {
        io = sweepCap(res.verts, res.normals, res.indices, io, capBase, 0, cols, m,
                      -tx[0], -ty[0], -tz[0]);
        capBase += m + 1;
    }
    if (capEnd) {
        io = sweepCap(res.verts, res.normals, res.indices, io, capBase, n - 1, cols, m,
                      tx[n-1], ty[n-1], tz[n-1]);
    }
    return res;
}

MeshData helixM(float coilR, float tubeR, float pitch, float turns,
                float cx, float cy, float cz, int sides) {
    int perTurn = std::max(8, sides * 2);
    int stations = std::max(2, (int) std::lround(perTurn * std::fabs(turns)) + 1);
    std::vector<float> path((size_t) stations * 3);
    float totalRise = pitch * turns;
    for (int i = 0; i < stations; i++) {
        float f = i / (float)(stations - 1);
        double ang = 2.0 * M_PI * turns * f;
        path[i*3] = coilR * (float) jcos((double)(ang));
        path[i*3+1] = totalRise * (f - 0.5f);   // centre the coil vertically
        path[i*3+2] = coilR * (float) jsin((double)(ang));
    }
    std::vector<float> xsec((size_t) sides * 2);
    for (int k = 0; k < sides; k++) {
        double a = 2.0 * M_PI * k / sides;
        xsec[k*2] = tubeR * (float) jcos((double)(a));
        xsec[k*2+1] = tubeR * (float) jsin((double)(a));
    }
    std::vector<float> scalars = {1.f, 1.f, 1.f, cx, cy, cz};   // closed, both ends capped
    return sweepM(scalars, xsec, path, nullptr, nullptr);
}

MeshData extrudePathM(const std::vector<float>& p) {
    float depth = p[0], cx = p[1], cy = p[2], cz = p[3], bevel = p[4];
    int nc = (int) std::lround(p[5]);
    std::vector<std::vector<float>> contours;
    size_t idx = 6;
    for (int c = 0; c < nc; c++) {
        int cnt = (int) std::lround(p[idx++]);
        std::vector<float> ring((size_t) cnt * 2, 0.f);
        for (int k = 0; k < cnt * 2 && idx < p.size(); k++) ring[k] = p[idx++];
        contours.push_back(ring);
    }
    float hd = depth * 0.5f;
    if (bevel <= 0.f) {
        // Sharp (default): flat caps over the full contours plus straight walls.
        MeshData caps = scanlineCaps(contours, cx, cy, cz + hd, cz - hd);
        MeshData sides = extrudePathSides(contours, nullptr, cx, cy, cz, hd, 0.f);
        return concatMeshesX({caps, sides});
    }
    float b = std::min(bevel, hd * 0.9f);
    std::vector<std::vector<float>> inset;
    for (const auto& ring : contours) inset.push_back(miterInset(ring, b, 4.f));
    MeshData caps = scanlineCaps(inset, cx, cy, cz + hd, cz - hd);
    MeshData sides = extrudePathSides(contours, &inset, cx, cy, cz, hd, b);
    return concatMeshesX({caps, sides});
}

} // namespace rccore::d3
