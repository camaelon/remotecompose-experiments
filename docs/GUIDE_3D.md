# 3D in RemoteCompose

The format has a small software 3D pipeline inside a canvas: a camera, directional or point
lights, meshes built by the player from a few numbers (a cube, a sphere, a torus...) or from
expressions, a model matrix you build with translate / rotate / scale, and a draw that shades,
depth-tests and composites the mesh. Use it for things that are 3D: a product to turn round, how
parts go together, a shape the reader should see from several sides. Don't use it for anything
a flat drawing says as well (a bar chart, an icon, a diagram).

**Where it plays.** 3D support has not landed in androidx yet (coming). Today it plays in the
C++ player (rc2image, the MCP renders) and the TypeScript player (the web player, published
pages, the inspector), which agree pixel for pixel. The Java JSON parser drops the 3D
operations, so a 3D document has no Java byte check. Don't use 3D for a screen that must play
on Android today.

**Most of the time, call `Scene3D`.** You list parts by shape, size, position and colour; the
server computes the camera, the transforms and the framing, and adds orbiting, autorotate, an
assembly animation and the mono look. Write the ops by hand (the recipe below, DRW-17) only to
learn them or for something Scene3D can't express (a mesh from an expression, a texture).

## Scene3D

```json
{"Scene3D": {
  "label": "A blue cube on a grey slab",
  "objects": [
    {"shape": "box", "size": [2, 0.2, 1.2], "color": "@colors.outline"},
    {"shape": "box", "size": 0.6, "at": [0, 0.4, 0], "color": "@colors.primary"}
  ]}}
```

- **Units are yours** (metres, cm): the camera adapts. Y is up, X right, Z toward the viewer;
  `at` is the centre of the part's box.
- **Shapes:** `box` (size [w, h, d]; `"round": r` rounds its edges), `sphere` (size = diameter,
  or [x, y, z] for an ellipsoid), `cylinder` and `cone` (size [diameter, height]; a cone's apex
  points up its axis), `torus` (size [outer diameter, tube thickness], lying flat), `plane`
  (size [w, d], lying flat, seen from above only). Aliases: cube, ball, disc, rod, ring, donut,
  floor.
- **Turning a part:** `"axis": "z"` points a round shape's axis at the viewer (a speaker cone, a
  wheel), `"x"` sideways, `"-y"` upside down; `"rotate": [rx, ry, rz]` in degrees for anything
  else (Y first, then X, then Z).
- **Colour:** theme colours (`@colors.primary`, `secondary`, `success`, `warning`, `error`,
  `muted`, `outline`, `shadow`, `highlight`) or a document colour with a light and a dark value
  in `resources.colors` (`"walnut": {"light": "#FF8D5B3A", "dark": "#FFB07A52"}`). A part with
  no colour takes the next of primary, secondary, success, warning, muted.
- **The view:** `spin` (degrees round the vertical, default -30: the front and the right side)
  and `tilt` (degrees looking down, default 20). `orbit` (default on): a drag spins and tilts the
  scene and coasts to a stop; tilt stays in `tiltRange` (default [-5, 50]).
- **Motion:** `autorotate: 20` turns it 20 degrees a second (a turntable). `assemble: true`
  flies each part in from its `from` offset ([dx, dy, dz] from its place; default: away from
  the centre), one `step` after another (parts with the same step move together), holds the
  whole for `hold` seconds (2.5), flies it apart and repeats; `stagger` is the seconds between
  steps (0.45). Both repaint every frame while shown.
- **Look:** `light` "studio" (default: a key light from the upper left, a cool fill), "soft"
  or "flat"; `style` "solid", "outlined" (edges in lineColor over the faces) or "wireframe";
  `floor: true` puts a disc under it; `background` defaults to `@colors.background`.
- **Overlay:** the `overlay` slot draws nodes over the scene (a title, a caption, a button);
  keep their room with `insetTop` / `insetBottom` (dp) and the scene is framed in what is left.

CMP-35 (a speaker on a turntable) and CMP-36 (a shelf unit assembling) are worked examples;
the component's demo is a ring-stacking toy.

### What the server does for you

- **Framing.** It collects every part's corners (round shapes as a ring of points), plus the
  parts at their start offsets while assembling (`frame`: "auto", "assembled" or "all"), and
  finds the camera distance at which all of them stay inside `fill` (0.9) of the view at every
  spin and every tilt the drag can reach, for any window shape. That is one expression of the
  canvas's aspect, `max(Dv, Z + K * componentHeight() / componentWidth())`, so the same document
  frames a phone, a landscape window and a 2x2 widget. A wider `tiltRange` (or none: `orbit:
  false` with a fixed view frames tightest) leaves the scene smaller.
- **Transforms.** Each part's chain: identity, tilt about X, spin about Y (both about the
  scene's centre), its translate (plus offset times its eased step factor), its own rotations
  and scale.
- **Meshes.** One `meshPrimitive3D` per distinct shape and size, shared by parts that match.

