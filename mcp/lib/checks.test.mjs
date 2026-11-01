import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { changedCells, fitsSize, imageHash, loadPlan, normalizeAction, planPathOf, savePlan, splitSample, tapEvents } from "./checks.mjs";

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
    assert.deepEqual(splitSample({ n: 1, $tap: [3, 4], $size: [5, 6], $clock: "c" }), { values: { n: 1 }, clock: "c", taps: [[3, 4]], size: [5, 6] });
    assert.deepEqual(splitSample({ $tap: [[1, 2], [3, 4]] }).taps, [[1, 2], [3, 4]]);
    assert.deepEqual(splitSample(null), { values: {}, clock: undefined, taps: [], size: undefined });
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
