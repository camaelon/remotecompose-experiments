// Plain JS so it needs no @types/node: json2rc <in.json> <out.rc>
const fs = require("fs");
const { convert } = require("./Parser");
const a = process.argv.slice(2);
if (a.length < 2) { console.error("usage: cli.js <in.json> <out.rc>"); process.exit(2); }
try {
    const out = convert(fs.readFileSync(a[0], "utf8"));
    fs.writeFileSync(a[1], Buffer.from(out));
    console.error(`${out.length}`);
} catch (e) { console.error(`${e.name}: ${e.message}`); process.exit(1); }