## The recipe by hand (DRW-17)

One canvas that fills the window, then in its `commands`:

```json
{"header": {"apiLevel": 7, "width": 360, "height": 640, "profiles": 513},
 "root": {"canvas": {"modifiers": ["fillMaxSize", {"background": "@colors.background"}], "commands": [
  {"touchExpression": {"name": "spinPx", "defaultValue": 0, "min": -100000, "max": 100000, "stopMode": "gently", "expression": "touchX()"}},
  {"touchExpression": {"name": "tiltPx", "defaultValue": 0, "min": -100, "max": 100, "stopMode": "gently", "expression": "touchY()"}},
  {"variable": {"name": "spin", "value": "@spinPx * 0.01 - 0.4"}},
  {"variable": {"name": "tilt", "value": "@tiltPx * 0.006 + 0.6"}},
  {"variable": {"name": "dist", "value": "5.6 * max(1, componentHeight() / componentWidth())"}},
  {"clearDepth3D": {}},
  {"camera3D": {"projection": "perspective", "fovY": 0.6, "aspect": "componentWidth() / componentHeight()",
                "near": 0.1, "far": "@dist + 3", "eye": [0, 0, "@dist"], "center": [0, 0, 0], "up": [0, 1, 0]}},
  {"lights3D": {"lights": [
    {"type": "directional", "dir": [0.45, -0.7, -0.55], "color": "#FFFFF8F0", "intensity": 0.8},
    {"type": "directional", "dir": [-0.7, -0.15, -0.5], "color": "#FFE8F0FF", "intensity": 0.35}]}},
  {"meshPrimitive3D": {"id": 1, "primitive": "torus", "majorRadius": 1, "minorRadius": 0.38, "center": [0, 0, 0], "segments": 32}},
  {"matrix3D": {"op": "identity"}},
  {"matrix3D": {"op": "rotate", "angle": "@tilt", "axis": [1, 0, 0]}},
  {"matrix3D": {"op": "rotate", "angle": "@spin", "axis": [0, 1, 0]}},
  {"paint": {"ops": [{"color": "@colors.primary"}]}},
  {"drawMesh3D": {"mesh": 1, "mode": "smooth"}}
 ]}}}
```

- **clearDepth3D** first: it starts a fresh depth buffer for the frame.
- **camera3D:** `perspective` with `fovY` in radians (0.6 is a gentle lens; `orthographic` takes
  left/right/bottom/top), `aspect` = componentWidth() / componentHeight(), `eye` / `center` /
  `up`. Fields take expressions. Frame for the narrow side: `d * max(1, componentHeight() /
  componentWidth())` moves the eye back as much as a portrait window narrows the view.
- **lights3D:** up to a few `directional` lights (`dir` is the way the light travels: from the
  upper left, in front: [+x, -y, -z]) or `point` lights (`pos`), each with a colour and an
  intensity. Shading is the paint colour times 0.2 ambient plus each light's |N.L| times its
  intensity (two-sided), clamped: keep the sum near 1.2 or light colours wash out to white.
  `material3D {specular, shininess}` adds a white highlight.
- **meshPrimitive3D:** an id and a primitive with its named parameters: `cube` (dimX, dimY,
  dimZ, center), `roundedCube` (+ cornerRadius), `sphere` (radius, center), `icosphere`,
  `cylinder` (radius, from, to: any axis), `cone` (radius, height, center = the base, apex up),
  `torus` (majorRadius, minorRadius, center; lies in XZ), `plane` (width, height: lies in XY,
  facing +Z), `sphericalDome`, `sphericalSector`, `extrudeCircle` / `extrudeRoundedRect` /
  `extrudeSquircle` / `extrudeArc` / `extrudeSector` / `extrudeSegment` / `extrudePath`
  (outlines extruded along Z), `lathe` (a profile turned round Y), `tube` / `capTube` /
  `profileTube` / `sweep` / `helix` (along a path). `segments` sets the smoothness. The player
  builds the triangles: the document carries only the numbers (about 20 to 40 B a mesh).
  `meshExpression3D` makes a surface from expressions of u and v (a height field, a displaced
  sphere); `defineMesh3D` takes raw vertices and indices (expensive: 4 B a number).
- **matrix3D:** `identity`, `translate` {x, y, z}, `scale` {x, y, z}, `rotate` {angle (radians),
  axis}, `multiply` {m: 16 floats}. Each post-multiplies the model matrix, so the op nearest the
  draw acts first on the mesh. Every op needs `op`.
- **paint** colour, then **drawMesh3D** {mesh, mode}: `flat` (one shade a face: boxes) or
  `smooth` (Gouraud: round shapes). `wireframe: true` draws hidden-line edges instead, in the
  paint colour; `edges: [0, 1]` draws a primitive's quads without their diagonals.
  `depthBias3D` offsets depth (lines over a face).

