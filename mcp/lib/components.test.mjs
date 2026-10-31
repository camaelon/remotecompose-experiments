// Checks for the component expander (components.mjs). Run: node --test mcp/lib/components.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { expandComponents, foldStatic, lintComponent, loadLibrary, monoPalettes, MONO_VAR, MONO_OFF } from "./components.mjs";
import { jsonToRc } from "./json2rc.mjs";

// A small library of its own, so the checks don't move with the real components.
const lib = (components) => ({
    components: new Map(Object.entries(components).map(([name, def]) => [name, { component: name, ...def }])),
    theme: { colors: { primary: "#FF0000FF" }, numbers: { pad: 8 } },
});
const expand = (doc, components) => expandComponents(doc, { library: lib(components), mode: "expand" }).doc;
const flat = (x) => JSON.stringify(x);

const Meter = {
    params: { value: { type: "float", required: true }, max: { type: "float", default: 100 } },
    locals: { frac: "@value / @max", sweep: "clamp(0, 240, @frac * 240)" },
    body: { canvas: { commands: [
        { drawArc: { sweepAngle: "@sweep" } },
        { paint: { ops: [{ alpha: "step(@frac, 0.6)" }] } },
    ] } },
};

test("an expression local is one resources variable that every use reads", () => {
    const doc = expand({ resources: { variables: { cpu: 42 } }, root: { Meter: { value: "@cpu" } } }, { Meter });
    assert.deepEqual(doc.resources.variables, {
        cpu: 42, meter1_frac: "@cpu / 100", meter1_sweep: "clamp(0, 240, @meter1_frac * 240)",
    });
    const cmds = doc.root.canvas.commands;
    assert.equal(cmds[0].drawArc.sweepAngle, "@meter1_sweep");
    assert.equal(cmds[1].paint.ops[0].alpha, "step(@meter1_frac, 0.6)");
});

test("each call gets its own locals", () => {
    const doc = expand({ resources: { variables: { a: 1, b: 2 } },
        root: { row: { children: [{ Meter: { value: "@a" } }, { Meter: { value: "@b" } }] } } }, { Meter });
    assert.equal(doc.resources.variables.meter1_frac, "@a / 100");
    assert.equal(doc.resources.variables.meter2_frac, "@b / 100");
});

test("a local over static numbers folds to a literal, and so do the expressions using it", () => {
    const doc = expand({ root: { Meter: { value: 72 } } }, { Meter });
    assert.equal(doc.resources, undefined);
    assert.equal(doc.root.canvas.commands[0].drawArc.sweepAngle, 172.8);
    assert.equal(doc.root.canvas.commands[1].paint.ops[0].alpha, 1);
});

test("a local that is one variable is an alias, not a new variable", () => {
    const doc = expand({ resources: { variables: { cpu: 1 } }, root: { Meter: { value: "@cpu", max: 1 } } },
        { Meter: { ...Meter, locals: { frac: { $if: "max", then: "@value", else: "0" } } } });
    assert.deepEqual(doc.resources.variables, { cpu: 1 });
    assert.equal(doc.root.canvas.commands[1].paint.ops[0].alpha, "step(@cpu, 0.6)");
});

test("a local chosen by $if", () => {
    const Tile = {
        params: { delta: { type: "float" } },
        locals: { size: { $if: "delta", then: "abs(@delta)", else: 0 } },
        body: { text: { value: { type: "textFromFloat", value: "@size" } } },
    };
    assert.equal(expand({ root: { Tile: { delta: -0.4 } } }, { Tile }).root.text.value.value, 0.4);
    assert.equal(expand({ root: { Tile: {} } }, { Tile }).root.text.value.value, 0);
    const doc = expand({ resources: { variables: { d: 1 } }, root: { Tile: { delta: "@d" } } }, { Tile });
    assert.equal(doc.resources.variables.tile1_size, "abs(@d)");
});

test("a local naming what resources cannot see is inlined at each use", () => {
    // @tree is not a resources variable (declared in the tree, say), so the local can't be.
    const doc = expand({ root: { Meter: { value: "@tree" } } }, { Meter });
    assert.equal(doc.resources, undefined);
    assert.equal(doc.root.canvas.commands[0].drawArc.sweepAngle, "clamp(0, 240, (@tree / 100) * 240)");
    const W = { params: {}, locals: { w: "componentWidth() / 2" }, body: { drawRect: { right: "@w", left: "@w - 4" } } };
    const r = expand({ root: { W: {} } }, { W }).root;
    assert.deepEqual(r, { drawRect: { right: "componentWidth() / 2", left: "(componentWidth() / 2) - 4" } });
});

test("number locals are still per-call state", () => {
    const C = { params: {}, locals: { taps: 0 }, body: { text: { value: "@taps" } } };
    const doc = expand({ root: { C: {} } }, { C });
    assert.deepEqual(doc.resources.variables, { c1_taps: 0 });
    assert.equal(doc.root.text.value, "@c1_taps");
});

test("a string param spliced into text is not parenthesised", () => {
    const S = {
        params: { label: { type: "string", default: "" }, step: { type: "float", default: 1 } },
        body: { box: { modifiers: [
            { semantics: { contentDescription: { $if: "label", then: "Decrease @label", else: "Decrease" } } },
            { onClick: { value: "@value - @step" } },
        ] } },
    };
    const call = (args) => expand({ root: { S: args } }, { S }).root.box.modifiers;
    assert.equal(call({ label: "guests" })[0].semantics.contentDescription, "Decrease guests");
    assert.equal(call({ label: "two guests + kids" })[0].semantics.contentDescription, "Decrease two guests + kids");
    assert.equal(call({})[0].semantics.contentDescription, "Decrease");
    // A float param holding an expression is still parenthesised inside an expression.
    assert.equal(call({ step: "@a * 2" })[1].onClick.value, "@value - (@a * 2)");
    assert.throws(() => call({ label: "@name" }), /runtime value/);
});

