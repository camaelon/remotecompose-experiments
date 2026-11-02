// {"$gen": {"kind": "chart3d", "type": "scatter", "points": [[x, y, z], ...], "labels": {...}}}
//
// 3D charts from data, not geometry: a scatter (points sized and coloured by value), bars (a
// grid of categories by series) or a surface z = f(x, y) from a formula. The server picks the
// axis ranges and ticks, maps the data into a box (x across, y into the screen, z up), frames
// the camera so the box fits the canvas at any aspect and every orbit angle, and writes one
// canvas:
//   - the scene: a floor and four walls with gridlines on the ticks (a wall facing the camera is
//     back-face culled, so the two back walls always show), then the data; drag orbits (spin is
//     free, tilt is clamped so the camera stays above the floor), optional autorotate;
//   - 2D labels on top: tick values on the floor edges nearest the viewer and up the side edge
//     of a back wall, axis titles beyond them. Their positions are runtime expressions of the
//     same rotation and projection the 3D pass uses, so they follow the orbit; the 3D format has
//     no text, and labels drawn as 2D text stay sharp and readable at every size.
// Colour by value is a 5-step single-hue ramp (light to dark blue, every step 2:1 or more on the
// light and the dark surface), quantised: a mesh takes one paint colour, so points and bars are
// drawn in one loop per step, and a surface as five copies of its height field, each clamped
// below its band's top (the lowest band drawn first wins equal depths). Mono draws the data in
// onSurface (points and bars shaded; the surface as a hidden-line wireframe), with no motion.
//
// Mechanics that are easy to get wrong:
//   - The players render 3D into a buffer the size of the whole document, composited at the
//     canvas origin under the live transform. The 3D pass is therefore translated by
//     ((componentWidth() - windowWidth()) / 2, (componentHeight() - windowHeight()) / 2) so the
//     buffer's centre lands on the canvas centre, and the field of view is widened by
//     windowHeight() / componentHeight() so the canvas, not the document, gets the framing.
//   - Each software mesh draw composites the whole buffer once (both players): draws are the
//     render-time cost, so data shares one unit mesh drawn in loops over float arrays.
//
// Output is plain RemoteCompose JSON; the 3D operations are not in the Java JSON parser or
// androidx remote-core yet (3D support has not landed in androidx), so no byte check applies.

export const kind = "chart3d";
export const doc = "3D charts from data: scatter (size and colour by value), bars (categories by series) or a surface z = f(x, y) from a formula; axes, ticks, labels, drag to orbit, camera framed for any aspect";

// ---------------------------------------------------------------------------------------------
// Formulas in x and y (and named parameters): a parser to an AST, an evaluator and an emitter.

const FUNCS = {
    sin: [1, Math.sin], cos: [1, Math.cos], tan: [1, Math.tan], asin: [1, Math.asin], acos: [1, Math.acos],
    atan: [1, Math.atan], atan2: [2, Math.atan2], sqrt: [1, Math.sqrt], abs: [1, Math.abs], exp: [1, Math.exp],
    ln: [1, Math.log], log: [1, Math.log10], min: [2, Math.min], max: [2, Math.max], pow: [2, Math.pow],
    hypot: [2, Math.hypot], floor: [1, Math.floor], ceil: [1, Math.ceil], sign: [1, Math.sign],
    sinh: [1, Math.sinh], cosh: [1, Math.cosh], tanh: [1, Math.tanh],
};
const CONSTS = { pi: Math.PI, e: Math.E };

