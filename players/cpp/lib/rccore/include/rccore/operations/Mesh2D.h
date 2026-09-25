#pragma once
// 2D vertex meshes — ADD_MESH_2D (104), DRAW_MESH_2D (105), MATRIX_FROM_MESH_2D (106).
//
// Ported from androidx remote-core AddMesh2D.java / DrawMesh2D.java / MatrixFromMesh2D.java
// and operations/utilities/Mesh2DGenerator.java (landed 2026-09). The wire format and the
// generated geometry are both part of the contract: a document is authored against one
// player and drawn on another, so the vertices this produces must match the reference for
// the same input, not merely look similar.
//
// The expression form evaluates nine channels over (u, v). u and v reach the evaluator as
// VAR1/VAR2 — the a[0]/a[1] slots — which is exactly how the reference binds them, and why
// the JSON spellings `u` and `v` compile to EXPR_OFFSET+70/71.

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <memory>
#include <vector>

#include "rccore/ExpressionEvaluator.h"
#include "rccore/Operation.h"
#include "rccore/PaintContext.h"
#include "rccore/RemoteContext.h"
#include "rccore/WireBuffer.h"
#include "rccore/operations/FloatFormat.h"

namespace rccore {

namespace mesh2d {

// ── layouts, types, blends, matrix flags ────────────────────────────────────────────────
enum Layout {
    LAYOUT_GRID = 0,
    LAYOUT_POLAR = 1,
    LAYOUT_RING = 2,
    LAYOUT_STRIP = 3,
    LAYOUT_FAN = 4,
    LAYOUT_PATH_STRIP = 5,
};

enum Type {
    TYPE_EXPRESSION = 0,
    TYPE_VALUES = 1,
    TYPE_F16_VALUES = 2,
    TYPE_PATH_SPLINE_STRIP = 3,
    TYPE_SPLINE_ROUND_STRIP = 4,
};

enum Blend { BLEND_COLORS_ONLY = 0, BLEND_MODULATE = 1 };
enum MatrixFlags { FLAG_ORIGIN = 0, FLAG_ROTATION = 1, FLAG_SCALE = 2, FLAG_FULL = 3 };

static constexpr int EXPRESSION_GROUPS = 9;
static constexpr int EXP_X = 0, EXP_Y = 1, EXP_TEX_U = 2, EXP_TEX_V = 3;
static constexpr int EXP_COLOR_A = 4, EXP_COLOR_R = 5, EXP_COLOR_G = 6, EXP_COLOR_B = 7;
static constexpr int EXP_WIDTH = 8;

static constexpr int NO_IMAGE = 0;
static constexpr int MIN_ROUND_CAP_SEGMENTS = 3;
static constexpr int MAX_ROUND_CAP_SEGMENTS = 16;
static constexpr float DEFAULT_RING_INNER_RADIUS = 0.5f;
static constexpr float TWO_PI = 6.2831855f;
static constexpr float HALF_PI = 1.5707964f;

// Limits.java, mirrored so a malformed document is rejected rather than allocating wildly.
static constexpr int MAX_MESH_2D_VERTICES = 16384;
static constexpr int MAX_MESH_2D_INDICES = 49152;
static constexpr int MAX_MESH_2D_GRID = 16384;

inline bool wrapsU(int layout) {
    return layout == LAYOUT_POLAR || layout == LAYOUT_RING || layout == LAYOUT_FAN;
}

inline int vertexCount(int layout, int uCount, int vCount) {
    if (layout == LAYOUT_FAN) return uCount + 1;   // shared centre plus a rim
    return uCount * vCount;
}

inline int indexCount(int layout, int uCount, int vCount) {
    if (layout == LAYOUT_FAN) return uCount * 3;
    if (vCount < 2 || uCount < 2) return 0;
    int columns = wrapsU(layout) ? uCount : uCount - 1;
    return columns * (vCount - 1) * 6;
}

// A wrapping layout divides by uCount so the sample after the last is the first; a
// non-wrapping one divides by uCount-1 so the domain is closed at both ends.
inline float domainU(int layout, int i, int uCount) {
    if (uCount <= 1) return 0.0f;
    if (wrapsU(layout)) return static_cast<float>(i) / static_cast<float>(uCount);
    return static_cast<float>(i) / static_cast<float>(uCount - 1);
}

inline float domainV(int j, int vCount) {
    if (vCount <= 1) return 0.0f;
    return static_cast<float>(j) / static_cast<float>(vCount - 1);
}

inline void generateIndices(int layout, int uCount, int vCount, std::vector<int32_t>& out) {
    out.assign(static_cast<size_t>(std::max(0, indexCount(layout, uCount, vCount))), 0);
    size_t k = 0;
    if (layout == LAYOUT_FAN) {
        for (int i = 0; i < uCount; i++) {          // vertex 0 is the centre
            out[k++] = 0;
            out[k++] = 1 + i;
            out[k++] = 1 + ((i + 1) % uCount);
        }
        return;
    }
    if (vCount < 2 || uCount < 2) return;
    bool wrap = wrapsU(layout);
    int columns = wrap ? uCount : uCount - 1;
    for (int j = 0; j < vCount - 1; j++) {
        for (int i = 0; i < columns; i++) {
            int i1 = wrap ? (i + 1) % uCount : i + 1;
            int topLeft = j * uCount + i;
            int topRight = j * uCount + i1;
            int bottomLeft = (j + 1) * uCount + i;
            int bottomRight = (j + 1) * uCount + i1;
            out[k++] = topLeft;   out[k++] = bottomLeft;  out[k++] = topRight;
            out[k++] = topRight;  out[k++] = bottomLeft;  out[k++] = bottomRight;
        }
    }
}

// Every default lives in the unit square or unit circle at the origin; the canvas matrix is
// what places and sizes it. This is what makes `layout: polar` useful without the author
// spending scarce expression tokens on trigonometry.
inline void defaultPosition(int layout, float u, float v, float* out) {
    switch (layout) {
        case LAYOUT_POLAR:
        case LAYOUT_FAN: {
            float angle = u * TWO_PI;
            out[0] = v * std::cos(angle);
            out[1] = v * std::sin(angle);
            break;
        }
        case LAYOUT_RING: {
            float angle = u * TWO_PI;
            float radius = DEFAULT_RING_INNER_RADIUS + (1.0f - DEFAULT_RING_INNER_RADIUS) * v;
            out[0] = radius * std::cos(angle);
            out[1] = radius * std::sin(angle);
            break;
        }
        default:
            out[0] = u;
            out[1] = v;
            break;
    }
}

inline int roundCapSegments(int segments) {
    int cap = segments / 4;
    if (cap < MIN_ROUND_CAP_SEGMENTS) return MIN_ROUND_CAP_SEGMENTS;
    return std::min(cap, MAX_ROUND_CAP_SEGMENTS);
}

inline uint16_t floatToHalf(float value) {
    // Mirrors Mesh2DGenerator.floatToHalf, including its round-half-UP on the guard bit.
    uint32_t bits;
    std::memcpy(&bits, &value, 4);
    uint32_t sign = (bits >> 16) & 0x8000u;
    int exponent = static_cast<int>((bits >> 23) & 0xFFu);
    uint32_t mantissa = bits & 0x7FFFFFu;
    if (exponent == 0xFF) return static_cast<uint16_t>(sign | 0x7C00u | (mantissa ? 0x200u : 0u));
    int unbiased = exponent - 127 + 15;
    if (unbiased >= 0x1F) return static_cast<uint16_t>(sign | 0x7C00u);
    if (unbiased <= 0) {
        if (unbiased < -10) return static_cast<uint16_t>(sign);
        mantissa |= 0x800000u;
        int shift = 14 - unbiased;
        uint32_t half = mantissa >> shift;
        if ((mantissa >> (shift - 1)) & 0x1u) half++;
        return static_cast<uint16_t>(sign | half);
    }
    uint32_t half = (static_cast<uint32_t>(unbiased) << 10) | (mantissa >> 13);
    if (mantissa & 0x1000u) half++;
    return static_cast<uint16_t>(sign | half);
}

inline float halfToFloat(uint16_t half) {
    uint32_t sign = static_cast<uint32_t>(half & 0x8000) << 16;
    int exponent = (half >> 10) & 0x1F;
    uint32_t mantissa = half & 0x3FF;
    uint32_t bits;
    if (exponent == 0) {
        if (mantissa == 0) {
            bits = sign;
        } else {
            // subnormal: normalise it into a float32 exponent
            int shift = 0;
            while ((mantissa & 0x400) == 0) { mantissa <<= 1; shift++; }
            mantissa &= 0x3FF;
            bits = sign | (static_cast<uint32_t>(127 - 15 - shift) << 23) | (mantissa << 13);
        }
    } else if (exponent == 0x1F) {
        bits = sign | 0x7F800000u | (mantissa << 13);
    } else {
        bits = sign | (static_cast<uint32_t>(exponent - 15 + 127) << 23) | (mantissa << 13);
    }
    float out;
    std::memcpy(&out, &bits, 4);
    return out;
}

// ── path flattening and sampling (LAYOUT_PATH_STRIP) ────────────────────────────────────
//
// Path data is the same NaN-tagged verb stream drawPath consumes: verbs 10..16, every verb
// but MOVE and CLOSE carrying two padding floats. Curves are flattened to line segments
// before measuring, which is what the rasterisers do anyway.

// Nan-tagged path verb ids, as PathData writes them.
static constexpr int PATH_MOVE = 10, PATH_LINE = 11, PATH_QUAD = 12, PATH_CONIC = 13;
static constexpr int PATH_CUBIC = 14, PATH_CLOSE = 15, PATH_DONE = 16;
static constexpr int PATH_CURVE_STEPS = 16;

inline int pathNanId(float v) {
    int32_t bits;
    std::memcpy(&bits, &v, sizeof(bits));
    return bits & 0x3FFFFF;
}

inline bool isPathCommand(float v) {
    if (!std::isnan(v)) return false;
    int id = pathNanId(v);
    return id >= PATH_MOVE && id <= PATH_DONE;
}

/** Flatten a stored path into a polyline; returns the number of x,y pairs written.
 *
 * The layout is the one PathData writes and buildPathFromFloats reads: a NaN-tagged verb,
 * then for every verb EXCEPT move and close two padding floats, then the coordinates. The
 * padding is easy to get wrong — skipping it only for `line` still produces a plausible
 * polyline for a straight path and silently garbage for a curved one, because the first
 * control point is then read out of the padding.
 *
 * `resolve` widens a coordinate that is itself a NaN variable id, so an animated path can be
 * ridden as well as a literal one.
 */
template <typename Resolve>
inline int flattenPath(const std::vector<float>& data, std::vector<float>& out,
                       Resolve resolve) {
    out.clear();
    float startX = 0, startY = 0, curX = 0, curY = 0;
    bool open = false;
    auto push = [&](float x, float y) {
        if (out.size() >= 2 && out[out.size() - 2] == x && out[out.size() - 1] == y) return;
        out.push_back(x);
        out.push_back(y);
    };

    int i = 0;
    const int n = static_cast<int>(data.size());
    while (i < n) {
        if (!isPathCommand(data[i])) { i++; continue; }
        switch (pathNanId(data[i])) {
            case PATH_MOVE:
                i++;
                if (i + 1 < n) {
                    curX = startX = resolve(data[i]);
                    curY = startY = resolve(data[i + 1]);
                    push(curX, curY);
                    open = true;
                    i += 2;
                }
                break;
            case PATH_LINE:
                i += 3;                              // verb + 2 padding
                if (i + 1 < n) {
                    curX = resolve(data[i]);
                    curY = resolve(data[i + 1]);
                    push(curX, curY);
                    i += 2;
                }
                break;
            case PATH_QUAD:
                i += 3;
                if (i + 3 < n) {
                    float cx = resolve(data[i]), cy = resolve(data[i + 1]);
                    float x = resolve(data[i + 2]), y = resolve(data[i + 3]);
                    for (int sIdx = 1; sIdx <= PATH_CURVE_STEPS; sIdx++) {
                        float t = static_cast<float>(sIdx) / PATH_CURVE_STEPS, mt = 1 - t;
                        push(mt * mt * curX + 2 * mt * t * cx + t * t * x,
                             mt * mt * curY + 2 * mt * t * cy + t * t * y);
                    }
                    curX = x; curY = y;
                    i += 4;
                }
                break;
            case PATH_CONIC:
                i += 3;
                if (i + 4 < n) {
                    float cx = resolve(data[i]), cy = resolve(data[i + 1]);
                    float x = resolve(data[i + 2]), y = resolve(data[i + 3]);
                    float w = resolve(data[i + 4]);
                    // Rational quadratic. w == 1 degenerates to the plain quad above.
                    for (int sIdx = 1; sIdx <= PATH_CURVE_STEPS; sIdx++) {
                        float t = static_cast<float>(sIdx) / PATH_CURVE_STEPS, mt = 1 - t;
                        float w0 = mt * mt, w1 = 2 * mt * t * w, w2 = t * t;
                        float denom = w0 + w1 + w2;
                        if (denom == 0.0f) continue;
                        push((w0 * curX + w1 * cx + w2 * x) / denom,
                             (w0 * curY + w1 * cy + w2 * y) / denom);
                    }
                    curX = x; curY = y;
                    i += 5;
                }
                break;
            case PATH_CUBIC:
                i += 3;
                if (i + 5 < n) {
                    float c1x = resolve(data[i]), c1y = resolve(data[i + 1]);
                    float c2x = resolve(data[i + 2]), c2y = resolve(data[i + 3]);
                    float x = resolve(data[i + 4]), y = resolve(data[i + 5]);
                    for (int sIdx = 1; sIdx <= PATH_CURVE_STEPS; sIdx++) {
                        float t = static_cast<float>(sIdx) / PATH_CURVE_STEPS, mt = 1 - t;
                        float a = mt * mt * mt, b = 3 * mt * mt * t;
                        float c = 3 * mt * t * t, d = t * t * t;
                        push(a * curX + b * c1x + c * c2x + d * x,
                             a * curY + b * c1y + c * c2y + d * y);
                    }
                    curX = x; curY = y;
                    i += 6;
                }
                break;
            case PATH_CLOSE:
                i++;
                if (open) push(startX, startY);
                curX = startX; curY = startY;
                break;
            case PATH_DONE:
            default:
                return static_cast<int>(out.size() / 2);
        }
    }
    return static_cast<int>(out.size() / 2);
}

// Sample a flattened path at a fraction of its arclength; out receives x, y, tangentX, tangentY.
inline void samplePolyline(const std::vector<float>& poly, int pointCount, float fraction,
                           float* out) {
    out[0] = out[1] = 0.0f;
    out[2] = 1.0f;
    out[3] = 0.0f;
    if (pointCount < 2) {
        if (pointCount == 1) { out[0] = poly[0]; out[1] = poly[1]; }
        return;
    }
    float total = 0.0f;
    for (int i = 0; i + 1 < pointCount; i++) {
        float dx = poly[(i + 1) * 2] - poly[i * 2];
        float dy = poly[(i + 1) * 2 + 1] - poly[i * 2 + 1];
        total += std::sqrt(dx * dx + dy * dy);
    }
    if (total <= 0.0f) { out[0] = poly[0]; out[1] = poly[1]; return; }

    float target = std::min(std::max(fraction, 0.0f), 1.0f) * total;
    float walked = 0.0f;
    for (int i = 0; i + 1 < pointCount; i++) {
        float x0 = poly[i * 2], y0 = poly[i * 2 + 1];
        float x1 = poly[(i + 1) * 2], y1 = poly[(i + 1) * 2 + 1];
        float dx = x1 - x0, dy = y1 - y0;
        float len = std::sqrt(dx * dx + dy * dy);
        if (len <= 0.0f) continue;
        if (walked + len >= target || i + 2 == pointCount) {
            float t = (target - walked) / len;
            t = std::min(std::max(t, 0.0f), 1.0f);
            out[0] = x0 + dx * t;
            out[1] = y0 + dy * t;
            out[2] = dx / len;
            out[3] = dy / len;
            return;
        }
        walked += len;
    }
}

// A point on a round end cap. `direction` is -1 at the start of the strip and +1 at the end;
// `t` runs 0..1 from the tip to the join, and v selects the side.
inline void roundCapPoint(const float* sample, float halfWidth, float t, float v,
                          float direction, float* out) {
    float tx = sample[2] * direction, ty = sample[3] * direction;
    float nx = -sample[3], ny = sample[2];
    float angle = (1.0f - t) * HALF_PI;
    float along = std::sin(angle) * halfWidth;
    float across = std::cos(angle) * halfWidth;
    float side = (v - 0.5f) * 2.0f;
    out[0] = sample[0] + tx * along + nx * across * side;
    out[1] = sample[1] + ty * along + ny * across * side;
}

// ── monotonic spline through the width control points ───────────────────────────────────
//
// A plain Catmull-Rom would overshoot and make the ribbon bulge past the widths the author
// gave; the Fritsch-Carlson limiter keeps the fit monotone between samples.
class MonotonicSpline {
  public:
    void fit(const std::vector<float>& xs, const std::vector<float>& ys) {
        mX = xs;
        mY = ys;
        size_t n = mX.size();
        mM.assign(n, 0.0f);
        if (n < 2) return;
        std::vector<float> d(n - 1);
        for (size_t i = 0; i + 1 < n; i++) {
            float dx = mX[i + 1] - mX[i];
            d[i] = dx != 0.0f ? (mY[i + 1] - mY[i]) / dx : 0.0f;
        }
        mM[0] = d[0];
        mM[n - 1] = d[n - 2];
        for (size_t i = 1; i + 1 < n; i++) {
            mM[i] = (d[i - 1] * d[i] <= 0.0f) ? 0.0f : (d[i - 1] + d[i]) * 0.5f;
        }
        for (size_t i = 0; i + 1 < n; i++) {
            if (d[i] == 0.0f) { mM[i] = mM[i + 1] = 0.0f; continue; }
            float a = mM[i] / d[i], b = mM[i + 1] / d[i];
            float s = a * a + b * b;
            if (s > 9.0f) {
                float t = 3.0f / std::sqrt(s);
                mM[i] = t * a * d[i];
                mM[i + 1] = t * b * d[i];
            }
        }
    }

