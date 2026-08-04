/**
 * RemoteComposeJsonParser — the JSON side, mirroring the Java parser plus
 * `DefaultComponentParsers` and `DefaultModifierParsers`.
 *
 * The rule this file follows throughout: **match the reference parser, including where
 * it is odd.** A few places would be more sensible written differently, and every one
 * of those is called out where it happens — "fixing" them here would produce a document
 * that no official player agrees with, which is worse than the oddity.
 */

import * as W from "./writer.js";
import type { ModifierEmitter } from "./writer.js";
import { Writer } from "./writer.js";
import { HEADER_KEY_TO_TAG, type HeaderTag, type HeaderValue } from "./header.js";
import { ExpressionParser, ExpressionError, variableNameFromRef } from "./expr.js";
import { floatToRawIntBits, intBitsToFloat } from "./wire.js";

const F32_MAX = 3.4028234663852886e38;
const INT_MAX = 2147483647;

// DimensionModifierOperation.Type ordinals.
const TYPE_EXACT = 0;
const TYPE_FILL = 1;
const TYPE_WRAP = 2;
const TYPE_WEIGHT = 3;

/** A JSON construct this converter will not guess at. */
export class NotImplementedComponent extends Error {}

type Json = any;

function toInt32(v: number): number {
    return v | 0;
}

function isNanBits(bits: number): boolean {
    const b = bits >>> 0;
    return (b & 0x7f800000) === 0x7f800000 && (b & 0x7fffff) !== 0;
}

// ── value parsing ────────────────────────────────────────────────────────

export function parseFloatValue(value: Json): number {
    if (value === null || value === undefined) return NaN;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "number") return value;
    if (typeof value === "string") {
        if (value === "NaN") return NaN;
        if (value === "Infinity") return Infinity;
        if (value === "-Infinity") return -Infinity;
        if (value === "max") return F32_MAX;
        throw new NotImplementedComponent(`parseFloat: unsupported string '${value}'`);
    }
    throw new NotImplementedComponent(`parseFloat: unsupported ${typeof value}`);
}

export function parseColor(value: Json): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "number") return toInt32(Math.trunc(value));
    if (typeof value === "string") {
        if (value.startsWith("$") || value.startsWith("@")) {
            throw new NotImplementedComponent(`color reference '${value}' needs resources`);
        }
        const hex = value.startsWith("#") ? value.slice(1) : value;
        let v = parseInt(hex, 16);
        if (Number.isNaN(v)) throw new NotImplementedComponent(`bad colour '${value}'`);
        // A 6-digit colour is opaque; only 8 digits carry their own alpha.
        if (value.length <= 7) v = (v | 0xff000000) >>> 0;
        return toInt32(v);
    }
    throw new NotImplementedComponent(`parseColor: unsupported ${typeof value}`);
}

const H_ALIGN: Record<string, number> = {
    start: 1, center: 2, end: 3, spacebetween: 6, spaceevenly: 7, spacearound: 8,
};
const V_ALIGN: Record<string, number> = {
    start: 1, top: 4, center: 2, bottom: 5, spacebetween: 6, spaceevenly: 7, spacearound: 8,
};
const TEXT_ALIGN: Record<string, number> = {
    left: 1, "1": 1, right: 2, "2": 2, center: 3, "3": 3, justify: 4, "4": 4, start: 5, "5": 5,
};

export const parseHAlign = (a: string): number => H_ALIGN[a.toLowerCase()] ?? 1;
export const parseVAlign = (a: string): number => V_ALIGN[a.toLowerCase()] ?? 4;
export const parseTextAlign = (a: string): number => TEXT_ALIGN[a.toLowerCase()] ?? 5;

const STYLE: Record<string, number> = { fill: 0, stroke: 1, fillandstroke: 2 };
const CAP: Record<string, number> = { round: 1, square: 2 }; // else butt(0)
const JOIN: Record<string, number> = { round: 1, bevel: 2 }; // else miter(0)

/**
 * Direct-key paint setters in the FIXED order of `parseCommand`'s else branch. The
 * order is load-bearing — it is the order the PaintBundle ints come out in.
 *
 * `linearGradient`, `pathEffect` and `alpha` are deliberately absent: the current
 * parser honours those only inside an `ops` array and silently ignores them as direct
 * keys. Mirroring that, rather than "fixing" it, is what keeps the bytes identical.
 */
const PAINT_KEYS_ORDER = [
    "shader", "color", "strokeJoin", "strokeCap", "style", "width", "textSize", "sweepGradient",
];
/** Accepted as direct keys but ignored by the parser — we refuse instead of losing them. */
const PAINT_KEYS_IGNORED = ["linearGradient", "pathEffect", "alpha"];
const PAINT_KEY_ALIASES: Record<string, string> = { strokewidth: "width", runtimeshader: "shader" };

