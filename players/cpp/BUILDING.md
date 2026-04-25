# Building rcX

## Prerequisites

| Platform | Tools                                                |
|----------|------------------------------------------------------|
| macOS    | Xcode 15+ (Command Line Tools), CMake 3.20+, git     |
| iOS      | Xcode 15+, CMake 3.20+, Homebrew (for `xcodegen`)    |

`brew install cmake` if you don't already have CMake on `PATH`.

The build pulls Skia, GLFW (desktop only), and miniz (desktop viewer only)
via CMake `FetchContent`. Nothing is vendored. Network access is required
for the first configure on each platform; after that, all dependencies are
cached under `build/_deps/`.

---

## Desktop (macOS arm64)

```sh
cmake -B build
cmake --build build -j
```

You'll get the following under `build/`:

| Path                              | What it is                                  |
|-----------------------------------|---------------------------------------------|
| `lib/rccore/librccore.a`          | engine                                      |
| `lib/rcskia/librcskia.a`          | Skia bridge                                 |
| `tools/rc2json/rc2json`           | binary → JSON                               |
| `tools/rc2image/rc2image`         | binary → PNG (headless)                     |
| `apps/viewer/rcviewer`            | interactive GLFW + Metal viewer             |

Smoke tests:

```sh
./build/tools/rc2image/rc2image samples/canvas.rc out.png
./build/tools/rc2image/rc2image samples/pie_chart.rc pie.png
./build/apps/viewer/rcviewer samples/balls_animation_example.rc
```

`rcviewer` is documented in [`apps/viewer/README.md`](apps/viewer/README.md).

### Notes / pitfalls

- **arm64 only** today. `cmake -DCMAKE_OSX_ARCHITECTURES=x86_64` is not
  supported because Skia's pre-built fat binary in this CMake config is
  arm64-only. PRs welcome to build x86_64 fallbacks.
- **GLFW** ships as a pre-built static lib pulled from the upstream GLFW
  release. You don't need `brew install glfw`.
- The first configure takes 2-3 minutes (Skia download). Subsequent
  configures and clean builds are seconds-to-minutes depending on whether
  Skia has changed.

---

## iOS (arm64 device)

The iOS build is a two-stage setup: first build the C++ static libs, then
build the SwiftUI app that links them.

### 1. Static libs (`ios/`)

```sh
(cd ios && ./build.sh)
```

This produces, under `ios/output/`:

```
ios/output/
├── lib/
│   ├── librccore.a         engine compiled for iOS arm64
│   ├── librcskia.a         Skia bridge for iOS arm64
│   └── libskia.a           pre-built Skia (m144) with Metal backend
└── include/
    ├── rccore/             public engine headers
    └── rcskia/             public bridge headers
```

The Skia binary is the JetBrains skia-pack iOS build with Metal compiled
in, so the iOS app's GPU path lights up automatically.

If you don't have CMake on `PATH` system-wide, point at the bundled GUI
copy: `PATH="/Applications/CMake.app/Contents/bin:$PATH" ./build.sh`.

### 2. The app (`apps/iosViewer/`)

```sh
(cd apps/iosViewer && ./build.sh)
```

`build.sh` will:

1. Verify the libs from step 1 exist (errors otherwise with the command to run).
2. Install `xcodegen` via Homebrew if missing.
3. Generate `iosViewer.xcodeproj` from `project.yml`.
4. Run `xcodebuild` for `generic/platform=iOS` with code signing disabled.

For interactive development, open the generated project in Xcode after
`build.sh` has run once:

```sh
open apps/iosViewer/iosViewer.xcodeproj
```

Pick a real device (or arm64 Simulator slice — **not** x86_64), set a
signing team, ⌘R.

### Notes / pitfalls

- **arm64 device only** for the libs. If you need to run in the Simulator,
  use an arm64 Mac and pick the arm64 Simulator slice. x86_64 Simulator
  builds are explicitly excluded in `project.yml` because the static libs
  don't ship that slice.
- **xcodegen** is the source of truth — `iosViewer.xcodeproj` is `.gitignore`'d
  and regenerated on every build.
- **Don't** call `(cd ios && ./build.sh)` with `BUILD_DIR=build` already
  populated by a desktop build. The two are different projects in different
  build trees by default — `build/` for desktop, `ios/build/` for iOS.

---

## CI

GitHub Actions workflows live under `.github/workflows/`:

- **`macos-desktop.yml`** — runs `cmake -B build && cmake --build build`
  on `macos-latest` for every push and PR. Smoke-tests `rc2image` against
  `samples/`.
- **`ios.yml`** — builds the iOS static libs and the iosViewer app on
  `macos-latest`. Triggered manually (`workflow_dispatch`) since signing
  isn't required but it's slower and the libs alone don't change often.

---

## Cleaning

```sh
rm -rf build ios/build ios/output apps/iosViewer/iosViewer.xcodeproj
```

Removing `build/` also wipes the cached Skia / GLFW downloads, so the next
configure is again 2-3 minutes.
