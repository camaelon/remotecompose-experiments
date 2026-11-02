import { test } from "node:test";
import assert from "node:assert/strict";
import { parse, compile, emit, roots, extrema, piTicks, niceTicks, value, segments, generate } from "./mathplot.mjs";

const fn = (s) => compile(parse(s));
const close = (a, b, tol = 1e-7) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const closeAll = (got, want, tol) => { assert.equal(got.length, want.length, `${got} vs ${want}`); got.forEach((g, i) => close(g, want[i], tol)); };

test("parses implicit multiplication, powers, |x|, π and unicode", () => {
    close(fn("2x^2 - 3x + 1")(2), 3);
    close(fn("-x^2")(3), -9);                       // -(x^2), not (-x)^2
    close(fn("e^(-x/4)·cos x")(1), Math.exp(-0.25) * Math.cos(1));
    close(fn("|x| − 1")(-3), 2);
    close(fn("sin(x)^2 + cos(x)^2")(0.7), 1);
    close(fn("2pi x")(1), 2 * Math.PI);
    close(fn("x(x - 1)")(3), 6);
    close(value("3π/4"), 3 * Math.PI / 4);
    assert.throws(() => parse("y + 1"), /unknown name/);
});

test("roots of known functions", () => {
    closeAll(roots(fn("x^2 - 2x - 3"), -5, 5), [-1, 3]);
    closeAll(roots(fn("x^3 - 3x"), -2.5, 2.5), [-Math.sqrt(3), 0, Math.sqrt(3)]);
    closeAll(roots(fn("(x - 1)^2"), -5, 5), [1], 1e-6);                        // touching root
    closeAll(roots(fn("exp(-x/4)*cos(x)"), 0, 4 * Math.PI), [1, 3, 5, 7].map((k) => k * Math.PI / 2));
    closeAll(roots(fn("tan(x)"), -4, 4), [-Math.PI, 0, Math.PI]);              // poles are not roots
    closeAll(roots(fn("1/x"), -2, 2), []);
    closeAll(roots(fn("ln(x)"), 0.1, 5), [1]);
});

test("extrema of known functions", () => {
    closeAll(extrema(fn("x^3 - 3x"), -2.5, 2.5, "max"), [-1]);
    closeAll(extrema(fn("x^3 - 3x"), -2.5, 2.5, "min"), [1]);
    closeAll(extrema(fn("x^2 - 2x - 3"), -5, 5, "min"), [1]);
    // e^(-x/4) cos x: f' = 0 where tan x = -1/4
    const t = Math.atan(0.25);
    closeAll(extrema(fn("exp(-x/4)*cos(x)"), 0, 4 * Math.PI, "max"), [2 * Math.PI - t, 4 * Math.PI - t], 1e-8);
    closeAll(extrema(fn("exp(-x/4)*cos(x)"), 0, 4 * Math.PI, "min"), [Math.PI - t, 3 * Math.PI - t], 1e-8);
    closeAll(extrema(fn("1/x^2"), -2, 2, "max"), []);                          // a pole is not a peak
    closeAll(extrema(fn("|x|"), -2, 2, "min"), [0]);
});

test("ticks", () => {
    assert.deepEqual(piTicks(0, 4 * Math.PI, 7).ticks.map((t) => t.label), ["0", "π", "2π", "3π", "4π"]);
    assert.deepEqual(piTicks(-Math.PI, Math.PI, 7).ticks.map((t) => t.label), ["−π", "−π/2", "0", "π/2", "π"]);
    assert.deepEqual(niceTicks(-0.47, 1, 4).ticks, [0, 0.5, 1]);
});

test("emits the format's infix within Android's 32 entries", () => {
    const e = emit(parse("exp(-x/4)*cos(x)"));
    assert.ok(e.n <= 28, e.s);
    assert.match(e.s, /^[\w\s().,*+/-]+$/);
});

test("poles split the curve short of the asymptote", () => {
    const segs = segments(fn("tan(x)"), -Math.PI, Math.PI, -4, 4);
    assert.equal(segs.length, 3);
    for (const [a, b] of segs) for (const x of [a, b]) assert.ok(Math.abs(Math.tan(x)) < 25, `tan(${x})`);
});

test("generate: marks, π ticks and a runtime curve", () => {
    const out = generate({ fn: "exp(-x/4)*cos(x)", x: [0, "4pi"], mark: ["max", "min"], t: "mp1_t" }, { mono: false, path: () => "", floatArray: () => "@a" });
    const s = JSON.stringify(out);
    for (const label of ["(6.04, 0.21)", "(2.9, −0.47)", "(9.18, −0.1)", "(12.32, 0.04)", "\"2π\"", "\"4π\""]) assert.ok(s.includes(label), label);
    assert.ok(s.includes("pathExpression"));
    assert.ok(!s.includes("floatArrays"));
});
