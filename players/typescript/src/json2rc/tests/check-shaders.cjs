// AGSL runtime shaders (DATA_SHADER), checked byte-for-byte against the Java reference.
//
// rcj has no runtime shaders, so the reference here is androidx's RemoteComposeJsonParser
// itself: each <case>.rc next to its <case>.json is what parseToByteBuffer produced for it.
// The cases cover a bare AGSL string, {agsl, uniforms} with scalar, vector and animated
// (expression) uniforms, the `ops` paint form, a `uniform shader` input, and fourteen
// uniforms — enough to resize the java.util.HashMap whose iteration order the uniforms are
// written in.
//
//   node src/json2rc/tests/check-shaders.cjs
const fs = require("fs"), path = require("path");
const { convert } = require("../../../build-json2rc/Parser.js");
const DIR = path.join(__dirname, "shaders");
const cases = fs.readdirSync(DIR).filter(f => f.endsWith(".json")).sort();
let bad = 0;
for (const c of cases) {
    const name = c.slice(0, -5);
    const want = fs.readFileSync(path.join(DIR, name + ".rc"));
    let got;
    try { got = Buffer.from(convert(fs.readFileSync(path.join(DIR, c), "utf8"))); }
    catch (e) { got = null; console.log(`  ${name}: ${e.name}: ${e.message}`); }
    if (got && got.equals(want)) continue;
    bad++;
    if (got) {
        let i = 0;
        while (i < got.length && got[i] === want[i]) i++;
        console.log(`  ${name}: differs at byte ${i} (java ${want.length} bytes, ts ${got.length})`);
    }
}
console.log(`  ${cases.length - bad}/${cases.length} byte-identical to the Java reference`);
process.exit(bad ? 1 : 0);
