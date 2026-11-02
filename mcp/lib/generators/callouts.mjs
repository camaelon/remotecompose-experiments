// Callouts: labelled parts of a drawing, placed and routed by the server.
//   {"$gen": {"kind": "callouts", "aspect": 0.8, "visual": NODE,
//             "parts": [{"at": [0.3, 0.2], "label": "Water tank"}, {"at": "spout", "label": "Spout"}],
//             "points": {"spout": [0.5, 0.7]}}}
// The caller gives anchors as fractions of the drawing (0..1 across, 0..1 down) and the text;
// the generator decides everything else. Two looks, switched at run time from the window:
//   beside  the drawing in the middle, each label in the gutter on its anchor's side (x < 0.5
//           left), stacked by a 1D relaxation so labels keep their order and at least `gap` dp
//           apart, joined to the anchor by a leader: a diagonal, then a short horizontal shelf.
//   legend  the drawing larger, with numbered discs in thin gutters (same relaxation and
//           leaders) and a numbered legend of the labels below.
// Beside is chosen when the labels fit, need at most twice the drawing's height, and its
// drawing is at least 0.6 of the legend's.
// What depends on the window (drawing size, label heights in dp against it) is an expression
// of `width` / `height`, written as tree variables; what does not (text widths, line counts,
// gutter widths, side and order of the labels) is computed here. The order of the labels on
// each side is chosen so leaders do not cross, checked at a set of window sizes.

export const kind = "callouts";
export const doc = "Labels for parts of a drawing: anchors as 0..1 fractions of a drawing of given aspect, label text; labels in side gutters with non-crossing leaders when wide, numbered markers and a legend when narrow";

// Advance widths (1/1000 em) of a Helvetica/Arial-like sans: the inspector's metrics. Unknown
// characters take 600, which overestimates on purpose.
const ADV = {
    " ": 278, "!": 278, '"': 355, "#": 556, "$": 556, "%": 889, "&": 667, "'": 191, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
    ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015, "[": 278, "]": 278, "_": 556,
    a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
    A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
};
for (const d of "0123456789") ADV[d] = 556;
// Players differ a little (the C++ player's font is not the inspector's): measure 6% wide.
const SLACK = 1.06;

/** Estimated width in dp of one line of `s` at font size `fs`. */
export function textWidth(s, fs) {
    let w = 0;
    for (const ch of String(s)) w += ADV[ch] ?? 600;
    return (w / 1000) * fs * SLACK;
}

/** Lines `s` takes when wrapped greedily at `width` dp (a word wider than the line breaks). */
export function wrapLines(s, fs, width) {
    const words = String(s).split(/\s+/).filter(Boolean);
    if (!words.length) return 1;
    const space = textWidth(" ", fs);
    let lines = 1, cur = 0;
    for (const word of words) {
        const ww = textWidth(word, fs);
        if (cur === 0) { cur = ww; }
        else if (cur + space + ww <= width) { cur += space + ww; continue; }
        else { lines++; cur = ww; }
        while (cur > width) { lines++; cur -= width; }
    }
    return lines;
}

/** The narrowest width at which `s` wraps to at most `lines` lines (to 0.5 dp). */
export function widthFor(s, fs, lines) {
    let lo = 1, hi = textWidth(s, fs) + 1;
    if (wrapLines(s, fs, hi) > lines) return hi;
    while (hi - lo > 0.5) { const m = (lo + hi) / 2; if (wrapLines(s, fs, m) <= lines) hi = m; else lo = m; }
    return Math.ceil(hi);
}

// --- arithmetic over numbers (tests, static folding) or expression strings (the document) ----

