// Every differing document, smallest first, with where and how it diverges.
const fs = require("fs"), path = require("path");
const { convert } = require("./Parser");
const [listFile, refDir, limit] = process.argv.slice(2);
const out = [];
for (const f of fs.readFileSync(listFile, "utf8").split("\n").filter(Boolean)) {
    const ref = path.join(refDir, f.replace(/[\/]/g, "_").replace(/\.json$/, "") + ".rc");
    if (!fs.existsSync(ref)) continue;
    let got; try { got = Buffer.from(convert(fs.readFileSync(f, "utf8"))); } catch { continue; }
    const want = fs.readFileSync(ref);
    if (Buffer.compare(got, want) === 0) continue;
    let i = 0; while (i < Math.min(got.length, want.length) && got[i] === want[i]) i++;
    out.push({ f, got: got.length, want: want.length, at: i,
               g: got[i] ?? -1, w: want[i] ?? -1 });
}
out.sort((a, b) => a.want - b.want);
for (const r of out.slice(0, Number(limit || 12))) {
    console.log(`  ${String(r.want).padStart(6)}B want / ${String(r.got).padStart(6)}B got  ` +
                `@${String(r.at).padStart(5)}  op ${String(r.w).padStart(3)} vs ${String(r.g).padStart(3)}  ${r.f}`);
}
console.log(`  --- ${out.length} differing`);
