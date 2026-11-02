// {"$gen": {"kind": "mathplot", "fn": "exp(-x/4)*cos(x)", "x": [0, "4pi"], "mark": ["max", "min"]}}
//
// A function plot from formulas. The server parses each formula, finds what the caller asks to
// mark (roots, maxima, minima, intersections, the y-intercept, given x values), picks the axis
// ranges and ticks (multiples of π when asked, or when the domain is written with π), and writes
// one canvas. The curve itself is NOT sampled here: each formula is translated into a runtime
// expression of the path's sample variable (a pathExpression), so the player evaluates it at the
// size the plot actually gets. That stays exact at every size and aspect (a sampled path scaled to
// a new aspect ratio would distort its stroke and its peaks), and costs the formula's bytes (about
// 60 B) instead of a polyline's (8 B a point, hundreds of points). Only a formula the format can't
// hold (over 32 expression entries, Android's limit, or a function the format lacks) is sampled
// here into a float array and drawn through arraySpline. Everything else is computed per
// frame from the canvas's own size: the mapping, the tick positions, which tick labels and point
// labels fit (alpha by step()), and where a label flips to stay inside.

export const kind = "mathplot";
export const doc = "A function plot from formulas in x: axes and ticks (π multiples), marked roots/extrema/intersections/points, legend, scrubbable x";

// ---------------------------------------------------------------------------------------------
// Formulas: a small parser to an AST, a JS evaluator, and an emitter to the format's infix.

const FUNCS = {
    sin: [1, Math.sin], cos: [1, Math.cos], tan: [1, Math.tan], asin: [1, Math.asin], acos: [1, Math.acos],
    atan: [1, Math.atan], arcsin: [1, Math.asin], arccos: [1, Math.acos], arctan: [1, Math.atan],
    sinh: [1, Math.sinh], cosh: [1, Math.cosh], tanh: [1, Math.tanh],
    sec: [1, (a) => 1 / Math.cos(a)], csc: [1, (a) => 1 / Math.sin(a)], cot: [1, (a) => 1 / Math.tan(a)],
    sqrt: [1, Math.sqrt], cbrt: [1, Math.cbrt], abs: [1, Math.abs], exp: [1, Math.exp],
    ln: [1, Math.log], log: [1, Math.log10], log10: [1, Math.log10], log2: [1, Math.log2],
    floor: [1, Math.floor], ceil: [1, Math.ceil], round: [1, Math.round], sign: [1, Math.sign],
    min: [2, Math.min], max: [2, Math.max], pow: [2, Math.pow], atan2: [2, Math.atan2], hypot: [2, Math.hypot],
};
const CONSTS = { pi: Math.PI, e: Math.E, tau: 2 * Math.PI };

function tokenize(src) {
    const s = String(src)
        .replace(/π/g, " pi ").replace(/τ/g, " tau ").replace(/[−–]/g, "-").replace(/[·×⋅∙]/g, "*").replace(/÷/g, "/")
        .replace(/²/g, "^2").replace(/³/g, "^3").replace(/√/g, " sqrt ");
    const out = [];
    const re = /\s*(?:(\d+\.?\d*|\.\d+)|([A-Za-z_][A-Za-z0-9_]*)|(\*\*|[-+*/^(),|]))/y;
    let i = 0;
    while (i < s.length) {
        if (/\s/.test(s[i])) { i++; continue; }
        re.lastIndex = i;
        const m = re.exec(s);
        if (!m) throw new Error(`can't read '${s.slice(i, i + 8)}' in "${src}"`);
        if (m[1] !== undefined) out.push({ t: "num", v: Number(m[1]) });
        else if (m[2] !== undefined) {
            // "xsin" or "2pix" style runs: split a run of known names greedily ("pix" = pi x).
            let w = m[2];
            while (w.length) {
                const known = Object.keys(FUNCS).concat(Object.keys(CONSTS), ["x"]).sort((a, b) => b.length - a.length).find((k) => w.startsWith(k));
                if (!known) throw new Error(`unknown name '${w}' in "${src}" (write x for the variable; functions: ${Object.keys(FUNCS).join(", ")}; constants pi, e)`);
                out.push({ t: "id", v: known });
                w = w.slice(known.length);
            }
        } else out.push({ t: "op", v: m[3] === "**" ? "^" : m[3] });
        i = re.lastIndex;
    }
    return out;
}

/** Parses a formula in x into an AST: {num}, {x}, {neg}, {bin op a b}, {fn name args}. */
export function parse(src) {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const isOp = (v) => peek()?.t === "op" && peek().v === v;
    const expect = (v) => { if (!isOp(v)) throw new Error(`expected '${v}' in "${src}"`); p++; };
    const startsAtom = () => { const k = peek(); return k && (k.t === "num" || k.t === "id" || (k.t === "op" && (k.v === "(" || k.v === "|"))); };
    function expr() {
        let a = term();
        while (isOp("+") || isOp("-")) { const op = toks[p++].v; a = { t: "bin", op, a, b: term() }; }
        return a;
    }
    function term() {
        let a = unary();
        for (;;) {
            if (isOp("*") || isOp("/")) { const op = toks[p++].v; a = { t: "bin", op, a, b: unary() }; }
            else if (startsAtom() && !(isOp("|") && inAbs > 0)) a = { t: "bin", op: "*", a, b: power() };   // 2x, x(x+1)
            else return a;
        }
    }
    function unary() {
        if (isOp("-")) { p++; return { t: "neg", a: unary() }; }
        if (isOp("+")) { p++; return unary(); }
        return power();
    }
    function power() {
        const a = atom();
        if (isOp("^")) { p++; return { t: "bin", op: "^", a, b: unary() }; }
        return a;
    }
    let inAbs = 0;
    function atom() {
        const k = toks[p++];
        if (!k) throw new Error(`"${src}" ends too early`);
        if (k.t === "num") return { t: "num", v: k.v };
        if (k.t === "op" && k.v === "(") { const e = expr(); expect(")"); return e; }
        if (k.t === "op" && k.v === "|") { inAbs++; const e = expr(); inAbs--; expect("|"); return { t: "fn", name: "abs", args: [e] }; }
        if (k.t === "id") {
            if (k.v === "x") return { t: "x" };
            if (k.v in CONSTS) return { t: "num", v: CONSTS[k.v], c: k.v };
            const [arity] = FUNCS[k.v];
            if (isOp("(")) {
                p++;
                const args = [expr()];
                while (isOp(",")) { p++; args.push(expr()); }
                expect(")");
                if (args.length !== arity) throw new Error(`${k.v} takes ${arity} argument${arity > 1 ? "s" : ""} in "${src}"`);
                // sin(x)^2 is (sin x)^2
                const f = { t: "fn", name: k.v, args };
                if (isOp("^")) { p++; return { t: "bin", op: "^", a: f, b: unary() }; }
                return f;
            }
            if (arity !== 1) throw new Error(`${k.v} needs parentheses in "${src}"`);
            // "sin x", "sin 2x": the argument runs to the next + or -.
            let a = power();
            while (startsAtom() || isOp("*") || isOp("/")) {
                if (isOp("*") || isOp("/")) { const op = toks[p++].v; a = { t: "bin", op, a, b: power() }; }
                else a = { t: "bin", op: "*", a, b: power() };
            }
            return { t: "fn", name: k.v, args: [a] };
        }
        throw new Error(`unexpected '${k.v}' in "${src}"`);
    }
    const tree = expr();
    if (p < toks.length) throw new Error(`unexpected '${toks[p].v}' in "${src}"`);
    return tree;
}

