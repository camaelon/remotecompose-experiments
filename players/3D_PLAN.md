# RemoteCompose 3D — TypeScript and C++ build-out

The 3D extension lives in `androidx-main2` on branch `next3d` (commit `a36f4a89864` plus an
uncommitted working tree), in review as
[ag/4108133](https://android-review.googlesource.com/c/platform/frameworks/support/+/4108133).
This plan brings it to the TypeScript and C++ players **software-first**, so every player has a
rendering path that depends on nothing but a pixel buffer.

## What the CL actually adds

Ten operations, registered in both experimental profiles (`sMapV7AndroidXExperimental` and
`sMapV7WidgetsExperimental`):

| op | id | payload |
| :--- | ---: | :--- |
| `DEFINE_MESH_3D` | 110 | `id, len+indices[], len+verts[], len+normals[], len+uv[]` |
| `SET_CAMERA_3D` | 111 | `projection, len+projParams[], len+viewParams[]` |
| `MATRIX_3D_OP` | 112 | `sub, len+args[]` |
| `DRAW_MESH_3D` | 113 | `meshId, mode` |
| `PAINT_3D_STATE` | 114 | `sub, len+params[]` — clear-depth / material / depth-bias |
| `SET_LIGHTS_3D` | 115 | `n, (type,color)×n, len+params[]` |
| `VECTOR_EXPRESSION` | 116 | vec2/3/4-valued expression, scatters to ids |
| `MESH_EXPRESSION_3D` | 117 | `id, type, flags, params[], pos[][], normal[][], uv[][]` |
| `SET_TEXTURE_3D` | 118 | `bitmapId` |
| `MESH_PRIMITIVE_3D` | 120 | `id, type, segments, flags, channels×(len+data[])` |

Six of them (`Matrix3DOp`, `SetCamera3D`, `Paint3DState`, `SetLights3D`, `MeshPrimitive`,
`MeshExpression`) implement `VariableSupport`, so any float in their payload may be a NaN-boxed
variable id and the geometry re-evaluates when it changes. That is the part that makes this
RemoteCompose rather than a mesh format: **a primitive's radius, a camera's eye position and a
light's direction are all expressions.**

`MESH_PRIMITIVE_3D` carries 23 parametric shapes whose geometry lives in `Primitive3D.java`
(2649 lines) — sphere, cylinder, cone, cube, rounded cube, spherical sector/dome, tube, cap-tube,
profile-tube, torus, plane, six extrusions, path-extrude, lathe, sweep, helix, icosphere.
`MESH_EXPRESSION_3D` is the 3D analogue of `PathExpression`: RPN expressions evaluated over a
`(u,v)` grid, four surface families (general, height-field, sphere, cylinder).

### The renderer surface

`Paint3DContext` is an **optional** interface. Ops cast at runtime and no-op when the context does
not implement it, so a 3D document degrades to blank rather than failing — except that the doc
claims a decode-time `PROFILE_3D_MIN` gate.

Render modes encode `(backend << 1) | smoothBit`, plus wireframe flags:

    0/1  software flat/smooth        6/7   GL flat/smooth
    2/3  canvas flat/smooth          8/9   drawMesh Z-buffer flat/smooth
    4/5  drawMesh flat/smooth       10/11  canvas Z-buffer flat/smooth
    0x100 wireframe (forces software)  0x200/0x400/0x800 per-edge selection

**The software backend is mode 0/1 and is the fallback for every unimplemented backend.** That is
what makes this portable: the Java software path is `JavaPaint3DContext` (1156) + `Rasterizer`
(700) + `Matrix4` (305), and those three files import nothing but `java.util` and annotations.
Zero Android dependencies. They port directly and they double as the oracle.

Conventions: right-handed, +Y up, −Z forward; column-major `float[16]`; clip = `P × V × M`;
matrix ops post-multiply the modelview; CCW front-facing; NDC z ∈ [−1,1], window-z ∈ [0,1]
smaller-is-closer; radians. Modelview/projection/depth state rides the *existing* 2D
`matrixSave`/`matrixRestore` — there is no separate 3D stack.

## Findings to send upstream

1. **`PROFILE_3D_MIN` is documented but never defined.** `Paint3DContext` says a document tagged
   `PROFILE_3D_MIN` fails to load against a non-3D renderer, but no such constant exists in
   `RcProfiles.java`, and the ops register under the existing experimental profiles. The gate
   described in the docs is not implemented, so a 3D document silently draws nothing on a 2D
   player instead of failing to load. Decide which behaviour is wanted before this ships.
2. **`defineMesh3D` has no delete.** Meshes accumulate in a `Map<Integer, Mesh>` for the life of
   the document with no eviction and a 200k-vertex / 600k-index ceiling *per mesh*.
3. **`VectorExpression.updateVariables` destroys its own vector opcodes.** It classifies each
   program token with `AnimatedFloatExpression.isMathOperator` and `NanMap.isDataVariable` only.
   The vector opcodes (OFFSET+100..107 — vec2/3/4, dot, cross, len, lensq, norm) sit *above* the
   scalar op range, so `isMathOperator` returns false and each one is overwritten with
   `context.getFloat(id)` — 0 for an unset id. Verified directly against the reference: the
   program `[3, 4, 0, vec3]` has its `vec3` token replaced by `0.0` on the first
   `updateVariables`, after which every vector program evaluates to zeros. `VectorOpCodes`
   already has `isVectorOp`, and its docstring says callers classifying operator-vs-variable
   "must treat these as operators too" — `VectorExpression` just never calls it. One-line fix;
   without it the operation cannot do the one thing it exists for.

   **This is the only place the TypeScript port knowingly diverges from the reference.** It
   applies the check, because a faithfully-broken op is not a working player. Flagged in the
   source at `VectorExpression.ts:isResolvable`.

4. **Mode is a document-authored constant.** A document written for `MODE_GL_SMOOTH` silently
   becomes software on a player without GL — correct, but it means authors cannot know what they
   will get, and the modes differ visibly (canvas backends have no depth buffer).

## Approach

Three deliverables, software renderer first in each:

* **A portable spec** (`3D_WIRE.md`) — the ten ops byte-for-byte, the conventions, the mode
  encoding. Written from the Java source so TS and C++ implement the same thing rather than each
  reading Java separately.
* **TypeScript**: `Matrix4` → `Rasterizer` → `SoftwarePaint3DContext` → the ten ops → canvas blit.
* **C++**: the same three-layer port into `lib/rccore`, reusing the spec.
* **JSON**: extend `rcj` (the Python converter, 2136 lines) so 3D documents can be *authored*
  rather than only decoded. This is what makes the whole thing usable from the corpus.

### Verification

`JavaPaint3DContext` is pure Java, so it compiles standalone with `javac` — no Android, no
gradle. **So is the whole of `remote-core`**: 300 files, needing only three stub annotation types.
The oracle therefore compiles it and drives the *real* operation classes (`MeshExpression` in
particular) through a 82-method stub `PaintContext`/`RemoteContext` bridge, rather than a
re-implementation of their arithmetic — testing a copy of the logic would prove nothing. That
gives a **headless oracle**: render a document's 3D pass to a PNG with Java, render
the same `.rc` with the TypeScript player, and diff the images. Any divergence is a port bug, not
a judgement call. The same corpus then validates C++.

This matters more than usual here. A rasterizer that is subtly wrong — half-pixel offset, wrong
fill rule, wrong depth interpolation — still produces a picture that looks like a cube. Only a
pixel diff against the reference catches it.

## Phases

| # | phase | output |
| ---: | :--- | :--- |
| 1 | Spec extraction | `3D_WIRE.md` |
| 2 | Java oracle harness | standalone `javac` renderer → PNG |
| 3 | TS math + rasterizer | `Matrix4.ts`, `Rasterizer.ts` + unit parity tests |
| 4 | TS paint context | `SoftwarePaint3DContext.ts`, canvas blit |
| 5 | TS operations | 10 op classes, registered |
| 6 | JSON authoring | `rcj` 3D commands, schema documented |
| 7 | Parity corpus | N documents, TS-vs-Java pixel diff in CI |
| 8 | `MeshPrimitive` port | the 23 parametric shapes |
| 9 | `MeshExpression` port | `(u,v)` surface families |
| 10 | C++ port | `lib/rccore` 3D, same corpus |

## Status

| # | phase | state |
| ---: | :--- | :--- |
| 1 | Spec extraction | **done** — captured in this document and in the op `read()` docs |
| 2 | Java oracle harness | **done** — `3d-oracle/`, plain `javac`, no Android |
| 3 | TS math + rasterizer | **done** — bit-exact on 9 scenes |
| 4 | TS paint context | **done** — `SoftwarePaint3DContext` + canvas blit |
| 5 | TS operations | **done — all 10** |
| 6 | JSON authoring | **done** for all 10 — `rcj` emits them |
| 7 | Parity corpus | **done** — 46 image scenes + 32 vector programs, **three players** |
| 8 | `MeshPrimitive` port | **done — all 23 shapes** |
| 9 | `MeshExpression` port | **done** — all four surface families |
| 10 | C++ port | **done** — engine, all 23 primitives, all 10 operations |

Ported and registered: `DEFINE_MESH_3D`, `SET_CAMERA_3D`, `MATRIX_3D_OP`, `DRAW_MESH_3D`,
`PAINT_3D_STATE`, `SET_LIGHTS_3D`, `SET_TEXTURE_3D`, `MESH_PRIMITIVE_3D`, `MESH_EXPRESSION_3D`,
`VECTOR_EXPRESSION`. **All ten.**

### C++ (phase 10)

`lib/rccore/{include,src}/d3/` — `Matrix4`, `Rasterizer`, `SoftwarePaint3DContext`,
`Primitive3D` + `Primitive3DSweep` (all 23 shapes), `MonotonicCurveFit`, `VectorRpn`, plus
`tools/d3scene` and `tools/vecrpn`. Both parity runners now compare **three** players against the
Java reference from one corpus: 46 image scenes and 32 vector programs, all bit-exact.

**The ten operations are wired into the C++ player too**: `operations/Operations3D.{h,cpp}`,
registered in `Operations.cpp` (readers) and `OpcodeRegistry.cpp` (the inspector table), with an
optional `Paint3D` surface reached through `PaintContext::asPaint3D()` — the C++ equivalent of
the reference's `instanceof Paint3DContext`, returning null on a 2D-only backend so a 3D document
degrades to drawing nothing rather than failing to load.

`tools/rc3d` renders a real `.rc` end to end (WireBuffer → CoreDocument → the ten ops → the
software renderer) and `./3d-doc-parity.sh` compares that against the TypeScript player on
`rcJson/d3/static.json` — five primitives including a capped spline tube and a bevelled
extrude-path with a hole, plus an expression height field. **Bit-identical.**

That fixture is deliberately time-independent, which took two attempts to get right: the first
comparisons differed by tens of thousands of pixels purely because `continuousSec()` reads the
wall clock and the two players were rendering different moments. A cross-player pixel test on an
animated document measures the clock, not the code.

It also caught a real bug that the engine-level corpus could not: **`Utils::isVariable` treats
operator NaNs as variables**, so resolving an expression with it replaces every operator with
`getFloat(id)` and flattens the program to constants. The height field rendered as a flat plane.
The existing expression operations guard with `ExpressionEvaluator::isMathOperator`; the 3D ones
now use a shared `isResolvableToken` that excludes math operators, data variables *and* the
vector opcodes. Scene scripts bypass the op layer entirely, so only an end-to-end document test
could have found it.

The C++ port took a fraction of the TypeScript effort — `float` is genuinely 32-bit and `int`
wraps, so the reference transcribes verbatim with none of the `fround` scaffolding. But it has
two hazards of its own, and both are worse than the JS ones because the code *looks* correct:

1. **Clang contracts `a*b + c` into an FMA by default.** An FMA rounds once where Java rounds
   twice, so the result is a different float. This alone put **36 of 40 scenes wrong**, all by
   small amounts that looked like a plausible rounding drift. `-ffp-contract=off` is pinned in
   `lib/rccore/CMakeLists.txt` and in both parity runners, commented as a correctness flag so it
   does not get "cleaned up" later.
2. **`std::sqrt` on a float expression picks `sqrtf`.** Java's `Math.sqrt` is double-only: a
   float argument widens, and the result narrows. The tube's chord-length knots are
   `Math.sqrt(dx*dx + dy*dy + dz*dz)` assigned to a `double`; calling `sqrtf` there changed the
   knot spacing and moved every spline sample by a ULP. All transcendentals now go through
   `JavaMath.h` wrappers that take `double`, so the overload cannot be picked by accident.

The fix for (2) had a sting worth recording. A blanket regex turned `std::sqrt(a*a + b*b)` into
`jsqrt((double)a*a + b*b)`, which casts the *first operand* and so evaluates the whole sum in
double — where Java sums in float. That fixed the knots and broke two scenes that had been
passing, netting 38 → 36. The cast has to wrap the entire argument. A mechanical edit that is
right in most places and wrong in a few is harder to spot than one that is wrong everywhere.

### Vector expressions (phase 9b)

`VectorRpn` and `VectorExpression` ported: 27 opcodes over a 4-lane stack, with scalars broadcast
across all lanes and unused high lanes zero-padded so dot and length are correct at any
dimensionality. Verified by `./vec-parity.sh`, which runs 32 programs through both evaluators and
requires the raw float bits to match — a stricter test than a pixel diff, and the right one here
because this op writes variables rather than drawing. Coverage includes the domain edges: an
exact divide-by-zero (Inf) and the same program under the soft-domain retry (finite).

Two JS-specific hazards, both now handled:

* **NaN payload masking.** The reference decodes opcodes with a 23-bit mask. JS quiets a
  signalling NaN the moment it passes through a `number` — which every value does, since a
  Float32Array read widens to float64 — so bit 22 comes back set and the 23-bit mask yields a
  garbage opcode. The port masks 22 bits, which is what `Utils.idFromNan` already does for the
  scalar evaluator.
* **Silent out-of-bounds.** Writing past a Float32Array is a no-op in JS where Java throws, so a
  malformed program would quietly produce garbage instead of failing. The stack and program
  bounds are checked explicitly.

The authoring surface names the scattered components: `{"vectorExpression": {"name": "dir",
"dimension": 3, "expression": "normalize(vec3(...))"}}` binds `@dir.x/.y/.z` to the consecutive
ids, so downstream expressions read them as ordinary scalars — which is the whole point of the
op. `rcJson/d3/vector.json` (835 bytes) uses one such vector for both a light direction and a
rod's endpoint, keeping two unrelated consumers in sync with no duplicated maths. The vector-only
opcodes are injected into the expression compiler for that command alone, so a `dot()` in a
scalar expression fails at build time rather than as a runtime "op not implemented".

### Mesh expressions (phase 9)

All four surface families ported — general (three position expressions), height field, sphere and
cylinder (one displacement expression over an analytic base) — plus explicit normal and UV
expression groups, finite-difference normals when they are absent, and winding flip. Six parity
scenes, all bit-exact on the first run.

This one needed no new numeric work: the RPN evaluator (`AnimatedFloatExpression`) was already
ported for 2D `FloatExpression`, so the arithmetic was shared and already correct. The surface
math is shallow enough that per-store float32 rounding was sufficient.

The payoff is the best size story in the set: `rcJson/d3/surfaces.json` is **826 bytes for three
independently animated procedural surfaces** — a travelling radial ripple, a breathing sphere and
a twisting fluted column. The expressions reference `continuousSec()`, so the *surface* animates,
not just its transform, and nothing about the geometry is on the wire except its formula.

The `u` and `v` grid coordinates are bound to VAR1/VAR2 only while a mesh expression is being
compiled, so they cannot shadow a document's own variables elsewhere.

### Primitives (phase 8)

All 23 shapes ported, each with at least one parity scene, all bit-exact against the reference:
the analytic solids (sphere, cylinder, cone, cube, rounded cube, spherical sector and dome,
torus, plane), the six extrusions, lathe, icosphere, and the six that need real machinery —
`TUBE`, `CAP_TUBE`, `PROFILE_TUBE` (monotone-spline centrelines with adaptive ring counts,
parallel-transport frames), `SWEEP` and `HELIX` (swept cross-sections with per-station scale and
twist), and `EXTRUDE_PATH` (scanline/nonzero-winding trapezoid triangulation, so concave
outlines, holes and overlapping contours all work). `MonotonicCurveFit` came across with them.

The tube variants are covered separately because they take different code paths: adaptive
spline, manual ring density, legacy polyline, and legacy + Catmull-Rom densification.

The first 17 matched on the first run. The last six did not, and the two bugs they exposed were
both in code that had already been "verified" — worth recording:

1. **`catmull()` regrouped its coefficients.** `2f*p0 - 5f*p1 + 4f*p2 - p3` evaluated left to
   right is not the same float as `(2p0 - 5p1) + (4p2 - p3)`. Algebraically identical, one ULP
   apart, eight pixels different.
2. **`double d = <all-float expression>` is evaluated in float and widened on assignment.**
   The rasterizer's plane-equation divisor is declared `double` but its initializer is entirely
   float, so Java computes it in float32. I had it in float64 — and so were the numerators, and
   the two errors had been *partly cancelling*. Fixing only the numerators made a passing scene
   fail. That is the trap: a "verified" component can be wrong in two places that hide each
   other, and a corpus that only exercises fat triangles will never show it. The tube's long thin
   triangles did.

The lesson for the C++ port is narrower than it looks: C++ `float` arithmetic is genuinely 32-bit,
so both of these are free there. They are TypeScript hazards specifically, and the place to look
when a shape is off by a handful of pixels is any expression whose Java declaration is `double`
but whose operands are all `float`.

The triangle *order* within each quad is load-bearing and must not be tidied: each triple lists
its two grid edges first and closes on the diagonal, which is what makes `WIRE_EDGE0/1/2` select
meridians, parallels or the full grid. Reordering them changes nothing about the solid render and
silently breaks wireframe edge selection.

### What the float32 parity work actually cost

Getting from "renders a cube" to "renders the reference's exact bytes" took five separate fixes,
none of which changed what the picture looks like:

1. the interpolators accumulated in float64; Java rounds after **every** multiply and add
2. `Matrix4` and `projectTriangle` rounded only on store, leaving projected vertices 1 ULP off —
   enough to move a 28.4 fixed-point cell and change which pixels a triangle covers
3. the lighting accumulators, including `AMBIENT = 0.2f`, were float64
4. `1.0f / s` rounds the **divisor** to float32 first; above 2²⁴ that is lossy, so a full-screen
   triangle disagreed while every smaller one matched
5. `cx * inv` promotes the integer edge value to float32 first — same rule, same threshold

And one that was not a renderer bug at all: **node-canvas premultiplies `ImageData`**, so writing
the output through a canvas turned blue 65 at alpha 254 into 64. That alone accounted for 1456
"failures" on pixels the renderer had already got exactly right. The harness now writes PNG bytes
directly. The tell was that every differing pixel had alpha ≠ 255 — worth remembering, because a
comparison harness that corrupts its own output costs more than the bug it was built to find.

The C++ port inherits all six of these. `float` there is genuinely 32-bit, so 1–5 are free; only
the PNG-writing trap needs repeating in the harness.

## Running it

    ./3d-parity.sh                       # Java vs TypeScript vs C++, require bit-equality
    ./vec-parity.sh                      # the same, for the vector evaluator
    ./3d-doc-parity.sh                   # end-to-end on a real .rc: C++ vs TypeScript
    cd typescript && node d3scene.mjs ../3d-oracle/scenes/cube.txt out.png

End-to-end from JSON — `rcJson/d3/turntable.json` (hand-built mesh, 1201 bytes) and
`rcJson/d3/primitives.json` (six named primitives, **1116 bytes with no vertex data on the wire
at all**, and a torus whose minor radius is an expression so its geometry rebuilds per frame),
`rcJson/d3/sweeps.json` (tube, profile tube, helix, twisted sweep and a bevelled extruded outline
with a hole — 1423 bytes, with the helix pitch on an expression so the coil stretches), and
`rcJson/d3/surfaces.json` (three animated expression surfaces in 826 bytes):

    python3 -c "import rcj,json;open('d3/turntable.rc','wb').write(
        rcj.convert_doc(json.load(open('d3/turntable.json'))))"
    node render.mjs .../turntable.rc out.png --width 300 --height 300

Note that `tools/rcdev.py build` cannot yet compile a 3D document: it cross-checks `rcj` against
the Java reference parser, and `RemoteComposeJsonParser` has no 3D commands. Adding them there is
the natural companion change to the CL.

Phases 8 and 9 are deliberately late: primitives and expression-surfaces are *generators* that sit
on top of `defineMesh3D`, so nothing else is blocked on them. A hand-built cube through
`DEFINE_MESH_3D` exercises the entire pipeline first.
