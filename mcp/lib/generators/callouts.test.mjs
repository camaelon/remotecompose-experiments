// node --test mcp/lib/generators/callouts.test.mjs
// The callouts solver, evaluated with numbers: the same code writes the document's expressions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { relax, solve, crossings, generate, textWidth, wrapLines, plan, SAMPLE_SIZES } from "./callouts.mjs";

const N = {
    add: (a, b) => a + b, sub: (a, b) => a - b, mul: (a, b) => a * b, div: (a, b) => a / b,
    max: Math.max, min: Math.min, v: (_, a) => a,
};

// The solver checks SAMPLE_SIZES; sizes in between are checked here too.
const SIZES = [...SAMPLE_SIZES, [360, 740], [390, 844], [600, 960], [1366, 768], [280, 280], [560, 300]];

const COFFEE = {
    aspect: 0.8,
    parts: [
        { at: [0.2, 0.1], label: "Water tank" },
        { at: [0.3, 0.5], label: "Portafilter with a long description of what it does" },
        { at: [0.15, 0.55], label: "Drip tray" },
        { at: [0.8, 0.2], label: "Bean hopper" },
        { at: [0.7, 0.6], label: "Steam wand" },
    ],
};
// Every anchor on the right and close together: the crowded case.
const CLUSTER = {
    aspect: 1.2,
    parts: [0.40, 0.42, 0.45, 0.47, 0.5, 0.52].map((y, i) => ({ at: [0.7 + 0.04 * (i % 3), y], label: i % 2 ? `Part ${i}` : `A rather longer label for part ${i}` })),
};

function gaps(look, side, minGap) {
    const L = [...look[side]].sort((a, b) => a.y - b.y);
    for (let k = 1; k < L.length; k++) {
        const space = L[k].y - (L[k - 1].y + L[k - 1].h);
        assert.ok(space >= minGap - 0.01, `${side} ${k}: ${space.toFixed(2)} dp between labels, want >= ${minGap}`);
    }
}

test("relax keeps order and gaps and stays near the targets", () => {
    const ts = [50, 52, 54, 200], hs = [20, 20, 40, 20];
    const ys = relax(ts, hs, -1000, 1000, 8, N);
    for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - (ys[i - 1] + hs[i - 1]) >= 8 - 1e-9);
    // a free label sits on its target
    assert.equal(ys[3] + hs[3] / 2, 200);
    // the crowded run is centred on its targets, not pushed all one way
    const centre = (ys[0] + ys[2] + hs[2]) / 2;
    assert.ok(Math.abs(centre - 52) < 12, `run centred at ${centre}`);
});

test("relax clamps at the edges", () => {
    const hs = [20, 20, 20];
    const top = relax([0, 1, 2], hs, 10, 300, 8, N);
    assert.equal(top[0], 10);
    assert.ok(top[1] >= top[0] + 28 && top[2] >= top[1] + 28);
    const bottom = relax([298, 299, 300], hs, 10, 300, 8, N);
    assert.equal(bottom[2] + 20, 300);
    assert.ok(bottom[0] >= 10);
});

test("relax with too little room keeps the gaps and splits the overflow", () => {
    const hs = [30, 30, 30, 30];
    const ys = relax([50, 50, 50, 50], hs, 0, 100, 8, N);
    for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - (ys[i - 1] + 30) >= 8 - 1e-9);
    assert.ok(ys[0] < 0 && ys[3] + 30 > 100, "both ends overflow, not just one");
});

