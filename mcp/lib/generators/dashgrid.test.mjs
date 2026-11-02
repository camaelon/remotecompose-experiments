// node --test mcp/lib/generators/dashgrid.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { pack } from "./dashgrid.mjs";
import { compileComponents } from "../json2rc.mjs";

const card = (span = 1, h = 100, priority = 1) => ({ span, h, priority });

test("every row of every column count is full: no holes", () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let trial = 0; trial < 300; trial++) {
        const cards = Array.from({ length: 1 + Math.floor(rnd() * 10) }, () => card(1 + Math.floor(rnd() * 3), 50 + Math.floor(rnd() * 200), rnd() < 0.2 ? 2 : 1));
        for (let c = 1; c <= 4; c++) {
            const pk = pack(cards, c);
            const rows = new Map();
            pk.cards.forEach((o, i) => {
                if (!o) { assert.ok(cards[i].priority > c); return; }
                rows.set(o.row, (rows.get(o.row) ?? 0) + o.units);
            });
            for (const used of rows.values()) assert.ok(Math.abs(used - c) < 1e-9, `row uses ${used} of ${c}`);
        }
    }
});

test("cards in a row share the tallest height; one column keeps each its own", () => {
    const cards = [card(1, 80), card(1, 120), card(2, 150)];
    assert.deepEqual(pack(cards, 1).cards.map((o) => o.h), [80, 120, 150]);
    assert.deepEqual(pack(cards, 4).cards.map((o) => o.h), [150, 150, 150]);
    // 3 columns: the span-2 chart does not fit beside two cards, so they widen to 1.5 each
    const p3 = pack(cards, 3);
    assert.deepEqual(p3.cards.map((o) => o.units), [1.5, 1.5, 3]);
});

test("the component expands and converts", () => {
    const doc = { header: { apiLevel: 7, width: 360, height: 640, profiles: 513 },
        root: { DashboardGrid: { title: "T", cards: [
            { title: "A", content: { text: { value: "@cardWidth", color: "@colors.onSurface" } }, height: 40 },
            { title: "B", span: 2, priority: 2, content: { box: { modifiers: [{ width: "@cardWidth" }, { height: "@cardHeight" }] } } },
        ] } } };
    const ex = compileComponents(doc, ".", {});
    const s = JSON.stringify(ex.doc);
    assert.ok(!s.includes("@cardHeight") && s.includes("visibility"));
});