test("$each exposes the item count, and $count gives a list's length", () => {
    const T = {
        params: { labels: { type: "list", static: true, required: true } },
        locals: { n: { $count: "labels" } },
        body: { row: { children: [
            { $each: "labels", as: "label", index: "i", count: "k", do: { text: { value: "@label", x: "@i / @k" } } },
            { canvas: { commands: [{ drawRect: { right: "componentWidth() / @n" } }] } },
        ] } },
    };
    const kids = expand({ root: { T: { labels: ["A", "B", "C", "D"] } } }, { T }).root.row.children;
    assert.deepEqual(kids.slice(0, 4).map((k) => k.text), [
        { value: "A", x: 0 }, { value: "B", x: 0.25 }, { value: "C", x: 0.5 }, { value: "D", x: 0.75 },
    ]);
    assert.equal(kids[4].canvas.commands[0].drawRect.right, "componentWidth() / 4");
});

test("foldStatic evaluates literals with the player's functions only", () => {
    assert.equal(foldStatic("clamp(0, 240, 0.72 * 240)"), 172.8);
    assert.equal(foldStatic("clamp(0, 240, 2 * 240)"), 240);
    assert.equal(foldStatic("step(0.5, 0.6)"), 0);
    assert.equal(foldStatic("1 - step(-0.4, 0)"), 1);
    assert.equal(foldStatic("abs(-0.4)"), 0.4);
    assert.equal(foldStatic("42"), undefined);
    assert.equal(foldStatic("sin(1)"), undefined);
    assert.equal(foldStatic("5 min"), undefined);
});

// The real library, through json2rc: the shared fraction is compiled once.
test("Gauge, StatTile, Stepper and Tabs convert", () => {
    const library = loadLibrary();
    for (const name of ["Gauge", "StatTile", "Stepper", "Tabs"]) assert.ok(library.components.has(name), name);
    const doc = {
        header: { apiLevel: 7, width: 360, height: 400, profiles: 513 },
        resources: { variables: { cpu: 42, d: 1, tab: 0, guests: 2 } },
        root: { column: { children: [
            { Gauge: { value: "@cpu", label: "CPU" } },
            { StatTile: { label: "x", value: 1, delta: "@d" } },
            { Stepper: { value: "@guests", label: "guests" } },
            { Tabs: { labels: ["A", "B", "C"], selected: "@tab" } },
        ] } },
    };
    const { doc: out } = expandComponents(doc);
    assert.equal(out.resources.variables.gauge1_frac, "@cpu / 100");
    assert.match(flat(out.root), /"contentDescription":"Decrease guests"/);
    assert.match(flat(out.root), /componentWidth\(\) \/ 3/);
    assert.ok(jsonToRc(doc, ".").length > 0);
});

test("a document can define its own components, and they win over the library", () => {
    const doc = {
        header: { apiLevel: 7, width: 200, height: 80, profiles: 513 },
        components: {
            PriceTag: { params: { price: { type: "string", required: true } }, body: { text: { value: "$ @price" } } },
            Badge: { params: {}, body: { text: { value: "mine" } } },
        },
        root: { column: { children: [{ PriceTag: { price: "9.99" } }, { Badge: {} }] } },
    };
    const { doc: out, components } = expandComponents(doc);
    assert.equal(out.components, undefined);
    assert.deepEqual(components, ["Badge", "PriceTag"]);
    assert.match(flat(out.root), /"value":"\$ 9\.99"/);
    assert.match(flat(out.root), /"value":"mine"/);
    assert.ok(jsonToRc(doc, ".").length > 0);
});

test("a number given to a variable param starts the call's own state", () => {
    const doc = { root: { column: { children: [{ Stepper: { value: 2.5, step: 0.5 } }] } } };
    const { doc: out } = expandComponents(doc);
    assert.equal(out.resources.variables.stepper1_value, 2.5);
});

test("lintComponent reports unusable definitions and the format's traps", () => {
    const r = lintComponent({ params: { v: { type: "float", doc: "x" }, w: { type: "number" } },
        body: { box: { modifiers: [{ border: { width: 1, color: "@colors.primary", cornerRadius: 4 } }],
                       children: [{ text: { value: "clamp(@v, 0, 1) @nope" } }, { $slot: "icon" }] } } }, "Meter");
    assert.ok(r.errors.some((e) => /type 'number'/.test(e)));
    assert.ok(r.errors.some((e) => /border/.test(e)));
    assert.ok(r.errors.some((e) => /\$slot/.test(e)));
    assert.ok(r.warnings.some((w) => /clamp/.test(w)));
    assert.ok(r.warnings.some((w) => /@nope/.test(w)));
    // A text the body names itself (varName) is not a caller's variable.
    assert.deepEqual(lintComponent({ summary: "s", call: {}, params: {}, body: { box: { children: [
        { textSubtext: { text: "abc", start: 0, len: 1, varName: "first" } }, { text: { value: "@first" } }] } } }, "M").warnings, []);
    for (const [name, def] of loadLibrary().components) assert.deepEqual(lintComponent(def, name), { errors: [], warnings: [] }, name);
});

