// Paint3DContext: the optional 3D extension surface for a PaintContext.
//
// A renderer signals 3D capability by implementing this interface. The 3D operations check for
// it at runtime and no-op when it is absent, so a 3D document on a 2D-only player draws nothing
// rather than failing to load.
//
// Conventions (the OpenGL floor):
//   * Right-handed coordinates, +Y up, -Z forward.
//   * 4x4 column-major float[16]. Final clip = projection x view x model.
//   * Matrix ops post-multiply the current modelview (glTranslate semantics).
//   * CCW winding = front-facing.
//   * NDC z in [-1,+1]; window-z in [0,1], smaller = closer.
//   * Angles in radians.
//   * Modelview / projection / depth state is pushed and popped by the *existing* 2D
//     matrixSave / matrixRestore. There is no separate 3D stack.

/** Projection modes for setCamera3D. */
export const PROJECTION_PERSPECTIVE = 0;
export const PROJECTION_ORTHO = 1;

/** Sub-ops for matrix3Op. */
export const M3_IDENTITY = 0;
export const M3_TRANSLATE = 1;
export const M3_SCALE = 2;
export const M3_ROTATE_AXIS = 3;
export const M3_MULTIPLY = 4;

/** Light types for setLights3D. */
export const LIGHT_DIRECTIONAL = 0;
export const LIGHT_POINT = 1;

/** Sub-ops for the consolidated Paint3DState op. */
export const P3_CLEAR_DEPTH = 0;
export const P3_MATERIAL = 1;
export const P3_DEPTH_BIAS = 2;

// Render modes. Encoding is (backend << 1) | smoothBit, so the shading bit is MODE_SMOOTH_MASK
// and the backend is mode >> 1. A renderer treats a backend it does not implement as software,
// which is why every player is required to have the software path.
export const MODE_SOFTWARE_FLAT = 0;
export const MODE_SOFTWARE_SMOOTH = 1;
export const MODE_CANVAS_FLAT = 2;
export const MODE_CANVAS_SMOOTH = 3;
export const MODE_DRAWMESH_FLAT = 4;
export const MODE_DRAWMESH_SMOOTH = 5;
export const MODE_GL_FLAT = 6;
export const MODE_GL_SMOOTH = 7;
export const MODE_DRAWMESH_ZBUF_FLAT = 8;
export const MODE_DRAWMESH_ZBUF_SMOOTH = 9;
export const MODE_CANVAS_ZBUF_FLAT = 10;
export const MODE_CANVAS_ZBUF_SMOOTH = 11;

/** (mode & MODE_SMOOTH_MASK) != 0 selects smooth (Gouraud) shading. */
export const MODE_SMOOTH_MASK = 0x1;

/**
 * Hidden-line wireframe, OR-ed into a mode. Each front-facing triangle is rasterized into the
 * depth buffer only, then its edges are drawn as depth-tested lines, so edges occluded by nearer
 * surface are hidden. Depth-buffer based, so it forces the software backend regardless of the
 * backend bits.
 */
export const MODE_WIREFRAME = 0x100;

/**
 * Wireframe edge-selection bits. A triangle (v0,v1,v2) has edge 0 = v0->v1, edge 1 = v1->v2,
 * edge 2 = v2->v0. With MODE_WIREFRAME set but no edge bit, all three are drawn.
 */
export const WIRE_EDGE0 = 0x200;
export const WIRE_EDGE1 = 0x400;
export const WIRE_EDGE2 = 0x800;
export const WIRE_EDGE_MASK = WIRE_EDGE0 | WIRE_EDGE1 | WIRE_EDGE2;

export const MODE_SOFTWARE_WIREFRAME = MODE_SOFTWARE_FLAT | MODE_WIREFRAME;

/** Backend selectors, i.e. mode >> 1. */
export const MODE_BACKEND_SOFTWARE = 0;
export const MODE_BACKEND_CANVAS = 1;
export const MODE_BACKEND_DRAWMESH = 2;
export const MODE_BACKEND_GL = 3;
export const MODE_BACKEND_DRAWMESH_ZBUF = 4;
export const MODE_BACKEND_CANVAS_ZBUF = 5;

/**
 * Implemented by a PaintContext that can render 3D. The 3D operations do
 * `if (isPaint3DContext(ctx))` before dispatching.
 */
export interface Paint3DContext {
    defineMesh3D(id: number, indices: Int32Array, verts: Float32Array,
                 normals: Float32Array | null, uv?: Float32Array | null): void;
    setCamera3D(projection: number, projParams: Float32Array | number[],
                viewParams: Float32Array | number[]): void;
    matrix3Op(sub: number, args: Float32Array | number[]): void;
    drawMesh3D(meshId: number, mode: number): void;
    clearDepth3D(): void;
    setLights3D(types: Int32Array | number[], colors: Int32Array | number[],
                params: Float32Array | number[]): void;
    setTexture3D(bitmapId: number): void;
    setMaterial3D(specStrength: number, shininess: number): void;
    setDepthBias3D(constant: number, slope: number): void;
}

/** Runtime check used by the 3D operations before dispatching to a paint context. */
export function isPaint3DContext(ctx: unknown): ctx is Paint3DContext {
    return !!ctx && typeof (ctx as Paint3DContext).drawMesh3D === 'function';
}
