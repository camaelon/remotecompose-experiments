# rcX

A C++ player and tooling for a compact binary UI / canvas format.

`rcX` reads a binary document — a stream of opcodes describing layout,
canvas drawing, expressions, animations, particle systems, paths, shaders
and bitmaps — and renders it interactively. The same document can play on
desktop, on iOS, headlessly to PNG, or be inspected as JSON.

```
   .rc / .rcd  →  rccore  →  rcskia (Skia)  →  pixels
                        ↘  rc2json (debug)
```

## Status

Pre-1.0. The macOS desktop pipeline (engine + Skia bridge + GLFW viewer +
headless tools) is solid. Linux builds the same desktop tools and a CPU/OpenGL
viewer. The iOS pipeline (static libs + SwiftUI app with a Metal-backed Skia
view) is solid for arm64 device builds. See
[docs/PROGRESS.md](docs/PROGRESS.md) for milestone-by-milestone status.

Windows is not in this tree yet; the engine itself is portable C++17.

## What's in here

```
rcX/
├── lib/
│   ├── rccore/      Engine — wire format, document model, expressions,
│   │               layout, paint state, time variables, particles, etc.
│   └── rcskia/      Skia bridge — implements the engine's PaintContext
│                   abstraction on top of SkCanvas.
├── apps/
│   ├── viewer/      `rcviewer` — GLFW + Metal/CPU desktop viewer.
│   │               Loads .rc/.rcd, animated images (WebP/GIF/APNG),
│   │               video (MP4/MOV via AVFoundation), and zip decks.
│   └── iosViewer/   SwiftUI iOS / iPadOS app, MTKView + Skia-Ganesh-Metal.
├── tools/
│   ├── rc2json/     Lossless binary → JSON dumper. Useful for diffing
│   │               document changes and validating writers.
│   └── rc2image/    Headless renderer: .rc → PNG. Used by smoke tests.
├── ios/             CMake setup that builds rccore + rcskia + Skia for
│                   iOS arm64, producing static libs the iOS app links.
├── samples/         A handful of representative .rc files for smoke
│                   testing and demos.
└── docs/            Architecture, protocol notes, milestone progress.
```

## Quick start (macOS / Linux)

```sh
# Configure + build. Skia and miniz are auto-fetched by CMake.
cmake -B build
cmake --build build -j

# Render a sample headlessly.
./build/tools/rc2image/rc2image samples/canvas.rc out.png

# Run the interactive viewer against a sample.
./build/apps/viewer/rcviewer samples/balls_animation_example.rc
```

The first `cmake -B build` takes a couple of minutes — Skia (~150 MB pre-built)
is downloaded once into `build/_deps/skia-src/` and reused thereafter.

On Linux, install CMake, git, pkg-config, GLFW, OpenGL, FontConfig, FreeType,
and X11 development packages first. The Linux viewer uses the CPU backend;
`--metal` and AVFoundation video formats remain macOS-only.

## Profiling the 3D path

`RC_PROF=1` splits a render into its CPU geometry front-half and its fill, and reports the
painter's sort separately. Silent unless the variable is set, and the rendered output is
byte-identical either way.

```sh
RC_PROF=1 ./build/tools/rc2image/rc2image doc.rc out.png 800 800
```

```
RC_PROF  triangles submitted=6060 kept=4908
RC_PROF  software   transform     0.99 ms (  8.2%)   fill    11.14 ms ( 91.8%)
RC_PROF  accelerated front-half (buildCanvasVertices)     0.00 ms   of which sort     0.00 ms
```

Reading it: transform scales with triangle count and is flat in resolution; fill scales
with covered pixels. Which dominates is a property of the document, not of the engine —
`city3d` is 98% fill at 1,728 triangles, while `hydrogen_orbitals3d` at 33k triangles is
70% transform. The crossover sits near 15–20k triangles at 800px. Measure before optimising;
the intuition here has been wrong more than once.

The transform figure includes two clock reads per triangle, on the order of 0.3 ms per 6k
triangles, so read small absolute values as an upper bound. Ratios and scaling are sound —
for per-triangle cost, vary the input and take the slope.

## iOS build

```sh
# Build the iOS static libraries (rccore + rcskia + libskia) for arm64 device.
(cd ios && ./build.sh)

# Build the SwiftUI app. xcodegen is installed via brew on first run.
(cd apps/iosViewer && ./build.sh)
```

Open `apps/iosViewer/iosViewer.xcodeproj` in Xcode, pick a real device or
arm64 Simulator slice, set a signing team, and ⌘R.

See [BUILDING.md](BUILDING.md) for the full per-platform walk-through and
common-pitfall list.

## License

Apache 2.0. See [LICENSE](LICENSE).
