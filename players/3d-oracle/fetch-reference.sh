#!/bin/bash
# Copy the reference 3D engine out of a local androidx checkout into this oracle.
#
# Those files are AOSP source belonging to a CL that is still in review, so they are NOT stored
# in this repository — this repo is public and the CL is not. Everything else in 3d-oracle/ is
# written here; run this once and the harness builds.
#
#   RC_ANDROIDX=/path/to/androidx/frameworks/support ./fetch-reference.sh
set -eu
cd "$(dirname "$0")"

CORE=${RC_ANDROIDX:-/Users/john/code/androidx-main2/frameworks/support}/compose/remote
if [ ! -d "$CORE" ]; then
    echo "not found: $CORE" >&2
    echo "set RC_ANDROIDX to your androidx checkout's frameworks/support directory" >&2
    exit 1
fi

copy() {  # copy <relative-source> <destination-dir>
    mkdir -p "$2"
    cp "$CORE/$1" "$2/"
    echo "  $(basename "$1")"
}

echo "copying the reference engine from $CORE"
D=src/androidx/compose/remote
copy remote-core/src/main/java/androidx/compose/remote/core/operations/utilities/d3/Primitive3D.java \
     "$D/core/operations/utilities/d3"
copy remote-core/src/main/java/androidx/compose/remote/core/operations/utilities/d3/MeshData.java \
     "$D/core/operations/utilities/d3"
copy remote-core/src/main/java/androidx/compose/remote/core/operations/utilities/easing/MonotonicCurveFit.java \
     "$D/core/operations/utilities/easing"
for f in JavaPaint3DContext Rasterizer Matrix4; do
    copy "remote-player-core/src/main/java/androidx/compose/remote/player/core/platform/d3/$f.java" \
         "$D/player/core/platform/d3"
done
echo "done — now run ../3d-parity.sh"
