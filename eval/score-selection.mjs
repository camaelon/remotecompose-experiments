// Scores build_kit's start against hand labels (docs/structures/labels.json), no model involved:
//   node eval/score-selection.mjs [--miss]
// Even prompts are the held-out set: the classifier's signals were written from the odd ones.
import { readFileSync } from "node:fs";
import { buildKit } from "../mcp/lib/catalog.mjs";
import { STRUCTURES, classifyStructure } from "../mcp/lib/structures.mjs";
const here = new URL("../docs/structures/", import.meta.url);
const labels = JSON.parse(readFileSync(new URL("labels.json", here)));
const old = JSON.parse(readFileSync(new URL("selection.json", here))).prompts;
const tag = (id) => STRUCTURES.filter((s) => s.examples.includes(id)).map((s) => s.id);
const row = () => ({ n: 0, classified: 0, model: 0, oldModel: 0 });
const sets = { odd: row(), even: row(), all: row() };
const misses = [];
for (const [k, v] of Object.entries(labels)) {
    if (v.structure === "none") continue;
    const guess = classifyStructure(v.prompt)?.structure.id ?? null;
    const model = buildKit({ goal: v.prompt, max_examples: 4 }).layout_model?.id;
    const ok = guess === v.structure, mok = tag(model).includes(v.structure), oldOk = tag(old[k]?.layout_model?.id).includes(v.structure);
    for (const s of [sets.all, Number(k) % 2 ? sets.odd : sets.even]) { s.n++; s.classified += ok; s.model += mok; s.oldModel += oldOk; }
    if (!ok) misses.push(`${k} ${v.structure} -> ${guess} (${model}): ${v.prompt.slice(0, 80)}`);
}
for (const [name, s] of Object.entries(sets)) console.log(`${name.padEnd(5)} prompts ${s.n}: structure right ${s.classified}, start example of the right structure ${s.model} (was ${s.oldModel})`);
if (process.argv.includes("--miss")) console.log(misses.join("\n"));
