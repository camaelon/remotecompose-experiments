// node --test mcp/lib/generators/scene3d.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
    generate, planScene, framing, reachable, cameraDistance, viewPoint, objectHull, objectMatrix, apply, matMul, ident,
    rotX, rotY, rotZ, trans,
} from "./scene3d.mjs";

const DEG = Math.PI / 180;
const FOV = 0.6;
const ctx = (mono = false) => { let n = 0; return { mono, unique: (p) => `${p}${++n}`, header: null, name: "test" }; };

const SCENES = {
    cube: { objects: [{ shape: "box", size: 1 }] },
    mixed: {
        objects: [
            { shape: "box", size: [2, 0.2, 1], at: [0, 0, 0] },
            { shape: "sphere", size: 0.6, at: [-0.6, 0.4, 0] },
            { shape: "cylinder", size: [0.4, 0.8], at: [0.1, 0.5, 0] },
            { shape: "cone", size: [0.5, 0.7], at: [0.7, 0.45, 0], rotate: [0, 30, 10] },
            { shape: "torus", size: [0.6, 0.12], at: [0, 0.4, 0.4], axis: "z" },
        ],
    },
    tallShelfExploded: {
        assemble: true,
        objects: [
            { shape: "box", size: [0.8, 0.02, 0.3], at: [0, 0.05, 0] },
            { shape: "box", size: [0.02, 1.8, 0.3], at: [-0.41, 0.9, 0], from: [-0.7, 0, 0] },
            { shape: "box", size: [0.02, 1.8, 0.3], at: [0.41, 0.9, 0], from: [0.7, 0, 0] },
            { shape: "box", size: [0.84, 0.02, 0.32], at: [0, 1.81, 0] },
        ],
    },
    flatWithFloor: { floor: true, objects: [{ shape: "plane", size: [3, 1] }, { shape: "sphere", size: [0.5, 0.2, 0.5], at: [1, 0.1, 0] }] },
    fixedView: { orbit: false, view: { spin: 40, tilt: 10 }, objects: [{ shape: "box", size: [3, 0.5, 0.5], rotate: [0, 0, 20] }] },
    autorotateOnly: { orbit: false, autorotate: 30, objects: [{ shape: "cylinder", size: [0.3, 2], axis: "x", at: [0.5, 0, 0] }, { shape: "box", size: 0.5 }] },
};

/** Every view the scene can reach, sampled independently of framing()'s own sampling. */
function views(plan) {
    const { orbit, auto, spin0, tilt0, tiltRange } = plan.motion;
    const spins = orbit || auto ? Array.from({ length: 52 }, (_, i) => i * 7 * DEG) : [spin0];
    const tilts = orbit ? [tiltRange[0], ...Array.from({ length: 9 }, (_, i) => tiltRange[0] + ((tiltRange[1] - tiltRange[0]) * (i + 0.5)) / 9), tiltRange[1]] : [tilt0];
    return spins.flatMap((s) => tilts.map((t) => [s, t]));
}

const ndc = (p, d, aspect) => { const f = 1 / Math.tan(FOV / 2); const z = d - p[2]; return [(f / aspect) * p[0] / z, (f * p[1]) / z, z]; };

for (const [name, spec] of Object.entries(SCENES)) {
    test(`camera framing keeps every part of '${name}' in view at every reachable angle and aspect`, () => {
        const plan = planScene(spec);
        const fill = plan.fill;
        let reach = 0;
        for (const aspect of [0.3, 0.45, 0.5625, 1, 1.5, 16 / 9, 3]) {
            const d = cameraDistance(plan.framing, aspect);
            for (const [s, t] of views(plan)) {
                for (const p of plan.points) {
                    const [x, y, z] = ndc(viewPoint(p, s, t), d, aspect);
                    assert.ok(z > 0, `${name}: a point behind the eye`);
                    assert.ok(Math.abs(x) <= fill + 1e-6 && Math.abs(y) <= fill + 1e-6, `${name} aspect ${aspect} spin ${(s / DEG).toFixed(0)} tilt ${(t / DEG).toFixed(0)}: ndc ${x.toFixed(3)}, ${y.toFixed(3)} outside ${fill}`);
                    reach = Math.max(reach, Math.abs(x), Math.abs(y));
                }
            }
        }
        // ...and is not needlessly far: some view uses most of the frame.
        assert.ok(reach > fill * 0.75, `${name}: the scene never fills more than ${reach.toFixed(2)} of the view`);
    });
}

