// The hints a conversion failure carries: where, the names meant, an example. Run: node --test mcp/lib/convert-hints.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { jsonToRc } from "./json2rc.mjs";
import { nearest } from "./convert-hints.mjs";

const header = { apiLevel: 7, width: 300, height: 200 };
const failure = (doc) => { try { jsonToRc(doc); } catch (e) { return e.message; } assert.fail("it converted"); };

test("an unknown name: where it is, the names meant, an example from the catalog", () => {
    let m = failure({ header, root: { canvas: { modifiers: ["fillMaxSize"], commands: [{ drawRectangle: { left: 0, top: 0, right: 5, bottom: 5 } }] } } });
    assert.match(m, /^json2rc failed: .*canvas command 'drawrectangle'/);
    assert.match(m, /\nWhere: root\.canvas\.commands\[0\]\.drawRectangle\n/);
    assert.match(m, /Did you mean: "drawRect"/);
    assert.match(m, /Example \([A-Z]+-\d+\): \{"drawRect":/);
    m = failure({ header, root: { column: { children: [{ txt: { text: "a" } }] } } });
    assert.match(m, /Where: root\.column\.children\[0\]\.txt[^]*Did you mean: "text"/);
    m = failure({ header, root: { box: { modifiers: [{ onClick: { type: "valueChange", target: "@x", value: 1 } }] } } });
    assert.match(m, /Did you mean: "valueFloatChange"/);
    m = failure({ header, root: { canvas: { commands: [{ paint: { ops: [{ colour: "#FF000000" }] } }] } } });
    assert.match(m, /paint\.ops\[0\]\.colour[^]*Did you mean: "color"/);
});

test("a name with a usual meaning but no spelling near it says what to write instead", () => {
    const m = failure({ header, root: { column: { modifiers: [{ margin: 8 }], children: [] } } });
    assert.match(m, /Where: root\.column\.modifiers\[0\]\.margin/);
    assert.match(m, /Instead: there is no margin: give the PARENT a \{"padding": n\}/);
});

test("a missing field: the example shows the whole form", () => {
    const m = failure({ header, root: { canvas: { commands: [{ drawCircle: { cx: 1, cy: 2 } }] } } });
    assert.match(m, /Where: root\.canvas\.commands\[0\]\.drawCircle\nExample \([A-Z]+-\d+\): \{"drawCircle":\{[^}]*"radius"/);
});

test("a theme colour misspelt: the nearest theme names, once", () => {
    const m = failure({ header, root: { text: { text: "a", color: "@colors.primry" } } });
    assert.match(m, /^components: theme colour 'primry'/);
    assert.match(m, /\nWhere: root\.text\.color\n/);
    assert.match(m, /Did you mean: "@colors\.primary"/);
});

test("a JSON syntax error: line, column, a caret and the likely cause", () => {
    const m = failure('{"header": {"apiLevel": 7},\n "root": {"text": {"text": "a",}}}');
    assert.match(m, /Where: line 2, column 32: /);
    const [where, caret] = m.split("\n").filter((l) => l.startsWith("Where") || /^\s+\^$/.test(l));
    assert.equal(where[caret.length - 1], "}", "the caret is under the character at fault");
    assert.match(m, /Likely: a trailing comma/);
});

test("a fault inside an inline component's body is located in its definition", () => {
    const doc = { header, components: { Dot: { params: {}, body: { canvas: { modifiers: [{ size: [8, 8] }], commands: [{ drawCirle: { cx: 4, cy: 4, radius: 3 } }] } } } },
        root: { column: { children: [{ text: { text: "x" } }, { Dot: {} }] } } };
    const m = failure(doc);
    assert.match(m, /\nWhere: components\.Dot\.body\.canvas\.commands\[0\]\.drawCirle\n/);
    assert.match(m, /Did you mean: "drawCircle"/);
});

test("nearest: spelling, case, containment and letters in order; nothing far", () => {
    assert.deepEqual(nearest("drawrectangle", ["drawRect", "drawCircle", "drawLine"]).slice(0, 1), ["drawRect"]);
    assert.deepEqual(nearest("PADDING", ["padding", "background"]), ["padding"]);
    assert.deepEqual(nearest("zzz", ["padding", "background"]), []);
});
