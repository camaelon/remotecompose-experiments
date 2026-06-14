# Surface API — proposal

A coherent set of operations for 2D-on-3D surfaces, mirroring the
existing **path** API. Designed so anyone already comfortable with
RemoteCompose's path system can pick this up by analogy.

## Design constraints (settled)

1. **Mesh format is a simple vertex + index table.** Triangles only at
   the wire-format level. No NURBS, no Bezier patches, no quad meshes
   exposed at the API layer. Higher-order constructors (`surface_data`
   patches, `surface_expression`) tessellate down to triangles before
   they hit the indexed-mesh representation.
2. **Rendering model is implementation-dependent.** The format
   describes a *capable* scene (PBR materials, multiple lights,
   shadows, image-based environment, post-processing). Each player
   degrades gracefully — a low-end backend may flatten PBR to lambert,
   drop shadows, or fall back to vertex colour, and that's fine. The
   document doesn't dictate the rendering pipeline; it dictates intent.
3. **State model is identical to the 2D system.** The renderer carries
   *current* material, *current* transform, *current* camera, *current*
   lights, *current* clip, exactly the way 2D carries current paint /
   transform / clip. `save` / `restore` push and pop. Every `draw_*`
   uses whatever's current; explicit scene graphs aren't introduced.

The shape of the surface API therefore mirrors the path API
op-for-op, with a `material` that's the natural enlargement of `paint`
and a small set of additional ops for things 3D scenes need that 2D
canvases don't.

---

## 1. Constructors / mutators

| Path op | Surface op | What the surface op does |
|---|---|---|
| `path_create` | `surface_create` | Allocate an empty mutable mesh. Subsequent `surface_*_to` / `surface_vertex` / `surface_face` ops accumulate into it. |
| `path_data` (token stream of `MOVETO` / `LINETO` / `QUAD_TO` / `CUBIC_TO` / `CLOSE`) | `surface_data` | Declarative mesh stream of `VERTEX` / `TRI` / `STRIP` / `FAN` / `END` markers. Defines a triangle mesh in one shot. Patches and quads inside the stream are tessellated on the way in. |
| `path_expression` (parametric path from an RPN formula) | `surface_expression` | Parametric `f(u,v) → (x,y,z)` over `[u₀,u₁]×[v₀,v₁]` *or* implicit `f(x,y,z) = 0`. Tessellated to a triangle mesh at evaluation time; tessellation density is a uniform. |
| `path_tween` (linear blend between two paths) | `surface_tween` | Linear blend between two topologically-compatible meshes (same vertex count). Vertex positions / normals / UVs blend per-vertex. Building block for blend shapes / morph targets. |
| `path_combine` (boolean union/intersect/diff/xor) | `surface_combine` | CSG: `union`, `intersect`, `difference`. Inputs must be watertight; output is a triangle mesh. |
| `path_append` (concatenate one path into another) | `surface_append` | Concatenate one mesh into another, preserving separate islands. |
| `path_move_to` (move pen) | `surface_vertex` | Add a vertex with optional UV / normal / colour attributes. Returns an index used by subsequent face ops. |
| `path_line_to` | (no equivalent) | A surface has no "current line"; faces are constructed from explicit vertex indices. |
| `path_quad_to` / `path_cubic_to` | (no surface equivalent at this layer) | Higher-order patches go through `surface_data` or `surface_expression` and tessellate down. |
| (no equivalent) | `surface_face` | Add one triangle face from three vertex indices. |
| `path_close` | `surface_seal` | Detect open boundary loops and close them — caps an extruded shape into a watertight solid. |
| `path_reset` | `surface_reset` | Empty the mesh. |

---

## 2. Drawing & consumption

| Path op | Surface op |
|---|---|
| `draw_path` | `draw_surface` — render the indexed mesh with the current material, current transform, current camera, current lights. |
| `clip_path` | `clip_surface` — use the surface as a CSG mask for subsequent draws (volumetric scissor). |
| `draw_text_on_path` | `draw_text_on_surface` — text laid out along a UV-space curve on the mesh. |
| (none) | `draw_outline` — silhouette / contour stroke of a surface. Bridges 3D back to the 2D path renderer for hand-drawn / engineering-drawing aesthetics. |

---

## 3. Primitive shapes

