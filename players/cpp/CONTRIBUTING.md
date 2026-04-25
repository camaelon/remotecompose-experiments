# Contributing to rcX

## Getting set up

See [BUILDING.md](BUILDING.md) for full instructions. tl;dr:

```sh
cmake -B build && cmake --build build -j
./build/tools/rc2image/rc2image samples/canvas.rc out.png
```

## Coding conventions

### C++

- C++17, no exceptions in hot paths (engine code is compiled with default
  exception handling but operations should not throw on valid input).
- Headers in `lib/<module>/include/<module>/` — all public symbols live
  under the `rccore::` or `rcskia::` namespace.
- `.cpp` source under `lib/<module>/src/`.
- Engine code (`lib/rccore/`) **must not** depend on Skia. Anything that
  needs to draw goes through the abstract `PaintContext` interface.
- Style: clang-format-friendly defaults — 4-space indent, braces on the
  same line for functions, spaces around binary operators. We don't ship
  a `.clang-format` yet; match the surrounding file.

### Adding a new operation

1. Pick an opcode in `lib/rccore/include/rccore/Operations.h`. Don't reuse
   numbers — append at the end and document the file/version it was added in.
2. Write the op class under `lib/rccore/include/rccore/operations/`. It
   needs `name()`, `opcode()`, `read(WireBuffer&, ops)`, and either
   `apply(RemoteContext&)` (paint-time) or be a container with sub-ops.
3. Register the reader in `lib/rccore/src/Operations.cpp` (`registerReader`).
4. Implement the bridge work, if any, in `lib/rcskia/src/SkiaPaintContext.cpp`.
5. Add a sample `.rc` exercising the op under `samples/` and a smoke-test
   case to the CI workflow.

### Tests

There is no formal C++ test framework wired in yet. Smoke tests today:

- `rc2image` against every file in `samples/` should produce a non-empty
  PNG without crashing.
- `rc2json` against every file in `samples/` should produce valid JSON
  matching the reference Java writer (out of tree).

Both are run by the `macos-desktop` GitHub Actions workflow.

## License of contributions

By submitting code, you agree it's licensed under Apache 2.0 (the same
license as the rest of the project). Do not paste in code under
incompatible licenses (GPL, AGPL, …).

## Reporting issues

Open a GitHub issue with:

- the platform (macOS arm64 / iOS device / iOS Simulator slice),
- exact `cmake` command lines you ran,
- the `.rc` file that triggers the bug if applicable (or a minimal
  reproducer),
- the relevant log output.