for (const [name, spec] of [["coffee", COFFEE], ["cluster", CLUSTER]]) {
    for (const mode of ["auto", "beside", "legend"]) {
        test(`${name} ${mode}: no overlap, order kept, leaders do not cross`, () => {
            for (const [w, h] of SIZES) {
                const G = solve({ ...spec, mode }, w, h);
                const look = G.look;
                if (look.dh < 40) continue; // a stamp: nothing to label
                const beside = G.side === 1;
                for (const s of ["left", "right"]) {
                    gaps(look, s, beside ? 8 : 6);
                    // order: the solver's order top to bottom, except a pair it swaps at run time
                    // because their leaders would cross
                    const swaps = G.order.swaps[s];
                    for (let k = 1; k < look[s].length; k++) {
                        if (look[s][k].y > look[s][k - 1].y) continue;
                        assert.ok(swaps.includes(k - 1), `${w}x${h} ${s} labels ${k - 1} and ${k} out of order`);
                    }
                    // the labels stay in the window when they fit
                    const p = G.plan.sides[s];
                    if (beside && p.stack <= h - 24) for (const L of look[s]) assert.ok(L.y >= 12 - 1e-6 && L.y + L.h <= h - 12 + 1e-6, `${w}x${h} label out of the window`);
                }
                // Leaders: no crossing while a side's labels take at most 1.9 times the drawing's
                // height. Past that (a crowd on one side of a small drawing: a fan of long
                // leaders) the solver only minimises them; auto avoids that state for beside.
                const span = (s) => (look[s].length ? Math.max(...look[s].map((L) => L.y + L.h)) - Math.min(...look[s].map((L) => L.y)) : 0);
                const crowd = Math.max(span("left"), span("right")) / look.dh;
                if (crowd <= 1.9) assert.deepEqual(crossings(G), [], `${w}x${h} ${mode}: crossing leaders (crowd ${crowd.toFixed(2)})`);
            }
        });
    }
}

test("an anchor at the very top and bottom is clamped into the window", () => {
    const spec = { aspect: 1, mode: "beside", parts: [{ at: [0, 0], label: "Top" }, { at: [0, 1], label: "Bottom" }, { at: [1, 0], label: "Corner" }] };
    for (const [w, h] of [[640, 360], [1280, 800]]) {
        const G = solve(spec, w, h);
        for (const L of [...G.look.left, ...G.look.right]) {
            assert.ok(L.y >= 12 - 1e-6, `top ${L.y}`);
            assert.ok(L.y + L.h <= h - 12 + 1e-6, `bottom ${L.y + L.h}`);
        }
    }
});

test("sides follow the anchor, and an explicit side wins", () => {
    const P = plan({ parts: [{ at: [0.2, 0.5], label: "a" }, { at: [0.8, 0.5], label: "b" }, { at: [0.9, 0.5], label: "c", side: "left" }] });
    assert.deepEqual(P.sides.left.items.map((x) => x.label), ["a", "c"]);
    assert.deepEqual(P.sides.right.items.map((x) => x.label), ["b"]);
});

test("the look follows the window: beside when wide, legend when narrow", () => {
    assert.equal(solve(COFFEE, 640, 360).side, 1);
    assert.equal(solve(COFFEE, 360, 640).side, 0);
    assert.equal(solve(COFFEE, 200, 200).side, 0);
    // too small for a drawing: the legend alone
    const tiny = solve({ ...COFFEE, parts: [...COFFEE.parts, ...COFFEE.parts] }, 200, 200);
    assert.equal(tiny.look.big, 0);
    assert.equal(tiny.look.dh, 0);
    assert.equal(solve(COFFEE, 360, 640).look.big, 1);
});

test("text measure and wrap", () => {
    assert.ok(Math.abs(textWidth("Water tank", 14) / 1.06 - 67.69) < 0.1);
    assert.equal(wrapLines("Water tank", 14, 200), 1);
    assert.equal(wrapLines("Water tank", 14, 50), 2);
    assert.equal(wrapLines("Portafilter with a long description of what it does", 14, 160), 3);
});

test("named points and bad input", () => {
    const P = plan({ points: { spout: [0.5, 0.7] }, parts: [{ at: "spout", label: "Spout" }] });
    assert.equal(P.items[0].py, 0.7);
    assert.throws(() => plan({ parts: [{ at: "nope", label: "x" }] }), /names 'nope'/);
    assert.throws(() => plan({ parts: [{ at: [1.5, 0], label: "x" }] }), /outside the drawing/);
    assert.throws(() => plan({ parts: [] }), /non-empty/);
});

