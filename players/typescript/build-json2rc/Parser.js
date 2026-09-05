"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Parser = exports.DeferredVariables = exports.NotImplementedComponent = void 0;
exports.parseColor = parseColor;
exports.parseHAlign = parseHAlign;
exports.parseVAlign = parseVAlign;
exports.hAlignOf = hAlignOf;
exports.vAlignOf = vAlignOf;
exports.parseTextAlign = parseTextAlign;
exports.normalizeComponent = normalizeComponent;
exports.decodeBase64 = decodeBase64;
exports.parseSvgPath = parseSvgPath;
exports.unwrap = unwrap;
exports.convert = convert;
/**
 * JSON -> RemoteCompose, ported from `rcj/parser.py`.
 *
 * The reference for this port is rcj, which is itself verified byte-identical against the
 * Java `RemoteComposeJsonParser`. So correctness here means: the same JSON in, the same bytes
 * out, and `tools/compare_rcj.py` checks exactly that against the corpus.
 */
const Writer_1 = require("./Writer");
const WireBuffer_1 = require("./WireBuffer");
const Header_1 = require("./Header");
const Expr_1 = require("./Expr");
class NotImplementedComponent extends Error {
    // An empty `extends Error` inherits `name` from Error.prototype, so `e.name` reads
    // "Error" and a deliberate refusal is indistinguishable from a crash. The harness
    // splits those two buckets on exactly this field.
    constructor(message) { super(message); this.name = "NotImplementedComponent"; }
}
exports.NotImplementedComponent = NotImplementedComponent;
/** Map of materialised variables, plus declarations waiting to be emitted at first use. */
class DeferredVariables {
    constructor() {
        this.materialised = new Map();
        this.deferred = new Map();
        this.resolver = null;
    }
    defer(name, command) { this.deferred.set(name, command); }
    /** Only variables already written — a deferred entry is invisible here, which is what
     *  lets a later declaration of the same name replace a pending one. */
    isMaterialised(name) { return this.materialised.has(name); }
    set(name, bits) { this.materialised.set(name, bits); }
    remove(name) { this.materialised.delete(name); this.deferred.delete(name); }
    has(name) {
        return this.materialised.has(name) || this.deferred.has(name);
    }
    get(name) {
        const hit = this.materialised.get(name);
        if (hit !== undefined)
            return hit;
        const pending = this.deferred.get(name);
        if (pending === undefined || !this.resolver)
            return undefined;
        this.deferred.delete(name);
        const bits = this.resolver(name, pending);
        this.materialised.set(name, bits);
        return bits;
    }
}
exports.DeferredVariables = DeferredVariables;
function toInt32(v) { return v | 0; }
function parseColor(value) {
    if (typeof value === "number")
        return toInt32(value);
    if (typeof value === "string") {
        let s = value.trim();
        if (s.startsWith("#"))
            s = s.slice(1);
        let v = parseInt(s, 16);
        // A 6-digit colour is opaque; only 8 digits carry their own alpha.
        if (s.length <= 7)
            v = (v | 0xff000000) >>> 0;
        return toInt32(v);
    }
    throw new NotImplementedComponent(`parse_color: unsupported ${typeof value}`);
}
const H_ALIGN = { start: 1, center: 2, end: 3, spacebetween: 6, spaceevenly: 7, spacearound: 8 };
const V_ALIGN = { start: 1, top: 4, center: 2, bottom: 5, spacebetween: 6, spaceevenly: 7, spacearound: 8 };
const TEXT_ALIGN = { left: 1, "1": 1, right: 2, "2": 2, center: 3, "3": 3, justify: 4, "4": 4,
    start: 5, "5": 5 };
const OVERFLOW = { clip: 1, ellipsis: 3, visible: 2, start_ellipsis: 4, middle_ellipsis: 5 };
function parseHAlign(a) { return H_ALIGN[a.toLowerCase()] ?? 1; }
function parseVAlign(a) { return V_ALIGN[a.toLowerCase()] ?? 4; }
/**
 * `horizontalAlignment`, else `horizontalArrangement`, else the default.
 *
 * A row spells its main-axis distribution `horizontalArrangement`, matching Compose.
 * Reading only the `*Alignment` key made `spaceAround` fall through to START — a document
 * that converted, drew, and packed its children to one edge.
 */
function hAlignOf(c, dflt) {
    return parseHAlign(String(c.horizontalAlignment ?? c.horizontalArrangement ?? dflt));
}
function vAlignOf(c, dflt) {
    return parseVAlign(String(c.verticalAlignment ?? c.verticalArrangement ?? dflt));
}
function parseTextAlign(a) { return TEXT_ALIGN[a.toLowerCase()] ?? 5; }
/** `{"column": {...}}` is shorthand for `{"type": "column", ...}`. */
function normalizeComponent(c) {
    if (!("type" in c) && Object.keys(c).length === 1) {
        const key = Object.keys(c)[0];
        const val = c[key];
        const out = { type: key };
        if (Array.isArray(val))
            out.children = val;
        else if (val && typeof val === "object")
            Object.assign(out, val);
        return out;
    }
    return c;
}
const INT_MAX = 2147483647;
const NAN_BITS = 0x7fc00000;
const FIRST_PASS_TYPES = new Set(["resources", "variable", "global",
    "definepattern", "referencedoperations"]);
const PATH_MOVE = 10, PATH_LINE = 11, PATH_QUAD = 12, PATH_CUBIC = 14, PATH_CLOSE = 15;
const SVG_SPLIT = /(?=[MmZzLlHhVvCcSsQqTtAa])/;
const SVG_SEP = /[,\s]+/;
const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/**
 * Decode base64 to bytes without `atob` or `Buffer`, so the converter still runs anywhere.
 * Whitespace and a `data:` prefix are tolerated, since both turn up in hand-written JSON.
 */
function decodeBase64(input) {
    let str = input.trim();
    const comma = str.startsWith("data:") ? str.indexOf(",") : -1;
    if (comma >= 0)
        str = str.slice(comma + 1);
    str = str.replace(/[\s]/g, "");
    str = str.replace(/-/g, "+").replace(/_/g, "/"); // url-safe variant
    let end = str.length;
    while (end > 0 && str[end - 1] === "=")
        end--;
    const out = new Uint8Array(Math.floor((end * 3) / 4));
    let acc = 0, bits = 0, o = 0;
    for (let i = 0; i < end; i++) {
        const v = B64_ALPHABET.indexOf(str[i]);
        if (v < 0)
            throw new NotImplementedComponent(`bad base64 character '${str[i]}'`);
        acc = (acc << 6) | v;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out[o++] = (acc >> bits) & 0xff;
        }
    }
    return out.subarray(0, o);
}
/**
 * Width and height from a PNG's IHDR.
 *
 * Read rather than declared: the wire format needs the real dimensions, and an author who
 * has to restate them will eventually restate them wrongly — the image would then sample
 * against the wrong grid with nothing to indicate why.
 */
function pngSize(data) {
    const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const ihdrOk = data.length >= 24
        && SIG.every((b, i) => data[i] === b)
        && data[12] === 0x49 && data[13] === 0x48 && data[14] === 0x44 && data[15] === 0x52;
    if (!ihdrOk) {
        throw new NotImplementedComponent("bitmap: only PNG is supported, and this does not start with a PNG header");
    }
    const be = (o) => ((data[o] << 24) | (data[o + 1] << 16) | (data[o + 2] << 8) | data[o + 3]) >>> 0;
    return [be(16), be(20)];
}
/**
 * Decompose an elliptical arc into cubic segments — a port of PathParser.arcTo.
 *
 * The player has no arc primitive and never will, so arcs are lowered here at authoring
 * time. Everything stays in double and is narrowed to float32 only at the emitted control
 * points, matching the Java: narrowing earlier moves them. `Math.fround` is not cosmetic
 * even though the values are written as float32 anyway — the narrowed endpoint becomes the
 * *start point* of the next segment, so rounding it late changes later geometry.
 *
 * Returns [cp1x, cp1y, cp2x, cp2y, xend, yend] per segment.
 */
function arcToCubics(x0, y0, rx, ry, angle, largeArc, sweep, x1, y1) {
    if (rx === 0 || ry === 0)
        return []; // caller emits a line instead
    const alpha = angle * Math.PI / 180.0;
    const cosA = Math.cos(alpha), sinA = Math.sin(alpha);
    const dx = (x0 - x1) / 2.0, dy = (y0 - y1) / 2.0;
    const x1p = cosA * dx + sinA * dy;
    const y1p = -sinA * dx + cosA * dy;
    let rxp = Math.abs(rx), ryp = Math.abs(ry);
    const check = (x1p * x1p) / (rxp * rxp) + (y1p * y1p) / (ryp * ryp);
    if (check > 1.0) {
        const sc = Math.sqrt(check);
        rxp *= sc;
        ryp *= sc;
    }
    const sign = largeArc === sweep ? -1.0 : 1.0;
    const numerator = (rxp * rxp * ryp * ryp) - (rxp * rxp * y1p * y1p) - (ryp * ryp * x1p * x1p);
    const denominator = (rxp * rxp * y1p * y1p) + (ryp * ryp * x1p * x1p);
    const root = Math.sqrt(Math.max(0.0, numerator / denominator));
    const cxp = sign * root * rxp * y1p / ryp;
    const cyp = -sign * root * ryp * x1p / rxp;
    const cx = cosA * cxp - sinA * cyp + (x0 + x1) / 2.0;
    const cy = sinA * cxp + cosA * cyp + (y0 + y1) / 2.0;
    const theta1 = Math.atan2((y1p - cyp) / ryp, (x1p - cxp) / rxp);
    let dTheta = Math.atan2((-y1p - cyp) / ryp, (-x1p - cxp) / rxp) - theta1;
    if (sweep && dTheta < 0)
        dTheta += 2 * Math.PI;
    else if (!sweep && dTheta > 0)
        dTheta -= 2 * Math.PI;
    const segments = Math.ceil(Math.abs(dTheta) / (Math.PI / 2.0)) || 1;
    const out = [];
    for (let i = 0; i < segments; i++) {
        const s1 = theta1 + i * dTheta / segments;
        const s2 = theta1 + (i + 1) * dTheta / segments;
        const t = 4.0 / 3.0 * Math.tan((s2 - s1) / 4.0);
        const xstart = cosA * rxp * Math.cos(s1) - sinA * ryp * Math.sin(s1) + cx;
        const ystart = sinA * rxp * Math.cos(s1) + cosA * ryp * Math.sin(s1) + cy;
        const xend = cosA * rxp * Math.cos(s2) - sinA * ryp * Math.sin(s2) + cx;
        const yend = sinA * rxp * Math.cos(s2) + cosA * ryp * Math.sin(s2) + cy;
        const cp1x = xstart + t * (-cosA * rxp * Math.sin(s1) - sinA * ryp * Math.cos(s1));
        const cp1y = ystart + t * (-sinA * rxp * Math.sin(s1) + cosA * ryp * Math.cos(s1));
        const cp2x = xend - t * (-cosA * rxp * Math.sin(s2) - sinA * ryp * Math.cos(s2));
        const cp2y = yend - t * (-sinA * rxp * Math.sin(s2) + cosA * ryp * Math.cos(s2));
        out.push([Math.fround(cp1x), Math.fround(cp1y), Math.fround(cp2x), Math.fround(cp2y),
            Math.fround(xend), Math.fround(yend)]);
    }
    return out;
}
/**
 * SVG path string -> the RC path array. Verb tags are NaN-boxed; coordinates are floats.
 *
 * Each segment carries its own start point, which is why the current point is tracked
 * separately from `cords` — `cords` is the *last two values written*, used by H/V/S, and it
 * deliberately is not updated for Z or H, matching the reference.
 *
 * Arcs (A/a) are lowered to cubics here — see arcToCubics. Only the endpoint of a lowercase
 * `a` is relative; the radii, rotation and flags are not.
 */
