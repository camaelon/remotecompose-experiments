# Scope: a depth-buffered GPU backend

Written 2026-08-26. Scoping only — nothing here is implemented.

## The finding that reframes this

**`DRAWMESH_ZBUF` is not a depth buffer.** Despite the name, the reference implementation
in `AndroidPaintContext.drawMesh3DZBuf` / `flushZBufScene` is a *global painter's sort*.
Its own doc comment says so: "achieving correct cross-mesh hidden-surface removal via
painter's algorithm."

What it actually does:

- `drawMesh3DZBuf` draws nothing. It projects the mesh through the shared
  `buildCanvasVertices` and **queues** a 28-byte-per-vertex buffer
  (`float2 position | float4 color | float depth`).
- The queue is flushed by `clearDepth3D()` or `reset()`, so a "scene" is the run of meshes
  between two `clearDepth3D` calls.
- At flush, every triangle from every queued mesh is sorted back-to-front **by vertex 0's
  window depth** and submitted as one `Canvas.drawVertices` call.
- It uses `drawVertices` rather than `drawMesh` deliberately, to dodge a
  `Mesh::updateSkMesh` crash in that device's custom `libhwui.so`.

So the id we were about to build a depth buffer under already means something else, and
that something else is still a sort — it inherits every painter's-algorithm failure
(interpenetrating triangles, and the depth-tie class that produced the notched rim). What
it *does* fix is cross-mesh ordering, which the plain `CANVAS` backend gets wrong because
it sorts only within a mesh.

Two consequences worth stating plainly:

- **Deferral reorders 2D against 3D.** Because the meshes are held until the flush, any 2D
  drawing issued between two ZBUF meshes lands *before* the whole 3D batch. The `CANVAS`
  backend composites per mesh specifically to preserve document order. These two backends
  therefore disagree about mixed 2D/3D documents, by design.
- **The sort key differs between stages.** `buildCanvasVertices` orders within a mesh by
  *mean* triangle depth; `flushZBufScene` re-orders globally by *vertex 0*. Any
  reimplementation that wants bit-parity has to reproduce both, in that order.

## Backend id inventory

`mode = (backend << 1) | smoothBit`, `MODE_WIREFRAME = 0x100` forces software.

| id | name | reference (Android) | C++ | TypeScript |
| ---: | :--- | :--- | :--- | :--- |
| 0 | SOFTWARE | yes | yes | yes |
| 1 | CANVAS | `drawVertices`, per-mesh sort | Skia `drawVertices` | WebGL blit |
| 2 | DRAWMESH | `Canvas.drawMesh`, SDK 34+ | — | — |
| 3 | GL | **not defined** | mode ids only | mode ids only |
| 4 | DRAWMESH_ZBUF | global sort, batched | — | — |
| 5 | CANVAS_ZBUF | **not defined** | mode ids only, no backend constant | routed to WebGL with `useDepth` |

Two ids are ours to define: **3 (GL)** and **5 (CANVAS_ZBUF)**. Neither appears in
`remote-core/Paint3DContext.java`, which stops at 9 / backend 4. Both `MODE_GL_*` and
`MODE_CANVAS_ZBUF_*` were added in the ports. That is an opportunity and a hazard — we
should tell upstream we are claiming them before they allocate the same numbers.

Note also a small inconsistency to fix on the way past: C++ `Paint3DContext.h` defines
`MODE_CANVAS_ZBUF_FLAT/SMOOTH` (10/11) but has no `MODE_BACKEND_CANVAS_ZBUF = 5` constant,
while TypeScript has both.

## What TypeScript has today

`drawMesh3DGl` already accepts a `useDepth` flag and enables `DEPTH_TEST` for
`MODE_BACKEND_CANVAS_ZBUF`. It is **per-mesh only**: `beginFrame` clears colour *and*
depth, and it is called once per mesh, so two meshes can never depth-test against each
other. It is a real depth buffer with a lifetime one mesh long — useful for
self-intersecting geometry within a mesh, useless across a scene.

That is the honest starting point: about a third of the work for backend 5 exists, and its
limitation is exactly the thing that makes it interesting.

## Proposal