// ---- pattern mode ------------------------------------------------------------------------

const HEADER = { apiLevel: 7, width: 200, height: 200, profiles: 513 };
const compile = (doc, components, opts = {}) => expandComponents(doc, { library: lib(components), ...opts });
const defs = (doc) => doc.root.filter((n) => n.definePattern).map((n) => n.definePattern);
const callsOf = (doc, pat) => JSON.stringify(doc.root).split(`"${pat}":`).length - 1;

// A stripe: a colour (background takes a pattern parameter), a width and a style.
const Stripe = {
    params: {
        color: { type: "color", default: "@colors.primary" },
        w: { type: "float", default: 40 },
        style: { type: "enum", values: ["thin", "thick"], default: "thin", static: true },
    },
    body: { box: { modifiers: [{ width: "@w * 2" }, { height: { $if: "style == 'thick'", then: 8, else: 2 } }, { background: "@color" }] } },
};

test("pattern: runtime params become arguments, integers go through a float variable", () => {
    const r = compile({ header: HEADER, root: { column: { children: [
        { Stripe: { color: "#FFFF0000", w: 12.5 } }, { Stripe: { w: 30 } },
    ] } } }, { Stripe }, { mode: "pattern" });
    const [d] = defs(r.doc);
    assert.equal(d.name, "Stripe__thin");
    assert.deepEqual(d.parameters, ["color", "w"]);
    assert.equal(flat(d.children), flat([{ box: { modifiers: [{ width: "@w * 2" }, { height: 2 }, { background: "@color" }] } }]));
    const calls = r.doc.root.at(-1).column.children;
    assert.deepEqual(calls[0], { Stripe__thin: { arguments: ["#FFFF0000", 12.5] } });
    // 30 would be read as id 30 by resolveTextId: it is passed as a float variable.
    assert.deepEqual(calls[1], { Stripe__thin: { arguments: ["@colors.primary", "@_n30"] } });
    assert.equal(r.doc.resources.variables._n30, 30);
    assert.equal(r.doc.resources.colors.primary, "#FF0000FF");
    assert.ok(jsonToRc(r.doc, ".").length > 0);
});

test("pattern: each static combination is its own template, shared by its calls", () => {
    const r = compile({ header: HEADER, root: { column: { children: [
        { Stripe: {} }, { Stripe: { style: "thick" } }, { Stripe: { color: "#FF00FF00" } }, { Stripe: { style: "thick", w: 3.5 } },
    ] } } }, { Stripe }, { mode: "pattern" });
    assert.deepEqual(defs(r.doc).map((d) => d.name), ["Stripe__thin", "Stripe__thick"]);
    assert.equal(callsOf(r.doc, "Stripe__thin"), 2);
    assert.equal(callsOf(r.doc, "Stripe__thick"), 2);
    assert.deepEqual(r.report.map((x) => [x.pattern, x.calls, x.mode]), [["Stripe__thin", 2, "pattern"], ["Stripe__thick", 2, "pattern"]]);
    assert.deepEqual(r.modes, { Stripe: "pattern" });
});

test("pattern: slots are patternArguments filled by the call's patternBlocks", () => {
    const Frame = {
        params: { color: { type: "color", default: "#FF333333" } },
        slots: { content: {}, footer: { optional: true } },
        body: { column: { modifiers: [{ background: "@color" }], children: [{ $slot: "content" }, { $slot: "footer" }] } },
    };
    const r = compile({ header: HEADER, root: { column: { children: [
        { Frame: { children: [{ box: { modifiers: [{ size: 10 }] } }] } },
        { Frame: { slots: { content: [{ box: {} }], footer: [{ Stripe: {} }] } } },
    ] } } }, { Frame, Stripe }, { mode: "pattern" });
    const [a, b] = defs(r.doc);
    assert.deepEqual(a.parameters, ["color", "slot_content"]);
    assert.deepEqual(a.children[0].column.children, [{ patternArgument: { parameterIndex: 1 } }]);
    assert.equal(b.name, "Frame__content_footer");
    assert.deepEqual(b.children[0].column.children, [{ patternArgument: { parameterIndex: 1 } }, { patternArgument: { parameterIndex: 2 } }]);
    const calls = r.doc.root.at(-1).column.children;
    assert.deepEqual(calls[0].Frame__content.children, [{ patternBlock: { parameterIndex: 1, children: [{ box: { modifiers: [{ size: 10 }] } }] } }]);
    // A call inside slot content is compiled too (here into its own template).
    assert.deepEqual(calls[1].Frame__content_footer.children[1].patternBlock.children, [{ Stripe__thin: { arguments: ["@colors.primary", "@_n40"] } }]);
    assert.ok(jsonToRc(r.doc, ".").length > 0);
});

