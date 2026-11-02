// {"$gen": {"kind": "scene3d", "objects": [{"shape": "box", "size": [2, 1, 1], "at": [0, 0.5, 0]}]}}
//
// A 3D scene from named primitives. The caller lists objects (shape, size, position, rotation,
// colour) in any units, Y up, X right, Z toward the viewer; the server works out everything that
// needs 3D maths and writes one canvas:
//
//   - each object's mesh: one meshPrimitive3D per distinct shape and size, built centred on its
//     own origin (a cone is moved down by half its height, a plane laid flat), shared by objects
//     of the same shape and size;
//   - a bounding sphere of the scene (every object's rotated box corners, plus its assembly
//     offset when the animation should stay in view), so the scene can turn to any angle and
//     stay framed;
//   - a perspective camera whose distance is an expression of the canvas's aspect: the sphere
//     fills `fill` of the narrower half-extent of the view at any window shape;
//   - the model chain: identity, tilt about X, spin about Y (each an expression of the drag, the
//     clock and the starting view), with the sphere's centre at the origin;
//     then per object its translate (plus its assembly offset times a per-step eased factor),
//     its rotations and scale, and the draw. Every object restarts from identity: the players
//     do not save the 3D matrix with matrixSave / matrixRestore;
//   - lights from a preset, the paint colours (theme colours pass through as written).
//
// The 3D viewport of the C++ and TypeScript players is the whole drawing surface, placed at the
// canvas's origin (the reference blits a window-sized buffer at the canvas's 0,0): a 3D canvas
// must start at the window's top left and fill it. Scene3D therefore fills the window; overlay
// text on top of it with a box rather than putting it in a column.
//
// Mono looks (ctx.mono): no motion (no autorotate, the assembly shown assembled), every object a
// hidden-line wireframe of its quads in onSurface over a fill of the background colour, lit by
// a preset that saturates the fill so it stays exactly the background in mono light.

export const kind = "scene3d";
export const doc = "A 3D scene from named primitives (box, sphere, cylinder, cone, torus, plane): automatic camera framing at any aspect, light presets, drag to orbit, autorotate, assembly animation, theme colours and a mono wireframe look";

const r4 = (n) => { const r = Math.round(n * 10000) / 10000; return Object.is(r, -0) ? 0 : r; };
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------------------------
// Shapes

export const SHAPES = {
    box: "size [width, height, depth]; `round` gives rounded edges (a radius in scene units)",
    sphere: "size = diameter, or [x, y, z] for an ellipsoid",
    cylinder: "size [diameter, height]; `axis` turns it (\"z\" faces the viewer)",
    cone: "size [base diameter, height], apex along +axis (default up)",
    torus: "size [outer diameter, tube thickness], lying flat; `axis: \"z\"` stands it up facing the viewer",
    plane: "size [width, depth], lying flat (a floor or a tabletop sheet); seen from above only",
};
const ALIASES = { cube: "box", cuboid: "box", block: "box", slab: "box", roundedbox: "box", ball: "sphere", ellipsoid: "sphere",
    disc: "cylinder", disk: "cylinder", rod: "cylinder", puck: "cylinder", ring: "torus", donut: "torus", doughnut: "torus", floor: "plane", sheet: "plane" };

/** [sx, sy, sz] from a number, [a, b] (round shapes: diameter, height) or [x, y, z]. */
function size3(size, shape) {
    if (size === undefined) size = 1;
    if (typeof size === "number") {
        if (shape === "torus") return [size, size * 0.25, size];
        if (shape === "plane") return [size, 0, size];
        return [size, size, size];
    }
    if (!Array.isArray(size) || size.length < 2 || size.length > 3 || size.some((v) => typeof v !== "number" || !(v >= 0)))
        throw new Error(`size ${JSON.stringify(size)}: a number or [x, y] / [x, y, z] of non-negative numbers`);
    if (size.length === 2) return shape === "plane" ? [size[0], 0, size[1]] : [size[0], size[1], size[0]];
    return size.slice();
}

