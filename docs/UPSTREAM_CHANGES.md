# Changes made to the androidx reference

The 3D reference engine is a CL still in review, and this repo's players are ports of it.
Where the reference is wrong, we fix it *here* first — in the androidx working copy, the
C++ player and the TypeScript player together — then send the change upstream. This file
is the running list of what has been changed in the androidx tree so nothing is lost when
those changes come back as an update.

Each entry records the file and site touched, so a later merge can be checked rather than
guessed at.

**The CL of record is 4256202.** CL 4108133 — the one this work was originally tracking —
is being abandoned. Nothing here needs reconciling against it, and its patchsets 21 and 22
are byte-identical in the two files we touched, so nothing of ours is stranded there. The
local androidx checkout keeps a `next3d` branch at 4108133 patchset 21 for reference; the
live branch is `next3d-cl4256202`.

Working copy: `/Users/john/code/androidx-main2/frameworks/support/compose/remote`.
The oracle copies its sources from there via `players/3d-oracle/fetch-reference.sh`, so a
change is not live in the parity harness until that script is re-run.

---

## 1. Solve the triangle depth plane in double — 2026-08-25

**Status: LANDED UPSTREAM.** In CL 4256202 patchset 1, "Fix 3D engine depth cancellation
and quadratic sorting". All four sites widened, with the operands named `dfx1`/`dfy1`/`dfz1`
rather than our `px1`. The CL adds a note we did not: for environments pinned to 32-bit
float, the same cancellation can be avoided with an edge-vector formulation (translate the
triangle to the origin before the cross product) or with `Math.fma`. Worth remembering if
the C++ port ever has to run without doubles.

Local androidx checkout is on branch `next3d-cl4256202` at that patchset, and the oracle is
re-fetched from it. Parity against the official reference: 49/49 scenes, 111/111 documents.

**File:** `remote-player-core/src/main/java/androidx/compose/remote/player/core/platform/d3/Rasterizer.java`
**Sites:** four — `fillTriangle`, `fillTriangleGouraud`, `fillTriangleTextured`,
`fillTriangleDepthOnly`. Each carries its own copy of the plane solve.

**Ported to:**
- `players/cpp/lib/rccore/src/d3/Rasterizer.cpp` — `setup()`, which consolidates all four.
- `players/typescript/src/core/d3/Rasterizer.ts` — `setup()`. This one is a *deletion*:
  the TypeScript had been emulating the reference's float rounding step by step with
  `fround`/`fa`/`fm`, and that emulation exists only to match the defect. It is now a plain
  float64 solve. `fround` is kept on the three stored results, which the reference stores
  as float.

### What was wrong

```java
double d = (fx1 * (fy3 - fy2) - fx2 * fy3 + fx3 * fy2 + (fx2 - fx3) * fy1);
```

`d` is declared `double`, but every operand is `float`, so Java evaluates the whole
expression in float and widens an already-rounded result on assignment. The same is true of
the three numerators below it.

That expression is twice the projected signed area of the triangle. For the sliver
triangles along a grazing silhouette it cancels catastrophically, and `d` is then the
divisor for `dx`, `dy` and `zoff` — the interpolated depth plane.

### Measured

Instrumented `setup()` to reconstruct each triangle's own vertex depths from the plane it
was given, rendering `device-docs/surface_plot3d.rc` at 1400x1400:

| | triangles with plane error > 1e-3 | worst error |
| :--- | ---: | ---: |
| float (as written) | 48 | **12.47** |
| double | 0 | 0.000024 |

The depth range is `[0, 1]`. A plane off by 12.5 is not a rounding difference; that
triangle rasterises at a nonsense depth, loses the depth test to whatever is behind it and
disappears. In `surface_plot3d` this shows as triangular notches bitten out of the surface
wherever it passes in front of a wall — the wall showing through, in clean one-cell wedges.

The independent pixel count agrees with the instrumentation: ~48 notches detected, 48
triangles with a broken plane.

### Effect

| | before | after |
| :--- | ---: | ---: |
| `3d-parity.sh` (49 scenes) | 49 identical | **49 identical** |
| `3d-doc-parity.sh` (111 device-docs) | 110 identical, 1 differing | **111 identical** |
| notches in `surface_plot3d.rc` @1400 | 55 | 15 |

Two things worth noting.

**Parity is unchanged at 49/49 and improves to 111/111** — because all three
implementations were corrected together. Fixing only the ports would have broken parity on
6 scenes and 59 documents; that is not a sign the fix is wrong, it is what happens when a
port stops matching a defect in the thing it ports.

**`lava_lamp3d` now matches.** It had been the one unexplained document-parity failure, a
3-pixel difference recorded as open for weeks. Same root cause.

### Not fixed