const r3 = (x) => Math.round(x * 1000) / 1000;
function arith(sink, prefix) {
    const seen = new Map();
    const isN = (a) => typeof a === "number";
    const atom = (a) => (isN(a) ? String(r3(a)) : /^[@\w.]+(\(\))?$/.test(a) ? a : `(${a})`);
    const X = {
        add: (a, b) => (isN(a) && isN(b) ? a + b : b === 0 ? a : a === 0 ? b : `${atom(a)} + ${atom(b)}`),
        sub: (a, b) => (isN(a) && isN(b) ? a - b : b === 0 ? a : `${atom(a)} - ${atom(b)}`),
        mul: (a, b) => (isN(a) && isN(b) ? a * b : a === 1 ? b : b === 1 ? a : a === 0 || b === 0 ? 0 : `${atom(a)} * ${atom(b)}`),
        div: (a, b) => (isN(a) && isN(b) ? a / b : b === 1 ? a : `${atom(a)} / ${atom(b)}`),
        max: (a, b) => (isN(a) && isN(b) ? Math.max(a, b) : `max(${atom(a)}, ${atom(b)})`),
        min: (a, b) => (isN(a) && isN(b) ? Math.min(a, b) : `min(${atom(a)}, ${atom(b)})`),
        /** 1 when a > e, else 0 (the format's step()). */
        step: (a, e) => (isN(a) && isN(e) ? (a > e ? 1 : 0) : `step(${atom(a)}, ${atom(e)})`),
        /** c > 0 ? then : otherwise (the format's ifElse(otherwise, then, c)). */
        pick: (c, then, otherwise) => (isN(c) ? (c > 0 ? then : otherwise) : isN(then) && isN(otherwise) && then === otherwise ? then
            : `ifElse(${atom(otherwise)}, ${atom(then)}, ${atom(c)})`),
        /** Names a value: a tree variable in a document, the number itself when it folds. */
        v: (name, a) => {
            if (isN(a)) return r3(a);
            if (!sink) return a;
            if (/^@[\w.]+$/.test(a)) return a;
            if (seen.has(a)) return seen.get(a); // the same expression twice: one variable
            const full = `${prefix}${name}`;
            sink.push({ variable: { name: full, value: a } });
            seen.set(a, `@${full}`);
            return `@${full}`;
        },
        sum: (xs) => xs.reduce((s, x) => X.add(s, x), 0),
    };
    return X;
}

/**
 * The 1D relaxation: boxes of heights `hs` wanting their centres at `ts` (in order), kept in
 * order, `gap` apart and inside [lo, hi]. Two cascades, one pushing down from the top and
 * one pushing up from the bottom, each then clamped from the other end; both keep the gaps,
 * so their mean does, and it centres a crowded run on its targets. Returns the tops.
 */
export function relax(ts, hs, lo, hi, gap, X, tag = "r", pre = null) {
    const n = ts.length;
    if (!n) return [];
    const a = [], A = [], b = [], B = [];
    // pre: {half, step} per box, when the caller has them named already
    const half = (i) => pre?.half[i] ?? X.mul(hs[i], 0.5), step = (i) => pre?.step[i] ?? X.add(hs[i], gap);
    for (let i = 0; i < n; i++) {
        const want = X.sub(ts[i], half(i));
        a[i] = X.v(`${tag}a${i}`, i === 0 ? X.max(want, lo) : X.max(want, X.add(a[i - 1], step(i - 1))));
    }
    for (let i = n - 1; i >= 0; i--) A[i] = X.v(`${tag}A${i}`, i === n - 1 ? X.min(a[i], X.sub(hi, hs[i])) : X.min(a[i], X.sub(A[i + 1], step(i))));
    for (let i = n - 1; i >= 0; i--) {
        const want = X.sub(ts[i], half(i));
        b[i] = X.v(`${tag}b${i}`, i === n - 1 ? X.min(want, X.sub(hi, hs[i])) : X.min(want, X.sub(b[i + 1], step(i))));
    }
    for (let i = 0; i < n; i++) B[i] = X.v(`${tag}B${i}`, i === 0 ? X.max(b[i], lo) : X.max(b[i], X.add(B[i - 1], step(i - 1))));
    return ts.map((_, i) => X.v(`${tag}y${i}`, X.mul(X.add(A[i], B[i]), 0.5)));
}

// --- the static plan: sides, text sizes, order -------------------------------------------

const DEFAULTS = { fontSize: 14, gap: 8, pad: 12, maxGutter: 160, minGutter: 48, maxLines: 3, legendLines: 2, mode: "auto" };
const MIN_FONT = 11;
const DISC = 18, DISC_GAP = 6, LZ = 24, LZN = 16, SHELF = 10, SHELF_N = 6, MIN_DRAW = 64, MIN_LEGEND_DRAW = 56;

