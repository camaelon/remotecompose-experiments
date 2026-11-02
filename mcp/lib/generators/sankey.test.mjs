// node --test mcp/lib/generators/sankey.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { nodes, generate } from "./sankey.mjs";
import { compileComponents } from "../json2rc.mjs";

const ctx = () => { let n = 0; return { unique: (p) => `${p}${++n}`, mono: false }; };

test("nodes accept strings, pairs and objects, with default colours", () => {
    const out = nodes(["A", ["B", "@colors.x"], { label: "C" }], ["@colors.d0", "@colors.d1", "@colors.d2"], "sources");
    assert.deepEqual(out.map((o) => o.color), ["@colors.d0", "@colors.x", "@colors.d2"]);
    assert.throws(() => nodes([], [], "uses"));
});

test("one ribbon per pair, offsets chained, no expression too long", () => {
    const g = generate({ flows: "@f", sources: ["A", "B", "C"], uses: ["X", "Y"] }, ctx());
    const s = JSON.stringify(g);
    assert.equal((s.match(/"pathExpression"/g) || []).length, 6);
    // ya of (1, 1) builds on ya of (1, 0); yb of (1, 1) on yb of (0, 1)
    assert.ok(s.includes('"name":"sankey1_ya3","value":"@sankey1_ya2 + @sankey1_f2 * @sankey1_k"'));
    assert.ok(s.includes('"name":"sankey1_yb3","value":"@sankey1_yb1 + @sankey1_f1 * @sankey1_k"'));
    assert.throws(() => generate({ flows: "f", sources: ["A"], uses: ["X"] }, ctx()));
});

test("the component expands and converts, mono drops the particles", () => {
    const doc = { header: { apiLevel: 7, width: 360, height: 300, profiles: 513 },
        resources: { floatArrays: { fl: { value: [1, 2, 3, 4], export: true } } },
        root: { Sankey: { flows: "@fl", sources: ["A", "B"], uses: ["X", "Y"] } } };
    const ex = compileComponents(doc, ".", {});
    assert.ok(JSON.stringify(ex.doc).includes("continuousSec"));
    const mono = compileComponents(doc, ".", { theme: "mono-dark" });
    assert.ok(!JSON.stringify(mono.doc).includes("continuousSec"));
});
