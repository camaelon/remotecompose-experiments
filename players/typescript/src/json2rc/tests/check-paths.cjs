// The path and loop cases, checked byte-for-byte against rcj.
//
// These exist because the corpus does not cover them: every document in it that uses a
// C or Q curve verb, or a named $paths. reference, is blocked by some *other* unsupported
// feature, so the curve branches of the SVG parser never run during the corpus sweep.
// Ported code that nothing executes is not ported code.
//
//   node src/json2rc/tests/check-paths.cjs [<rcJson dir>]
//
// Needs python3 and the rcj package, since rcj is the reference.
const fs = require("fs"), path = require("path"), cp = require("child_process");
const { convert } = require("../../../build-json2rc/Parser.js");
const RCJSON = process.argv[2] || "/Users/john/code/github/rcJson";
const DIR = path.join(__dirname, "paths");
const cases = fs.readdirSync(DIR).filter(f => f.endsWith(".json")).sort();

const py = `
import sys, json, binascii
sys.path.insert(0, ${JSON.stringify(RCJSON)})
import os, rcj
for f in sys.argv[1:]:
    try: print(binascii.hexlify(rcj.convert(open(f).read(), base_dir=os.path.dirname(f))).decode())
    except Exception as e: print("ERR " + type(e).__name__ + ": " + str(e)[:70])
`;
const r = cp.spawnSync("python3", ["-c", py, ...cases.map(c => path.join(DIR, c))],
                       { encoding: "utf8" });
if (r.status !== 0) { console.error(r.stderr || "python3 failed"); process.exit(2); }
const ref = r.stdout.trim().split("\n");

let same = 0, bad = 0;
cases.forEach((c, i) => {
    const name = c.slice(0, -5);
    let got;
    try {
        // Same base_dir rcj is given: a `file:` bitmap resolves next to its document.
        got = Buffer.from(convert(fs.readFileSync(path.join(DIR, c), "utf8"), {
            readFile: (p) => new Uint8Array(fs.readFileSync(path.resolve(DIR, p))),
        })).toString("hex");
    }
    catch (e) { got = "ERR " + e.name + ": " + String(e.message).slice(0, 70); }
    if (got === ref[i]) { same++; return; }
    bad++;
    console.log(`  FAIL  ${name}\n        rcj: ${ref[i]}\n        ts : ${got}`);
});
console.log(`  ${same}/${cases.length} byte-identical to rcj`);
process.exit(bad ? 1 : 0);
