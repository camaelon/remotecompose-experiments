#pragma once
// Rasterizer: 28.4 fixed-point edge-function triangle rasterizer with a depth buffer.
//
// Port of the reference Rasterizer.java. Convention: smaller z = closer; clearDepth fills with
// +infinity.
//
// The two hazards that dominated the TypeScript port are absent here. C++ `int` wraps on
// overflow exactly as Java's does, and C++ `float` rounds to 32 bits at every operation, so the
// expressions transcribe verbatim. The one thing to preserve is Java's *declared types*: where
// the reference says `double d = <all-float expression>`, the expression is evaluated in float
// and only widened on assignment. Writing `double d = ...` in C++ with float operands does the
// same thing, so copying the declaration copies the semantics.

#include <cstdint>

namespace rccore::d3 {

/** Clear the depth buffer to +infinity, so any rasterized z wins on first write. */
void clearDepth(float* zbuf, int count);

/** Rasterize a flat-shaded triangle with a depth test. `color` is packed ARGB. */
void fillTriangle(float* zbuff, int32_t* img, int32_t color, int w, int h,
                  float fx3, float fy3, float fz3,
                  float fx2, float fy2, float fz2,
                  float fx1, float fy1, float fz1);

/** Gouraud-shaded: each covered pixel's ARGB is barycentric over the three vertex colors. */
void fillTriangleGouraud(float* zbuff, int32_t* img, int32_t c3, int32_t c2, int32_t c1,
                         int w, int h,
                         float fx3, float fy3, float fz3,
                         float fx2, float fy2, float fz2,
                         float fx1, float fy1, float fz1);

/**
 * Textured with perspective-correct UV. Fully-transparent texels are cutouts: neither color nor
 * depth is written, so a cutout never occludes what shows through its holes.
 */
void fillTriangleTextured(float* zbuff, int32_t* img,
                          const int32_t* tex, int texW, int texH,
                          int32_t c3, int32_t c2, int32_t c1, int w, int h,
                          float fx3, float fy3, float fz3, float u3, float v3, float iw3,
                          float fx2, float fy2, float fz2, float u2, float v2, float iw2,
                          float fx1, float fy1, float fz1, float u1, float v1, float iw1);

/** Depth test and write, no color — the wireframe path's prepass. */
void fillTriangleDepthOnly(float* zbuff, int w, int h,
                           float fx3, float fy3, float fz3,
                           float fx2, float fy2, float fz2,
                           float fx1, float fy1, float fz1);

/** Depth-tested 3D line (color only). `bias` lets an edge pass against its own face. */
void drawLineDepthTested(float* zbuff, int32_t* img, int32_t color, int w, int h,
                         float x0, float y0, float z0,
                         float x1, float y1, float z1, float bias);

} // namespace rccore::d3