    float at(float x) const {
        size_t n = mX.size();
        if (n == 0) return 0.0f;
        if (n == 1 || x <= mX[0]) return mY[0];
        if (x >= mX[n - 1]) return mY[n - 1];
        size_t i = 0;
        while (i + 2 < n && x > mX[i + 1]) i++;
        float h = mX[i + 1] - mX[i];
        if (h <= 0.0f) return mY[i];
        float t = (x - mX[i]) / h;
        float t2 = t * t, t3 = t2 * t;
        return (2 * t3 - 3 * t2 + 1) * mY[i] + (t3 - 2 * t2 + t) * h * mM[i]
             + (-2 * t3 + 3 * t2) * mY[i + 1] + (t3 - t2) * h * mM[i + 1];
    }

    bool empty() const { return mX.empty(); }

  private:
    std::vector<float> mX, mY, mM;
};

// ── the frame of a mesh at (u, v), and the matrix built from it ─────────────────────────

static constexpr float DEGENERATE_EPSILON = 1e-6f;

inline float bilinear(const float* verts, int uCount, int i0, int j0, int i1, int j1,
                      float tu, float tv, int component) {
    float v00 = verts[(j0 * uCount + i0) * 2 + component];
    float v10 = verts[(j0 * uCount + i1) * 2 + component];
    float v01 = verts[(j1 * uCount + i0) * 2 + component];
    float v11 = verts[(j1 * uCount + i1) * 2 + component];
    float top = v00 + (v10 - v00) * tu;
    float bottom = v01 + (v11 - v01) * tu;
    return top + (bottom - top) * tv;
}

/** The position the mesh surface takes at (u, v), interpolated between its vertices. */
inline void sampleMeshPosition(int layout, int uCount, int vCount, const float* verts,
                               int vertexCount, float u, float v, float* out) {
    if (vertexCount == 0) { out[0] = out[1] = 0.0f; return; }

    if (layout == LAYOUT_FAN && uCount >= 1 && vertexCount == uCount + 1) {
        float uNorm = std::fmod(std::fmod(u, 1.0f) + 1.0f, 1.0f);
        float fu = uNorm * uCount;
        int i0 = static_cast<int>(std::floor(fu)) % uCount;
        int i1 = (i0 + 1) % uCount;
        float tu = fu - std::floor(fu);
        float rimX = (1 - tu) * verts[(1 + i0) * 2] + tu * verts[(1 + i1) * 2];
        float rimY = (1 - tu) * verts[(1 + i0) * 2 + 1] + tu * verts[(1 + i1) * 2 + 1];
        float vc = std::min(std::max(v, 0.0f), 1.0f);
        out[0] = (1 - vc) * verts[0] + vc * rimX;
        out[1] = (1 - vc) * verts[1] + vc * rimY;
        return;
    }

    if (uCount >= 2 && vCount >= 2 && uCount * vCount == vertexCount) {
        int i0, i1;
        float tu;
        if (wrapsU(layout)) {
            float uNorm = std::fmod(std::fmod(u, 1.0f) + 1.0f, 1.0f);
            float fu = uNorm * uCount;
            i0 = static_cast<int>(std::floor(fu)) % uCount;
            i1 = (i0 + 1) % uCount;
            tu = fu - std::floor(fu);
        } else {
            float fu = std::min(std::max(u, 0.0f), 1.0f) * (uCount - 1);
            i0 = static_cast<int>(std::floor(fu));
            i1 = std::min(uCount - 1, i0 + 1);
            tu = fu - i0;
        }
        float fv = std::min(std::max(v, 0.0f), 1.0f) * (vCount - 1);
        int j0 = static_cast<int>(std::floor(fv));
        int j1 = std::min(vCount - 1, j0 + 1);
        float tv = fv - j0;
        out[0] = bilinear(verts, uCount, i0, j0, i1, j1, tu, tv, 0);
        out[1] = bilinear(verts, uCount, i0, j0, i1, j1, tu, tv, 1);
        return;
    }

    int nearest = static_cast<int>(std::lround(std::min(std::max(u, 0.0f), 1.0f)
                                               * (vertexCount - 1)));
    nearest = std::max(0, std::min(vertexCount - 1, nearest));
    out[0] = verts[nearest * 2];
    out[1] = verts[nearest * 2 + 1];
}

/** The local frame of the surface at (u, v): duX, duY, dvX, dvY, originX, originY.
 *
 * The derivatives are central differences over half a cell, which is what makes the frame
 * meaningful for a coarse mesh; a wrapping layout samples across the seam rather than
 * clamping, so the frame stays continuous all the way round.
 */
inline bool sampleFrame(int layout, int uCount, int vCount, const float* verts,
                        int vertexCount, float u, float v, float* out) {
    if (vertexCount <= 0) return false;
    int uc = std::max(2, uCount);
    int vc = std::max(2, vCount);
    bool wrap = wrapsU(layout);
    float du = 1.0f / (wrap ? uc : (uc - 1));
    float dv = 1.0f / (vc - 1);

    float centre[2], uPlus[2], uMinus[2], vPlus[2], vMinus[2];
    sampleMeshPosition(layout, uCount, vCount, verts, vertexCount, u, v, centre);

    float uSpan;
    if (wrap) {
        sampleMeshPosition(layout, uCount, vCount, verts, vertexCount, u + du * 0.5f, v, uPlus);
        sampleMeshPosition(layout, uCount, vCount, verts, vertexCount, u - du * 0.5f, v, uMinus);
        uSpan = du;
    } else {
        float uHi = std::min(1.0f, u + du * 0.5f);
        float uLo = std::max(0.0f, u - du * 0.5f);
        sampleMeshPosition(layout, uCount, vCount, verts, vertexCount, uHi, v, uPlus);
        sampleMeshPosition(layout, uCount, vCount, verts, vertexCount, uLo, v, uMinus);
        uSpan = uHi - uLo;
        if (uSpan <= 0.0f) uSpan = du;
    }
    float vHi = std::min(1.0f, v + dv * 0.5f);
    float vLo = std::max(0.0f, v - dv * 0.5f);
    sampleMeshPosition(layout, uCount, vCount, verts, vertexCount, u, vHi, vPlus);
    sampleMeshPosition(layout, uCount, vCount, verts, vertexCount, u, vLo, vMinus);
    float vSpan = vHi - vLo;
    if (vSpan <= 0.0f) vSpan = dv;

    out[0] = (uPlus[0] - uMinus[0]) / uSpan;
    out[1] = (uPlus[1] - uMinus[1]) / uSpan;
    out[2] = (vPlus[0] - vMinus[0]) / vSpan;
    out[3] = (vPlus[1] - vMinus[1]) / vSpan;
    out[4] = centre[0];
    out[5] = centre[1];
    return true;
}

/** Turn a sampled frame into a 2x3 affine: duX, duY, dvX, dvY, originX, originY.
 *
 * Degrades rather than producing a singular matrix: a flattened patch loses its scale, a
 * collapsed one loses its rotation too. Without this a mesh whose cell has folded would
 * concat a non-invertible matrix and take every later draw with it.
 */
inline void buildMatrix(const float* frame, int flags, float* out) {
    float duX = frame[0], duY = frame[1], dvX = frame[2], dvY = frame[3];
    float originX = frame[4], originY = frame[5];

    float duLength = std::hypot(duX, duY);
    float dvLength = std::hypot(dvX, dvY);
    float cross = duX * dvY - duY * dvX;

    int effective = flags;
    if (effective >= FLAG_FULL && std::fabs(cross) < DEGENERATE_EPSILON) effective = FLAG_SCALE;
    if (effective >= FLAG_SCALE
        && (duLength < DEGENERATE_EPSILON || dvLength < DEGENERATE_EPSILON)) {
        effective = FLAG_ROTATION;
    }
    if (effective >= FLAG_ROTATION && duLength < DEGENERATE_EPSILON) effective = FLAG_ORIGIN;

    switch (effective) {
        case FLAG_FULL:
            out[0] = duX; out[1] = duY; out[2] = dvX; out[3] = dvY;
            break;
        case FLAG_SCALE: {
            float ux = duX / duLength, uy = duY / duLength;
            float sign = cross < 0 ? -1.0f : 1.0f;
            out[0] = ux * duLength; out[1] = uy * duLength;
            out[2] = -uy * dvLength * sign; out[3] = ux * dvLength * sign;
            break;
        }
        case FLAG_ROTATION: {
            float ux = duX / duLength, uy = duY / duLength;
            float sign = cross < 0 ? -1.0f : 1.0f;
            out[0] = ux; out[1] = uy; out[2] = -uy * sign; out[3] = ux * sign;
            break;
        }
        case FLAG_ORIGIN:
        default:
            out[0] = 1.0f; out[1] = 0.0f; out[2] = 0.0f; out[3] = 1.0f;
            break;
    }
    out[4] = originX;
    out[5] = originY;
}

}  // namespace mesh2d

/** Lets a mesh expression reach `arrayGet` and the other float-list operators.
 *
 * AdvancedOperations.h declares the same three-line adapter twice, privately, so neither is
 * reachable from here; this is the third. Worth consolidating into CollectionsAccess itself,
 * but not as a side effect of adding meshes.
 */
struct MeshCollectionsLocal : public CollectionsAccess {
    const RemoteContext& ctx;
    explicit MeshCollectionsLocal(const RemoteContext& c) : ctx(c) {}
    const std::vector<float>* getFloats(int id) const override { return ctx.getFloatList(id); }
};

// ─────────────────────────────────────────────────────────────────────────────────────────

class AddMesh2D : public Operation {
  public:
    static constexpr int OP_CODE = 104;

