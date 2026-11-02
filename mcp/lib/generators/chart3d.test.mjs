// node --test mcp/lib/generators/chart3d.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { generate, niceAxis, tickLabel, frameExtent, project, gridMesh, parseFormula, evalFormula, emitFormula,
    readPoints, rampBin, BOX_H, EYE, RAMP } from "./chart3d.mjs";

const ctx = (mono = false) => {
    const arrays = new Map();
    let n = 0;
    return { mono, header: null, name: "test", unique: (p) => `${p}${++n}`, path: () => "$paths.p",
        floatArray: (hint, nums) => { const id = `gen_${hint}`; arrays.set(id, nums); return `@${id}`; }, arrays };
};
const walk = (n, f) => { if (Array.isArray(n)) n.forEach((x) => walk(x, f)); else if (n && typeof n === "object") { f(n); Object.values(n).forEach((x) => walk(x, f)); } };
const find = (n, key) => { const out = []; walk(n, (x) => { if (key in x) out.push(x[key]); }); return out; };

test("niceAxis: round ranges, about four intervals, zero brought in for values", () => {
    assert.deepEqual(niceAxis(10, 3640, 4, { zero: true }).ticks, [0, 1000, 2000, 3000, 4000]);
    assert.deepEqual(niceAxis(50, 2672).ticks, [0, 1000, 2000, 3000]);
    assert.deepEqual(niceAxis(0.72, 16.8).ticks, [0, 5, 10, 15, 20]);
    const a = niceAxis(0.13, 0.97);
    assert.equal(a.lo, 0); assert.equal(a.hi, 1);
    assert.ok(a.ticks.length >= 3 && a.ticks.length <= 7, `${a.ticks}`);
    // negative to positive, symmetric
    assert.deepEqual(niceAxis(-4, 4).ticks, [-4, -2, 0, 2, 4]);
    // the data is always inside
    for (const [lo, hi] of [[3.2, 3.9], [-17, 250], [1e5, 9.7e6], [0.001, 0.004]]) {
        const ax = niceAxis(lo, hi);
        assert.ok(ax.lo <= lo && ax.hi >= hi, `${lo}..${hi} -> ${ax.lo}..${ax.hi}`);
        assert.ok(ax.ticks.length - 1 <= 6, `${lo}..${hi}: ${ax.ticks.length - 1} intervals`);
    }
    // a flat range still gets an axis
    const f = niceAxis(5, 5);
    assert.ok(f.lo < 5 && f.hi > 5);
});

test("tickLabel: k and M by the step, a real minus", () => {
    assert.equal(tickLabel(2000, 1000), "2000");
    assert.equal(tickLabel(20000, 10000), "20k");
    assert.equal(tickLabel(2500000, 500000), "2.5M");
    assert.equal(tickLabel(-2, 2), "−2");
    assert.equal(tickLabel(0.25, 0.25), "0.25");
    assert.equal(tickLabel(1.5, 0.5), "1.5");
});

test("formulas: parse, evaluate, emit with parameters", () => {
    const ast = parseFormula("exp(-(x^2 + y^2) / (2 * s^2))", ["s"]);
    assert.equal(evalFormula(ast, { x: 0, y: 0, s: 0.8 }), 1);
    assert.ok(Math.abs(evalFormula(ast, { x: 0.8, y: 0, s: 0.8 }) - Math.exp(-0.5)) < 1e-12);
    const e = emitFormula(ast, { x: "u", y: "v", s: "@sigma" });
    assert.match(e, /square\(u\)/); assert.match(e, /@sigma/);
    assert.equal(evalFormula(parseFormula("2x - y"), { x: 3, y: 1 }), 5);
    assert.throws(() => parseFormula("x + q"), /unknown name 'q'/);
});