Implement **two** backends, in this order. They answer different questions and conflating
them is how this gets confused again.

### Backend 4 — conformance

Match the reference exactly: defer, global sort by vertex-0 depth, one submission, flush on
`clearDepth3D`/`reset`. No quality gain over what a correct painter's algorithm gives.

The reason to do it is that it is the only ZBUF backend the reference defines, so it is the
only one that can be held to **bit-exact parity**, and our two suites already provide that
bar for free. It also closes a real gap: cross-mesh ordering is currently wrong on the
`CANVAS` backend.

### Backend 5 — a real depth buffer

Ours to define, so no parity obligation and no reference to match.

- One offscreen colour+depth target per scene, not per mesh. `clearDepth3D` clears it;
  meshes accumulate into it.
- **No sort at all.** This is the point: it removes the painter's ordering entirely rather
  than making it cheaper, which is the only thing that fixes interpenetrating geometry, and
  it deletes the `stable_sort` from the accelerated path's cost.
- Depth format 24-bit or float32, with reversed-Z worth evaluating — depth precision is
  the mechanism behind the notch class, so this is where the remaining ~15 notches would be
  expected to go. *Expected*, not verified; it is a hypothesis this work would test.
- Perspective-correct UV falls out of the hardware for free, which closes C10.
- Composite once at scene end. That gives it the same 2D-interleave caveat as backend 4,
  which is a defensible cost as long as it is documented rather than discovered.

Shared GLSL ES 3.0 between the two players, per the earlier argument: bit-exactness is what
currently keeps the ports honest with each other, hardware forfeits it, and a shared shader
is the strongest available replacement.

## Work breakdown

| phase | work | size |
| :--- | :--- | :--- |
| 0 | Mode constants, backend-5 constant in C++, fallback plumbing, mode round-trip in `rcj` | small |
| 1 | Backend 4 in C++ and TS: defer queue, global vertex-0 sort, flush on `clearDepth3D`/`reset` | medium |
| 2 | Backend 5 in TS: persist the FBO across a scene, stop clearing depth per mesh, composite at scene end | medium |
| 3 | Backend 5 in C++ | **large — see risks** |
| 4 | Tolerance harness for hardware paths | medium |
| 5 | Shared shader source and its build wiring | medium |

## Risks, in the order they will actually hurt

**1. `rc2image` has no GPU, and it is how everything is tested.** Every image harness we
own — `3d-doc-parity.sh`, `determinism.sh`, the notch detector, the corpus sweeps — runs
through a raster Skia surface. A GPU backend is invisible to all of them. Phase 3 therefore
implies a headless GL context (EGL, OSMesa, or ANGLE) in CI-able form before a single pixel
can be verified. This is the largest hidden cost in the whole plan and it is not
proportional to the rendering work.

Evidence it bites: C10 was diagnosed precisely because `SkCanvas::drawMesh` draws 0 px on a
raster surface. The same wall is still there.

**2. Bit-exact parity does not survive hardware.** Fill rules, depth precision and MSAA
resolve all differ per GPU. Backend 5 needs a tolerance harness, and the existing suites'
comment is explicit that a tolerance "hides exactly the bugs this exists to catch" — so the
tolerance bar has to be designed, not defaulted. Backend 4 escapes this, which is another
reason to do it first.

**3. The notch claim is unproven.** Reversed-Z and a 24-bit depth buffer *should* absorb the
residual ~15 notches, since the mechanism is depth precision. I have not demonstrated it.
Treat it as the hypothesis under test, not a deliverable.

**4. Claiming ids 3 and 5 without upstream agreement.** Cheap to coordinate now, expensive
to unpick later. Fold it into the same conversation as the depth-plane fix.

## What I would not do

Move the vertex transform to the GPU as part of this. The profiling put it at ~1 ms flat on
typical documents against 10–150 ms of fill, and the front-half's quadratic sort — the thing
that actually made it expensive — is already fixed. It matters only for the 30k-triangle
tail (`hydrogen_orbitals3d`, `05_trajectory`), and backend 5 removes the sort from that path
anyway. Mesh upload is a later optimisation, not part of this scope.