/** Checks and normalises a spec into the static plan. */
export function plan(spec) {
    const o = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS)) if (spec[k] !== undefined) o[k] = k === "mode" ? String(spec[k]) : Number(spec[k]);
    if (!["auto", "beside", "legend"].includes(o.mode)) throw new Error(`mode must be auto, beside or legend, not ${JSON.stringify(spec.mode)}`);
    const aspect = Number(spec.aspect ?? 1);
    if (!(aspect > 0)) throw new Error("aspect (drawing width / height) must be a positive number");
    let points = spec.points ?? {};
    if (Array.isArray(points)) points = Object.fromEntries(points.map((p) => [p.name, p.at ?? [p.x, p.y]]));
    const parts = spec.parts ?? spec.items;
    if (!Array.isArray(parts) || !parts.length) throw new Error("parts must be a non-empty list of {at, label}");
    const lh = Math.ceil(o.fontSize * 1.3);
    const items = parts.map((p, i) => {
        if (typeof p !== "object" || p === null) throw new Error(`parts[${i}] must be {at, label}`);
        let at = p.at ?? (p.x !== undefined ? [p.x, p.y] : undefined);
        if (typeof at === "string") {
            if (!(at in points)) throw new Error(`parts[${i}].at names '${at}', which points does not define (${Object.keys(points).join(", ") || "none"})`);
            at = points[at];
        }
        if (!Array.isArray(at) || at.length !== 2 || at.some((v) => typeof v !== "number" || !Number.isFinite(v))) throw new Error(`parts[${i}].at must be [x, y] fractions or a point name`);
        if (at.some((v) => v < -0.001 || v > 1.001)) throw new Error(`parts[${i}].at ${JSON.stringify(at)} is outside the drawing: fractions run 0..1`);
        const label = p.label ?? p.text;
        if (typeof label !== "string" || !label.trim()) throw new Error(`parts[${i}] needs a label`);
        const side = p.side ?? (at[0] < 0.5 ? "left" : "right");
        if (side !== "left" && side !== "right") throw new Error(`parts[${i}].side must be left or right`);
        return { i, px: Math.min(1, Math.max(0, at[0])), py: Math.min(1, Math.max(0, at[1])), label, side, w1: textWidth(label, o.fontSize) };
    });
    const sides = {};
    for (const s of ["left", "right"]) {
        const its = items.filter((it) => it.side === s);
        // The gutter is as wide as its widest label, up to maxGutter; a longer label wraps.
        const tw = its.length ? Math.ceil(Math.max(o.minGutter, Math.min(o.maxGutter, Math.max(...its.map((it) => it.w1)) + 2))) : 0;
        for (const it of its) {
            it.lines = Math.min(o.maxLines, wrapLines(it.label, o.fontSize, tw));
            it.h = it.lines * lh;
        }
        const stack = its.reduce((s, it) => s + it.h, 0) + Math.max(0, its.length - 1) * o.gap;
        const discStack = its.length * DISC + Math.max(0, its.length - 1) * DISC_GAP;
        sides[s] = { items: its, tw, stack, discStack };
    }
    for (const it of items) it.w2 = widthFor(it.label, o.fontSize, 1); // one legend line from this width
    return { o, aspect, items, sides, lh };
}

/**
 * The geometry for a window W x H (numbers, or expression strings with X from arith), with
 * each side's labels in the order `order` ({left: [item...], right: [...]}).
 */
