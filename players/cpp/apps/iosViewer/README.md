# iosViewer

iOS / iPadOS viewer that mirrors the feature set of `rcviewer` (the macOS
desktop app under `apps/viewer/`): zip-archive decks of `.rc`/`.rcd` slides
interleaved with video files, swipe / keyboard / toolbar navigation,
auto-hide chrome, and a Metal-backed Skia render path with no per-frame
pixel readback.

## Prerequisites

1. Xcode 15+ with Command Line Tools (`xcode-select --install`). Deployment
   target is iOS 17.0.
2. Homebrew (for `xcodegen`, auto-installed by `build.sh` on first run).
3. The rcX iOS static libraries built:
   ```sh
   (cd ../../ios && ./build.sh)
   ```
   That produces `ios/output/lib/{librccore.a,librcskia.a,libskia.a}` and
   the corresponding headers. Builds are **arm64-only** (device or arm64
   Simulator slice — not x86_64 Simulator).

## Build

```sh
./build.sh
```

The script generates `iosViewer.xcodeproj` from `project.yml` and runs
`xcodebuild` for a generic iOS device. Override the destination or config:

```sh
DEST='platform=iOS Simulator,name=iPad Pro (11-inch)' CONFIG=Debug ./build.sh
```

## Run

After `build.sh` has run once, open the project in Xcode:

```sh
open iosViewer.xcodeproj
```

Pick a real device (or arm64 Simulator slice) and ⌘R. The empty-state
screen offers "Open deck…" — pick any `.zip` deck or single `.rc` file
from Files / iCloud Drive / AirDrop.

## Layout

```
iosViewer/
├── project.yml            xcodegen spec (source of truth for the project)
├── build.sh               generate project + build
├── iosViewer/
│   ├── iosViewerApp.swift       @main entry
│   ├── ContentView.swift        empty-state + file importer
│   ├── Models/
│   │   ├── Slide.swift               enum Slide { .rc(URL, Data) | .video(URL) }
│   │   ├── Deck.swift                ordered slides, owns the temp dir
│   │   └── DeckLoader.swift          async unzip via ZIPFoundation
│   ├── Presenter/
│   │   ├── PresenterView.swift       swipe / keyboard / toolbar nav
│   │   ├── RCSlideMetalView.swift    MTKView-backed RC slide (Metal)
│   │   ├── VideoSlideView.swift      AVPlayer + AVPlayerLayer, looped, muted
│   │   └── PresentationOverlay.swift tap-zone overlay for presentation mode
│   ├── Bridge/
│   │   ├── RCMetalRenderer.h         Obj-C interface
│   │   ├── RCMetalRenderer.mm        Skia Ganesh-Metal bridge
│   │   └── iosViewer-Bridging-Header.h
│   └── Assets.xcassets/
```

The project picks up `librccore.a` / `librcskia.a` / `libskia.a` from
`../../ios/output/lib/` and Skia headers from
`../../ios/build/_deps/skia-src/` (the CMake `FetchContent` output of
`ios/build.sh`).

## Modes

- **Regular mode** — toolbar is always visible: slide counter,
  prev / next chevrons, and a Present button.
- **Presentation mode** — chrome hidden. Tap left half = prev, tap right
  half = next, any swipe (or `Esc`) returns to regular mode.

## Roadmap

- Share current slide as PNG.
- Landscape lock in presenter.
- Audio toggle for video slides (currently muted-only to match `rcviewer`).
