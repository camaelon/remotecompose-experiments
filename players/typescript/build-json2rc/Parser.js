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
    /** A pattern body binds its parameters and locals over the outer scope, restored after. */
    snapshot() { return [new Map(this.materialised), new Map(this.deferred)]; }
    restore(s) { this.materialised = new Map(s[0]); this.deferred = new Map(s[1]); }
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
/** GraphicsLayerModifierOperation attribute ids for the keys the JSON parser knows. */
const GRAPHICS_LAYER_ATTR = {
    scalex: 0, scaley: 1, rotationz: 4, translationx: 7, translationy: 8, alpha: 11,
};
/** org.json (Android) optInt: a number or numeric string, truncated; anything else the default. */
function optInt(v, dflt) {
    if (typeof v === "number")
        return Number.isFinite(v) ? Math.trunc(v) | 0 : dflt;
    if (typeof v === "string") {
        const n = Number(v.trim());
        return v.trim() !== "" && !Number.isNaN(n) ? Math.trunc(n) | 0 : dflt;
    }
    return dflt;
}
/** org.json (Android) getInt: a number or numeric string (NaN -> 0), else an error. */
function jsonGetInt(v, what) {
    if (typeof v === "number")
        return Number.isFinite(v) ? Math.trunc(v) | 0 : 0;
    if (typeof v === "string" && v.trim() !== "" && (!Number.isNaN(Number(v)) || v.trim() === "NaN")) {
        const n = Number(v);
        return Number.isFinite(n) ? Math.trunc(n) | 0 : 0;
    }
    throw new NotImplementedComponent(`${what}: expected an int, got ${JSON.stringify(v)}`);
}
/** The `rem` remark text: text, value, message or comment, else empty. */
function remText(c) {
    return String(c.text ?? c.value ?? c.message ?? c.comment ?? "");
}
/** MatrixOperations, by OFFSET + 1 + index (RemoteComposeJsonParser.parseMatrixOperator). */
const MATRIX_OPS = ["IDENTITY", "ROT_X", "ROT_Y", "ROT_Z", "TRANSLATE_X", "TRANSLATE_Y",
    "TRANSLATE_Z", "TRANSLATE2", "TRANSLATE3", "SCALE_X", "SCALE_Y", "SCALE_Z", "SCALE2",
    "SCALE3", "MUL", "ROT_PZ", "ROT_AXIS", "PROJECTION"];
/** DRAW_TO_BITMAP (190). */
function drawOnBitmap(w, bitmapId, mode, color) {
    w.buffer.start(190);
    w.buffer.writeInt(bitmapId);
    w.buffer.writeInt(mode);
    w.buffer.writeInt(color);
}
/** Float.isNaN on raw bits. */
function isNanBits(bits) {
    return ((bits >>> 23) & 0xff) === 0xff && (bits & 0x7fffff) !== 0;
}
/** RemoteComposeJsonParser.isVariableRef / getVariableNameFromRef. */
function isVariableRef(s) {
    if (s.length < 2 || !/^[@$]/.test(s))
        return false;
    return !/^[@$](colors|paths|matrices)\./.test(s);
}
function variableNameFromRef(s) {
    return /^[@$]vars\./.test(s) ? s.slice(6) : s.slice(1);
}
/** AnimationSpec.ANIMATION and SEQUENCE, by ordinal. */
const ANIMATION_TYPES = ["FADE_IN", "FADE_OUT", "SLIDE_LEFT", "SLIDE_RIGHT", "SLIDE_TOP",
    "SLIDE_BOTTOM", "ROTATE", "PARTICLE", "CUSTOM"];
const SEQUENCE_TYPES = ["CONCURRENT", "BEFORE", "AFTER"];
/** DefaultModifierParsers.parseAnimationType / parseSequenceType. */
function enumOrdinal(v, names, dflt) {
    if (v === null || v === undefined)
        return dflt;
    if (typeof v === "number") {
        const o = Math.trunc(v);
        return o >= 0 && o < names.length ? o : dflt;
    }
    if (typeof v === "string") {
        const i = names.indexOf(v.toUpperCase());
        return i >= 0 ? i : dflt;
    }
    return dflt;
}
/** DefaultModifierParsers.parseEasingType (Easing.CUBIC_*). */
function easingType(v, dflt) {
    if (v === null || v === undefined)
        return dflt;
    if (typeof v === "number")
        return Math.trunc(v);
    if (typeof v === "string") {
        const E = {
            CUBIC_STANDARD: 1, STANDARD: 1, CUBIC_ACCELERATE: 2, ACCELERATE: 2,
            CUBIC_DECELERATE: 3, DECELERATE: 3, CUBIC_LINEAR: 4, LINEAR: 4,
            CUBIC_ANTICIPATE: 5, ANTICIPATE: 5, CUBIC_OVERSHOOT: 6, OVERSHOOT: 6,
        };
        return E[v.toUpperCase()] ?? dflt;
    }
    return dflt;
}
/** org.json (Android) optBoolean: a boolean, or the string "true"/"false" in any case. */
function optBoolean(v, dflt) {
    if (typeof v === "boolean")
        return v;
    if (typeof v === "string") {
        if (v.toLowerCase() === "true")
            return true;
        if (v.toLowerCase() === "false")
            return false;
    }
    return dflt;
}
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
    "definepattern", "referencedoperations",
    "createfloatfunction", "floatfunction",
    "definevisibilityanimation", "createoffscreenbitmap"]);
/** RemoteComposeJsonParser.isFirstPassOnlyComponent: parsed in the first pass, skipped in the root. */
const FIRST_PASS_ONLY_TYPES = new Set(["resources", "variable", "definepattern", "referencedoperations",
    "createfloatfunction", "floatfunction",
    "definevisibilityanimation", "createoffscreenbitmap"]);
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
/**
 * ResourceParser "paths" given as an op list. Every segment carries its start point (the
 * current point), and `close` returns the current point to the subpath's start. An unknown
 * op type is skipped, as the reference's switch does.
 */
