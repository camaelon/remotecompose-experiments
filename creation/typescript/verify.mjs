/**
 * Byte-compare this engine against the reference.
 *
 * The reference is `rcj`, the Python converter, which is itself byte-verified against
 * the official androidx parser. A mismatch here is this engine's bug, not a difference
 * of opinion — "it produced something" is not the bar, the same bytes are.
 *
 *   node verify.mjs
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";

// Corpus of reference documents. Override with RCJSON=/path when it lives elsewhere.
const RCJSON = process.env.RCJSON || "/Users/john/code/github/rcJson";
const DIRS = ["examples", "demos", "demos2", "demos_anim", "library", "generated",
              "upstream", "probes", "shaders"];
const { compile } = await import("./build/parser.js");

// One Python process for the whole corpus: per-file subprocesses cost minutes.
const script = `
import sys, json, base64, os
sys.path.insert(0, ${JSON.stringify(RCJSON)})
from rcj import convert
out = {}
for d in ${JSON.stringify(DIRS)}:
    p = os.path.join(${JSON.stringify(RCJSON)}, d)
    if not os.path.isdir(p): continue
    for fn in sorted(os.listdir(p)):
        if not fn.endswith(".json"): continue
        key = d + "/" + fn[:-5]
        try:
            out[key] = base64.b64encode(convert(open(os.path.join(p, fn)).read())).decode()
        except Exception as e:
            out[key] = "ERR:" + type(e).__name__ + ": " + str(e)[:80]
print(json.dumps(out))
`;
const ref = JSON.parse(execFileSync("python3", ["-c", script], { maxBuffer: 512 << 20 }).toString());

const G = "\x1b[32m", R = "\x1b[31m", Y = "\x1b[33m", D = "\x1b[2m", X = "\x1b[0m";
let same = 0, diff = 0, bothSkip = 0, onlyRef = 0;
const problems = [];

for (const dir of DIRS) {
    const d = join(RCJSON, dir);
    if (!existsSync(d)) continue;
    for (const fn of readdirSync(d).filter((f) => f.endsWith(".json"))) {
        const key = `${dir}/${basename(fn, ".json")}`;
        const refVal = ref[key];
        const refOk = refVal && !refVal.startsWith("ERR:");

        let ours = null, ourErr = null;
        try {
            ours = compile(JSON.parse(readFileSync(join(d, fn), "utf8")));
        } catch (e) {
            ourErr = `${e?.message ?? e}`.slice(0, 88);
        }

        if (!refOk) {
            // The reference cannot do it either: nothing to prove.
            if (ours) problems.push([`${Y}extra${X}`, key, "we compiled it, rcj did not"]);
            else bothSkip++;
            continue;
        }
        if (!ours) {
            onlyRef++;
            problems.push([`${Y}missing${X}`, key, ourErr]);
            continue;
        }
        const refBuf = Buffer.from(refVal, "base64");
        if (Buffer.compare(Buffer.from(ours), refBuf) === 0) same++;
        else {
            diff++;
            let at = 0;
            while (at < Math.min(ours.length, refBuf.length) && ours[at] === refBuf[at]) at++;
            problems.push([`${R}differs${X}`, key, `${ours.length}B vs ${refBuf.length}B, first at byte ${at}`]);
        }
    }
}

for (const [tag, name, msg] of problems) console.log(`  ${tag}  ${name.padEnd(36)} ${D}${msg}${X}`);
const total = same + diff;
console.log(`\n${diff === 0 ? G : R}${same}/${total} byte-identical${X} ` +
            `${D}(${onlyRef} the reference does and we do not, ${bothSkip} neither does)${X}`);