/** Rotation that takes +Y to the axis, as [rx, ry, rz] degrees applied in the chain Y, X, Z. */
const AXIS_ROT = { y: [0, 0, 0], "+y": [0, 0, 0], "-y": [180, 0, 0], z: [90, 0, 0], "+z": [90, 0, 0], "-z": [-90, 0, 0],
    x: [0, 0, -90], "+x": [0, 0, -90], "-x": [0, 0, 90] };

/**
 * The mesh of one object, centred on its origin, and its local half-extents [hx, hy, hz] before
 * rotation. `scale` is set when the shape needs a non-uniform scale (an ellipsoid, an oval
 * cylinder). `segments` is chosen per look (fewer in mono, where every edge is a line).
 */
function meshFor(shape, s, o, mono) {
    const [sx, sy, sz] = s;
    switch (shape) {
        case "box": {
            const round = Number(o.round ?? 0);
            if (round > 0) {
                const rr = Math.min(round, sx / 2, sy / 2, sz / 2);
                return { mesh: { primitive: "roundedCube", dimX: r4(sx), dimY: r4(sy), dimZ: r4(sz), cornerRadius: r4(rr), segments: mono ? 2 : 3 }, smooth: false, half: [sx / 2, sy / 2, sz / 2] };
            }
            return { mesh: { primitive: "cube", dimX: r4(sx), dimY: r4(sy), dimZ: r4(sz), segments: 1 }, smooth: false, half: [sx / 2, sy / 2, sz / 2] };
        }
        case "sphere": {
            const d = Math.max(sx, sy, sz);
            const uniform = sx === sy && sy === sz;
            return { mesh: { primitive: "sphere", radius: r4(uniform ? sx / 2 : 0.5), segments: mono ? 16 : 24 }, smooth: true,
                scale: uniform ? null : [sx, sy, sz], half: [sx / 2, sy / 2, sz / 2], sphere: d / 2 };
        }
        case "cylinder": {
            const r = sx / 2;
            return { mesh: { primitive: "cylinder", radius: r4(r), from: [0, r4(-sy / 2), 0], to: [0, r4(sy / 2), 0], segments: mono ? 16 : 32 }, smooth: true,
                scale: sz !== sx && sx > 0 ? [1, 1, sz / sx] : null, half: [sx / 2, sy / 2, sz / 2], round: true };
        }
        case "cone":
            return { mesh: { primitive: "cone", radius: r4(sx / 2), height: r4(sy), center: [0, r4(-sy / 2), 0], segments: mono ? 16 : 24 }, smooth: true,
                scale: sz !== sx && sx > 0 ? [1, 1, sz / sx] : null, half: [sx / 2, sy / 2, sz / 2], round: true };
        case "torus": {
            const minor = Math.min(sy, sx / 2) / 2;
            const major = sx / 2 - minor;
            return { mesh: { primitive: "torus", majorRadius: r4(major), minorRadius: r4(minor), segments: mono ? 20 : 32 }, smooth: true,
                scale: sz !== sx && sx > 0 ? [1, 1, sz / sx] : null, half: [sx / 2, minor, sz / 2], round: true };
        }
        case "plane":
            // The primitive lies in XY facing +Z; the object turns it flat (normal +Y).
            return { mesh: { primitive: "plane", width: r4(sx), height: r4(sz) }, smooth: false, pre: [-90, 0, 0], half: [sx / 2, sz / 2, 0] };
        default:
            throw new Error(`shape '${shape}' is unknown: use ${Object.keys(SHAPES).join(", ")}`);
    }
}

// ---------------------------------------------------------------------------------------------
// Small 3D maths (column vectors, row-major 4x4 here; only used on the server)

const ident = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a, b) {
    const o = new Array(16).fill(0);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[i * 4 + j] += a[i * 4 + k] * b[k * 4 + j];
    return o;
}
export function rotX(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]; }
export function rotY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]; }
export function rotZ(a) { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; }
export const trans = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
const scl = (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1];
export const apply = (m, p) => [0, 1, 2].map((i) => m[i * 4] * p[0] + m[i * 4 + 1] * p[1] + m[i * 4 + 2] * p[2] + m[i * 4 + 3]);
export { mul as matMul, ident };