test("insets: with q of the height kept clear, every view fits fill * (1 - q) vertically", () => {
    for (const spec of [SCENES.mixed, SCENES.tallShelfExploded, SCENES.flatWithFloor]) {
        const plan = planScene(spec);
        for (const aspect of [0.5625, 1, 16 / 9]) for (const q of [0.1, 0.25, 0.4]) {
            const d = cameraDistance(plan.framing, aspect, q);
            for (const [s, t] of views(plan)) for (const p of plan.points) {
                const [x, y] = ndc(viewPoint(p, s, t), d, aspect);
                assert.ok(Math.abs(y) <= plan.fill * (1 - q) + 1e-6 && Math.abs(x) <= plan.fill + 1e-6, `q ${q} aspect ${aspect}: ${x}, ${y}`);
            }
        }
    }
});

test("every point of an object is counted: hull points bound the mesh's own extent", () => {
    // a cylinder along x: its hull, through the matrix, spans x of the height and y/z of the radius
    const plan = planScene({ objects: [{ shape: "cylinder", size: [0.4, 2], axis: "x" }] });
    const o = plan.objects[0];
    const pts = objectHull(o).map((p) => apply(objectMatrix(o), p));
    const ext = [0, 1, 2].map((a) => Math.max(...pts.map((p) => Math.abs(p[a]))));
    assert.ok(Math.abs(ext[0] - 1) < 1e-9, `x extent ${ext[0]}`);
    assert.ok(ext[1] >= 0.2 - 1e-9 && ext[1] < 0.21 && ext[2] >= 0.2 - 1e-9 && ext[2] < 0.21, `y/z ${ext[1]} ${ext[2]}`);
});

/** Evaluates a generated canvas's matrix3D chains with numeric angles: one matrix per draw. */
function chains(cmds, vars = {}) {
    const val = (v) => (typeof v === "number" ? v : vars[v] ?? (() => { throw new Error(`unbound ${v}`); })());
    const out = [];
    let m = ident();
    for (const c of cmds) {
        if (c.matrix3D) {
            const { op, x, y, z, angle, axis } = c.matrix3D;
            if (op === "identity") m = ident();
            else if (op === "translate") m = matMul(m, trans(val(x), val(y), val(z)));
            else if (op === "scale") m = matMul(m, [val(x), 0, 0, 0, 0, val(y), 0, 0, 0, 0, val(z), 0, 0, 0, 0, 1]);
            else if (op === "rotate") {
                const a = val(angle);
                const r = axis[0] ? rotX(a) : axis[1] ? rotY(a) : rotZ(a);
                m = matMul(m, r);
            }
        }
        if (c.drawMesh3D && !c.drawMesh3D.wireframe) out.push({ mesh: c.drawMesh3D.mesh, m });
    }
    return out;
}

test("the emitted transform chain places each mesh where the plan says, after tilt and spin", () => {
    const spec = { ...SCENES.mixed, orbit: false, view: { spin: 25, tilt: 15 } };
    const plan = planScene(spec);
    const doc = generate(spec, ctx());
    const draws = chains(doc.canvas.commands);
    assert.equal(draws.length, plan.objects.length);
    plan.objects.forEach((o, i) => {
        for (const p of objectHull(o)) {
            const got = apply(draws[i].m, p);
            const w = apply(objectMatrix(o), p).map((v, a) => v - plan.center[a]);
            const want = viewPoint(w, 25 * DEG, 15 * DEG);
            for (let a = 0; a < 3; a++) assert.ok(Math.abs(got[a] - want[a]) < 1e-3, `object ${i} axis ${a}: ${got[a]} vs ${want[a]}`);
        }
    });
});

