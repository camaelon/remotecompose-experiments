# Changes made to the androidx reference

The 3D reference engine is a CL still in review, and this repo's players are ports of it.
Where the reference is wrong, we fix it *here* first — in the androidx working copy, the
C++ player and the TypeScript player together — then send the change upstream. This file
is the running list of what has been changed in the androidx tree so nothing is lost when
those changes come back as an update.

Each entry records the file and site touched, so a later merge can be checked rather than
guessed at.

Working copy: `/Users/john/code/androidx-main2/frameworks/support/compose/remote`.
The oracle copies its sources from there via `players/3d-oracle/fetch-reference.sh`, so a
change is not live in the parity harness until that script is re-run.

---

## 1. Solve the triangle depth plane in double — 2026-08-25

**Status:** applied in all three; **awaiting upstream approval**.

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