function parseSvgPath(pathData) {
    const out = [];
    const cords = [0, 0, 0, 0, 0, 0];
    let cx = 0, cy = 0, sx = 0, sy = 0;
    const verb = (tag) => out.push({ bits: (tag | 0xff800000) >>> 0 });
    for (const seg of pathData.split(SVG_SPLIT)) {
        if (!seg || !/[A-Za-z]/.test(seg[0]))
            continue;
        const cmd = seg[0];
        const rest = seg.slice(1).trim();
        const values = rest ? rest.split(SVG_SEP).filter(Boolean).map(Number) : [];
        if (cmd === "M") {
            if (values.length < 2)
                throw new NotImplementedComponent(`SVG 'M' needs 2 values`);
            verb(PATH_MOVE);
            out.push(values[0], values[1]);
            cx = values[0];
            cy = values[1];
            sx = cx;
            sy = cy;
        }
        else if (cmd === "L") {
            for (let i = 0; i + 1 < values.length; i += 2) {
                verb(PATH_LINE);
                out.push(cx, cy, values[i], values[i + 1]);
                cx = values[i];
                cy = values[i + 1];
            }
        }
        else if (cmd === "H") {
            for (const v of values) {
                verb(PATH_LINE);
                out.push(cx, cy, v, cords[1]);
                cx = v;
                cy = cords[1];
            }
        }
        else if (cmd === "V") {
            for (const v of values) {
                verb(PATH_LINE);
                out.push(cx, cy, cords[0], v);
                cx = cords[0];
                cy = v;
            }
        }
        else if (cmd === "C") {
            for (let i = 0; i + 5 < values.length; i += 6) {
                verb(PATH_CUBIC);
                out.push(cx, cy, values[i], values[i + 1], values[i + 2], values[i + 3], values[i + 4], values[i + 5]);
                cx = values[i + 4];
                cy = values[i + 5];
            }
        }
        else if (cmd === "Q") {
            for (let i = 0; i + 3 < values.length; i += 4) {
                verb(PATH_QUAD);
                out.push(cx, cy, values[i], values[i + 1], values[i + 2], values[i + 3]);
                cx = values[i + 2];
                cy = values[i + 3];
            }
        }
        else if (cmd === "S") {
            for (let i = 0; i + 3 < values.length; i += 4) {
                verb(PATH_CUBIC);
                out.push(cx, cy, 2 * cords[0] - cords[2], 2 * cords[1] - cords[3], values[i], values[i + 1], values[i + 2], values[i + 3]);
                cx = values[i + 2];
                cy = values[i + 3];
            }
        }
        else if (cmd === "A" || cmd === "a") {
            for (let i = 0; i + 6 < values.length; i += 7) {
                const rx = values[i], ry = values[i + 1], ang = values[i + 2];
                const largeArc = values[i + 3] !== 0.0;
                const swp = values[i + 4] !== 0.0;
                let ex = values[i + 5], ey = values[i + 6];
                if (cmd === "a") {
                    ex += cx;
                    ey += cy;
                } // only the endpoint is relative
                const segs = arcToCubics(cx, cy, rx, ry, ang, largeArc, swp, ex, ey);
                if (!segs.length) { // zero radius degenerates to a line
                    verb(PATH_LINE);
                    out.push(cx, cy, ex, ey);
                    cx = ex;
                    cy = ey;
                    continue;
                }
                for (const [c1x, c1y, c2x, c2y, xe, ye] of segs) {
                    verb(PATH_CUBIC);
                    out.push(cx, cy, c1x, c1y, c2x, c2y, xe, ye);
                    cx = xe;
                    cy = ye;
                }
            }
        }
        else if (cmd === "Z" || cmd === "z") {
            verb(PATH_CLOSE);
            cx = sx;
            cy = sy;
        }
        else {
            throw new NotImplementedComponent(`SVG path command '${cmd}' is not supported by the platform parser `
                + `(only M L H V C Q S A Z)`);
        }
        if (cmd !== "Z" && cmd !== "H" && values.length >= 2) {
            cords[0] = values[values.length - 2];
            cords[1] = values[values.length - 1];
            if ((cmd === "C" || cmd === "S") && values.length >= 4) {
                cords[2] = values[values.length - 4];
                cords[3] = values[values.length - 3];
            }
        }
    }
    return out;
}
/** A resource section is either {name: value} or [{name: value}, ...]. */
/**
 * The three accepted resource shapes, mirroring ResourceParser.parseOrderedResource:
 * tag-key array `[{name: value}]`, verbose array `[{"name": n, "value": v}]`, and
 * map `{name: value}`.
 *
 * The verbose form is not just an alias: an array entry that carries a `name` key, or one
 * with more than a single key, is read as verbose. Treating every key of every entry as its
 * own resource — which is what this used to do — turned `{"name": "tex", "value": {...}}`
 * into two resources called `name` and `value`, and the first of them tried to open a file
 * called "tex".
 */
function* eachResource(section) {
    const dictCfg = (v) => v && typeof v === "object" && !Array.isArray(v) ? v : null;
    if (Array.isArray(section)) {
        for (const entry of section) {
            const keys = Object.keys(entry);
            if (!("name" in entry) && keys.length === 1) {
                const name = keys[0];
                yield [name, dictCfg(entry[name]), entry[name]];
            }
            else {
                yield [String(entry.name), entry, entry.value];
            }
        }
        return;
    }
    for (const [name, value] of Object.entries(section)) {
        yield [name, dictCfg(value), value];
    }
}
/** PaintBundle command ids (PaintBundle.java). */
const PB = { TEXT_SIZE: 1, COLOR: 4, STROKE_WIDTH: 5, STROKE_CAP: 7, STYLE: 8,
    SHADER: 9, ALPHA: 12, STROKE_JOIN: 15, COLOR_ID: 19 };
const STYLE = { fill: 0, stroke: 1, fillandstroke: 2 };
/**
 * The direct-key paint form emits in a FIXED order, not the order the keys appear in the
 * JSON. Using insertion order put strokeCap before style and silently reordered the bundle.
 */
/**
 * The getDouble path: numeric only, straight to float32 bits — never an expression.
 *
 * A non-numeric value raises rather than becoming NaN. `Number("2+2")` is NaN where Python's
 * `float("2+2")` raises, so without this a padding or weight written as an expression would
 * silently emit NaN in the fields the reference refuses to accept at all. `"2"` is still
 * fine, and still means 2.0 — the reference accepts that too.
 */
function numBits(value) {
    const n = Number(value);
    if (Number.isNaN(n) && String(value).trim().toLowerCase() !== "nan") {
        throw new NotImplementedComponent(`expected a number, got ${JSON.stringify(value)} `
            + "(this field takes no expression)");
    }
    return (0, WireBuffer_1.floatToRawIntBits)(n);
}
// ── 3D tables ────────────────────────────────────────────────────────────────
const PROJECTION = { perspective: 0, ortho: 1, orthographic: 1 };
const MATRIX_SUB = { identity: 0, translate: 1, scale: 2, rotate: 3, multiply: 4 };
const LIGHT_TYPE = { directional: 0, dir: 0, point: 1 };
const SURFACE = { general: 0, heightfield: 1, sphere: 2, cylinder: 3 };
const P3_CLEAR_DEPTH = 0, P3_MATERIAL = 1, P3_DEPTH_BIAS = 2;
/** Render modes are (backend << 1) | smoothBit. */
const MESH_MODE = {
    "software-flat": 0, "software-smooth": 1, "canvas-flat": 2, "canvas-smooth": 3,
    "drawmesh-flat": 4, "drawmesh-smooth": 5, "gl-flat": 6, "gl-smooth": 7,
    "drawmesh-zbuf-flat": 8, "drawmesh-zbuf-smooth": 9,
    "canvas-zbuf-flat": 10, "canvas-zbuf-smooth": 11,
    flat: 0, smooth: 1,
};
const MODE_WIREFRAME = 0x100;
const WIRE_EDGE = [0x200, 0x400, 0x800];
const PRIMITIVE = {
    sphere: 0, cylinder: 1, cone: 2, cube: 3, roundedcube: 4,
    sphericalsector: 5, sphericaldome: 6, tube: 7, captube: 8, profiletube: 9,
    torus: 10, plane: 11,
    extrudecircle: 12, extrudesector: 13, extrudesegment: 14, extrudearc: 15,
    extruderoundedrect: 16, extrudesquircle: 17, extrudepath: 18,
    lathe: 19, sweep: 20, helix: 21, icosphere: 22,
};
/** Named parameter order per primitive; `center`/`from`/`to` expand to three values. */
const PRIMITIVE_PARAMS = {
    sphere: ["radius", "center"],
    cylinder: ["radius", "from", "to"],
    cone: ["radius", "height", "center"],
    cube: ["dimX", "dimY", "dimZ", "center"],
    roundedcube: ["dimX", "dimY", "dimZ", "center", "cornerRadius"],
    sphericalsector: ["radius", "angle", "center"],
    sphericaldome: ["radius", "angle", "center"],
    torus: ["majorRadius", "minorRadius", "center"],
    plane: ["width", "height", "center"],
    extrudecircle: ["radius", "depth", "center"],
    extrudesector: ["radius", "startAngle", "sweepAngle", "depth", "center"],
    extrudesegment: ["radius", "startAngle", "sweepAngle", "depth", "center"],
    extrudearc: ["innerRadius", "outerRadius", "startAngle", "sweepAngle", "depth", "center"],
    extruderoundedrect: ["width", "height", "cornerRadius", "depth", "center"],
    extrudesquircle: ["radius", "exponent", "depth", "center"],
    icosphere: ["radius", "center"],
    lathe: ["center"],
    helix: ["coilRadius", "tubeRadius", "pitch", "turns", "center"],
};
/** UV generation mode lives in flags bits 4-5. */
const UV_MODE = { none: 0, uv: 1, uv2: 2, uv3: 3 };
const FLAG_SPLINE = 0x1, FLAG_TUBE_LEGACY = 0x2, FLAG_TUBE_PATH_DENSITY = 0x4, FLAG_TUBE_CAP = 0x8;
const TOUCH_STOP = {
    gently: 0, instantly: 1, ends: 2, notcheseven: 3, notchespercents: 4,
    notchesabsolute: 5, absolutepos: 6, notchessingleeven: 7,
};
/**
 * Vector-only opcodes, injected into the expression compiler for a vectorExpression and
 * nowhere else — the scalar evaluator does not implement OFFSET+100.., so a `dot()` in an
 * ordinary expression should fail at build time rather than at run time.
 */
const VECTOR_FUNCTIONS = {
    vec2: 100, vec3: 101, vec4: 102,
    dot: 103, cross: 104, length: 105, lengthSq: 106, normalize: 107,
};
const VECTOR_COMPONENTS = ["x", "y", "z", "w"];
/**
 * VAR1/VAR2 are how the player feeds grid coordinates into a mesh expression. They are bound
 * to `u`/`v` only while one is compiled, so they cannot shadow a document's own variables.
 */