function pathFromOps(ops) {
    const out = [];
    const verb = (tag) => out.push({ bits: (tag | 0xff800000) >>> 0 });
    const num = (op, k) => {
        const v = op[k];
        const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
        if (Number.isNaN(n))
            throw new NotImplementedComponent(`path op '${op.type}' needs a number for ${k}`);
        return n;
    };
    let cx = 0, cy = 0, sx = 0, sy = 0;
    for (const op of ops) {
        if (!op || typeof op !== "object")
            throw new NotImplementedComponent("path op must be an object");
        switch (String(op.type)) {
            case "moveTo": {
                const x = num(op, "x"), y = num(op, "y");
                verb(PATH_MOVE);
                out.push(x, y);
                cx = sx = x;
                cy = sy = y;
                break;
            }
            case "lineTo": {
                const x = num(op, "x"), y = num(op, "y");
                verb(PATH_LINE);
                out.push(cx, cy, x, y);
                cx = x;
                cy = y;
                break;
            }
            case "quadTo": {
                const x1 = num(op, "x1"), y1 = num(op, "y1"), x2 = num(op, "x2"), y2 = num(op, "y2");
                verb(PATH_QUAD);
                out.push(cx, cy, x1, y1, x2, y2);
                cx = x2;
                cy = y2;
                break;
            }
            case "cubicTo": {
                const x1 = num(op, "x1"), y1 = num(op, "y1"), x2 = num(op, "x2"), y2 = num(op, "y2");
                const x3 = num(op, "x3"), y3 = num(op, "y3");
                verb(PATH_CUBIC);
                out.push(cx, cy, x1, y1, x2, y2, x3, y3);
                cx = x3;
                cy = y3;
                break;
            }
            case "close":
                verb(PATH_CLOSE);
                cx = sx;
                cy = sy;
                break;
            default: break;
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
const PB_GRADIENT = 11, GRAD_LINEAR = 0, GRAD_RADIAL = 1, GRAD_SWEEP = 2, GRAD_RADIAL2 = 3;
const PAINT_KEYS_ORDER = ["shader", "color", "alpha", "strokeJoin", "strokeCap", "style", "width",
    "textSize", "radialGradient", "sweepGradient"];
/** Keys that select the two-circle (focal) radialGradient (FOCAL_RADIAL_KEYS upstream). */
const FOCAL_RADIAL_KEYS = ["startX", "startY", "startR", "startRadius", "endX", "endY", "endR",
    "endRadius", "focalX", "focalY", "focalR", "focalRadius"];
const PAINT_KEY_ALIASES = { strokewidth: "width", runtimeshader: "shader" };
/**
 * `linearGradient` is in PAINT_KEYS_IGNORED because the reference ignores it *as a direct
 * key* — inside an `ops` array it is honoured. The two lists are not in conflict.
 */
/** Accepted as direct keys but ignored by the reference — fail loudly rather than lose them. */
const PAINT_KEYS_IGNORED = ["linearGradient", "pathEffect"];
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
        /** Templates defined so far: name (lower case) -> pattern id and parameter names. */
        this.patterns = new Map();
        /** Matrices declared by matrixConstant, for `$matrices.name`. */
        this.matrices = new Map();
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
            if (value.startsWith("path:") || value.startsWith("path.")) {
                // PathData verb markers (RemoteComposeJsonParser.parseFloat).
                const PV = { MOVE: 10, LINE: 11, QUADRATIC: 12, QUAD: 12,
                    CONIC: 13, CUBIC: 14, CLOSE: 15, DONE: 16 };
                const v = PV[value.slice(5).toUpperCase()];
                if (v !== undefined)
                    return (0, WireBuffer_1.asNanBits)(v);
            }
            if (/^[@$]matrices\./.test(value) && !value.includes(" ") && value.length > 10) {
                const name = value.slice(10);
                const m = this.matrices.get(name) ?? (this.variables.isMaterialised(name) ? this.variables.get(name) : undefined);
                if (m !== undefined)
                    return m;
            }
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
            if (key === "densityBehavior" && apiLevel < 8) {
                // RemoteComposeWriter.filterAndValidateTags: below apiLevel 8 the legacy
                // value (0) is dropped and anything else is refused.
                if (Number(value) !== 0) {
                    throw new NotImplementedComponent("densityBehavior is only supported in API level 8 or higher");
                }
                continue;
            }
            const tag = Header_1.HEADER_KEY_TO_TAG[key];
            if (tag === undefined)
                throw new NotImplementedComponent(`Unknown header tag: ${key}`);
            tags.push([tag, value]);
        }
        this.writer = new Writer_1.Writer(apiLevel, tags);
        this.expr = new Expr_1.ExpressionParser(this.writer, this.variables);
        // First use of a deferred variable materialises it, wherever that happens to be.
        this.variables.resolver = (_name, cmd) => this.materialiseVariable(cmd);
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
            if (FIRST_PASS_ONLY_TYPES.has(t))
                continue;
            this.parseComponent(item);
        }
        this.writer.containerEnd();
        return this.writer.encodeToByteArray();
    }
    parseModifiers(raw) {
        const out = [];
        // RecordingModifier keeps ONE width and ONE height modifier: a later fill, size,
        // weight or width updates the first one in place (setWidthModifier/setHeightModifier),
        // so `{"weight": 1}, "fillMaxWidth"` writes a single width modifier, at the weight's position.
        let widthAt = -1, heightAt = -1;
        const pushW = (e) => { if (widthAt >= 0)
            out[widthAt] = e;
        else {
            widthAt = out.length;
            out.push(e);
        } };
        const pushH = (e) => { if (heightAt >= 0)
            out[heightAt] = e;
        else {
            heightAt = out.length;
            out.push(e);
        } };
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
                    pushW((0, Writer_1.modWidth)(Writer_1.TYPE_FILL, v));
                    pushH((0, Writer_1.modHeight)(Writer_1.TYPE_FILL, v));
                }
                else if (k === "fillmaxwidth") {
                    pushW((0, Writer_1.modWidth)(Writer_1.TYPE_FILL, this.fbits(value)));
                }
                else if (k === "fillmaxheight") {
                    pushH((0, Writer_1.modHeight)(Writer_1.TYPE_FILL, this.fbits(value)));
                }
                else if (k === "width") {
                    pushW((0, Writer_1.modWidth)(Writer_1.TYPE_EXACT, this.fbits(value)));
                }
                else if (k === "height") {
                    pushH((0, Writer_1.modHeight)(Writer_1.TYPE_EXACT, this.fbits(value)));
                }
                else if (k === "spacedby") {
                    // Not a modifier on the wire: the row/column's own spacing parameter.
                    this.writer.spacedByBits = this.fbits(value);
                }
                else if (k === "ripple") {
                    out.push((w) => w.rippleModifier()); // RippleModifierOperation: the opcode alone
                }
                else if (k === "id") {
                    // Not a modifier on the wire: the component's own id (RecordingModifier.componentId).
                    this.writer.componentIdOverride = Math.trunc(Number(value));
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
                    out.push((0, Writer_1.modBorder)(Number(b.width), Number(b.cornerRadius), this.resolveColor(b.color), Math.trunc(Number(b.shape ?? 0)), this.apiLevel <= 7));
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
                    out.push((0, Writer_1.modVisibility)(this.resolveTextId(value)));
                }
                else if (k === "clip") {
                    // RemoteComposeJsonParser.parseShape: a number, or {"roundedRect": r}, is a
                    // rounded rectangle of radius r; {"roundedRect": {...}} takes its key as type.
                    let shape = (value ?? {});
                    if (typeof value === "number")
                        shape = { type: "roundedrect", radius: value };
                    else if (shape && typeof shape === "object" && !("type" in shape) && Object.keys(shape).length === 1) {
                        const [sk, sv] = Object.entries(shape)[0];
                        if (typeof sv === "number")
                            shape = { type: "roundedrect", radius: sv };
                        else if (sv && typeof sv === "object")
                            shape = { type: sk, ...sv };
                    }
                    const st = String(shape.type ?? "roundedrect").toLowerCase();
                    if (st === "rect") {
                        // ClipModifier writes a plain clip to the bounds; left/top/right/
                        // bottom are parsed into the RectShape but never written.
                        out.push((0, Writer_1.modClipRect)());
                        continue;
                    }
                    if (st === "circle") {
                        // ClipModifier.write has no branch for CircleShape: the reference
                        // writes nothing (upstream U9), so neither does this.
                        continue;
                    }
                    if (st !== "roundrect" && st !== "roundedrect") {
                        throw new NotImplementedComponent(`Unknown shape type: ${st}`);
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
                        pushW((0, Writer_1.modWidth)(Writer_1.TYPE_EXACT, numBits(value[0])));
                        pushH((0, Writer_1.modHeight)(Writer_1.TYPE_EXACT, numBits(value[1])));
                    }
                    else {
                        const v = this.fbits(value);
                        pushW((0, Writer_1.modWidth)(Writer_1.TYPE_EXACT, v));
                        pushH((0, Writer_1.modHeight)(Writer_1.TYPE_EXACT, v));
                    }
                }
                else if (k === "weight" || k === "horizontalweight") {
                    pushW((0, Writer_1.modWidth)(Writer_1.TYPE_WEIGHT, numBits(value)));
                }
                else if (k === "verticalweight") {
                    pushH((0, Writer_1.modHeight)(Writer_1.TYPE_WEIGHT, numBits(value)));
                }
                else if (k === "widthin") {
                    const wi = value;
                    out.push((0, Writer_1.modWidthIn)(this.fbits(wi[0]), this.fbits(wi[1])));
                }
                else if (k === "requiredwidthin" || k === "requiredheightin") {
                    const r = value;
                    out.push((0, Writer_1.modDimensionConstraints)(k === "requiredwidthin" ? 2 : 3, this.fbits(r[0]), this.fbits(r[1])));
                }
                else if (k === "dimensionconstraints") {
                    const dc = (value ?? {});
                    const type = optInt(dc.type, 0);
                    const min = this.fbits(dc.min), max = this.fbits(dc.max);
                    out.push((0, Writer_1.modDimensionConstraints)(type, min, max));
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
                    const tid = (field) => field in sem ? this.resolveTextId(sem[field]) : 0; // "@label" works, as upstream
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
                    if (b)
                        out.push((0, Writer_1.modPadding)(b[0], b[1], b[2], b[3]));
                }
                else if (k === "graphicslayer") {
                    // DefaultModifierParsers "graphicslayer": known keys (any case) parsed in
                    // JSON order, each through parseFloat, so an expression's ops are written
                    // in that order. The attributes live in a HashMap<Integer, Object>, which
                    // writes them back by ascending attribute id; a repeated id keeps its slot
                    // and takes the later value. Unknown keys are ignored.
                    if (!value || typeof value !== "object" || Array.isArray(value)) {
                        throw new NotImplementedComponent("graphicsLayer needs an object");
                    }
                    const attrs = new Map();
                    for (const [gk, gv] of Object.entries(value)) {
                        const id = GRAPHICS_LAYER_ATTR[gk.toLowerCase()];
                        if (id !== undefined)
                            attrs.set(id, this.fbits(gv));
                    }
                    const sorted = [...attrs.entries()].sort((a, b) => a[0] - b[0]);
                    out.push((0, Writer_1.modGraphicsLayer)(sorted));
                }
                else if (k === "include") {
                    // A referenced group of modifiers, replayed here (IncludeReferencedOperationsModifier).
                    const id = this.resolveTextId(value);
                    out.push((w) => w.includeReferencedOperations(id));
                }
                else if (k === "includemacro" || this.patterns.has(k)) {
                    // A template used as a modifier, a "style factory" (MacroCallModifier):
                    // {"includeMacro": {"pattern", "arguments"}} or {"<Template>": [args]}.
                    const call = k === "includemacro" ? (value ?? {}) : { pattern: key, arguments: value };
                    const id = k === "includemacro" ? this.writer.addText(String(call.pattern)) : this.patterns.get(k).id;
                    const args = (call.arguments ?? []).map((x) => this.resolveTextId(x));
                    out.push((w) => { w.patternInflation(id, args); w.containerEnd(); });
                }
                else if (this.parseMoreModifiers(k, value, out, pushW, pushH)) {
                    // handled
                }
                else {
                    throw new NotImplementedComponent(`modifier '${key}'`);
                }
            }
        }
        return out;
    }
    /**
     * DefaultModifierParsers entries json2rc lacked: animationSpec, zIndex, touch actions,
     * drawWithContent, layoutCompute, alignByBaseline, fillParentMax*, marquee and
     * collapsiblePriority. Returns false for a key that is none of them.
     */
    parseMoreModifiers(k, value, out, pushW, pushH) {
        const num = (v, d) => (typeof v === "number" ? v
            : typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : d);
        if (k === "animationspec") {
            let id = -1, md = 300, me = 1, vd = 300, ve = 1, enterFn = -1, exitFn = -1;
            let enter = 0, exit = 1, enterSeq = 0, exitSeq = 0;
            if (value && typeof value === "object" && !Array.isArray(value)) {
                const o = value;
                id = optInt(o.animationId, -1);
                md = num(o.motionDuration, 300);
                me = easingType("motionEasingType" in o ? o.motionEasingType : o.motionEasing, 1);
                vd = num(o.visibilityDuration, 300);
                ve = easingType("visibilityEasingType" in o ? o.visibilityEasingType : o.visibilityEasing, 1);
                enterFn = this.resolveFunctionId("enterFunctionId" in o ? o.enterFunctionId : o.enterFunction);
                exitFn = this.resolveFunctionId("exitFunctionId" in o ? o.exitFunctionId : o.exitFunction);
                enter = enumOrdinal(o.enterAnimation, ANIMATION_TYPES, enterFn !== -1 ? 8 : 0);
                exit = enumOrdinal(o.exitAnimation, ANIMATION_TYPES, exitFn !== -1 ? 8 : 1);
                enterSeq = enumOrdinal(o.enterSequence, SEQUENCE_TYPES, 0);
                exitSeq = enumOrdinal(o.exitSequence, SEQUENCE_TYPES, 0);
            }
            else {
                id = jsonGetInt(value, "animationSpec");
            }
            const enterPacked = (enter & 0xff) | ((enterSeq & 0xff) << 8);
            const exitPacked = (exit & 0xff) | ((exitSeq & 0xff) << 8);
            out.push((w) => w.animationSpec(id, md, me, vd, ve, enterPacked, exitPacked, enterFn, exitFn));
            return true;
        }
        if (k === "zindex") {
            const z = this.fbits(value);
            out.push((w) => { w.buffer.start(223); w.buffer.writeInt(z); });
            return true;
        }
        const touch = {
            ontouchdown: 219, touchdown: 219, ontouchup: 220, touchup: 220,
            ontouchcancel: 225, touchcancel: 225,
        };
        if (k in touch) {
            const op = touch[k];
            const actions = this.parseActions(value);
            out.push((w) => { w.buffer.start(op); for (const a of actions)
                a(w); w.containerEnd(); });
            return true;
        }
        if (k === "drawwithcontent") {
            out.push((w) => w.buffer.start(174));
            return true;
        }
        if (k === "layoutcompute") {
            // ComponentLayoutComputeModifier with an empty command list: LAYOUT_COMPUTE, the
            // bounds array it declares, and the end.
            const type = optInt((value ?? {}).type, 0);
            out.push((w) => {
                const boundsId = w.allocArrayId();
                w.buffer.start(238);
                w.buffer.writeInt(type);
                w.buffer.writeInt(boundsId);
                w.buffer.writeBoolean(false);
                w.addDynamicFloatArray(boundsId, (0, WireBuffer_1.floatToRawIntBits)(6));
                w.containerEnd();
            });
            return true;
        }
        if (k === "alignbybaseline") {
            out.push((w) => { w.buffer.start(237); w.buffer.writeInt((0, WireBuffer_1.asNanBits)(1)); w.buffer.writeInt(0); });
            return true;
        }
        if (k === "fillparentmaxwidth") {
            pushW((0, Writer_1.modWidth)(7, this.fbits(value)));
            return true;
        }
        if (k === "fillparentmaxheight") {
            pushH((0, Writer_1.modHeight)(8, this.fbits(value)));
            return true;
        }
        if (k === "fillparentmaxsize") {
            const v = this.fbits(value);
            pushW((0, Writer_1.modWidth)(7, v));
            pushH((0, Writer_1.modHeight)(8, v));
            return true;
        }
        if (k === "marquee") {
            if (!value || typeof value !== "object" || Array.isArray(value)) {
                throw new NotImplementedComponent("marquee needs an object");
            }
            const o = value;
            const it = optInt(o.iterations, 2147483647), mode = optInt(o.animationMode, 0);
            const f = [num(o.repeatDelayMillis, 1200), num(o.initialDelayMillis, 1200),
                num(o.spacing, 0), num(o.velocity, 0)];
            out.push((w) => {
                w.buffer.start(228);
                w.buffer.writeInt(it);
                w.buffer.writeInt(mode);
                for (const x of f)
                    w.buffer.writeFloat(x);
            });
            return true;
        }
        if (k === "collapsiblepriority") {
            let orientation = 0, priority;
            if (value && typeof value === "object" && !Array.isArray(value)) {
                orientation = String(value.orientation ?? "horizontal").toLowerCase() === "vertical" ? 1 : 0;
                priority = (0, WireBuffer_1.floatToRawIntBits)(num(value.priority, 0));
            }
            else if (Array.isArray(value)) {
                orientation = jsonGetInt(value[0], "collapsiblePriority[0]");
                priority = (0, WireBuffer_1.floatToRawIntBits)(Number(value[1]));
            }
            else {
                priority = this.fbits(value);
            }
            out.push((w) => { w.buffer.start(235); w.buffer.writeInt(orientation); w.buffer.writeInt(priority); });
            return true;
        }
        return false;
    }
    /** DefaultModifierParsers.resolveFunctionId: -1 when absent. */
    resolveFunctionId(val) {
        if (val === null || val === undefined)
            return -1;
        if (typeof val === "number")
            return Math.trunc(val);
        if (typeof val === "string") {
            const name = isVariableRef(val) ? variableNameFromRef(val) : val;
            const bits = this.variables.get(name);
            if (bits !== undefined) {
                if (isNanBits(bits))
                    return bits & 0x3fffff;
                return Math.trunc((0, WireBuffer_1.f32FromBits)(bits));
            }
            return this.resolveTextId(val);
        }
        return -1;
    }
    /**
     * RemoteComposeJsonParser.resolveIntegerVariable, as a "long": 2^32 + id for a variable
     * (the integer-expression mask bit), the plain value for a number.
     */
    resolveIntegerVariable(obj) {
        if (typeof obj === "number")
            return Math.trunc(obj);
        if (typeof obj === "string") {
            const name = isVariableRef(obj) ? variableNameFromRef(obj) : obj;
            if (this.variables.isMaterialised(name))
                return 0x100000000 + (this.variables.get(name) & 0x3fffff);
            const id = this.writer.addNamedInt(name, 0);
            this.variables.set(name, (0, WireBuffer_1.asNanBits)(id));
            return 0x100000000 + id;
        }
        throw new NotImplementedComponent(`Cannot resolve integer variable from ${JSON.stringify(obj)}`);
    }
    /** ExpressionParser.parseIntegerExpression: INTEGER_EXPRESSION (144); returns 2^32 + id. */
    parseIntegerExpression(expr) {
        const items = this.expr.infixToIntegerRpn(expr, (token) => {
            const name = isVariableRef(token) ? variableNameFromRef(token) : token;
            if (this.variables.isMaterialised(name)) {
                const bits = this.variables.get(name);
                if (isNanBits(bits))
                    return 0x100000000 + (bits & 0x3fffff);
                const v = this.expr.variableNanBits(token); // getVariableNan
                return isNanBits(v) ? 0x100000000 + (v & 0x3fffff) : Math.trunc((0, WireBuffer_1.f32FromBits)(v));
            }
            return this.resolveIntegerVariable(token);
        });
        let mask = 0;
        const vals = items.map((v, i) => {
            if (v >= 0x100000000) {
                mask |= (1 << i);
                return (v - 0x100000000) | 0;
            }
            return v | 0;
        });
        const id = this.writer.allocDataId();
        const b = this.writer.buffer;
        b.start(144);
        b.writeInt(id);
        b.writeInt(mask);
        b.writeInt(vals.length);
        for (const v of vals)
            b.writeInt(v);
        return 0x100000000 + id;
    }
    /**
     * RemoteComposeJsonParser.resolveIntegerId: a number is the id; a name (with or without
     * @/$) is an existing variable's id, or else a new named integer variable set to 0.
     */
    resolveIntegerId(obj) {
        if (typeof obj === "number")
            return Math.trunc(obj) | 0;
        return this.resolveIntegerVariable(obj) % 0x100000000;
    }
    /**
     * RemoteComposeJsonParser.parseFloatFunction: FUNCTION_DEFINE, its parameters bound as
     * variables for the body (parsed as first-pass commands), then the end. A visibility
     * animation always has at least six parameters: progress, w, h, x, y, id.
     */
    parseFloatFunction(command, visibility) {
        let params = Array.isArray(command.params) ? command.params : null;
        if (params === null && Array.isArray(command.parameters))
            params = command.parameters;
        const count = params !== null
            ? (visibility ? Math.max(params.length, 6) : params.length)
            : (visibility ? 6 : optInt(command.count, 0));
        const [fid, argIds] = this.writer.defineFloatFunction(count);
        const args = argIds.map(WireBuffer_1.asNanBits);
        if (command.name !== undefined && command.name !== null) {
            this.variables.set(String(command.name), (0, WireBuffer_1.floatToRawIntBits)(fid));
        }
        const saved = this.variables.snapshot();
        if (visibility && count >= 6) {
            const bind = [["progress", 0], ["w", 1], ["width", 1], ["h", 2],
                ["height", 2], ["x", 3], ["y", 4], ["id", 5], ["componentId", 5]];
            for (const [n, i] of bind)
                this.variables.set(n, args[i]);
        }
        if (params !== null) {
            const p0 = String(params[0]);
            if (visibility && params.length === 6 && (p0 === "id" || p0 === "componentId")) {
                this.variables.set(p0, args[5]);
                for (let i = 1; i < 6; i++)
                    this.variables.set(String(params[i]), args[i - 1]);
            }
            else {
                params.forEach((p, i) => this.variables.set(String(p), args[i]));
            }
        }
        if (!Array.isArray(command.commands)) {
            throw new NotImplementedComponent(`${command.type}: missing 'commands' array`);
        }
        const prev = this.inFirstPass;
        this.inFirstPass = true;
        for (const c of command.commands)
            this.parseCommand(c);
        this.inFirstPass = prev;
        this.writer.containerEnd();
        this.variables.restore(saved);
    }
    /** createOffscreenBitmap: DATA_BITMAP of type RAW8888, encoding offscreen, 1x1, no payload. */
    createOffscreenBitmap(command) {
        const id = this.writer.allocDataId();
        this.writer.addBitmap(id, 1, 1, new Uint8Array(0), 3, 4);
        const name = command.name ?? command.id ?? command.varName ?? command.value;
        if (name !== undefined && name !== null)
            this.variables.set(String(name), (0, WireBuffer_1.floatToRawIntBits)(id));
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
            // [all], [horizontal, vertical] or [start, top, end, bottom] (extra values are
            // ignored); any other length writes no padding at all, as in the reference.
            if (value.length === 2) {
                const h = numBits(value[0]), v = numBits(value[1]);
                return [h, v, h, v];
            }
            if (value.length >= 4) {
                return [numBits(value[0]), numBits(value[1]), numBits(value[2]), numBits(value[3])];
            }
            if (value.length === 1) {
                const v = numBits(value[0]);
                return [v, v, v, v];
            }
            return null;
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
            this.writer.startFlow(hAlignOf(component, "start"), vAlignOf(component, "top"), mods, optInt(component.maxColumns, 2147483647), 0.0, optInt(component.maxLines, 2147483647));
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
        if (ctype === "collapsiblecolumn" || ctype === "collapsiblerow") {
            this.writer.startCollapsible(ctype === "collapsiblecolumn", hAlignOf(component, "center"), vAlignOf(component, "center"), mods);
            for (const k of kids)
                this.parseComponent(k);
            this.writer.endContainer();
            return;
        }
        if (ctype === "statelayout") {
            // DefaultComponentParsers "stateLayout": the index (an integer variable) under any
            // of four names; each child is one state.
            const idx = "indexId" in component ? component.indexId
                : "stateId" in component ? component.stateId
                    : "index" in component ? component.index : component.stateIndex;
            if (idx === undefined)
                throw new NotImplementedComponent("stateLayout: missing indexId");
            const indexId = this.resolveIntegerId(idx);
            this.writer.startStateLayout(indexId, mods);
            for (const k of kids)
                this.parseComponent(k);
            this.writer.endContainer();
            return;
        }
        if (ctype === "custom") {
            const props = [];
            for (const p of (component.properties ?? [])) {
                const dataType = jsonGetInt(p.dataType, "custom dataType") & 0xffff;
                const type = jsonGetInt(p.type, "custom type") & 0xffff;
                if ((dataType & 1) === 0)
                    props.push([type, dataType, jsonGetInt(p.value, "custom value"), false]);
                else
                    props.push([type, dataType, Number(p.value), true]);
            }
            const configId = this.writer.addText(component.config === undefined || component.config === null
                ? "" : String(component.config));
            this.writer.startCustom(configId, props, mods);
            for (const k of kids)
                this.parseComponent(k);
            this.writer.endContainer();
            return;
        }
        if (ctype === "createfloatfunction" || ctype === "floatfunction"
            || ctype === "definevisibilityanimation") {
            if (this.inFirstPass)
                this.parseFloatFunction(component, ctype === "definevisibilityanimation");
            return;
        }
        if (ctype === "createoffscreenbitmap") {
            if (this.inFirstPass)
                this.createOffscreenBitmap(component);
            return;
        }
        if (ctype === "rem") {
            this.writer.rem(remText(component));
            return;
        }
        if (ctype === "text") {
            this.parseText(component, mods);
            return;
        }
        if (this.parseLoomComponent(ctype, component, kids))
            return;
        if (ctype === "canvas") {
            this.writer.startCanvas(mods, this.apiLevel);
            for (const cmd of component.commands ?? [])
                this.parseCommand(cmd);
            this.writer.endCanvas(this.apiLevel);
            return;
        }
        throw new NotImplementedComponent(`component type '${ctype}'`);
    }
    parseKids(kids) {
        for (const k of kids ?? [])
            this.parseComponent(normalizeComponent(k));
    }
    /**
     * Loom: component templates, as DefaultComponentParsers' definePattern, patternArgument,
     * patternBlock, patternInflation and patternForEach, plus calls by template name.
     * Returns false when the component is none of these.
     */
    parseLoomComponent(ctype, component, kids) {
        if (ctype === "definepattern") {
            if (this.inFirstPass)
                this.definePattern(component);
            return true;
        }
        if (ctype === "referencedoperations") {
            // DefaultComponentParsers "referencedoperations": a fresh id, the children, then the
            // group's own modifiers (parsed again here, after the children, as the reference),
            // and the name bound to the id. Defined once, in the first pass.
            if (!this.inFirstPass && this.variables.isMaterialised(String(component.name)))
                return true;
            const id = this.writer.allocDataId();
            this.writer.referencedOperationsStart(id);
            this.parseKids(kids);
            for (const m of this.parseModifiers(component.modifiers))
                m(this.writer);
            this.writer.containerEnd();
            this.variables.set(String(component.name), (0, WireBuffer_1.floatToRawIntBits)(id));
            return true;
        }
        if (ctype === "modifier") {
            // DefaultComponentParsers "modifier": the component's modifiers written as they are,
            // which is how a style template's body emits its modifiers.
            for (const m of this.parseModifiers(component.modifiers))
                m(this.writer);
            return true;
        }
        if (ctype === "include") {
            this.writer.includeReferencedOperations(this.resolveTextId(component.value));
            return true;
        }
        if (ctype === "patternargument") {
            this.writer.patternArgument(Math.trunc(Number(component.parameterIndex)));
            return true;
        }
        if (ctype === "patternblock") {
            this.writer.patternBlock(Math.trunc(Number(component.parameterIndex)));
            this.parseKids(kids);
            this.writer.containerEnd();
            return true;
        }
        if (ctype === "patterninflation") {
            const id = this.writer.addText(String(component.pattern));
            const args = (component.arguments ?? []).map((a) => this.resolveTextId(a));
            this.writer.patternInflation(id, args);
            this.parseKids(kids);
            this.writer.containerEnd();
            return true;
        }
        if (ctype === "patternforeach") {
            const collectionId = this.resolveTextId(component.collection);
            const localName = String(component.localItem);
            const localId = this.writer.nextLocalId();
            const prev = this.variables.snapshot();
            this.variables.set(localName, (0, WireBuffer_1.floatToRawIntBits)(localId));
            this.writer.patternForEach(collectionId, localId);
            this.parseKids(kids);
            this.writer.containerEnd();
            this.variables.restore(prev);
            return true;
        }
        const pattern = this.patterns.get(ctype);
        if (pattern) {
            // A call: arguments by position, or by parameter name (a missing one is 0).
            const argIds = component.arguments !== undefined
                ? pattern.params.map((_p, i) => (i < component.arguments.length ? this.resolveTextId(component.arguments[i]) : 0))
                : pattern.params.map((p) => (p in component ? this.resolveTextId(component[p]) : 0));
            this.writer.patternInflation(pattern.id, argIds);
            this.parseKids(kids);
            this.writer.containerEnd();
            return true;
        }
        return false;
    }
    /** DefaultComponentParsers "definepattern" (first pass only). */
    definePattern(component) {
        const name = String(component.name);
        if (this.patterns.has(name.toLowerCase())) {
            throw new NotImplementedComponent(`definePattern: '${name}' is already defined`);
        }
        const params = (component.parameters ?? []).map(String);
        const saved = this.variables.snapshot();
        // Each parameter is a fresh data id, visible in the body as a NaN-boxed variable.
        const paramIds = params.map((p) => {
            const id = this.writer.allocDataId();
            this.variables.set(p, (0, WireBuffer_1.asNanBits)(id));
            return id;
        });
        const patternId = this.writer.definePattern(name, paramIds);
        // Locals: pattern-local ids, bound as plain floats holding the id (as the reference).
        for (const local of component.locals ?? []) {
            this.variables.set(String(local), (0, WireBuffer_1.floatToRawIntBits)(this.writer.nextLocalId()));
        }
        this.parseKids(component.children ?? []);
        this.writer.endPatternDefine();
        this.variables.restore(saved);
        this.patterns.set(name.toLowerCase(), { id: patternId, params });
    }
    /** `{"drawRect": {...}}` normalises the same way a component does. */
    normalizeCommand(c) {
        if (!("type" in c) && Object.keys(c).length === 1) {
            const key = Object.keys(c)[0];
            const val = c[key];
            const out = { type: key };
            if (Array.isArray(val))
                out.commands = val;
            else if (val && typeof val === "object") {
                // RemoteComposeJsonParser.parseCommand: a nested `type` is moved to `source`,
                // so it never replaces the command name.
                for (const [k, v] of Object.entries(val)) {
                    if (k === "type")
                        out.source = v;
                    else
                        out[k] = v;
                }
            }
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
            // Written as "shader" or "runtimeShader" (any case, which is how the alias got
            // here); the reference takes runtimeShader first when both are present.
            const keys = Object.keys(src);
            const k = keys.find((x) => x.toLowerCase() === "runtimeshader") ?? keys.find((x) => x.toLowerCase() === "shader");
            ints.push(PB.SHADER, this.parseShader(k === undefined ? undefined : src[k]));
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
        else if (key === "radialGradient")
            this.radialGradient(src.radialGradient, ints);
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
    /**
     * RemoteComposeJsonParser.parseShader. A number is a shader id (0 clears the shader).
     * An AGSL runtime shader is a string, or {agsl | shader | source, uniforms}; it becomes
     * DATA_SHADER and its id is returned. Uniforms: an array is a float vector, a value for
     * a name declared `uniform shader <name>` is a bitmap (an input texture), anything else
     * one float — a literal, a variable reference or an expression, which animates it.
     */
    parseShader(value) {
        if (value === null || value === undefined)
            return 0;
        if (typeof value === "number")
            return Math.trunc(value);
        let source = "";
        let uniforms = null;
        if (typeof value === "string") {
            source = value;
        }
        else if (typeof value === "object" && !Array.isArray(value)) {
            const v = value;
            source = String(v.agsl ?? v.shader ?? v.source ?? "");
            if (v.uniforms && typeof v.uniforms === "object" && !Array.isArray(v.uniforms))
                uniforms = v.uniforms;
        }
        else {
            throw new NotImplementedComponent(`paint shader: expected a shader id, an AGSL string or {agsl, uniforms}, got ${JSON.stringify(value)}`);
        }
        if (!source)
            return 0; // the reference returns 0 (no shader) for an empty source
        // createShader interns the source before the uniforms are parsed (an expression
        // uniform writes its ops after the text); commit allocates the shader id last.
        const textId = this.writer.addText(source);
        const floats = [];
        const bitmaps = [];
        for (const [name, u] of Object.entries(uniforms ?? {})) {
            if (Array.isArray(u))
                floats.push([name, u.map((x) => this.fbits(x))]);
            else if (source.includes("uniform shader " + name))
                bitmaps.push([name, this.shaderBitmap(u)]);
            else
                floats.push([name, [this.fbits(u)]]);
        }
        return this.writer.addShader(source, floats, [], bitmaps, textId);
    }
    /**
     * A `uniform shader` input. The reference resolves it like a text id, so a number is the
     * bitmap id as written. A name from resources.bitmaps ("@photo") is resolved to that
     * bitmap here — the reference would intern the name as a string instead, which no
     * document can mean — and anything else goes the reference's way.
     */
    shaderBitmap(value) {
        if (typeof value === "string") {
            const name = /^[@$]/.test(value) ? value.slice(1) : value;
            const hit = this.bitmaps.get(name);
            if (hit !== undefined)
                return hit;
        }
        return this.resolveTextId(value);
    }
    /**
     * RemoteComposeJsonParser.applyRadialGradient. With any focal key it is the two-circle
     * form (RADIAL_GRADIENT2): the end circle falls back to centerX/centerY/radius and the
     * start centre to the end centre. Coordinates are parsed end circle first, then the
     * start circle, and written start first. The tile mode is optInt, as for linear.
     */
    radialGradient(g, ints) {
        if (!g || typeof g !== "object")
            throw new NotImplementedComponent("radialGradient needs an object");
        const head = this.gradientColors(g);
        const tileMode = optInt(g.tileMode, 0);
        if (FOCAL_RADIAL_KEYS.some((k) => k in g)) {
            const keys = (dflt, ...ks) => {
                for (const k of ks)
                    if (k in g)
                        return this.fbits(g[k]);
                return dflt;
            };
            const endX = keys((0, WireBuffer_1.floatToRawIntBits)(0), "endX", "centerX");
            const endY = keys((0, WireBuffer_1.floatToRawIntBits)(0), "endY", "centerY");
            const endR = keys((0, WireBuffer_1.floatToRawIntBits)(0), "endR", "endRadius", "radius");
            const startX = keys(endX, "startX", "focalX");
            const startY = keys(endY, "startY", "focalY");
            const startR = keys((0, WireBuffer_1.floatToRawIntBits)(0), "startR", "startRadius", "focalR", "focalRadius");
            ints.push(PB_GRADIENT | (GRAD_RADIAL2 << 16), ...head, startX, startY, startR, endX, endY, endR, tileMode);
        }
        else {
            for (const k of ["centerX", "centerY", "radius"]) {
                if (!(k in g))
                    throw new NotImplementedComponent(`radialGradient needs ${k}`);
            }
            const cx = this.fbits(g.centerX), cy = this.fbits(g.centerY), r = this.fbits(g.radius);
            ints.push(PB_GRADIENT | (GRAD_RADIAL << 16), ...head, cx, cy, r, tileMode);
        }
    }
    /** The colour count and mask, the colours, and the stops, as every gradient writes them. */
    gradientColors(g) {
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
        const stops = Array.isArray(g.stops) ? g.stops : undefined;
        const out = [(((idMask << 16) | colors.length) & 0xffffffff) | 0, ...colors];
        out.push(stops ? stops.length : 0);
        if (stops)
            for (const st of stops)
                out.push((0, WireBuffer_1.floatToRawIntBits)(Number(st)));
        return out;
    }
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
            const vo = obj;
            if (kind === "textmerge") {
                // {"type": "textMerge", "id1": a, "id2": b}: each side resolved as a text
                // id (and so may itself be a textMerge or textFromFloat), then a fresh id.
                const id1 = this.resolveTextId(vo.id1);
                const id2 = this.resolveTextId(vo.id2);
                return this.writer.textMerge(id1, id2);
            }
            if (kind === "textfromfloat") {
                // `after`/`before` are the reference's older spellings of decimal/whole.
                const val = this.fbits(vo.value);
                const after = "decimal" in vo ? optInt(vo.decimal, 3) : optInt(vo.after, 3);
                const before = "whole" in vo ? optInt(vo.whole, 0) : optInt(vo.before, 0);
                return this.writer.addTextFromFloat(val, before, after, optInt(vo.flags, 0));
            }
            throw new NotImplementedComponent(`Unsupported text object type: ${kind}`);
        }
        const text = String(obj);
        if (text.startsWith("$colors.") || text.startsWith("@colors.")) {
            const hit = this.colors.get(text.slice(8));
            if (hit !== undefined)
                return hit;
        }
        if (text.includes("@") && /[+\-*/%]/.test(text)) {
            // RemoteComposeJsonParser.resolveTextId: an integer expression; its id.
            return this.parseIntegerExpression(text) % 0x100000000;
        }
        if (isVariableRef(text)) {
            const name = variableNameFromRef(text); // "@vars.x" names x, as getVariableNameFromRef
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
            const isHost = t === "hostaction" || t === "hostnamedaction"
                || t === "hostmetadataaction";
            if (isHost && !("name" in a)) {
                // DefaultModifierParsers: no name means HostAction(actionId[, metadataId]).
                // "metadata" (a literal string) is an EXTENSION, proposed in m5Tab
                // docs/RC_SYSTEM_VARIABLES.md: {"type": "hostAction", "actionId": 0,
                // "metadata": "system.backlight=cycle"}.
                if (!("actionId" in a)) {
                    throw new NotImplementedComponent(`${t} needs a "name" or an "actionId"`);
                }
                const actionId = Number(a.actionId);
                if ("metadata" in a) {
                    const metadata = String(a.metadata);
                    actions.push((w2) => (0, Writer_1.hostAction)(actionId, w2.addText(metadata))(w2));
                }
                else {
                    actions.push((0, Writer_1.hostAction)(actionId, "metadataId" in a ? Number(a.metadataId) : -1));
                }
            }
            else if (isHost) {
                const name = String(a.name);
                const value = "value" in a ? String(a.value) : null;
                // HostAction(name) leaves both mType and mValueId at -1; STRING_TYPE is only
                // the default for actionType on the branch that carries a value.
                const type = value !== null
                    ? Number(a.actionType ?? Writer_1.HOST_ACTION_STRING_TYPE) : -1;
                // The name and the value are resolved at DIFFERENT times, and it is not an
                // oversight: the reference parser resolves the value immediately, but hands
                // HostAction the name as a String, so the name's addText runs later. The
                // value's DATA_TEXT therefore lands BEFORE the container op and the name's
                // after it. Resolving both here, or both in the callback, shifts every id
                // that follows and changes the bytes - and it looks correct whenever name
                // and value are the same string, because the text cache then collapses them
                // into one op.
                const valueId = value !== null ? this.writer.addText(value) : -1;
                actions.push((w2) => {
                    const textId = w2.addText(name);
                    (0, Writer_1.hostNamedAction)(textId, type, valueId)(w2);
                });
            }
            else if (t === "valuefloatexpressionchange") {
                if (target === undefined || target === null) {
                    throw new NotImplementedComponent('valueFloatExpressionChange needs a "target"');
                }
                const targetId = this.resolveTextId(target);
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
                actions.push((0, Writer_1.valueFloatChange)(this.resolveTextId(target), this.fbits(a.value)));
            }
            else if (t === "valueintegerchange") {
                if (target === undefined || target === null) {
                    throw new NotImplementedComponent('valueIntegerChange needs a "target"');
                }
                actions.push((0, Writer_1.valueIntegerChange)(this.resolveTextId(target), Number(a.value)));
            }
            else if (t === "valuestringchange") {
                if (target === undefined || target === null) {
                    throw new NotImplementedComponent('valueStringChange needs a "target"');
                }
                const targetId = this.resolveTextId(target);
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
                // DefaultModifierParsers: the target as an integer variable (2^32 + id), the
                // value as an integer expression string or a literal long.
                if (target === undefined)
                    throw new NotImplementedComponent("valueIntegerExpressionChange: missing target");
                this.resolveTextId(target); // parseAction resolves targetId for every action
                const intTarget = this.resolveIntegerVariable(target);
                const value = "value" in a ? a.value : a.expression;
                const exprId = typeof value === "string" ? this.parseIntegerExpression(value)
                    : jsonGetInt(value, "valueIntegerExpressionChange value");
                actions.push((0, Writer_1.valueIntegerExpressionChange)(intTarget, exprId));
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
    /**
     * An SVG string declared as a path (resources.paths, the `path` command). The reference
     * writes an EMPTY DATA_PATH here (upstream U8: DEFAULT_PLATFORM.pathToFloatArray only
     * understands RemotePathBase, and these hand it a PathParser or a String), so a path
     * declared this way never draws on any player. This converter writes the parsed path,
     * as drawPath does, and differs from the reference's bytes in that one op.
     */
    // Java's DEFAULT_PLATFORM.pathToFloatArray only understands RemotePathBase and returns an
    // empty array for a String, so an SVG string here becomes an empty DATA_PATH (U11). Matched
    // for byte parity; drawPath with a string, or the op-list form, draws the path.
    addPathString(_value) {
        return this.writer.addPathData([]);
    }
    /** One side of a themed colour that is not a pair of references: Java's parseColor (a
     *  "#..." value, or the id a "@colors.x" names, used as a value). */
    themedSide(s) {
        return /^[@$]colors\./.test(s) ? this.resolveColor(s) : parseColor(s);
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
        // RemoteComposeJsonParser.parseColor: a variable reference is the variable's id (a
        // pattern parameter is one: remapped to each call's colour at playback).
        if (typeof value === "string" && /^[@$]/.test(value)) {
            const bits = this.variables.get(value.slice(1));
            if (bits !== undefined) {
                if (((bits >>> 23) & 0xff) === 0xff && (bits & 0x7fffff) !== 0)
                    return (0, WireBuffer_1.idFromNanBits)(bits);
                return Math.trunc((0, WireBuffer_1.f32FromBits)(bits));
            }
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
        if (t === "wakein") {
            w.wakeIn(f("seconds"));
            return;
        }
        if (t === "translate") {
            w.matrixTranslate(f("dx"), f("dy"));
            return;
        }
        if (t === "scale") {
            // As for rotate, the pivot is parsed before sx and sy (the reference reads it
            // into locals first).
            if ("pivotX" in command || "centerX" in command) {
                const px = this.fbits("pivotX" in command ? command.pivotX : command.centerX);
                const py = this.fbits("pivotY" in command ? command.pivotY : command.centerY);
                w.matrixScale(f("sx"), f("sy"), px, py);
            }
            else {
                w.matrixScale(f("sx"), f("sy"));
            }
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
        if (t === "clippath") {
            w.clipPath(this.resolvePath(command.path));
            return;
        }
        if (t === "drawtextonpath") {
            // Keys match RemoteComposeJsonParser's `drawtextonpath` case exactly.
            const off = (k) => (k in command
                ? this.fbits(command[k]) : (0, WireBuffer_1.floatToRawIntBits)(0));
            w.drawTextOnPath(this.resolveTextId(command.text), this.resolvePath(command.path), off("hOffset"), off("vOffset"));
            return;
        }
        if (t === "adddatalist" || t === "idlist" || t === "datalistids") {
            // `id` is ours, not the reference's: the reference parser builds the list and
            // throws the id away, so a document parsed by it can never refer to the list
            // afterwards and textLookup is unreachable. The key is bookkeeping only — the
            // emitted ops are identical either way.
            const ids = command.list.map((v) => this.resolveTextId(v));
            const listId = w.addList(ids);
            // The store holds raw float bits, as it does for every other variable.
            if (command.id != null) {
                this.variables.set(String(command.id), (0, WireBuffer_1.floatToRawIntBits)(listId));
            }
            return;
        }
        if (t === "textlookup") {
            const arr = command.array;
            const arrId = (typeof arr === "string" && arr.startsWith("@"))
                ? Math.trunc((0, WireBuffer_1.f32FromBits)(this.variables.get(arr.slice(1)) ?? 0))
                : Number(arr);
            const idxBits = ("index" in command)
                ? this.fbits(command.index) : (0, WireBuffer_1.floatToRawIntBits)(0);
            const textId = w.textLookup(arrId, idxBits);
            if (command.varName != null) {
                this.variables.set(String(command.varName), (0, WireBuffer_1.floatToRawIntBits)(textId));
            }
            return;
        }
        if (t === "rem") {
            // Four spellings, in the reference's order of preference; an absent one is an
            // empty remark rather than an error — a comment is not worth failing a build over.
            const m = command.text ?? command.value ?? command.message ?? command.comment ?? "";
            w.rem(String(m));
            return;
        }
        if (t === "path" || t === "pathdata") {
            // A path declared from data: an array of floats (each through parseFloat, so
            // verbs can be written "NaN"-boxed or as expressions) or an SVG string.
            const data = command.data;
            if (data === undefined || data === null) {
                throw new NotImplementedComponent(`'${t}' needs \`data\``);
            }
            const pid = Array.isArray(data)
                ? w.addPathData(data.map((v) => ({ bits: this.fbits(v) })))
                : this.addPathString(data);
            if (command.id !== undefined && command.id !== null) {
                this.paths.set(String(command.id), pid);
            }
            return;
        }
        if (t === "pathcreate") {
            const pid = w.pathCreate(f("x"), f("y"));
            if (command.id !== undefined && command.id !== null) {
                this.paths.set(String(command.id), pid);
            }
            return;
        }
        if (t === "pathexpression") {
            // start/end/count name the sweep of the parameter the expressions see as a[0];
            // the reference calls them min/max on the wire.
            //
            // expressionY and count are required even though the op allows a null Y, because
            // the reference JSON parser throws without them - accepting them here would
            // produce bytes no reference run could be compared against.
            const xOps = this.expr.infixToRpn(String(command.expressionX));
            const yOps = this.expr.infixToRpn(String(command.expressionY));
            const pid = w.pathExpression(Number(command.flags ?? 0), f("start"), f("end"), f("count"), xOps, yOps);
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
            const COND = { gt: 4, ge: 5, lt: 2, le: 3, eq: 0, ne: 1 }; // ne: EXTENSION
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
        if (this.parseMoreCommands(t, command, f))
            return;
        throw new NotImplementedComponent(`canvas command '${t}'`);
    }
    /** A path id: a number as-is, else a name/reference/SVG string (parsePath). */
    resolvePathId(v) {
        if (typeof v === "number")
            return Math.trunc(v);
        if (v === undefined)
            throw new NotImplementedComponent("missing path");
        return this.resolvePath(v);
    }
    /** A float-holding variable (plain float id), as the reference's mVariables.put(name, (float) id). */
    bindPlain(name, id) {
        if (name !== undefined && name !== null)
            this.variables.set(String(name), (0, WireBuffer_1.floatToRawIntBits)(id));
    }
    bindBits(name, bits) {
        if (name !== undefined && name !== null)
            this.variables.set(String(name), bits);
    }
    /**
     * RemoteComposeJsonParser.parseCommand cases json2rc lacked: functions, attributes,
     * text ops, lookups, dynamic lists, matrices, path tween/combine, actions and the
     * small one-op commands. Returns false for an unknown command.
     */
    parseMoreCommands(t, command, f) {
        const w = this.writer;
        const fOpt = (k, d) => (k in command ? f(k) : (0, WireBuffer_1.floatToRawIntBits)(d));
        const req = (k) => {
            if (!(k in command))
                throw new NotImplementedComponent(`${command.type}: missing required field '${k}'`);
            return command[k];
        };
        switch (t) {
            case "createfloatfunction":
            case "floatfunction":
                this.parseFloatFunction(command, false);
                return true;
            case "definevisibilityanimation":
                this.parseFloatFunction(command, true);
                return true;
            case "callfloatfunction": {
                const fnId = this.resolveTextId(req("id"));
                const args = req("args");
                if (!Array.isArray(args))
                    throw new NotImplementedComponent("callFloatFunction: 'args' must be an array");
                w.callFloatFunction(fnId, args.map((a) => this.fbits(a)));
                return true;
            }
            case "setarrayvalue": {
                const id = this.resolveTextId(req("id"));
                const index = f("index"), value = f("value");
                w.setArrayValue(id, index, value);
                return true;
            }
            case "dynamicfloatarray":
            case "dynamicfloatlist": {
                const next = w.allocDataId(); // optInt("id", nextId()): allocated either way
                const listId = "id" in command ? optInt(command.id, next) : next;
                const size = fOpt("size", 0);
                this.bindPlain(command.name, listId);
                w.addDynamicFloatArray(listId, size);
                return true;
            }
            case "updatedynamicfloatlist": {
                const listBits = f("list");
                const listId = Math.trunc((0, WireBuffer_1.f32FromBits)(listBits)) | 0;
                const index = f("index"), value = f("value");
                w.setArrayValue(listId, index, value);
                return true;
            }
            case "drawtweenpath": {
                const p1 = this.resolvePathId(req("path1")), p2 = this.resolvePathId(req("path2"));
                const tween = f("tween");
                const start = fOpt("start", 0), stop = fOpt("stop", 1);
                w.drawTweenPath(p1, p2, tween, start, stop);
                return true;
            }
            case "pathtween":
            case "pathcombine": {
                const p1 = this.resolvePathId(req("path1")), p2 = this.resolvePathId(req("path2"));
                const id = t === "pathtween" ? w.pathTween(p1, p2, f("tween"))
                    : w.pathCombine(p1, p2, optInt(command.op, 0));
                if (command.id !== undefined && command.id !== null)
                    this.paths.set(String(command.id), id);
                return true;
            }
            case "skew": {
                const sx = f("skewX"), sy = f("skewY");
                w.matrixSkew(sx, sy);
                return true;
            }
            case "matrixfrompath": {
                const pathId = this.resolvePathId(req("path"));
                const fraction = f("fraction"), vOffset = fOpt("vOffset", 0);
                w.matrixFromPath(pathId, fraction, vOffset, optInt(command.flags, 0));
                return true;
            }
            case "matrixconstant": {
                const values = req("values");
                const bits = values.map((item) => {
                    if (typeof item === "string" && item.startsWith("matrix:")) {
                        const i = MATRIX_OPS.indexOf(item.slice(7));
                        return i >= 0 ? (0, WireBuffer_1.asNanBits)(0x320000 + i + 1) : 0;
                    }
                    return this.fbits(item);
                });
                const name = typeof command.name === "string" ? command.name : null;
                let matrixId;
                if (optBoolean(command.named, false) && name !== null) {
                    // (int) createNamedVariable(...) casts the NaN-boxed id to int: always 0 (upstream).
                    w.setFloatName(w.allocDataId(), name);
                    matrixId = 0;
                }
                else {
                    const next = w.allocDataId();
                    matrixId = "id" in command ? optInt(command.id, next) : next;
                }
                if (name !== null) {
                    this.variables.set(name, (0, WireBuffer_1.asNanBits)(matrixId));
                    this.matrices.set(name, (0, WireBuffer_1.asNanBits)(matrixId));
                }
                w.matrixExpression(matrixId, bits);
                return true;
            }
            case "matrixvectormath":
            case "matrixmultiply": {
                const matrix = f("matrix");
                const type = t === "matrixmultiply" ? optInt(command.mType, 0)
                    : optInt(command.type, optInt(command.mType, 0));
                const from = req("from").map((x) => this.fbits(x));
                const named = optBoolean(command.named, false);
                const outIds = req("out").map((item) => {
                    if (typeof item === "string" || t === "matrixmultiply") {
                        const n = String(item);
                        const id = w.allocDataId();
                        if (named)
                            w.setFloatName(id, n);
                        this.variables.set(n, (0, WireBuffer_1.asNanBits)(id));
                        return id;
                    }
                    return Math.trunc(Number(item));
                });
                w.matrixVectorMath(type & 0xffff, outIds, matrix, from);
                return true;
            }
            case "textmeasure": {
                const textId = this.resolveTextId(req("text"));
                this.bindBits(command.name, w.textMeasure(textId, optInt(command.mode, 0)));
                return true;
            }
            case "textlength": {
                const textId = this.resolveTextId(req("text"));
                this.bindBits(command.name, w.textLength(textId));
                return true;
            }
            case "colorattribute": {
                const type = optInt(command.attribute, optInt(command.colorType, optInt(command.type, 0)));
                this.bindBits(command.name, w.colorAttribute(optInt(command.color, 0), type & 0xffff));
                return true;
            }
            case "imageattribute":
            case "bitmapattribute": {
                const b = req("bitmap");
                const ref = typeof b === "string" && /^[@$]/.test(b) ? this.bitmaps.get(b.slice(1)) : undefined;
                const bitmapId = ref ?? this.resolveTextId(b);
                this.bindBits(command.name, w.imageAttribute(bitmapId, optInt(command.attribute, 0) & 0xffff));
                return true;
            }
            case "textattribute": {
                const textId = this.resolveTextId(req("text"));
                this.bindBits(command.name, w.textAttribute(textId, optInt(command.attribute, 0) & 0xffff));
                return true;
            }
            case "timeattribute": {
                const args = Array.isArray(command.args) ? command.args.map((a) => jsonGetInt(a, "timeAttribute args")) : [];
                this.bindBits(command.name, w.timeAttribute(optInt(command.timeId, 0), optInt(command.type, 0) & 0xffff, args));
                return true;
            }
            case "textsubtext":
            case "texttransform": {
                const txt = this.resolveTextId(req("text"));
                const start = f("start"), len = f("len");
                let id;
                if (t === "textsubtext")
                    id = w.textSubtext(txt, start, len);
                else {
                    const opStr = String(req("operation")).toLowerCase();
                    const op = opStr === "uppercase" ? 1 : opStr === "lowercase" ? 2
                        : opStr === "capitalize" ? 3 : optInt(command.operation, 0);
                    id = w.textTransform(txt, start, len, op);
                }
                this.bindPlain(command.varName, id);
                return true;
            }
            case "idlookup": {
                const arr = f("array"), index = f("index");
                this.bindPlain(command.varName, w.idLookup(arr, index));
                return true;
            }
            case "maplookup":
            case "datamaplookup": {
                const mapId = this.resolveTextId(req("map"));
                const strId = w.addText(String(req("key")));
                this.bindPlain(command.varName, w.mapLookup(mapId, strId));
                return true;
            }
            case "textlookupint": {
                const id = this.resolveTextId(req("id"));
                const dataSet = f("dataSet");
                const index = this.resolveTextId(req("index"));
                w.textLookupInt(id, dataSet, index);
                return true;
            }
            case "runaction":
            case "runactions":
                w.runActionsStart();
                for (const c of command.commands ?? [])
                    this.parseCommand(c);
                w.containerEnd();
                return true;
            case "performhaptic":
                w.buffer.start(177);
                w.buffer.writeInt(jsonGetInt(req("constant"), "performHaptic"));
                return true;
            case "playsound": {
                const id = this.resolveTextId(req("id"));
                w.buffer.start(141);
                w.buffer.writeInt(id);
                return true;
            }
            case "clickarea": {
                const id = this.resolveTextId(req("id"));
                const cd = command.contentDescription;
                const l = f("left"), tp = f("top"), r = f("right"), b = f("bottom");
                const cdId = cd === undefined || cd === null ? 0 : w.addText(String(cd));
                const md = command.metadata;
                const mdId = md === undefined || md === null ? 0 : w.addText(String(md));
                w.buffer.start(64);
                w.buffer.writeInt(id);
                w.buffer.writeInt(cdId);
                for (const x of [l, tp, r, b])
                    w.buffer.writeInt(x);
                w.buffer.writeInt(mdId);
                return true;
            }
            case "debugmessage": {
                const msg = String(req("message"));
                const val = this.fbits(command.value);
                const flag = optInt(command.flag, 0);
                const textId = w.addText(msg);
                w.buffer.start(179);
                w.buffer.writeInt(textId);
                w.buffer.writeInt(val);
                w.buffer.writeInt(flag);
                return true;
            }
            case "createoffscreenbitmap":
                this.createOffscreenBitmap(command);
                return true;
            case "drawtobitmap":
            case "drawonbitmap": {
                const bm = "bitmap" in command ? command.bitmap : "bitmapId" in command ? command.bitmapId : req("value");
                const bitmapId = this.resolveTextId(bm);
                drawOnBitmap(w, bitmapId, optInt(command.mode, 0), optInt(command.color, 0));
                return true;
            }
            case "drawcomponenttobitmap": {
                const bm = "bitmap" in command ? command.bitmap : "bitmapId" in command ? command.bitmapId : req("value");
                const bitmapId = this.resolveTextId(bm);
                let mode = 0, comp = 0;
                if ("componentId" in command || "id" in command) {
                    comp = this.resolveTextId("componentId" in command ? command.componentId : command.id);
                    mode = 2;
                }
                else if (this.variables.isMaterialised("id")) {
                    comp = this.resolveTextId("@id");
                    mode = 2;
                }
                drawOnBitmap(w, bitmapId, mode, comp);
                w.buffer.start(139);
                drawOnBitmap(w, 0, 0, 0);
                return true;
            }
            case "drawcontent":
            case "drawcomponentcontent":
                w.buffer.start(139);
                return true;
            case "global":
                w.beginGlobal();
                for (const c of command.commands ?? [])
                    this.parseCommand(c);
                w.endGlobal();
                return true;
            case "resources":
                this.parseResources(command.resources ?? command);
                return true;
            case "componentvalue":
            case "addcomponentvalue": {
                const id = this.resolveTextId(req("id"));
                const vt = jsonGetInt(req("valueType"), "componentValue valueType");
                w.buffer.start(150);
                w.buffer.writeInt(vt);
                w.buffer.writeInt(w.lastComponentId);
                w.buffer.writeInt(id);
                return true;
            }
            case "polarpathexpression": {
                // addPolarPathExpression: a PATH_EXPRESSION whose second array is the centre and
                // whose flags carry POLAR (8).
                const id = String(req("id"));
                const rOps = this.expr.infixToRpn(String(req("expressionR")));
                const start = f("start"), end = f("end"), count = f("count");
                const cx = this.fbits("centerX" in command ? command.centerX : "cx" in command ? command.cx : 0);
                const cy = this.fbits("centerY" in command ? command.centerY : "cy" in command ? command.cy : 0);
                const pid = w.pathExpression(8 | optInt(command.flags, 0), start, end, count, rOps, [cx, cy]);
                this.paths.set(id, pid);
                return true;
            }
            case "pathappendmoveto":
            case "pathappendquadto":
            case "pathappendreset": {
                const pathId = this.resolvePath(String(req("path")));
                let data;
                if (t === "pathappendmoveto")
                    data = [(0, WireBuffer_1.asNanBits)(10), f("x"), f("y")];
                else if (t === "pathappendquadto") {
                    const x1 = f("x1"), y1 = f("y1"), x2 = f("x2"), y2 = f("y2");
                    data = [(0, WireBuffer_1.asNanBits)(12), 0, 0, x1, y1, x2, y2];
                }
                else
                    data = [(0, WireBuffer_1.asNanBits)(17)];
                w.buffer.start(160);
                w.buffer.writeInt(pathId);
                w.buffer.writeInt(data.length);
                for (const d of data)
                    w.buffer.writeInt(d);
                return true;
            }
            default:
                return false;
        }
    }
    parseVariable(command) {
        const name = String(command.name);
        const vtype = String(command.vtype ?? "float").toLowerCase();
        const commit = Boolean(command.commit), flush = Boolean(command.flush);
        if (vtype === "color" || vtype === "string" || vtype === "integer" || vtype === "int") {
            // RemoteComposeJsonParser "variable": colour, string and integer kinds, emitted now in
            // the first pass (or with commit), otherwise at first use.
            if (this.inFirstPass || commit)
                this.variables.set(name, this.materialiseVariable(command));
            else
                this.variables.defer(name, command);
            return;
        }
        if (vtype !== "float") {
            throw new NotImplementedComponent(`variable vtype '${vtype}'`);
        }
        if (command.export)
            throw new NotImplementedComponent("named/export float variable TBD");
        if (!(this.inFirstPass || commit || flush)) {
            this.variables.defer(name, command); // emitted at first use
            return;
        }
        if (this.variables.isMaterialised(name)) {
            // Reassignment: the new value is written under the variable's existing id, as the
            // reference does (its `targetId` path) -- a pattern local is the usual case.
            const bits = this.variables.get(name);
            const isNan = ((bits >>> 23) & 0xff) === 0xff && (bits & 0x7fffff) !== 0;
            const targetId = isNan ? (0, WireBuffer_1.idFromNanBits)(bits) : Math.trunc((0, WireBuffer_1.f32FromBits)(bits));
            const val = command.value;
            if (val !== null && typeof val === "object") {
                this.variables.set(name, (0, WireBuffer_1.asNanBits)(targetId));
            }
            else if (typeof val === "string" && /[+\-*/%(),]/.test(val)) {
                this.writer.floatExpressionAt(targetId, this.expr.infixToRpn(val));
                this.variables.set(name, (0, WireBuffer_1.asNanBits)(targetId));
            }
            else if (typeof val === "number") {
                this.writer.floatConstantAt(targetId, val);
                this.variables.set(name, (0, WireBuffer_1.asNanBits)(targetId));
            }
            else {
                throw new NotImplementedComponent(`variable reassignment of ${JSON.stringify(val)} TBD`);
            }
            return;
        }
        this.variables.set(name, this.materialiseFloatVar(command));
    }
    /** A colour, string or integer variable, as the reference's "variable" command. */
    materialiseVariable(command) {
        const vtype = String(command.vtype ?? "float").toLowerCase();
        const name = String(command.name);
        const named = Boolean(command.export);
        if (vtype === "color") {
            const color = this.resolveColor(command.value);
            const id = named ? this.writer.addNamedColor(name, color) : this.writer.addColor(color);
            return (0, WireBuffer_1.floatToRawIntBits)(id); // held as a plain float, as the reference
        }
        if (vtype === "string") {
            const textId = this.resolveTextId(command.value);
            if (named)
                this.writer.setStringName(textId, name);
            return (0, WireBuffer_1.floatToRawIntBits)(textId);
        }
        if (vtype === "integer" || vtype === "int") {
            const v = Math.trunc(Number(command.value ?? 0));
            const id = named ? this.writer.addNamedInt(name, v) : this.writer.addInteger(v);
            return (0, WireBuffer_1.asNanBits)(id);
        }
        return this.materialiseFloatVar(command);
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
            if (!["colors", "paths", "floatArrays", "variables", "bitmaps", "integers"].includes(key)) {
                throw new NotImplementedComponent(`resource type '${key}' (colors/paths/floatArrays/variables/integers/bitmaps only)`);
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
            for (const [name, cfg, value] of eachResource(section.colors)) {
                if (value && typeof value === "object" && !Array.isArray(value)) {
                    // ResourceParser: {"light": c, "dark": c} is a themed colour. Two
                    // "@colors.x" references pair those colours; otherwise each side is a
                    // value, written as its own colour (named by lightName / darkName).
                    if (!("light" in value && "dark" in value)) {
                        throw new NotImplementedComponent(`resources.colors.${name}: an object colour needs "light" and "dark"`);
                    }
                    const light = String(value.light), dark = String(value.dark);
                    const isRef = (s) => s.startsWith("$colors.") || s.startsWith("@colors.");
                    const id = isRef(light) && isRef(dark)
                        ? this.writer.addThemedColorIds(this.resolveColor(light), this.resolveColor(dark))
                        : this.writer.addThemedColorValues(typeof value.lightName === "string" ? value.lightName : null, this.themedSide(light), typeof value.darkName === "string" ? value.darkName : null, this.themedSide(dark));
                    if (cfg === null || cfg.export !== false)
                        this.writer.setColorName(id, name);
                    this.colors.set(name, id);
                    continue;
                }
                this.colors.set(name, this.writer.addNamedColor(name, parseColor(value)));
            }
        }
        if ("paths" in section) {
            // ResourceParser "paths": an op list [{type: moveTo|lineTo|quadTo|cubicTo|close}]
            // or an SVG string. Each is its own DATA_PATH; `$paths.name` finds it.
            for (const [name, , value] of eachResource(section.paths)) {
                // Anything else ({"data": [...]}) makes the reference parser throw a
                // ClassCastException; refuse it here rather than write a document Java can't.
                if (!Array.isArray(value) && typeof value !== "string") {
                    throw new NotImplementedComponent(`resources.paths.${name}: an op list [{type: moveTo|lineTo|quadTo|cubicTo|close}] or an SVG string (the reference parser rejects ${JSON.stringify(value).slice(0, 40)})`);
                }
                this.paths.set(name, Array.isArray(value)
                    ? this.writer.addPathData(pathFromOps(value))
                    : this.addPathString(value));
            }
        }
        if ("integers" in section) {
            // ResourceParser "integers": exported unless told otherwise, NaN-boxed id.
            for (const [name, cfg, value] of eachResource(section.integers)) {
                let named = cfg === null || cfg.export !== false;
                let v = value;
                if (v && typeof v === "object") {
                    if ("export" in v)
                        named = v.export !== false;
                    if ("value" in v)
                        v = v.value;
                }
                const n = Math.trunc(Number(v));
                const id = named ? this.writer.addNamedInt(name, n) : this.writer.addInteger(n);
                this.variables.set(name, (0, WireBuffer_1.asNanBits)(id));
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
                if (cfg && String(cfg.type ?? "").toLowerCase() === "string") {
                    // {"name": "wifiSsid", "type": "string", "value": "", "export": true};
                    // EXTENSION. Held as a plain float carrying the text id, as for
                    // textFromFloat, so "@wifiSsid" works wherever text is expected.
                    const text = String(cfg.value ?? "");
                    const id = named ? this.writer.addNamedString(name, text)
                        : this.writer.addText(text);
                    this.variables.set(name, (0, WireBuffer_1.floatToRawIntBits)(id));
                    continue;
                }
                // ResourceParser "variables". An object value is unwrapped to its `value`
                // (so an `anim` key beside it is ignored, as upstream: animate with an
                // expression object {"value": "<expr>", "anim": seconds} instead).
                let val = value;
                let isNamed = named;
                if (val && typeof val === "object" && !Array.isArray(val)) {
                    const vo = val;
                    if ("export" in vo)
                        isNamed = optBoolean(vo.export, false);
                    const typeStr = typeof vo.type === "string" ? vo.type : "";
                    if (typeStr.toLowerCase() === "integer" || typeStr.toLowerCase() === "int") {
                        const n = optInt(vo.value, 0);
                        const id = isNamed ? this.writer.addNamedInt(name, n) : this.writer.addInteger(n);
                        this.variables.set(name, (0, WireBuffer_1.asNanBits)(id));
                        continue;
                    }
                    if (typeStr === "textFromFloat") {
                        const textId = this.writer.addTextFromFloat(this.fbits(vo.value), optInt(vo.before, 0), optInt(vo.after, 3), optInt(vo.flags, 0));
                        this.variables.set(name, (0, WireBuffer_1.floatToRawIntBits)(textId));
                        if (isNamed)
                            this.writer.setStringName(textId, name);
                        continue;
                    }
                    if (typeStr.toLowerCase() === "textfromfloat" || typeStr.toLowerCase() === "textmerge") {
                        // EXTENSION (other spellings, textMerge): a text id held as a plain float.
                        this.variables.set(name, (0, WireBuffer_1.floatToRawIntBits)(this.resolveTextId(val)));
                        continue;
                    }
                    if ("value" in vo)
                        val = vo.value;
                }
                if (val === "width" || val === "height") {
                    const bits = this.writer.addComponentValue(val === "width" ? Writer_1.OP.CV_WIDTH : Writer_1.OP.CV_HEIGHT);
                    if (isNamed)
                        this.writer.setFloatName(bits & 0x3fffff, name);
                    this.variables.set(name, bits);
                    continue;
                }
                if (val === "fontSize") {
                    if (isNamed)
                        this.writer.setFloatName(33, name);
                    this.variables.set(name, (0, WireBuffer_1.asNanBits)(33));
                    continue;
                }
                const bits = typeof val === "number" ? (0, WireBuffer_1.floatToRawIntBits)(val) : this.fbits(val);
                if (!isNanBits(bits)) {
                    const fv = (0, WireBuffer_1.f32FromBits)(bits);
                    this.variables.set(name, isNamed ? this.writer.addNamedFloat(name, fv)
                        : this.writer.addFloatConstant(fv));
                }
                else {
                    if (isNamed)
                        this.writer.setFloatName(bits & 0x3fffff, name);
                    this.variables.set(name, bits);
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
        // `text` is the reference's alias for `value`.
        const value = "value" in component ? component.value : component.text;
        let textId;
        if (typeof value === "string" && (value.startsWith("$") || value.startsWith("@"))) {
            // A value starting with $ or @ is a variable/resource reference, not literal
            // text — the reference parser runs every text argument through resolveTextId,
            // and this is the same call the draw commands already use. It is what lets a
            // component show a string chosen at run time: `textLookup` puts a text id in a
            // variable, and the component renders whatever that id currently names.
            textId = this.resolveTextId(value);
        }
        else if (value && typeof value === "object") {
            // {"type": "textFromFloat", ...} or another text expression, as the reference
            // resolves every value; String() of it would print "[object Object]".
            textId = this.resolveTextId(value);
        }
        else if (value !== undefined && value !== null) {
            textId = this.writer.addText(String(value));
        }
        else if (component.textFromFloat && typeof component.textFromFloat === "object") {
            // A live float rather than a literal — the id is the same kind of thing, but
            // the op behind it formats a value at render time.
            const tff = component.textFromFloat;
            textId = this.writer.addTextFromFloat(this.fbits(tff.value), Number(tff.whole ?? 0), Number(tff.decimal ?? 0), Number(tff.flags ?? 0));
        }
        else {
            textId = -1; // no text at all: the reference writes id -1
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
        // The order matters: each float can be an expression, which writes its ops as it
        // is parsed, so they are read in the order RemoteComposeJsonParser reads them.
        const has = (k) => component[k] !== undefined && component[k] !== null;
        const fontSizeBits = has("fontSize") ? this.fbits(component.fontSize)
            : has("textSize") ? this.fbits(component.textSize) : (0, WireBuffer_1.floatToRawIntBits)(36.0);
        const fontWeightBits = has("fontWeight")
            ? this.fbits(component.fontWeight) : (0, WireBuffer_1.floatToRawIntBits)(400.0);
        const textStyleId = optInt(component.textStyleId, -1);
        const minFontSizeBits = has("minFontSize")
            ? this.fbits(component.minFontSize) : (0, WireBuffer_1.floatToRawIntBits)(-1.0);
        const maxFontSizeBits = has("maxFontSize")
            ? this.fbits(component.maxFontSize) : (0, WireBuffer_1.floatToRawIntBits)(-1.0);
        let fontStyle = 0;
        if (has("fontStyle")) {
            fontStyle = String(component.fontStyle).toLowerCase() === "italic"
                ? 1 : optInt(component.fontStyle, 0);
        }
        const fontFamily = has("fontFamily") ? String(component.fontFamily) : null;
        const letterSpacingBits = has("letterSpacing")
            ? this.fbits(component.letterSpacing) : (0, WireBuffer_1.floatToRawIntBits)(0.0);
        const lineHeightAddBits = has("lineHeightAdd")
            ? this.fbits(component.lineHeightAdd) : (0, WireBuffer_1.floatToRawIntBits)(0.0);
        const lineHeightMultiplierBits = has("lineHeightMultiplier")
            ? this.fbits(component.lineHeightMultiplier) : (0, WireBuffer_1.floatToRawIntBits)(1.0);
        let fontAxis = null;
        let fontAxisValues = null;
        if (has("fontAxis") && has("fontAxisValues")) {
            if (!Array.isArray(component.fontAxis) || !Array.isArray(component.fontAxisValues)) {
                throw new NotImplementedComponent("fontAxis and fontAxisValues must be arrays");
            }
            fontAxis = component.fontAxis.map((a) => String(a));
            // valArr.getDouble(i) for each axis; a shorter values array throws in Java.
            fontAxisValues = fontAxis.map((_, i) => {
                const v = Number(component.fontAxisValues[i]);
                if (Number.isNaN(v)) {
                    throw new NotImplementedComponent(`fontAxisValues[${i}] is not a number`);
                }
                return v;
            });
            if (component.fontAxisValues.length !== fontAxis.length) {
                throw new NotImplementedComponent("fontAxis and fontAxisValues must be the same length");
            }
        }
        this.writer.textComponent(textId, {
            color,
            colorId,
            fontSizeBits,
            fontWeightBits,
            textAlign: parseTextAlign(String(component.textAlign ?? "start")),
            overflow,
            maxLines: component.maxLines !== undefined ? optInt(component.maxLines, INT_MAX) : INT_MAX,
            minFontSizeBits, maxFontSizeBits, fontStyle, fontFamily,
            letterSpacingBits, lineHeightAddBits, lineHeightMultiplierBits,
            lineBreakStrategy: optInt(component.lineBreakStrategy, 0),
            hyphenationFrequency: optInt(component.hyphenationFrequency, 0),
            justificationMode: optInt(component.justificationMode, 0),
            underline: optBoolean(component.underline, false),
            strikethrough: optBoolean(component.strikethrough, false),
            autosize: optBoolean(component.autoSize, false),
            textStyleId, fontAxis, fontAxisValues,
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