export function layout(P, W, H, X, order) {
    const { o, aspect: A, sides, lh } = P;
    const pad = o.pad;
    const has = { left: sides.left.items.length > 0, right: sides.right.items.length > 0 };
    const seq = [...order.left, ...order.right]; // reading order: left top to bottom, then right
    // Label size: fontSize is the size at full scale. Labels shrink with the window (k), down to
    // MIN_FONT sp; every label measure (gutter width, line height) scales with k, so a label
    // wraps the same at any k. Beside takes the largest k that fits, legend the size's own.
    const fs = o.fontSize, kmin = Math.min(1, MIN_FONT / fs);
    const sumTW = (has.left ? sides.left.tw : 0) + (has.right ? sides.right.tw : 0);
    const LZs = (has.left ? LZ : 0) + (has.right ? LZ : 0);
    const ks = X.v("ks", X.div(X.min(W, H), 25 * fs));
    let kB = X.min(ks, X.div(X.sub(W, 2 * pad + LZs + MIN_DRAW), sumTW));
    for (const sd of ["left", "right"]) {
        const its = sides[sd].items;
        if (!its.length) continue;
        const sumH = its.reduce((a, it) => a + it.h, 0);
        kB = X.min(kB, X.div(X.sub(H, 2 * pad + (its.length - 1) * o.gap), sumH));
    }
    kB = X.v("kB", X.min(1, kB));
    const fitB = X.step(kB, kmin - 0.001);
    const k = X.v("k", X.max(kB, kmin));
    const kN = X.v("kN", X.max(kmin, X.min(1, ks)));
    // beside: the drawing between the two gutters of text
    const twL = has.left ? X.v("twL", X.mul(k, sides.left.tw)) : 0, twR = has.right ? X.v("twR", X.mul(k, sides.right.tw)) : 0;
    const GL = has.left ? X.add(twL, LZ) : 0, GR = has.right ? X.add(twR, LZ) : 0;
    const awB = X.v("awB", X.sub(X.sub(W, 2 * pad), X.add(GL, GR)));
    const ahB = X.v("ahB", X.sub(H, 2 * pad));
    const dhB = X.v("dhB", X.max(0, X.min(ahB, X.div(awB, A))));
    // legend: the drawing between thin gutters of discs, the legend rows below
    const GLn = has.left ? DISC + LZN : 0, GRn = has.right ? DISC + LZN : 0;
    const lhN = X.v("lhN", X.mul(kN, lh));
    const rowH = X.v("rowH", X.add(X.max(DISC, lhN), 4));
    // Legend rows: two columns when every label fits one line in half the width
    const legTw = X.v("legT1", X.sub(W, 2 * pad + DISC + 16));
    const maxW2 = Math.max(...seq.map((it) => it.w2));
    const cols2 = seq.length > 1 ? X.v("cols2", X.step(X.sub(X.mul(X.sub(W, 2 * pad), 0.5), DISC + 16), X.mul(kN, maxW2 - 0.5))) : 0;
    const colW = X.v("colW", X.mul(X.sub(W, 2 * pad), X.sub(1, X.mul(cols2, 0.5))));
    // Each legend row is one line, or two when its label is wider than the legend: the sum of
    // step()s, in chunks (an expression holds at most 32 entries).
    let wraps = 0;
    if (o.legendLines > 1) {
        const steps = seq.map((it) => X.step(X.mul(kN, it.w2), legTw));
        for (let j = 0; j < steps.length; j += 4) wraps = X.v(`legS${j / 4}`, X.add(wraps, X.sum(steps.slice(j, j + 4))));
    }
    const legH1 = X.add(8 + seq.length * 0, X.add(X.mul(rowH, seq.length), X.mul(lhN, wraps)));
    const legH = X.v("legH", X.pick(cols2, X.add(8, X.mul(rowH, Math.ceil(seq.length / 2))), legH1));
    const awN = X.v("awN", X.sub(W, 2 * pad + GLn + GRn));
    const ahN = X.v("ahN", X.sub(X.sub(H, 2 * pad), legH));
    const dhN = X.v("dhN", X.max(0, X.min(ahN, X.div(awN, A))));
    // which look: beside when the labels fit at MIN_FONT or more, a side's labels need at most
    // twice the drawing's height (more is a fan of long leaders that can cross), and its drawing
    // is at least 0.6 of the legend's. "beside" pins it while the labels fit, "legend" always.
    const maxStack = Math.max(...["left", "right"].map((sd) => sides[sd].items.reduce((a, it) => a + it.h, 0)));
    const maxGaps = Math.max(...["left", "right"].map((sd) => Math.max(0, sides[sd].items.length - 1) * o.gap));
    const roomy = X.step(X.mul(dhB, 2), X.add(X.mul(k, maxStack), maxGaps - 0.5));
    const side = o.mode === "legend" ? 0 : X.v("side", o.mode === "beside" ? fitB
        : X.mul(X.mul(fitB, roomy), X.step(X.sub(dhB, X.mul(dhN, 0.6)), -0.01)));
    const pick = (b, n) => X.pick(side, b, n);
    // from here on one geometry, which the look picks
    // A legend drawing under MIN_LEGEND_DRAW dp is a stamp, and one whose discs on a side need
    // more than 1.6 times its height is buried under them: it and its markers hide, the legend
    // stays.
    const discStack = Math.max(sides.left.discStack, sides.right.discStack);
    const big = X.v("big", X.max(side, X.mul(X.step(dhN, MIN_LEGEND_DRAW - 0.5), X.step(X.mul(dhN, 1.6), discStack - 0.5))));
    const dh = X.v("dh", pick(dhB, X.mul(dhN, big)));
    const dw = X.v("dw", X.mul(dh, A));
    const x0 = X.v("x0", X.add(pad, X.mul(X.sub(pick(awB, awN), dw), 0.5)));
    const dx = X.v("dx", X.add(x0, pick(GL, GLn)));
    const dy = X.v("dy", X.add(pad, X.max(0, X.mul(X.sub(pick(ahB, ahN), dh), 0.5))));
    const rowTop = X.v("top", pick(pad, dy));
    const gap = X.add(DISC_GAP, X.mul(side, o.gap - DISC_GAP));
    const names = new Map();
    const hName = (h, kind, val) => {
        const key = `${kind}${h}`;
        if (!names.has(key)) names.set(key, X.v(key, val));
        return names.get(key);
    };
    const hi = X.v("hi", pick(X.sub(H, pad), X.add(dy, X.add(dh, 4))));
    const look = { side, big, k, kN, lhN, twL, twR, dx, dy, dw, dh, x0, rowTop, colW, cols2, legH, left: [], right: [] };
    let num = 0;
    for (const s of ["left", "right"]) {
        const its = order[s];
        if (!its.length) continue;
        const t = s[0];
        const ts = its.map((it, k) => X.v(`${t}t${k}`, X.add(dy, X.mul(dh, it.py))));
        // heights are the label's (beside) or a disc's (legend); one name per distinct height
        const hs = its.map((it) => hName(it.h, "h", X.add(DISC, X.mul(side, X.sub(X.mul(k, it.h), DISC)))));
        const pre = { half: its.map((it, k) => hName(it.h, "hh", X.mul(hs[k], 0.5))), step: its.map((it, k) => hName(it.h, "hg", X.add(hs[k], gap))) };
        const ys = relax(ts, hs, pad, hi, gap, X, t, pre);
        const sx = X.v(`${t}sx`, s === "left" ? X.add(x0, pick(X.add(twL, 4), DISC + 2)) : X.add(X.add(dx, dw), pick(LZ - 4, LZN - 2)));
        const ex = X.v(`${t}ex`, s === "left" ? X.add(sx, pick(SHELF, SHELF_N)) : X.sub(sx, pick(SHELF, SHELF_N)));
        const ax = its.map((it, k) => X.v(`${t}x${k}`, X.add(dx, X.mul(dw, it.px))));
        // A pair of neighbours whose leaders would cross trades places at run time: how far
        // labels are pushed, so whether two close anchors' leaders cross, depends on the size.
        // The pair keeps its span; the test is whether the far anchor's diagonal passes the
        // near anchor on the other side from where it ends.
        for (const k of order.swaps?.[s] ?? []) {
            const near = s === "left" ? (its[k].px <= its[k + 1].px ? k : k + 1) : (its[k].px >= its[k + 1].px ? k : k + 1);
            const far = near === k ? k + 1 : k;
            const yeF = X.v(`${t}e${far}`, X.add(ys[far], X.mul(hs[far], 0.5))), yeN = X.add(ys[near], X.mul(hs[near], 0.5));
            const at = X.v(`${t}p${k}`, X.add(ts[far], X.mul(X.sub(yeF, ts[far]), X.div(X.sub(ax[near], ax[far]), X.sub(ex, ax[far])))));
            const c = X.v(`${t}w${k}`, X.step(0, X.mul(X.sub(at, ts[near]), X.sub(yeF, yeN))));
            const top = ys[k], bottom = X.add(ys[k + 1], hs[k + 1]);
            const y0 = X.v(`${t}z${k}`, X.pick(c, X.sub(bottom, hs[k]), top));
            const y1 = X.v(`${t}z${k + 1}`, X.pick(c, top, ys[k + 1]));
            ys[k] = y0; ys[k + 1] = y1;
        }
        its.forEach((it, k) => {
            look[s].push({ it, n: ++num, y: ys[k], h: hs[k], yc: X.v(`${t}c${k}`, X.add(ys[k], pre.half[k])),
                ax: ax[k], ay: ts[k], sx, ex,
                cx: s === "left" ? X.sub(sx, DISC / 2 + 2) : X.add(sx, DISC / 2 + 2) });
        });
    }
    return { side, look, seq, beside: { dh: dhB }, legend: { dh: dhN } };
}