    int meshId = 0, type = 0, layout = 0, uCount = 0, vCount = 0, flags = 0, aux = 0;
    std::vector<float> expressions[mesh2d::EXPRESSION_GROUPS];
    std::vector<int32_t> srcIndices;
    std::vector<float> srcVerts, srcUv;
    std::vector<int32_t> srcColors;
    std::vector<float> widths, widthPositions;

    // expanded geometry, in the layout drawVertices wants
    std::vector<float> verts, uv;
    std::vector<int32_t> colors, indices;

    std::string name() const override { return "ADD_MESH_2D"; }
    int opcode() const override { return OP_CODE; }
    bool isVariableSupport() const override { return true; }

    std::vector<Field> fields() const override {
        return {
            {"meshId", "INT", std::to_string(meshId)},
            {"type", "INT", std::to_string(type)},
            {"layout", "INT", std::to_string(layout)},
            {"uCount", "INT", std::to_string(uCount)},
            {"vCount", "INT", std::to_string(vCount)},
            {"flags", "INT", std::to_string(flags)},
            {"aux", "INT", std::to_string(aux)},
        };
    }

    static void read(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<AddMesh2D>();
        op->meshId = buffer.readInt();
        op->type = buffer.readInt();
        op->layout = buffer.readInt();
        op->uCount = buffer.readInt();
        op->vCount = buffer.readInt();
        op->flags = buffer.readInt();
        op->aux = buffer.readInt();

        if (op->type == mesh2d::TYPE_EXPRESSION) {
            // Nine groups unconditionally: an absent channel is a zero length, not a missing
            // field, so reading fewer would desynchronise the rest of the buffer.
            for (int g = 0; g < mesh2d::EXPRESSION_GROUPS; g++) {
                int len = buffer.readInt();
                op->expressions[g].resize(static_cast<size_t>(std::max(0, len)));
                for (int i = 0; i < len; i++) op->expressions[g][i] = buffer.readFloat();
            }
            ops.push_back(std::move(op));
            return;
        }

        if (op->type == mesh2d::TYPE_PATH_SPLINE_STRIP
            || op->type == mesh2d::TYPE_SPLINE_ROUND_STRIP) {
            int wn = buffer.readInt();
            op->widths.resize(static_cast<size_t>(std::max(0, wn)));
            for (int i = 0; i < wn; i++) op->widths[i] = buffer.readFloat();
            int pn = buffer.readInt();
            op->widthPositions.resize(static_cast<size_t>(std::max(0, pn)));
            for (int i = 0; i < pn; i++) op->widthPositions[i] = buffer.readFloat();
            ops.push_back(std::move(op));
            return;
        }

        int indexCount = buffer.readInt();
        op->srcIndices.resize(static_cast<size_t>(std::max(0, indexCount)));
        for (int i = 0; i < indexCount; i++) {
            op->srcIndices[i] = static_cast<int32_t>(buffer.readShort() & 0xFFFF);
        }
        int vertCount = buffer.readInt();
        int uvCount = buffer.readInt();
        int colorCount = buffer.readInt();
        op->srcVerts.resize(static_cast<size_t>(std::max(0, vertCount)));
        op->srcUv.resize(static_cast<size_t>(std::max(0, uvCount)));
        op->srcColors.resize(static_cast<size_t>(std::max(0, colorCount)));
        if (op->type == mesh2d::TYPE_F16_VALUES) {
            for (int i = 0; i < vertCount; i++) {
                op->srcVerts[i] = mesh2d::halfToFloat(static_cast<uint16_t>(buffer.readShort()));
            }
            for (int i = 0; i < uvCount; i++) {
                op->srcUv[i] = mesh2d::halfToFloat(static_cast<uint16_t>(buffer.readShort()));
            }
        } else {
            for (int i = 0; i < vertCount; i++) op->srcVerts[i] = buffer.readFloat();
            for (int i = 0; i < uvCount; i++) op->srcUv[i] = buffer.readFloat();
        }
        for (int i = 0; i < colorCount; i++) op->srcColors[i] = buffer.readInt();
        ops.push_back(std::move(op));
    }

