#!/usr/bin/env bash
# Build a single self-contained HTML file from one .rc document. The
# resulting file embeds the player bundle and the .rc bytes (base64) so
# it runs without a server — open it in a browser and you have a player.
#
# Usage:
#     packaging/build-standalone.sh [<input.rc> [<output.html>]]
#
# Defaults:
#     input  = ../../../samples/canvas.rc           (any .rc in samples/)
#     output = rc-player.html                       (in the project root)

set -euo pipefail

# `cd` into the typescript-player project root so npx finds esbuild and
# the TypeScript paths resolve.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJ_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJ_DIR"

INPUT="${1:-$PROJ_DIR/../../samples/canvas.rc}"
OUTPUT="${2:-$PROJ_DIR/rc-player.html}"
TEMPLATE="$PROJ_DIR/web-player/standalone-template.html"

if [ ! -f "$INPUT" ]; then
    echo "error: input not found: $INPUT" >&2
    exit 1
fi
if [ ! -f "$TEMPLATE" ]; then
    echo "error: template not found: $TEMPLATE" >&2
    exit 1
fi

TMPBUNDLE="$(mktemp /tmp/rc-bundle.XXXXXX.js)"
trap 'rm -f "$TMPBUNDLE"' EXIT

# 1. Bundle the TypeScript player into a single minified IIFE.
echo ">>> Bundling player…"
npx esbuild src/web/main.ts \
    --bundle --minify --format=iife --target=es2020 \
    --global-name=RC --outfile="$TMPBUNDLE"

# 2. Base64-encode the input document.
RC_BASE64=$(base64 < "$INPUT" | tr -d '\n')

# 3. Inline the bundle and document into the template.
sed -e '/%%BUNDLE_JS%%/{r '"$TMPBUNDLE"'' -e 'd;}' \
    -e "s|%%RC_DATA_BASE64%%|${RC_BASE64}|g" \
    "$TEMPLATE" > "$OUTPUT"

bytes=$(wc -c < "$OUTPUT" | tr -d ' ')
echo "✓ wrote $OUTPUT ($bytes bytes)"
