#!/usr/bin/env node
// Layout conformance against the reference specs (androidx compose/remote/layout-specs).
//
// Each spec carries the bytes the Android reference compiled and the component tree the
// Android player laid out, per case size. This loads those exact bytes in the C++ player
// (rc2layout) and the TypeScript player (layout.mjs), lays them out at the same sizes, and
// compares every component by id against the reference tree.
//
//   node players/conformance/layout-specs.mjs [--specs DIR] [--filter REGEX] [--engine cpp|ts|both]
//                                            [--verbose] [--json OUT]
//
// A component matches when it exists in the engine's layout with x, y, w, h each within the
// spec's tolerance (default 0.5). Ids matter: hosts and actions address components by id, so
// an engine that lays out the right boxes under different ids does not conform.
// Cases with interactive `steps` are skipped unless --interactive is given; then the click,
// advanceTime, settle and resize steps are replayed by both engines on a manual clock, with
// animations on when the spec says `animation: true` (drags, long presses, double clicks and
// touch cancels are still skipped).

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLAYERS = path.join(HERE, "..");
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const SPECS = opt("--specs", process.env.RC_LAYOUT_SPECS ??
    path.join(process.env.HOME, "androidx/frameworks/support/compose/remote/layout-specs/specs"));
const FILTER = new RegExp(opt("--filter", "."));
const ENGINES = { both: ["cpp", "ts"], cpp: ["cpp"], ts: ["ts"] }[opt("--engine", "both")];
const VERBOSE = args.includes("--verbose");
const INTERACTIVE = args.includes("--interactive");
const JSON_OUT = opt("--json", null);
const RC2LAYOUT = process.env.RC2LAYOUT ?? path.join(PLAYERS, "cpp/build/tools/rc2layout/rc2layout");
const TMP = mkdtempSync(path.join(tmpdir(), "rc-specs-"));

// layout.mjs runs the TypeScript player from a bundle; rebuild it so the run measures the
// current sources rather than whatever was bundled last.
if (ENGINES.includes("ts") && !args.includes("--no-rebuild")) {
    execFileSync("npx", ["esbuild", "src/node-entry.ts", "--bundle", "--platform=node", "--format=esm",
                         "--outfile=build-node/node-entry.js", "--log-level=error"], { cwd: path.join(PLAYERS, "typescript"), stdio: "inherit" });
}

// A case's steps as engine arguments (rc2layout and layout.mjs take the same ones), or null
// when a step is not one they replay.
function stepArgs(steps, animation) {
    const out = animation ? ["--anim"] : [];
    for (const st of steps ?? []) {
        if (st.click) out.push(st.settle === false ? "--click-frame" : "--click", String(st.click[0]), String(st.click[1]));
        else if (st.resize) { out.push("--resize", String(st.resize[0]), String(st.resize[1])); if (st.settle === false) return null; }
        else if (st.advanceTime !== undefined) out.push("--advance", String(st.advanceTime));
        else if (st.settle === true && Object.keys(st).length === 1) out.push("--settle");
        else return null;
    }
    return out;
}

function runEngine(engine, rcPath, w, h, density, extra = []) {
    try {
        const out = engine === "cpp"
            ? execFileSync(RC2LAYOUT, [rcPath, String(w), String(h), ...extra], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 })
            : execFileSync("node", ["layout.mjs", rcPath, "--width", String(w), "--height", String(h), "--density", String(density ?? 1), ...extra],
                           { cwd: path.join(PLAYERS, "typescript"), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30000 });
        const boxes = new Map();
        for (const m of out.matchAll(/^LAYOUT id=(-?\d+) x=(-?[\d.]+) y=(-?[\d.]+) w=(-?[\d.]+) h=(-?[\d.]+)/gm)) {
            if (!boxes.has(+m[1])) boxes.set(+m[1], { x: +m[2], y: +m[3], w: +m[4], h: +m[5] });
        }
        return { boxes };
    } catch (e) {
        return { error: (e.stderr?.toString() || e.message).trim().split("\n").slice(-2).join(" ").slice(0, 200) };
    }
}