function normalizeCommand(command: Json): Json {
    const keys = Object.keys(command);
    if (!("type" in command) && keys.length === 1) {
        const key = keys[0];
        const val = command[key];
        const out: Json = { type: key };
        if (Array.isArray(val)) out.commands = val;
        else if (val && typeof val === "object") Object.assign(out, val);
        else if (key.toLowerCase() === "drawpath" || key.toLowerCase() === "pathappendclose") out.path = val;
        else out.value = val;
        return out;
    }
    return command;
}

export function normalizeComponent(component: Json): Json {
    const keys = Object.keys(component);
    if (!("type" in component) && keys.length === 1) {
        const key = keys[0];
        const val = component[key];
        const out: Json = { type: key };
        if (Array.isArray(val)) out.children = val;
        else if (val && typeof val === "object") Object.assign(out, val);
        return out;
    }
    return component;
}

// ── header ───────────────────────────────────────────────────────────────

export function parseApiLevel(doc: Json): number {
    const h = doc?.header;
    return h && typeof h === "object" ? Number(h.apiLevel ?? 7) : 7;
}

export function parseHeaderOnly(doc: Json): HeaderTag[] {
    const h = doc?.header;
    if (!h || typeof h !== "object") return [];
    const tags: HeaderTag[] = [];
    for (const [key, value] of Object.entries(h)) {
        if (key === "apiLevel" || key === "orderedResources") continue;
        const tag = HEADER_KEY_TO_TAG[key];
        if (tag === undefined) throw new NotImplementedComponent(`Unknown header tag: ${key}`);
        tags.push([tag, value as HeaderValue]);
    }
    return tags;
}

// ── the parser ───────────────────────────────────────────────────────────

const FIRST_PASS_TYPES = new Set([
    "resources", "variable", "global", "definepattern", "referencedoperations",
]);
const RESOURCE_DEFAULT_ORDER = [
    "v_dims", "colors", "paths", "floatArrays", "variables", "integers", "matrices",
];

export class Parser {
    variables = new Map<string, number>(); // name -> NaN-id bits
    colors = new Map<string, number>();    // colours.name -> colour id
    paths = new Map<string, number>();     // path name -> path id
    private inFirstPass = false;
    private globalNesting = 0;
    private profiles = 0;
    private expr: ExpressionParser;

    constructor(public writer: Writer) {
        this.expr = new ExpressionParser(writer, this.variables);
    }

    /** Resolve a colour: literal, `$colors.` reference, or a `$var` holding a colour id. */
    color(value: Json): number {
        if (typeof value === "string" && (value.startsWith("$colors.") || value.startsWith("@colors."))) {
            const name = value.slice(8);
            const hit = this.colors.get(name);
            if (hit === undefined) throw new NotImplementedComponent(`Color not found: ${name}`);
            return hit;
        }
        if (typeof value === "string" && (value.startsWith("$") || value.startsWith("@"))) {
            const name = variableNameFromRef(value);
            const bits = this.variables.get(name);
            if (bits !== undefined) {
                if (isNanBits(bits)) return bits & 0x3fffff;
                return Math.trunc(intBitsToFloat(bits)); // a plain (float)colorId
            }
            throw new NotImplementedComponent(`color variable '${name}' not found`);
        }
        return parseColor(value);
    }

    /**
     * A canvas float field as raw float32 bits — literal, reference, or expression.
     * Bits rather than a number so a NaN-encoded expression id survives.
     */
    fbits(value: Json): number {
        if (value === null || value === undefined) return W.NAN_BITS;
        if (typeof value === "boolean") return floatToRawIntBits(value ? 1 : 0);
        if (typeof value === "number") return floatToRawIntBits(value);
        if (typeof value === "object" && !Array.isArray(value)) {
            try {
                return this.expr.parseExpression(value);
            } catch (e) {
                if (e instanceof ExpressionError) throw new NotImplementedComponent(e.message);
                throw e;
            }
        }
        if (typeof value === "string") {
            if (value === "NaN") return 0x7fc00000;
            if (value === "Infinity") return 0x7f800000;
            if (value === "-Infinity") return 0xff800000 >>> 0;
            if (value === "max") return floatToRawIntBits(F32_MAX);
            try {
                if (this.expr.isVariable(value)) return this.expr.variableNanBits(value);
                return this.expr.parseExpression(value);
            } catch (e) {
                if (e instanceof ExpressionError) throw new NotImplementedComponent(e.message);
                throw e;
            }
        }
        throw new NotImplementedComponent(`float field type ${typeof value}`);
    }

