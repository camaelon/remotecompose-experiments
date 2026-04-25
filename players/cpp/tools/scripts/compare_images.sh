#!/bin/bash
# Compare C++ rc2image output against reference PNGs using ImageMagick RMSE.
# Usage: bash compare_images.sh [sample_dir] [threshold]
#   sample_dir: directory containing .rcd files and matching .png references (default: sample_data)
#   threshold: RMSE threshold as decimal fraction (default: 0.10 = 10%)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CPP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPO_DIR="$(cd "$CPP_DIR/.." && pwd)"

RC2IMAGE="$CPP_DIR/build/tools/rc2image/rc2image"
SAMPLE_DIR="${1:-$REPO_DIR/sample_data}"
THRESHOLD="${2:-0.10}"

if [ ! -x "$RC2IMAGE" ]; then
    echo "Error: rc2image not found at $RC2IMAGE"
    echo "Build first: cd $CPP_DIR && cmake -B build && cmake --build build"
    exit 1
fi

if ! command -v magick &>/dev/null; then
    echo "Error: ImageMagick not found. Install with: brew install imagemagick"
    exit 1
fi

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

total=0
good=0
bad=0
skipped=0

for f in "$SAMPLE_DIR"/*.rcd "$SAMPLE_DIR"/*.rc; do
    [ ! -f "$f" ] && continue
    name=$(basename "$f")
    name="${name%.*}"
    ref="$SAMPLE_DIR/${name}.png"

    if [ ! -f "$ref" ]; then
        skipped=$((skipped + 1))
        continue
    fi

    total=$((total + 1))
    outpng="$TMPDIR/${name}.png"

    if ! "$RC2IMAGE" "$f" "$outpng" >/dev/null 2>&1; then
        bad=$((bad + 1))
        echo "FAIL: $name (render failed)"
        continue
    fi

    rmse=$(magick compare -metric RMSE "$outpng" "$ref" null: 2>&1 \
        | sed -n 's/.*(\([0-9.e+-]*\)).*/\1/p' | head -1)

    if [ -z "$rmse" ]; then
        bad=$((bad + 1))
        echo "FAIL: $name (comparison failed)"
        continue
    fi

    pass=$(python3 -c "print(1 if float('$rmse') < float('$THRESHOLD') else 0)")
    if [ "$pass" = "1" ]; then
        good=$((good + 1))
    else
        bad=$((bad + 1))
        echo "FAIL: $name RMSE=$rmse (threshold=$THRESHOLD)"
    fi
done

echo "---"
echo "Total: $total  Pass: $good  Fail: $bad  Skipped: $skipped"
echo "Threshold: $THRESHOLD"

if [ "$bad" -eq 0 ]; then
    echo "ALL PASSED"
    exit 0
else
    exit 1
fi
