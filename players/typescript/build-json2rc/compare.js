// Compare the TypeScript converter against rcj's output for a list of documents.
// Usage: node compare.js <listfile> <rcjOutDir>
const fs = require("fs");
const path = require("path");
const { convert } = require("./Parser");
const [listFile, refDir] = process.argv.slice(2);
const files = fs.readFileSync(listFile, "utf8").split("\n").filter(Boolean);
let same = 0, diff = 0, unsupported = {}, errors = {};
for (const f of files) {
    const ref = path.join(refDir, f.replace(/[\/]/g, "_").replace(/\.json$/, "") + ".rc");
    if (!fs.existsSync(ref)) continue;
    let out;
    try {
        out = convert(fs.readFileSync(f, "utf8"));
    } catch (e) {
        const m = String(e.message).slice(0, 60);
        const bucket = e.name === "NotImplementedComponent" ? unsupported : errors;
        bucket[m] = (bucket[m] || 0) + 1;
        continue;
    }
    const want = fs.readFileSync(ref);
    if (Buffer.compare(Buffer.from(out), want) === 0) same++; else diff++;
}
const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
console.log(`  byte-identical to rcj : ${same}`);
console.log(`  differ                : ${diff}`);
console.log(`  unsupported           : ${Object.values(unsupported).reduce((a,b)=>a+b,0)}`);
console.log(`  other errors          : ${Object.values(errors).reduce((a,b)=>a+b,0)}`);
console.log("\n  top unsupported:");
for (const [m, n] of top(unsupported, 12)) console.log(`   ${String(n).padStart(4)}  ${m}`);
if (Object.keys(errors).length) {
    console.log("\n  top errors:");
    for (const [m, n] of top(errors, 6)) console.log(`   ${String(n).padStart(4)}  ${m}`);
}