test("pattern: per-call state is a pattern local; a bound variable is an argument", () => {
    const Tap = {
        params: { count: { type: "variable", initial: 0 } },
        locals: { pressed: 0 },
        body: { box: { modifiers: [{ width: "20 + @count * 4" }, { height: "10 + @pressed" },
            { onClick: { type: "valueFloatExpressionChange", target: "@count", value: "@count + 1" } }] } },
    };
    const r = compile({ header: HEADER, resources: { variables: { n: 0 } }, root: { row: { children: [
        { Tap: {} }, { Tap: { count: 3 } }, { Tap: { count: "@n" } },
    ] } } }, { Tap }, { mode: "pattern" });
    const [own, own3, bound] = defs(r.doc);
    assert.deepEqual(own.locals, ["count", "pressed"]);
    assert.deepEqual(own.children.slice(0, 2), [{ variable: { name: "count", value: 0 } }, { variable: { name: "pressed", value: 0 } }]);
    assert.deepEqual(own3.children[0], { variable: { name: "count", value: 3 } });
    // "n" is a document name, so the parameter is renamed rather than shadowing it; the
    // bound call keeps the template's parameter, not a resources variable of its own.
    assert.deepEqual(bound.parameters, ["count"]);
    assert.deepEqual(bound.locals, ["pressed"]);
    assert.equal(r.doc.root.at(-1).row.children[2][bound.name].arguments[0], "@n");
    assert.deepEqual(Object.keys(r.doc.resources.variables), ["n"]);
    assert.ok(jsonToRc(r.doc, ".").length > 0);
});

test("pattern: the traps write a parameter in, or expand the call, and say why", () => {
    const Label = { params: { t: { type: "string", required: true } }, body: { box: { children: [{ text: { value: "@t" } }] } } };
    const Dot = { params: { x: { type: "float", default: 4 }, c: { type: "color", default: "#FFFFFFFF" } },
        body: { canvas: { commands: [{ paint: { ops: [{ color: "@c" }] } }, { drawCircle: { cx: "@x", cy: 4, radius: 4 } }] } } };
    const doc = { header: HEADER, root: { column: { children: [{ Label: { t: "a" } }, { Label: { t: "b" } }, { Dot: { x: 2.5 } }, { Dot: { x: 2.5 } }] } } };
    const r = compile(doc, { Label, Dot }, { mode: "pattern" });
    assert.deepEqual(r.modes, { Label: "expand", Dot: "pattern" });
    assert.match(r.report.find((x) => x.component === "Label").reason, /U7/);
    // By default (canvas fixed in the players) only the colour is written in: x is an argument.
    const dot = r.report.find((x) => x.component === "Dot");
    assert.deepEqual([dot.calls, dot.static], [2, ["c"]]);
    assert.deepEqual(defs(r.doc)[0].parameters, ["x"]);
    // With the canvas trap honoured, x is written in too (one template per value).
    const trapped = compile(doc, { Label, Dot }, { mode: "pattern", traps: ["canvas", "color", "text"] });
    assert.deepEqual(trapped.report.find((x) => x.component === "Dot").static, ["x", "c"]);
    // With the text trap lifted (once players handle it), the label is an argument.
    const lifted = compile(doc, { Label, Dot }, { mode: "pattern", traps: ["canvas", "color", "graphicsLayer"] });
    assert.deepEqual(defs(lifted.doc).find((d) => d.name === "Label__p").parameters, ["t"]);
    // A local in a trap can't be written in: the call expands.
    const Blink = { params: { on: { type: "variable" } }, body: { canvas: { commands: [{ drawCircle: { cx: "4 + @on", cy: 4, radius: 4 } }] } } };
    const b = compile({ header: HEADER, root: { Blink: {} } }, { Blink }, { mode: "pattern", traps: ["canvas"] });
    assert.equal(b.report[0].mode, "expand");
    assert.match(b.report[0].reason, /canvas/);
    assert.equal(b.doc.resources.variables.blink1_on, 0);
});

test("auto: a variant used twice or more becomes a pattern only when the document gets smaller", () => {
    const row = (n) => ({ header: HEADER, root: { column: { children: Array.from({ length: n }, (_, i) => ({ Stripe: { w: i + 0.5 } })) } } });
    const one = compile(row(1), { Stripe });
    assert.equal(one.report[0].mode, "expand");
    assert.match(one.report[0].reason, /used once/);
    const many = compile(row(6), { Stripe });
    assert.equal(many.report[0].mode, "pattern");
    assert.ok(many.report[0].bytes.pattern < many.report[0].bytes.expand);
    assert.equal(jsonToRc(many.doc, ".").length, many.report[0].bytes.pattern);
    // It is measured, not assumed: a measure that makes patterns dearer keeps expand mode.
    const dear = compile(row(6), { Stripe }, { measure: (d) => JSON.stringify(d).length + (JSON.stringify(d).includes("definePattern") ? 1e6 : 0) });
    assert.equal(dear.report[0].mode, "expand");
    assert.match(dear.report[0].reason, /not smaller/);
});

test("componentMode: document default and per-call override", () => {
    const doc = { header: HEADER, componentMode: "expand", root: { column: { children: [{ Stripe: {} }, { Stripe: {} }] } } };
    const e = compile(doc, { Stripe });
    assert.equal(e.mode, "expand");
    assert.equal(e.doc.componentMode, undefined);
    assert.ok(!flat(e.doc).includes("definePattern"));
    // A call can ask for pattern mode even in an expand document, and for expand in a pattern one.
    const mixed = compile({ ...doc, root: { column: { children: [{ Stripe: { componentMode: "pattern" } }, { Stripe: {} }] } } }, { Stripe });
    assert.equal(callsOf(mixed.doc, "Stripe__thin"), 1);
    const p = compile({ ...doc, componentMode: "pattern", root: { column: { children: [{ Stripe: { componentMode: "expand" } }, { Stripe: {} }] } } }, { Stripe });
    assert.equal(callsOf(p.doc, "Stripe__thin"), 1);
    assert.throws(() => compile({ ...doc, componentMode: "inline" }, { Stripe }), /componentMode/);
});