    void updateVariables(RemoteContext& context) override {
        // Resolve any NaN-encoded ids in the literal payloads, then rebuild. Done every frame
        // rather than on change because a width or a vertex may be driven by an expression.
        resolved(context);
        mDirty = true;
    }

    void apply(RemoteContext& context) override {
        // PAINT only, as every draw op in this tree is. Without the guard the op also runs
        // during the measure/layout pass; for MATRIX_FROM_MESH_2D that concats a matrix into
        // the canvas before painting begins and corrupts the whole document — it renders as a
        // blank white surface, which looks nothing like a matrix bug.
        if (context.getMode() != ContextMode::PAINT) return;
        if (mDirty) { expand(context); mDirty = false; }
        PaintContext* pc = context.getPaintContext();
        if (pc) pc->setMesh(meshId, layout, uCount, vCount, verts, uv, colors, indices);
    }

    void expand(RemoteContext& context) {
        if (type == mesh2d::TYPE_EXPRESSION || isSplineStrip()) {
            expandParametric(context);
        } else {
            expandLiteral(context);
        }
    }

  private:
    bool mDirty = true;
    ExpressionEvaluator mEval;
    std::vector<float> mPolyline;
    mesh2d::MonotonicSpline mWidthSpline;

    bool isSplineStrip() const {
        return type == mesh2d::TYPE_PATH_SPLINE_STRIP
            || type == mesh2d::TYPE_SPLINE_ROUND_STRIP;
    }