    parse(doc: Json): void {
        const header = doc?.header ?? {};
        this.profiles = Number(header.profiles ?? 0) || 0;
        if (doc?.resources) this.parseResources(doc.resources);
        const root = doc?.root;
        if (root === null || root === undefined) return;

        const items = (Array.isArray(root) ? root : [root]).map(normalizeComponent);

        // Pass 1: resources, variables and global blocks, emitted before the root op so
        // their ids are allocated first.
        this.inFirstPass = true;
        for (const item of items) {
            if (FIRST_PASS_TYPES.has(String(item.type ?? "").toLowerCase())) this.parseComponent(item);
        }
        this.inFirstPass = false;

        // Pass 2: layout.
        this.writer.rootStart();
        for (const item of items) {
            const t = String(item.type ?? "").toLowerCase();
            if (!["resources", "variable", "definepattern", "referencedoperations"].includes(t)) {
                this.parseComponent(item);
            }
        }
        while (this.globalNesting > 0) this.endGlobal();
        this.writer.containerEnd(); // end root
    }

    private beginGlobal(): void {
        if (this.globalNesting === 0) this.writer.beginGlobal();
        this.globalNesting++;
    }

    private endGlobal(): void {
        if (this.globalNesting > 0) {
            this.globalNesting--;
            if (this.globalNesting === 0) this.writer.endGlobal();
        }
    }

    // ── resources ────────────────────────────────────────────────────────

    private parseResources(resources: Json): void {
        const order: string[] =
            resources.order ?? RESOURCE_DEFAULT_ORDER.filter((k) => k in resources);
        for (const key of order) {
            if (!(key in resources)) continue;
            if (key === "colors") this.parseColors(resources[key]);
            else if (key === "floatArrays") this.parseFloatArrays(resources[key]);
            else if (key === "variables") this.parseVariablesResource(resources[key]);
            else throw new NotImplementedComponent(`resource type '${key}' (colors/floatArrays/variables only)`);
        }
    }

    /**
     * Yield `[config, name, value]` for the three accepted shapes: a tag-key array
     * `[{name: value}]`, a verbose array `[{name, value}]`, and a map `{name: value}`.
     */
    private *eachResource(section: Json): Generator<[Json | null, string, Json]> {
        if (Array.isArray(section)) {
            for (const entry of section) {
                const keys = Object.keys(entry);
                if (!("name" in entry) && keys.length === 1) {
                    const name = keys[0];
                    const value = entry[name];
                    yield [value && typeof value === "object" ? value : null, name, value];
                } else {
                    yield [entry, entry.name, entry.value];
                }
            }
        } else if (section && typeof section === "object") {
            for (const [name, value] of Object.entries(section)) {
                yield [value && typeof value === "object" ? value : null, name, value];
            }
        }
    }

    /**
     * `resources.variables` — float constants and expressions. Unlike the inline
     * `variable` command these default to `export: false`, i.e. an anonymous constant.
     */
    private parseVariablesResource(section: Json): void {
        for (const [config, name, value] of this.eachResource(section)) {
            const named = config ? Boolean(config.export ?? false) : false;
            let val = value;
            if (value && typeof value === "object" && !Array.isArray(value)) {
                const vtype = String(value.type ?? "").toLowerCase();
                if (["integer", "int", "textfromfloat"].includes(vtype)) {
                    throw new NotImplementedComponent(`resources.variables type '${vtype}' TBD`);
                }
                if ("value" in value && !("anim" in value)) val = value.value;
            }
            if (named) throw new NotImplementedComponent("resources.variables export:true TBD");
            if (typeof val === "string" && ["width", "height", "fontSize"].includes(val)) {
                throw new NotImplementedComponent(`resources.variables dimension '${val}' TBD`);
            }
            if (typeof val === "boolean") throw new NotImplementedComponent("boolean variable value");
            if (typeof val === "number") this.variables.set(name, this.writer.addFloatConstant(val));
            else this.variables.set(name, this.fbits(val));
        }
    }

    private parseFloatArrays(arrays: Json): void {
        const define = (name: string, value: Json, config: Json | null): void => {
            const raw = value && typeof value === "object" && !Array.isArray(value) ? value.value : value;
            const data = (raw as Json[]).map((x) => Number(x));
            const named = config === null || (config.export ?? true);
            const aid = named
                ? this.writer.addNamedFloatArray(name, data)
                : this.writer.addFloatArray(data);
            this.variables.set(name, (aid | 0xff800000) >>> 0);
        };
        if (Array.isArray(arrays)) {
            for (const entry of arrays) {
                const keys = Object.keys(entry);
                if (!("name" in entry) && keys.length === 1) {
                    const name = keys[0];
                    const v = entry[name];
                    define(name, v, v && typeof v === "object" && !Array.isArray(v) ? v : null);
                } else {
                    define(entry.name, entry.value, entry);
                }
            }
        } else if (arrays && typeof arrays === "object") {
            for (const [name, value] of Object.entries(arrays)) {
                const v = value as Json;
                define(name, v, v && typeof v === "object" && !Array.isArray(v) ? v : null);
            }
        }
    }