// ---- light, dark and mono ---------------------------------------------------------------------

const themed = (components) => ({
    components: new Map(Object.entries(components).map(([name, def]) => [name, { component: name, ...def }])),
    theme: {
        colors: { surface: { light: "#FFFFFFFF", dark: "#FF1C2433" }, onPrimary: "#FFFFFFFF", accent: { light: "#FF1565D8", dark: "#FF1565D8" } },
        numbers: { mono: 0, stroke: 2 },
        modes: { mono: { colors: { surface: "#FF000000", onPrimary: "#FF000000", accent: "#FFFFFFFF" }, numbers: { mono: 1 } },
                 "mono-inverted": { colors: { surface: "#FFFFFFFF", onPrimary: "#FFFFFFFF", accent: "#FF000000" }, numbers: { mono: 1 } } },
    },
});
const Tile = {
    params: { on: { type: "variable", initial: 0 } },
    body: { box: { modifiers: [
        { background: "@colors.surface" },
        { $if: "theme.mono", then: { padding: "@theme.stroke" } },
        { $if: "!theme.mono", then: { graphicsLayer: { alpha: "@on" } } },
    ], children: [{ text: { value: "x", color: "@colors.onPrimary" } }, { text: { value: "y", color: "@colors.accent" } }] } },
};
const themedDoc = (extra = {}) => ({ header: { apiLevel: 7, width: 100, height: 100, profiles: 513 }, ...extra, root: { Tile: {} } });
const ex = (doc, theme) => expandComponents(doc, { library: themed({ Tile }), mode: "expand", ...(theme ? { theme } : {}) });

test("auto: a theme colour with two values is a themed colour, one with a single value stays plain", () => {
    const r = ex(themedDoc());
    assert.equal(r.theme, "auto");
    assert.deepEqual(r.doc.resources.colors, { accent: "#FF1565D8", onPrimary: "#FFFFFFFF", surface: { light: "#FFFFFFFF", dark: "#FF1C2433" } });
    assert.ok(!flat(r.doc).replaceAll("theme.mono", "").includes("theme."));
    // json2rc writes it (the Java parser's addThemedColor: THEME sections and a colour expression).
    const themedBytes = jsonToRc(r.doc, ".").length;
    assert.ok(themedBytes > jsonToRc(ex(themedDoc(), "dark").doc, ".").length);
});

test("componentTheme light / dark: one side of each colour, as plain colours", () => {
    for (const mode of ["light", "dark"]) {
        const r = ex(themedDoc({ componentTheme: mode }));
        assert.equal(r.theme, mode);
        assert.equal(r.doc.componentTheme, undefined);
        assert.equal(r.doc.resources.colors.surface, mode === "light" ? "#FFFFFFFF" : "#FF1C2433");
    }
    // The option wins over the document.
    assert.equal(ex(themedDoc({ componentTheme: "light" }), "dark").doc.resources.colors.surface, "#FF1C2433");
    assert.throws(() => ex(themedDoc({ componentTheme: "sepia" })), /componentTheme/);
});

test("mono: the mono palette, @theme.mono is 1 for $if and numbers, the mode's numbers apply", () => {
    const r = ex(themedDoc({ componentTheme: "mono" }));
    assert.deepEqual(r.doc.resources.colors, { accent: "#FFFFFFFF", onPrimary: "#FF000000", surface: "#FF000000" });
    const mods = r.doc.root.box.modifiers;
    assert.deepEqual(mods, [{ background: "@colors.surface" }, { padding: 2 }]);
    // Decimated: no run-time switch.
    assert.ok(!flat(r.doc).includes(MONO_VAR));
    assert.equal(r.mono, undefined);
});

test("all: a theme.mono $if keeps both sides, gated at run time by the host's theme.mono float", () => {
    const r = ex(themedDoc(), "all");
    // The box differs in its modifiers: two copies, each with a visibility modifier.
    const [off, on] = r.doc.root;   // the usual look first
    assert.deepEqual(on.box.modifiers, [{ background: "@colors.surface" }, { padding: 2 }, { visibility: `@${MONO_VAR}` }]);
    assert.deepEqual(off.box.modifiers, [{ background: "@colors.surface" }, { graphicsLayer: { alpha: "@tile1_on" } }, { visibility: `@${MONO_OFF}` }]);
    assert.equal(r.doc.root.length, 2);
    // The switch is declared first, exported, 0 by default; the "off" side reads 1 - it.
    assert.deepEqual(Object.entries(r.doc.resources.variables).slice(0, 2),
        [[MONO_VAR, { value: 0, export: true }], [MONO_OFF, `1 - @${MONO_VAR}`]]);
    assert.equal(r.mono.variable, MONO_VAR);
    assert.equal(r.mono.forks, 1);
    // The colours the host sets by name for each mono look.
    assert.equal(r.mono.palettes.mono.surface, "#FF000000");
    assert.equal(r.mono.palettes["mono-inverted"].surface, "#FFFFFFFF");
    assert.ok(jsonToRc(r.doc, ".").length > 0);
    // A live text of one variable on the mono side is its own, not the usual side's.
    const Clock = { params: {}, body: { $if: "theme.mono", then: { text: { value: { type: "textFromFloat", value: "@t", whole: 2, decimal: 0 } } },
        else: { text: { value: { type: "textFromFloat", value: "@t", whole: 2, decimal: 0 }, fontSize: 20 } } } };
    const c = expandComponents({ ...themedDoc(), resources: { variables: { t: 1 } }, root: { Clock: {} } }, { library: themed({ Clock }), mode: "expand", theme: "all" }).doc.root;
    assert.deepEqual(c.map((n) => n.text.value.value), ["@t", "@t + 0"]);
    // light and dark stay single-theme documents.
    for (const mode of ["light", "dark"]) assert.ok(!flat(ex(themedDoc(), mode).doc).includes(MONO_VAR));
});

