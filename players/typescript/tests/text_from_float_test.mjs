// TextFromFloat against the Java reference (same fixture as the C++ test):
//   node players/typescript/tests/text_from_float_test.mjs [FILE.tsv]
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const ts = path.join(here, "..");
const file = process.argv[2] ?? path.join(here, "../../cpp/tests/fixtures/text_from_float_java.tsv");
const dir = mkdtempSync(path.join(os.tmpdir(), "tff-"));
const out = path.join(dir, "tff.mjs");
execFileSync("npx", ["esbuild", "src/core/operations/TextFromFloat.ts", "--bundle", "--platform=node", "--format=esm",
    `--outfile=${out}`, "--log-level=error"], { cwd: ts, stdio: "inherit" });
const { TextFromFloat } = await import(pathToFileURL(out).href);
rmSync(dir, { recursive: true });

let text = "";
const ctx = { loadText: (_id, s) => { text = s; }, getFloat: () => 0 };
let cases = 0, bad = 0;
for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    const [bits, before, after, flags, want] = line.split("\t");
    new TextFromFloat(50, Number(bits) | 0, Number(before), Number(after), Number(flags)).apply(ctx);
    cases++;
    if (`[${text}]` !== want && bad++ < 40) {
        console.log(`FAIL bits=${bits} before=${before} after=${after} flags=${flags} java ${want} got [${text}]`);
    }
}
console.log(`${cases} cases, ${bad} differ from Java`);
process.exit(bad ? 1 : 0);