    // A literal float may itself be a NaN variable id; resolve through the context.
    float val(RemoteContext& context, float f) const {
        return std::isnan(f) ? context.getFloat(ExpressionEvaluator::fromNaN(f)) : f;
    }

    void resolved(RemoteContext&) {}

    void expandLiteral(RemoteContext& context) {
        size_t n = srcVerts.size();
        verts.resize(n);
        for (size_t i = 0; i < n; i++) verts[i] = val(context, srcVerts[i]);
        size_t vertexCount = n / 2;
        uv = (srcUv.size() == vertexCount * 2) ? srcUv : std::vector<float>();
        colors = (srcColors.size() == vertexCount) ? srcColors : std::vector<int32_t>();
        indices = srcIndices;
    }

    int roundCapColumns() const {
        if (type != mesh2d::TYPE_SPLINE_ROUND_STRIP) return 0;
        int cap = flags;
        if (cap <= 0) return 0;
        // flags arrives from the wire; leave at least one body column.
        int maxCap = (uCount - 2) / 2;
        return std::max(0, std::min(cap, maxCap));
    }

    float evaluate(RemoteContext& context, int group, float u, float v, float fallback) {
        const std::vector<float>& e = expressions[group];
        if (e.empty()) return fallback;
        // A single non-NaN element is a literal constant, not a program — the common case
        // for a channel the author gave as a plain number. Skipping the evaluator here is
        // what the reference does too, so the two agree bit for bit on those channels.
        if (e.size() == 1 && !std::isnan(e[0])) return e[0];
        mEval.setVar1(u);
        mEval.setVar2(v);
        MeshCollectionsLocal ca(context);
        return mEval.eval(context, &ca, e.data(), static_cast<int>(e.size()));
    }

