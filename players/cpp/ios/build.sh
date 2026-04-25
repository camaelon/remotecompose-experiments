#!/bin/bash
# Build the rcX iOS static libraries (arm64 device).
#
# Output: ios/output/lib/{librccore.a,librcskia.a,libskia.a}
#         ios/output/include/{rccore,rcskia}
#
# These are what the iOS app under apps/iosViewer/ links against.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

BUILD_DIR="build"
OUTPUT_DIR="output"

# Allow override but default to the bundled toolchain file.
TOOLCHAIN_FILE="${TOOLCHAIN_FILE:-$SCRIPT_DIR/ios.toolchain.cmake}"

echo "=== Configuring iOS build ==="
cmake -B "$BUILD_DIR" -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN_FILE"

echo "=== Building ==="
cmake --build "$BUILD_DIR" -j"$(sysctl -n hw.ncpu)"

echo "=== Collecting output ==="
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/lib" "$OUTPUT_DIR/include"

cp "$BUILD_DIR/rccore/librccore.a" "$OUTPUT_DIR/lib/"
cp "$BUILD_DIR/rcskia/librcskia.a" "$OUTPUT_DIR/lib/"

# libskia.a comes from the FetchContent extract under build/_deps/skia-src/out/...
SKIA_LIB=$(find "$BUILD_DIR/_deps/skia-src/out" -name "libskia.a" -maxdepth 2 | head -1)
if [ -n "${SKIA_LIB:-}" ]; then
    cp "$SKIA_LIB" "$OUTPUT_DIR/lib/"
    echo "Copied Skia: $SKIA_LIB"
else
    echo "warning: libskia.a not found under $BUILD_DIR/_deps/skia-src/out" >&2
fi

cp -R "$SCRIPT_DIR/../lib/rccore/include/rccore" "$OUTPUT_DIR/include/rccore"
cp -R "$SCRIPT_DIR/../lib/rcskia/include/rcskia" "$OUTPUT_DIR/include/rcskia"

echo ""
echo "=== Done ==="
for lib in "$OUTPUT_DIR"/lib/*.a; do
    echo "  $(basename "$lib") ($(du -h "$lib" | cut -f1 | xargs))"
    lipo -info "$lib" 2>/dev/null || true
done
echo "Headers: $OUTPUT_DIR/include/rccore/, $OUTPUT_DIR/include/rcskia/"
