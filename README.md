# remotecompose-experiments

A collection of experimental tools, players, and sample documents for
[RemoteCompose](https://github.com/androidx/androidx/tree/androidx-main/compose/remote) -
a compact binary UI / canvas format for streaming interactive scenes
(layout, drawing, expressions, animations, particles, paths, shaders,
bitmaps) to remote players.

This repo is a sandbox: things here may be incomplete, in flux, or
superseded. Production code for Android lives in the [AndroidX repository](https://github.com/androidx/androidx/tree/androidx-main/compose/remote).

## Contents

```
remotecompose-experiments/
├── players/
│   └── cpp/          rcX — C++ engine + Skia bridge, macOS GLFW viewer,
│                     iOS SwiftUI viewer, headless rc→PNG renderer, and
│                     an rc→JSON dumper. See players/cpp/README.md.
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

## License

Apache 2.0. See [LICENSE](LICENSE).