/** Parses a formula in x, y and the names in `params` into an AST. */
export function parseFormula(src, params = []) {
    const s = String(src).replace(/π/g, " pi ").replace(/[−–]/g, "-").replace(/[·×⋅]/g, "*").replace(/²/g, "^2").replace(/\*\*/g, "^");
    const toks = [];
    const re = /\s*(?:(\d+\.?\d*(?:e[-+]?\d+)?|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|([-+*/^(),]))/y;
    let i = 0;
    while (i < s.length) {
        if (/\s/.test(s[i])) { i++; continue; }
        re.lastIndex = i;
        const m = re.exec(s);
        if (!m) throw new Error(`can't read '${s.slice(i, i + 8)}' in "${src}"`);
        if (m[1] !== undefined) toks.push({ t: "num", v: Number(m[1]) });
        else if (m[2] !== undefined) toks.push({ t: "id", v: m[2] });
        else toks.push({ t: "op", v: m[3] });
        i = re.lastIndex;
    }
    let p = 0;
    const isOp = (v) => toks[p]?.t === "op" && toks[p].v === v;
    const expect = (v) => { if (!isOp(v)) throw new Error(`expected '${v}' in "${src}"`); p++; };
    const startsAtom = () => { const k = toks[p]; return k && (k.t === "num" || k.t === "id" || (k.t === "op" && k.v === "(")); };
    const expr = () => {
        let a = term();
        while (isOp("+") || isOp("-")) { const op = toks[p++].v; a = { t: "bin", op, a, b: term() }; }
        return a;
    };
    const term = () => {
        let a = unary();
        for (;;) {
            if (isOp("*") || isOp("/")) { const op = toks[p++].v; a = { t: "bin", op, a, b: unary() }; }
            else if (startsAtom()) a = { t: "bin", op: "*", a, b: power() };       // 2x, 2(x+1)
            else return a;
        }
    };
    const unary = () => {
        if (isOp("-")) { p++; return { t: "neg", a: unary() }; }
        if (isOp("+")) { p++; return unary(); }
        return power();
    };
    const power = () => {
        const a = atom();
        if (isOp("^")) { p++; return { t: "bin", op: "^", a, b: unary() }; }
        return a;
    };
    const atom = () => {
        const k = toks[p++];
        if (!k) throw new Error(`"${src}" ends too early`);
        if (k.t === "num") return { t: "num", v: k.v };
        if (k.t === "op" && k.v === "(") { const e = expr(); expect(")"); return e; }
        if (k.t === "id") {
            if (k.v === "x" || k.v === "y") return { t: "var", v: k.v };
            if (params.includes(k.v)) return { t: "param", v: k.v };
            if (k.v in CONSTS) return { t: "num", v: CONSTS[k.v] };
            if (k.v in FUNCS) {
                expect("(");
                const args = [expr()];
                while (isOp(",")) { p++; args.push(expr()); }
                expect(")");
                if (args.length !== FUNCS[k.v][0]) throw new Error(`${k.v} takes ${FUNCS[k.v][0]} argument(s) in "${src}"`);
                return { t: "fn", name: k.v, args };
            }
            throw new Error(`unknown name '${k.v}' in "${src}": write x and y for the axes${params.length ? `, ${params.join(", ")} for the parameters` : ""}; functions: ${Object.keys(FUNCS).join(", ")}`);
        }
        throw new Error(`unexpected '${k.v}' in "${src}"`);
    };
    const tree = expr();
    if (p < toks.length) throw new Error(`unexpected '${toks[p].v}' in "${src}"`);
    return tree;
}

/** f(env) for an AST; env holds x, y and the parameters. */
export function evalFormula(node, env) {
    switch (node.t) {
        case "num": return node.v;
        case "var": case "param": return env[node.v];
        case "neg": return -evalFormula(node.a, env);
        case "fn": return FUNCS[node.name][1](...node.args.map((a) => evalFormula(a, env)));
        case "bin": {
            const a = evalFormula(node.a, env), b = evalFormula(node.b, env);
            return node.op === "+" ? a + b : node.op === "-" ? a - b : node.op === "*" ? a * b : node.op === "/" ? a / b : Math.pow(a, b);
        }
    }
    throw new Error(`bad node ${node.t}`);
}

/** The format's infix for an AST; `names` maps x, y and each parameter to an expression. */
export function emitFormula(node, names) {
    const go = (n) => emitFormula(n, names);
    switch (node.t) {
        case "num": return num(node.v);
        case "var": case "param": return names[node.v];
        case "neg": return `(-${go(node.a)})`;
        case "fn": {
            const as = node.args.map(go);
            if (node.name === "sinh") return `((exp(${as[0]}) - exp(-${as[0]})) * 0.5)`;
            if (node.name === "cosh") return `((exp(${as[0]}) + exp(-${as[0]})) * 0.5)`;
            if (node.name === "tanh") return `(1 - 2 / (exp(2 * ${as[0]}) + 1))`;
            return `${node.name}(${as.join(", ")})`;
        }
        case "bin": {
            if (node.op === "^") {
                if (node.b.t === "num" && node.b.v === 2) return `square(${go(node.a)})`;
                if (node.b.t === "num" && node.b.v === 0.5) return `sqrt(${go(node.a)})`;
                return `pow(${go(node.a)}, ${go(node.b)})`;
            }
            return `(${go(node.a)} ${node.op} ${go(node.b)})`;
        }
    }
    throw new Error(`bad node ${node.t}`);
}

/** A number as the format's tokenizer reads it: no exponent, at most 7 significant digits. */
export function num(v) {
    if (!Number.isFinite(v)) throw new Error(`not a finite number: ${v}`);
    if (Math.abs(v) < 1e-9) return "0";
    let s = Number(v.toPrecision(7)).toString();
    if (/e/.test(s)) s = v.toFixed(Math.min(20, Math.max(0, 7 - Math.floor(Math.log10(Math.abs(v))))));
    return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}
const r6 = (v) => Number(Number(v).toPrecision(6));

// ---------------------------------------------------------------------------------------------
// Axes: nice ranges and ticks.

/**
 * A nice axis covering [lo, hi]: the range rounded out to whole steps of 1, 2, 2.5 or 5 × 10^k,
 * with about `target` intervals. {lo, hi, step, ticks, decimals}. `zero` brings in 0 when the
 * data comes within half its span of it (a value axis), so heights read from a true base.
 */
export function niceAxis(lo, hi, target = 4, { zero = false } = {}) {
    if (!(Number.isFinite(lo) && Number.isFinite(hi))) throw new Error(`axis range [${lo}, ${hi}] is not finite`);
    if (hi < lo) [lo, hi] = [hi, lo];
    if (zero && lo > 0 && lo < (hi - lo) * 0.5) lo = 0;
    if (zero && hi < 0 && -hi < (hi - lo) * 0.5) hi = 0;
    if (hi - lo < 1e-12) { const d = Math.abs(lo) > 1e-12 ? Math.abs(lo) * 0.1 : 1; lo -= d; hi += d; }
    let step = null;
    for (let t = target; t <= target + 2 && step === null; t++) {
        const raw = (hi - lo) / t;
        const p = Math.pow(10, Math.floor(Math.log10(raw)));
        for (const m of [1, 2, 2.5, 5, 10]) {
            const s = m * p;
            if (s < raw * 0.999) continue;
            const a = Math.floor(lo / s + 1e-9) * s, b = Math.ceil(hi / s - 1e-9) * s;
            if (Math.round((b - a) / s) <= target + 1) { step = s; break; }
        }
    }
    step ??= (hi - lo) / target;
    const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
    const n = Math.max(1, Math.round((b - a) / step));
    const ticks = [];
    for (let i = 0; i <= n; i++) { const v = a + i * step; ticks.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12))); }
    const decimals = Math.max(0, Math.ceil(-Math.log10(step) - 1e-9) + (Math.abs(step / Math.pow(10, Math.floor(Math.log10(step) + 1e-9)) - 2.5) < 1e-9 ? 1 : 0));
    return { lo: ticks[0], hi: ticks[n], step, ticks, decimals };
}

/** A tick label: thousands as k, millions as M (by the step's size), a real minus sign. */
export function tickLabel(v, step, unit = "") {
    const fixed = (x, d) => { let s = x.toFixed(d); if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, ""); return s === "-0" ? "0" : s; };
    const dec = (st) => Math.max(0, Math.ceil(-Math.log10(st) - 1e-9) + (Math.abs(st / Math.pow(10, Math.floor(Math.log10(st) + 1e-9)) - 2.5) < 1e-9 ? 1 : 0));
    let s;
    const big = Math.max(Math.abs(v), step);
    if (big >= 1e9 && step >= 1e8) s = fixed(v / 1e9, dec(step / 1e9)) + "B";
    else if (big >= 1e6 && step >= 1e5) s = fixed(v / 1e6, dec(step / 1e6)) + "M";
    else if (big >= 1e4 && step >= 1e3) s = fixed(v / 1e3, dec(step / 1e3)) + "k";
    else s = fixed(v, dec(step));
    return s.replace(/^-/, "−") + unit;
}

// ---------------------------------------------------------------------------------------------
// The scene: a box X, Z in [-1, 1] and Y in [0, BOX_H], rotated about its centre.

export const BOX_H = 1.25;
export const EYE = 5.2;                 // camera distance from the box centre
const TICK_OFF = 1.17;                  // tick labels sit this far out (box half-width 1)
const TITLE_OFF = 1.5;
const TILT_RANGE = [0.1, 1.15];         // radians: just above the floor's edge to well above

/** Box-centred point -> {x, y, w} before the perspective divide (x/w, y/w are tan units). */
export function project([px, py, pz], spin, tilt) {
    const cs = Math.cos(spin), ss = Math.sin(spin), ct = Math.cos(tilt), st = Math.sin(tilt);
    const x1 = px * cs + pz * ss, zr = pz * cs - px * ss;
    const y2 = py * ct - zr * st, z2 = py * st + zr * ct;
    return { x: x1, y: y2, w: EYE - z2 };
}

/**
 * How far the chart reaches from the view axis, in tan units, over every orbit angle the
 * viewer can reach (all spins; tilts in `tilts`): {ex, ey}. The camera's field of view is then
 * chosen at run time so ex fits the width and ey the height, whatever the aspect.
 */
