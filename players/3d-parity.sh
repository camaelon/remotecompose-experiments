#!/bin/bash
# 3d-parity.sh — render every 3D scene with both the Java reference and the TypeScript port
# and require the images to be identical.
#
#   ./3d-parity.sh            # all scenes
#   ./3d-parity.sh cube       # one scene
#
# The two renderers consume the same scene script, so no wire format is involved: a difference
# here is a rasterizer port bug and nothing else. Bit-exactness is the bar rather than a
# tolerance, because the failure modes that matter (a half-pixel fill-rule shift, a depth tie
# resolved the other way) move very few pixels by very little — a tolerance hides exactly the
# bugs this exists to catch.
set -u
cd "$(dirname "$0")"

ORACLE=3d-oracle
TS=typescript
CPPDIR=cpp
OUT=/tmp/3dparity
mkdir -p "$OUT" "$OUT/cppbuild"

# Rebuild both sides so a stale artifact can never pass.
#
# remote-core compiles standalone (it needs only three annotation stubs), so the oracle drives
# the *real* operation classes — MeshExpression in particular — rather than a re-implementation
# of their arithmetic. The local utilities/d3 and utilities/easing copies are excluded because
# remote-core supplies them.
# The C++ engine. -ffp-contract=off is a correctness flag, not an optimisation preference:
# clang contracts a*b+c into an FMA by default, which rounds once instead of twice and by itself
# put 36 of 40 scenes wrong.
c++ -std=c++17 -O2 -ffp-contract=off -I"$CPPDIR/lib/rccore/include" \
    "$CPPDIR"/lib/rccore/src/d3/*.cpp "$CPPDIR"/tools/d3scene/main.cpp -lz \
    -o "$OUT/cppbuild/d3scene" || exit 1

CORE=${RC_CORE:-/Users/john/code/androidx-main2/frameworks/support/compose/remote/remote-core/src/main/java}
javac -d "$ORACLE/classes" -nowarn \
    $(find "$ORACLE/src" -name '*.java' ! -path '*utilities/d3*' ! -path '*utilities/easing*') \
    $(find "$CORE" -name '*.java') || exit 1
(cd "$TS" && npx esbuild src/core/d3/index.ts --bundle --outfile=build-node/d3.mjs --format=esm --target=es2020 >/dev/null && npx esbuild src/core/operations/d3/MeshExpression.ts --bundle --outfile=build-node/meshexpr.mjs \
    --format=esm --target=es2020 >/dev/null) || exit 1

only="${1:-}"
pass=0; fail=0
printf "  %-16s %8s  %s\n" scene pixels result
for scene in "$ORACLE"/scenes/*.txt; do
    name=$(basename "$scene" .txt)
    [ -n "$only" ] && [ "$only" != "$name" ] && continue
    java -cp "$ORACLE/classes" Oracle "$scene" "$OUT/${name}_java.png" >/dev/null 2>&1 \
        || { printf "  %-16s %8s  JAVA FAILED\n" "$name" -; fail=$((fail+1)); continue; }
    (cd "$TS" && node d3scene.mjs "../$scene" "$OUT/${name}_ts.png") >/dev/null 2>&1 \
        || { printf "  %-16s %8s  TS FAILED\n" "$name" -; fail=$((fail+1)); continue; }
    read -r n total <<<"$(python3 pngdiff.py "$OUT/${name}_java.png" "$OUT/${name}_ts.png") $(python3 -c "
from PIL import Image
im = Image.open('$OUT/${name}_java.png'); print(im.size[0]*im.size[1])")"

    # The mesh-expression scenes drive a real operation, which only the Java oracle and the
    # TypeScript player implement; the C++ port covers the renderer and the primitives.
    case "$name" in
        e_*) cn="n/a" ;;
        *)
            if "$OUT/cppbuild/d3scene" "$scene" "$OUT/${name}_cpp.png" >/dev/null 2>&1; then
                cn=$(python3 pngdiff.py "$OUT/${name}_java.png" "$OUT/${name}_cpp.png")
            else
                cn="ERR"
            fi ;;
    esac
    tsr="ok"; [ "$n" = "0" ] || tsr="DIFFERS($n)"
    cppr="$cn"; [ "$cn" = "0" ] && cppr="ok"
    printf "  %-16s %8s  %-12s %s\n" "$name" "$total" "$tsr" "$cppr"
    if [ "$n" = "0" ] && { [ "$cn" = "0" ] || [ "$cn" = "n/a" ]; }; then
        pass=$((pass+1))
    else
        fail=$((fail+1))
    fi
done
echo
echo "  $pass identical, $fail differing"
[ "$fail" -eq 0 ]
