#!/usr/bin/env bash
# Build librcnative.a (Core Graphics backend, no Skia) for iOS arm64,
# alongside librccore.a. Mirrors ../ios/build.sh.
set -euo pipefail
cd "$(dirname "$0")"
TOOLCHAIN="${TOOLCHAIN_FILE:-$(cd .. && pwd)/ios/ios.toolchain.cmake}"
cmake -B build -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN" -S . "$@"
cmake --build build -j"$(sysctl -n hw.ncpu)"
echo
for a in build/librcnative.a build/rccore/librccore.a; do
  [ -f "$a" ] && echo "  $(basename $a)  $(du -h $a | cut -f1 | xargs)  $(lipo -info $a 2>/dev/null | sed 's/.*: //')"
done
