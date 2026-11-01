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
const { convert, convertWithSymbols } = createRequire(import.meta.url)(path.join(CONVERTER_DIR, "Parser.js"));

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
    // Parsed when it may call a component, or read the theme ("@colors.x", "@theme.y", $icon):
    // the expansion resolves those too.
    if (typeof doc === "string" && (/"[A-Z]\w*"/.test(doc) || /"@(colors|theme)\.|"\$icon"/.test(doc))) {
        try { doc = JSON.parse(doc); } catch { /* json2rc reports it */ }
    }
    // A layout document needs the header's "profiles": 513 for any text; a missing one is the
    // most common first-convert failure, so it is supplied (a value given is kept).
    if (typeof doc === "string" && !/"profiles"\s*:/.test(doc) && /"header"\s*:/.test(doc)) {
        try { doc = JSON.parse(doc); } catch { /* json2rc reports it */ }
    }
    if (doc && typeof doc === "object" && doc.header && typeof doc.header === "object" && doc.header.profiles === undefined && doc.root !== undefined) {
        doc = { ...doc, header: { ...doc.header, profiles: 513 } };
        source = doc;
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
        throw new Error(`json2rc failed: ${e?.name ?? "Error"}: ${explainToken(e?.message ?? String(e), source)}`);
    }
}

// "Unknown token in expression: @x" says nothing about why: the usual causes are a resources
// variable declared AFTER the expression that reads it (they are written in order), and a
// component local used where its declaration has not been written yet (the root's modifiers).
function explainToken(message, source) {
    const fn = /Unsupported integer function: (\w+)/.exec(message);
    if (fn) return `${message} — this field takes an INTEGER expression (a visibility, an integer variable): only + - * / %, abs, min, max and clamp. Compute it as a float variable first and pass that: "resources": {"variables": {"shown": "${fn[1]}(...)"}}, then {"visibility": "@shown"} (exactly 1 shown, 0 hidden).`;
    const m = /Unknown token in expression: @?([A-Za-z_][\w.]*)/.exec(message);
    if (!m) return message;
    const name = m[1];
    let doc = null;
    try { doc = typeof source === "string" ? JSON.parse(source) : source; } catch { return message; }
    const vars = doc?.resources?.variables;
    const names = Array.isArray(vars) ? vars.map((v) => v?.name ?? Object.keys(v ?? {})[0]) : Object.keys(vars ?? {});
    if (names.includes(name)) return `${message} — "${name}" is declared in resources.variables, but AFTER an expression that reads it: resources are written in order, so move it above its readers.`;
    if (/^[a-z]+\d+_/.test(name)) return `${message} — a component local ("${name.replace(/^[a-z]+\d+_/, "")}") read before its declaration is written: a local that reads a tree value (componentWidth(), a $each item) is declared inside the body, so the body ROOT's own modifiers cannot read it; compute it from params and resources only, or use it below the root.`;
    const text = JSON.stringify(doc ?? {});
    if (text.includes(`"${name}"`) || text.includes(`{"name": "${name}"`) || text.includes(`"name":"${name}"`)) return `${message} — "${name}" is declared as a tree variable after the expression that reads it: declare it before (resources.variables for a number, a root-level variable command for a string).`;
    return `${message} — no variable "${name}" is declared: add it to resources.variables ({"${name}": 0}) or fix the spelling.`;
}

/**
 * The names a JSON document gives its variables and the ids they get in the .rc, {id: name}:
 * for tools that read the binary back, where only exported variables carry a name. Components
 * are expanded first, as jsonToRc does. Null when the document does not convert.
 */
export function variableNames(source, baseDir) {
    try {
        let doc = typeof source === "string" ? JSON.parse(source) : source;
        if (doc && typeof doc === "object" && usesComponents(doc)) doc = compileComponents(doc, baseDir).doc;
        const { symbols } = convertWithSymbols(doc, {
            readFile: (p) => new Uint8Array(readFileSync(resolvePath(path.resolve(baseDir, p), "bitmap file"))),
        });
        return Object.fromEntries(Object.entries(symbols.variables).map(([name, id]) => [id, name]));
    } catch { return null; }
}

/**
 * The JSON path of every component id in the .rc ("column[0].row[1].text[1]": types with
 * sibling indexes, of the document as converted, i.e. with library components expanded), for
 * findings that name a component by its id. Null when the document does not convert.
 */
export function componentPaths(source, baseDir) {
    try {
        let doc = typeof source === "string" ? JSON.parse(source) : source;
        if (doc && typeof doc === "object" && usesComponents(doc)) doc = compileComponents(doc, baseDir).doc;
        const { symbols } = convertWithSymbols(doc, {
            readFile: (p) => new Uint8Array(readFileSync(resolvePath(path.resolve(baseDir, p), "bitmap file"))),
        });
        return symbols.components ?? null;
    } catch { return null; }
}

/** "#-11" in a finding's text becomes "#-11 (column[0].row[1])" when the path is known. */
export function withComponentPaths(text, paths) {
    if (!paths || typeof text !== "string") return text;
    return text.replace(/#(-\d+)\b(?! \()/g, (m, id) => (paths[id] ? `${m} (${paths[id]})` : m));
}
