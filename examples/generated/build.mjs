#!/usr/bin/env node
// The generated corpus: the documents the eval runs built from eval/prompt.md (an assistant
// using only the MCP tools), kept as examples of what a single prompt produces. Unlike the
// hand-made catalog they are not minimal or verified against Java; they are shown and searched
// only when asked for (include_generated, the site's toggle).
//
//   node examples/generated/build.mjs [--from DIR] [IDS...]
//
// --from: the eval runs' folder (NN-runK/...), from which the final documents are copied in
// (the sources table below); without it, the documents already here are rebuilt.
// Each folder gets doc.json, notes.md (the run's notes), doc.rc and render-<look>.png for
// light, dark, mono-dark and mono-light at a pinned clock; index.json lists them.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const { jsonToRc, compileComponents } = await import(path.join(ROOT, "mcp/lib/json2rc.mjs"));
const { usesComponents } = await import(path.join(ROOT, "mcp/lib/components.mjs"));
const { definition: render } = await import(path.join(ROOT, "mcp/rc-render-server.mjs"));
const renderRc = render.tools.find((t) => t.name === "render_rc").handler;

// The final document of each prompt's last run (eval/RUNS.md).
const SOURCES = {
    1: "01-run5/widget.json", 2: "02-run1/worldclock.json", 3: "03-run2/widget.json", 4: "04-run2/widget.json", 5: "05-run2/widget.json", 6: "06-run2/screen.json",
    7: "07-run1/face.json", 8: "08-run3/doc.json", 9: "09-run1/widget.json", 10: "10-run2/seasons.json", 11: "11-run1/weather.json",
    12: "12-run1/steps-tile.json", 13: "13-run1/widget.json", 14: "14-run1/ticker.json", 15: "15-run1/player.json", 16: "16-run1/home.json",
    17: "17-run1/tracker.json", 18: "18-run1/doc.json", 19: "19-run1/doc.json", 20: "20-run2/habits.json", 21: "21-run1/portfolio.json",
    22: "22-run1/widget.json", 23: "23-run1/doc.json", 24: "24-run2/board.json", 25: "25-run1/doc.json", 26: "26-run1/settings.json",
    27: "27-run1/login.json", 28: "28-run1/mixer.json", 29: "29-run1/tip.json", 30: "30-run1/doc.json", 31: "31-run1/todo.json",
    32: "32-run1/card.json", 33: "33-run2/activity.json", 34: "34-run1/stopwatch.json", 35: "35-run1/picker.json", 36: "36-run1/fitness.json",
    37: "37-run2/sales.json", 38: "38-run2/budget.json", 39: "39-run1/plant.json", 40: "40-run2/dash.json", 41: "41-run1/solar.json",
    42: "42-run1/water.json", 43: "43-run1/tile.json", 44: "44-run1/face.json", 45: "45-run2/notifications.json", 46: "46-run1/widget.json",
    47: "47-run1/dashboard.json", 48: "48-run2/boarding-pass.json", 49: "49-run2/recipe.json", 50: "50-run1/onboarding.json", 51: "51-run1/daynight.json",
    52: "52-run2/europe-visited.json", 53: "53-run2/tracker.json", 54: "54-run2/flight.json", 55: "55-run2/aus-weather.json", 56: "56-run1/planner.json", 57: "57-run1/engine.json",
};
const CLOCK = Date.UTC(2026, 9, 31, 10, 30);   // the eval's pinned day, as an instant
const LOOKS = [["light", { theme: "light" }], ["dark", { theme: "dark" }], ["mono-dark", { componentTheme: "mono-dark" }], ["mono-light", { componentTheme: "mono-light" }]];

const args = process.argv.slice(2);
const fromIdx = args.indexOf("--from");
const FROM = fromIdx >= 0 ? args[fromIdx + 1] : null;
const ids = args.filter((a, i) => !a.startsWith("--") && i !== fromIdx + 1).map(Number).filter(Boolean);