/** A JS function of x for an AST. */
export function compile(node) {
    switch (node.t) {
        case "num": return () => node.v;
        case "x": return (x) => x;
        case "neg": { const a = compile(node.a); return (x) => -a(x); }
        case "bin": {
            const a = compile(node.a), b = compile(node.b);
            switch (node.op) {
                case "+": return (x) => a(x) + b(x);
                case "-": return (x) => a(x) - b(x);
                case "*": return (x) => a(x) * b(x);
                case "/": return (x) => a(x) / b(x);
                case "^": return (x) => Math.pow(a(x), b(x));
            }
            break;
        }
        case "fn": {
            const f = FUNCS[node.name][1], as = node.args.map(compile);
            return as.length === 1 ? (x) => f(as[0](x)) : (x) => f(as[0](x), as[1](x));
        }
    }
    throw new Error(`bad node ${node.t}`);
}

/** Folds constant subtrees ("x/4" stays, "2*pi" becomes 6.283...). */
function fold(n) {
    if (n.t === "neg") { const a = fold(n.a); return a.t === "num" ? { t: "num", v: -a.v } : { t: "neg", a }; }
    if (n.t === "bin") {
        const a = fold(n.a), b = fold(n.b);
        if (a.t === "num" && b.t === "num") return { t: "num", v: compile({ t: "bin", op: n.op, a, b })() };
        if (n.op === "*" && a.t === "num" && a.v === 1) return b;
        if ((n.op === "*" || n.op === "/") && b.t === "num" && b.v === 1) return a;
        if (n.op === "+" && a.t === "num" && a.v === 0) return b;
        if ((n.op === "+" || n.op === "-") && b.t === "num" && b.v === 0) return a;
        if (n.op === "^" && b.t === "num" && b.v === 1) return a;
        // a / c -> a * (1/c): same size, but -x/4 reads x * -0.25
        if (n.op === "/" && b.t === "num") return { t: "bin", op: "*", a, b: { t: "num", v: 1 / b.v } };
        // e^a -> exp(a)
        if (n.op === "^" && a.t === "num" && a.c === "e") return { t: "fn", name: "exp", args: [b] };
        // -(a) * c -> a * -c
        if (n.op === "*" && a.t === "neg" && b.t === "num") return { t: "bin", op: "*", a: a.a, b: { t: "num", v: -b.v } };
        return { t: "bin", op: n.op, a, b };
    }
    if (n.t === "fn") {
        const args = n.args.map(fold);
        if (args.every((x) => x.t === "num")) return { t: "num", v: FUNCS[n.name][1](...args.map((x) => x.v)) };
        return { t: "fn", name: n.name, args };
    }
    return n;
}

