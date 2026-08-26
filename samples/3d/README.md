# 3D samples

Ten charts, each leaning on a different corner of the 3D opcode surface, in both the JSON
that authored them and the `.rc` the players read.

They exist to be *diagnostic*: if one of these stops rendering, the file that broke says
which part of the engine broke. They are deliberately not ten variations on one technique.

| document | what it exercises |
| :--- | :--- |
| `01_scatter` | `meshPrimitive3D` icosphere instanced under per-object matrices |
| `02_surface` | `meshExpression3D` heightField driven by `continuousSec()` — the only animated one |
| `03_wireframe` | `wireframe: true`, hidden-line removal against a shaded pass at the same depth |
| `04_bars` | cube instancing; static geometry, so any frame change is input-driven |
| `05_trajectory` | ~470 instances (94 KB) — the throughput case |
| `06_waterfall` | eleven single-strip height fields offset in z |
| `07_contour` | `step()` quantisation into stacked slabs |
| `08_histogram` | binned data as cubes, skipping empty cells |
| `09_quiver` | cones aimed by two `matrix3D` rotations — the axis/units case |
| `10_voxel` | a genuine f(x,y,z) density, not a height field |

## Two techniques all ten share

Both are taken from `DslSurfacePlot3D.kt` in androidx
(`integration-tests/player-view-demos/.../dsl/d3/`), which is the reference for how a chart
of this kind should sit and move.

**The enclosing box.** A floor plus all four side walls, each rotated to face *inward*.
Backface culling then picks which you see: at any spin the two behind the data survive and
the two in front are dropped. Drawing two and choosing them from the current angle has to
make that choice in expression space every frame, and pops as a corner crosses the view
direction. Culling makes the correct pair fall out for free.

**The orbit.** The same identity/tilt/spin triple is emitted before *every* drawn object, so
the scene turns as one rigid body while the camera stays put. Rotating the camera instead
would need the eye recomputed in expression space and would swing the lights across the data
as it turned; rotating the model keeps the lighting fixed relative to the viewer, which is
what keeps a surface readable while it moves. Tilt is applied before spin — reversed, the
spin axis is itself tilted and dragging sideways corkscrews the chart.

## Drag to orbit

Rotation comes from `TouchExpression` (op 157), not from a plain expression over `touchX()`.
The difference is that this op **integrates**: it carries the value across drags, clamps it,
and coasts to a stop on release. A bare `touchX()` tracks the finger's absolute position, so
it jumps when the finger lands and stops dead the moment it lifts.

The op's value is in **pixels of travel**, converted to radians by whoever reads it, so the
tilt clamp is expressed as a pixel range derived from the angle limits — the op can only
clamp its own value:

```json
{"touchExpression": {"name": "spinPx", "defaultValue": 0.0,
                     "min": -100000.0, "max": 100000.0,
                     "stopMode": "gently", "expression": "touchX()"}}
```

read back as `"spinPx * 0.012 + 0.62"`.

`players/typescript/dragtest.mjs` verifies this against the real touch channel; all ten pass.
Note what that test had to become: a single run proved nothing, because the clock advances
every frame and any animated document changes on its own — it needs a dragged run compared
against an idle one on a pinned clock. And "the value persisted after release" is not the
discriminator it appears to be, since `touchX()` also retains its last value; only the
accumulating op *keeps moving*.

## Two traps these documents were built around

Both look correct at the authored size and only at that size, which is why they survived a
desktop pass and were caught on a phone:

- **The background rect uses `componentWidth()`/`componentHeight()`, not the declared
  size.** Hardcoded to 340×340 it painted a small square in the corner of a phone screen and
  left the rest of the 3D drawing on the system background.
- **`aspect` comes from the live viewport, and the camera distance is scaled by
  `max(1.0, componentHeight()/componentWidth())`.** A baked `aspect: 1.0` stretches the scene
  vertically on a tall canvas; correcting only the aspect fixes the stretch but not the
  framing, because a portrait viewport has a narrower horizontal field for the same `fovY`.

## Viewing them

```sh
# C++ — still frame, or the interactive viewer (drag works there)
players/cpp/build/tools/rc2image/rc2image samples/3d/04_bars.rc out.png 340 340
players/cpp/build/apps/viewer/rcviewer   samples/3d/04_bars.rc

# TypeScript, headless. Use render-tex.mjs, not render.mjs, for anything textured:
# render.mjs stubs out bitmap loading and textures come back flat grey.
cd players/typescript
node render-tex.mjs ../../samples/3d/04_bars.rc out.png --width 340 --height 340

# In a browser, with drag
bash players/typescript/packaging/build-viewer.sh
# then serve the directory over http and open rc-viewer.html?url=samples/3d/04_bars.rc
# — from file:// every document has an opaque origin and ?url= fetches are blocked.
```

All ten render under both the C++ and TypeScript players, and on device against
androidx-main2.

## About the JSON

The `.json` files are the authored source; the `.rc` files are what the players read.

**The converter is not in this repository.** These were produced by `rcj`, the Python
JSON→rc converter in the sibling `rcJson` repo (`tools/mk_charts3d.py` generates the JSON,
`rcj/` converts it). So the `.json` here is documentation and a diffable record of intent —
editing it will not change the `.rc` beside it.

Worth knowing if you read the JSON: **this part of the dialect is not a port.**
`RemoteComposeJsonParser` in androidx has no 3D support in either tree — it silently drops
every 3D command — so unlike the rest of the JSON dialect there is no upstream syntax to
mirror and no byte-identical target. For these opcodes `rcj` is the reference, and the wire
bytes are validated by what the players read back. Run the JSON through the Java parser and
you get a few hundred bytes of header and nothing else.

Two syntax notes that cost real debugging time:

- **`matrix3D`'s `rotate` takes radians**, not degrees — the op is
  `rotateAxis(m, angleRadians, x, y, z)`. `09_quiver` was originally built with
  `math.degrees(...)`, which multiplied every angle by 57.3 and aimed the whole field at
  nothing in particular. It also needs `π/2 − elevation` rather than `elevation`, because
  the `cone` primitive's axis is +Y; fixing the units alone left the field standing to
  attention.
- **The op name goes in an `"op"` key.** `{"matrix3D": {"translate": [x, y, z]}}` used to be
  treated as identity in silence, stacking every instance at the origin — which reads as a
  camera or data fault rather than a syntax one.