// --- leaders must not cross -----------------------------------------------------------------

function cross(p1, p2, p3, p4) {
    const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
    return ((d1 > 1e-6 && d2 < -1e-6) || (d1 < -1e-6 && d2 > 1e-6)) && ((d3 > 1e-6 && d4 < -1e-6) || (d3 < -1e-6 && d4 > 1e-6));
}

/** The leaders' segments of one side: [[anchor, elbow], [elbow, shelf start]] per label. */
export function leaders(look, s) {
    return look[s].map((L) => [[[L.ax, L.ay], [L.ex, L.yc]], [[L.ex, L.yc], [L.sx, L.yc]]]);
}

/** Pairs of leaders that cross in a numeric layout: [{side, a, b}] by label index. */
export function crossings(G) {
    const out = [];
    for (const s of ["left", "right"]) {
        const segs = leaders(G.look, s);
        for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
            if (segs[i].some((a) => segs[j].some((b) => cross(a[0], a[1], b[0], b[1])))) out.push({ side: s, a: G.look[s][i].it.i, b: G.look[s][j].it.i });
        }
    }
    return out;
}

/** Leaders that pass within 4 dp of another part's anchor dot: [{side, leader, anchor}]. */
export function grazes(G) {
    const all = [...G.look.left, ...G.look.right];
    const out = [];
    const dist = (p, a, b) => {
        const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
        return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    };
    for (const s of ["left", "right"]) for (const L of G.look[s]) for (const Q of all) {
        if (Q === L) continue;
        if (dist([Q.ax, Q.ay], [L.ax, L.ay], [L.ex, L.yc]) < 4) out.push({ side: s, leader: L.it.i, anchor: Q.it.i });
    }
    return out;
}

