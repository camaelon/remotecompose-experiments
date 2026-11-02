// node --test mcp/lib/generators/splitflap.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { codesOf, DEFAULT_DRUM, generate } from "./splitflap.mjs";
import { compileComponents, jsonToRc } from "../json2rc.mjs";

const ctx = (mono = false) => {
    const arrays = new Map();
    return { mono, unique: (p) => `${p}1`, floatArray: (h, n) => { arrays.set(h, n); return `@${h}`; }, arrays };
};
const walk = (n, f) => { if (Array.isArray(n)) n.forEach((x) => walk(x, f)); else if (n && typeof n === "object") { f(n); Object.values(n).forEach((x) => walk(x, f)); } };

test("text becomes drum indices, case-insensitive; an unknown character is an error", () => {
    assert.deepEqual(codesOf("A9 :"), [1, 36, 0, 37]);
    assert.deepEqual(codesOf("ab"), [1, 2]);
    assert.throws(() => codesOf("é"), /not on the drum/);
    assert.equal(DEFAULT_DRUM[0], " ");
});

test("a text call sizes itself to its tiles and declares its codes", () => {
    const c = ctx();
    const out = generate({ text: "HELLO", tileWidth: 20, gap: 2, tileHeight: 30, rows: 1, rowGap: 8 }, c);
    assert.deepEqual(out.canvas.modifiers[0], { size: [5 * 22 - 2, 30] });
    assert.deepEqual(c.arrays.get("sf1_text"), [8, 5, 12, 12, 15]);
});

test("the flip steps forward: steps are (new - old) mod the drum size", () => {
    const out = generate({ code: "5", prev: "7", tiles: 1, width: 28, height: 40 }, ctx());
    let n = null;
    walk(out, (o) => { if (o.variable?.name === "sf1n") n = o.variable.value; });
    assert.match(n, /\+ 40\) % 40/);
});

test("mono draws the final glyph only: one slice per tile, no flap, outline tiles", () => {
    const out = generate({ text: "AB" }, ctx(true));
    let subs = 0, scales = 0;
    walk(out, (o) => { if (o.textSubtext) subs++; if (o.scale) scales++; });
    assert.equal(subs, 1); assert.equal(scales, 0);
});

test("a document with a SplitFlap converts", () => {
    const doc = { header: { apiLevel: 7, width: 300, height: 60, profiles: 513 },
        root: { box: { children: [{ SplitFlap: { text: "GATE 12" } }] } } };
    for (const theme of [undefined, "mono-dark"]) {
        const ex = compileComponents(doc, ".", theme ? { theme } : {});
        assert.ok(jsonToRc(ex.doc, ".").length > 500);
    }
});