// The prompts, and each prompt's run line in RUNS.md (calls, dead ends).
const prompts = {};
for (const line of readFileSync(path.join(ROOT, "eval/prompt.md"), "utf8").split("\n")) {
    const m = /^(\d+)\.\s+(.*)$/.exec(line);
    if (m) prompts[+m[1]] = m[2].trim();
}
const runs = {}, titles = {};
{
    const text = readFileSync(path.join(ROOT, "eval/RUNS.md"), "utf8");
    for (const sec of text.split(/\n## Prompt /).slice(1)) {
        const n = parseInt(sec, 10);
        const t = /^\d+:\s*(.+)$/m.exec(sec);
        if (t) titles[n] = t[1].trim();
        const rows = [...sec.matchAll(/^\| (\d+) \| (\d+) \| ([^|]+) \| ([^|]+) \|/gm)];
        const last = rows[rows.length - 1];
        if (last) runs[n] = { run: +last[1], calls: +last[2], dead_ends: last[3].trim(), result: last[4].trim() };
    }
}

const slug = (s) => s.toLowerCase().replace(/^(a|an|the)\s+/, "").split(/[:,(]/)[0].replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").split("-").slice(0, 4).join("-");
const STOP = new Set("a an the and or with of for to in on at as by from my your its it is are be that this which into out over per each all".split(" "));
const keywordsOf = (p) => [...new Set(p.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)))];
const componentsOf = (doc) => {
    const out = new Set();
    const walk = (x) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) { if (/^[A-Z][A-Za-z]+$/.test(k) && v && typeof v === "object" && !Array.isArray(v)) out.add(k); walk(v); } };
    walk(doc.root);
    return [...out].sort();
};

const index = [];
for (const n of Object.keys(SOURCES).map(Number).sort((a, b) => a - b)) {
    const prompt = prompts[n];
    const title = titles[n] ? titles[n][0].toUpperCase() + titles[n].slice(1) : prompt.split(/[:.]/)[0];
    const folder = `${String(n).padStart(2, "0")}-${slug(titles[n] ?? prompt)}`;
    const dir = path.join(HERE, folder);
    if (FROM && (!ids.length || ids.includes(n))) {
        const src = path.join(FROM, SOURCES[n]);
        if (!existsSync(src)) { console.log(`skip ${n}: no ${src}`); continue; }
        mkdirSync(dir, { recursive: true });
        copyFileSync(src, path.join(dir, "doc.json"));
        const notes = path.join(path.dirname(src), "notes.md");
        if (existsSync(notes)) copyFileSync(notes, path.join(dir, "notes.md"));
    }
    if (!existsSync(path.join(dir, "doc.json"))) continue;
    const doc = JSON.parse(readFileSync(path.join(dir, "doc.json"), "utf8"));
    const entry = { id: `GEN-${String(n).padStart(2, "0")}`, folder: `generated/${folder}`, prompt, title,
        kind: "generated", source: `eval run ${runs[n]?.run ?? 1} of prompt ${n} (eval/RUNS.md)`, keywords: keywordsOf(prompt),
        components: componentsOf(doc), header: { width: doc.header?.width, height: doc.header?.height }, ...(runs[n] ? { run: runs[n] } : {}) };
    if (!ids.length || ids.includes(n)) {
        try {
            const rc = jsonToRc(doc, dir);
            writeFileSync(path.join(dir, "doc.rc"), rc);
            entry.bytes = rc.length;
            for (const [look, opt] of LOOKS) {
                const json = opt.componentTheme ? { ...doc, componentTheme: opt.componentTheme } : doc;
                if (opt.componentTheme && !usesComponents(json)) continue;
                await renderRc({ json, ...(opt.theme ? { theme: opt.theme } : {}), clock: CLOCK, base_dir: dir, output_path: path.join(dir, `render-${look}.png`), public_link: false });
            }
            console.log(`ok   ${entry.id} ${folder} (${rc.length} B)`);
        } catch (e) { entry.error = String(e.message ?? e).split("\n")[0]; console.log(`FAIL ${entry.id} ${folder}: ${entry.error}`); }
    } else if (existsSync(path.join(dir, "doc.rc"))) entry.bytes = readFileSync(path.join(dir, "doc.rc")).length;
    // The catalog's main image is render.png: the light look.
    if (existsSync(path.join(dir, "render-light.png"))) copyFileSync(path.join(dir, "render-light.png"), path.join(dir, "render.png"));
    entry.renders = readdirSync(dir).filter((f) => /^render-.*\.png$/.test(f)).map((f) => f.slice(7, -4));
    index.push(entry);
}
writeFileSync(path.join(HERE, "index.json"), JSON.stringify({ about: "Documents the eval runs built from eval/prompt.md with only the MCP tools: one per prompt, not minimal, not Java-verified. Shown and searched only on request (include_generated).", examples: index }, null, 1) + "\n");
console.log(`${index.length} generated example(s)`);