    private parseColors(colors: Json): void {
        const define = (name: string, value: Json): void => {
            if (value && typeof value === "object") {
                throw new NotImplementedComponent("themed (light/dark) color TBD");
            }
            this.colors.set(name, this.writer.addNamedColor(name, parseColor(value)));
        };
        if (Array.isArray(colors)) {
            for (const entry of colors) {
                const keys = Object.keys(entry);
                if (!("name" in entry) && keys.length === 1) define(keys[0], entry[keys[0]]);
                else define(entry.name, entry.value);
            }
        } else if (colors && typeof colors === "object") {
            for (const [name, value] of Object.entries(colors)) define(name, value);
        }
    }

    // ── components ───────────────────────────────────────────────────────

    private parseChildren(children: Json): void {
        if (!children) return;
        for (const child of children) this.parseComponent(normalizeComponent(child));
    }

    private parseComponent(component: Json): void {
        const ctype = String(component.type).toLowerCase();

        if (ctype === "resources") {
            // `{"resources": {...}}` normalises to `{type:"resources", ...sections}`,
            // so the sections sit at the top level of `component`.
            if (this.inFirstPass) this.parseResources(component);
            return;
        }
        if (ctype === "variable") {
            if (this.inFirstPass || !this.variables.has(component.name)) this.parseVariable(component);
            return;
        }
        if (ctype === "global") {
            const children = component.children ?? [];
            if (this.inFirstPass) {
                this.beginGlobal();
                for (const raw of children) {
                    const child = normalizeComponent(raw);
                    if (FIRST_PASS_TYPES.has(String(child.type ?? "").toLowerCase())) {
                        this.parseComponent(child);
                    }
                }
                this.endGlobal();
            } else {
                this.parseChildren(children);
            }
            return;
        }

        if (component.resources && this.inFirstPass) this.parseResources(component.resources);

        const mods = this.parseModifiers(component.modifiers);
        const w = this.writer;
        const hAlign = (d: string) => parseHAlign(String(component.horizontalAlignment ?? d));
        const vAlign = (d: string) => parseVAlign(String(component.verticalAlignment ?? d));

        switch (ctype) {
            case "column":
                w.startColumn(hAlign("start"), vAlign("top"), mods);
                this.parseChildren(component.children);
                w.endContainer();
                break;
            case "row":
                w.startRow(hAlign("start"), vAlign("top"), mods);
                this.parseChildren(component.children);
                w.endContainer();
                break;
            case "box": {
                if (!component.children || component.children.length === 0) {
                    throw new NotImplementedComponent("empty box (leaf) not yet implemented");
                }
                w.startBox(hAlign("start"), vAlign("top"), mods);
                this.parseChildren(component.children);
                w.endContainer();
                break;
            }
            case "text":
                this.parseText(component, mods);
                break;
            case "canvas":
                this.parseCanvas(component, mods);
                break;
            case "spacer": {
                const m = mods.length ? mods : [W.modWidth(TYPE_WEIGHT, floatToRawIntBits(1.0))];
                w.startBox(0, 0, m);
                w.endContainer();
                break;
            }
            case "flow":
                w.startFlow(hAlign("start"), vAlign("top"), mods, Number(component.maxColumns ?? INT_MAX));
                this.parseChildren(component.children);
                w.endContainer();
                break;
            case "collapsiblecolumn":
                w.startCollapsibleColumn(hAlign("center"), vAlign("center"), mods);
                this.parseChildren(component.children);
                w.endContainer();
                break;
            case "collapsiblerow":
                w.startCollapsibleRow(hAlign("center"), vAlign("center"), mods);
                this.parseChildren(component.children);
                w.endContainer();
                break;
            case "fitbox":
                w.startFitBox(hAlign("center"), vAlign("center"), mods);
                this.parseChildren(component.children);
                w.endContainer();
                break;
            default:
                throw new NotImplementedComponent(`component type '${component.type}'`);
        }
    }

    // ── modifiers ────────────────────────────────────────────────────────

    /**
     * Modifier emitters in list order. Dimension values go through `fbits`, which also
     * *emits* any expression op right here — before the layout op — matching the Java
     * order, where `parseModifiers` runs ahead of the container start.
     */
    parseModifiers(modifiers: Json): ModifierEmitter[] {
        const out: ModifierEmitter[] = [];
        if (!modifiers) return out;
        for (const item of modifiers) {
            let key: string;
            let mod: Json;
            if (typeof item === "string") {
                key = item;
                mod = { [item]: "NaN" };
            } else if (item && typeof item === "object") {
                key = Object.keys(item)[0];
                mod = item;
            } else {
                throw new NotImplementedComponent(`modifier item ${JSON.stringify(item)}`);
            }
            this.applyModifier(out, key.toLowerCase(), key, mod);
        }
        return out;
    }

    /** The `getDouble` path: numeric only, never an expression. */
    private numBits(value: Json): number {
        return floatToRawIntBits(Number(value));
    }