    static int clamp255(float f) {
        int i = static_cast<int>(f * 255.0f + 0.5f);
        return i < 0 ? 0 : (i > 255 ? 255 : i);
    }

    static int32_t packColor(float a, float r, float g, float b) {
        return static_cast<int32_t>((static_cast<uint32_t>(clamp255(a)) << 24)
                                  | (static_cast<uint32_t>(clamp255(r)) << 16)
                                  | (static_cast<uint32_t>(clamp255(g)) << 8)
                                  | static_cast<uint32_t>(clamp255(b)));
    }

    float strokeWidthAt(RemoteContext& context, float fraction, float v) {
        if (isSplineStrip()) {
            if (mWidthSpline.empty()) return 1.0f;
            return mWidthSpline.at(fraction);
        }
        return evaluate(context, mesh2d::EXP_WIDTH, fraction, v, 1.0f);
    }

    void buildWidthSpline(RemoteContext& context) {
        if (widths.empty()) return;
        std::vector<float> xs, ys;
        size_t n = widths.size();
        for (size_t i = 0; i < n; i++) {
            float pos = (widthPositions.size() == n)
                            ? val(context, widthPositions[i])
                            : (n == 1 ? 0.0f : static_cast<float>(i) / static_cast<float>(n - 1));
            xs.push_back(pos);
            ys.push_back(val(context, widths[i]));
        }
        mWidthSpline.fit(xs, ys);
    }

