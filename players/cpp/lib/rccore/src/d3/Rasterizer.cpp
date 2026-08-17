#include "rccore/d3/Rasterizer.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace rccore::d3 {
namespace {

inline int min3(int x1, int x2, int x3) {
    return (x1 > x2) ? ((x2 > x3) ? x3 : x2) : ((x1 > x3) ? x3 : x1);
}
inline int max3(int x1, int x2, int x3) {
    return (x1 < x2) ? ((x2 < x3) ? x3 : x2) : ((x1 < x3) ? x3 : x1);
}

/**
 * Shared setup: winding fix, plane equation, fixed-point bounds and edge constants. Returned as
 * a record so the five entry points behave identically without repeating the index algebra.
 */
struct Setup {
    bool ok;
    float dx, dy, zoff;
    int minx, maxx, miny, maxy;
    int fdx12, fdx23, fdx31;
    int fdy12, fdy23, fdy31;
    int cy1, cy2, cy3;
    bool swapped;
};

Setup setup(int w, int h,
            float fx3, float fy3, float fz3,
            float fx2, float fy2, float fz2,
            float fx1, float fy1, float fz1) {
    Setup s{};
    s.swapped = false;
    if (((fx1 - fx2) * (fy3 - fy2) - (fy1 - fy2) * (fx3 - fx2)) < 0) {
        std::swap(fx1, fx2);
        std::swap(fy1, fy2);
        std::swap(fz1, fz2);
        s.swapped = true;
    }
    // Declared double, initialised from an all-float expression: evaluated in float, widened on
    // assignment. Matching the declaration matches the reference's arithmetic.
    double d = (fx1 * (fy3 - fy2) - fx2 * fy3 + fx3 * fy2 + (fx2 - fx3) * fy1);
    if (d == 0) { s.ok = false; return s; }

    s.dx = (float) (-(fy1 * (fz3 - fz2) - fy2 * fz3 + fy3 * fz2 + (fy2 - fy3) * fz1) / d);
    s.dy = (float) ((fx1 * (fz3 - fz2) - fx2 * fz3 + fx3 * fz2 + (fx2 - fx3) * fz1) / d);
    s.zoff = (float) ((fx1 * (fy3 * fz2 - fy2 * fz3)
                     + fy1 * (fx2 * fz3 - fx3 * fz2)
                     + (fx3 * fy2 - fx2 * fy3) * fz1) / d);

    int y1 = (int) (16.0f * fy1 + .5f);
    int y2 = (int) (16.0f * fy2 + .5f);
    int y3 = (int) (16.0f * fy3 + .5f);
    int x1 = (int) (16.0f * fx1 + .5f);
    int x2 = (int) (16.0f * fx2 + .5f);
    int x3 = (int) (16.0f * fx3 + .5f);

    int dx12 = x1 - x2, dx23 = x2 - x3, dx31 = x3 - x1;
    int dy12 = y1 - y2, dy23 = y2 - y3, dy31 = y3 - y1;

    s.fdx12 = dx12 << 4; s.fdx23 = dx23 << 4; s.fdx31 = dx31 << 4;
    s.fdy12 = dy12 << 4; s.fdy23 = dy23 << 4; s.fdy31 = dy31 << 4;

    int minx = (min3(x1, x2, x3) + 0xF) >> 4;
    int maxx = (max3(x1, x2, x3) + 0xF) >> 4;
    int miny = (min3(y1, y2, y3) + 0xF) >> 4;
    int maxy = (max3(y1, y2, y3) + 0xF) >> 4;
    if (miny < 0) miny = 0;
    if (minx < 0) minx = 0;
    if (maxx > w) maxx = w;
    if (maxy > h) maxy = h;
    s.minx = minx; s.maxx = maxx; s.miny = miny; s.maxy = maxy;

    int c1 = dy12 * x1 - dx12 * y1;
    int c2 = dy23 * x2 - dx23 * y2;
    int c3 = dy31 * x3 - dx31 * y3;
    // Top-left fill rule: bias shared edges so adjacent triangles neither double-cover nor gap.
    if (dy12 < 0 || (dy12 == 0 && dx12 > 0)) c1++;
    if (dy23 < 0 || (dy23 == 0 && dx23 > 0)) c2++;
    if (dy31 < 0 || (dy31 == 0 && dx31 > 0)) c3++;
    s.cy1 = c1 + dx12 * (miny << 4) - dy12 * (minx << 4);
    s.cy2 = c2 + dx23 * (miny << 4) - dy23 * (minx << 4);
    s.cy3 = c3 + dx31 * (miny << 4) - dy31 * (minx << 4);
    s.ok = true;
    return s;
}

} // namespace

void clearDepth(float* zbuf, int count) {
    std::fill(zbuf, zbuf + count, std::numeric_limits<float>::infinity());
}