The 2D system has direct-draw primitives (`draw_rect`, `draw_circle`,
…) that bypass building a path explicitly. The surface API mirrors
this with primitive solids. Each is rendered with the current
material, transform, camera, lights — same state model as 2D.

| 2D primitive | 3D primitive | Parameters |
|---|---|---|
| `draw_rect` | `draw_box` | min, max corners (or centre + half-extents) |
| `draw_round_rect` | `draw_rounded_box` | box bounds + corner radius + smoothness |
| `draw_circle` | `draw_sphere` | centre, radius, subdivisions |
| `draw_oval` | `draw_ellipsoid` | centre, three axis radii |
| `draw_line` | `draw_cylinder` | endpoints, radius, capped flag |
| (none) | `draw_capsule` | endpoints, radius |
| `draw_arc` (curved segment) | `draw_torus` | major radius, minor radius, sweep range, subdivisions |
| `draw_sector` (pie wedge) | `draw_cone` / `draw_wedge` | apex, base ring, angle range |
| (none) | `draw_plane` | origin, normal, half-extents |
| (none) | `draw_quad` | four corner vertices, single quadrilateral |

Plus higher-level constructors that produce a triangle mesh from
2D inputs — these have no path counterpart:

| Op | What it does |
|---|---|
| `draw_extrude` | Extrude a 2D `path_*` along a 3D direction (or along a 3D `path_*`); produces a swept solid. |
| `draw_revolve` | Spin a 2D `path_*` around an axis to make a surface of revolution (lathe). |
| `draw_loft` | Skin between a stack of cross-section paths along a spine. |
| `draw_subdivide` | Catmull-Clark / Loop-style smoothing applied to a base mesh. |

---

## 4. Material — the enlarged `paint`

The 2D `paint` carries `color`, `style`, `stroke_width`, `stroke_cap`,
`stroke_miter`, `alpha`, `text_size`, `typeface`, `shader`. The
surface analogue is `material`. Because rendering is implementation-
dependent, `material` describes a **capable** PBR-style surface and
the player decides which fields it can honour.

| Material field | 2D paint counterpart | Function |
|---|---|---|
| `base_color` | `color` | Albedo for the diffuse term. |
| `roughness` | (none) | Microfacet roughness (0 = mirror, 1 = matte). |
| `metallic` | (none) | 0 = dielectric, 1 = metal. |
| `emissive` | (none) | Self-illumination — bypasses lighting. |
| `ior` | (none) | Index of refraction — Fresnel + transmission. |
| `alpha` | `alpha` | Coverage / transparency. |
| `transmission` | (none) | Glass-like transmittance (0–1). |
| `albedo_map` | (none) | Texture sampled by UV, multiplied with `base_color`. |
| `normal_map` | (none) | Tangent-space normal perturbation. |
| `roughness_map` | (none) | Per-texel `roughness`. |
| `metallic_map` | (none) | Per-texel `metallic`. |
| `emissive_map` | (none) | Per-texel additive emission. |
| `ao_map` | (none) | Pre-baked ambient occlusion. |
| `displacement_map` | (none) | Tessellation-time geometry displacement. |
| `shader` | `shader` | Programmable per-fragment shading; bypasses the lit pipeline if set. |
| `style` | `style` | `solid` / `wireframe` / `points` / `outline` — 3D analogue of fill/stroke. |
| `wireframe_color`, `wireframe_width` | `stroke_*` | Edge rendering when `style = wireframe`. |
| `cull` | (none) | `front` / `back` / `none`. |
| `double_sided` | (none) | Disable culling and shade both sides. |
| `depth_test`, `depth_write` | (implicit) | Z-buffer behaviour. |
| `blend_mode` | `blend_mode` | Same set as 2D, plus `additive` / `multiply` / `screen`. |

A simple implementation may interpret `material` as just
`base_color + alpha + emissive` and ignore the rest; a capable
implementation runs full PBR with IBL.

---

## 5. State that surfaces need but paths don't

These additions sit *alongside* the existing 2D state, follow the
same "current X" / `save` / `restore` discipline, and have no path
counterpart.

