#pragma once
// Paint3DContext constants — the optional 3D extension surface for a PaintContext.
//
// Conventions: right-handed, +Y up, -Z forward; column-major 4x4; clip = projection x view x
// model; matrix ops post-multiply the modelview; CCW front-facing; NDC z in [-1,+1], window-z in
// [0,1] smaller = closer; radians.

namespace rccore::d3 {

enum : int { PROJECTION_PERSPECTIVE = 0, PROJECTION_ORTHO = 1 };
enum : int { M3_IDENTITY = 0, M3_TRANSLATE = 1, M3_SCALE = 2, M3_ROTATE_AXIS = 3,
             M3_MULTIPLY = 4 };
enum : int { LIGHT_DIRECTIONAL = 0, LIGHT_POINT = 1 };
enum : int { P3_CLEAR_DEPTH = 0, P3_MATERIAL = 1, P3_DEPTH_BIAS = 2 };

// Render modes: (backend << 1) | smoothBit. An unimplemented backend falls back to software,
// which is why every player is required to have the software path.
enum : int {
    MODE_SOFTWARE_FLAT = 0, MODE_SOFTWARE_SMOOTH = 1,
    MODE_CANVAS_FLAT = 2, MODE_CANVAS_SMOOTH = 3,
    MODE_DRAWMESH_FLAT = 4, MODE_DRAWMESH_SMOOTH = 5,
    MODE_GL_FLAT = 6, MODE_GL_SMOOTH = 7,
    MODE_DRAWMESH_ZBUF_FLAT = 8, MODE_DRAWMESH_ZBUF_SMOOTH = 9,
    MODE_CANVAS_ZBUF_FLAT = 10, MODE_CANVAS_ZBUF_SMOOTH = 11,
};

enum : int { MODE_SMOOTH_MASK = 0x1 };

/** Hidden-line wireframe; depth-buffer based, so it forces the software backend. */
enum : int { MODE_WIREFRAME = 0x100 };
enum : int { WIRE_EDGE0 = 0x200, WIRE_EDGE1 = 0x400, WIRE_EDGE2 = 0x800,
             WIRE_EDGE_MASK = WIRE_EDGE0 | WIRE_EDGE1 | WIRE_EDGE2 };

} // namespace rccore::d3
