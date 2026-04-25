# rcX Architecture

A high-level walkthrough of the engine and how the pieces fit together.

## What problem this solves

A binary document format that:

- describes a UI / canvas scene declaratively (layout, paint state, draw
  commands, expressions, animations, particle systems, paths, shaders, bitmaps),
- decodes and renders inside a small native runtime,
- behaves identically across platforms (macOS desktop, iOS, headless render).

This repository contains the C++ implementation: an engine, a Skia rendering
bridge, two command-line tools (`rc2json`, `rc2image`), and an interactive
desktop viewer (`rcviewer`).

## Layered design

```
                 ┌─────────────────────────────────────────────┐
   app layer    │  rcviewer (GLFW)        iosViewer (SwiftUI)  │
                 │  rc2image / rc2json                          │
                 └─────────────────────────────────────────────┘
                                       │
                 ┌─────────────────────────────────────────────┐
   bridge       │  rcskia — SkiaPaintContext (implements       │
                 │            PaintContext on top of SkCanvas)  │
                 └─────────────────────────────────────────────┘
                                       │
                 ┌─────────────────────────────────────────────┐
   engine       │  rccore — WireBuffer, CoreDocument,          │
                 │           RemoteContext, PaintContext (abstract),│
                 │           Operations, ExpressionEvaluator,   │
                 │           Layout system, TimeVariables, ...  │
                 └─────────────────────────────────────────────┘
                                       │
                                  binary file
                                  (.rc / .rcd)
```

Each layer talks only to the layer below it. The engine has no Skia
dependency: it speaks to the abstract `PaintContext` interface. The bridge
provides `SkiaPaintContext`, but a different bridge (e.g. Vulkan or
software) could replace it without touching the engine.

## Engine modules (`lib/rccore/`)

| File                                | Role                                         |
|-------------------------------------|----------------------------------------------|
| `WireBuffer.{h,cpp}`                | Byte-stream reader/writer over the binary format. |
| `Operations.{h,cpp}`                | Master opcode → reader registry.             |
| `OpcodeRegistry.{h,cpp}`            | Wires registered ops into the read loop.     |
| `CoreDocument.{h,cpp}`              | Top-level document. Owns the operation tree, runs the two-pass DATA + PAINT execution, and provides public entry points (`initFromBuffer`, `paint`, `touchDown` …). |
| `RemoteContext.{h,cpp}`             | Per-render mutable state — current paint, transform stack, variable values, density, dimensions. Threaded through every op's `apply`. |
| `PaintContext.h`                    | Abstract drawing interface. Implemented by `rcskia`. |
| `PaintBundle.{h,cpp}`               | Decoder for the packed paint-state record (color, gradient, blend mode, typeface, …). |
| `ExpressionEvaluator.{h,cpp}`       | Stack-based RPN evaluator for `FloatExpression`, `IntegerExpression`, `BooleanExpression`, `ColorExpression`, etc. ~40 operators (arithmetic, trig, logic, comparisons, array ops, system variables). |
| `TimeVariables.{h,cpp}`             | Updates time-derived float variables every frame (animation time, delta time, wall-clock components). |
| `Utils.{h,cpp}`                     | NaN-encoded variable IDs, helpers, byte-order. |
| `operations/`                       | Per-opcode classes — Header, Draw* primitives, Layout components (`RootLayoutComponent`, `BoxLayout`, `ColumnLayout`, `RowLayout`, `CanvasLayout`, `CoreText`, …), modifiers (`WidthModifier`, `BackgroundModifier`, `BorderModifier`, `PaddingModifier`, `OffsetModifier`, …), ParticlesCreate/Loop/Compare, Path operations, Data ops (TextData, BitmapData, FloatConstant, ShaderData), and update / interpolation operations. |

### Two-pass execution

Each frame, `CoreDocument::paint(context)` runs:

1. **DATA pass**: re-evaluates dirty data ops (`FloatExpression`, time
   variables, conditional/loop bodies). Updates the variable map in
   `RemoteContext`.