test("all: forks gate at the innermost canvas command or layout node, nested ones too", () => {
    const Dial = { params: {}, locals: { r: { $if: "theme.mono", then: "@theme.stroke * 3", else: 4 } },
        body: { column: { children: [
            { text: { value: "t", color: "@colors.accent" } },
            { $if: "theme.mono", then: { text: { value: "m", modifiers: [{ visibility: "@show" }] } } },
            { canvas: { modifiers: [{ size: 20 }], commands: [
                { paint: { ops: [{ color: "@colors.accent" }, { $if: "theme.mono", then: { style: "stroke" } }] } },
                { save: { commands: [{ $if: "!theme.mono", then: { drawCircle: { cx: 5, cy: 5, radius: "@r" } } }] } },
            ] } },
        ] } } };
    const doc = { header: { apiLevel: 7, width: 40, height: 40, profiles: 513 }, resources: { variables: { show: 1 } }, root: { Dial: {} } };
    const r = expandComponents(doc, { library: themed({ Dial }), mode: "expand", theme: "all" });
    const kids = r.doc.root.column.children;
    // The column itself is not copied: its differences are in its children.
    assert.equal(kids.length, 3);
    assert.deepEqual(kids[1].text.modifiers, [{ visibility: `@show * @${MONO_VAR}` }]);
    const [paintOff, paintOn, save] = kids[2].canvas.commands;   // the usual look first
    assert.deepEqual(paintOn, { conditionalOperations: { condition: "gt", v1: `@${MONO_VAR}`, v2: 0,
        commands: [{ paint: { ops: [{ color: "@colors.accent" }, { style: "stroke" }] } }] } });
    assert.equal(paintOff.conditionalOperations.condition, "le");
    assert.deepEqual(save.save.commands, [{ conditionalOperations: { condition: "le", v1: `@${MONO_VAR}`, v2: 0,
        commands: [{ drawCircle: { cx: 5, cy: 5, radius: "@dial1_r" } }] } }]);
    // A local: off + (on - off) * mono, one resources variable.
    assert.equal(r.doc.resources.variables.dial1_r, `4 + 2 * @${MONO_VAR}`);
    assert.equal(r.mono.forks, 3);
    assert.ok(!r.doc.resources.variables[MONO_OFF]);   // no layout node reads the off side
    assert.ok(jsonToRc(r.doc, ".").length > 0);
});

test("all: a canvas reads componentWidth() before its gates; a loop is gated whole, never inside", () => {
    const Bar = { params: {}, body: { canvas: { modifiers: [{ size: 20 }], commands: [
        { $if: "theme.mono", then: { drawRect: { left: 0, top: 0, right: "componentWidth()", bottom: 2 } }, else: { drawRect: { left: 0, top: 0, right: "componentWidth()", bottom: 4 } } },
        { loop: { index: "i", from: 0, until: 3, commands: [{ $if: "theme.mono", then: { drawCircle: { cx: "i * 5", cy: 2, radius: 1 } } }] } },
    ] } } };
    const doc = { header: { apiLevel: 7, width: 20, height: 20, profiles: 513 }, root: { Bar: {} } };
    const cmds = expandComponents(doc, { library: themed({ Bar }), mode: "expand", theme: "all" }).doc.root.canvas.commands;
    // The converters write componentWidth()'s op at its first read: inside a skipped branch it
    // would stay 0 for every later use. A translate of 0 reads it first.
    assert.deepEqual(cmds[0], { translate: { dx: "componentWidth() * 0", dy: 0 } });
    assert.deepEqual(cmds.slice(1, 3).map((c) => c.conditionalOperations.condition), ["le", "gt"]);
    // A conditionalOperations inside a loop sees the previous iteration's index: the loop is gated.
    assert.equal(cmds[4].conditionalOperations.commands[0].loop.commands[0].drawCircle.cx, "i * 5");
    assert.equal(cmds[4].conditionalOperations.condition, "gt");
    // "auto" in a theme.mono (componentTheme all) $if: one form for every look, no fork.
    const Ring = { params: {}, body: { box: { modifiers: [{ $if: "theme.mono", then: { background: "@colors.surface" }, auto: [{ background: "@colors.accent" }] }] } } };
    const r = expandComponents({ ...doc, root: { Ring: {} } }, { library: themed({ Ring }), mode: "expand", theme: "all" });
    assert.deepEqual(r.doc.root.box.modifiers, [{ background: "@colors.accent" }]);
    assert.equal(r.mono.forks, 0);
    assert.deepEqual(expandComponents({ ...doc, root: { Ring: {} } }, { library: themed({ Ring }), mode: "expand", theme: "mono" }).doc.root.box.modifiers, [{ background: "@colors.surface" }]);
    // light-dark: the old auto, themed colours and no switch.
    const ld = expandComponents({ ...doc, root: { Ring: {} } }, { library: themed({ Ring }), mode: "expand", theme: "light-dark" });
    assert.deepEqual(ld.doc.root.box.modifiers, []);
    assert.ok(!flat(ld.doc).includes(MONO_VAR));
});

