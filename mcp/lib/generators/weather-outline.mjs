// {"$gen": {"kind": "weather-outline", "shape": "sun" | "cloud" | "rain" | "snow" | "storm" | "bolt"}}
// The outlines WeatherIcon's morph mode tweens between, registered once per document as op-list
// paths in a 200-unit box (centre 100, 100) and returned as "$paths.<id>".
//
// sun, cloud, rain, snow and storm are made to morph into each other: each is the same verbs
// (moveTo, 28 cubicTo, close) through points ray-cast from one centre (100, 104) at the same 28
// angles, so point k of the sun disc sits at the same angle as point k of every cloud, and a
// pathTween between any two of them is a clean shape change. bolt is a lightning bolt drawn under
// the storm cloud (not tweened).

export const kind = "weather-outline";
export const doc = "A WeatherIcon morph outline (sun, cloud, rain, snow, storm, bolt) in a 200-unit box, as a shared path";

export const N = 28;                 // cubic segments per outline
const C = [100, 104];                // ray-cast centre, inside every shape

// Each shape is a union of circles ["c", cx, cy, r] and rounded rects ["r", l, t, r, b, radius].
export const SHAPES = {
    sun: [["c", 100, 100, 44]],
    cloud: [["c", 70, 112, 24], ["c", 102, 92, 34], ["c", 134, 110, 24], ["r", 46, 106, 158, 136, 15]],
    rain: [["c", 66, 100, 25], ["c", 103, 84, 34], ["c", 140, 100, 24], ["r", 40, 96, 164, 124, 14]],
    snow: [["c", 64, 104, 21], ["c", 90, 86, 27], ["c", 122, 84, 29], ["c", 146, 104, 20], ["r", 46, 100, 160, 124, 12]],
    storm: [["c", 58, 96, 22], ["c", 92, 80, 30], ["c", 128, 78, 32], ["c", 156, 94, 20], ["r", 34, 92, 172, 118, 12]],
};
const BOLT = [[108, 112], [88, 146], [102, 146], [90, 182], [124, 136], [108, 136], [120, 112]];

function inside(shape, x, y) {
    for (const [k, ...a] of shape) {
        if (k === "c") {
            const [cx, cy, r] = a;
            if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) return true;
        } else {
            const [l, t, r, b, rad] = a;
            if (l <= x && x <= r && t <= y && y <= b) {
                const qx = Math.min(Math.max(x, l + rad), r - rad), qy = Math.min(Math.max(y, t + rad), b - rad);
                if ((x - qx) ** 2 + (y - qy) ** 2 <= rad * rad) return true;
            }
        }
    }
    return false;
}

/** The outer boundary of a shape, sampled at N angles from the centre (clockwise from the top). */
export function outline(shape) {
    const pts = [];
    for (let k = 0; k < N; k++) {
        const th = -Math.PI / 2 + 2 * Math.PI * k / N;
        const dx = Math.cos(th), dy = Math.sin(th);
        let t = 120;
        while (t > 0 && !inside(shape, C[0] + dx * t, C[1] + dy * t)) t -= 0.05;
        pts.push([C[0] + dx * t, C[1] + dy * t]);
    }
    return pts;
}

const r1 = (v) => Math.round(v * 10) / 10;

/** A closed Catmull-Rom spline through pts, as moveTo + cubicTo ops + close. */
export function cubicPath(pts) {
    const n = pts.length;
    const ops = [{ type: "moveTo", x: r1(pts[0][0]), y: r1(pts[0][1]) }];
    for (let i = 0; i < n; i++) {
        const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
        ops.push({
            type: "cubicTo",
            x1: r1(p1[0] + (p2[0] - p0[0]) / 6), y1: r1(p1[1] + (p2[1] - p0[1]) / 6),
            x2: r1(p2[0] - (p3[0] - p1[0]) / 6), y2: r1(p2[1] - (p3[1] - p1[1]) / 6),
            x3: r1(p2[0]), y3: r1(p2[1]),
        });
    }
    ops.push({ type: "close" });
    return ops;
}

export function shapeOps(shape) {
    if (shape === "bolt") {
        return [{ type: "moveTo", x: BOLT[0][0], y: BOLT[0][1] },
                ...BOLT.slice(1).map(([x, y]) => ({ type: "lineTo", x, y })), { type: "close" }];
    }
    const s = SHAPES[shape];
    if (!s) throw new Error(`weather-outline: shape '${shape}' (sun, cloud, rain, snow, storm or bolt)`);
    return cubicPath(outline(s));
}

const cache = new Map();
export function generate(spec, ctx) {
    const shape = String(spec.shape ?? "sun");
    if (!cache.has(shape)) cache.set(shape, shapeOps(shape));
    return ctx.path(`wx_${shape}`, cache.get(shape));
}
