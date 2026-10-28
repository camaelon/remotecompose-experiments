// The compiled TypeScript json2rc converter (players/typescript/build-json2rc; refresh it with
// players/typescript/src/json2rc/build.sh after changing the sources). JSON2RC_DIR overrides
// where it is loaded from.

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePath } from "./workspace.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONVERTER_DIR = process.env.JSON2RC_DIR
    ?? path.join(HERE, "..", "..", "players", "typescript", "build-json2rc");
const { convert } = createRequire(import.meta.url)(path.join(CONVERTER_DIR, "Parser.js"));

/**
 * JSON (object or string) -> .rc bytes. `{"file": ...}` bitmaps resolve against baseDir,
 * through resolvePath so they stay inside the workspace when there is one.
 */
export function jsonToRc(source, baseDir) {
    try {
        return convert(source, {
            readFile: (p) => new Uint8Array(readFileSync(resolvePath(path.resolve(baseDir, p), "bitmap file"))),
        });
    } catch (e) {
        throw new Error(`json2rc failed: ${e?.name ?? "Error"}: ${e?.message ?? e}`);
    }
}
