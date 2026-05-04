# remotecompose-experiments

A collection of experimental tools, players, and sample documents for
[RemoteCompose](https://github.com/androidx/androidx/tree/androidx-main/compose/remote) -
a compact binary UI / canvas format for streaming interactive scenes
(layout, drawing, expressions, animations, particles, paths, shaders,
bitmaps) to remote players.

This repository is not endorsed or supported by Google, and is a sandbox: things here may be incomplete, in flux, or
superseded.

Production code for Android lives in the [AndroidX repository](https://github.com/androidx/androidx/tree/androidx-main/compose/remote).

## Contents

```
remotecompose-experiments/
├── players/
│   ├── cpp/          rcX — C++ engine + Skia bridge, macOS GLFW viewer,
│   │                 iOS SwiftUI viewer, headless rc→PNG renderer, and
│   │                 an rc→JSON dumper. See players/cpp/README.md.
│   ├── compose/      Kotlin Multiplatform / Compose Multiplatform player
│   │                 targeting Desktop (JVM), with `remote-core` and
│   │                 `remote-player` modules and a `composeApp` host.
│   │                 See players/compose/README.md.
│   └── typescript/   TypeScript player + four deliverables:
│                     web bundle, interactive HTML viewer, single-file
│                     standalone HTML builder, static-deck-site builder,
│                     and a VS Code custom-editor extension.
│                     See players/typescript/README.md.
└── samples/          Hand-picked .rc documents used for smoke testing
                      and demos (canvas, pie chart, ball animation, …).
```

## Samples

The `samples/` directory contains representative `.rc` binary documents:

- `base.rc` — minimal scene with font setup
- `canvas.rc` — canvas drawing primitives
- `pie_chart.rc` — chart rendering
- `balls_animation_example.rc` — animated particles

Any of these can be played with the C++ viewer or rendered headlessly:

```sh
cd players/cpp
cmake -B build && cmake --build build -j
./build/apps/viewer/rcviewer ../../samples/balls_animation_example.rc
./build/tools/rc2image/rc2image ../../samples/canvas.rc out.png
```

See [players/cpp/README.md](players/cpp/README.md) and
[players/cpp/BUILDING.md](players/cpp/BUILDING.md) for full build
instructions on macOS and iOS.

The Compose Multiplatform player can be run on Desktop (JVM) with:

```sh
cd players/compose
./gradlew :composeApp:run
```

See [players/compose/README.md](players/compose/README.md) for details.

The TypeScript player runs in the browser, in Node, and inside VS Code.
Bundle and serve in one command:

```sh
cd players/typescript
npm install && npm run bundle
(cd web-player && python3 -m http.server 8000)
```

It also produces three other deliverables — a single-file standalone
HTML, a static deck site, and a VS Code `.vsix`. See
[players/typescript/README.md](players/typescript/README.md).

## License

Apache 2.0. See [LICENSE](LICENSE).