test("all: a fork in a pattern template is gated inside the template", () => {
    const Pill = { params: { label: { type: "string", required: true } },
        body: { box: { modifiers: [{ $if: "theme.mono", then: { padding: 2 } }, { background: "@colors.surface" }], children: [{ text: { value: "@label" } }] } } };
    const doc = { header: { apiLevel: 7, width: 40, height: 40, profiles: 513 }, componentMode: "pattern", componentTraps: [],
        root: { column: { children: [{ Pill: { label: "a" } }, { Pill: { label: "b" } }] } } };
    const r = expandComponents(doc, { library: themed({ Pill }), traps: [], theme: "all" });
    assert.equal(r.modes.Pill, "pattern");
    const def = r.doc.root[0].definePattern;
    assert.equal(def.children.length, 2);
    assert.deepEqual(def.children.map((c) => c.box.modifiers.at(-1)), [{ visibility: `@${MONO_OFF}` }, { visibility: `@${MONO_VAR}` }]);
    assert.ok(jsonToRc(r.doc, ".").length > 0);
});

test("monoPalettes: the theme's palettes with the document's own colours as each mode expands them", () => {
    const colors = { accent: { light: "#FFE8590C", dark: "#FFFF8A3D", mono: "#FFDDDDDD" }, brand: { light: "#FF00AA00", dark: "#FF00FF00" } };
    const p = monoPalettes({ resources: { colors } }, themed({}));
    assert.equal(p.mono.accent, "#FFDDDDDD");
    assert.equal(p.mono.surface, "#FF000000");
    assert.equal(p.mono.brand, "#FF00FF00");             // not a theme colour: mono takes its dark side
    assert.equal(p["mono-inverted"].accent, "#FF000000"); // no mono-inverted value: the palette's
    assert.equal(p["mono-inverted"].brand, "#FF00AA00");
});

test("mono: a document's colour of a theme name takes the mono palette unless it gives a mono value", () => {
    const colors = { surface: "#FFFFF8F0", accent: { light: "#FFE8590C", dark: "#FFFF8A3D", mono: "#FFDDDDDD" }, brand: "#FF00FF00" };
    const m = ex(themedDoc({ componentTheme: "mono", resources: { colors } })).doc.resources.colors;
    assert.equal(m.surface, "#FF000000");
    assert.equal(m.accent, "#FFDDDDDD");
    assert.equal(m.brand, "#FF00FF00");      // not a theme colour: kept
    // In auto the mono key is dropped; light/dark take their side.
    const a = ex(themedDoc({ resources: { colors } })).doc.resources.colors;
    assert.deepEqual(a.accent, { light: "#FFE8590C", dark: "#FFFF8A3D" });
    assert.equal(a.surface, "#FFFFF8F0");
    assert.equal(ex(themedDoc({ componentTheme: "light", resources: { colors } })).doc.resources.colors.accent, "#FFE8590C");
    // The array form too.
    const arr = ex(themedDoc({ componentTheme: "mono", resources: { colors: [{ surface: "#FF123456" }, { name: "accent", value: "#FF654321" }] } })).doc.resources.colors;
    assert.deepEqual(arr.slice(-2), [{ surface: "#FF000000" }, { name: "accent", value: "#FFFFFFFF" }]);
    assert.ok(arr.some((e) => "onPrimary" in e));
});

test("mono-inverted: its own palette, the same mono variants, a mono-inverted value, no motion", () => {
    const r = ex(themedDoc({ componentTheme: "mono-inverted" }));
    assert.equal(r.theme, "mono-inverted");
    assert.deepEqual(r.doc.resources.colors, { accent: "#FF000000", onPrimary: "#FFFFFFFF", surface: "#FFFFFFFF" });
    assert.deepEqual(r.doc.root.box.modifiers, [{ background: "@colors.surface" }, { padding: 2 }]);
    const colors = { accent: { light: "#FFE8590C", dark: "#FFFF8A3D", mono: "#FFDDDDDD", "mono-inverted": "#FF222222" },
                     surface: { value: "#FFFFF8F0", mono: "#FF000000" }, brand: { light: "#FF00AA00", dark: "#FF00FF00" } };
    const m = ex(themedDoc({ componentTheme: "mono-inverted", resources: { colors } })).doc.resources.colors;
    assert.equal(m.accent, "#FF222222");
    assert.equal(m.surface, "#FFFFFFFF");    // a theme name without a mono-inverted value: the palette's
    assert.equal(m.brand, "#FF00AA00");      // not a theme colour: its light side
    assert.ok(!flat(ex(themedDoc({ resources: { colors } })).doc).includes("mono-inverted"));
});

test("mono: no motion — animated values lose their anim, animationSpec modifiers go", () => {
    const Fade = { params: {}, locals: { t: { value: 0, anim: 0.3 } },
        body: { box: { modifiers: [{ animationSpec: { duration: 300 } }, { graphicsLayer: { alpha: "@t" } }] } } };
    const doc = { header: { apiLevel: 7, width: 10, height: 10 }, resources: { variables: { tab: { value: "@x", anim: 0.4 } } }, root: { Fade: {} } };
    const lib = themed({ Fade });
    const auto = expandComponents(doc, { library: lib, mode: "expand" });
    assert.ok(flat(auto.doc).includes("\"anim\"") && flat(auto.doc).includes("animationSpec"));
    const mono = expandComponents({ ...doc, componentTheme: "mono" }, { library: lib, mode: "expand" });
    assert.ok(!flat(mono.doc).includes("\"anim\"") && !flat(mono.doc).includes("animationSpec"));
    assert.equal(mono.motion_removed, 3);
    // {value, anim} without its anim is the plain value.
    assert.equal(mono.doc.resources.variables.tab, "@x");
});