void fillTriangle(float* zbuff, int32_t* img, int32_t color, int w, int h,
                  float fx3, float fy3, float fz3,
                  float fx2, float fy2, float fz2,
                  float fx1, float fy1, float fz1) {
    Setup s = setup(w, h, fx3, fy3, fz3, fx2, fy2, fz2, fx1, fy1, fz1);
    if (!s.ok) return;
    int cy1 = s.cy1, cy2 = s.cy2, cy3 = s.cy3;
    int off = s.miny * w;
    for (int y = s.miny; y < s.maxy; y++) {
        int cx1 = cy1, cx2 = cy2, cx3 = cy3;
        float p = s.zoff + s.dy * y;
        for (int x = s.minx; x < s.maxx; x++) {
            if (cx1 > 0 && cx2 > 0 && cx3 > 0) {
                int point = x + off;
                float zval = p + s.dx * x;
                if (zbuff[point] > zval) {
                    zbuff[point] = zval;
                    img[point] = color;
                }
            }
            cx1 -= s.fdy12; cx2 -= s.fdy23; cx3 -= s.fdy31;
        }
        cy1 += s.fdx12; cy2 += s.fdx23; cy3 += s.fdx31;
        off += w;
    }
}

void fillTriangleGouraud(float* zbuff, int32_t* img, int32_t c3, int32_t c2, int32_t c1,
                         int w, int h,
                         float fx3, float fy3, float fz3,
                         float fx2, float fy2, float fz2,
                         float fx1, float fy1, float fz1) {
    Setup s = setup(w, h, fx3, fy3, fz3, fx2, fy2, fz2, fx1, fy1, fz1);
    if (!s.ok) return;
    if (s.swapped) std::swap(c1, c2);

    int cy1 = s.cy1, cy2 = s.cy2, cy3 = s.cy3;
    // The edge sum is constant across the triangle and proportional to twice its area; it
    // normalizes the edge functions into barycentric weights.
    long long sum = (long long) cy1 + cy2 + cy3;
    if (sum == 0) return;
    float inv = 1.0f / sum;

    int a1 = (c1 >> 24) & 0xFF, r1 = (c1 >> 16) & 0xFF, g1 = (c1 >> 8) & 0xFF, b1 = c1 & 0xFF;
    int a2 = (c2 >> 24) & 0xFF, r2 = (c2 >> 16) & 0xFF, g2 = (c2 >> 8) & 0xFF, b2 = c2 & 0xFF;
    int a3 = (c3 >> 24) & 0xFF, r3 = (c3 >> 16) & 0xFF, g3 = (c3 >> 8) & 0xFF, b3 = c3 & 0xFF;

    int off = s.miny * w;
    for (int y = s.miny; y < s.maxy; y++) {
        int cx1 = cy1, cx2 = cy2, cx3 = cy3;
        float p = s.zoff + s.dy * y;
        for (int x = s.minx; x < s.maxx; x++) {
            if (cx1 > 0 && cx2 > 0 && cx3 > 0) {
                int point = x + off;
                float zval = p + s.dx * x;
                if (zbuff[point] > zval) {
                    zbuff[point] = zval;
                    float w1 = cx2 * inv, w2 = cx3 * inv, w3 = cx1 * inv;
                    int a = (int) (w1 * a1 + w2 * a2 + w3 * a3);
                    int r = (int) (w1 * r1 + w2 * r2 + w3 * r3);
                    int g = (int) (w1 * g1 + w2 * g2 + w3 * g3);
                    int b = (int) (w1 * b1 + w2 * b2 + w3 * b3);
                    img[point] = (a << 24) | (r << 16) | (g << 8) | b;
                }
            }
            cx1 -= s.fdy12; cx2 -= s.fdy23; cx3 -= s.fdy31;
        }
        cy1 += s.fdx12; cy2 += s.fdx23; cy3 += s.fdx31;
        off += w;
    }
}