    private applyModifier(out: ModifierEmitter[], keyLc: string, key: string, mod: Json): void {
        const fb = (v: Json) => this.fbits(v);
        switch (keyLc) {
            case "fillmaxsize": {
                const v = fb(mod[key]);
                out.push(W.modWidth(TYPE_FILL, v), W.modHeight(TYPE_FILL, v));
                break;
            }
            case "fillmaxwidth": out.push(W.modWidth(TYPE_FILL, fb(mod[key]))); break;
            case "fillmaxheight": out.push(W.modHeight(TYPE_FILL, fb(mod[key]))); break;
            case "width": out.push(W.modWidth(TYPE_EXACT, fb(mod[key]))); break;
            case "height": out.push(W.modHeight(TYPE_EXACT, fb(mod[key]))); break;
            case "size": {
                const v = fb(mod[key]);
                out.push(W.modWidth(TYPE_EXACT, v), W.modHeight(TYPE_EXACT, v));
                break;
            }
            case "weight":
            case "horizontalweight": out.push(W.modWidth(TYPE_WEIGHT, this.numBits(mod[key]))); break;
            case "verticalweight": out.push(W.modHeight(TYPE_WEIGHT, this.numBits(mod[key]))); break;
            case "background": {
                const bg = mod[key];
                if (typeof bg !== "string") throw new NotImplementedComponent("background non-string");
                if (bg.startsWith("$") || bg.startsWith("@")) out.push(W.modBackgroundId(this.color(bg)));
                else out.push(W.modBackground(parseColor(bg)));
                break;
            }
            case "border": {
                const b = mod[key];
                out.push(W.modBorder(Number(b.width), Number(b.cornerRadius),
                    this.color(b.color), Number(b.shape ?? 0)));
                break;
            }
            case "widthin": out.push(W.modWidthIn(fb(mod[key][0]), fb(mod[key][1]))); break;
            case "heightin": out.push(W.modHeightIn(fb(mod[key][0]), fb(mod[key][1]))); break;
            case "clip": {
                const shape = mod[key];
                const st = String(shape.type ?? "").toLowerCase();
                if (st === "roundrect" || st === "roundedrect") {
                    if ("radius" in shape) {
                        const r = Number(shape.radius);
                        out.push(W.modClipRoundedRect(r, r, r, r));
                    } else {
                        out.push(W.modClipRoundedRect(
                            Number(shape.topStart ?? 0), Number(shape.topEnd ?? 0),
                            Number(shape.bottomStart ?? 0), Number(shape.bottomEnd ?? 0)));
                    }
                } else {
                    throw new NotImplementedComponent(`clip shape '${st}' (circle/rect TBD)`);
                }
                break;
            }
            case "padding": {
                const pv = mod[key];
                if (Array.isArray(pv)) {
                    out.push(W.modPadding(this.numBits(pv[0]), this.numBits(pv[1]),
                        this.numBits(pv[2]), this.numBits(pv[3])));
                } else if (pv && typeof pv === "object") {
                    out.push(W.modPadding(this.numBits(pv.start ?? 0), this.numBits(pv.top ?? 0),
                        this.numBits(pv.end ?? 0), this.numBits(pv.bottom ?? 0)));
                } else {
                    const v = fb(pv);
                    out.push(W.modPadding(v, v, v, v));
                }
                break;
            }
            default:
                throw new NotImplementedComponent(`modifier '${key}'`);
        }
    }

    // ── canvas ───────────────────────────────────────────────────────────

    private parseCanvas(component: Json, mods: ModifierEmitter[]): void {
        this.writer.startCanvas(mods);
        for (const cmd of component.commands ?? []) this.parseCommand(cmd);
        this.writer.endCanvas();
    }