/** The object's own rotation chain (degrees): Y, then X, then Z, after the axis turn. */
function ownRotation(o) {
    const [rx, ry, rz] = o.rotateDeg;
    let m = ident();
    if (ry) m = mul(m, rotY(ry * DEG));
    if (rx) m = mul(m, rotX(rx * DEG));
    if (rz) m = mul(m, rotZ(rz * DEG));
    const [ax, ay, az] = o.axisDeg;
    if (ay) m = mul(m, rotY(ay * DEG));
    if (ax) m = mul(m, rotX(ax * DEG));
    if (az) m = mul(m, rotZ(az * DEG));
    if (o.pre) m = mul(m, rotX(o.pre[0] * DEG));
    if (o.scale) m = mul(m, scl(...o.scale));
    return m;
}

/** The object's model matrix in scene coordinates (its offset added for an exploded state). */
export function objectMatrix(o, offset = [0, 0, 0]) {
    return mul(trans(o.at[0] + offset[0], o.at[1] + offset[1], o.at[2] + offset[2]), ownRotation(o));
}

/** Points that bound an object: its local box corners (or, for round shapes, a ring of points). */
export function objectHull(o) {
    const [hx, hy, hz] = o.localHalf;
    const pts = [];
    if (o.roundHull) {
        for (let k = 0; k < 16; k++) {
            const a = (k / 16) * 2 * Math.PI, c = Math.cos(a) / Math.cos(Math.PI / 16), s = Math.sin(a) / Math.cos(Math.PI / 16);
            for (const y of [-hy, hy]) pts.push([hx * c, y, hz * s]);
        }
    } else {
        for (const x of [-hx, hx]) for (const y of [-hy, hy]) for (const z of [-hz, hz]) pts.push([x, y, z]);
    }
    return pts;
}

// ---------------------------------------------------------------------------------------------
// Planning: everything that is fixed when the document is built

const LIGHTS = {
    // A key light from the upper left in front, a cooler fill from the right: a product shot.
    studio: [{ dir: [0.45, -0.7, -0.55], color: "#FFFFF8F0", intensity: 0.8 }, { dir: [-0.7, -0.15, -0.5], color: "#FFE8F0FF", intensity: 0.35 }],
    // Lower contrast: three lights, no face goes dark.
    soft: [{ dir: [0.3, -0.8, -0.5], intensity: 0.55 }, { dir: [-0.6, -0.2, -0.6], intensity: 0.35 }, { dir: [0, 0.6, -0.8], intensity: 0.2 }],
    // Light from straight above and the front: a diagram look, faces close to their colour.
    flat: [{ dir: [0, -0.6, -0.8], intensity: 0.65 }, { dir: [0.5, -0.3, -0.4], intensity: 0.25 }],
    // Saturates every face (the sum of |n.l| over three axes is at least 1): the mono fill.
    mono: [{ dir: [1, 0, 0], intensity: 0.85 }, { dir: [0, 1, 0], intensity: 0.85 }, { dir: [0, 0, 1], intensity: 0.85 }],
};

const FOV = 0.6; // radians, vertical: a gentle perspective

/** The view after the scene chain: Ry(spin), then Rx(tilt) (the matrix is Rx * Ry). */
export function viewPoint(p, spin, tilt) {
    const cs = Math.cos(spin), ss = Math.sin(spin), ct = Math.cos(tilt), st = Math.sin(tilt);
    const x = cs * p[0] + ss * p[2], z1 = -ss * p[0] + cs * p[2];
    return [x, ct * p[1] - st * z1, st * p[1] + ct * z1];
}

/**
 * Camera framing for points (relative to the scene centre) over every spin and tilt the scene
 * can reach. The eye looks down -Z from [0, 0, d]; a point (x, y, z) projects to
 * (f / a) * x / (d - z) across and f * y / (d - z) up. It fits `fill` of the view when
 *   d >= z + f * |y| / fill                (vertically, any aspect)  -> Dv, the max over all
 *   d >= z + f * |x| / (fill * a)          (across, aspect a)        -> <= Zmax + K / a
 * so d(a) = max(Dv, Zmax + K / a) frames every point at every reachable angle and aspect, and
 * is one expression of the canvas's aspect at run time.
 */