/** A number as the format's tokenizer reads it: no exponent, at most 7 significant digits. */
export function num(v) {
    if (!Number.isFinite(v)) throw new Error(`the formula evaluates to ${v}`);
    if (Math.abs(v) < 1e-9) return "0";
    let s = Number(v.toPrecision(7)).toString();
    if (/e/.test(s)) s = v.toFixed(Math.min(20, Math.max(0, 7 - Math.floor(Math.log10(Math.abs(v))))));
    return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/**
 * The format's infix for an AST, with x written as `xs` (an expression costing `xn` entries):
 * {s, n} where n counts RPN entries (Android refuses a path expression over 32). Throws for a
 * function the format lacks (none here: every one is rewritten).
 */
export function emit(node, xs = "u", xn = 1) {
    const go = (n) => emit(n, xs, xn);
    switch (n_t(node)) {
        case "num": return { s: num(node.v), n: 1 };
        case "x": return { s: xs, n: xn };
        case "neg": { const a = go(node.a); return { s: `(-${a.s})`, n: a.n + 1 }; }
        case "bin": {
            const a = go(node.a);
            if (node.op === "^") {
                if (node.b.t === "num" && node.b.v === 2) return { s: `square(${a.s})`, n: a.n + 1 };
                if (node.b.t === "num" && node.b.v === 0.5) return { s: `sqrt(${a.s})`, n: a.n + 1 };
                const b = go(node.b);
                return { s: `pow(${a.s}, ${b.s})`, n: a.n + b.n + 1 };
            }
            const b = go(node.b);
            return { s: `(${a.s} ${node.op} ${b.s})`, n: a.n + b.n + 1 };
        }
        case "fn": {
            const as = node.args.map(go);
            const one = as[0];
            const k = (s, n) => ({ s, n });
            switch (node.name) {
                case "arcsin": return k(`asin(${one.s})`, one.n + 1);
                case "arccos": return k(`acos(${one.s})`, one.n + 1);
                case "arctan": return k(`atan(${one.s})`, one.n + 1);
                case "log10": return k(`log(${one.s})`, one.n + 1);
                case "log2": return k(`(ln(${one.s}) * 1.442695)`, one.n + 3);
                case "sec": return k(`(1 / cos(${one.s}))`, one.n + 3);
                case "csc": return k(`(1 / sin(${one.s}))`, one.n + 3);
                case "cot": return k(`(1 / tan(${one.s}))`, one.n + 3);
                case "cbrt": return k(`(sign(${one.s}) * pow(abs(${one.s}), 0.3333333))`, 2 * one.n + 6);
                case "sinh": return k(`((exp(${one.s}) - exp(-${one.s})) * 0.5)`, 2 * one.n + 7);
                case "cosh": return k(`((exp(${one.s}) + exp(-${one.s})) * 0.5)`, 2 * one.n + 7);
                case "tanh": return k(`(1 - 2 / (exp(2 * ${one.s}) + 1))`, one.n + 8);
                default: return k(`${node.name}(${as.map((a) => a.s).join(", ")})`, as.reduce((t, a) => t + a.n, 0) + 1);
            }
        }
    }
    throw new Error(`bad node ${node.t}`);
}
const n_t = (n) => n.t;

/** Readable text for a formula: "e^(−x/4)·cos(x)". */
export function pretty(src) {
    return String(src).replace(/\s+/g, "").replace(/\*\*/g, "^").replace(/exp\(([^()]*)\)/g, "e^($1)").replace(/\bpi\b/g, "π")
        .replace(/(\d)\*(?=[a-zπ(])/g, "$1").replace(/\*/g, "·").replace(/-/g, "−").replace(/\^2(?![\d.])/g, "²").replace(/\^3(?![\d.])/g, "³")
        .replace(/([+−])/g, " $1 ").replace(/(^|[(,^])\s*−\s+/g, "$1−").replace(/\(\s+/g, "(").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------------------------
// Numbers: an x value written with π, analysis (roots, extrema), nice ticks, labels.

/** "4pi", "-π/2", "3π/4", 2 -> number. */
export function value(v, what = "value") {
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim()) return compile(fold(parse(v)))(0);
    throw new Error(`${what}: expected a number or a formula like "2pi", got ${JSON.stringify(v)}`);
}
const hasPi = (v) => typeof v === "string" && /pi|π|tau|τ/.test(v);

const golden = (f, a, b, sign) => {
    // maximises sign*f on [a, b]
    const g = (x) => sign * f(x);
    const r = (Math.sqrt(5) - 1) / 2;
    let c = b - r * (b - a), d = a + r * (b - a), gc = g(c), gd = g(d);
    for (let i = 0; i < 100 && b - a > 1e-13 * (1 + Math.abs(a)); i++) {
        if (gc > gd) { b = d; d = c; gd = gc; c = b - r * (b - a); gc = g(c); }
        else { a = c; c = d; gc = gd; d = a + r * (b - a); gd = g(d); }
    }
    return (a + b) / 2;
};

function samples(f, a, b, n = 4000) {
    const xs = [], ys = [];
    for (let i = 0; i <= n; i++) { const x = a + (b - a) * i / n; xs.push(x); ys.push(f(x)); }
    return { xs, ys };
}

/** A typical magnitude of f over the domain (robust to poles): the 90th percentile of |f|. */
function scaleOf(ys) {
    const v = ys.filter(Number.isFinite).map(Math.abs).sort((p, q) => p - q);
    return v.length ? Math.max(v[Math.floor(v.length * 0.9)] ?? 0, 1e-12) : 1;
}

/** Snaps a found x to a short exact value when it is one (3, -1.5, π/2), within 1e-9 of the span. */
function snap(x, span, rel = 1e-9) {
    const tol = rel * Math.max(1, span);
    for (const d of [1, 2, 3, 4, 5, 6, 8, 10, 12]) { const r = Math.round(x * d) / d; if (Math.abs(r - x) < tol) return r; }
    for (const d of [1, 2, 3, 4, 6, 12]) { const r = Math.round(x / Math.PI * d) * Math.PI / d; if (Math.abs(r - x) < tol) return r; }
    return x;
}

/**
 * The peak of sign*f in [p, q]: where the central-difference slope changes sign, by bisection
 * (about 1e-10 of the span; golden section alone stops near 1e-8 on a flat top).
 */
function peak(f, p, q, sign, span) {
    const h = span * 1e-7;
    const d = (x) => sign * (f(x + h) - f(x - h));
    let dp = d(p), dq = d(q);
    if (!(dp > 0 && dq < 0)) return golden(f, p, q, sign);
    for (let k = 0; k < 100 && q - p > 0; k++) {
        const m = (p + q) / 2;
        if (m === p || m === q) break;
        const dm = d(m);
        if (dm > 0) p = m; else if (dm < 0) q = m; else return m;
    }
    return (p + q) / 2;
}

/** The roots of f in [a, b]: sign changes refined by bisection, and touching zeros (x²). */
export function roots(f, a, b, n = 4000) {
    const { xs, ys } = samples(f, a, b, n);
    const sc = scaleOf(ys), span = b - a, out = [];
    const add = (x) => { x = snap(x, span); if (!out.some((r) => Math.abs(r - x) < span * 1e-6)) out.push(x); };
    for (let i = 0; i < n; i++) {
        const y0 = ys[i], y1 = ys[i + 1];
        if (!Number.isFinite(y0) || !Number.isFinite(y1)) continue;
        if (y0 === 0) { add(xs[i]); continue; }
        if (y0 * y1 < 0) {
            let lo = xs[i], hi = xs[i + 1], flo = y0;
            for (let k = 0; k < 200 && hi - lo > 0; k++) {
                const m = (lo + hi) / 2, fm = f(m);
                if (m === lo || m === hi) break;
                if (fm === 0) { lo = hi = m; break; }
                if (Math.sign(fm) === Math.sign(flo)) { lo = m; flo = fm; } else hi = m;
            }
            const r = (lo + hi) / 2;
            if (Math.abs(f(r)) < 1e-6 * sc) add(r);   // a pole changes sign too, with a huge |f|
        }
    }
    if (ys[n] === 0) add(xs[n]);
    // Touching zeros: local minima of |f| that reach 0 without a sign change.
    for (let i = 1; i < n; i++) {
        const p = Math.abs(ys[i - 1]), q = Math.abs(ys[i]), r = Math.abs(ys[i + 1]);
        if (!(q <= p && q < r) || ys[i - 1] * ys[i + 1] <= 0) continue;
        const x = golden((t) => Math.abs(f(t)), xs[i - 1], xs[i + 1], -1);
        if (Math.abs(f(x)) < 1e-9 * sc) add(x);
    }
    return out.sort((p, q) => p - q);
}

/** Interior local maxima ("max") or minima ("min") of f in [a, b], refined by golden section. */
export function extrema(f, a, b, which = "max", n = 4000) {
    const sign = which === "max" ? 1 : -1;
    const { xs, ys } = samples(f, a, b, n);
    const sc = scaleOf(ys), span = b - a, out = [];
    for (let i = 1; i < n; i++) {
        const p = sign * ys[i - 1], q = sign * ys[i], r = sign * ys[i + 1];
        if (![p, q, r].every(Number.isFinite)) continue;
        if (!(q > p && q >= r)) continue;
        let x = peak(f, xs[i - 1], xs[i + 1], sign, span);
        x = snap(x, span, 1e-7);
        const y = f(x);
        if (!Number.isFinite(y) || Math.abs(y) > 1e6 * sc) continue;   // a pole, not a peak
        if (x <= a + span * 1e-9 || x >= b - span * 1e-9) continue;
        if (!out.some((o) => Math.abs(o - x) < span * 1e-6)) out.push(x);
    }
    return out;
}

/** "Nice" tick values covering [lo, hi] with about `target` steps (1, 2, 2.5, 5 × 10^k). */
export function niceTicks(lo, hi, target = 5) {
    const raw = (hi - lo) / Math.max(1, target);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw * 0.999) ?? 10 * p;
    const first = Math.ceil(lo / step - 1e-9) * step, out = [];
    for (let v = first; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toPrecision(12)));
    return { step, ticks: out, decimals: Math.max(0, -Math.floor(Math.log10(step) + 1e-9) + (/2\.5/.test(String(step / p)) ? 1 : 0)) };
}

/** Multiples of π/d covering [lo, hi] with at most `max` ticks. */
export function piTicks(lo, hi, max = 9) {
    for (const [num_, den] of [[1, 12], [1, 6], [1, 4], [1, 2], [1, 1], [2, 1], [4, 1], [5, 1], [10, 1]]) {
        const step = Math.PI * num_ / den;
        const first = Math.ceil(lo / step - 1e-9), last = Math.floor(hi / step + 1e-9);
        if (last - first + 1 <= max) {
            const ticks = [];
            for (let k = first; k <= last; k++) ticks.push({ v: k * step, label: piLabel(k * num_, den) });
            return { step, ticks };
        }
    }
    return { step: hi - lo, ticks: [] };
}

/** k·π/d in lowest terms: "0", "π", "−π/2", "3π/4", "2π". */
export function piLabel(k, d) {
    if (k === 0) return "0";
    const g = gcd(Math.abs(k), d); k /= g; d /= g;
    const s = (k < 0 ? "−" : "") + (Math.abs(k) === 1 ? "" : Math.abs(k)) + "π";
    return d === 1 ? s : `${s}/${d}`;
}
const gcd = (a, b) => (b ? gcd(b, a % b) : a);

/** A number for a label: up to `dec` decimals, trailing zeros dropped, a real minus sign. */
export function fmt(v, dec = 2) {
    let s = (Math.abs(v) < 0.5 * Math.pow(10, -dec) ? 0 : v).toFixed(dec);
    if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
    if (s === "-0") s = "0";
    return s.replace(/^-/, "−");
}

/** x as a multiple of π when it is one (to 1e-6), else a decimal. */
function fmtX(x, pi, dec) {
    if (pi) for (const d of [1, 2, 3, 4, 6, 12]) { const k = Math.round(x / Math.PI * d); if (Math.abs(k * Math.PI / d - x) < 1e-6) return piLabel(k, d); }
    return fmt(x, dec);
}

// ---------------------------------------------------------------------------------------------
// The document.

const SERIES = ["@colors.primary", "@colors.error", "@colors.success", "@colors.warning", "@colors.secondary"];
const CHAR_W = 6.1;     // average advance at 11 sp, for label widths
const TEXT = 11;

const paint = (...ops) => ({ paint: { ops } });
const variable = (name, value) => ({ variable: { name, value } });
const text = (t, x, y, panX = 0, panY = 0) => ({ drawTextAnchored: { text: t, x, y, panX, panY } });

/** spec -> {column: [scrub readout?, canvas, legend?]}. See MathPlot's component.json for the params. */
export function generate(spec, ctx) {
    const mono = Boolean(ctx.mono);
    const fnList = Array.isArray(spec.fn) ? spec.fn : [spec.fn];
    if (!fnList.length || fnList.some((f) => f === undefined || f === null || f === "")) throw new Error("fn: give a formula in x, e.g. \"x^2 - 2x - 3\", or a list of them");
    const series = fnList.map((f, i) => {
        const o = typeof f === "object" ? f : { f };
        if (typeof o.f !== "string") throw new Error(`fn[${i}]: an object needs f, the formula`);
        const ast = fold(parse(o.f));
        return { src: o.f, ast, f: compile(ast), label: o.label === undefined ? (fnList.length > 1 || spec.legend ? pretty(o.f) : null) : o.label,
                 dashed: o.dashed ?? (o.style === "dashed" ? true : o.style === "solid" ? false : undefined), color: o.color ?? SERIES[i % SERIES.length], i };
    });
    const dom = spec.x ?? [-10, 10];
    if (!Array.isArray(dom) || dom.length !== 2) throw new Error("x: the domain as [from, to], e.g. [-2, 5] or [0, \"4pi\"]");
    const a = value(dom[0], "x[0]"), b = value(dom[1], "x[1]");
    if (!(b > a)) throw new Error(`x: [${dom}] must go from low to high`);
    const span = b - a;
    const piMode = spec.ticks === "pi" || (spec.ticks !== "decimal" && (hasPi(dom[0]) || hasPi(dom[1])));
    const height = Number(spec.height ?? 220);

    // ---- marks
    const marks = [];
    const f0 = series[0];
    const addMark = (x, kind, s, label) => {
        const y = s.f(x);
        if (!Number.isFinite(y)) return;
        if (marks.some((m) => m.s === s && Math.abs(m.x - x) < span * 1e-6)) return;
        marks.push({ x, y, kind, s, label });
    };
    for (const m of spec.mark ?? []) {
        const o = m !== null && typeof m === "object" ? m : { at: m };
        const s = series[o.of ?? 0];
        if (!s) throw new Error(`mark ${JSON.stringify(m)}: of ${o.of} is not one of the ${series.length} functions`);
        const at = typeof o.at === "string" ? o.at.toLowerCase().replace(/[\s_-]/g, "") : o.at;
        const kinds = { roots: "root", root: "root", zeros: "root", zeroes: "root", xintercepts: "root", xintercept: "root",
            max: "max", maxima: "max", maximum: "max", peaks: "max", peak: "max", min: "min", minima: "min", minimum: "min",
            troughs: "min", valleys: "min", extrema: "both", extremes: "both", turningpoints: "both", stationary: "both",
            yintercept: "yint", intersections: "cross", intersection: "cross", crossings: "cross" };
        const k = typeof at === "string" ? kinds[at] : undefined;
        if (k === "root") roots(s.f, a, b).forEach((x) => addMark(x, "root", s, o.label));
        else if (k === "max" || k === "both") extrema(s.f, a, b, "max").forEach((x) => addMark(x, "max", s, o.label));
        if (k === "min" || k === "both") extrema(s.f, a, b, "min").forEach((x) => addMark(x, "min", s, o.label));
        else if (k === "yint") { if (a <= 0 && b >= 0) addMark(0, "yint", s, o.label); }
        else if (k === "cross") {
            const t = series[o.with ?? (s.i === 0 ? 1 : 0)];
            if (!t) throw new Error(`mark "intersections" needs a second function`);
            roots((x) => s.f(x) - t.f(x), a, b).forEach((x) => addMark(x, "cross", s, o.label));
        } else if (k === undefined) {
            if (typeof at === "string" && !/[0-9πp]/.test(at)) throw new Error(`mark '${o.at}': use roots, max, min, extrema, yIntercept, intersections, or an x value (2, "pi/2")`);
            const x = value(o.at, "mark");
            if (x < a || x > b) throw new Error(`mark at x = ${o.at} is outside x [${dom}]`);
            addMark(x, "at", s, o.label);
        }
    }
    marks.sort((p, q) => p.x - q.x);

    // ---- y range
    let lo, hi;
    if (Array.isArray(spec.y)) { lo = value(spec.y[0], "y[0]"); hi = value(spec.y[1], "y[1]"); if (!(hi > lo)) throw new Error(`y: [${spec.y}] must go from low to high`); }
    else {
        const vals = [];
        for (const s of series) for (const y of samples(s.f, a, b, 1000).ys) if (Number.isFinite(y)) vals.push(y);
        if (!vals.length) throw new Error(`${series[0].src} has no real values on [${dom}]`);
        vals.sort((p, q) => p - q);
        lo = vals[0]; hi = vals[vals.length - 1];
        // Poles: keep the body of the curve, not the spike.
        const q1 = vals[Math.floor(vals.length * 0.02)], q9 = vals[Math.floor(vals.length * 0.98)];
        if (hi - lo > 8 * Math.max(q9 - q1, 1e-9)) { lo = q1; hi = q9; }
        for (const m of marks) { lo = Math.min(lo, m.y); hi = Math.max(hi, m.y); }
        if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
        // Bring in zero when the curve comes near it.
        if (lo > 0 && lo < (hi - lo) * 0.5) lo = 0;
        if (hi < 0 && -hi < (hi - lo) * 0.5) hi = 0;
        const t = niceTicks(lo, hi, Math.max(3, Math.round(height / 50)));
        lo = Math.floor(lo / t.step + 1e-9) * t.step; hi = Math.ceil(hi / t.step - 1e-9) * t.step;
    }
    const yt = niceTicks(lo, hi, Math.max(3, Math.round(height / 50)));
    const yTicks = yt.ticks.filter((v) => v >= lo - 1e-9 && v <= hi + 1e-9);
    const yLabel = (v) => fmt(v, yt.decimals);
    let xTicks;
    if (piMode) xTicks = piTicks(a, b, 7).ticks;
    else { const t = niceTicks(a, b, 6); xTicks = t.ticks.filter((v) => v >= a - 1e-9 && v <= b + 1e-9).map((v) => ({ v, label: fmt(v, t.decimals) })); }
    const xStep = xTicks.length > 1 ? xTicks[1].v - xTicks[0].v : span;
    const decX = piMode ? 2 : Math.max(2, niceTicks(a, b, 6).decimals);
    const ySpan = hi - lo;
    const decY = Math.max(2, Math.min(4, 1 - Math.floor(Math.log10(ySpan / 10))));

    // ---- names (scoped per call by the component: names.t is the call's scrub variable)
    const scope = String(spec.t ?? spec.scope ?? "mp").replace(/[^A-Za-z0-9_]/g, "") || "mp";
    const N = (k) => `${scope}_${k}`;
    const V = (k) => `@${scope}_${k}`;

    // ---- margins
    const yW = Math.max(...yTicks.map((v) => yLabel(v).length), 1) * CHAR_W;
    const L = Math.ceil(yW + 10);
    const lastW = xTicks.length ? xTicks[xTicks.length - 1].label.length * CHAR_W : 0;
    const R = Math.ceil(Math.max(10, lastW / 2 + 2));
    const scrub = spec.scrub !== undefined && spec.scrub !== false;
    // room for a mark's label above a point near the top, or below one near the bottom
    const nearTop = marks.some((m) => m.kind !== "min" && (hi - m.y) / ySpan < 0.2);
    const nearBottom = marks.some((m) => m.kind !== "max" && (m.y - lo) / ySpan < 0.2);
    const T = (scrub ? 22 : 0) + (nearTop ? 22 : 10);
    const B = 20;     // x tick labels
    const Bx = B + (nearBottom ? 20 : 4);
    const xOf = (v) => (v === 0 ? V("cx") : `${V("cx")} + ${num(v)} * ${V("kx")}`);
    const yOf = (v) => (v === 0 ? V("cy") : `${V("cy")} - ${num(v)} * ${V("ky")}`);
    const bottom = `componentHeight() - ${Bx}`;
    const right = `componentWidth() - ${R}`;

    const cmds = [
        variable(N("kx"), `(componentWidth() - ${L + R}) / ${num(span)}`),
        variable(N("cx"), a === 0 ? `${L}` : `${num(L)} - ${num(a)} * ${V("kx")}`),
        variable(N("ky"), `(componentHeight() - ${T + Bx}) / ${num(ySpan)}`),
        variable(N("cy"), `${num(T)} + ${num(hi)} * ${V("ky")}`),
        variable(N("b"), bottom),
        variable(N("r"), right),
    ];
    const BOT = V("b"), RIGHT = V("r");
    // Ticks are evenly spaced: the first one's position and the step in dp, then translate by the
    // step (a variable, so each tick costs no expression of its own).
    const nx = xTicks.length, ny = yTicks.length;
    if (nx) cmds.push(variable(N("gx"), xOf(xTicks[0].v)), variable(N("sx"), `${num(xStep)} * ${V("kx")}`));
    if (ny) cmds.push(variable(N("gy"), yOf(yTicks[0])), variable(N("sy"), `${num(-yt.step)} * ${V("ky")}`));
    const stepped = (dx, dy, n, body, step) => ({ save: { commands: [{ translate: { dx, dy } }, { loop: { index: "i", from: 0, until: n, commands: [...body, { translate: step }] } }] } });

    // ---- grid and axes
    if (!mono) {
        cmds.push(paint({ color: "@colors.track" }, { style: "stroke" }, { strokeWidth: 1 }, { alpha: 0.5 }));
        if (nx) cmds.push(stepped(V("gx"), 0, nx, [{ drawLine: { x1: 0, y1: T, x2: 0, y2: BOT } }], { dx: V("sx"), dy: 0 }));
        if (ny) cmds.push(stepped(0, V("gy"), ny, [{ drawLine: { x1: L, y1: 0, x2: RIGHT, y2: 0 } }], { dx: 0, dy: V("sy") }));
    }
    cmds.push(paint({ color: "@colors.outline" }, { style: "stroke" }, { strokeWidth: mono ? 1 : 1.25 }, { alpha: 1 }));
    const axisY = lo <= 0 && hi >= 0 ? V("cy") : BOT;          // the x axis
    const axisX = a <= 0 && b >= 0 ? V("cx") : `${L}`;          // the y axis
    cmds.push({ drawLine: { x1: L, y1: axisY, x2: RIGHT, y2: axisY } });
    cmds.push({ drawLine: { x1: axisX, y1: T, x2: axisX, y2: BOT } });
    // tick marks on the axes
    if (nx) cmds.push({ save: { commands: [{ translate: { dx: 0, dy: axisY } }, stepped(V("gx"), 0, nx, [{ drawLine: { x1: 0, y1: 0, x2: 0, y2: 4 } }], { dx: V("sx"), dy: 0 })] } });
    if (ny) cmds.push({ save: { commands: [{ translate: { dx: axisX, dy: 0 } }, stepped(0, V("gy"), ny, [{ drawLine: { x1: -4, y1: 0, x2: 0, y2: 0 } }], { dx: 0, dy: V("sy") })] } });

    // ---- tick labels: every other one fades out when the plot is too narrow / short for all
    const xLabW = Math.max(...xTicks.map((t) => t.label.length * CHAR_W), 8) + 8;
    const needKx = xLabW / Math.max(xStep, 1e-9);
    const needKy = 14 / Math.max(yt.step, 1e-9);
    cmds.push(paint({ color: "@colors.muted" }, { style: "fill" }, { textSize: TEXT }));
    const labelRun = (items, odd, start, step, at) => {
        const cs = [{ translate: start }];
        items.forEach((lab, k) => {
            if (k % 2 !== (odd ? 1 : 0)) return;
            cs.push(at(lab));
        });
        // between two drawn labels: two steps
        const out = [];
        let first = true;
        for (const c of cs.slice(1)) { if (!first) out.push({ translate: step }, { translate: step }); out.push(c); first = false; }
        return { save: { commands: [cs[0], ...(odd ? [{ translate: step }] : []), ...out] } };
    };
    const xs0 = { dx: V("gx"), dy: `componentHeight() - ${B - 2}` }, xstep = { dx: V("sx"), dy: 0 };
    const ys0 = { dx: L - 6, dy: V("gy") }, ystep = { dx: 0, dy: V("sy") };
    const xAt = (t) => text(t.label, 0, 0, 0, 1), yAt = (v) => text(yLabel(v), 0, 0, 1, 0);
    if (nx) cmds.push(labelRun(xTicks, false, xs0, xstep, xAt));
    if (ny) cmds.push(labelRun(yTicks, false, ys0, ystep, yAt));
    if (nx > 1) cmds.push(paint({ alpha: `step(${V("kx")}, ${num(needKx)})` }), labelRun(xTicks, true, xs0, xstep, xAt));
    if (ny > 1) cmds.push(paint({ alpha: `step(${V("ky")}, ${num(needKy)})` }), labelRun(yTicks, true, ys0, ystep, yAt));

    // ---- curves, clipped to the plot (with room for half a stroke)
    const curveCmds = [];
    series.forEach((s, i) => {
        const segs = segments(s.f, a, b, lo, hi);
        const rt = runtimeY(s, ctx, a, span, V);
        const width = mono ? (i === 0 ? 2 : 1.5) : (i === 0 ? 2.5 : 2);
        curveCmds.push(paint({ color: mono ? "@colors.onSurface" : s.color }, { style: "stroke" }, { strokeWidth: width }, { strokeCap: "round" }, { strokeJoin: "round" }, { alpha: 1 }));
        const dashed = s.dashed || (mono && i > 0 && s.dashed !== false);
        segs.forEach(([sa, sb], k) => {
            const segSpan = sb - sa;
            if (dashed) {
                // dashes: a loop of short lines, each end on the curve
                const nd = Math.max(4, Math.round(40 * segSpan / span));
                const d = segSpan / nd;
                const at = (off) => ({ s: `(${num(sa + off)} + i * ${num(d)})`, n: 5 });
                const p0 = rt.at(at(0)), p1 = rt.at(at(d * 0.55));
                curveCmds.push({ loop: { index: "i", from: 0, until: nd, commands: [{ drawLine: {
                    x1: `${V("cx")} + ${at(0).s} * ${V("kx")}`, y1: `${V("cy")} - ${p0} * ${V("ky")}`,
                    x2: `${V("cx")} + ${at(d * 0.55).s} * ${V("kx")}`, y2: `${V("cy")} - ${p1} * ${V("ky")}` } }] } });
            } else {
                const id = N(`f${i}${segs.length > 1 ? `_${k}` : ""}`);
                curveCmds.push({ pathExpression: { id, expressionX: `${V("cx")} + u * ${V("kx")}`, expressionY: `${V("cy")} - ${rt.u} * ${V("ky")}`,
                    start: num(sa), end: num(sb), count: countFor(s.f, sa, sb, lo, hi), flags: 4 } });
                curveCmds.push({ drawPath: { path: id } });
            }
        });
    });
    cmds.push({ save: { commands: [{ clipRect: { left: L - 2, top: T - 3, right: `${RIGHT} + 2`, bottom: `${BOT} + 3` } }, ...curveCmds] } });

    // ---- marks: a dot on the curve and its coordinates, placed where the curve isn't
    const markText = (m) => {
        if (m.label === false || spec.markLabels === "none") return null;
        if (typeof m.label === "string") return m.label.replace(/\{x\}/g, fmtX(m.x, piMode, decX)).replace(/\{y\}/g, fmt(m.y, decY));
        if (spec.markLabels === "x") return `x = ${fmtX(m.x, piMode, decX)}`;
        return `(${fmtX(m.x, piMode, decX)}, ${fmt(m.y, decY)})`;
    };
    if (marks.length) {
        marks.forEach((m, k) => cmds.push(variable(N(`m${k}x`), xOf(m.x)), variable(N(`m${k}y`), yOf(m.y))));
        const at = (k, ...c) => ({ save: { commands: [{ translate: { dx: V(`m${k}x`), dy: V(`m${k}y`) } }, ...c] } });
        cmds.push(paint({ color: mono ? "@colors.background" : "@colors.surface" }, { style: "fill" }, { alpha: 1 }));
        marks.forEach((m, k) => cmds.push(at(k, { drawCircle: { cx: 0, cy: 0, radius: 6 } })));
        let color = null;
        marks.forEach((m, k) => {
            const c = mono ? "@colors.onSurface" : m.s.color;
            if (c !== color) { cmds.push(paint({ color: c })); color = c; }
            cmds.push(at(k, { drawCircle: { cx: 0, cy: 0, radius: 4 } }));
        });
        // labels: maxima above, minima below, roots beside (in a quadrant the curve leaves free);
        // near a side of the plot a label is aligned to stay inside
        const placed = marks.map((m, k) => ({ m, k, t: markText(m) })).filter((p) => p.t);
        placed.forEach((p) => {
            const { m } = p;
            const h = span * 1e-4, slope = (m.s.f(m.x + h) - m.s.f(m.x - h)) / (2 * h), curv = m.s.f(m.x + h) + m.s.f(m.x - h) - 2 * m.y;
            p.w = p.t.length * CHAR_W;
            const frac = (m.x - a) / span, room = 140;     // a narrow plot, in dp
            p.left = frac * room + L < p.w / 2 + 2;         // would run off the left: align its start
            p.right = (1 - frac) * room + R < p.w / 2 + 2;
            p.up = m.kind === "max" ? true : m.kind === "min" ? false : m.kind === "root" ? slope < 0 : curv <= 0;
            p.beside = m.kind === "root" || m.kind === "cross";
            if (p.beside) { p.toRight = !p.right; if (p.toRight === false) p.up = !p.up; }   // left of the point the free quadrant flips
        });
        // Each label's box (centre offset from its point, in dp) and where it is drawn.
        placed.forEach((p) => {
            if (p.beside) { p.ox = p.toRight ? 7 + p.w / 2 : -7 - p.w / 2; p.oy = p.up ? -12.5 : 12.5; }
            else { p.ox = p.left ? p.w / 2 - 4 : p.right ? 4 - p.w / 2 : 0; p.oy = p.up ? -15.5 : 15.5; }
        });
        // A label hides while it would overlap one drawn before it, at the size the plot has now:
        // their boxes are apart by (Δx·kx + Δox, −Δy·ky + Δoy) dp, tested with step() per frame.
        // Only pairs that can meet at some plot size from 100 to 1000 dp wide get a test.
        const kxs = [100, 1000].map((w) => w / span), kys = [60, 600].map((h) => h / ySpan);
        const canMeet = (A, B, W, [k0, k1]) => { for (let i = 0; i <= 40; i++) { const k = k0 + (k1 - k0) * i / 40; if (Math.abs(A * k + B) < W) return true; } return false; };
        cmds.push(variable(N("big"), `step(${V("ky")}, ${num(70 / ySpan)})`));
        cmds.push(paint({ color: "@colors.onSurface" }, { style: "fill" }, { textSize: TEXT }, { alpha: 1 }));
        let alpha = 1, nh = 0;
        placed.forEach((p, k) => {
            const terms = [];
            // obstacles: the labels drawn before it, and every other mark's dot
            const obstacles = [...placed.slice(0, k).map((q) => ({ m: q.m, ox: q.ox, oy: q.oy, w: q.w, h: 13 })),
                ...marks.filter((m) => m !== p.m).map((m) => ({ m, ox: 0, oy: 0, w: 10, h: 10 }))]
                .sort((q, r) => Math.abs(p.m.x - q.m.x) - Math.abs(p.m.x - r.m.x));
            for (const q of obstacles) {
                if (terms.length >= 3) break;
                const A = p.m.x - q.m.x, B = p.ox - q.ox, W = (p.w + q.w) / 2 + 3;
                const C = -(p.m.y - q.m.y), D = p.oy - q.oy, H = (13 + q.h) / 2 + 1;
                if (!canMeet(A, B, W, kxs) || !canMeet(C, D, H, kys)) continue;
                const lin = (a, b, v) => (Math.abs(a) < 1e-12 ? num(Math.abs(b)) : `abs(${num(a)} * ${v}${Math.abs(b) < 1e-9 ? "" : ` + ${num(b)}`})`);
                const name = N(`h${nh++}`);
                cmds.push(variable(name, `step(${num(W)}, ${lin(A, B, V("kx"))}) * step(${num(H)}, ${lin(C, D, V("ky"))})`));
                terms.push(`@${name}`);
            }
            // and every label hides on a plot under 70 dp tall, where there is no room for any
            const hide = terms.length === 0 ? null : terms.length === 1 ? terms[0] : terms.length === 2 ? `max(${terms.join(", ")})` : `max(${terms[0]}, max(${terms[1]}, ${terms[2]}))`;
            const want = hide ? `${V("big")} * (1 - ${hide})` : V("big");
            if (want !== alpha) { cmds.push(paint({ alpha: want })); alpha = want; }
            let x, y, panX, panY = p.up ? -1 : 1;
            if (p.beside) { x = p.toRight ? 7 : -7; y = p.up ? -6 : 6; panX = p.toRight ? -1 : 1; }
            else { y = p.up ? -9 : 9; x = p.left ? -4 : p.right ? 4 : 0; panX = p.left ? -1 : p.right ? 1 : 0; }
            cmds.push(at(p.k, text(p.t, x, y, panX, panY)));
        });
    }

    // ---- scrub: drag across the plot; a guide, a dot on each curve, the values at the top
    const children = [];
    let readout = null;
    if (scrub) {
        if (!spec.x0) throw new Error("scrub needs the component's x0 local");
        const tName = String(spec.t ?? N("t")).replace(/^@/, "");
        const T0 = spec.scrubAt !== undefined ? value(Array.isArray(spec.scrubAt) ? spec.scrubAt[0] : spec.scrubAt, "scrubAt") : (marks.find((m) => m.kind === "max")?.x ?? marks[0]?.x ?? (a + b) / 2);
        const x0 = `@${String(spec.x0).replace(/^@/, "")}`;
        cmds.unshift({ componentValue: { id: x0, valueType: 4 } },
            { touchExpression: { name: tName, defaultValue: num(T0), min: num(a), max: num(b),
                expression: [`${num(a)} + (touchX() - ${x0} - ${L}) / (componentWidth() - ${L + R}) * ${num(span)}`], touchMode: 6 } });
        const tv = `@${tName}`;
        cmds.push(paint({ color: "@colors.muted" }, { style: "stroke" }, { strokeWidth: 1 }, { alpha: 1 }));
        cmds.push({ drawLine: { x1: `${V("cx")} + ${tv} * ${V("kx")}`, y1: T, x2: `${V("cx")} + ${tv} * ${V("kx")}`, y2: bottom } });
        series.forEach((s) => {
            const rt = runtimeY(s, ctx, a, span, V);
            cmds.push(variable(N(`v${s.i}`), rt.at({ s: tv, n: 1 })));
        });
        for (const s of series.slice(0, 1)) {
            const py = `clamp(${T}, ${bottom}, ${V("cy")} - ${V(`v${s.i}`)} * ${V("ky")})`;
            cmds.push(paint({ color: mono ? "@colors.background" : "@colors.surface" }, { style: "fill" }), { drawCircle: { cx: `${V("cx")} + ${tv} * ${V("kx")}`, cy: py, radius: 7 } });
            cmds.push(paint({ color: mono ? "@colors.onSurface" : s.color }), { drawCircle: { cx: `${V("cx")} + ${tv} * ${V("kx")}`, cy: py, radius: 5 } });
        }
        // readout: exact decimals from whole numbers (textFromFloat misprints x.97)
        const dx = Math.min(decX, 2), dy = Math.min(decY, 3);
        const fx = signedText(tv, dx, N("sx"), cmds), fy = signedText(V("v0"), dy, N("sy"), cmds);
        const name = series[0].label && series.length > 1 ? "y" : "y";
        readout = { type: "textMerge", id1: { type: "textMerge", id1: "x = ", id2: fx }, id2: { type: "textMerge", id1: `    ${name} = `, id2: fy } };
        cmds.push(paint({ color: "@colors.onSurface" }, { style: "fill" }, { textSize: 13 }, { alpha: 1 }));
        cmds.push(text(readout, L, 4, -1, 1));
        cmds.push(paint({ color: "@colors.muted" }, { textSize: TEXT }));
        cmds.push(paint({ alpha: "step(componentWidth(), 280)" }), text("drag", "componentWidth() - 4", 6, 1, 1));
    }

    const desc = spec.label ?? describe(series, dom, marks, piMode, decX, decY, scrub);
    children.push({ canvas: { modifiers: ["fillMaxWidth", spec.fill ? { verticalWeight: 1 } : { height }, { semantics: { contentDescription: desc } }], commands: cmds } });

    // ---- legend: a swatch (solid or dashed) and the formula, per labelled function
    const legend = series.filter((s) => s.label);
    if (legend.length) {
        children.push({ flow: { modifiers: ["fillMaxWidth", { padding: [L, 2, 0, 0] }], horizontalArrangement: "start", children: legend.map((s) => ({
            row: { verticalAlignment: "center", modifiers: [{ padding: [0, 2, 14, 2] }], children: [
                { canvas: { modifiers: [{ width: 18 }, { height: 10 }], commands: [
                    paint({ color: mono ? "@colors.onSurface" : s.color }, { style: "stroke" }, { strokeWidth: 2 }, { strokeCap: "round" }, { alpha: 1 }),
                    ...((s.dashed || (mono && s.i > 0 && s.dashed !== false))
                        ? [{ drawLine: { x1: 1, y1: 5, x2: 6, y2: 5 } }, { drawLine: { x1: 11, y1: 5, x2: 17, y2: 5 } }]
                        : [{ drawLine: { x1: 1, y1: 5, x2: 17, y2: 5 } }])] } },
                { text: { value: s.label, fontSize: 12, color: "@colors.onSurface", maxLines: 1, modifiers: [{ padding: [6, 0, 0, 0] }] } }] },
        })) } });
    }
    return numbers(children.length === 1 ? children[0] : { column: { modifiers: [spec.fill ? "fillMaxSize" : "fillMaxWidth"], children } });
}

// A number written as a string becomes an expression op in the Java parser (13 B, and
// different bytes from json2rc): write literals as numbers.
const NUMERIC = new Set(["start", "end", "defaultValue", "min", "max", "dx", "dy", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "radius", "left", "top", "right", "bottom", "count", "until", "from"]);
function numbers(n, key) {
    if (typeof n === "string" && /^-?\d+(\.\d+)?$/.test(n) && (NUMERIC.has(key) || key === "value#var")) return Number(n);
    if (Array.isArray(n)) return n.map((x) => numbers(x, key));
    if (!n || typeof n !== "object") return n;
    const out = {};
    for (const [k, v] of Object.entries(n)) out[k] = numbers(v, k === "value" && n.name !== undefined && !("type" in n) ? "value#var" : k);
    return out;
}

/**
 * Text for a signed value with `dec` decimals, printed from whole numbers: "−", the integer part
 * and the zero-padded decimals (textFromFloat's own decimals misprint every x.97). Declares the
 * canvas variables it needs into `cmds`.
 */
function signedText(v, dec, name, cmds) {
    // The whole part carries the sign: it is printed with no decimals from a value a quarter
    // past it, so -0.07 prints "-0" (a plain zero would lose its sign) and 4.49 prints "4".
    const p = Math.pow(10, dec);
    cmds.push(variable(`${name}_c`, `round(abs(${v}) * ${p})`));
    const whole = { type: "textFromFloat", value: `(floor(@${name}_c / ${p}) + 0.25) * (1 - 2 * step(0, ${v} + ${num(0.5 / p)}))`, whole: 6, decimal: 0, flags: 5 };
    if (dec === 0) return whole;
    return { type: "textMerge", id1: whole,
        id2: { type: "textMerge", id1: ".", id2: { type: "textFromFloat", value: `@${name}_c % ${p}`, whole: dec, decimal: 0, flags: 12 } } };
}

/**
 * How f is evaluated at run time: {u: infix of the path variable u, at(xs): infix at another x,
 * sampled}. A formula over the path limit (32 entries, with the mapping's 4) is sampled here into
 * a float array read with arraySpline.
 */
function runtimeY(s, ctx, a, span, V) {
    if (s.rt) return s.rt;
    const e = emit(s.ast, "u", 1);
    if (e.n + 4 <= 32) {
        s.rt = { u: e.s, at: (xs) => { const r = emit(s.ast, xs.s, xs.n); return r.n + 4 <= 32 ? r.s : sampledAt(xs.s); }, sampled: false };
        // a long x (a dash's "a + i * d") can push an inline copy over the limit: sample then
        const sampledAt = (xs) => { const arr = arrFor(); return `arraySpline(${arr}, (${xs} - ${num(a)}) * ${num(1 / span)})`; };
        let arrId = null;
        const arrFor = () => (arrId ??= ctx.floatArray(`mp_${s.i}`, sampleArray(s.f, a, span)));
        return s.rt;
    }
    const arr = ctx.floatArray(`mp_${s.i}`, sampleArray(s.f, a, span));
    const at = (xs) => `arraySpline(${arr}, (${xs.s} - ${num(a)}) * ${num(1 / span)})`;
    s.rt = { u: at({ s: "u" }), at, sampled: true };
    return s.rt;
}
function sampleArray(f, a, span, n = 161) {
    const out = [];
    for (let i = 0; i < n; i++) { const y = f(a + span * i / (n - 1)); out.push(Number.isFinite(y) ? Number(y.toPrecision(6)) : 0); }
    return out;
}

/** The domain split at poles and gaps (sqrt of a negative), so no line joins the two sides. */
export function segments(f, a, b, lo, hi, n = 2000) {
    const { xs, ys } = samples(f, a, b, n);
    const big = 4 * (hi - lo);
    const segs = [];
    let start = null;
    for (let i = 0; i <= n; i++) {
        const ok = Number.isFinite(ys[i]);
        if (ok && start === null) start = i === 0 ? a : refineEdge(f, xs[i - 1], xs[i]);
        const jump = ok && i < n && Number.isFinite(ys[i + 1]) && Math.sign(ys[i]) !== Math.sign(ys[i + 1]) && Math.abs(ys[i + 1] - ys[i]) > big;
        if (start !== null && (!ok || jump || i === n)) {
            let end;
            if (!ok) end = refineEdge(f, xs[i], xs[i - 1]);
            else if (jump) {
                // a pole between xs[i] and xs[i+1]: stop just short of it, where the curve is far off the plot
                let p = xs[i], q = xs[i + 1];
                for (let k = 0; k < 60; k++) { const m = (p + q) / 2; if (Math.sign(f(m)) === Math.sign(ys[i])) p = m; else q = m; }
                // stop where the curve is well off the plot (|f| = cap), not at the pole itself:
                // a float32 end a hair past the pole would read the other side's huge value
                const cap = Math.max(Math.abs(hi), Math.abs(lo)) + 2 * (hi - lo);
                const reach = (from, pole, dir) => {     // dir: -1 walks left from the pole, +1 right
                    let g = from, h = -dir * Math.max(Math.abs(pole - from), (b - a) * 1e-9);
                    for (let k = 0; k < 60 && Math.abs(f(g)) > cap && Math.abs(g - pole) < (b - a) * 0.05; k++) g -= h, h *= 2;
                    let near = pole;
                    for (let k = 0; k < 60; k++) { const m = (g + near) / 2; if (Math.abs(f(m)) < cap) g = m; else near = m; }
                    return near;
                };
                end = reach(xs[i], p, -1);
                if (end > start) segs.push([start, end]);
                start = reach(xs[i + 1], q, 1);
                continue;
            } else end = b;
            if (end > start) segs.push([start, end]);
            start = null;
        }
    }
    return segs.length ? segs : [[a, b]];
}
/** The x nearest `bad` where f is still finite, between good and bad. */
function refineEdge(f, good, bad) {
    for (let k = 0; k < 50; k++) { const m = (good + bad) / 2; if (Number.isFinite(f(m))) good = m; else bad = m; }
    return good;
}

/** Path samples: enough straight pieces to stay within half a dp of the curve on an 800×400 plot. */
function countFor(f, a, b, lo, hi) {
    const kx = 800 / (b - a), ky = 400 / (hi - lo);
    let n = 32;
    for (; n < 400; n = Math.round(n * 1.5)) {
        let err = 0;
        for (let i = 0; i < n - 1; i++) {
            const x0 = a + (b - a) * i / (n - 1), x1 = a + (b - a) * (i + 1) / (n - 1), xm = (x0 + x1) / 2;
            const ym = (f(x0) + f(x1)) / 2, yt = f(xm);
            const y0c = Math.max(lo, Math.min(hi, ym)), ytc = Math.max(lo, Math.min(hi, yt));
            if (Number.isFinite(ym) && Number.isFinite(yt)) err = Math.max(err, Math.abs(ytc - y0c) * ky);
        }
        void kx;
        if (err < 0.5) break;
    }
    return Math.min(n, 400);
}

function describe(series, dom, marks, piMode, decX, decY, scrub) {
    const fs = series.map((s) => s.label ?? pretty(s.src)).join(", ");
    const xs = dom.map((v) => (typeof v === "string" ? pretty(v) : fmt(v, 3))).join(" to ");
    const kinds = { root: "roots", max: "maxima", min: "minima", yint: "y-intercept", cross: "intersections", at: "points" };
    const parts = Object.entries(kinds).map(([k, name]) => {
        const ms = marks.filter((m) => m.kind === k);
        return ms.length ? `${name} at ${ms.map((m) => `(${fmtX(m.x, piMode, decX)}, ${fmt(m.y, decY)})`).join(", ")}` : null;
    }).filter(Boolean);
    return `Graph of ${fs} for x from ${xs}${parts.length ? `; ${parts.join("; ")}` : ""}${scrub ? "; drag across it to read values" : ""}`;
}
