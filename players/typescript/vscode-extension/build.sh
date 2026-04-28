#!/usr/bin/env bash
# Build the VS Code extension .vsix.  Steps:
#   1. esbuild-bundle the TypeScript player + rc2json from ../src/
#      into media/ so the extension's webview can load them.
#   2. tsc-compile the extension itself (extension.ts → out/extension.js).
#   3. Package via vsce → rc-viewer-<version>.vsix.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# The TypeScript player project is the parent directory of this extension.
TS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Bundling tools (esbuild, vsce) come from the player project's
# node_modules — shared between every artefact built from this tree.
if [ ! -d "$TS_DIR/node_modules" ]; then
    echo "error: $TS_DIR/node_modules not found — run \`npm install\` in $TS_DIR first" >&2
    exit 1
fi

# The extension has type-only dev-deps (@types/vscode, @types/node)
# that tsc needs.  These live in *this* directory's node_modules.
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo "=== Installing extension dev-deps ==="
    npm install --silent
fi

echo "=== Bundling RC player ==="
npx --prefix "$TS_DIR" esbuild "$TS_DIR/src/web/main.ts" \
    --bundle --minify --format=iife --target=es2020 --global-name=RC \
    --outfile="$SCRIPT_DIR/media/rc-bundle.js"

echo "=== Bundling RC2JSON ==="
npx --prefix "$TS_DIR" esbuild "$TS_DIR/src/rc2json.ts" \
    --bundle --minify --format=iife --target=es2020 --global-name=RC2JSON \
    --outfile="$SCRIPT_DIR/media/rc2json-bundle.js"

echo "=== Compiling extension ==="
npx --prefix "$TS_DIR" tsc -p .

echo "=== Packaging .vsix ==="
npx --prefix "$TS_DIR" @vscode/vsce package --no-dependencies

echo "=== Done ==="
ls -la *.vsix