export function framing(points, { spins, tilts, fill = 0.85, fovY = FOV }) {
    const f = 1 / Math.tan(fovY / 2);
    let Dv = 0, Zmax = -Infinity, Xmax = 0, Ymax = 0, R = 0;
    const take = (x, y, z) => {
        Dv = Math.max(Dv, z + (f * Math.abs(y)) / fill);
        Ymax = Math.max(Ymax, (f * Math.abs(y)) / fill);
        Zmax = Math.max(Zmax, z);
        Xmax = Math.max(Xmax, Math.abs(x));
    };
    for (const p of points) {
        R = Math.max(R, Math.hypot(...p));
        if (spins === "all") {
            // Over a whole turn the point sweeps a circle of radius r: x up to r, and the depth
            // before the tilt z1 in [-r, r]. Each bound above is convex in z1, so its maximum is
            // at an end: exact, with no spin sampling.
            const r = Math.hypot(p[0], p[2]);
            for (const t of tilts) for (const z1 of [-r, r]) {
                const ct = Math.cos(t), st = Math.sin(t);
                take(r, ct * p[1] - st * z1, st * p[1] + ct * z1);
            }
        } else {
            for (const s of spins) for (const t of tilts) take(...viewPoint(p, s, t));
        }
    }
    return { Dv: Dv * 1.01, Zmax, K: (f * Xmax * 1.01) / fill, Y: Ymax * 1.01, R, f };
}

/** The camera distance framing() gives for an aspect (width / height). */
export const cameraDistance = (fr, aspect, inset = 0) => Math.max(fr.Dv + fr.Y * (inset / (1 - inset)), fr.Zmax + fr.K / aspect);

/** The spins and tilts (radians) a scene can show: sampled finely where they vary. */
export function reachable({ spin0, tilt0, orbit, auto, tiltRange }) {
    const range = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
    const spins = orbit || auto ? "all" : [spin0];
    const tilts = orbit ? range(tiltRange[0], tiltRange[1], Math.max(4, Math.ceil((tiltRange[1] - tiltRange[0]) / (2 * DEG)))) : [tilt0];
    return { spins, tilts };
}

/** Projects a point (eye at [0, 0, d] looking at the origin) to normalised device coordinates. */
export function projectNdc(p, d, aspect, fovY = FOV) {
    const f = 1 / Math.tan(fovY / 2);
    const z = d - p[2];
    return [(f / aspect) * p[0] / z, f * p[1] / z, z];
}

function vec3(v, what, dflt) {
    if (v === undefined) return dflt;
    if (!Array.isArray(v) || v.length !== 3 || v.some((x) => typeof x !== "number" || !Number.isFinite(x)))
        throw new Error(`${what} ${JSON.stringify(v)}: three numbers [x, y, z]`);
    return v;
}

