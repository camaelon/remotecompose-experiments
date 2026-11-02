// node --test mcp/lib/generators/weather-outline.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { N, SHAPES, shapeOps, generate } from "./weather-outline.mjs";

const verbs = (ops) => ops.map((o) => o.type).join(",");

test("the five morph outlines have the same verbs, so any pair tweens", () => {
    const ref = verbs(shapeOps("sun"));
    assert.equal(shapeOps("sun").length, N + 2);       // moveTo, N cubics, close
    for (const s of Object.keys(SHAPES)) assert.equal(verbs(shapeOps(s)), ref, s);
});

test("the sun is a disc of radius 44 about (100, 100); the clouds stay in the 200-unit box", () => {
    for (const o of shapeOps("sun").filter((o) => o.type === "cubicTo")) {
        assert.ok(Math.abs(Math.hypot(o.x3 - 100, o.y3 - 100) - 44) < 6, `${o.x3},${o.y3}`);
    }
    for (const s of Object.keys(SHAPES)) {
        for (const o of shapeOps(s)) for (const [k, v] of Object.entries(o)) if (k !== "type") assert.ok(v >= 0 && v <= 200, `${s} ${k}=${v}`);
    }
});

test("generate registers each shape once per document and returns its reference", () => {
    const paths = new Map();
    const ctx = { path: (hint, ops) => { const k = JSON.stringify(ops); if (!paths.has(k)) paths.set(k, `$paths.gen_${hint}_${paths.size + 1}`); return paths.get(k); } };
    const a = generate({ shape: "rain" }, ctx), b = generate({ shape: "rain" }, ctx), c = generate({ shape: "bolt" }, ctx);
    assert.equal(a, b);
    assert.notEqual(a, c);
    assert.match(a, /^\$paths\./);
    assert.throws(() => generate({ shape: "hail" }, ctx), /sun, cloud, rain, snow, storm or bolt/);
});
