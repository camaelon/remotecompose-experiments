#pragma once
// Primitive3D: parametric mesh generators for MESH_PRIMITIVE_3D.
//
// Port of the reference Primitive3D.java. A document names a shape instead of shipping its
// vertices, so a sphere is ~40 bytes on the wire instead of ~20 KB, and because the parameters
// may be expressions the shape can be driven and rebuilt from them.
//
// Winding is CCW-from-outside throughout. The triangle *order* inside each quad is deliberate:
// each triple lists its two grid edges first and closes on the diagonal, which is what makes the
// wireframe edge-selection bits draw meridians, parallels or the full grid rather than an
// arbitrary subset. Do not "tidy" it.

#include <cstdint>
#include <vector>

namespace rccore::d3 {

struct MeshData {
    std::vector<float> verts;
    std::vector<float> normals;
    std::vector<int32_t> indices;
    std::vector<float> uv;   // empty = absent
};

enum : int {
    P_SPHERE = 0, P_CYLINDER = 1, P_CONE = 2, P_CUBE = 3, P_ROUNDED_CUBE = 4,
    P_SPHERICAL_SECTOR = 5, P_SPHERICAL_DOME = 6, P_TUBE = 7, P_CAP_TUBE = 8,
    P_PROFILE_TUBE = 9, P_TORUS = 10, P_PLANE = 11,
    P_EXTRUDE_CIRCLE = 12, P_EXTRUDE_SECTOR = 13, P_EXTRUDE_SEGMENT = 14, P_EXTRUDE_ARC = 15,
    P_EXTRUDE_ROUNDED_RECT = 16, P_EXTRUDE_SQUIRCLE = 17, P_EXTRUDE_PATH = 18,
    P_LATHE = 19, P_SWEEP = 20, P_HELIX = 21, P_ICOSPHERE = 22,
};

enum : int {
    FLAG_SPLINE = 0x1, FLAG_TUBE_LEGACY = 0x2, FLAG_TUBE_PATH_DENSITY = 0x4,
    FLAG_TUBE_CAP = 0x8, FLAG_UV_SHIFT = 4, FLAG_UV_MASK = 0x3 << 4,
};

/**
 * Dispatch a (type, segments, flags, data) tuple to the matching builder. `segments` is the
 * primary division count; <= 0 means the type's default. data[0] is the scalar params; channels
 * 1+ carry geometry streams for the multi-channel types.
 */
MeshData buildPrimitive(int type, float segments, int flags,
                        const std::vector<std::vector<float>>& data);

} // namespace rccore::d3