export function frameExtent(tilts = TILT_RANGE, spins = null) {
    const pts = [];
    const h = BOX_H / 2;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const sy of [-h, h]) pts.push([sx, sy, sz]);
    // the tick labels' anchors, out from the floor edges, and the vertical axis title above
    for (const sx of [-TICK_OFF, TICK_OFF]) for (const sz of [-TICK_OFF, TICK_OFF]) pts.push([sx, -h, sz], [sx * 0.9, h + 0.12, sz * 0.9]);
    let ex = 0, ey = 0;
    const spinList = spins ?? Array.from({ length: 72 }, (_, i) => i * Math.PI / 36);
    const tiltList = [];
    for (let i = 0; i <= 8; i++) tiltList.push(tilts[0] + (tilts[1] - tilts[0]) * i / 8);
    for (const s of spinList) for (const t of tiltList) for (const p of pts) {
        const q = project(p, s, t);
        ex = Math.max(ex, Math.abs(q.x / q.w)); ey = Math.max(ey, Math.abs(q.y / q.w));
    }
    return { ex, ey };
}

/**
 * A unit grid in the XY plane, (0..1) x (0..1), with lines at the fractions `us` and `vs` (each
 * from 0 to 1, or a cell count), front face +z: its triangles are (p, p+x, p+x+y) and
 * (p+x+y, p+y, p), so wireframe edges 0 and 1 are the cell sides and never the diagonal.
 * {verts, indices}.
 */
export function gridMesh(us, vs) {
    const fr = (n) => (Array.isArray(n) ? n : Array.from({ length: n + 1 }, (_, i) => i / n));
    us = fr(us); vs = fr(vs);
    const a = us.length - 1, b = vs.length - 1;
    const verts = [], indices = [];
    for (let j = 0; j <= b; j++) for (let i = 0; i <= a; i++) verts.push(r6(us[i]), r6(vs[j]), 0);
    const at = (i, j) => j * (a + 1) + i;
    for (let j = 0; j < b; j++) for (let i = 0; i < a; i++) {
        const p = at(i, j), q = at(i + 1, j), r = at(i + 1, j + 1), s = at(i, j + 1);
        indices.push(p, q, r, r, s, p);
    }
    return { verts, indices };
}

// The value ramp: single hue, light to dark (the dataviz reference blue, steps 250..600). Every
// step keeps 2:1 against the light and the dark surface, so no bin disappears in either theme.
export const RAMP = ["#FF86B6EF", "#FF5598E7", "#FF3987E5", "#FF256ABF", "#FF184F95"];
const SERIES = ["@colors.primary", "@colors.warning", "@colors.success", "@colors.secondary", "@colors.error"];
const RAMP_N = RAMP.length;
/** The ramp bin (0..RAMP_N-1) of a value in [lo, hi]. */
export function rampBin(v, lo, hi) {
    if (!(hi > lo)) return Math.floor(RAMP_N / 2);
    return Math.max(0, Math.min(RAMP_N - 1, Math.floor((v - lo) / (hi - lo) * RAMP_N)));
}

const paint = (...ops) => ({ paint: { ops } });
/** A bool param as the component passes it: true/false, 1/0 or the strings. */
const isOff = (v) => v === false || v === 0 || v === "false" || v === "0";
const isOn = (v) => v !== undefined && v !== null && !isOff(v);
const variable = (name, value) => ({ variable: { name, value } });
const m3 = (op, args = {}) => ({ matrix3D: { op, ...args } });

// ---------------------------------------------------------------------------------------------
// Data normalisation.

const numOf = (v, what) => {
    const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
    if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(`${what}: expected a number, got ${JSON.stringify(v)}`);
    return n;
};

/** points: [[x, y, z, size?, color?], ...] or [{x, y, z, size?, color?, label?}] -> objects. */
export function readPoints(points) {
    if (!Array.isArray(points) || !points.length) throw new Error(`points: give a list like [[x, y, z], ...] or [{"x": .., "y": .., "z": .., "size": .., "label": ..}]`);
    return points.map((p, i) => {
        if (Array.isArray(p)) {
            if (p.length < 3) throw new Error(`points[${i}]: needs at least [x, y, z]`);
            return { x: numOf(p[0], `points[${i}][0]`), y: numOf(p[1], `points[${i}][1]`), z: numOf(p[2], `points[${i}][2]`),
                     size: p[3] === undefined || p[3] === null ? undefined : numOf(p[3], `points[${i}][3]`),
                     color: p[4] === undefined || p[4] === null ? undefined : numOf(p[4], `points[${i}][4]`) };
        }
        if (p && typeof p === "object") {
            return { x: numOf(p.x, `points[${i}].x`), y: numOf(p.y, `points[${i}].y`), z: numOf(p.z, `points[${i}].z`),
                     size: p.size === undefined ? undefined : numOf(p.size, `points[${i}].size`),
                     color: p.color === undefined ? undefined : numOf(p.color, `points[${i}].color`), label: p.label };
        }
        throw new Error(`points[${i}]: expected [x, y, z] or {x, y, z}`);
    });
}

/** Axis titles: {x, y, z, size, color}, each a string or {title, unit}. */
function readLabels(spec, named = true) {
    const l = spec.labels ?? {};
    const one = (k, d) => {
        const v = l[k] ?? spec[`${k}Label`];
        if (v === undefined || v === null) return { title: d, unit: "" };
        if (typeof v === "string") return { title: v, unit: "" };
        return { title: v.title ?? d, unit: v.unit ?? "" };
    };
    // bars name their categories and series, so their axes need no "x" and "y" by default
    return { x: one("x", named ? "x" : ""), y: one("y", named ? "y" : ""), z: one("z", named ? "z" : ""), size: one("size", ""), color: one("color", "") };
}

// ---------------------------------------------------------------------------------------------
// The document.

