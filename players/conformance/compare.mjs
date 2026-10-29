#!/usr/bin/env node
// Three-way layout comparison of documents: the Java reference (remote-core on the JVM,
// java-layout.sh) against the C++ player (rc2layout) and the TypeScript player (layout.mjs).
//
//   node players/conformance/compare.mjs DOC.rc... [--size WxH] [--engine cpp|ts|both] [--verbose]
//
// Each component the reference lays out is looked up by id in each engine and compared on
// x, y, w, h (tolerance 0.5). Ids matter: they are how hosts and actions address components,
// and they are what pattern (Loom) inflation allocates. Without --size a document is laid out
// at its header size (the reference's root size).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLAYERS = path.join(HERE, "..");
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const files = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--size", "--engine"].includes(args[i - 1])));
const ENGINES = { both: ["cpp", "ts"], cpp: ["cpp"], ts: ["ts"] }[opt("--engine", "both")];
const VERBOSE = args.includes("--verbose");
const TOL = 0.5;
const RC2LAYOUT = process.env.RC2LAYOUT ?? path.join(PLAYERS, "cpp/build/tools/rc2layout/rc2layout");

const TS_BUNDLE = path.join(PLAYERS, "typescript/build-node/node-entry.js");
if ((ENGINES.includes("ts") && !args.includes("--no-rebuild")) || !existsSync(TS_BUNDLE)) {
    execFileSync("npx", ["esbuild", "src/node-entry.ts", "--bundle", "--platform=node", "--format=esm",
                         "--outfile=build-node/node-entry.js", "--log-level=error"], { cwd: path.join(PLAYERS, "typescript"), stdio: "inherit" });
}

function parse(out) {
    const list = [];
    for (const m of out.matchAll(/^LAYOUT id=(-?\d+) x=(-?[\d.]+) y=(-?[\d.]+) w=(-?[\d.]+) h=(-?[\d.]+)(?: (\w+))?/gm)) {
        list.push({ id: +m[1], x: +m[2], y: +m[3], w: +m[4], h: +m[5], type: m[6] });
    }
    return list;
}
function run(cmd, argv, cwd) {
    try { return { out: execFileSync(cmd, argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000 }) }; }
    catch (e) { return { error: (e.stderr?.toString() || e.message).trim().split("\n").slice(-1)[0].slice(0, 160) }; }
}

// The document's header size (DOC_WIDTH / DOC_HEIGHT), read by the TypeScript player's
// header parser. It used to be taken from rc2layout's first LAYOUT line, but rc2layout sorts
// its lines by id, so that line is the most negative id (a leaf, e.g. 52x32), not the root.
let RC = null;
async function headerSize(file) {
    try {
        RC ??= await import(TS_BUNDLE);
        const data = readFileSync(file);
        const doc = new RC.CoreDocument();
        doc.initFromBuffer(RC.RemoteComposeBuffer.fromArrayBuffer(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
        const w = Math.round(doc.getWidth?.() ?? 0), h = Math.round(doc.getHeight?.() ?? 0);
        if (w > 0 && h > 0) return [w, h];
    } catch { /* fall through */ }
    return [400, 400];
}

const totals = Object.fromEntries(ENGINES.map((e) => [e, { docs: 0, pass: 0, components: 0, matched: 0, wrong: 0, missing: 0, errors: 0 }]));
for (const f of files) {
    const abs = path.resolve(f);
    let [w, h] = (opt("--size", "") || "").split("x").map(Number);
    if (!w) [w, h] = await headerSize(abs);
    const ref = run(path.join(HERE, "java-layout.sh"), [abs, String(w), String(h)]);
    if (ref.error) { console.log(`${path.basename(f)}: reference failed: ${ref.error}`); continue; }
    // Duplicate ids are legal (the reference itself shares ids, e.g. text inside a pattern),
    // so compare them in order of appearance.
    const want = parse(ref.out);
    for (const engine of ENGINES) {
        const t = totals[engine];
        t.docs++;
        const got = engine === "cpp" ? run(RC2LAYOUT, [abs, String(w), String(h)])
            : run("node", ["layout.mjs", abs, "--width", String(w), "--height", String(h), "--all"], path.join(PLAYERS, "typescript"));
        if (got.error) { t.errors++; console.log(`${engine.padEnd(3)} ${path.basename(f)} ERROR ${got.error}`); continue; }
        const byId = new Map();
        for (const b of parse(got.out)) { if (!byId.has(b.id)) byId.set(b.id, []); byId.get(b.id).push(b); }
        const used = new Map();
        const problems = [];
        for (const n of want) {
            const k = used.get(n.id) ?? 0; used.set(n.id, k + 1);
            const list = byId.get(n.id) ?? [];
            const b = list[k];
            if (!b && list.length > 0) {
                // The reference repeats this id (it shares one across pattern inflations) and
                // the engine reports it once: the C++ player keys layout results by id, so it
                // cannot list duplicates. Not a missing component; counted apart.
                t.collapsed = (t.collapsed ?? 0) + 1;
                continue;
            }
            if (!b) { problems.push(`missing ${n.type ?? ""}#${n.id}`); t.missing++; continue; }
            const off = ["x", "y", "w", "h"].filter((q) => Math.abs(b[q] - n[q]) > TOL);
            if (off.length) { problems.push(`${n.type ?? ""}#${n.id} ${off.map((q) => `${q}=${b[q]} want ${n[q]}`).join(" ")}`); t.wrong++; }
            else t.matched++;
        }
        t.components += want.length;
        if (!problems.length) t.pass++;
        console.log(`${engine.padEnd(3)} ${path.basename(f)} [${w}x${h}] ${problems.length ? problems.length + " problem(s)" : "ok"}`);
        for (const p of problems.slice(0, VERBOSE ? 200 : 5)) console.log(`      ${p}`);
    }
}
console.log();
for (const [e, t] of Object.entries(totals)) {
    console.log(`${e.padEnd(3)}: ${t.pass}/${t.docs} documents match the reference | components ${t.matched}/${t.components}, ${t.wrong} wrong, ${t.missing} missing` +
                (t.collapsed ? `, ${t.collapsed} duplicate-id repeats collapsed` : "") + ` | ${t.errors} errors`);
}
