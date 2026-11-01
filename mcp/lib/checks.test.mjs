import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { dragEvents, changedCells, compareExpected, findTapTarget, fitsSize, imageHash, loadPlan, normalizeAction, planPathOf, setVariables, savePlan, splitSample, summarizeInspection, tapEvents, targetWords } from "./checks.mjs";

test("planPathOf: one plan for a document's json and rc", () => {
    assert.equal(planPathOf("out/a.json"), "out/a.checks.json");
    assert.equal(planPathOf("out/a.rc"), "out/a.checks.json");
});

test("savePlan and loadPlan keep the check and the hashes, not the document", () => {
    const f = path.join(mkdtempSync(path.join(tmpdir(), "checks-")), "a.checks.json");
    assert.equal(loadPlan(f), null);
    savePlan(f, { looks: ["light"], sizes: [[1, 2]], json: { big: true }, output_path: "x.png" }, { a: "1" });
    assert.deepEqual(loadPlan(f), { hashes: { a: "1" }, looks: ["light"], sizes: [[1, 2]] });
});

test("splitSample separates the special keys from host values", () => {
    assert.deepEqual(splitSample({ n: 1, $tap: [3, 4], $size: [5, 6], $clock: "c" }), { values: { n: 1 }, clock: "c", taps: [[3, 4]], drag: undefined, size: [5, 6], wait: undefined, expect: undefined });
    assert.deepEqual(splitSample({ $tap: [[1, 2], [3, 4]] }).taps, [[1, 2], [3, 4]]);
    assert.deepEqual(splitSample(null).taps, []);
    assert.deepEqual(splitSample({ $tap: "Start" }).taps, ["Start"]);
    assert.deepEqual(splitSample({ $tap: ["Start", [1, 2]] }).taps, ["Start", [1, 2]]);
    const s = splitSample({ $wait: 3, $expect: { a: 1 }, b: 2 });
    assert.deepEqual([s.wait, s.expect, s.values], [3, { a: 1 }, { b: 2 }]);
});

test("tapEvents spaces taps in time", () => {
    const e = tapEvents([[1, 2], [3, 4]]);
    assert.deepEqual(e.map((x) => [x.type, x.x, x.y]), [["tap", 1, 2], ["tap", 3, 4]]);
    assert.ok(e[1].t > e[0].t);
});

test("normalizeAction accepts the forms callers guess", () => {
    assert.deepEqual(normalizeAction({ $tap: [1, 2] }), { tap: [1, 2] });
    assert.deepEqual(normalizeAction({ type: "tap", x: 1, y: 2 }), { tap: [1, 2] });
    assert.deepEqual(normalizeAction({ type: "wait", seconds: 2 }), { wait: 2 });
    assert.deepEqual(normalizeAction({ target: 0 }), { target: 0 });
});

test("findTapTarget matches a target's words, whole before part", () => {
    const targets = [{ component_id: -1, center: [1, 1] }, { component_id: -2, center: [2, 2] }];
    const nodes = [{ id: -1, content_description: "Start the timer", merged: ["Start"] }, { id: -2, content_description: "Restart" }];
    assert.equal(findTapTarget("start", targets, nodes).center[0], 1);
    assert.equal(findTapTarget("RESTART", targets, nodes).center[0], 2);
    assert.equal(findTapTarget("nope", targets, nodes), null);
    assert.deepEqual(targetWords(targets[0], nodes), ["Start the timer", "Start"]);
});

test("compareExpected tolerates float noise and compares text", () => {
    const r = compareExpected({ a: 3, b: "x", c: 1 }, { a: 3.001, b: "x", c: 2 });
    assert.deepEqual(r.map((x) => x.ok), [true, true, false]);
    assert.equal(compareExpected({ a: 1 }, {})[0].ok, false);
});

test("summarizeInspection is short and names disagreements", () => {
    const nodes = [{ id: -1, content_description: "Start", state: "Off" }];
    const lines = summarizeInspection({ nodes, targetsBySize: [{ size: [10, 20], targets: [{ component_id: -1, center: [1.4, 2.6], component: "Box" }], nodes }],
        engines: [{ size: [10, 20], structural: 0 }], repaint: "idle" });
    assert.deepEqual(lines, ['screen reader: "Start, Off"', 'tap targets at 10×20: "Start" at 1,3', "players: same structure in C++ and TypeScript.", "repaint: idle"]);
    assert.match(summarizeInspection({ engines: [{ size: [1, 2], structural: 2 }] })[0], /disagree/);
});

test("setVariables changes starting values, not formulas, and names what it can set", () => {
    const doc = { resources: { variables: { a: { value: 1, export: true }, b: 2, f: "@a + 1" } }, root: [{ variable: { name: "s", vtype: "string", value: "x" } }] };
    const r = setVariables(doc, { a: 5, b: 6, s: "y" });
    assert.equal(r.resources.variables.a.value, 5);
    assert.equal(r.resources.variables.b, 6);
    assert.equal(r.root[0].variable.value, "y");
    assert.equal(doc.resources.variables.a.value, 1);
    assert.throws(() => setVariables(doc, { f: 1 }), /It can set: a, b, s/);
});

test("dragEvents press, move and lift in order", () => {
    const e = dragEvents([0, 0, 40, 0], 1);
    assert.deepEqual(e.map((x) => x.type), ["down", "move", "move", "move", "move", "up"]);
    assert.ok(e.every((x, i) => i === 0 || x.t > e[i - 1].t));
    assert.equal(e.at(-1).x, 40);
});

test("fitsSize: no $size fits all", () => {
    assert.ok(fitsSize(undefined, 1, 2));
    assert.ok(fitsSize([1, 2], 1, 2));
    assert.ok(!fitsSize([1, 3], 1, 2));
});

test("changedCells: same hash is unchanged; new, failed and show-all are not", () => {
    const h = imageHash("x");
    const cells = [{ label: "a", hash: h }, { label: "b", hash: h }, { label: "c" }];
    const r = changedCells(cells, { a: h, b: "other", c: h });
    assert.deepEqual(r.unchanged, ["a"]);
    assert.deepEqual([...r.changed], ["b", "c"]);
    assert.deepEqual(changedCells(cells, { a: h }, true).unchanged, []);
    assert.deepEqual(changedCells(cells, null).unchanged, []);
});