/** Resolves the spec into objects with geometry, timings, the bounding sphere. Pure. */
export function planScene(spec, { mono = false } = {}) {
    const list = spec.objects;
    if (!Array.isArray(list) || !list.length) throw new Error("objects: a non-empty list of {shape, size, at, ...}");
    if (list.length > 40) throw new Error(`${list.length} objects: up to 40 (each is drawn every frame in software)`);
    // Flags may arrive as true/false, 1/0 or "true"/"false" (a component's bool param is a number).
    const off = (v) => v === undefined || v === null || v === false || v === 0 || v === "false" || v === "0";
    const assemble = off(spec.assemble) ? null : typeof spec.assemble === "object" ? { ...spec.assemble } : {};
    if (assemble) for (const k of ["stagger", "hold", "duration"]) if (spec[k] !== undefined && assemble[k] === undefined) assemble[k] = spec[k];
    const objects = list.map((raw, i) => {
        if (!raw || typeof raw !== "object") throw new Error(`objects[${i}]: an object {shape, size, at}`);
        const name = String(raw.shape ?? "box").toLowerCase().replace(/[^a-z]/g, "");
        const shape = SHAPES[name] ? name : ALIASES[name];
        if (!shape) throw new Error(`objects[${i}]: shape '${raw.shape}' is unknown: use ${Object.keys(SHAPES).join(", ")}`);
        const s = size3(raw.size, shape);
        const m = meshFor(shape, s, { ...raw, round: raw.round ?? (name === "roundedbox" ? Math.min(...s) * 0.15 : undefined) }, mono);
        const axis = raw.axis === undefined ? "y" : String(raw.axis).toLowerCase();
        if (!AXIS_ROT[axis]) throw new Error(`objects[${i}]: axis '${raw.axis}': one of x, y, z, -x, -y, -z`);
        if (axis !== "y" && (shape === "box" || shape === "plane")) throw new Error(`objects[${i}]: axis is for round shapes; turn a ${shape} with rotate [x, y, z] degrees`);
        const rot = raw.rotate === undefined ? [0, 0, 0] : typeof raw.rotate === "number" ? [0, raw.rotate, 0] : vec3(raw.rotate, `objects[${i}].rotate`);
        const o = {
            index: i, name: raw.name ?? `${shape} ${i + 1}`, shape, size: s,
            at: vec3(raw.at, `objects[${i}].at`, [0, 0, 0]),
            rotateDeg: rot, axisDeg: AXIS_ROT[axis], pre: m.pre ?? null, scale: m.scale ?? null,
            mesh: m.mesh, smooth: m.smooth, localHalf: m.half, roundHull: shape !== "box" && shape !== "plane",
            color: raw.color ?? null, from: raw.from === undefined ? null : vec3(raw.from, `objects[${i}].from`),
            step: raw.step === undefined ? null : Number(raw.step),
        };
        // A scaled mesh is bounded in its own (unscaled) coordinates: the scale is in the matrix.
        if (o.scale) o.localHalf = shape === "sphere" ? [0.5, 0.5, 0.5] : [m.half[0], m.half[1], m.half[0]];
        return o;
    });
    // Assembled bounds, then the centre.
    const world = (o, off) => objectHull(o).map((p) => apply(objectMatrix(o, off), p));
    let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const o of objects) for (const p of world(o)) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
    const center = lo.map((v, a) => (v + hi[a]) / 2);
    const assembled = Math.max(...objects.flatMap((o) => world(o).map((p) => Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]))), 1e-6);
    // Assembly offsets: given, or away from the centre (straight up for a part at the centre).
    if (assemble) {
        const dist = Number(assemble.distance ?? 0.9) * assembled;
        for (const o of objects) {
            if (o.from) continue;
            const c = apply(objectMatrix(o), [0, 0, 0]);
            let v = [c[0] - center[0], c[1] - center[1], c[2] - center[2]];
            let n = Math.hypot(...v);
            if (n < assembled * 0.15) { v = [0, 1, 0]; n = 1; }
            o.from = v.map((x) => r4((x / n) * dist));
        }
    }
    const frame = spec.frame === undefined || spec.frame === "auto" ? (assemble && !mono ? "all" : "assembled") : spec.frame;
    if (frame !== "all" && frame !== "assembled") throw new Error(`frame '${frame}': "assembled" or "all"`);
    let radius = assembled;
    if (frame === "all" && assemble)
        for (const o of objects) if (o.from) for (const p of world(o, o.from)) radius = Math.max(radius, Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]));
    // Floor: a thin disc under everything, part of the framing.
    let floor = null;
    if (!off(spec.floor)) {
        const rr = Math.max(Math.hypot(hi[0] - center[0], hi[2] - center[2]), Math.hypot(lo[0] - center[0], lo[2] - center[2])) * 1.15;
        const th = Math.max(assembled * 0.02, 1e-3);
        floor = { y: lo[1] - th / 2 - assembled * 0.01, r: rr, th };
        radius = Math.max(radius, Math.hypot(rr, floor.y - th - center[1]));
    }
    // Assembly timeline (seconds): parts in list order, or by `step` (parts with the same step move together).
    let timeline = null;
    if (assemble && !mono) {
        const steps = [...new Set(objects.map((o, i) => o.step ?? i))].sort((a, b) => a - b);
        const dur = Number(assemble.duration ?? 0.9), gap = Number(assemble.stagger ?? 0.45);
        const hold = Number(assemble.hold ?? 2.5), back = Number(assemble.back ?? 1.2), rest = Number(assemble.rest ?? 0.6);
        if (!(dur > 0) || !(gap >= 0) || !(hold >= 0) || !(back > 0) || !(rest >= 0)) throw new Error("assemble: duration and back > 0, stagger, hold and rest >= 0 (seconds)");
        const start = new Map(steps.map((s, k) => [s, rest + k * gap]));
        for (const o of objects) o.start = start.get(o.step ?? o.index);
        const built = rest + (steps.length - 1) * gap + dur;
        timeline = { dur, back, period: built + hold + back, backStart: built + hold };
    }
    // Every point the camera must keep in view, relative to the centre.
    const rel = (q) => [q[0] - center[0], q[1] - center[1], q[2] - center[2]];
    const points = [];
    for (const o of objects) {
        for (const q of world(o)) points.push(rel(q));
        if (frame === "all" && o.from) for (const q of world(o, o.from)) points.push(rel(q));
    }
    if (floor) for (let k = 0; k < 24; k++) {
        const a = (k / 24) * 2 * Math.PI, rr = floor.r / Math.cos(Math.PI / 24);
        for (const y of [floor.y - floor.th / 2, floor.y + floor.th / 2]) points.push(rel([center[0] + rr * Math.cos(a), y, center[2] + rr * Math.sin(a)]));
    }
    // The view: a starting spin and tilt, drag to orbit, autorotate (degrees per second).
    const view = spec.view ?? {};
    const motion = {
        spin0: Number(spec.spin ?? view.spin ?? -30) * DEG, tilt0: Number(spec.tilt ?? view.tilt ?? 20) * DEG,
        orbit: spec.orbit === undefined || !off(spec.orbit), auto: mono ? 0 : Number(spec.autorotate ?? 0),
        tiltRange: (spec.tiltRange ?? [-5, 50]).map((d) => Number(d) * DEG),
    };
    if (![motion.spin0, motion.tilt0, motion.auto, ...motion.tiltRange].every(Number.isFinite)) throw new Error("view {spin, tilt}, autorotate and tiltRange are numbers (degrees, degrees per second)");
    if (motion.tiltRange[0] > motion.tilt0 || motion.tiltRange[1] < motion.tilt0 || motion.tiltRange.some((t) => Math.abs(t) > 89.5 * DEG))
        throw new Error("tiltRange [low, high] holds view.tilt, within -89 to 89 degrees");
    const fill = Number(spec.fill ?? 0.9);
    if (!(fill >= 0.3 && fill <= 1)) throw new Error("fill: the fraction of the view the scene may use, 0.3 to 1");
    const fr = framing(points, { ...reachable(motion), fill });
    return { objects, center, radius, assembled, frame, floor, timeline, bounds: { lo, hi }, points, motion, fill, framing: fr };
}