test("frameExtent: the box and its tick anchors fit at every orbit angle", () => {
    const { ex, ey } = frameExtent();
    for (const [cw, ch] of [[328, 480], [608, 300], [190, 220], [800, 800]]) {
        const F = Math.min((cw - 32) / (2 * ex), (ch - 22) / (2 * ey));
        for (let s = 0; s < 2 * Math.PI; s += 0.05) for (const t of [0.1, 0.4, 0.8, 1.15]) {
            for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const sy of [-BOX_H / 2, BOX_H / 2]) {
                const q = project([sx, sy, sz], s, t);
                const X = cw / 2 + F * q.x / q.w, Y = ch / 2 - F * q.y / q.w;
                assert.ok(X >= 16 && X <= cw - 16 && Y >= 11 && Y <= ch - 11, `${cw}x${ch} spin ${s.toFixed(2)} tilt ${t}: corner at ${X.toFixed(1)}, ${Y.toFixed(1)}`);
            }
        }
        // and it is not framed loosely: in the limiting direction, some corner at some angle
        // comes within 15% of the canvas edge
        let near = Infinity;
        for (let s = 0; s < 2 * Math.PI; s += 0.05) for (const t of [0.1, 0.6, 1.15]) for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const sy of [-BOX_H / 2, BOX_H / 2]) {
            const q = project([sx, sy, sz], s, t);
            near = Math.min(near, (cw / 2 - Math.abs(F * q.x / q.w)) / cw, (ch / 2 - Math.abs(F * q.y / q.w)) / ch);
        }
        assert.ok(near < 0.15, `${cw}x${ch}: nearest corner ${(near * 100).toFixed(0)}% from an edge`);
    }
});

test("project: a turn of the spin moves the front corner as the rotation does", () => {
    // spin 0, tilt 0: the box seen straight on; (1, 0, 1) is right and nearer
    const q = project([1, 0, 1], 0, 0);
    assert.equal(q.x, 1); assert.equal(q.w, EYE - 1);
    // spin 90 degrees: x -> -z (glRotate about +y)
    const r = project([1, 0, 0], Math.PI / 2, 0);
    assert.ok(Math.abs(r.x) < 1e-12 && Math.abs(r.w - (EYE + 1)) < 1e-12);
    // tilting brings the top toward the camera
    assert.ok(project([0, 1, 0], 0, 0.5).w < EYE);
});

test("gridMesh: sizes, lines at the given fractions, no diagonal on edges 0 and 1", () => {
    const g = gridMesh(4, 3);
    assert.equal(g.verts.length, 5 * 4 * 3);
    assert.equal(g.indices.length, 4 * 3 * 6);
    const u = gridMesh([0, 0.1667, 0.5, 0.8333, 1], 2);
    assert.deepEqual([...new Set(u.verts.filter((_, i) => i % 3 === 0))], [0, 0.1667, 0.5, 0.8333, 1]);
    // every triangle's edges 0 (v0-v1) and 1 (v1-v2) are axis-aligned
    for (let t = 0; t < g.indices.length; t += 3) {
        const P = (k) => g.verts.slice(g.indices[t + k] * 3, g.indices[t + k] * 3 + 2);
        for (const [a, b] of [[P(0), P(1)], [P(1), P(2)]]) assert.ok(a[0] === b[0] || a[1] === b[1], `triangle ${t / 3}`);
    }
});

