// The compiled TypeScript json2rc converter (players/typescript/build-json2rc; refresh it with
// players/typescript/src/json2rc/build.sh after changing the sources). JSON2RC_DIR overrides
// where it is loaded from.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePath } from "./workspace.mjs";
import { expandComponents, usesComponents } from "./components.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONVERTER_DIR = process.env.JSON2RC_DIR
    ?? path.join(HERE, "..", "..", "players", "typescript", "build-json2rc");
const { convert } = createRequire(import.meta.url)(path.join(CONVERTER_DIR, "Parser.js"));

/**
 * The plain document a component-calling document compiles to (components.mjs
 * expandComponents), with auto mode measuring each candidate with this converter (bitmap files
 * resolved against baseDir). Returns expandComponents' result.
 */
export function compileComponents(doc, baseDir = ".", options = {}) {
    const readFile = (p) => new Uint8Array(readFileSync(resolvePath(path.resolve(baseDir, p), "bitmap file")));
    return expandComponents(doc, { measure: (d) => convert(d, { readFile }).length, ...options });
}

/**
 * JSON (object or string) -> .rc bytes. `{"file": ...}` bitmaps resolve against baseDir,
 * through resolvePath so they stay inside the workspace when there is one.
 */
export function jsonToRc(source, baseDir) {
    // Library components (examples/components) expand to plain JSON first.
    let doc = source;
    if (typeof doc === "string" && /"[A-Z]\w*"/.test(doc)) {
        try { doc = JSON.parse(doc); } catch { /* json2rc reports it */ }
    }
    if (doc && typeof doc === "object") {
        try {
            if (usesComponents(doc)) source = compileComponents(doc, baseDir).doc;
        } catch (e) {
            throw new Error(`components: ${e?.message ?? e}`);
        }
    }
    try {
        return convert(source, {
            readFile: (p) => new Uint8Array(readFileSync(resolvePath(path.resolve(baseDir, p), "bitmap file"))),
        });
    } catch (e) {
        throw new Error(`json2rc failed: ${e?.name ?? "Error"}: ${e?.message ?? e}`);
    }
}