test("an animated local: a tree variable first in the body, read below it; mono reads the value itself", () => {
    const Knob = { params: { on: { type: "variable", initial: 0 } }, locals: { p: { value: "@on", anim: 0.25 }, x: "20 * @p" },
        body: { canvas: { modifiers: [{ size: 30 }], commands: [{ drawCircle: { cx: "@x", cy: 5, radius: 4 } }] } } };
    const lib = themed({ Knob });
    const doc = { header: { apiLevel: 7, width: 10, height: 10 }, resources: { variables: { k: 0 } }, root: { Knob: { on: "@k" } } };
    const auto = expandComponents(doc, { library: lib, mode: "expand" });
    const cmds = auto.doc.root.canvas.commands;
    assert.deepEqual(cmds[0], { variable: { name: "knob1_p", value: { value: "@k", anim: 0.25 } } });
    assert.equal(cmds[1].drawCircle.cx, "20 * @knob1_p");
    const mono = expandComponents({ ...doc, componentTheme: "mono" }, { library: lib, mode: "expand" });
    assert.equal(mono.doc.root.canvas.commands.length, 1);
    // ... so x names resource variables only, and becomes one there.
    assert.equal(mono.doc.root.canvas.commands[0].drawCircle.cx, "@knob1_x");
    assert.equal(mono.doc.resources.variables.knob1_x, "20 * @k");
    // Pattern mode cannot carry it (expanded instead), except in mono.
    const pat = expandComponents({ ...doc, root: { column: { children: [{ Knob: { on: "@k" } }, { Knob: { on: "@k" } }] } } }, { library: lib, mode: "pattern" });
    assert.ok(pat.report.every((r) => r.mode === "expand"));
});

test("theme conditions: lint knows theme.mono, and an unknown theme name is an error", () => {
    assert.deepEqual(lintComponent({ summary: "s", call: {}, params: {}, body: { $if: "theme.mono", then: { box: {} } } }, "M", { library: themed({}) }).warnings, []);
    const bad = lintComponent({ summary: "s", call: {}, params: {}, body: { $if: "!theme.nope", then: { box: {} } } }, "M", { library: themed({}) });
    assert.ok(bad.errors.some((e) => /theme\.nope/.test(e)));
    assert.throws(() => ex({ ...themedDoc(), components: { Tile: { body: { $if: "theme.nope", then: { box: {} } } } } }), /theme\.nope/);
});

test("the library: every theme colour has a light and a dark value (or one for both) and a mono one", () => {
    const { theme } = loadLibrary();
    const mono = theme.modes?.mono?.colors ?? {};
    for (const [k, v] of Object.entries(theme.colors)) {
        assert.ok(typeof v === "string" || (v.light && v.dark), `${k}: {light, dark} or one value`);
        assert.ok(mono[k], `${k}: a mono value`);
    }
    assert.equal(theme.numbers.mono, 0);
    assert.equal(theme.modes.mono.numbers.mono, 1);
});

test("componentTraps in the document overrides the default traps", () => {
    const Label = { params: { t: { type: "string", required: true } }, body: { box: { children: [{ text: { value: "@t" } }] } } };
    const doc = { header: HEADER, componentMode: "pattern", root: { column: { children: [{ Label: { t: "a" } }, { Label: { t: "b" } }] } } };
    assert.equal(compile(doc, { Label }).modes.Label, "expand");
    assert.equal(compile({ ...doc, componentTraps: ["color"] }, { Label }).modes.Label, "pattern");
});

test("names a body declares are scoped per call", () => {
    // A canvas `variable` is document-global: two calls sharing "c" would both draw with
    // the last one's value. Each call gets its own name, and its references follow.
    const Dot = { params: { x: { type: "float", required: true } }, body: { canvas: { modifiers: [{ size: 10 }], commands: [
        { variable: { name: "c", value: "@x * 2" } },
        { pathExpression: { id: "p", expressionX: "@c", expressionY: "0", start: 0, end: 1, count: 2 } },
        { drawCircle: { cx: "@c", cy: 5, radius: 2 } }, { drawPath: { path: "p" } }] } } };
    const doc = { header: HEADER, root: { column: { children: [{ Dot: { x: 1 } }, { Dot: { x: 2 } }] } } };
    const out = JSON.stringify(compile(doc, { Dot }).doc);
    const names = [...out.matchAll(/"name":"(\w+)"/g)].map((m) => m[1]);
    assert.equal(new Set(names).size, 2, out);
    assert.ok(!/"@c"|"path":"p"/.test(out), out);
    for (const n of names) assert.ok(out.includes(`"cx":"@${n}"`), n);
});

test("a component made of canvas commands is never a pattern", () => {
    const Mark = { params: { r: { type: "float", default: 2 } }, body: [{ paint: { color: "#FF000000" } }, { drawCircle: { cx: 5, cy: 5, radius: "@r" } }] };
    const doc = { header: HEADER, componentMode: "pattern", root: { canvas: { modifiers: [{ size: 10 }], commands: [{ Mark: { r: 1 } }, { Mark: { r: 3 } }] } } };
    assert.equal(compile(doc, { Mark }).modes.Mark, "expand");
    assert.ok(jsonToRc({ ...doc, components: { Mark } }).length > 0);
});