**Drag to orbit:** two `touchExpression`s on touchX() and touchY() with `stopMode: "gently"`
accumulate the drag in dp and coast after release; scale them to radians (0.01 a dp for the
spin, 0.006 for the tilt) and clamp the tilt with the touch's `min` / `max` (in dp of drag).

**Animation:** angles and positions are expressions. A turntable is `(continuousSec() % 18) *
0.349` added to the spin. An assembly step is `smooth_step(t, end, start)` (note the order: the
value, then the upper edge, then the lower) over `t = continuousSec() % period`, times the
part's offset in its translate. `continuousSec()` repaints every frame for as long as the
document is shown.

## Mono

Mono (always-on and e-ink) wants no gradients and few lit pixels: draw a hidden-line wireframe
in `@colors.onSurface` instead of a lit fill, and no motion. In a hand-written document, choose
in the commands:

```json
{"$if": "theme.mono",
 "then": [{"paint": {"ops": [{"color": "@colors.onSurface"}]}},
          {"drawMesh3D": {"mesh": 1, "wireframe": true, "edges": [0, 1]}}],
 "else": [{"paint": {"ops": [{"color": "@colors.primary"}]}},
          {"drawMesh3D": {"mesh": 1, "mode": "smooth"}}]}
```

One mesh hides its own back lines. With several meshes, also fill each one with
`@colors.background` before its wireframe, lit by lights that saturate (three axis lights of
0.85: every face comes out exactly the background colour), so a nearer part hides the lines
behind it. Scene3D does all of this, drops autorotate and assembly in mono, and uses fewer
segments so the lines stay apart.

## Sizes, bytes and time

- **Window:** the players draw 3D into a buffer the size of the whole window and composite it
  at the canvas's origin under the live 2D transform (the reference's drawBitmap at 0, 0). A
  3D canvas placed naively in a column or a card comes out off-centre and spills past its box.
  Scene3D avoids this by filling the window and putting text over it (overlay and insets).
  Chart3D shows how to put 3D in part of a layout: before the 3D draws, `translate` by
  `((componentWidth() - windowWidth()) / 2, (componentHeight() - windowHeight()) / 2)` so the
  buffer's centre lands on the canvas's centre, and widen the field of view by
  `windowHeight() / componentHeight()` so the canvas, not the window, gets the framing. The
  picture still is not clipped to the canvas: keep the model inside its framing.
- **Bytes:** Scene3D costs about 800 B for the scene (camera, lights, orbit) plus about 90 B a
  part (160 B when it assembles, about 35 B more for each distinct mesh). DRW-17 is 1.0 KB;
  CMP-35 (7 parts, autorotate, floor) 3.3 KB; CMP-36 (11 parts, assembly) 3.8 KB. Theme colours
  cost their usual ~100 B each.
- **Time:** every part is rasterised in software every frame. At 1080 x 1920 (density 3) the
  C++ player takes about 3 ms a frame for one torus, 18 ms for CMP-35 and 23 ms for CMP-36; the
  TypeScript player in Node about 6, 34 and 38 ms (it composites the window-sized buffer after
  every mesh). Keep to about 30 parts, prefer boxes (12 triangles) to spheres and tori (300 to
  600), and use motion only when it explains something.

## Limits

- `matrixSave` / `matrixRestore` do not save the 3D matrix in either player: start every
  object's chain again with `identity`.
- 3D in a part of the layout needs the translate and field-of-view adjustment (see Window
  above). No shadows, no transparency between meshes,
  no per-face colours on a primitive (one paint colour a draw), lines are one pixel wide.
- Text can't be placed in 3D; label parts with an overlay or a legend.
- A `plane` is single-sided; use a thin box for a panel seen from both sides.
- `continuousSec()` keeps the document repainting; there is no "animate once and stop" for an
  assembly short of driving it from an animated value.
- Lights are in world space: they do not turn with the model when you orbit it by turning the
  model. Turn the camera instead if the light should stay on the same faces.
- The depth test is a strict `<`: of two draws at equal depth the first wins. Draw the part that
  should show on a tie first (Chart3D's colour bands are drawn lowest first for this reason).
- `plane` ignores `segments` in both players.
- Each mesh draw composites the whole window buffer once, so draws are the cost at render time:
  draw many data points with one unit mesh in a loop over float arrays, not one draw each.
- A slider's live value is its own variable only from the slider on, in document order: put
  the 3D canvas that reads it after the slider.

## Hidden-line wireframe (mono)

The software wireframe draw does its own front-face depth prepass, so a wireframe drawn alone
already hides its back lines; draw it with no depth bias. A negative `depthBias3D` around it is a
trap: the prepass then writes depth biased toward the eye, and later draws close to that surface
disappear even after the bias is reset (C++ player, `SoftwarePaint3DContext.cpp`
`drawMeshWireframe`; found building SHW-20). Fill the mesh in the background colour first only if
something behind it must be hidden too. `edges: [0, 1]` on a height field draws the cell sides
without the diagonals.
