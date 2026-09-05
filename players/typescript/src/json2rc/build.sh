#!/usr/bin/env bash
# Compile the converter. Emits CommonJS into build-json2rc/ with its own package.json,
# because the package is "type": "module" and the output would otherwise be loaded as ESM.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$HERE"
npx tsc --outDir build-json2rc --module commonjs --target es2020 --lib es2020,dom \
        --skipLibCheck --esModuleInterop src/json2rc/Parser.ts
echo '{"type":"commonjs"}' > build-json2rc/package.json
cp src/json2rc/tools/cli.js src/json2rc/tools/compare-rcj.js build-json2rc/
echo "built -> build-json2rc/"