    private paintSetter(key: string, src: Json, ints: number[]): void {
        switch (key) {
            case "shader": {
                const sv = src[key];
                if (typeof sv !== "number") {
                    // Inline AGSL (`{"agsl": "..."}`) needs a createShader op this engine
                    // does not emit yet. `Number({...})` is NaN and `writeInt(NaN)` is 0,
                    // so accepting it would produce a document that compiles and quietly
                    // draws with no shader at all.
                    throw new NotImplementedComponent(
                        "inline shader source (createShader op) not implemented");
                }
                ints.push(W.PB_SHADER, sv);
                break;
            }
            case "color": {
                const c = src.color;
                if (typeof c === "string" && (c.startsWith("$colors.") || c.startsWith("@colors."))) {
                    ints.push(W.PB_COLOR_ID, this.color(c));
                } else {
                    ints.push(W.PB_COLOR, toInt32(this.color(c)));
                }
                break;
            }
            case "style": {
                const s = STYLE[String(src.style).toLowerCase()];
                if (s === undefined) throw new NotImplementedComponent(`paint style '${src.style}'`);
                ints.push(W.PB_STYLE | (s << 16));
                break;
            }
            case "linearGradient": this.gradient(src.linearGradient, ints, false); break;
            case "sweepGradient": this.gradient(src.sweepGradient, ints, true); break;
            case "pathEffect": {
                let pe = src.pathEffect;
                if (pe === null || pe === undefined) {
                    ints.push(W.PB_PATH_EFFECT);
                } else {
                    // A *typed* PaintPathEffects record, not a bare interval list:
                    // [DASH, phase, count, intervals...]. `PaintPathEffects.parse`
                    // rejects anything untyped.
                    let phase = 0.0;
                    if (!Array.isArray(pe)) {
                        phase = Number(pe.phase ?? 0.0);
                        pe = pe.intervals;
                    }
                    const data = [W.PPE_DASH, floatToRawIntBits(phase), pe.length];
                    for (const x of pe) data.push(floatToRawIntBits(parseFloatValue(x)));
                    ints.push(W.PB_PATH_EFFECT | (data.length << 16));
                    ints.push(...data);
                }
                break;
            }
            case "alpha":
                ints.push(W.PB_ALPHA, floatToRawIntBits(parseFloatValue(src.alpha)));
                break;
            case "width": {
                // `strokeWidth` is the preferred spelling and wins when both appear.
                const v = "strokeWidth" in src ? src.strokeWidth : src.width;
                ints.push(W.PB_STROKE_WIDTH, floatToRawIntBits(parseFloatValue(v)));
                break;
            }
            case "strokeCap":
                ints.push(W.PB_STROKE_CAP | ((CAP[String(src.strokeCap).toLowerCase()] ?? 0) << 16));
                break;
            case "strokeJoin":
                ints.push(W.PB_STROKE_JOIN | ((JOIN[String(src.strokeJoin).toLowerCase()] ?? 0) << 16));
                break;
            case "textSize":
                ints.push(W.PB_TEXT_SIZE, floatToRawIntBits(parseFloatValue(src.textSize)));
                break;
            default:
                throw new NotImplementedComponent(`paint key '${key}'`);
        }
    }

    private gradient(g: Json, ints: number[], sweep: boolean): void {
        const colors: number[] = [];
        let idMask = 0;
        (g.colors as Json[]).forEach((c, i) => {
            if (typeof c === "string" && (c.startsWith("$colors.") || c.startsWith("@colors."))) {
                idMask |= 1 << i;
            }
            colors.push(typeof c === "string" ? toInt32(this.color(c)) : toInt32(parseColor(c)));
        });
        const stops = g.stops as number[] | undefined;
        ints.push(W.PB_GRADIENT | ((sweep ? W.GRAD_SWEEP : W.GRAD_LINEAR) << 16));
        ints.push(((idMask << 16) | colors.length) >>> 0);
        ints.push(...colors);
        ints.push(stops ? stops.length : 0);
        if (stops) for (const s of stops) ints.push(floatToRawIntBits(Number(s)));
        // Coordinates go through parseFloat on the Java side, so they accept
        // expressions; `fbits` resolves them and emits any expression op at the same
        // point in the stream that the reference does.
        if (sweep) {
            ints.push(this.fbits(g.centerX), this.fbits(g.centerY));
        } else {
            ints.push(this.fbits(g.x1 ?? 0.0), this.fbits(g.y1 ?? 0.0),
                this.fbits(g.x2 ?? 0.0), this.fbits(g.y2 ?? 0.0),
                typeof g.tileMode === "number" ? g.tileMode : 0);
        }
    }

    private buildPaintBundle(command: Json): number[] {
        const ints: number[] = [];
        if ("ops" in command) {
            // In `ops` form every key is honoured, in the order written.
            for (const op of command.ops) {
                for (const key of Object.keys(op)) this.paintSetter(key, op, ints);
            }
            return ints;
        }
        for (const key of PAINT_KEYS_IGNORED) {
            if (key in command) {
                throw new NotImplementedComponent(
                    `paint key '${key}' is ignored as a direct key by the current parser — ` +
                    `move it into an "ops" array`);
            }
        }
        const present = new Set(
            Object.keys(command).map((k) => PAINT_KEY_ALIASES[k.toLowerCase()] ?? k));
        for (const key of PAINT_KEYS_ORDER) {
            if (present.has(key)) this.paintSetter(key, command, ints);
        }
        return ints;
    }