A residual ~15 notches survive at 1400x1400, down from 55. Whatever remains is a separate
mechanism: it is unmoved by wall depth bias, by a slope bias, by tightening near/far and by
insetting the surface off the wall plane, all of which bottom out at the same floor. Not
diagnosed.

---

## 2. Replace the quadratic painter's sort — 2026-08-26

**Status: LANDED UPSTREAM.** In the same CL 4256202 patchset 1, taken verbatim including
the stability comment and the `mOrderScratch` buffer on `CanvasMesh`.

**File:** `remote-player-core/.../player/core/platform/d3/JavaPaint3DContext.java`
**Site:** `sortTrianglesBackToFront`, plus a scratch permutation on `CanvasMesh`.

**Ported to:** `players/cpp/.../d3/SoftwarePaint3DContext.cpp` (`sortBackToFront`, using
`std::stable_sort`). TypeScript inherits the ordering from the shared front-half and needed
no change.

### What was wrong

The sort carried an explicit justification:

> *Insertion sort is intentional: triangle counts here are small and meshes tend to arrive
> nearly sorted, so it stays close to O(n) with no allocation.*

Neither premise holds for real content. A height field, or any rotated surface, arrives in
mesh order, which bears no relation to depth order. Measured on the C++ port, which runs the
identical algorithm:

| triangles | front-half | of which sort |
| ---: | ---: | ---: |
| 1,682 | 1.28 ms | 0.83 ms (65%) |
| 6,962 | 14.44 ms | 12.84 ms (89%) |
| 15,842 | 70.68 ms | 66.90 ms (95%) |
| 28,322 | **221.87 ms** | 215.24 ms (**97%**) |

Nearly-sorted input would have cost about 1 ms at 28k. The assumption is refuted by
measurement, not merely unproven.

This is on the `CANVAS` and `DRAWMESH_ZBUF` paths — the accelerated ones — so it is CPU
time paid before the GPU is handed anything.

### The change

Bottom-up merge sort: O(n log n), stable, and still allocation-free per frame because the
scratch permutation is reused from `CanvasMesh` alongside `mOrder`. Stability is retained
deliberately — an unstable order lets coplanar triangles swap between frames and flicker,
which is what the original was protecting.

215 ms → 2.49 ms at 28k triangles, **86x**.

### Effect

Same comparator, same stability, so the permutation is identical and the render is
unchanged. `3d-parity.sh` 49/49 and `3d-doc-parity.sh` 111/111, bit-exact across the change
in both the Java oracle and the C++ port.

---

## Reported, not changed

Things found in the same investigation that we have **not** touched, either because they
sit outside what our harness can verify or because they are calls for the team to make.

### A. `flushZBufScene` allocates and boxes per frame

`AndroidPaintContext.flushZBufScene` allocates four arrays per flush and sorts an
`Integer[]` through a comparator, so every triangle in the scene is boxed — 28k `Integer`
objects per frame on a large mesh, plus the garbage. The sort is at least O(n log n), so
this is pressure rather than a complexity bug.

Not changed here: `AndroidPaintContext` is Android-platform code and is not among the files
`3d-oracle/fetch-reference.sh` copies, so we cannot verify a change to it with the parity
suites. Flagging rather than guessing.

### B. Backend ids 3 and 5 are used by the ports but undefined upstream

`remote-core/Paint3DContext.java` defines modes 0-5 and 8-9, i.e. backends 0, 1, 2 and 4.
The C++ and TypeScript ports additionally define `MODE_GL_*` (backend 3) and
`MODE_CANVAS_ZBUF_*` (backend 5). We would like to keep those two ids for a GL backend and
a genuinely depth-buffered one. Worth confirming before upstream allocates the same numbers
for something else.

Related: C++ `Paint3DContext.h` defines `MODE_CANVAS_ZBUF_FLAT/SMOOTH` but no
`MODE_BACKEND_CANVAS_ZBUF = 5` constant, while TypeScript has both. Ours to tidy.

### C. `DRAWMESH_ZBUF` is a global painter's sort, not a depth buffer

Not a defect — the implementation is deliberate and its doc comment says so — but the name
misleads, and it cost us a wrong assumption when scoping. It also means the backend
inherits every painter's-algorithm failure, including the depth-tie class behind change 1.
A note in `Paint3DContext.java` naming it a cross-mesh painter's sort would save the next
reader.

### D. The surface-plot demo has a 1000:1 depth range

`DslSurfacePlot3D.kt` uses `near = 0.1f, far = 100f` for a scene about 3 units across.
Almost the entire depth range is spent in front of the geometry. In a synthetic replica,
tightening to a 20:1 range cut the residual notch count from 48 to 9 independently of
change 1. A demo fix rather than an engine one, but it is the document the artifact is most
visible in.