    void positionOnPath(RemoteContext& context, float u, float v, int points, float* out) {
        float sample[4];
        float fraction = u;
        int capColumns = roundCapColumns();
        if (capColumns > 0 && uCount > 1) {
            float capSpan = static_cast<float>(capColumns) / static_cast<float>(uCount - 1);
            if (u <= capSpan) {
                mesh2d::samplePolyline(mPolyline, points, 0.0f, sample);
                float hw = strokeWidthAt(context, 0.0f, v) * 0.5f;
                mesh2d::roundCapPoint(sample, hw, capSpan > 0 ? u / capSpan : 0.0f, v, -1.0f, out);
                return;
            }
            if (u >= 1.0f - capSpan) {
                mesh2d::samplePolyline(mPolyline, points, 1.0f, sample);
                float hw = strokeWidthAt(context, 1.0f, v) * 0.5f;
                mesh2d::roundCapPoint(sample, hw, capSpan > 0 ? (1.0f - u) / capSpan : 0.0f,
                                      v, 1.0f, out);
                return;
            }
            fraction = (u - capSpan) / (1.0f - 2.0f * capSpan);
        }
        mesh2d::samplePolyline(mPolyline, points, fraction, sample);
        float halfWidth = strokeWidthAt(context, fraction, v) * 0.5f;
        float offset = (v - 0.5f) * 2.0f * halfWidth;
        float nx = -sample[3], ny = sample[2];       // the tangent turned a quarter turn
        out[0] = sample[0] + nx * offset;
        out[1] = sample[1] + ny * offset;
    }