test("scatter: every point lands in the box where its data says, binned by colour", () => {
    const pts = [{ label: "La Paz", x: 472, y: 0.76, z: 3640, size: 0.76 }, { label: "Delhi", x: 1484, y: 16.8, z: 216, size: 16.8 },
        { label: "Paris", x: 105, y: 2.1, z: 35, size: 2.1 }, { label: "Lima", x: 2672, y: 9.7, z: 154, size: 9.7 }];
    const c = ctx();
    const out = generate({ type: "scatter", points: pts, zLabel: "Elevation (m)" }, c);
    // arrays: stems first (6 floats per point), then one per colour bin
    const arrays = [...c.arrays.values()];
    assert.equal(arrays[0].length, 4 * 6);
    const spheres = arrays.slice(1).flat();
    assert.equal(spheres.length, 4 * 6);
    // La Paz by hand: x 0..3000, y 0..20, z 0..4000
    const lp = [];
    for (let i = 0; i < spheres.length; i += 6) if (Math.abs(spheres[i + 1] - 3640 / 4000 * BOX_H) < 1e-4) lp.push(spheres.slice(i, i + 6));
    assert.equal(lp.length, 1);
    assert.ok(Math.abs(lp[0][0] - (-1 + 2 * 472 / 3000)) < 1e-4);
    assert.ok(Math.abs(lp[0][2] - (1 - 2 * 0.76 / 20)) < 1e-4);
    // the highest gets the darkest step, the lowest the lightest
    const colors = find(out, "color").filter((x) => RAMP.includes(x));
    assert.ok(colors.includes(RAMP[0]) && colors.includes(RAMP[4]));
    assert.equal(rampBin(3640, 35, 3640), 4); assert.equal(rampBin(35, 35, 3640), 0);
    // the description names the highest
    assert.match(find(out, "contentDescription")[0], /highest: La Paz/);
    // three names drawn (twice: halo and text)
    assert.equal(find(out, "text").filter((t) => ["La Paz", "Delhi", "Lima", "Paris"].includes(t)).length, 6);
});

test("bars: heights from zero, one loop per series, a legend", () => {
    const c = ctx();
    const out = generate({ type: "bars", categories: ["Jan", "Feb", "Mar"], series: ["A", "B"], values: [[100, 200, 300], [50, 0, 485]] }, c);
    const arrays = [...c.arrays.values()];
    assert.equal(arrays.length, 2);
    // B, Mar: 485 on the value axis (0..600, step 200)
    const b = arrays[1];
    assert.deepEqual(niceAxis(0, 485, 4, { zero: true }).ticks, [0, 200, 400, 600]);
    assert.ok(Math.abs(b[2 * 6 + 4] - 485 / 600 * BOX_H) < 1e-4, `${b[2 * 6 + 4]}`);
    assert.equal(b[2 * 6 + 1], 0);
    assert.equal(find(out, "loop").length, 2);
    assert.ok(find(out, "loop").every((l) => l.step === 6 && l.until % 6 === 0));
    assert.ok(find(out, "value").includes("A") && find(out, "value").includes("B"));
    assert.throws(() => generate({ type: "bars", categories: ["a", "b"], values: [[1]] }, ctx()), /1 values for 2 categories/);
});

test("surface: z range over every parameter value, five bands, a skirt, sizes", () => {
    const c = ctx();
    const out = generate({ fn: "exp(-(x^2 + y^2) / (2 * s^2))", x: [-3, 3], vars: [{ name: "s", value: "@sigma", min: 0.4, max: 2 }] }, c);
    const meshes = find(out, "meshExpression3D");
    assert.equal(meshes.length, 6);                       // five bands and the skirt
    assert.equal(meshes[0].uCount, 44 + 3);
    assert.match(meshes[0].y, /@sigma/);
    // the peak is 1, so z runs 0..1 and the top band reaches the box's top
    const zTicks = find(out, "text").filter((t) => /^[0-9.]+$/.test(t));
    assert.ok(zTicks.includes("1") && zTicks.includes("0.5"), zTicks.join(","));
    assert.match(find(out, "contentDescription")[0], /highest at \(0, 0\)/);
    // mono: one wireframe mesh, no ramp
    const m = generate({ fn: "x^2 - y^2", x: [-2, 2] }, ctx(true));
    assert.equal(find(m, "meshExpression3D").length, 2);
    assert.ok(find(m, "wireframe").length >= 6);
    assert.ok(!JSON.stringify(m).includes(RAMP[0]));
    // a variable needs its range
    assert.throws(() => generate({ fn: "x * k", vars: [{ name: "k", value: "@k" }] }, ctx()), /needs min and max/);
});

test("readPoints: arrays and objects; errors name the point", () => {
    assert.deepEqual(readPoints([[1, 2, 3, 4]])[0], { x: 1, y: 2, z: 3, size: 4, color: undefined });
    assert.throws(() => readPoints([[1, 2]]), /points\[0\]/);
    assert.throws(() => readPoints([{ x: 1, y: "a", z: 3 }]), /points\[0\]\.y/);
});
