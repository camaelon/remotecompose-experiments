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
headless tools) is solid. The iOS pipeline (static libs + SwiftUI app with a
Metal-backed Skia view) is solid for arm64 device builds. See
[docs/PROGRESS.md](docs/PROGRESS.md) for milestone-by-milestone status.

Linux and Windows ports are not in this tree yet; the engine itself is
portable C++17, but `rcskia` and the apps still assume Apple frameworks for
font discovery and platform glue.

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

## Quick start (macOS)

```sh
# Configure + build (Skia, GLFW, miniz are auto-fetched by CMake).
cmake -B build
cmake --build build -j

# Render a sample headlessly.
./build/tools/rc2image/rc2image samples/canvas.rc out.png

# Run the interactive viewer against a sample.
./build/apps/viewer/rcviewer samples/balls_animation_example.rc
```

The first `cmake -B build` takes a couple of minutes — Skia (~150 MB pre-built)
is downloaded once into `build/_deps/skia-src/` and reused thereafter.

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