// Phones both ways, tablets, desktop, widgets (4x2, 2x2, strips).
export const SAMPLE_SIZES = [[360, 640], [640, 360], [412, 915], [915, 412], [800, 1280], [1280, 800], [1024, 768], [1920, 1080], [700, 500],
    [320, 480], [480, 320], [400, 300], [300, 400], [240, 320], [320, 240], [320, 160], [480, 200], [200, 200], [160, 160]];

/** The order of each side's labels: by anchor height, then swaps that remove crossings. */
export function chooseOrder(P, sizes = SAMPLE_SIZES) {
    const X = arith(null);
    const order = {};
    for (const s of ["left", "right"]) {
        order[s] = [...P.sides[s].items].sort((a, b) => a.py - b.py || (s === "left" ? a.px - b.px : b.px - a.px) || a.i - b.i);
    }
    // Every size in both looks, where the drawing is big enough to matter.
    const looks = ["beside", "legend"].map((mode) => ({ ...P, o: { ...P.o, mode } }));
    const score = (ord) => sizes.reduce((n, [w, h]) => n + looks.reduce((m, Q) => {
        const G = layout(Q, w, h, X, ord);
        return m + (G.look.dh >= 40 ? 10 * crossings(G).length + grazes(G).length : 0);
    }, 0), 0);
    let best = score(order);
    for (let round = 0; round < 40 && best > 0; round++) {
        let improved = false;
        for (const s of ["left", "right"]) {
            const its = order[s];
            for (let i = 0; i < its.length && !improved; i++) for (let j = i + 1; j < its.length && !improved; j++) {
                const trial = { ...order, [s]: its.map((x, k) => (k === i ? its[j] : k === j ? its[i] : x)) };
                const sc = score(trial);
                if (sc < best) { best = sc; order[s] = trial[s]; improved = true; }
            }
        }
        if (!improved) break;
    }
    // Neighbours that still cross somewhere get a run-time swap (pairs that do not overlap).
    const count = new Map();
    for (const [w, h] of sizes) for (const Q of looks) {
        const G = layout(Q, w, h, X, order);
        if (G.look.dh < 40) continue;
        for (const x of crossings(G)) {
            const k = order[x.side].findIndex((it) => it.i === x.a), k2 = order[x.side].findIndex((it) => it.i === x.b);
            if (Math.abs(k - k2) !== 1) continue;
            const key = `${x.side}:${Math.min(k, k2)}`;
            count.set(key, (count.get(key) ?? 0) + 1);
        }
    }
    order.swaps = { left: [], right: [] };
    for (const [key] of [...count].sort((a, b) => b[1] - a[1])) {
        const [s, kk] = key.split(":"), k = Number(kk);
        if (order.swaps[s].some((j) => Math.abs(j - k) < 2)) continue;
        order.swaps[s].push(k);
    }
    for (const s of ["left", "right"]) order.swaps[s].sort((a, b) => a - b);
    return order;
}

/** Numbers for a window of W x H dp: the whole solution, for tests and reports. */
export function solve(spec, W, H) {
    const P = plan(spec);
    const order = chooseOrder(P);
    return { plan: P, order, ...layout(P, W, H, arith(null), order) };
}

// --- the document -------------------------------------------------------------------------

function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36).slice(0, 5);
}

