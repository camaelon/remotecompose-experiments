import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { layoutFaults, oddNumber, visibleLeaves, dragEvents, changedCells, compareExpected, findTapTarget, fitsSize, imageHash, loadPlan, normalizeAction, planPathOf, setVariables, savePlan, splitSample, summarizeInspection, tapEvents, targetWords } from "./checks.mjs";

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

test("visibleLeaves skips hidden subtrees and keeps texts and drawings", () => {
    const b = { x: 0, y: 0, w: 10, h: 10 };
    const tree = [{ component: "Column", id: 1, bounds: b, children: [
        { component: "CoreText", id: 2, text: "A", bounds: b },
        { component: "CanvasLayout", id: 3, bounds: b },
        { component: "CanvasContent", id: 4, bounds: b },
        { component: "Row", id: 5, hidden: true, bounds: b, children: [{ component: "CoreText", id: 6, text: "gone", bounds: b }] },
    ] }];
    assert.deepEqual(visibleLeaves(tree).map((l) => l.id), [2, 3]);
});

test("layoutFaults reports what would need looking at", () => {
    const box = (x, y, w, h) => ({ x, y, w, h });
    const big = { size: [360, 480], leaves: [{ id: 1, text: "Title", box: box(0, 0, 100, 20) }, { id: 2, drawing: true, box: box(0, 30, 200, 200) }], targets: [] };
    const small = { size: [160, 100], leaves: [{ id: 2, drawing: true, box: box(0, 0, 12, 12) }, { id: 7, text: "a", box: box(0, 0, 50, 20) }, { id: 8, text: "b", box: box(5, 2, 50, 20) }],
        targets: [{ bounds: box(0, 0, 48, 48) }, { bounds: box(0, 10, 48, 48) }] };
    const r = layoutFaults([big, small]);
    assert.deepEqual(r.dropped, ['at 160×100: "Title"']);
    const codes = r.warnings.map((w) => /\[(\w+)\]/.exec(w)[1]).sort();
    assert.deepEqual(codes, ["overlapping_targets", "overlapping_text", "shrunk_content"]);
    assert.deepEqual(layoutFaults([big]).warnings, []);
});

test("layoutFaults reports a squashed chart, text past the window and odd numbers", () => {
    const box = (x, y, w, h) => ({ x, y, w, h });
    const big = { size: [360, 480], leaves: [{ id: 1, drawing: true, box: box(0, 0, 360, 200) }, { id: 2, drawing: true, box: box(0, 210, 360, 4) }], targets: [] };
    const small = { size: [200, 100], leaves: [{ id: 1, drawing: true, box: box(0, 0, 200, 3) }, { id: 2, drawing: true, box: box(0, 5, 200, 4) },
        { id: 3, text: "$4.98", box: box(0, 90, 50, 20) }, { id: 4, text: "behind a scroll", box: box(0, 200, 50, 20), scrolled: true }, { id: 5, text: "$0.3", box: box(60, 0, 40, 20) }], targets: [] };
    const w = layoutFaults([big, small]).warnings.join("\n");
    assert.match(w, /\[squashed_content\] at 200×100 a drawing is 200×3/);
    assert.equal((w.match(/squashed_content/g) ?? []).length, 1);   // (a bar thin at both sizes is not squashed)
    assert.match(w, /\[cut_by_window\] at 200×100: "\$4.98"/);
    assert.doesNotMatch(w, /behind a scroll/);
    assert.match(w, /\[odd_number\] at 200×100: "\$0.3"/);
});

test("oddNumber tells noise from ordinary numbers", () => {
    for (const t of ["38.400002M", "0.23E-40", "$0.3", "€12.5 saved"]) assert.ok(oddNumber(t), t);
    for (const t of ["$0.30", "$1,234.50", "3.14", "12.5 km", "E10", "$5", "v1.2.3"]) assert.ok(!oddNumber(t), t);
});