test("round shapes turn by axis: a cone along +z points at the viewer, a torus on z stands up", () => {
    const plan = planScene({ objects: [{ shape: "cone", size: [1, 2], axis: "z" }, { shape: "torus", size: [1, 0.2], axis: "z", at: [3, 0, 0] }] });
    const [cone, torus] = plan.objects;
    const apex = apply(objectMatrix(cone), [0, 1, 0]); // the mesh is centred: its apex is at +h/2
    assert.ok(apex[2] > 0.99 && Math.abs(apex[1]) < 1e-9);
    const rim = objectHull(torus).map((p) => apply(objectMatrix(torus), p));
    assert.ok(Math.max(...rim.map((p) => p[1])) > 0.49, "a standing torus spans y");
    assert.ok(Math.max(...rim.map((p) => Math.abs(p[2]))) < 0.11, "and is thin in z");
});

test("meshes are shared by objects of the same shape and size", () => {
    const doc = generate({ objects: [{ shape: "box", size: 1 }, { shape: "box", size: 1, at: [2, 0, 0] }, { shape: "box", size: 2, at: [5, 0, 0] }] }, ctx());
    const meshes = doc.canvas.commands.filter((c) => c.meshPrimitive3D);
    assert.equal(meshes.length, 2);
});

test("the camera distance expression is the one the plan computes", () => {
    const spec = SCENES.mixed;
    const doc = generate(spec, ctx());
    const plan = planScene(spec);
    const v = doc.canvas.commands.find((c) => c.variable && /d$/.test(c.variable.name)).variable.value;
    for (const [w, h] of [[360, 640], [640, 360], [160, 160]]) {
        const js = v.replace(/componentWidth\(\)/g, w).replace(/componentHeight\(\)/g, h);
        const got = Function(`"use strict"; const max = Math.max; return ${js};`)();
        assert.ok(Math.abs(got - cameraDistance(plan.framing, w / h)) < 1e-3 * got, `${w}x${h}: ${got}`);
    }
});

test("assembly: offsets default away from the centre, and each step eases between 1 and 0", () => {
    const plan = planScene(SCENES.tallShelfExploded);
    const [bottom, left, right, top] = plan.objects;
    assert.deepEqual(left.from, [-0.7, 0, 0]);
    assert.ok(bottom.from[1] < 0 && top.from[1] > 0, "auto offsets move the bottom down and the top up");
    assert.ok(plan.timeline.period > plan.timeline.backStart);
    const doc = generate(SCENES.tallShelfExploded, ctx());
    const vars = doc.canvas.commands.filter((c) => c.variable).map((c) => c.variable);
    assert.ok(vars.some((v) => /smooth_step/.test(v.value)));
    assert.ok(vars.some((v) => /continuousSec\(\) %/.test(v.value)));
});

test("mono: no clock, background-filled meshes under onSurface hidden-line edges", () => {
    const doc = generate({ ...SCENES.tallShelfExploded, autorotate: 20 }, ctx(true));
    const s = JSON.stringify(doc);
    assert.ok(!/continuousSec/.test(s), "no motion in mono");
    const cmds = doc.canvas.commands;
    assert.ok(cmds.some((c) => c.drawMesh3D?.wireframe));
    assert.ok(cmds.some((c) => c.paint?.ops?.[0]?.color === "@colors.onSurface"));
    assert.ok(cmds.some((c) => c.paint?.ops?.[0]?.color === "@colors.background"));
    // and the parts sit assembled
    for (const c of cmds) if (c.matrix3D?.op === "translate") for (const k of ["x", "y", "z"]) assert.equal(typeof c.matrix3D[k], "number");
});

test("errors name what to write", () => {
    assert.throws(() => planScene({ objects: [] }), /non-empty/);
    assert.throws(() => planScene({ objects: [{ shape: "teapot" }] }), /box, sphere, cylinder/);
    assert.throws(() => planScene({ objects: [{ shape: "box", at: [1, 2] }] }), /three numbers/);
    assert.throws(() => planScene({ objects: [{ shape: "box", axis: "z" }] }), /rotate/);
    assert.throws(() => planScene({ tiltRange: [30, 60], objects: [{ shape: "box" }] }), /tiltRange/);
});

test("aliases: cube, ball, disc, donut", () => {
    const plan = planScene({ objects: ["cube", "ball", "disc", "donut"].map((shape, i) => ({ shape, at: [i * 2, 0, 0] })) });
    assert.deepEqual(plan.objects.map((o) => o.shape), ["box", "sphere", "cylinder", "torus"]);
    assert.ok(reachable(plan.motion).spins === "all");
    assert.ok(framing(plan.points, { spins: [0], tilts: [0] }).Dv > 0);
});
