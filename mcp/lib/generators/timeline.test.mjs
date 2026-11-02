// node --test mcp/lib/generators/timeline.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { chooseTicks, packIntervals, timeKind, toHours } from "./timeline.mjs";
import { compileComponents } from "../json2rc.mjs";
import { createRequire } from "node:module";

const overlaps = (a, b) => a.start < b.end - 1e-9 && b.start < a.end - 1e-9;

test("no two intervals in a row overlap, and the row count is the deepest overlap", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let trial = 0; trial < 200; trial++) {
        const n = 1 + Math.floor(rnd() * 40);
        const iv = Array.from({ length: n }, () => { const s = Math.floor(rnd() * 100); return { start: s, end: s + 1 + Math.floor(rnd() * 20) }; });
        const { row, rows } = packIntervals(iv);
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (row[i] === row[j]) assert.ok(!overlaps(iv[i], iv[j]), `trial ${trial}: ${i} and ${j} share row ${row[i]}`);
        // greedy by start is optimal for intervals: rows = the most intervals over one point
        let depth = 0;
        for (const a of iv) depth = Math.max(depth, iv.filter((b) => b.start <= a.start && a.start < b.end).length);
        assert.equal(rows, depth, `trial ${trial}`);
    }
});

test("touching intervals share a row; the lowest free row is reused", () => {
    const { row, rows } = packIntervals([{ start: 0, end: 2 }, { start: 2, end: 4 }, { start: 1, end: 3 }, { start: 4, end: 5 }]);
    assert.deepEqual(row, [0, 0, 1, 0]);
    assert.equal(rows, 2);
});

test("times", () => {
    assert.equal(timeKind("09:30"), "day");
    assert.equal(timeKind("Tue 06:00"), "week");
    assert.equal(timeKind("2026-11-02"), "date");
    assert.equal(timeKind(3), "number");
    assert.equal(toHours("09:30"), 9.5);
    assert.equal(toHours("Tue 06:00"), 30);
    assert.equal(toHours("2026-11-03") - toHours("2026-11-02"), 24);
    assert.throws(() => timeKind("soon"), /write a number/);
});

test("ticks land on natural steps", () => {
    assert.equal(chooseTicks(0, 168, "week", 7).step, 24);
    assert.deepEqual(chooseTicks(8, 18, "day").ticks, [8, 10, 12, 14, 16, 18]);
    assert.equal(chooseTicks(0, 1000, "number").step, 200);
});

test("the generated document converts, with lanes, categories and a clock marker", () => {
    const { convert } = createRequire(import.meta.url)("../../../players/typescript/build-json2rc/Parser.js");
    const items = [["Mon 08:00", "Mon 16:00", "Day", "Ann"], ["Mon 22:00", "Tue 06:00", "Night", "Ann"], ["Mon 10:00", "Mon 12:00", "Meeting with a long name", "Ben"], ["Sun 22:00", "Mon 06:00", "Night", "Ben"]];
    const doc = { header: { apiLevel: 7, width: 360, height: 640, profiles: 513 }, root: { "$gen": { kind: "timeline", items, start: "Mon 00:00", end: "Sun 24:00", now: "clock" } } };
    for (const theme of ["auto", "mono-light"]) assert.ok(convert(compileComponents(doc, ".", { theme }).doc).length > 500);
});