| Op | What it does |
|---|---|
| `camera` | Sets the current camera: position, target / direction, FOV, near/far, ortho/perspective. Multiple cameras can be defined; only the current one renders. |
| `light_directional` | Sun-like directional light — direction, colour, intensity. |
| `light_point` | Point light — position, colour, intensity, falloff radius. |
| `light_spot` | Spot light — position + cone angle + falloff. |
| `light_area` | Rectangle / disc area light — soft shadows. |
| `light_environment` | Image-based environment lighting (HDRI) — ambient + reflections. |
| `shadow_settings` | Shadow map resolution, soft-shadow radius, bias — global toggles. |
| `tonemap` | HDR → display tone-map curve (linear / Reinhard / ACES) and exposure. |
| `texture_data` | Image / shader bound as a texture by id (analogous to `bitmap_data` / `shader_data`). |
| `texture_uv_transform` | Translate / scale / rotate the UV coordinates a material samples with. |
| `surface_normals` | Recompute / smooth / flat-shade normals on a mesh. |
| `surface_uv_unwrap` | Auto-generate UVs for a mesh (planar / cubic / spherical / angle-based). |
| `transform3` | 4×4 matrix push / pop. The 3D analogue of the existing 2D `save` / `translate` / `scale` / `rotate`. The 2D ops continue to work; `transform3` extends them with a Z axis and arbitrary-axis rotation. |
| `frame_settings` | Background / clear colour, post-processing chain (bloom / DOF / FXAA), MSAA. |

Lights add to the *current set of lights*; turning a light off is
done by re-emitting it with intensity zero (or by `save` / `restore`
around it). Same idiom as the rest of the 2D state stack.

---

## 6. Animation / expression parity

Every numeric field above — vertex coordinates, material values, light
intensities, camera position, transform components — is an RPN
expression id, exactly the way `path_data` and `path_expression` work
today. Recomputed each frame, no new mechanism required.

The only additions are new **system variables** the surface API
should expose:

| Variable | Why |
|---|---|
| `CAMERA_X / Y / Z` | Reactive camera (e.g., follow / orbit). |
| `CAMERA_DIR_X / Y / Z` | View direction available to expressions. |
| `LIGHT_*` | Animate light parameters. |
| `MOUSE_RAY_ORIGIN_*`, `MOUSE_RAY_DIR_*` | Pick / hover / drag in 3D. |
| `VIEWPORT_FOV` | Scriptable framing. |

---

## What stays coherent with the path system

- Same constructor patterns: `_create` (mutable), `_data` (declarative),
  `_expression` (computed), `_tween` (blend), `_combine` (boolean),
  `_append`.
- Same drawing pattern: `draw_*` consumes current state
  (paint → material, clip → `clip_surface`, transform → `transform3`,
  plus camera and lights).
- Same animation pattern: every scalar / vector field is an
  expression id evaluated each frame.
- `save` / `restore` apply unchanged; they push / pop the entire
  state including transform, material, camera, lights, clip.

## What intentionally diverges

- `material` is wider than `paint`. PBR fields (roughness, metallic,
  IOR, transmission, normal/displacement/AO maps) have no 2D analogue
  and have to live somewhere.
- `camera`, `light_*`, `tonemap`, `frame_settings`, `texture_uv_transform`,
  `surface_normals`, `surface_uv_unwrap` are net-new ops — surfaces
  need them, paths don't.
- Higher-order constructors (`extrude` / `revolve` / `loft` / `subdivide`)
  produce a mesh from 2D / mesh inputs and don't have a path-rendering
  counterpart.

---

## Open questions for review

1. **`surface_data` token vocabulary.** Should the stream support quad
   and patch inputs and tessellate down, or be triangles-only at the
   API layer like the wire format? (If yes-tessellate, every encoder
   has to ship a tessellator — inconvenient. If no, authoring tools
   must triangulate before emitting.)
2. **CSG correctness.** `surface_combine` is genuinely hard at
   floating-point precision. Worth specifying tolerances and
   degenerate-case handling up front.
3. **Subdivision target.** `draw_subdivide` Catmull-Clark only? Or
   Loop too? They produce different topology and aren't trivially
   interchangeable.
4. **UV space.** Should UVs be `[0,1]²` per island (standard) or
   `[-∞, ∞]` and let materials apply `texture_uv_transform`?
   First is more familiar; second composes with animation cleaner.
5. **Picking semantics.** `MOUSE_RAY_*` system variables imply some
   form of 3D picking. Is that a runtime obligation, or should the
   format describe the ray and let the consumer compute hits?
