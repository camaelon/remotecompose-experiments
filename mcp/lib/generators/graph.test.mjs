// node --test mcp/lib/generators/graph.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { assignLayers, countCrossings, crossingsBetween, findBackEdges, layoutGraph, parseGraph, generate } from "./graph.mjs";
import { compileComponents } from "../json2rc.mjs";
import { createRequire } from "node:module";

test("longest-path layering: chain, diamond, and a source pulled down to its successor", () => {
    assert.deepEqual(assignLayers(3, [[0, 1], [1, 2]]), [0, 1, 2]);
    assert.deepEqual(assignLayers(4, [[0, 1], [0, 2], [1, 3], [2, 3]]), [0, 1, 1, 2]);
    // 0 -> 1 -> 2 -> 3, and a lone source 4 -> 3: 4 sits just above 3, not at the top
    assert.deepEqual(assignLayers(5, [[0, 1], [1, 2], [2, 3], [4, 3]]), [0, 1, 2, 3, 2]);
    // a long edge spans layers: 0 -> 2 directly and through 1
    assert.deepEqual(assignLayers(3, [[0, 1], [1, 2], [0, 2]]), [0, 1, 2]);
});

test("a cycle is broken by reversing the edge back to the start", () => {
    const back = findBackEdges(3, [[0, 1], [1, 2], [2, 0]]);
    assert.deepEqual([...back], [2]);
    const lay = layoutGraph(3, [[0, 1], [1, 2], [2, 0]]);
    assert.deepEqual(lay.layer.slice(0, 3), [0, 1, 2]);
    assert.ok(lay.reversed.has(2));
});

test("crossing count on known small graphs", () => {
    // two edges drawn as an X
    assert.equal(crossingsBetween([[0, 2], [1, 3]], { 0: 0, 1: 1 }, { 2: 1, 3: 0 }), 1);
    assert.equal(crossingsBetween([[0, 2], [1, 3]], { 0: 0, 1: 1 }, { 2: 0, 3: 1 }), 0);
    // K(3,3) between two layers crosses C(3,2) * C(3,2) = 9 times in any order
    const k33 = [];
    for (const u of [0, 1, 2]) for (const v of [3, 4, 5]) k33.push([u, v]);
    assert.equal(countCrossings([[0, 1, 2], [3, 4, 5]], [k33]), 9);
    assert.equal(countCrossings([[2, 0, 1], [4, 5, 3]], [k33]), 9);
    // edges sharing an end never cross
    assert.equal(crossingsBetween([[0, 2], [0, 3]], { 0: 0 }, { 2: 1, 3: 0 }), 0);
});

test("barycentre sweeps untangle a twisted ladder to zero crossings", () => {
    // a0 a1 a2 over b2 b1 b0 (inputs listed so the first order crosses) and on to c
    const edges = [[0, 5], [1, 4], [2, 3], [3, 6], [4, 7], [5, 8]];
    const lay = layoutGraph(9, edges);
    assert.equal(lay.crossings, 0);
    // a tree with a cross link: still planar
    const t = layoutGraph(7, [[0, 1], [0, 2], [1, 3], [1, 4], [2, 5], [2, 6], [3, 6]]);
    assert.ok(t.crossings <= 1, `crossings ${t.crossings}`);
});

test("coordinates keep each layer's order and spacing; a single child sits under its parent", () => {
    const lay = layoutGraph(6, [[0, 1], [0, 2], [0, 3], [1, 4], [3, 5]]);
    for (const row of lay.order) {
        for (let i = 1; i < row.length; i++) assert.ok(lay.across[row[i]] - lay.across[row[i - 1]] >= 0.29, "spacing");
    }
    assert.ok(Math.abs(lay.across[4] - lay.across[1]) < 0.07, "4 under 1");
    // the parent is centred over its three children
    assert.ok(Math.abs(lay.across[0] - lay.across[2]) < 0.07, "0 over the middle child");
});

test("long edges get one dummy per layer they pass", () => {
    const lay = layoutGraph(4, [[0, 1], [1, 2], [2, 3], [0, 3]]);
    const chain = lay.chains[3];
    assert.equal(chain.length, 4);
    assert.ok(chain.slice(1, -1).every((v) => lay.isDummy[v]));
});

test("input forms: strings, arrays, objects, chains", () => {
    const g = parseGraph({ edges: ["Plan > Build > Ship", ["Ship", "Plan", "again"]] });
    assert.deepEqual(g.nodes.map((n) => n.id), ["Plan", "Build", "Ship"]);
    assert.equal(g.edges.length, 3);
    assert.equal(g.edges[2].label, "again");
    assert.throws(() => parseGraph({ nodes: ["a"], edges: [["a", "b"]] }), /no node 'b'/);
});

test("the generated document converts, in colour and mono, 3 to 12 nodes", () => {
    const { convert } = createRequire(import.meta.url)("../../../players/typescript/build-json2rc/Parser.js");
    for (const n of [3, 7, 12]) {
        const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `Step number ${i} with a long label`, status: ["ok", "active", "pending", "failed"][i % 4] }));
        const edges = nodes.slice(1).map((_, i) => [`n${Math.floor(i / 2)}`, `n${i + 1}`, i % 3 ? undefined : "yes"]);
        const doc = { header: { apiLevel: 7, width: 360, height: 640, profiles: 513 }, root: { "$gen": { kind: "graph", nodes, edges } } };
        for (const theme of ["auto", "mono-dark"]) {
            const out = compileComponents(doc, ".", { theme }).doc;
            assert.ok(convert(out).length > 1000);
        }
    }
});

test("current: reached-from steps are done, the branch not taken stays pending", async () => {
    const { currentOf } = await import("./graph.mjs");
    const spec = { nodes: ["open", "triage", "simple", "eng", "closed"], edges: ["open > triage", "triage > simple", "triage > eng", "simple > closed", "eng > closed"] };
    const g = parseGraph(spec);
    const idx = new Map(g.nodes.map((n, i) => [n.id, i]));
    const lay = layoutGraph(g.nodes.length, g.edges.map((e) => [idx.get(e.from), idx.get(e.to)]));
    const st = currentOf({ current: "eng" }, g.nodes, lay, {}, () => "@x");
    assert.deepEqual(st.status, ["ok", "ok", "pending", "active", "pending"]);
    // a run-time index: three visibility variables per step and one N x N table
    let table;
    const vars = [];
    const dyn = currentOf({ current: "@currentStep" }, g.nodes, lay, { floatArray: (h, t) => { table = t; return "@t"; } }, (n, v) => { vars.push([n, v]); return `@${n}`; });
    assert.equal(table.length, 25);
    assert.equal(table[1 * 5 + 3], 1);   // triage reaches eng
    assert.equal(table[2 * 5 + 3], 0);   // simple does not
    assert.ok(dyn.vis.every((v) => v && v.done && v.act && v.pend));
    // a failed step keeps its status
    const g2 = parseGraph({ nodes: ["a", { id: "b", status: "failed" }, "c"], edges: ["a > b > c"] });
    const lay2 = layoutGraph(3, [[0, 1], [1, 2]]);
    assert.deepEqual(currentOf({ current: 2 }, g2.nodes, lay2, {}, () => "@x").status, ["ok", "failed", "active"]);
});