/** spec -> one canvas (and a legend below it). See Chart3D's component.json for the params. */
export function generate(spec, ctx) {
    const mono = Boolean(ctx.mono);
    const type = String(spec.type && spec.type !== "auto" ? spec.type : spec.fn ? "surface" : spec.values ? "bars" : "scatter").toLowerCase();
    if (!["scatter", "bars", "surface"].includes(type)) throw new Error(`type '${spec.type}': use scatter, bars or surface`);
    const scope = ctx.unique("c3d");
    const N = (k) => `${scope}_${k}`;
    const V = (k) => `@${scope}_${k}`;
    // Mesh ids are their own numbering: a block of 16 per call, from 3000.
    const callNo = Number(scope.replace(/^\D+/, "")) || 1;
    const MESH = (k) => 3000 + callNo * 16 + k;
    const labels = readLabels(spec, type !== "bars");
    const height = Number(spec.height ?? 320);
    const fill = isOn(spec.fill);

    // ---- data -> box coordinates, axes, and the draw list
    let ax, ay, az, desc;
    const draws = [];        // {color, mesh, items: [[X, Y, Z, sx, sy, sz]...]}
    const legend = [];       // {color, text}
    let ramp = null;         // {lo, hi, title} when colour is a value ramp
    let surface = null;
    let xCats = null, yCats = null;
    let annotations = [];
    if (type === "scatter") {
        const pts = readPoints(spec.points);
        const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y), zs = pts.map((p) => p.z);
        ax = niceAxis(Math.min(...xs), Math.max(...xs), 4, { zero: spec.zeroX ?? false });
        ay = niceAxis(Math.min(...ys), Math.max(...ys), 4, { zero: spec.zeroY ?? false });
        az = niceAxis(Math.min(...zs), Math.max(...zs), 4, { zero: spec.zeroZ ?? true });
        const sizes = pts.map((p) => p.size).filter((v) => v !== undefined);
        const sMax = sizes.length ? Math.max(...sizes.map(Math.abs)) : 0;
        // colour: a 5th value, else z (height) -- never both encodings on one axis silently
        const by = spec.colorBy && spec.colorBy !== "auto" ? String(spec.colorBy) : null;
        const colorKey = by === "none" || by === "size" || by === "z" ? (by === "z" && pts.some((p) => p.color !== undefined) ? "color" : by) : pts.some((p) => p.color !== undefined) ? "color" : "z";
        const cv = pts.map((p) => (colorKey === "color" ? p.color : colorKey === "size" ? p.size ?? 0 : colorKey === "none" ? 0 : p.z));
        const cLo = Math.min(...cv), cHi = Math.max(...cv);
        if (colorKey !== "none" && !mono) ramp = { lo: cLo, hi: cHi, title: colorKey === "color" ? labels.color.title : colorKey === "size" ? labels.size.title : labels.z.title, unit: colorKey === "z" ? labels.z.unit : colorKey === "size" ? labels.size.unit : labels.color.unit };
        const R0 = Number(spec.pointSize ?? 0.075);
        const bins = Array.from({ length: RAMP_N }, () => []);
        const shadows = [], named = [];
        pts.forEach((p, i) => {
            const X = -1 + 2 * (p.x - ax.lo) / (ax.hi - ax.lo);
            const Z = 1 - 2 * (p.y - ay.lo) / (ay.hi - ay.lo);
            const Y = BOX_H * (p.z - az.lo) / (az.hi - az.lo);
            // area proportional to size: radius from sqrt, 0.45..1.6 x the base
            const r = sMax > 0 && p.size !== undefined ? R0 * (0.45 + 1.15 * Math.sqrt(Math.abs(p.size) / sMax)) : R0;
            const b = ramp ? rampBin(cv[i], cLo, cHi) : 0;
            bins[b].push([X, Y, Z, r, r, r]);
            // a stem down to the floor: where the point stands, and how high
            shadows.push([X, 0, Z, 0.009, Math.max(Y - r * 0.5, 0.002), 0.009]);
            if (p.label) named.push({ p, X, Y, Z, r });
        });
        if (!isOff(spec.stems)) draws.push({ color: mono ? "@colors.muted" : "@colors.outline", mesh: "sphere", items: shadows, flat: true });
        // the highest few named points get their name beside them
        const nLab = Math.max(0, Math.round(Number(spec.annotate ?? 3)));
        annotations = [...named].sort((a, b) => b.p.z - a.p.z).slice(0, nLab);
        bins.forEach((items, b) => { if (items.length) draws.push({ color: mono ? "@colors.onSurface" : ramp ? RAMP[b] : "@colors.primary", mesh: "sphere", items }); });
        desc = `3D scatter of ${pts.length} points: ${labels.x.title} ${tickLabel(ax.lo, ax.step)} to ${tickLabel(ax.hi, ax.step)} across, ${labels.y.title} ${tickLabel(ay.lo, ay.step)} to ${tickLabel(ay.hi, ay.step)} in depth, ${labels.z.title} ${tickLabel(az.lo, az.step)} to ${tickLabel(az.hi, az.step)} up`;
        if (named.length) {
            const top = [...named].sort((a, b) => b.p.z - a.p.z)[0].p;
            desc += `; highest: ${top.label} (${labels.z.title} ${top.z})`;
        }
        if (sMax > 0) desc += `; point size shows ${labels.size.title || "size"}`;
    } else if (type === "bars") {
        const cats = spec.categories, series = spec.series ?? [""], vals = spec.values;
        if (!Array.isArray(cats) || !cats.length) throw new Error(`categories: the labels across, e.g. ["Q1", "Q2", "Q3"]`);
        if (!Array.isArray(vals) || !vals.length) throw new Error(`values: one row per series, each with one value per category`);
        const rows = Array.isArray(vals[0]) ? vals : [vals];
        if (rows.length !== series.length) throw new Error(`values has ${rows.length} rows but series names ${series.length}`);
        rows.forEach((r, i) => { if (r.length !== cats.length) throw new Error(`values[${i}] has ${r.length} values for ${cats.length} categories`); });
        const all = rows.flat().map((v, i) => numOf(v, `values (item ${i})`));
        az = niceAxis(Math.min(0, ...all), Math.max(0, ...all), 4, { zero: true });
        xCats = cats.map(String); yCats = series.map(String);
        const nx = cats.length, ny = series.length;
        ax = { lo: 0, hi: nx, step: 1, ticks: Array.from({ length: nx + 1 }, (_, i) => i) };
        ay = { lo: 0, hi: ny, step: 1, ticks: Array.from({ length: ny + 1 }, (_, i) => i) };
        const byValue = spec.colorBy === "value" || ny === 1;
        if (byValue && !mono) ramp = { lo: Math.min(...all), hi: Math.max(...all), title: labels.z.title, unit: labels.z.unit };
        const cw = 2 / nx, cd = 2 / ny, fillW = Number(spec.barWidth ?? 0.62);
        const bins = Array.from({ length: RAMP_N }, () => []);
        const zero = BOX_H * (0 - az.lo) / (az.hi - az.lo);
        rows.forEach((r, s) => {
            const items = [];
            r.forEach((v0, c) => {
                const v = Number(v0);
                const X = -1 + cw * (c + 0.5), Z = 1 - cd * (s + 0.5);
                const top = BOX_H * (v - az.lo) / (az.hi - az.lo);
                const y0 = Math.min(zero, top), h = Math.max(Math.abs(top - zero), 0.004);
                // square bars: one row (or few) would otherwise give deep slabs
                const it = [X, y0, Z, cw * fillW, h, Math.min(cd, cw) * fillW];
                if (byValue && !mono) bins[rampBin(v, ramp.lo, ramp.hi)].push(it); else items.push(it);
            });
            if (!(byValue && !mono)) {
                const color = mono ? "@colors.onSurface" : SERIES[s % SERIES.length];
                draws.push({ color, mesh: "cube", items });
                if (ny > 1 && !mono) legend.push({ color, text: yCats[s] });
            }
        });
        if (byValue && !mono) bins.forEach((items, b) => { if (items.length) draws.push({ color: RAMP[b], mesh: "cube", items }); });
        const best = rows.flatMap((r, s) => r.map((v, c) => ({ v: Number(v), c, s }))).sort((p, q) => q.v - p.v)[0];
        desc = `3D bar chart${labels.z.title ? ` of ${labels.z.title}` : ""} for ${nx} ${labels.x.title || "categories"} (${xCats.join(", ")})${ny > 1 ? ` by ${ny} ${labels.y.title || "series"} (${yCats.join(", ")})` : ""}; highest ${tickLabel(best.v, az.step / 100)}${labels.z.unit} for ${xCats[best.c]}${ny > 1 ? `, ${yCats[best.s]}` : ""}`;
    } else {
        // surface z = f(x, y)
        const vars = (spec.vars ?? []).map((v, i) => {
            if (!v || typeof v !== "object" || !v.name) throw new Error(`vars[${i}]: {"name": "w", "value": "@width", "min": 0.3, "max": 2}`);
            const value = v.value ?? v.default;
            const lit = typeof value === "number" ? value : v.default ?? (v.min !== undefined && v.max !== undefined ? (v.min + v.max) / 2 : undefined);
            if (typeof value !== "number" && (v.min === undefined || v.max === undefined)) throw new Error(`vars '${v.name}': a variable value needs min and max, so the server can size the z axis for every value it can take`);
            return { name: String(v.name), expr: typeof value === "number" ? num(value) : String(value).startsWith("@") ? String(value) : `(${value})`,
                     samples: [v.min, v.max, lit, typeof value === "number" ? value : undefined].filter((x) => typeof x === "number") };
        });
        const ast = parseFormula(spec.fn, vars.map((v) => v.name));
        const dx = spec.x ?? [-3, 3], dy = spec.y ?? dx;
        if (!Array.isArray(dx) || dx.length !== 2 || !Array.isArray(dy) || dy.length !== 2) throw new Error(`x and y: the domain as [from, to]`);
        const [x0, x1] = dx.map((v, i) => numOf(v, `x[${i}]`)), [y0, y1] = dy.map((v, i) => numOf(v, `y[${i}]`));
        if (!(x1 > x0) || !(y1 > y0)) throw new Error(`x and y must go from low to high`);
        // z range: the surface over the domain, for every parameter value the caller can reach
        const combos = vars.reduce((acc, v) => acc.flatMap((e) => [...new Set(v.samples)].map((s) => ({ ...e, [v.name]: s }))), [{}]);
        let lo = Infinity, hi = -Infinity;
        const S = 48;
        for (const env0 of combos) for (let i = 0; i <= S; i++) for (let j = 0; j <= S; j++) {
            const z = evalFormula(ast, { ...env0, x: x0 + (x1 - x0) * i / S, y: y0 + (y1 - y0) * j / S });
            if (Number.isFinite(z)) { lo = Math.min(lo, z); hi = Math.max(hi, z); }
        }
        if (!Number.isFinite(lo)) throw new Error(`${spec.fn} has no real values on the domain`);
        ax = niceAxis(x0, x1, 4); ay = niceAxis(y0, y1, 4);
        // the plotted domain is exactly the caller's; ticks inside it
        ax = { ...ax, lo: x0, hi: x1, ticks: ax.ticks.filter((t) => t >= x0 - 1e-9 && t <= x1 + 1e-9) };
        ay = { ...ay, lo: y0, hi: y1, ticks: ay.ticks.filter((t) => t >= y0 - 1e-9 && t <= y1 + 1e-9) };
        az = Array.isArray(spec.z) ? niceAxis(numOf(spec.z[0], "z[0]"), numOf(spec.z[1], "z[1]"), 4) : niceAxis(lo, hi, 4, { zero: true });
        // u, v run one cell past the domain on each side (the skirt ring), so they are clamped
        const names = { x: `(clamp(-1, 1, u) * ${num((x1 - x0) / 2)} + ${num((x0 + x1) / 2)})`, y: `(clamp(-1, 1, v) * ${num(-(y1 - y0) / 2)} + ${num((y0 + y1) / 2)})` };
        for (const v of vars) names[v.name] = v.expr;
        const f = emitFormula(ast, names);
        const k = BOX_H / (az.hi - az.lo);
        const height = `clamp(0, ${num(BOX_H)}, ${az.lo === 0 ? `${f} * ${num(k)}` : `(${f} - ${num(az.lo)}) * ${num(k)}`})`;
        const grid = Math.max(8, Math.min(64, Math.round(Number(spec.resolution ?? (mono ? 24 : 44)))));
        surface = { height, grid, bands: mono ? 1 : RAMP_N };
        if (!mono) ramp = { lo: az.lo, hi: az.hi, title: labels.z.title, unit: labels.z.unit, bands: true };
        let peak = { z: -Infinity };
        const env0 = Object.fromEntries(vars.map((v) => [v.name, v.samples[v.samples.length > 2 ? 2 : 0]]));
        for (let i = 0; i <= S; i++) for (let j = 0; j <= S; j++) {
            const x = x0 + (x1 - x0) * i / S, y = y0 + (y1 - y0) * j / S, z = evalFormula(ast, { ...env0, x, y });
            if (z > peak.z) peak = { x, y, z };
        }
        desc = `3D surface of z = ${spec.fn} for x from ${x0} to ${x1} and y from ${y0} to ${y1}; z from ${tickLabel(lo, az.step / 10)} to ${tickLabel(hi, az.step / 10)}, highest at (${r6(peak.x)}, ${r6(peak.y)})`;
    }

    // ---- view, camera, interaction
    const spin0 = Number(spec.spin ?? 35) * Math.PI / 180, tilt0 = Math.min(TILT_RANGE[1], Math.max(TILT_RANGE[0], Number(spec.tilt ?? 26) * Math.PI / 180));
    const KS = 0.012, KT = 0.006;                    // radians per dp of drag
    const rotate = isOn(spec.autorotate) && !mono ? Number(spec.autorotate === true ? 12 : spec.autorotate) * Math.PI / 180 : 0;
    const { ex, ey } = frameExtent();
    const PX = 16, PT = 14, PB = 8;                  // dp beyond the label anchors: half a label, and the hint above
    const cmds = [];
    cmds.push(
        { touchExpression: { name: N("sp"), defaultValue: 0, min: -100000, max: 100000, stopMode: "gently", expression: "touchX()" } },
        { touchExpression: { name: N("tp"), defaultValue: 0, min: r6((TILT_RANGE[0] - tilt0) / KT), max: r6((TILT_RANGE[1] - tilt0) / KT), stopMode: "gently", expression: "touchY()" } },
        variable(N("s"), `${num(spin0)} + ${V("sp")} * ${KS}${rotate ? ` + continuousSec() * ${num(rotate)}` : ""}`),
        variable(N("t"), `${num(tilt0)} + ${V("tp")} * ${KT}`),
        variable(N("cs"), `cos(${V("s")})`), variable(N("ss"), `sin(${V("s")})`),
        variable(N("ct"), `cos(${V("t")})`), variable(N("st"), `sin(${V("t")})`),
        // dp per tan unit: the box and its tick anchors fit at every orbit angle
        variable(N("F"), `min((componentWidth() - ${2 * PX}) / ${num(2 * ex)}, (componentHeight() - ${PT + PB}) / ${num(2 * ey)})`),
        variable(N("cx"), "componentWidth() / 2"),
        variable(N("cy"), "componentHeight() / 2"),
    );
    // ---- the 3D pass
    const base = [m3("identity"), m3("rotate", { angle: V("t"), axis: [1, 0, 0] }), m3("rotate", { angle: V("s"), axis: [0, 1, 0] }), m3("translate", { x: 0, y: num(-BOX_H / 2), z: 0 })];
    const d3 = [];
    d3.push({ clearDepth3D: {} });
    d3.push({ camera3D: { projection: "perspective", fovY: `2 * atan(windowHeight() * 0.5 / ${V("F")})`, aspect: "windowWidth() / windowHeight()", near: 0.5, far: 40,
        eye: [0, 0, EYE], center: [0, 0, 0], up: [0, 1, 0] } });
    // The floor and walls show their theme colours as they are: lights tilt with the view (the
    // model turns, the lights don't), so the floor's top light is strong enough to saturate
    // up to 60 degrees of tilt, and the walls' headlight up to about 65 degrees off the view;
    // a wall seen at a more grazing angle darkens a little, a depth cue.
    const floorLight = { lights3D: { lights: [{ type: "directional", color: "#FFFFFFFF", dir: [0, -1, 0], intensity: 1.6 }] } };
    const wallLight = { lights3D: { lights: [{ type: "directional", color: "#FFFFFFFF", dir: [0, 0, -1], intensity: 2 }] } };
    // grids: one unit mesh per distinct cell count, scaled onto the floor and the walls
    const nx = ax.ticks.length > 1 && !xCats ? ax.ticks.length - 1 : xCats ? xCats.length : 1;
    const ny = ay.ticks.length > 1 && !yCats ? ay.ticks.length - 1 : yCats ? yCats.length : 1;
    const nz = az.ticks.length - 1;
    // a surface's domain is the caller's, so its ticks need not start on an edge: offset grids
    const meshes = new Map();
    const gridFor = (a, b) => {
        const key = JSON.stringify([a, b]);
        if (!meshes.has(key)) {
            const id = MESH(meshes.size);
            const g = gridMesh(a, b);
            d3.push({ defineMesh3D: { id, verts: g.verts, indices: g.indices } });
            meshes.set(key, id);
        }
        return meshes.get(key);
    };
    // lines at the ticks (a surface's domain is the caller's, so its ticks may sit off the
    // edges: the grid then has uneven end cells); categories get a line between each
    const fracs = (a) => [...new Set([0, ...a.ticks.map((t) => r6((t - a.lo) / (a.hi - a.lo))), 1])].filter((f) => f >= 0 && f <= 1).sort((p, q) => p - q);
    const cellsX = xCats ? xCats.length : fracs(ax), cellsY = yCats ? yCats.length : fracs(ay);
    // a plane's u runs along its own x: mirrored on the walls turned to face the other way
    const mirror = (c) => (Array.isArray(c) ? c.map((f) => r6(1 - f)).reverse() : c);
    const floorId = gridFor(cellsX, cellsY);
    const planes = [
        { mesh: floorId, place: [m3("translate", { x: -1, y: 0, z: 1 }), m3("rotate", { angle: num(-Math.PI / 2), axis: [1, 0, 0] }), m3("scale", { x: 2, y: 2, z: 1 })], color: mono ? "@colors.background" : "@colors.surfaceHigh" },
        { mesh: gridFor(cellsX, nz), place: [m3("translate", { x: -1, y: 0, z: -1 }), m3("scale", { x: 2, y: num(BOX_H), z: 1 })] },
        { mesh: gridFor(mirror(cellsX), nz), place: [m3("translate", { x: 1, y: 0, z: 1 }), m3("rotate", { angle: num(Math.PI), axis: [0, 1, 0] }), m3("scale", { x: 2, y: num(BOX_H), z: 1 })] },
        { mesh: gridFor(cellsY, nz), place: [m3("translate", { x: -1, y: 0, z: 1 }), m3("rotate", { angle: num(Math.PI / 2), axis: [0, 1, 0] }), m3("scale", { x: 2, y: num(BOX_H), z: 1 })] },
        { mesh: gridFor(mirror(cellsY), nz), place: [m3("translate", { x: 1, y: 0, z: -1 }), m3("rotate", { angle: num(-Math.PI / 2), axis: [0, 1, 0] }), m3("scale", { x: 2, y: num(BOX_H), z: 1 })] },
    ];
    const wallColor = mono ? "@colors.background" : "@colors.surface";
    const lineColor = mono ? "@colors.muted" : "@colors.outline";
    planes.forEach((p, i) => {
        if (i < 2) d3.push(i === 0 ? floorLight : wallLight);
        d3.push(...base, ...p.place, paint({ color: p.color ?? wallColor }), { drawMesh3D: { mesh: p.mesh, mode: "software-flat" } });
        d3.push({ depthBias3D: { constant: -0.002, slope: 0 } }, paint({ color: lineColor }), { drawMesh3D: { mesh: p.mesh, mode: "software-flat", wireframe: true, edges: [0, 1] } }, { depthBias3D: { constant: 0, slope: 0 } });
    });
    // the data under a modelling light: key from the upper left, fill from the right
    d3.push({ lights3D: { lights: [
        { type: "directional", color: "#FFFFFFFF", dir: [-0.35, -0.75, -0.55], intensity: 0.85 },
        { type: "directional", color: "#FFFFFFFF", dir: [0.6, -0.1, -0.6], intensity: 0.35 }] } });
    // data
    if (draws.length) {
        const unit = MESH(8);
        const shape = draws[0].mesh === "cube" || draws.some((d) => d.mesh === "cube") ? "cube" : "sphere";
        if (shape === "cube") d3.push({ meshPrimitive3D: { id: unit, primitive: "cube", dimX: 1, dimY: 1, dimZ: 1, center: [0, 0.5, 0] } });
        else d3.push({ meshPrimitive3D: { id: unit, primitive: "icosphere", radius: 1, center: [0, 0, 0], segments: Number(spec.detail ?? 2) } });
        const shadowMesh = MESH(9);
        if (draws.some((d) => d.flat)) d3.push({ meshPrimitive3D: { id: shadowMesh, primitive: "cylinder", radius: 1, from: [0, 0, 0], to: [0, 1, 0], segments: 16 } });
        draws.forEach((d, k) => {
            const arr = ctx.floatArray(`${scope}_d${k}`, d.items.flat().map(r6));
            // the loop steps by 6 (one item's floats), so an index is i + j
            const at = (j) => (j ? `arrayGet(${arr}, i + ${j})` : `arrayGet(${arr}, i)`);
            const loop = (commands) => ({ loop: { index: "i", from: 0, step: 6, until: d.items.length * 6, commands } });
            const body = [...base,
                m3("translate", { x: at(0), y: at(1), z: at(2) }),
                m3("scale", { x: at(3), y: at(4), z: at(5) }),
                { drawMesh3D: { mesh: d.flat ? shadowMesh : unit, mode: d.flat || shape === "cube" ? "software-flat" : "software-smooth" } }];
            d3.push(paint({ color: d.color }));
            // glossy spheres: a highlight shows their shape even black on white (mono light)
            const gloss = !d.flat && shape === "sphere";
            if (gloss) d3.push({ material3D: { specular: mono ? 0.9 : 0.3, shininess: mono ? 8 : 16 } });
            if (shape === "cube" && mono) {
                // mono bars: a black face with white edges reads as a box on e-ink and AOD
                d3.push(paint({ color: "@colors.background" }));
                d3.push(loop(body));
                d3.push({ depthBias3D: { constant: -0.002, slope: 0 } }, paint({ color: "@colors.onSurface" }));
                d3.push(loop([...body.slice(0, -1), { drawMesh3D: { mesh: unit, mode: "software-flat", wireframe: true, edges: [0, 1] } }]));
                d3.push({ depthBias3D: { constant: 0, slope: 0 } });
            } else d3.push(loop(body));
            if (gloss) d3.push({ material3D: { specular: 0, shininess: 32 } });
        });
    }
    if (surface) {
        // Each band is a general surface over the domain plus one ring of cells beyond it,
        // pulled in onto the domain's edge (zero-area cells, culled). A lower band is the
        // surface clamped at its top. One more mesh, the skirt, drops that ring to the floor:
        // a neutral curtain from the surface's edge down, which closes the surface so nothing
        // under it (the lower bands' plateaus) shows from outside. Its inner cells sink under
        // the floor.
        const g = surface.grid, d = 2 / g, R = [num(-1 - d), num(1 + d)];
        const ring = `max(step(abs(u), ${num(1 + d / 2)}), step(abs(v), ${num(1 + d / 2)}))`;
        const edge = `max(step(abs(u), ${num(1 - d / 2)}), step(abs(v), ${num(1 - d / 2)}))`;
        const grid3 = { surface: "general", uRange: R, uCount: g + 3, vRange: R, vCount: g + 3, x: "clamp(-1, 1, u)", z: "clamp(-1, 1, v)" };
        for (let b = 0; b < surface.bands; b++) {
            const top = b === surface.bands - 1 ? null : BOX_H * (b + 1) / surface.bands;
            d3.push({ meshExpression3D: { id: MESH(10 + b), ...grid3, y: top === null ? surface.height : `min(${surface.height}, ${num(top)})` } });
        }
        d3.push({ meshExpression3D: { id: MESH(15), ...grid3, y: `(1 - ${ring}) * (${edge} * (${surface.height} + 0.02) - 0.02)` } });
        d3.push(...base);
        d3.push(paint({ color: mono ? "@colors.background" : "@colors.track" }), { drawMesh3D: { mesh: MESH(15), mode: "software-flat" } });
        if (mono) {
            const id = MESH(10);
            d3.push(paint({ color: "@colors.background" }), { drawMesh3D: { mesh: id, mode: "software-flat" } },
                { depthBias3D: { constant: -0.003, slope: 0 } }, paint({ color: "@colors.onSurface" }),
                { drawMesh3D: { mesh: id, mode: "software-flat", wireframe: true, edges: [0, 1] } }, { depthBias3D: { constant: 0, slope: 0 } });
        } else {
            for (let b = 0; b < surface.bands; b++) d3.push(paint({ color: RAMP[b] }), { drawMesh3D: { mesh: MESH(10 + b), mode: "software-smooth" } });
        }
    }
    cmds.push({ save: { commands: [{ translate: { dx: "(componentWidth() - windowWidth()) / 2", dy: "(componentHeight() - windowHeight()) / 2" } }, ...d3] } });

    // ---- 2D labels from projected points
    // Floor edges nearest the viewer: the x ticks on z = zE, the y ticks on x = xE; the
    // vertical ticks up the back wall's outer edge at (xE, -zE).
    const H2 = num(BOX_H / 2);
    cmds.push(variable(N("zE"), `2 * step(${V("cs")}, 0) - 1`), variable(N("xE"), `1 - 2 * step(${V("ss")}, 0)`));
    // a point given as box-centred expression strings -> its screen x, y (two variables)
    let nv = 0;
    const proj = (px, py, pz) => {
        const k = nv++;
        const zr = `(${pz} * ${V("cs")} - ${px} * ${V("ss")})`;
        cmds.push(variable(N(`w${k}`), `${EYE} - (${py} * ${V("st")} + ${zr} * ${V("ct")})`));
        cmds.push(variable(N(`X${k}`), `${V("cx")} + ${V("F")} * (${px} * ${V("cs")} + ${pz} * ${V("ss")}) / ${V(`w${k}`)}`));
        cmds.push(variable(N(`Y${k}`), `${V("cy")} - ${V("F")} * (${py} * ${V("ct")} - ${zr} * ${V("st")}) / ${V(`w${k}`)}`));
        return { x: V(`X${k}`), y: V(`Y${k}`) };
    };
    // an axis from A to B: its endpoints' pre-divide coordinates, then each tick by lerp
    const axisLine = (A, B) => {
        const k = nv++;
        const parts = (p) => {
            const zr = `(${p[2]} * ${V("cs")} - ${p[0]} * ${V("ss")})`;
            return { x: `${p[0]} * ${V("cs")} + ${p[2]} * ${V("ss")}`, y: `${p[1]} * ${V("ct")} - ${zr} * ${V("st")}`, w: `${EYE} - (${p[1]} * ${V("st")} + ${zr} * ${V("ct")})` };
        };
        const a = parts(A), b = parts(B);
        // x and y already in dp (times F): a tick is then 11 entries a coordinate
        for (const c of ["x", "y", "w"]) {
            const sc = c === "w" ? (e) => e : (e) => `${V("F")} * (${e})`;
            cmds.push(variable(N(`a${c}${k}`), sc(a[c])));
            cmds.push(variable(N(`d${c}${k}`), `${sc(b[c])} - ${V(`a${c}${k}`)}`));
        }
        return (t) => {
            const den = `(${V(`aw${k}`)} + ${num(t)} * ${V(`dw${k}`)})`;
            return { x: `${V("cx")} + (${V(`ax${k}`)} + ${num(t)} * ${V(`dx${k}`)}) / ${den}`,
                     y: `${V("cy")} - (${V(`ay${k}`)} + ${num(t)} * ${V(`dy${k}`)}) / ${den}` };
        };
    };
    const T = num(TICK_OFF), TT = num(TITLE_OFF);
    const xLine = axisLine([-1, `-${H2}`, `${V("zE")} * ${T}`], [1, `-${H2}`, `${V("zE")} * ${T}`]);
    const yLine = axisLine([`${V("xE")} * ${T}`, `-${H2}`, 1], [`${V("xE")} * ${T}`, `-${H2}`, -1]);
    const zLine = axisLine([`${V("xE")} * ${num(1.1)}`, `-${H2}`, `-${V("zE")} * ${num(1.1)}`], [`${V("xE")} * ${num(1.1)}`, H2, `-${V("zE")} * ${num(1.1)}`]);
    const TEXT = 10;
    const texts = [];
    const tick = (line, t, text, alpha) => {
        const p = line(t);
        if (alpha) texts.push(paint({ alpha }));
        texts.push({ drawTextAnchored: { text, x: p.x, y: p.y, panX: 0, panY: 0 } });
        if (alpha) texts.push(paint({ alpha: 1 }));
    };
    if (xCats) xCats.forEach((c, i) => tick(xLine, (i + 0.5) / xCats.length, c));
    else ax.ticks.forEach((v) => tick(xLine, (v - ax.lo) / (ax.hi - ax.lo), tickLabel(v, ax.step)));
    if (yCats) { if (yCats.length > 1) yCats.forEach((c, i) => tick(yLine, (i + 0.5) / yCats.length, c)); }
    else ay.ticks.forEach((v) => {
        // the y axis meets the x axis at the corner (xE, zE): its tick there hides
        const t = (v - ay.lo) / (ay.hi - ay.lo);
        const end = t < 1e-9 ? `1 - step(${V("zE")}, 0)` : t > 1 - 1e-9 ? `step(${V("zE")}, 0)` : null;
        tick(yLine, t, tickLabel(v, ay.step), end);
    });
    const zTexts = [];
    az.ticks.slice(1).forEach((v) => { const p = zLine((v - az.lo) / (az.hi - az.lo)); zTexts.push({ drawTextAnchored: { text: tickLabel(v, az.step), x: p.x, y: p.y, panX: V("zpan"), panY: 0 } }); });
    // the vertical ticks hang off the side of the screen their edge is on
    cmds.push(variable(N("zpan"), `-sign(${V("ax" + (nv - 1))} + 0.0001)`));
    cmds.push(paint({ color: "@colors.muted" }, { style: "fill" }, { textSize: TEXT }, { alpha: 1 }), ...texts, ...zTexts);
    // axis titles
    const titles = [];
    // a title stays on screen: its centre clamped half its width (estimated) from each side
    const inside = (x, t) => { const hw = Math.ceil(t.length * 3.2) + 3; return `clamp(${hw}, componentWidth() - ${hw}, ${x})`; };
    const tx = labels.x.title + (labels.x.unit ? ` (${labels.x.unit})` : ""), ty = labels.y.title + (labels.y.unit ? ` (${labels.y.unit})` : ""), tz = labels.z.title + (labels.z.unit ? ` (${labels.z.unit})` : "");
    const showY = !(yCats && yCats.length <= 1);
    if (tx) { const p = proj(0, `-${H2}`, `${V("zE")} * ${TT}`); titles.push({ drawTextAnchored: { text: tx, x: inside(p.x, tx), y: p.y, panX: 0, panY: 0 } }); }
    if (ty && showY && !(yCats && legend.length)) { const p = proj(`${V("xE")} * ${TT}`, `-${H2}`, 0); titles.push({ drawTextAnchored: { text: ty, x: inside(p.x, ty), y: p.y, panX: 0, panY: 0 } }); }
    if (tz) { const p = proj(`${V("xE")} * ${num(1.1)}`, `${H2} + 0.16`, `-${V("zE")} * ${num(1.1)}`); titles.push({ drawTextAnchored: { text: tz, x: inside(p.x, tz), y: p.y, panX: 0, panY: 0 } }); }
    cmds.push(paint({ color: "@colors.onSurface" }, { textSize: 11 }), ...titles);
    // point names: left-aligned just right of the point (box-centred coordinates)
    if (annotations.length) {
        const an = annotations.map((a) => {
            const q = proj(num(a.X), num(a.Y - BOX_H / 2), num(a.Z));
            return { drawTextAnchored: { text: a.p.label, x: `${q.x} + ${num(4 + a.r * 30)}`, y: q.y, panX: -1, panY: 0 } };
        });
        // a halo in the background colour first, so a name over a sphere still reads
        cmds.push(paint({ color: "@colors.background" }, { style: "stroke" }, { strokeWidth: 3 }, { strokeJoin: "round" }, { textSize: 10 }), ...an,
            paint({ color: "@colors.onSurface" }, { style: "fill" }), ...an);
    }
    {
        cmds.push(paint({ color: "@colors.muted" }, { textSize: 10 }, { alpha: "step(componentWidth(), 200)" }),
            { drawTextAnchored: { text: rotate ? "drag to turn" : "drag to orbit", x: "componentWidth() - 4", y: 4, panX: 1, panY: 1 } });
    }

    const canvas = { canvas: { modifiers: ["fillMaxWidth", fill ? { verticalWeight: 1 } : { height }, { semantics: { contentDescription: spec.label ?? desc } }], commands: cmds } };

    // ---- legend: the ramp (five swatches, low and high) or the series
    const children = [canvas];
    const sw = (color, w = 14) => ({ box: { modifiers: [{ width: w }, { height: 10 }, { clip: { roundedRect: 2 } }, { background: color }] } });
    const lt = (t, c = "@colors.muted") => ({ text: { value: t, fontSize: 11, color: c, maxLines: 1 } });
    if (ramp && !isOff(spec.legend)) {
        const step = (ramp.hi - ramp.lo) / 4 || 1;
        const nice = niceAxis(ramp.lo, ramp.hi, 4).step;
        const fmt = (v) => tickLabel(v, Math.min(step, nice) / 10 >= 1 ? nice : nice / 10).replace(/\.0+([kMB]?)$/, "$1");
        const title = ramp.title ? `${ramp.title}${ramp.unit ? ` (${ramp.unit})` : ""}` : "";
        const scale = { row: { verticalAlignment: "center", children: [
            lt(fmt(ramp.lo)), { box: { modifiers: [{ width: 4 }, { height: 1 }] } },
            ...RAMP.map((c) => sw(c)), { box: { modifiers: [{ width: 4 }, { height: 1 }] } }, lt(fmt(ramp.hi))] } };
        children.push({ flow: { modifiers: ["fillMaxWidth", { padding: [8, 2, 8, 0] }], horizontalArrangement: "center", verticalAlignment: "center", children: [
            ...(title ? [{ text: { value: title, fontSize: 11, color: "@colors.onSurface", maxLines: 1, modifiers: [{ padding: [0, 0, 8, 0] }] } }] : []), scale] } });
    } else if (legend.length && !isOff(spec.legend)) {
        children.push({ flow: { modifiers: ["fillMaxWidth", { padding: [8, 2, 8, 0] }], horizontalArrangement: "center", children: legend.map((l) => ({
            row: { verticalAlignment: "center", modifiers: [{ padding: [0, 2, 12, 2] }], children: [sw(l.color, 10), { box: { modifiers: [{ width: 6 }, { height: 1 }] } }, lt(l.text, "@colors.onSurface")] } })) } });
    }
    // alone, a filling canvas fills its parent (a weight only means something in a column)
    if (children.length === 1 && fill) canvas.canvas.modifiers.splice(0, 2, "fillMaxSize");
    return children.length === 1 ? canvas : { column: { modifiers: [fill ? "fillMaxSize" : "fillMaxWidth"], children } };
}
