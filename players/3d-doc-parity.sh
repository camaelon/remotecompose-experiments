#!/usr/bin/env bash
# 3d-doc-parity.sh — Java reference vs C++, on whole .rc documents.
#
#   ./3d-doc-parity.sh <dir-or-file> [more...]
#
# 3d-parity.sh drives the engines from a scene script, which covers the rasterizer and the
# primitives. This drives the whole pipeline — WireBuffer -> CoreDocument -> the ten registered
# 3D operations -> the software renderer — so it also covers decoding, variable resolution and
# per-frame regeneration.
#
# Both sides pin the clock to the same epoch. That is not a nicety: paint() calls
# updateTimeVariables(), which reads the system clock, so loading the time variables beforehand
# is silently overwritten and every animated document then renders at wall time. Pinned, both
# players are reproducible run to run; unpinned, neither is.
#
# Only the 3D surface is live on either side; 2D calls are inert. A document's 2D content is
# therefore absent from both renders, which is what makes this a comparison of the 3D renderer.
set -uo pipefail
cd "$(dirname "$0")"

CORE=${RC_CORE:-/Users/john/code/androidx-main2/frameworks/support/compose/remote/remote-core/src/main/java}
OUT=/tmp/3ddocparity
EPOCH=${EPOCH:-1700000000123}
W=${W:-256}
H=${H:-256}
mkdir -p "$OUT"

javac -d 3d-oracle/classes -nowarn \
    $(find 3d-oracle/src -name '*.java' ! -path '*utilities/d3*' ! -path '*utilities/easing*') \
    $(find "$CORE" -name '*.java') || exit 1
c++ -std=c++17 -O2 -ffp-contract=off -I cpp/lib/rccore/include \
    $(find cpp/lib/rccore/src -name '*.cpp') cpp/tools/rc3d/main.cpp -lz -o "$OUT/rc3d" || exit 1

docs=()
for a in "$@"; do
  if [ -d "$a" ]; then while IFS= read -r f; do docs+=("$f"); done < <(find "$a" -name '*.rc' | sort)
  else docs+=("$a"); fi
done
[ ${#docs[@]} -eq 0 ] && { echo "usage: $0 <dir-or-file> [more...]" >&2; exit 2; }

same=0; diff=0; failed=0
for d in "${docs[@]}"; do
  n=$(basename "$d" .rc)
  if ! java -cp 3d-oracle/classes DocOracle "$d" "$OUT/${n}_java.png" \
        --width "$W" --height "$H" --epoch "$EPOCH" >/dev/null 2>&1; then
    printf '  %-34s JAVA FAILED\n' "$n"; failed=$((failed+1)); continue
  fi
  if ! "$OUT/rc3d" "$d" "$OUT/${n}_cpp.png" \
        --width "$W" --height "$H" --epoch "$EPOCH" >/dev/null 2>&1; then
    printf '  %-34s CPP FAILED\n' "$n"; failed=$((failed+1)); continue
  fi
  k=$(python3 pngdiff.py "$OUT/${n}_java.png" "$OUT/${n}_cpp.png" 2>/dev/null)
  if [ "$k" = "0" ]; then same=$((same+1)); else
    printf '  %-34s DIFFERS(%s)\n' "$n" "$k"; diff=$((diff+1)); fi
done
echo
echo "  $same identical, $diff differing, $failed failed"
[ "$diff" -eq 0 ] && [ "$failed" -eq 0 ]