2. **PAINT pass**: walks the op stream, dispatching `apply(context)`. Layout
   components measure first (if needed) then render. Drawing ops issue calls
   into the `PaintContext` abstraction.

This split lets the engine cache layout when nothing changes and re-evaluate
only the parts driven by animation or input.

### Layout system

Mirrors Compose-style intrinsic-size + measure-position. The
`RootLayoutComponent` walks the tree top-down, asking each layout to measure
itself given parent constraints, then position its children. Modifiers
(`WidthModifier`, `PaddingModifier`, `BackgroundModifier`, …) wrap a
component and intercept measure / paint. `LayoutCompute` allows
expression-driven layout tweaks.

### Paint state

Paint state is communicated as a `PaintBundle` — a packed record decoded by
`PaintBundle.cpp`. Fields cover stroke vs fill, color, gradient definitions,
blend mode, alpha, typeface, text size, stroke width / cap / miter, shader
references, etc. Many fields support NaN-encoded variable IDs so painting
parameters can be expression-driven.

### Expressions

`FloatExpression` is the workhorse. RPN tokens are encoded inline; constants
are floats and variable references are NaN-encoded float IDs. The evaluator
supports arithmetic, trig, logic, comparisons, splines, springs, array
operations, and reads from system variables (`ANIMATION_TIME`,
`WINDOW_WIDTH`, `TOUCH_X`, …) provided by `RemoteContext`.

### Particles

`ParticlesCreate` allocates a per-particle state vector and seeds initial
values via embedded RPN expressions. `ParticlesLoop` runs an expression
batch over each particle every frame (advancing position, lifetime, color
…). `ParticlesCompare` filters particles based on an RPN predicate. The
container ops use the same expression evaluator and variable map as the
rest of the engine.

## Bridge (`lib/rcskia/`)

`SkiaPaintContext` implements `PaintContext` on top of `SkCanvas`. It maps
engine paint state into `SkPaint` configuration, dispatches engine draw
calls (`drawCircle`, `drawRect`, `drawArc`, `drawTextAnchored`, …) to Skia,
and handles transform and clip stack management.

The bridge keeps no rendering state of its own — `RemoteContext` is the
authoritative state container; the bridge translates its current paint
into Skia for each draw call.

## Tooling

- **`rc2json`** — recursive deflate of the binary into structured JSON. The
  output is round-trippable through a writer (round-trip is currently
  validated against the Java reference writer). Useful for diffing changes
  to a writer's output, validating new ops, and debugging.
- **`rc2image`** — instantiates `CoreDocument`, paints into a Skia raster
  surface at fixed dimensions, encodes to PNG. Used as a smoke test in CI
  and as a source for visual-regression comparisons.

## Apps

- **`apps/viewer/`** — `rcviewer`, a GLFW-based desktop viewer. Loads a
  `.rc`/`.rcd` file, an animated image (WebP/GIF/APNG), a video, or a zip
  archive of mixed content, and plays through the contents with keyboard
  navigation. Has Metal and CPU render backends.
- **`apps/iosViewer/`** — SwiftUI iOS app. `RCMetalRenderer` is an
  Obj-C++ bridge that wires `CoreDocument` + `SkiaPaintContext` into a
  `MTKView` via Skia's Ganesh-Metal context. Slides paint directly into the
  drawable's texture every frame; no CPU pixel readback. Supports both `.rc`
  files and zip decks (via `ZIPFoundation`).

## Where to start reading

- **Wire format**: `lib/rccore/src/WireBuffer.cpp` and the operation classes
  under `lib/rccore/src/operations/`.
- **The render loop**: `CoreDocument::paint` (`lib/rccore/src/CoreDocument.cpp`).
- **An operation end-to-end**: pick a simple one like `DrawRect`
  (`lib/rccore/include/rccore/operations/DrawRect.h`) and trace
  `read` → `apply(context)` → `context->getPaintContext()->drawRect(...)` →
  `SkiaPaintContext::drawRect(...)` → `SkCanvas`.
- **Expressions**: `ExpressionEvaluator.cpp` — the `evalRPN` switch is the
  authoritative list of operators.