// The reference trees were dumped with Java's Math.round(v * 100) / 100.0, which saturates at
// Long.MAX_VALUE: a size of Float.MAX_VALUE (a gone child measured unbounded) reads
// 92233720368547760. An engine value that large is compared as the dump would print it.
const DUMP_MAX = 9223372036854775807 / 100;
const asDumped = (v) => (Math.abs(v) * 100 >= 9223372036854775807 ? Math.sign(v) * DUMP_MAX : v);

function flatten(node, out = []) {
    if (!node) return out;
    out.push(node);
    for (const c of node.children ?? []) flatten(c, out);
    return out;
}

const files = readdirSync(SPECS).filter((f) => f.endsWith(".json") && FILTER.test(f)).sort();
const totals = Object.fromEntries(ENGINES.map((e) => [e, { specs: 0, pass: 0, components: 0, matched: 0, missing: 0, wrong: 0, errors: 0 }]));
let skipped = 0;
const report = [];
for (const f of files) {
    const spec = JSON.parse(readFileSync(path.join(SPECS, f), "utf8"));
    const ref = spec.reference;
    if (!ref?.rc || !Array.isArray(ref.cases)) continue;
    const rcPath = path.join(TMP, f.replace(/\.json$/, ".rc"));
    writeFileSync(rcPath, Buffer.from(ref.rc, "base64"));
    const tol = spec.tolerance ?? 0.5;
    for (const c of ref.cases) {
        const authored = (spec.cases ?? []).find((k) => k.name === c.name) ?? {};
        let extra = [];
        if (authored.steps?.length) {
            const sa = INTERACTIVE ? stepArgs(authored.steps, ref.animation ?? spec.animation) : null;
            if (!sa) { skipped++; continue; }
            extra = sa;
        } else if (INTERACTIVE) {
            continue;   // --interactive runs the interactive cases only
        }
        const want = flatten(c.tree).filter((n) => typeof n.id === "number");
        for (const engine of ENGINES) {
            const t = totals[engine];
            t.specs++;
            const got = runEngine(engine, rcPath, c.width, c.height, ref.density ?? 1, extra);
            const entry = { spec: spec.name, case: c.name, engine, components: want.length };
            if (got.error) {
                t.errors++;
                entry.error = got.error;
            } else {
                const problems = [];
                for (const n of want) {
                    const b = got.boxes.get(n.id);
                    if (!b) { problems.push(`missing ${n.type}#${n.id}`); t.missing++; continue; }
                    const off = ["x", "y", "w", "h"].filter((k) => Math.abs(asDumped(b[k]) - n[k]) > tol);
                    if (off.length) {
                        problems.push(`${n.type}#${n.id} ${off.map((k) => `${k}=${b[k]} want ${n[k]}`).join(" ")}`);
                        t.wrong++;
                    } else t.matched++;
                }
                t.components += want.length;
                entry.problems = problems;
                if (!problems.length) t.pass++;
            }
            report.push(entry);
            if (VERBOSE || entry.error || entry.problems?.length) {
                const status = entry.error ? `ERROR ${entry.error}` : entry.problems.length ? `${entry.problems.length} problem(s)` : "ok";
                if (VERBOSE || !FILTER.test("^$")) {
                    console.log(`${engine.padEnd(3)} ${spec.name} [${c.name}] ${status}`);
                    for (const p of (entry.problems ?? []).slice(0, VERBOSE ? 100 : 6)) console.log(`      ${p}`);
                }
            }
        }
    }
}
console.log(`\n${files.length} spec files, ${skipped} interactive case(s) skipped${INTERACTIVE ? " (unsupported steps); non-interactive cases not run" : ""}`);
for (const [e, t] of Object.entries(totals)) {
    console.log(`${e.padEnd(3)}: ${t.pass}/${t.specs} cases pass | components ${t.matched}/${t.components} match, ${t.wrong} wrong, ${t.missing} missing | ${t.errors} errors`);
}
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ totals, report }, null, 1));