    void expandParametric(RemoteContext& context) {
        int uc = std::max(1, uCount);
        int vc = std::max(1, vCount);
        int vCountTotal = mesh2d::vertexCount(layout, uc, vc);
        if (vCountTotal <= 0 || vCountTotal > mesh2d::MAX_MESH_2D_VERTICES) return;

        verts.assign(static_cast<size_t>(vCountTotal) * 2, 0.0f);
        uv.assign(static_cast<size_t>(vCountTotal) * 2, 0.0f);

        bool hasTex = !expressions[mesh2d::EXP_TEX_U].empty()
                   || !expressions[mesh2d::EXP_TEX_V].empty();
        bool hasColor = !expressions[mesh2d::EXP_COLOR_A].empty()
                     || !expressions[mesh2d::EXP_COLOR_R].empty()
                     || !expressions[mesh2d::EXP_COLOR_G].empty()
                     || !expressions[mesh2d::EXP_COLOR_B].empty();
        colors.assign(hasColor ? static_cast<size_t>(vCountTotal) : 0, 0);

        int points = 0;
        if (layout == mesh2d::LAYOUT_PATH_STRIP) {
            const std::vector<float>* pathData = context.getPathData(aux);
            if (pathData) {
                // Coordinates may themselves be NaN variable ids; a verb tag must NOT be
                // resolved, which is what the range test guards.
                points = mesh2d::flattenPath(*pathData, mPolyline, [&](float f) {
                    if (!std::isnan(f)) return f;
                    int id = mesh2d::pathNanId(f);
                    if (id >= mesh2d::PATH_MOVE && id <= mesh2d::PATH_DONE) return f;
                    return context.getFloat(id);
                });
            }
            if (isSplineStrip()) buildWidthSpline(context);
        }

        bool fan = layout == mesh2d::LAYOUT_FAN;
        float pos[2];
        for (int index = 0; index < vCountTotal; index++) {
            float u, v;
            if (fan) {
                if (index == 0) { u = 0.0f; v = 0.0f; }
                else { u = mesh2d::domainU(layout, index - 1, uc); v = 1.0f; }
            } else {
                u = mesh2d::domainU(layout, index % uc, uc);
                v = mesh2d::domainV(index / uc, vc);
            }

            if (layout == mesh2d::LAYOUT_PATH_STRIP && points > 0) {
                positionOnPath(context, u, v, points, pos);
            } else {
                mesh2d::defaultPosition(layout, u, v, pos);
            }

            verts[index * 2] = evaluate(context, mesh2d::EXP_X, u, v, pos[0]);
            verts[index * 2 + 1] = evaluate(context, mesh2d::EXP_Y, u, v, pos[1]);

            if (hasTex) {
                uv[index * 2] = evaluate(context, mesh2d::EXP_TEX_U, u, v, u);
                uv[index * 2 + 1] = evaluate(context, mesh2d::EXP_TEX_V, u, v, v);
            } else {
                uv[index * 2] = u;
                uv[index * 2 + 1] = v;
            }

            if (hasColor) {
                colors[index] = packColor(
                    evaluate(context, mesh2d::EXP_COLOR_A, u, v, 1.0f),
                    evaluate(context, mesh2d::EXP_COLOR_R, u, v, 1.0f),
                    evaluate(context, mesh2d::EXP_COLOR_G, u, v, 1.0f),
                    evaluate(context, mesh2d::EXP_COLOR_B, u, v, 1.0f));
            }
        }
        mesh2d::generateIndices(layout, uc, vc, indices);
    }
};

class DrawMesh2D : public Operation {
  public:
    static constexpr int OP_CODE = 105;
    int meshId = 0, blend = 0, imageId = 0;

    std::string name() const override { return "DRAW_MESH_2D"; }
    int opcode() const override { return OP_CODE; }
    std::vector<Field> fields() const override {
        return {
            {"meshId", "INT", std::to_string(meshId)},
            {"blend", "INT", std::to_string(blend)},
            {"imageId", "INT", std::to_string(imageId)},
        };
    }

    static void read(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<DrawMesh2D>();
        op->meshId = buffer.readInt();
        op->blend = buffer.readInt();
        op->imageId = buffer.readInt();
        ops.push_back(std::move(op));
    }

    void apply(RemoteContext& context) override {
        if (context.getMode() != ContextMode::PAINT) return;
        PaintContext* pc = context.getPaintContext();
        if (pc) pc->drawMesh(meshId, blend, imageId);
    }
};

class MatrixFromMesh2D : public Operation {
  public:
    static constexpr int OP_CODE = 106;
    int meshId = 0, flags = 0;
    float u = 0.0f, v = 0.0f;

    std::string name() const override { return "MATRIX_FROM_MESH_2D"; }
    int opcode() const override { return OP_CODE; }
    bool isVariableSupport() const override { return true; }
    std::vector<Field> fields() const override {
        return {
            {"meshId", "INT", std::to_string(meshId)},
            {"u", "FLOAT", formatFloat(u)},
            {"v", "FLOAT", formatFloat(v)},
            {"flags", "INT", std::to_string(flags)},
        };
    }

    static void read(WireBuffer& buffer, std::vector<std::unique_ptr<Operation>>& ops) {
        auto op = std::make_unique<MatrixFromMesh2D>();
        op->meshId = buffer.readInt();
        op->u = buffer.readFloat();
        op->v = buffer.readFloat();
        op->flags = buffer.readInt();
        ops.push_back(std::move(op));
    }

    void updateVariables(RemoteContext& context) override {
        mU = std::isnan(u) ? context.getFloat(ExpressionEvaluator::fromNaN(u)) : u;
        mV = std::isnan(v) ? context.getFloat(ExpressionEvaluator::fromNaN(v)) : v;
    }

    void apply(RemoteContext& context) override {
        if (context.getMode() != ContextMode::PAINT) return;
        PaintContext* pc = context.getPaintContext();
        if (pc) pc->matrixFromMesh(meshId, std::isnan(u) ? mU : u, std::isnan(v) ? mV : v, flags);
    }

  private:
    float mU = 0.0f, mV = 0.0f;
};

}  // namespace rccore
