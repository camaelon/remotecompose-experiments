// Server-side generators: {"$gen": {"kind": "graph", ...}} is replaced, when the document is
// expanded, by the plain JSON a generator computes (layout solved, geometry projected), so the
// caller names things and the server does the arithmetic. Each generator is one file here
// exporting `kind`, `doc` and `generate(spec, ctx)`; ctx gives:
//   ctx.path(hint, ops)        registers an op-list path (moveTo/lineTo/cubicTo/close objects)
//                              once per document and returns "$paths.<id>"
//   ctx.floatArray(hint, nums) declares a float array and returns "@<id>"
//   ctx.unique(prefix)         a name prefix unique in this document ("callouts1", "callouts2")
//   ctx.header                 the document's header (its width and height), or null
//   ctx.mono                   true when the document is expanded for a mono look
//   ctx.name                   the calling component, for error messages
// The result may hold component calls and expressions: it is expanded like any other node.
// Output must be plain RemoteCompose JSON, so the Java parser writes the same bytes.

import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GENERATORS = new Map();
// A generator that fails to load is reported when it is used, and does not take the others down.
export const BROKEN = new Map();
for (const f of readdirSync(HERE).filter((f) => f.endsWith(".mjs") && f !== "index.mjs" && !f.endsWith(".test.mjs")).sort()) {
    try {
        const m = await import(pathToFileURL(path.join(HERE, f)).href);
        if (!m.kind || typeof m.generate !== "function") throw new Error("export kind and generate(spec, ctx)");
        if (GENERATORS.has(m.kind)) throw new Error(`kind '${m.kind}' is already defined`);
        GENERATORS.set(m.kind, m);
    } catch (e) { BROKEN.set(f.replace(/\.mjs$/, ""), `generators/${f}: ${e.message}`); }
}

/** Runs {"$gen": spec} for a document being expanded. */
export function runGenerator(spec, state, name) {
    const where = name ?? "document";
    const kind = spec?.kind;
    const g = GENERATORS.get(kind);
    if (!g && BROKEN.size) throw new Error(`${where}: $gen kind '${kind}' is not loaded: ${[...BROKEN.values()].join("; ")}`);
    if (!g) throw new Error(`${where}: $gen kind '${kind}' is unknown (${[...GENERATORS.keys()].sort().join(", ") || "none"})`);
    const unique = (prefix, has) => { let i = 1; while (has(`${prefix}_${i}`)) i++; return `${prefix}_${i}`; };
    const clean = (s) => String(s || kind).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || kind;
    const ctx = {
        name: where,
        // A prefix no other call in this document has, for the call's own variable names.
        unique(prefix = kind) {
            state.genIds ??= new Map();
            const p = clean(prefix);
            const n = (state.genIds.get(p) ?? 0) + 1;
            state.genIds.set(p, n);
            return `${p}${n}`;
        },
        header: state.header ?? null,
        mono: Boolean(state.theme?.mode && /mono/.test(String(state.theme.mode))),
        path(hint, ops) {
            const key = JSON.stringify(ops);
            state.genPaths ??= new Map();
            let id = state.genPaths.get(key);
            if (!id) { id = unique(`gen_${clean(hint)}`, (x) => state.paths.has(x)); state.paths.set(id, ops); state.genPaths.set(key, id); }
            return `$paths.${id}`;
        },
        floatArray(hint, nums) {
            state.floatArrays ??= new Map();
            const id = unique(`gen_${clean(hint)}`, (x) => state.floatArrays.has(x));
            state.floatArrays.set(id, nums.map(Number));
            return `@${id}`;
        },
    };
    try { return g.generate(spec, ctx); } catch (e) { throw new Error(`${where}: $gen ${kind}: ${e.message}`); }
}