    private parseCommand(raw: Json): void {
        const command = normalizeCommand(raw);
        const ctype = String(command.type).toLowerCase();
        const w = this.writer;
        const fb = (v: Json) => this.fbits(v);

        switch (ctype) {
            case "paint": w.paintValues(this.buildPaintBundle(command)); break;
            case "setcolor": w.paintValues([W.PB_COLOR, toInt32(parseColor(command.color))]); break;
            case "setstyle": {
                const s = STYLE[String(command.style).toLowerCase()];
                if (s === undefined) throw new NotImplementedComponent(`setStyle '${command.style}'`);
                w.paintValues([W.PB_STYLE | (s << 16)]);
                break;
            }
            case "setstrokewidth":
                w.paintValues([W.PB_STROKE_WIDTH, floatToRawIntBits(parseFloatValue(command.width))]);
                break;
            case "drawcircle": w.drawCircle(fb(command.cx), fb(command.cy), fb(command.radius)); break;
            case "drawline": w.drawLine(fb(command.x1), fb(command.y1), fb(command.x2), fb(command.y2)); break;
            case "drawrect": w.drawRect(fb(command.left), fb(command.top), fb(command.right), fb(command.bottom)); break;
            case "drawoval": w.drawOval(fb(command.left), fb(command.top), fb(command.right), fb(command.bottom)); break;
            case "drawroundrect":
                w.drawRoundRect(fb(command.left), fb(command.top), fb(command.right),
                    fb(command.bottom), fb(command.rx), fb(command.ry));
                break;
            case "drawarc":
                w.drawArc(fb(command.left), fb(command.top), fb(command.right),
                    fb(command.bottom), fb(command.startAngle), fb(command.sweepAngle));
                break;
            case "drawtextanchored": {
                const textObj = command.text;
                if (typeof textObj === "string" && (textObj.startsWith("$") || textObj.startsWith("@"))) {
                    throw new NotImplementedComponent(`drawTextAnchored text ref '${textObj}'`);
                }
                const tid = w.addText(String(textObj));
                w.drawTextAnchored(tid, fb(command.x), fb(command.y),
                    fb(command.panX), fb(command.panY), Number(command.flags ?? 0));
                break;
            }
            case "save":
                w.matrixSave();
                if ("commands" in command) {
                    for (const c of command.commands) this.parseCommand(c);
                    w.matrixRestore();
                }
                break;
            case "restore": w.matrixRestore(); break;
            case "translate": w.translate(fb(command.dx), fb(command.dy)); break;
            case "rotate": {
                const angle = fb(command.angle);
                if ("pivotX" in command || "centerX" in command) {
                    const px = fb("pivotX" in command ? command.pivotX : command.centerX);
                    const py = fb("pivotY" in command ? command.pivotY : command.centerY);
                    w.rotate(angle, px, py);
                } else {
                    w.rotate(angle);
                }
                break;
            }
            case "scale": w.scale(fb(command.sx), fb(command.sy)); break;
            case "cliprect": w.clipRect(fb(command.left), fb(command.top), fb(command.right), fb(command.bottom)); break;
            case "variable": this.parseVariable(command); break;
            case "pathcreate": {
                const pid = w.pathCreate(fb(command.x), fb(command.y));
                if (command.id !== null && command.id !== undefined) this.paths.set(String(command.id), pid);
                break;
            }
            case "pathappendlineto":
                w.pathAppendLineTo(this.parsePath(command.path), fb(command.x), fb(command.y));
                break;
            case "pathappendclose": w.pathAppendClose(this.parsePath(command.path)); break;
            case "drawpath": w.drawPath(this.parsePath(command.path)); break;
            case "loop": {
                const fromB = fb(command.from);
                const stepB = "step" in command ? fb(command.step) : floatToRawIntBits(1.0);
                const untilB = fb(command.until);
                const index = String(command.index ?? "i");
                const indexId = command.noIndexText ? w.allocDataId() : w.addText(index);
                w.startLoop(indexId, fromB, stepB, untilB);
                const had = this.variables.has(index);
                const prev = this.variables.get(index);
                this.variables.set(index, (indexId | 0xff800000) >>> 0);
                for (const c of command.commands ?? []) this.parseCommand(c);
                if (had) this.variables.set(index, prev!);
                else this.variables.delete(index);
                w.endLoop();
                break;
            }
            case "conditionaloperations": {
                const map: Record<string, number> = { gt: 4, ge: 5, lt: 2, le: 3, eq: 0 };
                const cond = map[String(command.condition).toLowerCase()] ?? 0;
                w.conditionalOperations(cond, fb(command.v1), fb(command.v2));
                for (const c of command.commands ?? []) this.parseCommand(c);
                w.endConditional();
                break;
            }
            default:
                throw new NotImplementedComponent(`canvas command '${ctype}'`);
        }
    }

    private parsePath(pathStr: string): number {
        const direct = this.paths.get(pathStr);
        if (direct !== undefined) return direct;
        if (pathStr.startsWith("$paths.") || pathStr.startsWith("@paths.")) {
            const name = pathStr.slice(7);
            const hit = this.paths.get(name);
            if (hit === undefined) throw new NotImplementedComponent(`Path not found: ${name}`);
            return hit;
        }
        throw new NotImplementedComponent(`SVG path string '${pathStr}' (addPathString) TBD`);
    }