export function generate(spec, ctx) {
    if (spec.visual === undefined) throw new Error("visual (the drawing node) is required");
    const P = plan(spec);
    const { o, lh } = P;
    const order = chooseOrder(P);
    const vars = [];
    // ctx.unique gives "callouts1", "callouts2"... per document, so two identical calls do not collide
    const prefix = `${ctx.unique ? ctx.unique("callouts") : `co${hash(JSON.stringify([spec.parts ?? spec.items, spec.aspect, spec.points ?? null]))}`}_`;
    const X = arith(vars, prefix);
    const W = spec.width ?? "windowWidth()", H = spec.height ?? "windowHeight()";
    const Wv = X.v("W", typeof W === "number" ? W : String(W)), Hv = X.v("H", typeof H === "number" ? H : String(H));
    const G = layout(P, Wv, Hv, X, order);
    const side = G.side;
    const mono = ctx.mono;
    const c = { text: spec.textColor ?? "@colors.onSurface", line: spec.lineColor ?? (mono ? "@colors.onSurface" : "@colors.muted"),
        dot: spec.color ?? (mono ? "@colors.onSurface" : "@colors.primary"), bg: spec.background ?? "@colors.background", onDot: mono ? "@colors.onSurface" : "@colors.onPrimary" };
    // visibility needs a variable that is exactly 0 or 1
    const vis = (name, val) => {
        const full = `${prefix}${name}`;
        vars.push({ variable: { name: full, value: typeof val === "number" ? val : String(val) } });
        return `@${full}`;
    };
    const showB = vis("showB", side), showN = vis("showN", X.sub(1, side));
    const showL = vis("showL", X.max(side, G.look.big)), showD = vis("showD", X.mul(X.sub(1, side), G.look.big));
    const L0 = G.look;
    const box = (mods, children, extra = {}) => ({ box: { ...extra, modifiers: mods, ...(children ? { children } : {}) } });
    const hsp = (h) => box([{ height: h }]);
    const wsp = (w) => box([{ width: w }]);

    // A gutter of labels (beside only): each label is a column of its own, a spacer down to its
    // top (dp from the row top) and the label, all stacked in one box, so a pair can trade places.
    const fsB = X.v("fsB", X.mul(L0.k, o.fontSize)), fsN = X.v("fsN", X.mul(L0.kN, o.fontSize));
    const rowIn = X.v("rowIn", X.max(DISC, L0.lhN)), rowMid = X.v("rowMid", X.mul(rowIn, 0.5));
    const gutter = (s) => {
        if (!L0[s].length) return [];
        const tw = s === "left" ? L0.twL : L0.twR;
        const kids = L0[s].map((L) => ({ column: { children: [
            hsp(X.sub(L.y, o.pad)),
            box([{ width: tw }, { height: X.v(`hb${L.it.h}`, X.mul(L0.k, L.it.h)) }], [{ text: { value: L.it.label, fontSize: fsB, color: c.text,
                textAlign: s === "left" ? "end" : "start", maxLines: o.maxLines, overflow: "ellipsis" } }],
            { horizontalAlignment: s === "left" ? "end" : "start", verticalAlignment: "center" }),
        ] } }));
        return [box([{ visibility: showB }, { width: tw }], kids)];
    };
    const drawingMods = [{ width: L0.dw }, { height: L0.dh }];
    if (spec.label) drawingMods.push({ semantics: { contentDescription: String(spec.label) } });
    const visual = Array.isArray(spec.visual) ? spec.visual : [spec.visual];
    const hasL = L0.left.length > 0, hasR = L0.right.length > 0;
    const row = { row: { modifiers: [{ visibility: showL }], children: [
        wsp(X.v("x0s", X.pick(side, L0.x0, L0.dx))),
        ...gutter("left"),
        ...(hasL ? [wsp(X.mul(side, LZ))] : []),
        { column: { children: [hsp(X.v("dOff", X.sub(L0.dy, L0.rowTop))), box(drawingMods, visual)] } },
        ...(hasR ? [wsp(X.mul(side, LZ))] : []),
        ...gutter("right"),
    ] } };
    // the legend (legend look only), in reading order, numbered as the discs
    const numbered = [...L0.left, ...L0.right];
    const textW = X.v("legTw", X.sub(L0.colW, DISC + 16));
    const legendRows = numbered.map((L) => ({ row: { modifiers: [{ width: L0.colW }, { padding: [0, 2] }], children: [
        { canvas: { modifiers: [{ width: DISC }, { height: rowIn }], commands: discCommands(DISC / 2, rowMid, L.n, c, mono) } },
        wsp(8),
        { text: { value: L.it.label, fontSize: fsN, color: c.text, maxLines: o.legendLines, overflow: "ellipsis", modifiers: [{ width: textW }] } },
    ] } }));
    const legend = { flow: { modifiers: [{ visibility: showN }, { padding: [o.pad, 8, o.pad, 0] }], children: legendRows } };

    // leaders: a halo under the diagonal so it reads over the drawing, the lines, the anchor dots
    const diag = (L) => ({ drawLine: { x1: L.ax, y1: L.ay, x2: L.ex, y2: L.yc } });
    const shelf = (L) => ({ drawLine: { x1: L.ex, y1: L.yc, x2: L.sx, y2: L.yc } });
    const leaderCmds = [
        { paint: { ops: [{ color: c.bg }, { alpha: 1 }, { style: "stroke" }, { strokeWidth: 3.5 }, { strokeCap: "round" }] } },
        ...numbered.map(diag),
        { paint: { ops: [{ color: c.line }, { strokeWidth: mono ? 1 : 1.25 }] } },
        ...numbered.flatMap((L) => [diag(L), shelf(L)]),
        { paint: { ops: [{ color: c.bg }, { style: "fill" }] } },
        ...numbered.map((L) => ({ drawCircle: { cx: L.ax, cy: L.ay, radius: 4.5 } })),
        { paint: { ops: [{ color: c.dot }] } },
        ...numbered.map((L) => ({ drawCircle: { cx: L.ax, cy: L.ay, radius: 2.75 } })),
    ];
    const kids = [
        ...vars,
        { column: { modifiers: ["fillMaxSize"], children: [hsp(L0.rowTop), row, legend] } },
        { canvas: { modifiers: [{ visibility: showL }, "fillMaxSize"], commands: fold(leaderCmds) } },
        { canvas: { modifiers: [{ visibility: showD }, "fillMaxSize"], commands: fold(discsCommands(numbered.map((L) => [L.cx, L.yc, L.n]), c, mono)) } },
    ];
    const out = { box: { modifiers: ["fillMaxSize", { background: c.bg }], children: kids } };
    still(out, new Set(visual));
    return out;
}

