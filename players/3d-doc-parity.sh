#!/bin/bash
# 3d-doc-parity.sh — end-to-end cross-player check on a real .rc document.
#
# 3d-parity.sh drives the *engines* from a scene script. This drives the whole pipeline —
# WireBuffer -> CoreDocument -> the ten registered 3D operations -> the software renderer — so it
# covers decoding, variable resolution and per-frame regeneration, which a scene script cannot
# reach.
#
# The fixture is deliberately time-independent. Anything referencing continuousSec() renders at
# whatever each player thinks the wall clock is, and then a pixel comparison measures the clock
# rather than the code.
set -u
cd "$(dirname "$0")"

CPPDIR=cpp
OUT=/tmp/3dparity
DOC=${1:-/Users/john/code/github/rcJson/d3/static.rc}
W=${2:-360}
H=${3:-300}
mkdir -p "$OUT/cppbuild"

c++ -std=c++17 -O2 -ffp-contract=off -I"$CPPDIR/lib/rccore/include" \
    $(find "$CPPDIR/lib/rccore/src" -name '*.cpp') "$CPPDIR/tools/rc3d/main.cpp" -lz \
    -o "$OUT/cppbuild/rc3d" || exit 1

"$OUT/cppbuild/rc3d" "$DOC" "$OUT/doc_cpp.png" --width "$W" --height "$H" >/dev/null || exit 1
node /tmp/tsr.mjs "$DOC" "$OUT/doc_ts.png" "$W" "$H" >/dev/null || exit 1

n=$(python3 pngdiff.py "$OUT/doc_cpp.png" "$OUT/doc_ts.png")
drawn=$(python3 -c "
from PIL import Image
print(sum(1 for p in Image.open('$OUT/doc_cpp.png').convert('RGBA').getdata() if p[3] > 0))")
echo "  $(basename "$DOC"): $drawn px drawn, $n differing (C++ vs TypeScript)"
[ "$n" = "0" ] && [ "$drawn" -gt 200 ]