// ---------------------------------------------------------------------------------------------
// The document

export function generate(spec, ctx) {
    const mono = Boolean(ctx.mono);
    const plan = planScene(spec, { mono });
    const { objects, center, framing: fr, motion } = plan;
    const p = ctx.unique("s3d");
    const V = (n) => `@${p}${n}`;
    const cmds = [];
    const decl = (n, value) => { cmds.push({ variable: { name: p + n, value } }); return V(n); };

    const { spin0, tilt0, orbit, auto, tiltRange } = motion;
    const PX = 0.01; // radians of spin per dp dragged
    const TPX = 0.006;

    cmds.push({ clearDepth3D: {} });
    // Camera: its distance follows the aspect (framing() above), so every reachable view fits.
    // Insets (dp kept clear at the top and bottom for an overlay) shrink the height the scene
    // may use to H - top - bottom: the vertical bound grows from Dv by Y * inset / (1 - inset)
    // (each point's bound is z + y' / (1 - inset) <= Dv + Y * (1 / (1 - inset) - 1)), and a 2D
    // translate of (top - bottom) / 2 moves the picture to the middle of what is left: the
    // players draw the 3D buffer under the canvas's 2D transform.
    const insetTop = Number(spec.insetTop ?? 0), insetBottom = Number(spec.insetBottom ?? 0);
    if (!(insetTop >= 0 && insetBottom >= 0)) throw new Error("insetTop and insetBottom: dp, 0 or more");
    const inset = insetTop + insetBottom;
    const vert = inset ? `${r4(fr.Dv)} + ${r4(fr.Y)} * ${r4(inset)} / max(componentHeight() - ${r4(inset)}, 1)` : r4(fr.Dv);
    const dist = decl("d", `max(${vert}, ${r4(fr.Zmax)} + ${r4(fr.K)} * componentHeight() / componentWidth())`);
    if (insetTop !== insetBottom) cmds.push({ translate: { dx: 0, dy: r4((insetTop - insetBottom) / 2) } });
    cmds.push({ camera3D: { projection: "perspective", fovY: FOV, aspect: "componentWidth() / componentHeight()",
        near: r4(Math.max(fr.R * 0.02, 1e-4)), far: `${dist} + ${r4(fr.R * 1.1)}`, eye: [0, 0, dist], center: [0, 0, 0], up: [0, 1, 0] } });
    const preset = mono ? "mono" : String(spec.light ?? "studio");
    if (!LIGHTS[preset]) throw new Error(`light '${spec.light}': one of ${Object.keys(LIGHTS).filter((k) => k !== "mono").join(", ")}`);
    cmds.push({ lights3D: { lights: LIGHTS[preset].map((l) => ({ type: "directional", ...(l.color ? { color: l.color } : {}), dir: l.dir, intensity: l.intensity })) } });

    // Meshes: one per distinct shape and size.
    const meshKey = new Map();
    let nextId = 1 + 100 * (Number(/(\d+)$/.exec(p)?.[1] ?? 1) - 1);
    const meshOf = (mesh) => {
        const k = JSON.stringify(mesh);
        if (!meshKey.has(k)) { const id = nextId++; meshKey.set(k, id); cmds.push({ meshPrimitive3D: { id, ...mesh } }); }
        return meshKey.get(k);
    };
    for (const o of objects) o.meshId = meshOf(o.mesh);
    let floorId = null;
    if (plan.floor) floorId = meshOf({ primitive: "cylinder", radius: r4(plan.floor.r), from: [0, r4(-plan.floor.th / 2), 0], to: [0, r4(plan.floor.th / 2), 0], segments: mono ? 32 : 48 });

    // Orbit: drag (dp) and the clock, as angles.
    let spin = r4(spin0), tilt = r4(tilt0);
    if (orbit) {
        cmds.push({ touchExpression: { name: `${p}sx`, defaultValue: 0, min: -100000, max: 100000, stopMode: "gently", expression: "touchX()" } });
        cmds.push({ touchExpression: { name: `${p}sy`, defaultValue: 0, min: r4((tiltRange[0] - tilt0) / TPX), max: r4((tiltRange[1] - tilt0) / TPX), stopMode: "gently", expression: "touchY()" } });
        spin = `${V("sx")} * ${PX} + ${r4(spin0)}`;
        tilt = `${V("sy")} * ${TPX} + ${r4(tilt0)}`;
    }
    if (auto) {
        const period = r4(360 / Math.abs(auto));
        spin = `${spin} + (continuousSec() % ${period}) * ${r4((2 * Math.PI / period) * Math.sign(auto))}`;
    }
    if (typeof spin === "string") spin = decl("spin", spin);
    if (typeof tilt === "string") tilt = decl("tilt", tilt);

    // Assembly: one eased factor per step, 1 = at its offset, 0 = in place.
    const tl = plan.timeline;
    const factor = new Map();
    if (tl) {
        const tc = decl("t", `continuousSec() % ${r4(tl.period)}`);
        const backF = decl("b", `smooth_step(${tc}, ${r4(tl.backStart + tl.back)}, ${r4(tl.backStart)})`);
        for (const o of objects) {
            if (!o.from) continue;
            const key = o.start;
            if (!factor.has(key)) factor.set(key, decl(`e${factor.size}`, `max(1 - smooth_step(${tc}, ${r4(key + tl.dur)}, ${r4(key)}), ${backF})`));
        }
    }

    // Each object's chain starts again from identity: the players do not save the 3D model
    // matrix with matrixSave / matrixRestore, so a save block would let translates accumulate.
    // identity, tilt about X, spin about Y (both about the scene's centre, at the origin), the
    // object's place relative to the centre (plus its assembly offset), its own rotations.
    const head = () => {
        const h = [{ matrix3D: { op: "identity" } }];
        if (tilt !== 0) h.push({ matrix3D: { op: "rotate", angle: tilt, axis: [1, 0, 0] } });
        if (spin !== 0) h.push({ matrix3D: { op: "rotate", angle: spin, axis: [0, 1, 0] } });
        return h;
    };
    const place = (at, off, f) => {
        const pos = [0, 1, 2].map((a) => {
            const base = r4(at[a] - center[a]);
            return f && off && off[a] ? (base ? `${base} + ${r4(off[a])} * ${f}` : `${r4(off[a])} * ${f}`) : base;
        });
        return pos.some((v) => v !== 0) ? [{ matrix3D: { op: "translate", x: pos[0], y: pos[1], z: pos[2] } }] : [];
    };

    const style = mono ? "mono" : String(spec.style ?? "solid");
    if (!["solid", "outlined", "wireframe", "mono"].includes(style)) throw new Error(`style '${spec.style}': solid, outlined or wireframe`);
    const lineColor = spec.lineColor ?? "@colors.onSurface";
    const bg = spec.background ?? "@colors.background";
    let lastColor = null;
    const paint = (c) => { if (c !== lastColor) { cmds.push({ paint: { ops: [{ color: c }] } }); lastColor = c; } };
    const draw = (id, smooth, color) => {
        if (style === "solid" || style === "outlined") { paint(color); cmds.push({ drawMesh3D: { mesh: id, mode: smooth ? "smooth" : "flat" } }); }
        if (style === "mono") { paint(bg); cmds.push({ drawMesh3D: { mesh: id, mode: "flat" } }); }
        if (style !== "solid") { paint(style === "wireframe" ? color : lineColor); cmds.push({ drawMesh3D: { mesh: id, wireframe: true, edges: [0, 1] } }); }
    };
    if (plan.floor) {
        cmds.push(...head(), ...place([center[0], plan.floor.y, center[2]]));
        draw(floorId, true, spec.floorColor ?? "@colors.surfaceHigh");
    }
    const palette = ["@colors.primary", "@colors.secondary", "@colors.success", "@colors.warning", "@colors.muted"];
    for (const o of objects) {
        const color = o.color ?? palette[o.index % palette.length];
        cmds.push(...head(), ...place(o.at, o.from, o.from && factor.get(o.start)));
        const [rx, ry, rz] = o.rotateDeg, [ax, ay, az] = o.axisDeg;
        const rot = (deg, axis) => { if (deg) cmds.push({ matrix3D: { op: "rotate", angle: r4(deg * DEG), axis } }); };
        rot(ry, [0, 1, 0]); rot(rx, [1, 0, 0]); rot(rz, [0, 0, 1]);
        rot(ay, [0, 1, 0]); rot(ax, [1, 0, 0]); rot(az, [0, 0, 1]);
        if (o.pre) rot(o.pre[0], [1, 0, 0]);
        if (o.scale) cmds.push({ matrix3D: { op: "scale", x: r4(o.scale[0]), y: r4(o.scale[1]), z: r4(o.scale[2]) } });
        draw(o.meshId, o.smooth, color);
    }

    const mods = ["fillMaxSize", { background: bg }];
    if (spec.label) mods.push({ semantics: { contentDescription: String(spec.label) } });
    const canvas = { canvas: { modifiers: mods, commands: cmds } };
    const overlay = spec.overlay;
    if (overlay && (!Array.isArray(overlay) || overlay.length)) {
        return { box: { modifiers: ["fillMaxSize"], children: [canvas, ...(Array.isArray(overlay) ? overlay : [overlay])] } };
    }
    return canvas;
}