// Players animate a component's bounds when layout moves it (300 ms by default). Leaders are
// drawn at their new place at once, so every box this generator places opts out
// (animationId 0: AnimationSpec.isAnimationEnabled is false), and labels, discs and lines move
// together. The caller's drawing nodes get it too, at their top level.
const LAYOUT = new Set(["box", "row", "column", "flow", "canvas", "text"]);
const STILL = { animationSpec: { animationId: 0 } };
function still(node, visual, inVisual = false) {
    if (Array.isArray(node)) { for (const x of node) still(x, visual, inVisual); return; }
    if (!node || typeof node !== "object") return;
    const key = Object.keys(node).find((k) => LAYOUT.has(k));
    if (!key) return;
    const n = node[key];
    // An empty spacer paints nothing, and its siblings are placed from its target size, not
    // its animated one: it can animate unseen, which saves the modifier (about 40 B each).
    const spacer = key === "box" && !n.children && (n.modifiers ?? []).every((m) => typeof m === "object" && ("width" in m || "height" in m));
    if ((!inVisual || visual.has(node)) && !spacer) n.modifiers = [...(n.modifiers ?? []), STILL];
    if (n.children) for (const ch of n.children) still(ch, visual, inVisual || visual.has(ch));
}

function discsCommands(discs, c, mono) {
    return [
        { paint: { ops: mono ? [{ color: c.bg }, { alpha: 1 }, { style: "fill" }] : [{ color: c.dot }, { alpha: 1 }, { style: "fill" }] } },
        ...discs.map(([cx, cy]) => ({ drawCircle: { cx, cy, radius: DISC / 2 } })),
        ...(mono ? [{ paint: { ops: [{ color: c.dot }, { style: "stroke" }, { strokeWidth: 1.5 }] } }, ...discs.map(([cx, cy]) => ({ drawCircle: { cx, cy, radius: DISC / 2 - 0.75 } }))] : []),
        { paint: { ops: [{ color: c.onDot }, { style: "fill" }, { textSize: 11 }] } },
        ...discs.map(([cx, cy, n]) => ({ drawTextAnchored: { text: String(n), x: cx, y: cy, panX: 0, panY: 0 } })),
    ];
}

function discCommands(cx, cy, n, c, mono) {
    return [
        { paint: { ops: mono ? [{ color: c.bg }, { alpha: 1 }, { style: "fill" }] : [{ color: c.dot }, { alpha: 1 }, { style: "fill" }] } },
        { drawCircle: { cx, cy, radius: DISC / 2 } },
        ...(mono ? [{ paint: { ops: [{ color: c.dot }, { style: "stroke" }, { strokeWidth: 1.5 }] } }, { drawCircle: { cx, cy, radius: DISC / 2 - 0.75 } }] : []),
        { paint: { ops: [{ color: c.onDot }, { style: "fill" }, { textSize: 11 }] } },
        { drawTextAnchored: { text: String(n), x: cx, y: cy, panX: 0, panY: 0 } },
    ];
}

/** Rounds literal numbers in a command (expressions are already strings). */
function fold(cmd) {
    if (typeof cmd === "number") return r3(cmd);
    if (Array.isArray(cmd)) return cmd.map(fold);
    if (cmd && typeof cmd === "object") return Object.fromEntries(Object.entries(cmd).map(([k, v]) => [k, fold(v)]));
    return cmd;
}