    private parseVariable(command: Json): void {
        const name = command.name;
        const vtype = command.vtype ?? "float";
        const commit = command.commit ?? false;
        const flush = command.flush ?? false;
        const named = command.export ?? false;

        if (vtype === "color") {
            if (!(commit || flush)) throw new NotImplementedComponent("deferred color variable TBD");
            const colorVal = parseColor(command.value);
            const cid = named ? this.writer.addNamedColor(name, colorVal) : this.writer.addColor(colorVal);
            this.variables.set(name, floatToRawIntBits(cid)); // (float)colorId
            return;
        }
        if (vtype !== "float") {
            throw new NotImplementedComponent(`variable vtype '${vtype}' (string/path/floatArrays TBD)`);
        }
        if (named) throw new NotImplementedComponent("named/export float variable TBD");
        if (!(this.inFirstPass || commit || flush)) {
            throw new NotImplementedComponent("deferred variable (needs commit/flush, or first-pass root) TBD");
        }
        if (flush) throw new NotImplementedComponent("flush variable TBD");
        if (this.variables.has(name)) throw new NotImplementedComponent("variable reassignment (targetId) TBD");

        const val = command.value;
        let bits: number;
        if (typeof val === "boolean") throw new NotImplementedComponent("boolean variable value");
        else if (typeof val === "number") bits = this.writer.addFloatConstant(val);
        else if (typeof val === "string") bits = this.fbits(val);
        else if (val && typeof val === "object") {
            if (["textFromFloat", "textMerge"].includes(String(val.type ?? ""))) {
                throw new NotImplementedComponent(`variable value '${val.type}' TBD`);
            }
            bits = this.fbits(val);
        } else {
            throw new NotImplementedComponent(`variable value type ${typeof val}`);
        }
        this.variables.set(name, bits);
    }

    private parseText(component: Json, mods: ModifierEmitter[]): void {
        // The buffer picks the text op from the profile's operation map: CoreText (239)
        // when CORE_TEXT is enabled, TextLayout (208) as a backstop when it is not. A
        // document with no `profiles` tag gets the baseline map and therefore the
        // backstop, which has a different field layout. We only emit CoreText, so we
        // refuse rather than produce a plausible-looking wrong document.
        if (!this.profiles) {
            throw new NotImplementedComponent(
                "text without a `profiles` header tag — the reference falls back to the " +
                "TextLayout op (208) instead of CoreText (239), which this engine does not " +
                'emit; add "profiles": 512 (or 513) to the header');
        }
        const w = this.writer;
        const value = component.value;
        const tff = component.textFromFloat;
        let textId: number;

        if (value !== null && value !== undefined) {
            if (typeof value === "string" && (value.startsWith("$") || value.startsWith("@"))) {
                throw new NotImplementedComponent(`text variable/resource reference '${value}'`);
            }
            textId = w.addText(String(value));
        } else if (tff && typeof tff === "object") {
            const valueBits = this.fbits(tff.value);
            textId = w.addTextFromFloat(valueBits, Number(tff.whole ?? 0),
                Number(tff.decimal ?? 0), Number(tff.flags ?? 0));
        } else {
            throw new NotImplementedComponent("text without value or textFromFloat");
        }

        let color = 0xff000000;
        let colorId = -1;
        const colorObj = component.color;
        if (typeof colorObj === "string" && (colorObj.startsWith("$colors.") || colorObj.startsWith("@colors."))) {
            colorId = this.color(colorObj);
        } else if (colorObj !== null && colorObj !== undefined) {
            color = this.color(colorObj);
        }

        const maxLines = Number(component.maxLines ?? INT_MAX);
        const overflowMap: Record<string, number> = {
            clip: 1, ellipsis: 3, visible: 2, start_ellipsis: 4, middle_ellipsis: 5,
        };
        const overflow = overflowMap[String(component.overflow ?? "clip").toLowerCase()] ?? 1;
        const fontSizeBits = "fontSize" in component ? this.fbits(component.fontSize) : floatToRawIntBits(36.0);
        const fontWeightBits = "fontWeight" in component ? this.fbits(component.fontWeight) : floatToRawIntBits(400.0);

        w.textComponent(textId, {
            color, colorId, fontSizeBits, fontWeightBits,
            textAlign: parseTextAlign(String(component.textAlign ?? "start")),
            overflow, maxLines, modifiers: mods,
        });
    }
}

/**
 * Return the RemoteCompose document itself.
 *
 * Generation-library entries wrap the document under a `json` key alongside prose
 * metadata (name, description, tags). Without this the wrapper is compiled instead,
 * which succeeds and emits a bare 17-byte header — a valid, empty document.
 */
export function unwrap(doc: Json): Json {
    if (!("root" in doc) && doc.json && typeof doc.json === "object") return doc.json;
    return doc;
}

/** Compile a document to `.rc` bytes. */
export function compile(input: Json): Uint8Array {
    const doc = unwrap(input);
    const writer = new Writer(parseApiLevel(doc), parseHeaderOnly(doc));
    new Parser(writer).parse(doc);
    return writer.encodeToByteArray();
}