const VAR1_BITS = (0xff800000 | (0x310000 + 70)) >>> 0;
const VAR2_BITS = (0xff800000 | (0x310000 + 71)) >>> 0;
const PB_GRADIENT = 11, GRAD_LINEAR = 0, GRAD_SWEEP = 2;
const PAINT_KEYS_ORDER = ["shader", "color", "strokeJoin", "strokeCap", "style", "width",
    "textSize", "sweepGradient"];
const PAINT_KEY_ALIASES = { strokewidth: "width", runtimeshader: "shader" };
/**
 * `linearGradient` is in PAINT_KEYS_IGNORED because the reference ignores it *as a direct
 * key* — inside an `ops` array it is honoured. The two lists are not in conflict.
 */
/** Accepted as direct keys but ignored by the reference — fail loudly rather than lose them. */
const PAINT_KEYS_IGNORED = ["linearGradient", "pathEffect", "alpha"];
const CAP = { round: 1, square: 2 }; // else butt(0)
const JOIN = { round: 1, bevel: 2 }; // else miter(0)
class Parser {
    constructor(options = {}) {
        /**
         * name -> NaN-boxed id bits, shared with the expression compiler.
         *
         * A float variable declared outside the first pass and without commit/flush is
         * *deferred*: nothing is written where it appears, and its ops are emitted at first
         * use. That placement is not cosmetic — a definition emitted inside a canvas lands in
         * the draw stream, so hoisting or sinking it changes what the document draws.
         */
        this.variables = new DeferredVariables();
        this.colors = new Map();
        this.paths = new Map();
        this.bitmaps = new Map();
        this.profiles = 0;
        this.apiLevel = 7;
        this.inFirstPass = false;
        this.readFile = options.readFile;
    }
    /** Resolve a canvas float field to raw float32 bits (literal, ref or expression). */
    fbits(value) {
        if (value === null || value === undefined)
            return NAN_BITS;
        if (typeof value === "boolean")
            return (0, WireBuffer_1.floatToRawIntBits)(value ? 1 : 0);
        if (typeof value === "number")
            return (0, WireBuffer_1.floatToRawIntBits)(value);
        if (typeof value === "string") {
            const special = { NaN: 0x7fc00000, Infinity: 0x7f800000, "-Infinity": 0xff800000 };
            if (value in special)
                return special[value] >>> 0;
            if (value === "max")
                return (0, WireBuffer_1.floatToRawIntBits)(3.4028234663852886e38);
            // Anything else is an expression: a bare variable reference resolves to its id,
            // otherwise it is compiled and the *result* id comes back NaN-boxed.
            if (this.expr.isVariable(value))
                return this.expr.variableNanBits(value);
            return this.expr.parseExpression(value);
        }
        if (value && typeof value === "object")
            return this.expr.parseExpression(value);
        throw new NotImplementedComponent(`float field type ${typeof value}`);
    }
    parse(doc) {
        const header = doc.header ?? {};
        this.profiles = Number(header.profiles ?? 0);
        const apiLevel = Number(header.apiLevel ?? 7);
        if (apiLevel < 7) {
            // A refusal, not a crash: apiLevel < 7 changes container encodings, and
            // guessing would produce a document no reference run could confirm.
            throw new NotImplementedComponent(`apiLevel ${apiLevel}: only apiLevel >= 7 is implemented`);
        }
        this.apiLevel = apiLevel;
        const tags = [];
        for (const [key, value] of Object.entries(header)) {
            if (key === "apiLevel" || key === "orderedResources")
                continue;
            const tag = Header_1.HEADER_KEY_TO_TAG[key];
            if (tag === undefined)
                throw new NotImplementedComponent(`Unknown header tag: ${key}`);
            tags.push([tag, value]);
        }
        this.writer = new Writer_1.Writer(apiLevel, tags);
        this.expr = new Expr_1.ExpressionParser(this.writer, this.variables);
        // First use of a deferred variable materialises it, wherever that happens to be.
        this.variables.resolver = (_name, cmd) => this.materialiseFloatVar(cmd);
        if (doc.resources) {
            this.inFirstPass = true;
            this.parseResources(doc.resources);
            this.inFirstPass = false;
        }
        const root = doc.root;
        if (root === undefined || root === null)
            return this.writer.encodeToByteArray();
        const items = (Array.isArray(root) ? root : [root]).map(normalizeComponent);
        // The root op carries its children directly — there is no content op under it, and
        // it closes with a single ContainerEnd. (A column *does* get a content op; the root
        // does not, and getting that wrong shifts every component id by one.)
        // Pass 1: resources, variables and global blocks, so their ids come first.
        this.inFirstPass = true;
        for (const item of items) {
            if (FIRST_PASS_TYPES.has(String(item.type ?? "").toLowerCase())) {
                this.parseComponent(item);
            }
        }
        this.inFirstPass = false;
        this.writer.rootStart();
        for (const item of items) {
            const t = String(item.type ?? "").toLowerCase();
            if (t === "resources" || t === "variable")
                continue;
            this.parseComponent(item);
        }
        this.writer.containerEnd();
        return this.writer.encodeToByteArray();
    }
    parseModifiers(raw) {
        const out = [];
        for (const mod of raw ?? []) {
            // A modifier is either a bare string ("fillMaxSize") or a single-key object.
            // A bare "fillMaxSize" is the same as {"fillMaxSize": "NaN"} — the value field
            // is a NaN sentinel, not 1.0. Using 1.0 produced a plausible document whose
            // width modifier said "exactly 1 pixel" in the value slot.
            const entries = typeof mod === "string" ? [[mod, "NaN"]] : Object.entries(mod);
            for (const [key, value] of entries) {
                const k = key.toLowerCase();
                if (k === "fillmaxsize") {
                    const v = this.fbits(value);
                    out.push((0, Writer_1.modWidth)(Writer_1.TYPE_FILL, v), (0, Writer_1.modHeight)(Writer_1.TYPE_FILL, v));
                }
                else if (k === "fillmaxwidth") {
                    out.push((0, Writer_1.modWidth)(Writer_1.TYPE_FILL, this.fbits(value)));
                }
                else if (k === "fillmaxheight") {
                    out.push((0, Writer_1.modHeight)(Writer_1.TYPE_FILL, this.fbits(value)));
                }
                else if (k === "width") {
                    out.push((0, Writer_1.modWidth)(Writer_1.TYPE_EXACT, this.fbits(value)));
                }
                else if (k === "height") {
                    out.push((0, Writer_1.modHeight)(Writer_1.TYPE_EXACT, this.fbits(value)));
                }
                else if (k === "background") {
                    if (typeof value !== "string") {
                        throw new NotImplementedComponent("background non-string");
                    }
                    // Any reference form takes the by-id modifier, not a literal colour.
                    out.push(value.startsWith("$") || value.startsWith("@")
                        ? (0, Writer_1.modBackgroundId)(this.resolveColor(value))
                        : (0, Writer_1.modBackground)(parseColor(value)));
                }
                else if (k === "border") {
                    const b = (value ?? {});
                    out.push((0, Writer_1.modBorder)(Number(b.width), Number(b.cornerRadius), this.resolveColor(b.color), Math.trunc(Number(b.shape ?? 0))));
                }
                else if (k === "verticalscroll" || k === "horizontalscroll") {
                    // verticalScroll emits *two* modifiers: a clip to the component's bounds,
                    // then the scroll itself. The clip is what stops scrolled content drawing
                    // outside its container, and the reference adds it in the same call.
                    const direction = k === "verticalscroll" ? 0 : 1;
                    let position = value;
                    if (value && typeof value === "object" && !Array.isArray(value)) {
                        const spec = value;
                        if (Math.trunc(Number(spec.notches ?? 0)) > 0) {
                            throw new NotImplementedComponent("scroll notches TBD");
                        }
                        position = spec.position ?? 0;
                    }
                    out.push((0, Writer_1.modClipRect)(), (0, Writer_1.modScroll)(direction, this.fbits(position)));
                }
                else if (k === "visibility") {
                    // A variable id, not a boolean: the document flips the variable and
                    // everything bound to it appears or disappears.
                    out.push((0, Writer_1.modVisibility)(this.resolveId(value)));
                }
                else if (k === "clip") {
                    const shape = (value ?? {});
                    const st = String(shape.type ?? "").toLowerCase();
                    if (st !== "roundrect" && st !== "roundedrect") {
                        throw new NotImplementedComponent(`clip shape '${st}' (circle/rect TBD)`);
                    }
                    if ("radius" in shape) {
                        const r = Number(shape.radius);
                        out.push((0, Writer_1.modClipRoundedRect)(r, r, r, r));
                    }
                    else {
                        out.push((0, Writer_1.modClipRoundedRect)(Number(shape.topStart ?? 0), Number(shape.topEnd ?? 0), Number(shape.bottomStart ?? 0), Number(shape.bottomEnd ?? 0)));
                    }
                }
                else if (k === "size") {
                    // `[w, h]` is a pair, and goes through getDouble rather than parseFloat,
                    // so neither element may be an expression. A scalar covers both axes.
                    if (Array.isArray(value)) {
                        out.push((0, Writer_1.modWidth)(Writer_1.TYPE_EXACT, numBits(value[0])), (0, Writer_1.modHeight)(Writer_1.TYPE_EXACT, numBits(value[1])));
                    }
                    else {
                        const v = this.fbits(value);
                        out.push((0, Writer_1.modWidth)(Writer_1.TYPE_EXACT, v), (0, Writer_1.modHeight)(Writer_1.TYPE_EXACT, v));
                    }
                }
                else if (k === "weight" || k === "horizontalweight") {
                    out.push((0, Writer_1.modWidth)(Writer_1.TYPE_WEIGHT, numBits(value)));
                }
                else if (k === "verticalweight") {
                    out.push((0, Writer_1.modHeight)(Writer_1.TYPE_WEIGHT, numBits(value)));
                }
                else if (k === "widthin") {
                    const wi = value;
                    out.push((0, Writer_1.modWidthIn)(this.fbits(wi[0]), this.fbits(wi[1])));
                }
                else if (k === "heightin") {
                    const hi = value;
                    out.push((0, Writer_1.modHeightIn)(this.fbits(hi[0]), this.fbits(hi[1])));
                }
                else if (k === "onclick" || k === "multiclick") {
                    let raw = value, clickType = 0;
                    if (k === "multiclick") {
                        const mv = (value ?? {});
                        clickType = Number(mv.clickType ?? 0);
                        raw = mv.actions;
                    }
                    out.push((0, Writer_1.modClick)(this.parseActions(raw), clickType));
                }
                else if (k === "semantics") {
                    const sem = (value ?? {});
                    const tid = (field) => field in sem ? this.writer.addText(String(sem[field])) : 0;
                    out.push((0, Writer_1.modSemantics)(tid("contentDescription"), -1, // role: there is no JSON key for it upstream either
                    tid("text"), tid("stateDescription"), Writer_1.SEMANTICS_MODE_SET, sem.enabled === undefined ? true : Boolean(sem.enabled), Boolean(sem.clickable ?? false)));
                }
                else if (k === "offset") {
                    if (Array.isArray(value)) {
                        out.push((0, Writer_1.modOffset)(this.fbits(value[0]), this.fbits(value[1])));
                    }
                    else if (value && typeof value === "object") {
                        const o = value;
                        out.push((0, Writer_1.modOffset)(this.fbits(o.x ?? 0), this.fbits(o.y ?? 0)));
                    }
                    else {
                        throw new NotImplementedComponent(`offset modifier value ${JSON.stringify(value)}`);
                    }
                }
                else if (k === "padding") {
                    const b = this.paddingBits(value);
                    out.push((0, Writer_1.modPadding)(b[0], b[1], b[2], b[3]));
                }
                else {
                    throw new NotImplementedComponent(`modifier '${key}'`);
                }
            }
        }
        return out;
    }
    /**
     * Padding, in the reference's three forms.
     *
     * The scalar form goes through the expression path, so `{"padding": "8 + 8"}` is legal;
     * the list and object forms go through getDouble and are numeric only. That asymmetry is
     * the reference's, and matching it matters — accepting an expression in the object form
     * would produce a document the Java converter rejects.
     */
    paddingBits(value) {
        if (Array.isArray(value)) {
            if (value.length < 4) {
                throw new NotImplementedComponent(`padding list needs 4 values, got ${value.length}`);
            }
            return [numBits(value[0]), numBits(value[1]), numBits(value[2]), numBits(value[3])];
        }
        if (value && typeof value === "object") {
            const g = (k) => numBits(value[k] ?? 0);
            return [g("start"), g("top"), g("end"), g("bottom")];
        }
        const v = this.fbits(value);
        return [v, v, v, v];
    }
    parseComponent(component) {
        const ctype = String(component.type).toLowerCase();
        const mods = this.parseModifiers(component.modifiers);
        const kids = (component.children ?? []).map(normalizeComponent);
        if (ctype === "column" || ctype === "row" || ctype === "box") {
            if (ctype === "box" && kids.length === 0) {
                // A childless box takes the leaf form, and its alignment defaults differ:
                // centre/centre here, start/top for the container form.
                this.writer.boxLeaf(hAlignOf(component, "center"), vAlignOf(component, "center"), mods);
                return;
            }
            const h = hAlignOf(component, "start");
            const v = vAlignOf(component, "top");
            if (ctype === "column")
                this.writer.startColumn(h, v, mods);
            else if (ctype === "row")
                this.writer.startRow(h, v, mods);
            else
                this.writer.startBox(h, v, mods);
            for (const k of kids)
                this.parseComponent(k);
            this.writer.endContainer();
            return;
        }
        if (ctype === "fitbox") {
            this.writer.startFitBox(hAlignOf(component, "center"), vAlignOf(component, "center"), mods);
            for (const k of (component.children ?? []).map(normalizeComponent)) {
                this.parseComponent(k);
            }
            this.writer.endFitBox();
            return;
        }
        if (ctype === "spacer") {
            // A spacer with no modifiers is a weight-1 filler; the alignment is 0/0
            // literally, not the container defaults.
            const m = mods.length ? mods : [(0, Writer_1.modWidth)(Writer_1.TYPE_WEIGHT, (0, WireBuffer_1.floatToRawIntBits)(1.0))];
            this.writer.startBox(0, 0, m);
            this.writer.endContainer();
            return;
        }
        if (ctype === "flow") {
            this.writer.startFlow(hAlignOf(component, "start"), vAlignOf(component, "top"), mods, Math.trunc(Number(component.maxColumns ?? 2147483647)));
            for (const k of (component.children ?? []).map(normalizeComponent)) {
                this.parseComponent(k);
            }
            this.writer.endFlow();
            return;
        }
        if (ctype === "global") {
            // Hoisted ahead of the root so its ids are allocated first. Two passes: the
            // resource-ish children on the way in, the rest as ordinary layout.
            const kidsAll = (component.children ?? []).map(normalizeComponent);
            if (this.inFirstPass) {
                this.writer.beginGlobal();
                for (const k of kidsAll) {
                    if (FIRST_PASS_TYPES.has(String(k.type).toLowerCase()))
                        this.parseComponent(k);
                }
                this.writer.endGlobal();
            }
            else {
                for (const k of kidsAll) {
                    if (!FIRST_PASS_TYPES.has(String(k.type).toLowerCase()))
                        this.parseComponent(k);
                }
            }
            return;
        }
        if (ctype === "resources") {
            if (this.inFirstPass)
                this.parseResources(component);
            return;
        }
        if (ctype === "variable") {
            if (this.inFirstPass || !this.variables.isMaterialised(component.name)) {
                this.parseVariable(component);
            }
            return;
        }
        if (ctype === "text") {
            this.parseText(component, mods);
            return;
        }
        if (ctype === "canvas") {
            this.writer.startCanvas(mods, this.apiLevel);
            for (const cmd of component.commands ?? [])
                this.parseCommand(cmd);
            this.writer.endCanvas(this.apiLevel);
            return;
        }
        throw new NotImplementedComponent(`component type '${ctype}'`);
    }
    /** `{"drawRect": {...}}` normalises the same way a component does. */
    normalizeCommand(c) {
        if (!("type" in c) && Object.keys(c).length === 1) {
            const key = Object.keys(c)[0];
            const val = c[key];
            const out = { type: key };
            if (Array.isArray(val))
                out.commands = val;
            else if (val && typeof val === "object")
                Object.assign(out, val);
            else if (["drawpath", "pathappendclose"].includes(key.toLowerCase()))
                out.path = val;
            else
                out.value = val;
            return out;
        }
        return c;
    }
    /** One paint property, appended to the bundle as PaintBundle ints. */
    paintSetter(key, src, ints) {
        if (key === "shader") {
            // Only a numeric shader id. An `{"agsl": …}` runtime shader needs DATA_SHADER
            // and its uniforms, which is not implemented — `Number({...})` is NaN, and
            // pushing that wrote shader id 0 and produced a document that drew the wrong
            // thing without complaint.
            const v = src[key];
            if (typeof v !== "number") {
                throw new NotImplementedComponent("paint shader: only a numeric shader id is supported; an AGSL runtime "
                    + "shader needs DATA_SHADER, which this converter does not implement");
            }
            ints.push(PB.SHADER, v);
        }
        else if (key === "color") {
            const c = src.color;
            // A "$colors.name" reference is a *live* colour id the host can change, and
            // takes a different bundle command from a literal.
            if (typeof c === "string" && (c.startsWith("$colors.") || c.startsWith("@colors."))) {
                ints.push(PB.COLOR_ID, this.resolveColor(c));
            }
            else {
                ints.push(PB.COLOR, toInt32(parseColor(c)));
            }
        }
        else if (key === "style") {
            const v = STYLE[String(src.style).toLowerCase()];
            if (v === undefined)
                throw new NotImplementedComponent(`paint style ${src.style}`);
            ints.push(PB.STYLE | (v << 16));
        }
        else if (key === "alpha")
            ints.push(PB.ALPHA, this.fbits(src.alpha));
        else if (key === "width" || key === "strokeWidth") {
            // strokeWidth is the preferred spelling and wins when both are present.
            ints.push(PB.STROKE_WIDTH, this.fbits("strokeWidth" in src ? src.strokeWidth : src.width));
        }
        else if (key === "strokeCap") {
            ints.push(PB.STROKE_CAP | ((CAP[String(src.strokeCap).toLowerCase()] ?? 0) << 16));
        }
        else if (key === "strokeJoin") {
            ints.push(PB.STROKE_JOIN | ((JOIN[String(src.strokeJoin).toLowerCase()] ?? 0) << 16));
        }
        else if (key === "textSize")
            ints.push(PB.TEXT_SIZE, this.fbits(src.textSize));
        else if (key === "linearGradient")
            this.gradient(src.linearGradient, ints, false);
        else if (key === "sweepGradient")
            this.gradient(src.sweepGradient, ints, true);
        else
            throw new NotImplementedComponent(`paint key '${key}'`);
    }
    /**
     * A linear or sweep gradient, appended to the paint bundle.
     *
     * The colour array is packed as one int: the count in the low half, and in the high
     * half a bitmask marking which entries are `$colors.` references rather than literals.
     * Stops are optional and their count is written even when zero.
     *
     * A sweep gradient takes a centre and no tile mode; a linear one takes two points and
     * a tile mode. The two are the same op distinguished only by the type in the high half
     * of the leading int, which makes an accidental swap produce a valid-looking bundle.
     */
    gradient(g, ints, sweep) {
        const colorsArr = (g.colors ?? []);
        const colors = [];
        let idMask = 0;
        colorsArr.forEach((c, i) => {
            if (typeof c === "string" && (c.startsWith("$colors.") || c.startsWith("@colors."))) {
                idMask |= (1 << i);
                colors.push(toInt32(this.resolveColor(c)));
            }
            else {
                colors.push(toInt32(typeof c === "string" ? this.resolveColor(c) : parseColor(c)));
            }
        });
        const stops = g.stops;
        ints.push(PB_GRADIENT | ((sweep ? GRAD_SWEEP : GRAD_LINEAR) << 16));
        ints.push((((idMask << 16) | colors.length) & 0xffffffff) | 0);
        ints.push(...colors);
        ints.push(stops ? stops.length : 0);
        if (stops)
            for (const st of stops)
                ints.push((0, WireBuffer_1.floatToRawIntBits)(Number(st)));
        // Coordinates go through parseFloat upstream, so they accept expressions and
        // variable references; fbits both resolves them and emits any expression op, at
        // the same point in the stream as the reference does.
        if (sweep) {
            ints.push(this.fbits(g.centerX), this.fbits(g.centerY));
        }
        else {
            ints.push(this.fbits(g.x1 ?? 0.0), this.fbits(g.y1 ?? 0.0), this.fbits(g.x2 ?? 0.0), this.fbits(g.y2 ?? 0.0));
            const tm = g.tileMode ?? 0;
            ints.push(typeof tm === "number" && Number.isInteger(tm) ? tm : 0);
        }
    }
    /**
     * A named bitmap, with its bytes embedded in the document.
     *
     * Upstream sources bitmaps from a host-supplied map keyed by name, which a file-based
     * converter has no equivalent of, so the JSON supplies the image itself: `base64` for a
     * self-contained document, or `file` for one that reads from disk. Either way the bytes
     * end up inside the `.rc` — a document that still needs an external file to render is
     * not a document.
     *
     * `file` needs a reader, because the converter core deliberately has no filesystem
     * dependency; the CLI supplies one. Without it, `file` raises rather than silently
     * producing a document with no image in it.
     */
    declareBitmap(name, value) {
        let spec = typeof value === "string"
            ? { file: value } : value;
        if (!spec || typeof spec !== "object") {
            throw new NotImplementedComponent(`bitmap '${name}': expected an object`);
        }
        let data;
        if ("base64" in spec) {
            try {
                data = decodeBase64(String(spec.base64));
            }
            catch (e) {
                throw new NotImplementedComponent(`bitmap '${name}': bad base64: ${e.message}`);
            }
        }
        else if ("file" in spec) {
            if (!this.readFile) {
                throw new NotImplementedComponent(`bitmap '${name}' names a file, but this converter was given no file `
                    + "reader — pass one via convert(json, {readFile}), or inline the image "
                    + "as base64");
            }
            try {
                data = this.readFile(String(spec.file));
            }
            catch (e) {
                throw new NotImplementedComponent(`bitmap '${name}': ${e.message}`);
            }
        }
        else {
            // `url` is deliberately absent, matching the reference: it fetches sounds from a
            // URL but not bitmaps, and adding it here would diverge.
            throw new NotImplementedComponent(`bitmap '${name}' needs 'file' or 'base64'`);
        }
        const [width, height] = pngSize(data);
        const imageId = this.writer.allocDataId();
        this.writer.addBitmap(imageId, width, height, data);
        return imageId;
    }
    /**
     * Mirror RemoteComposeJsonParser.resolveTextId.
     *
     * A text argument is not always a literal string: an integer is already an id, `@name`
     * resolves to whatever that variable's id is, and `#RRGGBB` becomes a colour constant.
     * That is what lets `drawTextAnchored` show a value that changes at runtime rather than
     * a string fixed at build time.
     */
    resolveTextId(obj) {
        if (typeof obj === "boolean") {
            throw new NotImplementedComponent(`text id: unexpected boolean ${obj}`);
        }
        if (typeof obj === "number") {
            // Integer-valued numbers are ids; see the note on resolveId about `2` vs `2.0`.
            if (Number.isInteger(obj))
                return obj;
            return (0, WireBuffer_1.idFromNanBits)(this.writer.addFloatConstant(obj));
        }
        if (obj && typeof obj === "object") {
            const kind = String(obj.type ?? "").toLowerCase();
            if (kind === "textfromfloat") {
                const vo = obj;
                return this.writer.addTextFromFloat(this.fbits(vo.value), Number(vo.whole ?? 0), Number(vo.decimal ?? 3), Number(vo.flags ?? 0));
            }
            throw new NotImplementedComponent(kind === "textmerge"
                ? "textMerge needs a TEXT_MERGE writer, which this converter does not "
                    + "have; no corpus document exercises it"
                : `text id object '${kind}'`);
        }
        const text = String(obj);
        if (text.startsWith("$colors.") || text.startsWith("@colors.")) {
            const hit = this.colors.get(text.slice(8));
            if (hit !== undefined)
                return hit;
        }
        if (text.includes("@") && /[+\-*/%]/.test(text)) {
            throw new NotImplementedComponent(`text id '${text}' is an integer expression, which needs integer-variable `
                + "support this converter does not have");
        }
        if (/^[@$]/.test(text)) {
            const name = text.slice(1);
            // `get`, not `isMaterialised`: a deferred variable is written at its first use,
            // and this is a use. Checking only for an already-written variable made the
            // reference fall through and emit the literal text "@hdgText".
            const bits = this.variables.get(name);
            if (bits !== undefined) {
                if (((bits >>> 23) & 0xff) === 0xff && (bits & 0x7fffff) !== 0) {
                    return bits & 0x7fffff; // a NaN-boxed id
                }
                return Math.trunc((0, WireBuffer_1.f32FromBits)(bits)); // a plain float holding an id
            }
        }
        if (text.startsWith("#"))
            return this.writer.addColor(toInt32(parseColor(text)));
        return this.writer.addText(text);
    }
    /** A bitmap reference: a numeric id, or `@name`/`$name` from `resources.bitmaps`. */
    bitmapId(value) {
        if (typeof value === "string") {
            const name = /^[@$]/.test(value) ? value.slice(1) : value;
            const hit = this.bitmaps.get(name);
            if (hit !== undefined)
                return hit;
            const known = [...this.bitmaps.keys()].sort().join(", ") || "none declared";
            throw new NotImplementedComponent(`bitmap '${value}' not found (declared: ${known})`);
        }
        return Math.trunc(Number(value));
    }
    /** `mode` plus the wireframe flags, resolved into the packed mode word. */
    meshMode(command) {
        const raw = command.mode ?? "software-flat";
        let mode;
        if (typeof raw === "number")
            mode = Math.trunc(raw);
        else {
            const key = String(raw).toLowerCase();
            if (!(key in MESH_MODE)) {
                throw new NotImplementedComponent(`drawMesh3D mode '${raw}' `
                    + `(expected one of ${Object.keys(MESH_MODE).sort().join(", ")})`);
            }
            mode = MESH_MODE[key];
        }
        if (command.wireframe) {
            mode |= MODE_WIREFRAME;
            for (const e of (command.edges ?? [])) {
                const n = Math.trunc(Number(e));
                if (!(n >= 0 && n <= 2)) {
                    throw new NotImplementedComponent(`drawMesh3D edge ${e} (expected 0, 1 or 2)`);
                }
                mode |= WIRE_EDGE[n];
            }
        }
        return mode;
    }
    /** Flatten a list of dim-component points, rejecting a wrong arity loudly. */
    points(command, key, dim) {
        const pts = command[key];
        if (!pts || !pts.length) {
            throw new NotImplementedComponent(`meshPrimitive3D: missing '${key}'`);
        }
        const out = [];
        for (const pt of pts) {
            if (!Array.isArray(pt) || pt.length !== dim) {
                throw new NotImplementedComponent(`meshPrimitive3D: ${key} entries need ${dim} components, `
                    + `got ${Array.isArray(pt) ? pt.length : 0}`);
            }
            out.push(...pt.map(Number));
        }
        return out;
    }
    /**
     * Mirror RemoteComposeJsonParser.resolveTextId.
     *
     * An **integer is already an id** and passes through untouched — `{"visibility": 2}`
     * means the INVISIBLE constant, not a reference to variable 2. A float becomes a float
     * constant and yields that constant's id; anything else resolves as a reference.
     *
     * Port note: Python's json distinguishes `2` from `2.0` and this branches on that.
     * `JSON.parse` does not — both arrive as the number 2 — so an id literally written
     * `2.0` is treated here as the id 2 where rcj would make it a float constant. No corpus
     * document does that (every action target is a string reference), but it is a real
     * divergence rather than a resolved one.
     */
    resolveId(value) {
        if (typeof value === "boolean") {
            throw new NotImplementedComponent(`expected an id, got boolean ${value}`);
        }
        if (typeof value === "number") {
            if (Number.isInteger(value))
                return value;
            return (0, WireBuffer_1.idFromNanBits)(this.writer.addFloatConstant(value));
        }
        return (0, WireBuffer_1.idFromNanBits)(this.fbits(value));
    }
    /**
     * Actions for a click modifier. Mirrors DefaultModifierParsers.parseActions: a single
     * object is accepted as well as an array.
     *
     * The eager/lazy split below is load-bearing. Host actions and literal string values
     * allocate their text ids inside the emit thunk, because upstream `write()` calls
     * `addText` itself and the DATA_TEXT therefore lands *after* the container op.
     * Expressions are compiled here, during parsing, because upstream `parseFloat` runs
     * while parsing and the expression op lands *before* it. Swapping either one shifts
     * every id that follows and changes the whole tail of the document.
     */
    parseActions(raw) {
        if (raw === null || raw === undefined)
            return [];
        const items = Array.isArray(raw) ? raw : [raw];
        const actions = [];
        for (const item of items) {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                throw new NotImplementedComponent(`action ${JSON.stringify(item)} (expected an object)`);
            }
            const a = item;
            const t = String(a.type ?? "").toLowerCase();
            const target = a.targetId !== undefined ? a.targetId : a.target;
            if (t === "hostnamedaction" || t === "hostmetadataaction") {
                if (!("name" in a)) {
                    throw new NotImplementedComponent(`${t} without a name is not supported yet`);
                }
                const name = String(a.name);
                const value = "value" in a ? String(a.value) : null;
                // HostAction(name) leaves both mType and mValueId at -1; STRING_TYPE is only
                // the default for actionType on the branch that carries a value.
                const type = value !== null
                    ? Number(a.actionType ?? Writer_1.HOST_ACTION_STRING_TYPE) : -1;
                actions.push((w) => {
                    const textId = w.addText(name);
                    const valueId = value !== null ? w.addText(value) : -1;
                    (0, Writer_1.hostNamedAction)(textId, type, valueId)(w);
                });
            }
            else if (t === "valuefloatexpressionchange") {
                if (target === undefined || target === null) {
                    throw new NotImplementedComponent('valueFloatExpressionChange needs a "target"');
                }
                const targetId = this.resolveId(target);
                const rawValue = "value" in a ? a.value : a.expression;
                if (rawValue === undefined || rawValue === null) {
                    throw new NotImplementedComponent('valueFloatExpressionChange needs a "value" or "expression"');
                }
                actions.push((0, Writer_1.valueFloatExpressionChange)(targetId, (0, WireBuffer_1.idFromNanBits)(this.fbits(rawValue))));
            }
            else if (t === "valuefloatchange") {
                if (target === undefined || target === null) {
                    throw new NotImplementedComponent('valueFloatChange needs a "target"');
                }
                actions.push((0, Writer_1.valueFloatChange)(this.resolveId(target), this.fbits(a.value)));
            }
            else if (t === "valueintegerchange") {
                if (target === undefined || target === null) {
                    throw new NotImplementedComponent('valueIntegerChange needs a "target"');
                }
                actions.push((0, Writer_1.valueIntegerChange)(this.resolveId(target), Number(a.value)));
            }
            else if (t === "valuestringchange") {
                if (target === undefined || target === null) {
                    throw new NotImplementedComponent('valueStringChange needs a "target"');
                }
                const targetId = this.resolveId(target);
                const value = a.value;
                if (typeof value === "string"
                    && !value.startsWith("@") && !value.startsWith("$")) {
                    actions.push((w) => (0, Writer_1.valueStringChange)(targetId, w.addText(value))(w));
                }
                else {
                    actions.push((0, Writer_1.valueStringChange)(targetId, this.resolveId(value)));
                }
            }
            else if (t === "valueintegerexpressionchange") {
                // Literal ids only. The reference resolves the target through an integer
                // variable table and the value through an integer *expression* parser;
                // neither exists here, and guessing would emit a document no reference run
                // could confirm.
                const value = "value" in a ? a.value : a.expression;
                if (typeof target !== "number" || typeof value !== "number") {
                    throw new NotImplementedComponent("valueIntegerExpressionChange with a named target or an expression "
                        + "string needs integer-variable support, which this converter does "
                        + "not have; only literal ids are accepted");
                }
                actions.push((0, Writer_1.valueIntegerExpressionChange)(Math.trunc(target), Math.trunc(value)));
            }
            else {
                throw new NotImplementedComponent(`click action type '${t}'`);
            }
        }
        return actions;
    }
    /**
     * A path reference: a name defined by pathCreate, a `$paths.` lookup, or an SVG string.
     *
     * An SVG string is *not* cached by value: the reference parses to a fresh float array
     * each call and keys its cache on that array, so two identical strings each get their
     * own id and their own DATA_PATH op.
     */
    resolvePath(value) {
        const s = String(value);
        const hit = this.paths.get(s);
        if (hit !== undefined)
            return hit;
        if (s.startsWith("$paths.") || s.startsWith("@paths.")) {
            const name = s.slice(7);
            const id = this.paths.get(name);
            if (id === undefined)
                throw new NotImplementedComponent(`Path not found: ${name}`);
            return id;
        }
        return this.writer.addPathData(parseSvgPath(s));
    }
    /** A colour value: literal, "$colors.name", or a variable holding a colour id. */
    resolveColor(value) {
        if (typeof value === "string" &&
            (value.startsWith("$colors.") || value.startsWith("@colors."))) {
            const name = value.slice(8);
            const id = this.colors.get(name);
            if (id === undefined)
                throw new NotImplementedComponent(`Color not found: ${name}`);
            return id;
        }
        return toInt32(parseColor(value));
    }
    buildPaintBundle(command) {
        const ints = [];
        if ("ops" in command) {
            // In `ops` form every key is honoured, in the order written.
            for (const op of command.ops) {
                for (const k of Object.keys(op)) {
                    this.paintSetter(PAINT_KEY_ALIASES[k.toLowerCase()] ?? k, op, ints);
                }
            }
            return ints;
        }
        for (const k of PAINT_KEYS_IGNORED) {
            if (k in command) {
                throw new NotImplementedComponent(`paint key '${k}' is ignored as a direct key by the reference parser — ` +
                    `move it into an "ops" array`);
            }
        }
        const present = new Set(Object.keys(command)
            .map((k) => PAINT_KEY_ALIASES[k.toLowerCase()] ?? k));
        for (const key of PAINT_KEYS_ORDER) {
            if (present.has(key))
                this.paintSetter(key, command, ints);
        }
        return ints;
    }
    parseCommand(raw) {
        const command = this.normalizeCommand(raw);
        const t = String(command.type).toLowerCase();
        const w = this.writer;
        const f = (k) => {
            if (!(k in command)) {
                throw new NotImplementedComponent(`${command.type}: missing required field '${k}'`);
            }
            return this.fbits(command[k]);
        };
        // `variable` appears both as a component and inside a commands array — the same
        // declaration, and in the command position its placement is what defers it.
        if (t === "variable") {
            this.parseVariable(command);
            return;
        }
        if (t === "paint") {
            w.paintValues(this.buildPaintBundle(command));
            return;
        }
        if (t === "setcolor") {
            w.paintValues([PB.COLOR, toInt32(parseColor(command.color))]);
            return;
        }
        if (t === "setstyle") {
            const v = STYLE[String(command.style).toLowerCase()];
            if (v === undefined)
                throw new NotImplementedComponent(`setStyle ${command.style}`);
            w.paintValues([PB.STYLE | (v << 16)]);
            return;
        }
        if (t === "setstrokewidth") {
            w.paintValues([PB.STROKE_WIDTH, f("width")]);
            return;
        }
        if (t === "drawrect") {
            w.drawRect(f("left"), f("top"), f("right"), f("bottom"));
            return;
        }
        if (t === "drawoval") {
            w.drawOval(f("left"), f("top"), f("right"), f("bottom"));
            return;
        }
        if (t === "drawcircle") {
            w.drawCircle(f("cx"), f("cy"), f("radius"));
            return;
        }
        if (t === "drawline") {
            w.drawLine(f("x1"), f("y1"), f("x2"), f("y2"));
            return;
        }
        if (t === "drawroundrect") {
            w.drawRoundRect(f("left"), f("top"), f("right"), f("bottom"), f("rx"), f("ry"));
            return;
        }
        if (t === "drawarc") {
            w.drawArc(f("left"), f("top"), f("right"), f("bottom"), f("startAngle"), f("sweepAngle"));
            return;
        }
        if (t === "drawsector") {
            w.drawSector(f("left"), f("top"), f("right"), f("bottom"), f("startAngle"), f("sweepAngle"));
            return;
        }
        if (t === "drawtextanchored") {
            w.drawTextAnchored(this.resolveTextId(command.text), f("x"), f("y"), f("panX"), f("panY"), Number(command.flags ?? 0));
            return;
        }
        if (t === "save") {
            // `save` is also a *container*: {"save": [ …commands… ]} saves, runs them, and
            // restores. Treating it as a bare op silently dropped everything inside.
            w.matrixSave();
            if ("commands" in command) {
                for (const c of command.commands)
                    this.parseCommand(c);
                w.matrixRestore();
            }
            return;
        }
        if (t === "restore") {
            w.matrixRestore();
            return;
        }
        if (t === "translate") {
            w.matrixTranslate(f("dx"), f("dy"));
            return;
        }
        if (t === "scale") {
            w.matrixScale(f("sx"), f("sy"));
            return;
        }
        if (t === "rotate") {
            // The pivots are resolved *before* the angle: the reference computes them into
            // locals and parses the angle as the call argument. Order is observable, because
            // resolving a deferred variable emits its expression op at that moment.
            const hasPivot = "pivotX" in command || "centerX" in command;
            const px = hasPivot ? this.fbits(command.pivotX ?? command.centerX) : NAN_BITS;
            const py = hasPivot ? this.fbits(command.pivotY ?? command.centerY) : NAN_BITS;
            w.matrixRotate(f("angle"), px, py);
            return;
        }
        if (t === "drawpath") {
            w.drawPath(this.resolvePath(command.path));
            return;
        }
        if (t === "pathcreate") {
            const pid = w.pathCreate(f("x"), f("y"));
            if (command.id !== undefined && command.id !== null) {
                this.paths.set(String(command.id), pid);
            }
            return;
        }
        if (t === "pathappendlineto") {
            w.pathAppendLineTo(this.resolvePath(command.path), f("x"), f("y"));
            return;
        }
        if (t === "pathappendclose") {
            w.pathAppendClose(this.resolvePath(command.path));
            return;
        }
        if (t === "createparticles") {
            // `variables` names the per-particle slots; `initialValues` gives one expression
            // each, evaluated once per particle when the system is seeded. Both the system
            // id and the variable names become ordinary float variables afterwards, which is
            // how the loop body and any drawing command refer to them.
            const names = command.variables.map(String);
            const inits = command.initialValues.map((v) => this.expr.infixToRpn(String(v)));
            if (inits.length !== names.length) {
                throw new NotImplementedComponent(`createParticles: ${names.length} variables but ${inits.length} initialValues`);
            }
            const [systemId, varIds] = w.createParticles(inits, Math.trunc(Number(command.count)));
            this.variables.set(String(command.id), (0, WireBuffer_1.asNanBits)(systemId));
            names.forEach((n, i) => this.variables.set(n, (0, WireBuffer_1.asNanBits)(varIds[i])));
            return;
        }
        if (t === "particlesloop") {
            // One equation per variable slot, run for every particle every frame, then the
            // body draws that particle. `restart` re-seeds a particle when it evaluates
            // true — that is what makes an emitter loop rather than run once.
            const systemBits = f("system");
            const restart = "restart" in command
                ? this.expr.infixToRpn(String(command.restart)) : null;
            const eqs = command.equations.map((e) => this.expr.infixToRpn(String(e)));
            w.particlesLoopStart(systemBits & 0x007fffff, restart, eqs);
            for (const c of command.commands ?? [])
                this.parseCommand(c);
            w.containerEnd();
            return;
        }
        if (t === "particlescomparison") {
            const eqs = (key) => {
                const raw = command[key];
                return raw !== undefined && raw !== null
                    ? raw.map((e) => this.expr.infixToRpn(String(e))) : null;
            };
            const cond = "condition" in command
                ? this.expr.infixToRpn(String(command.condition)) : null;
            // `then2` falls back to `then`, matching the reference's spelling of the same
            // field; `then1` has no such alias.
            const then2 = "then2" in command ? eqs("then2") : eqs("then");
            w.particlesCompareStart(f("systemId") & 0x007fffff, Math.trunc(Number(command.flags ?? 0)), f("min"), f("max"), cond, eqs("then1"), then2);
            for (const c of command.commands ?? [])
                this.parseCommand(c);
            w.containerEnd();
            return;
        }
        if (t === "impulse") {
            w.impulseStart(f("duration"), f("start"));
            for (const c of command.commands ?? [])
                this.parseCommand(c);
            w.containerEnd();
            return;
        }
        if (t === "impulseprocess") {
            w.impulseProcessStart();
            for (const c of command.commands ?? [])
                this.parseCommand(c);
            w.containerEnd();
            return;
        }
        if (t === "cleardepth3d") {
            w.paint3DState(P3_CLEAR_DEPTH, []);
            return;
        }
        if (t === "material3d") {
            w.paint3DState(P3_MATERIAL, [this.fbits(command.specular ?? 0.0),
                this.fbits(command.shininess ?? 32.0)]);
            return;
        }
        if (t === "depthbias3d") {
            w.paint3DState(P3_DEPTH_BIAS, [this.fbits(command.constant ?? 0.0),
                this.fbits(command.slope ?? 0.0)]);
            return;
        }
        if (t === "drawmesh3d") {
            w.drawMesh3D(Number(command.mesh), this.meshMode(command));
            return;
        }
        if (t === "texture3d") {
            // 0 clears the texture; a name would resolve against resources.bitmaps.
            const bitmap = command.bitmap ?? 0;
            w.setTexture3D(bitmap === 0 || bitmap === null ? 0 : this.bitmapId(bitmap));
            return;
        }
        if (t === "camera3d") {
            const projName = String(command.projection ?? "perspective").toLowerCase();
            if (!(projName in PROJECTION)) {
                throw new NotImplementedComponent(`camera3D projection '${projName}'`);
            }
            const proj = PROJECTION[projName];
            const projParams = proj === 0
                ? [this.fbits(command.fovY ?? 0.9), this.fbits(command.aspect ?? 1.0),
                    this.fbits(command.near ?? 0.1), this.fbits(command.far ?? 100.0)]
                : [f("left"), f("right"), f("bottom"), f("top"),
                    this.fbits(command.near ?? 0.1), this.fbits(command.far ?? 100.0)];
            const eye = (command.eye ?? [0, 0, 4]);
            const center = (command.center ?? [0, 0, 0]);
            const up = (command.up ?? [0, 1, 0]);
            const view = [...eye, ...center, ...up].map((v) => this.fbits(v));
            if (view.length !== 9) {
                throw new NotImplementedComponent("camera3D needs eye/center/up of 3 components each");
            }
            w.setCamera3D(proj, projParams, view);
            return;
        }
        if (t === "matrix3d") {
            // A matrix3D with no "op" once defaulted to identity and ignored everything
            // else, so {"translate": [x, y, z]} silently emitted identity and every instance
            // drew at the origin — which reads as a camera or data bug, not a syntax one. A
            // bare {} is still identity; anything else has to name its op.
            if (!("op" in command)) {
                const extra = Object.keys(command).filter((k) => k !== "type").sort();
                if (extra.length) {
                    throw new NotImplementedComponent('matrix3D needs an "op" (identity/translate/scale/rotate/multiply); '
                        + `got keys ${JSON.stringify(extra)}`);
                }
            }
            const subName = String(command.op ?? "identity").toLowerCase();
            if (!(subName in MATRIX_SUB)) {
                throw new NotImplementedComponent(`matrix3D op '${subName}'`);
            }
            const sub = MATRIX_SUB[subName];
            let args;
            if (sub === 0)
                args = [];
            else if (sub === 1 || sub === 2) {
                args = [this.fbits(command.x ?? 0), this.fbits(command.y ?? 0),
                    this.fbits(command.z ?? 0)];
            }
            else if (sub === 3) {
                const axis = (command.axis ?? [0, 1, 0]);
                args = [f("angle"), ...axis.map((v) => this.fbits(v))];
                if (args.length !== 4) {
                    throw new NotImplementedComponent("matrix3D rotate axis needs 3 components");
                }
            }
            else {
                const m = command.m;
                if (!m || m.length !== 16) {
                    throw new NotImplementedComponent(`matrix3D multiply needs 16 floats, got ${m ? m.length : 0}`);
                }
                args = m.map((v) => this.fbits(v));
            }
            w.matrix3DOp(sub, args);
            return;
        }
        if (t === "lights3d") {
            const types = [], colors = [], params = [];
            for (const light of (command.lights ?? [])) {
                const tname = String(light.type ?? "directional").toLowerCase();
                if (!(tname in LIGHT_TYPE)) {
                    throw new NotImplementedComponent(`lights3D type '${tname}'`);
                }
                const ltype = LIGHT_TYPE[tname];
                types.push(ltype);
                colors.push(toInt32(parseColor(light.color ?? "#FFFFFFFF")));
                const vec = (ltype === 1 ? light.pos : light.dir);
                if (!vec || vec.length !== 3) {
                    throw new NotImplementedComponent(`lights3D ${tname} needs a 3-component ${ltype === 1 ? "pos" : "dir"}`);
                }
                params.push(...vec.map((v) => this.fbits(v)), this.fbits(light.intensity ?? 1.0));
            }
            w.setLights3D(types, colors, params);
            return;
        }
        if (t === "definemesh3d") {
            const verts = command.verts.map((v) => this.fbits(v));
            const normalsRaw = (command.normals ?? []);
            const uvRaw = (command.uv ?? []);
            const normals = normalsRaw.length ? normalsRaw.map((v) => this.fbits(v)) : null;
            const uv = uvRaw.length ? uvRaw.map((v) => this.fbits(v)) : null;
            const idx = command.indices.map((i) => Math.trunc(Number(i)));
            if (idx.length % 3) {
                throw new NotImplementedComponent(`defineMesh3D indices length ${idx.length} is not a multiple of 3`);
            }
            if (verts.length % 3) {
                throw new NotImplementedComponent(`defineMesh3D verts length ${verts.length} is not a multiple of 3`);
            }
            if (normals && normals.length !== verts.length) {
                throw new NotImplementedComponent(`defineMesh3D normals ${normals.length} != verts ${verts.length}`);
            }
            if (uv && uv.length !== (verts.length / 3) * 2) {
                throw new NotImplementedComponent(`defineMesh3D uv ${uv.length} != 2 per vertex (${(verts.length / 3) * 2})`);
            }
            w.defineMesh3D(Number(command.id), idx, verts, normals, uv);
            return;
        }
        if (t === "vectorexpression") {
            const dim = Math.trunc(Number(command.dimension ?? 3));
            if (![2, 3, 4].includes(dim)) {
                throw new NotImplementedComponent(`vectorExpression dimension ${dim} (expected 2, 3 or 4)`);
            }
            const ops = this.expr.infixToRpn(String(command.expression), VECTOR_FUNCTIONS);
            const base = w.vectorExpression(dim, Math.trunc(Number(command.flags ?? 0)), ops);
            if (command.name) {
                // Bind name.x/.y/.z/.w to the component ids so later expressions read them as
                // ordinary scalars. That is the point of the op: nothing downstream needs to
                // know a vector was involved.
                for (let k = 0; k < dim; k++) {
                    this.variables.set(`${command.name}.${VECTOR_COMPONENTS[k]}`, (0, WireBuffer_1.asNanBits)(base + k));
                }
            }
            return;
        }
        if (t === "touchexpression") {
            let mode = command.stopMode !== undefined ? command.stopMode
                : (command.touchMode !== undefined ? command.touchMode : 0);
            if (typeof mode === "string") {
                const key = mode.toLowerCase().replace(/_/g, "");
                if (!(key in TOUCH_STOP)) {
                    throw new NotImplementedComponent(`touchExpression stopMode '${mode}' `
                        + `(expected one of ${Object.keys(TOUCH_STOP).sort().join(", ")})`);
                }
                mode = TOUCH_STOP[key];
            }
            // An absent `min` means wrap around `max`, which is a different behaviour from
            // min=0 — so it defaults to NaN rather than to a number, matching upstream.
            const minB = "min" in command ? f("min") : NAN_BITS;
            const velB = "velocityId" in command ? f("velocityId") : NAN_BITS;
            // Upstream's `expression` is a raw float array run element-wise through
            // parseFloat, so it can name a system variable but has no operators. Accepting
            // an infix string too is an rcj extension the port keeps for parity.
            const rawExpr = command.expression ?? "touchX()";
            const ops = Array.isArray(rawExpr)
                ? rawExpr.map((v) => this.fbits(v))
                : this.expr.infixToRpn(String(rawExpr));
            const bits = w.touchExpression(this.fbits(command.defaultValue ?? 0.0), minB, this.fbits(command.max ?? 1.0), Math.trunc(Number(mode)), velB, Math.trunc(Number(command.touchEffects ?? 0)), ops, command.touchSpec ? command.touchSpec.map(Number) : null, command.easingSpec ? command.easingSpec.map(Number) : null);
            if (command.name)
                this.variables.set(String(command.name), bits);
            return;
        }
        if (t === "meshprimitive3d") {
            const kind = String(command.primitive).toLowerCase()
                .replace(/_/g, "").replace(/-/g, "");
            if (!(kind in PRIMITIVE)) {
                throw new NotImplementedComponent(`meshPrimitive3D primitive '${command.primitive}' `
                    + `(expected one of ${Object.keys(PRIMITIVE).sort().join(", ")})`);
            }
            const ptype = PRIMITIVE[kind];
            let flagsExtra = 0;
            const extraChannels = [];
            let scalars;
            const fbAll = (xs) => xs.map((v) => this.fbits(v));
            if ("params" in command) {
                scalars = fbAll(command.params);
            }
            else if (kind === "tube" || kind === "captube") {
                // [radius, (ringsPerSpan), x0,y0,z0, ...]
                scalars = [f("radius")];
                if ("ringsPerSpan" in command) {
                    flagsExtra |= FLAG_TUBE_PATH_DENSITY;
                    scalars.push(f("ringsPerSpan"));
                }
                scalars.push(...this.points(command, "points", 3).map((v) => this.fbits(v)));
                if (command.legacy)
                    flagsExtra |= FLAG_TUBE_LEGACY;
                if (command.spline)
                    flagsExtra |= FLAG_SPLINE;
            }
            else if (kind === "profiletube") {
                // [nPoints, (ringsPerSpan), x,y,z * n, r0..rk]
                const pts = this.points(command, "points", 3);
                const radii = command.radii;
                if (!radii || !radii.length) {
                    throw new NotImplementedComponent("meshPrimitive3D profileTube: missing 'radii'");
                }
                scalars = [this.fbits(Math.trunc(pts.length / 3))];
                if ("ringsPerSpan" in command) {
                    flagsExtra |= FLAG_TUBE_PATH_DENSITY;
                    scalars.push(f("ringsPerSpan"));
                }
                scalars.push(...pts.map((v) => this.fbits(v)), ...fbAll(radii));
                if (command.capped === undefined || command.capped)
                    flagsExtra |= FLAG_TUBE_CAP;
            }
            else if (kind === "sweep") {
                // scalars = [closed, capStart, capEnd, cx,cy,cz]; the section and path ride
                // channels 1 and 2, with optional per-station scale and twist after them.
                const centre = (command.center ?? [0, 0, 0]);
                if (centre.length !== 3) {
                    throw new NotImplementedComponent("meshPrimitive3D sweep: center needs 3 values");
                }
                const bool = (v, d) => this.fbits((v === undefined ? d : v) ? 1 : 0);
                scalars = [bool(command.closed, true), bool(command.capStart, true),
                    bool(command.capEnd, true), ...fbAll(centre)];
                extraChannels.push(this.points(command, "section", 2).map((v) => this.fbits(v)));
                extraChannels.push(this.points(command, "path", 3).map((v) => this.fbits(v)));
                if ("scales" in command)
                    extraChannels.push(fbAll(command.scales));
                if ("twists" in command) {
                    if (!("scales" in command)) {
                        // The channel order is positional: twists live in channel 4, so a
                        // document with twists but no scales must still send a scale channel.
                        throw new NotImplementedComponent("meshPrimitive3D sweep: 'twists' requires 'scales' "
                            + "(channel order is positional)");
                    }
                    extraChannels.push(fbAll(command.twists));
                }
            }
            else if (kind === "extrudepath") {
                // [depth, cx,cy,cz, bevel, contourCount, (count, x,y...)*]
                const centre = (command.center ?? [0, 0, 0]);
                if (centre.length !== 3) {
                    throw new NotImplementedComponent("meshPrimitive3D extrudePath: center needs 3 values");
                }
                const contours = command.contours;
                if (!contours || !contours.length) {
                    throw new NotImplementedComponent("meshPrimitive3D extrudePath: missing 'contours'");
                }
                scalars = [this.fbits(command.depth ?? 1.0), ...fbAll(centre),
                    this.fbits(command.bevel ?? 0.0), this.fbits(contours.length)];
                for (const ring of contours) {
                    scalars.push(this.fbits(ring.length));
                    for (const pt of ring) {
                        if (!Array.isArray(pt) || pt.length !== 2) {
                            throw new NotImplementedComponent("meshPrimitive3D extrudePath: contour points are [x, y] pairs");
                        }
                        scalars.push(this.fbits(pt[0]), this.fbits(pt[1]));
                    }
                }
            }
            else if (kind in PRIMITIVE_PARAMS) {
                scalars = [];
                for (const key of PRIMITIVE_PARAMS[kind]) {
                    if (key === "center" || key === "from" || key === "to") {
                        const vec = (command[key] ?? [0, 0, 0]);
                        if (vec.length !== 3) {
                            throw new NotImplementedComponent(`meshPrimitive3D ${kind}: ${key} needs 3 components`);
                        }
                        scalars.push(...fbAll(vec));
                    }
                    else {
                        if (!(key in command)) {
                            throw new NotImplementedComponent(`meshPrimitive3D ${kind}: missing '${key}' `
                                + `(needs ${JSON.stringify(PRIMITIVE_PARAMS[kind])})`);
                        }
                        scalars.push(this.fbits(command[key]));
                    }
                }
            }
            else {
                throw new NotImplementedComponent(`meshPrimitive3D ${kind}: pass an explicit "params" list`);
            }
            let flags = Math.trunc(Number(command.flags ?? 0)) | flagsExtra;
            const uvname = String(command.uv ?? "none").toLowerCase();
            if (!(uvname in UV_MODE)) {
                throw new NotImplementedComponent(`meshPrimitive3D uv '${uvname}'`);
            }
            flags |= UV_MODE[uvname] << 4;
            // Channels 1+ carry geometry streams: a lathe profile, a sweep section/path.
            const channels = [scalars, ...extraChannels];
            for (const extra of (command.channels ?? []))
                channels.push(fbAll(extra));
            if (kind === "lathe" && "profile" in command) {
                const prof = [];
                for (const pt of command.profile) {
                    if (!Array.isArray(pt) || pt.length !== 2) {
                        throw new NotImplementedComponent("meshPrimitive3D lathe: profile points are [radius, y] pairs");
                    }
                    prof.push(this.fbits(pt[0]), this.fbits(pt[1]));
                }
                channels.push(prof);
            }
            w.meshPrimitive3D(Number(command.id), ptype, this.fbits(command.segments ?? 0), flags, channels);
            return;
        }
        if (t === "meshexpression3d") {
            const surface = String(command.surface ?? "general").toLowerCase().replace(/_/g, "");
            if (!(surface in SURFACE)) {
                throw new NotImplementedComponent(`meshExpression3D surface '${command.surface}' `
                    + `(expected one of ${Object.keys(SURFACE).sort().join(", ")})`);
            }
            const stype = SURFACE[surface];
            /** Compile one infix expression with `u`/`v` bound to VAR1/VAR2. */
            const rpn = (expr) => {
                const saved = {
                    u: this.variables.isMaterialised("u") ? this.variables.get("u") : undefined,
                    v: this.variables.isMaterialised("v") ? this.variables.get("v") : undefined,
                };
                this.variables.set("u", VAR1_BITS);
                this.variables.set("v", VAR2_BITS);
                try {
                    return this.expr.infixToRpn(String(expr));
                }
                finally {
                    for (const k of ["u", "v"]) {
                        if (saved[k] === undefined)
                            this.variables.remove(k);
                        else
                            this.variables.set(k, saved[k]);
                    }
                }
            };
            const need = (key) => {
                if (!(key in command)) {
                    throw new NotImplementedComponent(`meshExpression3D ${surface}: missing '${key}'`);
                }
                return command[key];
            };
            const rng = (key, dflt) => {
                const r = (command[key] ?? dflt);
                if (!r || r.length !== 2) {
                    throw new NotImplementedComponent(`meshExpression3D ${surface}: '${key}' must be [min, max]`);
                }
                return [this.fbits(r[0]), this.fbits(r[1])];
            };
            let params, pos;
            if (surface === "heightfield") {
                params = [...rng("xRange"), this.fbits(need("uCount")),
                    ...rng("zRange"), this.fbits(need("vCount")),
                    ...rng("yRange", [-1e6, 1e6])];
                pos = [rpn(need("height"))];
            }
            else if (surface === "sphere") {
                params = [this.fbits(need("radius")), this.fbits(need("uCount")),
                    this.fbits(need("vCount"))];
                pos = [rpn(command.displacement ?? 0)];
            }
            else if (surface === "cylinder") {
                params = [this.fbits(need("radius")), this.fbits(need("height")),
                    this.fbits(need("uCount")), this.fbits(need("vCount"))];
                pos = [rpn(command.displacement ?? 0)];
            }
            else {
                params = [...rng("uRange"), this.fbits(need("uCount")),
                    ...rng("vRange"), this.fbits(need("vCount"))];
                pos = [rpn(need("x")), rpn(need("y")), rpn(need("z"))];
            }
            const normal = (command.normal ?? []).map(rpn);
            if (normal.length && normal.length !== 3) {
                throw new NotImplementedComponent("meshExpression3D: 'normal' needs three expressions (nx, ny, nz); "
                    + "omit it for finite-difference normals");
            }
            const uvg = (command.uv ?? []).map(rpn);
            if (uvg.length && uvg.length !== 2) {
                throw new NotImplementedComponent("meshExpression3D: 'uv' needs two expressions (u, v)");
            }
            let flags = Math.trunc(Number(command.flags ?? 0));
            if (command.flipWinding)
                flags |= 0x1;
            w.meshExpression3D(Number(command.id), stype, flags, params, pos, normal, uvg);
            return;
        }
        if (t === "conditionaloperations") {
            const COND = { gt: 4, ge: 5, lt: 2, le: 3, eq: 0 };
            // An unrecognised condition falls back to eq (0) rather than raising — that is
            // the reference's behaviour, and a document relying on it must not diverge here.
            const cond = COND[String(command.condition).toLowerCase()] ?? 0;
            w.conditionalOperations(cond, f("v1"), f("v2"));
            for (const c of command.commands ?? [])
                this.parseCommand(c);
            w.endConditional();
            return;
        }
        if (t === "loop") {
            const fromBits = f("from");
            const stepBits = "step" in command ? f("step") : (0, WireBuffer_1.floatToRawIntBits)(1.0);
            const untilBits = f("until");
            const index = String(command.index ?? "i");
            // The index is a text id unless suppressed — that id is also what the body's
            // expressions reference, so it has to be bound before the body is parsed.
            const indexId = command.noIndexText ? w.allocDataId() : w.addText(index);
            w.startLoop(indexId, fromBits, stepBits, untilBits);
            const had = this.variables.isMaterialised(index);
            const prev = had ? this.variables.get(index) : undefined;
            this.variables.set(index, (indexId | 0xff800000) >>> 0);
            for (const c of command.commands ?? [])
                this.parseCommand(c);
            if (had && prev !== undefined)
                this.variables.set(index, prev);
            else
                this.variables.remove(index);
            w.endLoop();
            return;
        }
        if (t === "cliprect") {
            w.clipRect(f("left"), f("top"), f("right"), f("bottom"));
            return;
        }
        throw new NotImplementedComponent(`canvas command '${t}'`);
    }
    parseVariable(command) {
        const name = String(command.name);
        const vtype = String(command.vtype ?? "float");
        if (vtype !== "float") {
            throw new NotImplementedComponent(`variable vtype '${vtype}'`);
        }
        if (command.export)
            throw new NotImplementedComponent("named/export float variable TBD");
        const commit = Boolean(command.commit), flush = Boolean(command.flush);
        if (!(this.inFirstPass || commit || flush)) {
            this.variables.defer(name, command); // emitted at first use
            return;
        }
        if (flush)
            throw new NotImplementedComponent("flush variable TBD");
        if (this.variables.isMaterialised(name)) {
            throw new NotImplementedComponent("variable reassignment (targetId) TBD");
        }
        this.variables.set(name, this.materialiseFloatVar(command));
    }
    materialiseFloatVar(command) {
        const value = command.value;
        if (typeof value === "number")
            return this.writer.addFloatConstant(value);
        if (value && typeof value === "object" && !Array.isArray(value)) {
            const kind = String(value.type ?? "").toLowerCase();
            if (kind === "textfromfloat" || kind === "textmerge") {
                // A *text* id held in a float variable, and stored as a plain float rather
                // than NaN-boxed — it names a string, not a number, so nothing downstream
                // should read it as a variable reference. Note `decimal` defaults to 3 in
                // resolveTextId and to 0 on the text-component path; not the same default.
                return (0, WireBuffer_1.floatToRawIntBits)(this.resolveTextId(value));
            }
        }
        return this.fbits(value);
    }
    parseResources(section) {
        const order = section.order
            ?? Parser.RESOURCE_ORDER.filter((k) => k in section);
        for (const key of order) {
            if (!(key in section))
                continue;
            if (!["colors", "floatArrays", "variables", "bitmaps"].includes(key)) {
                throw new NotImplementedComponent(`resource type '${key}' (colors/floatArrays/variables/bitmaps only)`);
            }
            this.parseResourceSection(key, section[key]);
        }
    }
    parseResourceSection(key, sectionValue) {
        const section = { [key]: sectionValue };
        if (key === "bitmaps") {
            for (const [name, , value] of eachResource(sectionValue)) {
                this.bitmaps.set(name, this.declareBitmap(name, value));
            }
            return;
        }
        if ("colors" in section) {
            for (const [name, , value] of eachResource(section.colors)) {
                if (value && typeof value === "object" && !Array.isArray(value)) {
                    throw new NotImplementedComponent("themed (light/dark) color TBD");
                }
                this.colors.set(name, this.writer.addNamedColor(name, parseColor(value)));
            }
        }
        if ("floatArrays" in section) {
            for (const [name, cfg, value] of eachResource(section.floatArrays)) {
                const raw = value && typeof value === "object" && "value" in value
                    ? value.value : value;
                const data = raw.map(Number);
                const named = cfg === null || cfg.export !== false;
                const aid = named ? this.writer.addNamedFloatArray(name, data)
                    : this.writer.addFloatArray(data);
                this.variables.set(name, (aid | 0xff800000) >>> 0);
            }
        }
        if ("variables" in section) {
            for (const [name, cfg, value] of eachResource(section.variables)) {
                const named = cfg ? Boolean(cfg.export) : false;
                let val = value;
                if (val && typeof val === "object" && "value" in val && !("anim" in val)) {
                    val = val.value;
                }
                if (val && typeof val === "object"
                    && ["textfromfloat", "textmerge"]
                        .includes(String(val.type ?? "").toLowerCase())) {
                    // A *text* id held in a float variable, stored as a plain float rather
                    // than NaN-boxed: it names a string, not a number, so nothing downstream
                    // should read it as a variable reference.
                    this.variables.set(name, (0, WireBuffer_1.floatToRawIntBits)(this.resolveTextId(val)));
                }
                else if (typeof val === "number") {
                    this.variables.set(name, named
                        ? this.writer.addNamedFloat(name, val)
                        : this.writer.addFloatConstant(val));
                }
                else {
                    const bits = this.fbits(val);
                    this.variables.set(name, bits);
                    if (named)
                        this.writer.setFloatName(bits & 0x007fffff, name);
                }
            }
        }
    }
    parseText(component, mods) {
        if (!this.profiles) {
            // Without a profiles tag the reference falls back to the TextLayout op, which has
            // a different field layout; refusing beats emitting a plausible wrong document.
            throw new NotImplementedComponent("text without a `profiles` header tag — add \"profiles\": 513");
        }
        const value = component.value;
        if (typeof value === "string" && (value.startsWith("$") || value.startsWith("@"))) {
            throw new NotImplementedComponent(`text variable/resource reference ${value}`);
        }
        let textId;
        if (value !== undefined && value !== null) {
            textId = this.writer.addText(String(value));
        }
        else if (component.textFromFloat && typeof component.textFromFloat === "object") {
            // A live float rather than a literal — the id is the same kind of thing, but
            // the op behind it formats a value at render time.
            const tff = component.textFromFloat;
            textId = this.writer.addTextFromFloat(this.fbits(tff.value), Number(tff.whole ?? 0), Number(tff.decimal ?? 0), Number(tff.flags ?? 0));
        }
        else {
            throw new NotImplementedComponent("text without value or textFromFloat");
        }
        // A "$colors." reference sets colorId and leaves color at its default; a literal
        // does the opposite. Setting both, or the wrong one, changes which CoreText tag is
        // emitted and the text silently renders black.
        let color = 0xff000000;
        let colorId = -1;
        const c = component.color;
        if (typeof c === "string" && (c.startsWith("$colors.") || c.startsWith("@colors."))) {
            colorId = this.resolveColor(c);
        }
        else if (c !== undefined && c !== null) {
            color = this.resolveColor(c);
        }
        const overflow = OVERFLOW[String(component.overflow ?? "clip").toLowerCase()] ?? 1;
        this.writer.textComponent(textId, {
            color,
            colorId,
            fontSizeBits: component.fontSize !== undefined
                ? this.fbits(component.fontSize) : (0, WireBuffer_1.floatToRawIntBits)(36.0),
            fontWeightBits: component.fontWeight !== undefined
                ? this.fbits(component.fontWeight) : (0, WireBuffer_1.floatToRawIntBits)(400.0),
            textAlign: parseTextAlign(String(component.textAlign ?? "start")),
            overflow,
            maxLines: component.maxLines !== undefined ? Number(component.maxLines) : INT_MAX,
            modifiers: mods,
        });
    }
}
exports.Parser = Parser;
/**
 * Resource sections, in the reference's order.
 *
 * The order is load-bearing: ids are allocated as each section is parsed, so a section
 * handled out of turn shifts every id after it. `order` overrides the default, and an
 * unrecognised section raises rather than being skipped — silently ignoring one would
 * produce a document that converts and is missing everything it declared.
 */
Parser.RESOURCE_ORDER = ["v_dims", "colors", "paths", "floatArrays", "variables",
    "integers", "matrices", "bitmaps", "sounds"];
/**
 * Generation-library entries wrap the document under a `json` key alongside prose metadata.
 * Without this the parser saw no `root` and emitted a bare 17-byte header.
 */
function unwrap(doc) {
    if (!("root" in doc) && doc.json && typeof doc.json === "object")
        return doc.json;
    return doc;
}
function convert(json, options = {}) {
    const doc = typeof json === "string" ? JSON.parse(json) : json;
    return new Parser(options).parse(unwrap(doc));
}