test("generate writes tree variables that each stay under the 32-entry expression limit", () => {
    const out = generate({ ...CLUSTER, visual: { box: {} } }, { mono: false });
    const vars = out.box.children.filter((c) => c.variable);
    assert.ok(vars.length > 10);
    for (const v of vars) {
        const val = String(v.variable.value);
        const entries = (val.match(/[@\w.]+(\(\))?|[-+*/]/g) ?? []).length;
        assert.ok(entries <= 32, `${v.variable.name}: ${entries} entries`);
    }
});

test("CMP-30's parts: no crossing, no leader over another anchor, at every size", async () => {
    const { readFileSync } = await import("node:fs");
    const doc = JSON.parse(readFileSync(new URL("../../../examples/CMP-30-coffee-machine-parts/doc.json", import.meta.url)));
    const { grazes } = await import("./callouts.mjs");
    const spec = { ...doc.root.Callouts };
    for (const [w, h] of SIZES) {
        const G = solve(spec, w, h);
        if (G.look.dh < 40) continue;
        assert.deepEqual(crossings(G), [], `${w}x${h}`);
        assert.deepEqual(grazes(G), [], `${w}x${h}`);
    }
});

test("generate declares each tree variable once, before it is read", () => {
    for (const spec of [COFFEE, CLUSTER]) {
        const out = generate({ ...spec, visual: { box: {} } }, { mono: false });
        const declared = new Set();
        for (const c of out.box.children.filter((c) => c.variable)) {
            const { name, value } = c.variable;
            assert.ok(!declared.has(name), `${name} declared twice`);
            for (const ref of String(value).match(/@[\w]+/g) ?? []) assert.ok(declared.has(ref.slice(1)), `${name} reads ${ref} before it is declared`);
            declared.add(name);
        }
    }
});

test("two identical Callouts calls in one document get their own variables and convert", async () => {
    const { compileComponents, jsonToRc } = await import("../json2rc.mjs");
    const call = { Callouts: { aspect: 1, width: "windowWidth() / 2", height: "windowHeight()",
        parts: [{ at: [0.2, 0.3], label: "Left part" }, { at: [0.8, 0.6], label: "Right part" }],
        slots: { visual: [{ box: { modifiers: ["fillMaxSize", { background: "@colors.track" }] } }] } } };
    const doc = { header: { apiLevel: 7, width: 640, height: 360, profiles: 513 },
        root: { row: { modifiers: ["fillMaxSize"], children: [{ box: { modifiers: [{ width: "windowWidth() / 2" }, "fillMaxHeight"], children: [call] } },
            { box: { modifiers: [{ width: "windowWidth() / 2" }, "fillMaxHeight"], children: [structuredClone(call)] } }] } } };
    const out = JSON.stringify(compileComponents(doc, ".").doc);
    const names = [...out.matchAll(/"name":"(callouts\d+)_W"/g)].map((m) => m[1]);
    assert.deepEqual(names, ["callouts1", "callouts2"]);
    assert.ok(jsonToRc(doc, ".").length > 1000);
});

test("every placed node opts out of the bounds animation, so labels and leaders move together", () => {
    const visual = { canvas: { modifiers: ["fillMaxSize"], commands: [] } };
    const out = generate({ ...COFFEE, visual }, { mono: false });
    const missing = [];
    const walk = (n, path) => {
        const key = n && typeof n === "object" && ["box", "row", "column", "flow", "canvas", "text"].find((k) => k in n);
        if (!key) return;
        const v = n[key];
        const spacer = key === "box" && !v.children;
        if (!spacer && !(v.modifiers ?? []).some((m) => m?.animationSpec?.animationId === 0)) missing.push(path + "/" + key);
        (v.children ?? []).forEach((c, i) => walk(c, `${path}/${key}/${i}`));
    };
    walk(out, "");
    assert.deepEqual(missing, []);
});
