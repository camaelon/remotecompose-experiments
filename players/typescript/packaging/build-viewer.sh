#!/usr/bin/env bash
# Build a single self-contained RemoteCompose viewer page.
#
#     packaging/build-viewer.sh [output.html] [document.rc]
#
# The output embeds the whole player, so it runs from a file:// URL with no server and no
# network. With no document it opens empty, accepting drag-and-drop, a file picker, or a
# URL; pass a .rc and that document is baked in as the default.
#
# Once built the page also takes query parameters:
#     viewer.html?url=https://host/doc.rc     load that document on open
#     viewer.html?w=800&h=480                 open at a given size
#
# Note on ?url= — a page opened from file:// cannot fetch cross-origin; the browser blocks
# it and the page says so. Serve the file over http for that to work.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJ_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJ_DIR"

OUTPUT="${1:-$PROJ_DIR/rc-viewer.html}"
INPUT="${2:-}"
TEMPLATE="$PROJ_DIR/web-player/viewer-template.html"

[ -f "$TEMPLATE" ] || { echo "error: template not found: $TEMPLATE" >&2; exit 1; }

TMPBUNDLE="$(mktemp /tmp/rc-viewer-bundle.XXXXXX.js)"
trap 'rm -f "$TMPBUNDLE"' EXIT

echo ">>> Bundling player…"
npx esbuild src/web/main.ts \
    --bundle --minify --format=iife --target=es2020 \
    --global-name=RC --outfile="$TMPBUNDLE"

if [ -n "$INPUT" ]; then
    [ -f "$INPUT" ] || { echo "error: input not found: $INPUT" >&2; exit 1; }
    RC_BASE64=$(base64 < "$INPUT" | tr -d '\n')
    echo ">>> Embedding $(basename "$INPUT")"
else
    # Left as the literal placeholder; the page treats that as "nothing baked in" and
    # opens on the drop target.
    RC_BASE64='%%RC_DATA_BASE64%%'
fi

# The bundle goes in via `r`, not via a shell substitution: it is a megabyte of minified
# JavaScript full of backslashes and ampersands, which sed's replacement syntax would eat.
sed -e '/%%BUNDLE_JS%%/{r '"$TMPBUNDLE"'' -e 'd;}' "$TEMPLATE" > "$OUTPUT.tmp"
python3 - "$OUTPUT.tmp" "$OUTPUT" "$RC_BASE64" <<'PY'
import sys
src, dst, data = sys.argv[1], sys.argv[2], sys.argv[3]
open(dst, "w").write(open(src).read().replace("%%RC_DATA_BASE64%%", data, 1))
PY
rm -f "$OUTPUT.tmp"

bytes=$(wc -c < "$OUTPUT" | tr -d ' ')
echo "✓ wrote $OUTPUT ($bytes bytes)"