void fillTriangleTextured(float* zbuff, int32_t* img,
                          const int32_t* tex, int texW, int texH,
                          int32_t c3, int32_t c2, int32_t c1, int w, int h,
                          float fx3, float fy3, float fz3, float u3, float v3, float iw3,
                          float fx2, float fy2, float fz2, float u2, float v2, float iw2,
                          float fx1, float fy1, float fz1, float u1, float v1, float iw1) {
    Setup s = setup(w, h, fx3, fy3, fz3, fx2, fy2, fz2, fx1, fy1, fz1);
    if (!s.ok) return;
    if (s.swapped) {
        std::swap(c1, c2); std::swap(u1, u2); std::swap(v1, v2); std::swap(iw1, iw2);
    }
    long long cy1 = s.cy1, cy2 = s.cy2, cy3 = s.cy3;
    long long sum = (long long) s.cy1 + s.cy2 + s.cy3;
    if (sum == 0) return;
    float inv = 1.0f / sum;

    int a1 = (c1 >> 24) & 0xFF, r1 = (c1 >> 16) & 0xFF, g1 = (c1 >> 8) & 0xFF, b1 = c1 & 0xFF;
    int a2 = (c2 >> 24) & 0xFF, r2 = (c2 >> 16) & 0xFF, g2 = (c2 >> 8) & 0xFF, b2 = c2 & 0xFF;
    int a3 = (c3 >> 24) & 0xFF, r3 = (c3 >> 16) & 0xFF, g3 = (c3 >> 8) & 0xFF, b3 = c3 & 0xFF;

    float uiw1 = u1 * iw1, uiw2 = u2 * iw2, uiw3 = u3 * iw3;
    float viw1 = v1 * iw1, viw2 = v2 * iw2, viw3 = v3 * iw3;

    int off = s.miny * w;
    for (int y = s.miny; y < s.maxy; y++) {
        long long cx1 = cy1, cx2 = cy2, cx3 = cy3;
        float p = s.zoff + s.dy * y;
        for (int x = s.minx; x < s.maxx; x++) {
            if (cx1 > 0 && cx2 > 0 && cx3 > 0) {
                int point = x + off;
                float zval = p + s.dx * x;
                if (zbuff[point] > zval) {
                    float w1 = cx2 * inv, w2 = cx3 * inv, w3 = cx1 * inv;
                    float invW = 1.f / (w1 * iw1 + w2 * iw2 + w3 * iw3);
                    float u = (w1 * uiw1 + w2 * uiw2 + w3 * uiw3) * invW;
                    float v = (w1 * viw1 + w2 * viw2 + w3 * viw3) * invW;
                    int tx = (int) (u * texW);
                    int ty = (int) ((1.f - v) * texH);
                    if (tx < 0) tx = 0; else if (tx >= texW) tx = texW - 1;
                    if (ty < 0) ty = 0; else if (ty >= texH) ty = texH - 1;
                    int32_t t = tex[ty * texW + tx];
                    int ta = (t >> 24) & 0xFF;
                    if (ta != 0) {
                        zbuff[point] = zval;
                        int la = (int) (w1 * a1 + w2 * a2 + w3 * a3);
                        int lr = (int) (w1 * r1 + w2 * r2 + w3 * r3);
                        int lg = (int) (w1 * g1 + w2 * g2 + w3 * g3);
                        int lb = (int) (w1 * b1 + w2 * b2 + w3 * b3);
                        int a = (ta * la) / 255;
                        int r = (((t >> 16) & 0xFF) * lr) / 255;
                        int g = (((t >> 8) & 0xFF) * lg) / 255;
                        int b = ((t & 0xFF) * lb) / 255;
                        img[point] = (a << 24) | (r << 16) | (g << 8) | b;
                    }
                }
            }
            cx1 -= s.fdy12; cx2 -= s.fdy23; cx3 -= s.fdy31;
        }
        cy1 += s.fdx12; cy2 += s.fdx23; cy3 += s.fdx31;
        off += w;
    }
}

void fillTriangleDepthOnly(float* zbuff, int w, int h,
                           float fx3, float fy3, float fz3,
                           float fx2, float fy2, float fz2,
                           float fx1, float fy1, float fz1) {
    Setup s = setup(w, h, fx3, fy3, fz3, fx2, fy2, fz2, fx1, fy1, fz1);
    if (!s.ok) return;
    int cy1 = s.cy1, cy2 = s.cy2, cy3 = s.cy3;
    int off = s.miny * w;
    for (int y = s.miny; y < s.maxy; y++) {
        int cx1 = cy1, cx2 = cy2, cx3 = cy3;
        float p = s.zoff + s.dy * y;
        for (int x = s.minx; x < s.maxx; x++) {
            if (cx1 > 0 && cx2 > 0 && cx3 > 0) {
                int point = x + off;
                float zval = p + s.dx * x;
                if (zbuff[point] > zval) zbuff[point] = zval;
            }
            cx1 -= s.fdy12; cx2 -= s.fdy23; cx3 -= s.fdy31;
        }
        cy1 += s.fdx12; cy2 += s.fdx23; cy3 += s.fdx31;
        off += w;
    }
}

void drawLineDepthTested(float* zbuff, int32_t* img, int32_t color, int w, int h,
                         float x0, float y0, float z0,
                         float x1, float y1, float z1, float bias) {
    float dx = x1 - x0;
    float dy = y1 - y0;
    float adx = dx < 0 ? -dx : dx;
    float ady = dy < 0 ? -dy : dy;
    int steps = (int) (adx > ady ? adx : ady);
    if (steps < 1) steps = 1;
    float inv = 1.f / steps;
    float sx = dx * inv, sy = dy * inv, sz = (z1 - z0) * inv;
    float px = x0, py = y0, pz = z0;
    for (int i = 0; i <= steps; i++) {
        int ix = (int) px;
        int iy = (int) py;
        if (ix >= 0 && ix < w && iy >= 0 && iy < h) {
            int point = ix + iy * w;
            if (zbuff[point] >= pz - bias) img[point] = color;
        }
        px += sx; py += sy; pz += sz;
    }
}

} // namespace rccore::d3
