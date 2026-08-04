/**
 * Writer — the op encoders, mirroring `RemoteComposeWriter.java` and the remote-core
 * Operation classes. Constructing one emits the Header; every method appends ops.
 *
 * Two id counters, and they are not interchangeable:
 *   component ids — start at -1 and **pre**-decrement, so the first is -2. Shared by
 *                   every container start, every content start, and every text.
 *   data ids      — start at 42 and **post**-increment, so the first is 42. Text is
 *                   interned by value, so an identical string reuses its id and emits
 *                   no second DATA_TEXT.
 *
 * Float fields are written as raw 32-bit patterns rather than as floats, because a
 * value may be an expression result carried as a NaN-encoded id. For a plain literal
 * the bits are identical to `writeFloat`, so nothing changes; for an id it is the
 * difference between working and silently losing the reference.
 */

import { WireBuffer, floatToRawIntBits, asNanBits } from "./wire.js";
import { applyHeader, type HeaderTag } from "./header.js";

// ── opcodes (Operations.java) ────────────────────────────────────────────
export const LAYOUT_ROOT = 200;
export const LAYOUT_CONTENT = 201;
export const LAYOUT_BOX = 202;
export const LAYOUT_ROW = 203;
export const LAYOUT_COLUMN = 204;
export const LAYOUT_CANVAS = 205;
export const LAYOUT_CANVAS_CONTENT = 207;
export const LAYOUT_FLOW = 240;
export const LAYOUT_COLLAPSIBLE_COLUMN = 233;
export const LAYOUT_COLLAPSIBLE_ROW = 230;
export const LAYOUT_FIT_BOX = 176;
export const CONTAINER_END = 214;
export const INT_MAX = 2147483647;
export const DATA_TEXT = 102;
export const TEXT_FROM_FLOAT = 135;
export const CORE_TEXT = 239;
export const MODIFIER_WIDTH = 16;
export const MODIFIER_HEIGHT = 67;
export const MODIFIER_BACKGROUND = 55;
export const MODIFIER_PADDING = 58;
export const MODIFIER_BORDER = 107;
export const MODIFIER_WIDTH_IN = 231;
export const MODIFIER_HEIGHT_IN = 232;
export const MODIFIER_ROUNDED_CLIP_RECT = 54;
export const DATA_FLOAT = 80;
export const ANIMATED_FLOAT = 81;
export const NAMED_VARIABLE = 137;
export const COLOR_CONSTANT = 138;
export const FLOAT_LIST = 147;
export const NV_COLOR_TYPE = 2;
export const NV_FLOAT_ARRAY_TYPE = 6;
export const BG_COLOR_REF = 2;
/** NanMap.START_ARRAY — arrays have their own id counter. */
export const START_ARRAY = (2 << 20) + 42;
export const COMPONENT_VALUE = 150;
export const CV_WIDTH = 0;
export const CV_HEIGHT = 1;
export const LOOP_START = 215;
export const CONDITIONAL_OPERATIONS = 178;
export const PAINT_VALUES = 40;
export const DRAW_RECT = 42;
export const DRAW_CIRCLE = 46;
export const DRAW_LINE = 47;
export const DRAW_OVAL = 56;
export const DRAW_ROUND_RECT = 51;
export const DRAW_ARC = 152;
export const DRAW_TEXT_ANCHOR = 133;
export const DRAW_PATH = 124;
export const PATH_CREATE = 159;
export const PATH_APPEND = 160;
export const PATH_LINE = 11;
export const PATH_CLOSE = 15;
export const CLIP_RECT = 39;
export const MATRIX_SCALE = 126;
export const MATRIX_TRANSLATE = 127;
export const MATRIX_ROTATE = 129;
export const MATRIX_SAVE = 130;
export const MATRIX_RESTORE = 131;

// ── PaintBundle command constants (PaintBundle.java) ─────────────────────
export const PB_TEXT_SIZE = 1;
export const PB_COLOR = 4;
export const PB_STROKE_WIDTH = 5;
export const PB_STROKE_CAP = 7;
export const PB_STYLE = 8;
export const PB_SHADER = 9;
export const PB_GRADIENT = 11;
export const PB_ALPHA = 12;
export const PB_STROKE_JOIN = 15;
export const PB_COLOR_ID = 19;
export const PB_PATH_EFFECT = 25;
export const PPE_DASH = 1;
export const GRAD_LINEAR = 0;
export const GRAD_SWEEP = 2;

/** Canonical float32 NaN bits — what `writeFloat(Float.NaN)` produces. */
export const NAN_BITS = 0x7fc00000;

function toInt32(v: number): number {
    return v | 0;
}

/** A modifier is a closure that appends its own op when the container is written. */
export type ModifierEmitter = (w: Writer) => void;

type ParamType = "i" | "f" | "b";
/** CoreText parameters in WRITE ORDER: (name, tag, type, default). */
const CORE_TEXT_PARAMS: Array<[string, number, ParamType, number | boolean]> = [
    ["id", 1, "i", -1],
    ["animationId", 2, "i", -1],
    ["color", 3, "i", 0xff000000],
    ["colorId", 4, "i", -1],
    ["fontSize", 5, "f", 36.0],
    ["minFontSize", 25, "f", -1.0],
    ["maxFontSize", 26, "f", -1.0],
    ["fontStyle", 6, "i", 0],
    ["fontWeight", 7, "f", 400.0],
    ["fontFamily", 8, "i", -1],
    ["textAlign", 9, "i", 1],
    ["overflow", 10, "i", 1],
    ["maxLines", 11, "i", INT_MAX],
    ["letterSpacing", 12, "f", 0.0],
    ["lineHeightAdd", 13, "f", 0.0],
    ["lineHeightMultiplier", 14, "f", 1.0],
    ["lineBreakStrategy", 15, "i", 0],
    ["hyphenationFrequency", 16, "i", 0],
    ["justificationMode", 17, "i", 0],
    ["underline", 18, "b", false],
    ["strikethrough", 19, "b", false],
    ["autosize", 22, "b", false],
    ["flags", 23, "i", 0],
    ["parentId", 24, "i", -1],
];

export interface TextComponentOptions {
    color: number;
    colorId: number;
    fontSizeBits: number;
    fontWeightBits: number;
    textAlign: number;
    overflow: number;
    maxLines: number;
    modifiers: ModifierEmitter[];
}

export class Writer {
    readonly buffer = new WireBuffer();
    private componentId = -1; // pre-decrement, so the first allocation is -2
    /**
     * `RemoteComposeBuffer.mLastComponentId` — 0 until a component actually starts.
     * A `resources` block hoisted into a `global` section runs before any component
     * exists, so `width`/`height` there resolve against component 0, not against the
     * first component that has not been allocated yet.
     */
    private lastComponentId = 0;
    private nextDataId = 42; // post-increment
    private nextArrayId = START_ARRAY;
    private textCache = new Map<string, number>();
    private tffCache = new Map<string, number>();
    private componentValueCache = new Map<string, number>();
    private insertPoint = -1; // where a hoisted global section lands
    private startGlobalSection = -1;

    constructor(public readonly apiLevel: number, tags: HeaderTag[]) {
        applyHeader(this.buffer, apiLevel, tags);
    }

    encodeToByteArray(): Uint8Array {
        return this.buffer.toBytes();
    }

    // ── ids ──────────────────────────────────────────────────────────────

    allocComponentId(): number {
        this.componentId -= 1;
        this.lastComponentId = this.componentId;
        return this.componentId;
    }

    allocDataId(): number {
        return this.nextDataId++;
    }

    // ── global sections (hoisted ahead of the root) ──────────────────────

    beginGlobal(): void {
        if (this.startGlobalSection !== -1) throw new Error("Trying to start a global section twice");
        if (this.insertPoint === -1) this.insertPoint = this.buffer.index;
        this.startGlobalSection = this.buffer.index;
    }

    endGlobal(): void {
        if (this.startGlobalSection === -1) throw new Error("Trying to end a global section without a begin");
        const size = this.buffer.index - this.startGlobalSection;
        this.buffer.moveBlock(this.startGlobalSection, this.insertPoint);
        if (this.insertPoint !== -1) this.insertPoint += size;
        this.startGlobalSection = -1;
    }

    // ── containers ───────────────────────────────────────────────────────

    rootStart(): void {
        if (this.insertPoint === -1) this.insertPoint = this.buffer.index;
        this.buffer.start(LAYOUT_ROOT);
        this.buffer.writeInt(this.allocComponentId());
    }

    containerEnd(): void {
        this.buffer.start(CONTAINER_END);
    }

    contentStart(): void {
        this.buffer.start(LAYOUT_CONTENT);
        this.buffer.writeInt(this.allocComponentId());
    }

    private containerWithAlign(
        op: number, horizontal: number, vertical: number,
        spacedBy: number | null, modifiers: ModifierEmitter[],
    ): void {
        const cid = this.allocComponentId();
        this.buffer.start(op);
        this.buffer.writeInt(cid);
        this.buffer.writeInt(-1); // animationId
        this.buffer.writeInt(horizontal);
        this.buffer.writeInt(vertical);
        if (spacedBy !== null) this.buffer.writeFloat(spacedBy);
        for (const m of modifiers) m(this);
        this.contentStart();
    }

    startColumn(h: number, v: number, mods: ModifierEmitter[], spacedBy = 0.0): void {
        this.containerWithAlign(LAYOUT_COLUMN, h, v, spacedBy, mods);
    }
    startRow(h: number, v: number, mods: ModifierEmitter[], spacedBy = 0.0): void {
        this.containerWithAlign(LAYOUT_ROW, h, v, spacedBy, mods);
    }
    /** Box carries no spacedBy field. */
    startBox(h: number, v: number, mods: ModifierEmitter[]): void {
        this.containerWithAlign(LAYOUT_BOX, h, v, null, mods);
    }
    startCollapsibleColumn(h: number, v: number, mods: ModifierEmitter[], spacedBy = 0.0): void {
        this.containerWithAlign(LAYOUT_COLLAPSIBLE_COLUMN, h, v, spacedBy, mods);
    }
    startCollapsibleRow(h: number, v: number, mods: ModifierEmitter[], spacedBy = 0.0): void {
        this.containerWithAlign(LAYOUT_COLLAPSIBLE_ROW, h, v, spacedBy, mods);
    }
    startFitBox(h: number, v: number, mods: ModifierEmitter[]): void {
        this.containerWithAlign(LAYOUT_FIT_BOX, h, v, null, mods);
    }

    startFlow(h: number, v: number, mods: ModifierEmitter[], maxItems: number, spacedBy = 0.0): void {
        const cid = this.allocComponentId();
        this.buffer.start(LAYOUT_FLOW);
        this.buffer.writeInt(cid);
        this.buffer.writeInt(-1);
        this.buffer.writeInt(h);
        this.buffer.writeInt(v);
        this.buffer.writeFloat(spacedBy);
        this.buffer.writeInt(maxItems);
        this.buffer.writeInt(INT_MAX); // maxLines
        for (const m of mods) m(this);
        this.contentStart();
    }

    /** Every container closes twice: once for its content, once for itself. */
    endContainer(): void {
        this.containerEnd();
        this.containerEnd();
    }

    // ── text ─────────────────────────────────────────────────────────────

    addText(s: string): number {
        const hit = this.textCache.get(s);
        if (hit !== undefined) return hit;
        const dataId = this.allocDataId();
        this.buffer.start(DATA_TEXT);
        this.buffer.writeInt(dataId);
        this.buffer.writeUtf8(s);
        this.textCache.set(s, dataId);
        return dataId;
    }

    /**
     * A text id whose string is a live float, formatted with `before`/`after` digits.
     * `valueBits` are float32 bits — a literal, or a NaN-encoded expression id, which
     * is why they are written raw.
     */
    addTextFromFloat(valueBits: number, before: number, after: number, flags: number): number {
        const key = `${valueBits}|${before}|${after}|${flags}`;
        const hit = this.tffCache.get(key);
        if (hit !== undefined) return hit;
        const dataId = this.allocDataId();
        this.buffer.start(TEXT_FROM_FLOAT);
        this.buffer.writeInt(dataId);
        this.buffer.writeIntBitsAsFloat(valueBits);
        this.buffer.writeInt(((before & 0xffff) << 16) | (after & 0xffff));
        this.buffer.writeInt(flags);
        this.tffCache.set(key, dataId);
        return dataId;
    }

    textComponent(textId: number, o: TextComponentOptions): void {
        const cid = this.allocComponentId();
        const fb = floatToRawIntBits;
        const values: Record<string, number | boolean> = {
            id: cid, animationId: -1, color: o.color, colorId: o.colorId,
            fontSize: o.fontSizeBits, minFontSize: fb(-1.0), maxFontSize: fb(-1.0),
            fontStyle: 0, fontWeight: o.fontWeightBits, fontFamily: -1,
            textAlign: o.textAlign, overflow: o.overflow, maxLines: o.maxLines,
            letterSpacing: fb(0.0), lineHeightAdd: fb(0.0), lineHeightMultiplier: fb(1.0),
            lineBreakStrategy: 0, hyphenationFrequency: 0, justificationMode: 0,
            underline: false, strikethrough: false, autosize: false,
            flags: 0, parentId: -1,
        };
        // Only parameters that differ from their default are emitted.
        const emit: Array<[number, ParamType, number | boolean]> = [];
        for (const [name, tag, typ, dflt] of CORE_TEXT_PARAMS) {
            const v = values[name];
            if (typ === "f") {
                if (v !== fb(dflt as number)) emit.push([tag, typ, v]);
            } else if (typ === "b") {
                if (Boolean(v) !== Boolean(dflt)) emit.push([tag, typ, v]);
            } else {
                if (toInt32(v as number) !== toInt32(dflt as number)) emit.push([tag, typ, v]);
            }
        }
        this.buffer.start(CORE_TEXT);
        this.buffer.writeInt(textId);
        this.buffer.writeShort(emit.length);
        for (const [tag, typ, value] of emit) {
            this.buffer.writeByte(tag);
            if (typ === "b") this.buffer.writeByte(value ? 1 : 0);
            else this.buffer.writeInt(value as number);
        }
        for (const m of o.modifiers) m(this);
        this.contentStart();
        this.containerEnd();
        this.containerEnd();
    }

    // ── canvas + draw ────────────────────────────────────────────────────

    startCanvas(mods: ModifierEmitter[]): void {
        const cid = this.allocComponentId();
        this.buffer.start(LAYOUT_CANVAS);
        this.buffer.writeInt(cid);
        this.buffer.writeInt(-1);
        for (const m of mods) m(this);
        this.contentStart();
        if (this.apiLevel <= 7) {
            const cc = this.allocComponentId();
            this.buffer.start(LAYOUT_CANVAS_CONTENT);
            this.buffer.writeInt(cc);
        }
    }

    endCanvas(): void {
        if (this.apiLevel <= 7) this.containerEnd();
        this.containerEnd();
        this.containerEnd();
    }

    paintValues(ints: number[]): void {
        this.buffer.start(PAINT_VALUES);
        this.buffer.writeInt(ints.length); // PaintBundle.writeBundle: mPos
        for (const v of ints) this.buffer.writeInt(v);
    }

    /**
     * A FloatExpression (ANIMATED_FLOAT); returns its asNan(id) bits.
     * `animFloats` is the packed animation array (e.g. [duration]); null means none.
     */
    floatExpression(opsBits: number[], animFloats: number[] | null = null): number {
        const dataId = this.allocDataId();
        this.buffer.start(ANIMATED_FLOAT);
        this.buffer.writeInt(dataId);
        const nAnim = animFloats ? animFloats.length : 0;
        this.buffer.writeInt(opsBits.length | (nAnim << 16));
        for (const b of opsBits) this.buffer.writeInt(b);
        if (animFloats) for (const v of animFloats) this.buffer.writeFloat(v);
        return asNanBits(dataId);
    }

    addFloatConstant(value: number): number {
        const dataId = this.allocDataId();
        this.buffer.start(DATA_FLOAT);
        this.buffer.writeInt(dataId);
        this.buffer.writeFloat(value);
        return asNanBits(dataId);
    }

    /** COLOR_CONSTANT; returns the raw colour id, which is *not* NaN-encoded. */
    addColor(color: number): number {
        const colorId = this.allocDataId();
        this.buffer.start(COLOR_CONSTANT);
        this.buffer.writeInt(colorId);
        this.buffer.writeInt(color);
        return colorId;
    }

    addNamedColor(name: string, color: number): number {
        const colorId = this.addColor(color);
        this.buffer.start(NAMED_VARIABLE);
        this.buffer.writeInt(colorId);
        this.buffer.writeInt(NV_COLOR_TYPE);
        this.buffer.writeUtf8(name);
        return colorId;
    }

    addFloatArray(values: number[]): number {
        const arrayId = this.nextArrayId++;
        this.buffer.start(FLOAT_LIST);
        this.buffer.writeInt(arrayId);
        this.buffer.writeInt(values.length);
        for (const v of values) this.buffer.writeFloat(v);
        return arrayId;
    }

    addNamedFloatArray(name: string, values: number[]): number {
        const arrayId = this.addFloatArray(values);
        this.buffer.start(NAMED_VARIABLE);
        this.buffer.writeInt(arrayId);
        this.buffer.writeInt(NV_FLOAT_ARRAY_TYPE);
        this.buffer.writeUtf8(name);
        return arrayId;
    }

    /** WIDTH/HEIGHT of the last component, cached per (component, type). */
    addComponentValue(valueType: number): number {
        const componentId = this.lastComponentId;
        const key = `${componentId}|${valueType}`;
        const cached = this.componentValueCache.get(key);
        if (cached !== undefined) return cached;
        const dataId = this.allocDataId();
        this.buffer.start(COMPONENT_VALUE);
        this.buffer.writeInt(valueType);
        this.buffer.writeInt(componentId);
        this.buffer.writeInt(dataId); // idFromNan(value)
        const value = asNanBits(dataId);
        this.componentValueCache.set(key, value);
        return value;
    }

    addComponentWidthValue(): number { return this.addComponentValue(CV_WIDTH); }
    addComponentHeightValue(): number { return this.addComponentValue(CV_HEIGHT); }

    private op(code: number, bits: number[]): void {
        this.buffer.start(code);
        for (const b of bits) this.buffer.writeInt(b);
    }

    drawCircle(cx: number, cy: number, r: number): void { this.op(DRAW_CIRCLE, [cx, cy, r]); }
    drawLine(x1: number, y1: number, x2: number, y2: number): void { this.op(DRAW_LINE, [x1, y1, x2, y2]); }
    drawRect(l: number, t: number, r: number, b: number): void { this.op(DRAW_RECT, [l, t, r, b]); }
    drawOval(l: number, t: number, r: number, b: number): void { this.op(DRAW_OVAL, [l, t, r, b]); }
    drawRoundRect(l: number, t: number, r: number, b: number, rx: number, ry: number): void {
        this.op(DRAW_ROUND_RECT, [l, t, r, b, rx, ry]);
    }
    drawArc(l: number, t: number, r: number, b: number, start: number, sweep: number): void {
        this.op(DRAW_ARC, [l, t, r, b, start, sweep]);
    }
    drawPath(pathId: number): void { this.op(DRAW_PATH, [pathId]); }
    clipRect(l: number, t: number, r: number, b: number): void { this.op(CLIP_RECT, [l, t, r, b]); }

    pathCreate(xBits: number, yBits: number): number {
        const pathId = this.allocDataId();
        this.op(PATH_CREATE, [pathId, xBits, yBits]);
        return pathId;
    }

    pathAppendLineTo(pathId: number, xBits: number, yBits: number): void {
        this.op(PATH_APPEND, [
            pathId, 5, asNanBits(PATH_LINE),
            floatToRawIntBits(0.0), floatToRawIntBits(0.0), xBits, yBits,
        ]);
    }

    pathAppendClose(pathId: number): void {
        this.op(PATH_APPEND, [pathId, 1, asNanBits(PATH_CLOSE)]);
    }

    drawTextAnchored(textId: number, x: number, y: number, panX: number, panY: number, flags: number): void {
        this.op(DRAW_TEXT_ANCHOR, [textId, x, y, panX, panY, flags]);
    }

    // ── control flow ─────────────────────────────────────────────────────

    startLoop(indexId: number, fromBits: number, stepBits: number, untilBits: number): void {
        this.op(LOOP_START, [indexId, fromBits, stepBits, untilBits]);
    }
    endLoop(): void { this.containerEnd(); }

    conditionalOperations(condType: number, aBits: number, bBits: number): void {
        this.buffer.start(CONDITIONAL_OPERATIONS);
        this.buffer.writeByte(condType);
        this.buffer.writeInt(aBits);
        this.buffer.writeInt(bBits);
    }
    endConditional(): void { this.containerEnd(); }

    // ── transforms ───────────────────────────────────────────────────────

    matrixSave(): void { this.buffer.start(MATRIX_SAVE); }
    matrixRestore(): void { this.buffer.start(MATRIX_RESTORE); }
    translate(dx: number, dy: number): void { this.op(MATRIX_TRANSLATE, [dx, dy]); }
    rotate(angle: number, pivotX = NAN_BITS, pivotY = NAN_BITS): void {
        this.op(MATRIX_ROTATE, [angle, pivotX, pivotY]);
    }
    scale(sx: number, sy: number, pivotX = NAN_BITS, pivotY = NAN_BITS): void {
        this.op(MATRIX_SCALE, [sx, sy, pivotX, pivotY]);
    }
}

// ── modifier emitters ────────────────────────────────────────────────────
// Float values arrive as raw float32 bits: a literal, or an expression's NaN id.

function argb(color: number): [number, number, number, number] {
    return [
        ((color >>> 24) & 0xff) / 255.0,
        ((color >>> 16) & 0xff) / 255.0,
        ((color >>> 8) & 0xff) / 255.0,
        (color & 0xff) / 255.0,
    ];
}

export function modWidth(typeOrdinal: number, valueBits: number): ModifierEmitter {
    return (w) => {
        w.buffer.start(MODIFIER_WIDTH);
        w.buffer.writeInt(typeOrdinal);
        w.buffer.writeInt(valueBits);
    };
}

export function modHeight(typeOrdinal: number, valueBits: number): ModifierEmitter {
    return (w) => {
        w.buffer.start(MODIFIER_HEIGHT);
        w.buffer.writeInt(typeOrdinal);
        w.buffer.writeInt(valueBits);
    };
}

export function modBackground(color: number): ModifierEmitter {
    const [a, r, g, b] = argb(color);
    return (w) => {
        w.buffer.start(MODIFIER_BACKGROUND);
        w.buffer.writeInt(0); // flags
        w.buffer.writeInt(0); // colorId
        w.buffer.writeInt(0); // reserve1
        w.buffer.writeInt(0); // reserve2
        w.buffer.writeFloat(r);
        w.buffer.writeFloat(g);
        w.buffer.writeFloat(b);
        w.buffer.writeFloat(a);
        w.buffer.writeInt(0); // shapeType
    };
}

/** Background referencing a colour id (DynamicSolidBackgroundModifier). */
export function modBackgroundId(colorId: number): ModifierEmitter {
    return (w) => {
        w.buffer.start(MODIFIER_BACKGROUND);
        w.buffer.writeInt(BG_COLOR_REF);
        w.buffer.writeInt(colorId);
        w.buffer.writeInt(0);
        w.buffer.writeInt(0);
        w.buffer.writeFloat(0.0);
        w.buffer.writeFloat(0.0);
        w.buffer.writeFloat(0.0);
        w.buffer.writeFloat(0.0);
        w.buffer.writeInt(0);
    };
}

export function modPadding(l: number, t: number, r: number, b: number): ModifierEmitter {
    return (w) => {
        w.buffer.start(MODIFIER_PADDING);
        for (const v of [l, t, r, b]) w.buffer.writeInt(v);
    };
}

export function modBorder(width: number, corner: number, color: number, shape: number): ModifierEmitter {
    const [a, r, g, b] = argb(color);
    return (w) => {
        w.buffer.start(MODIFIER_BORDER);
        w.buffer.writeInt(0); w.buffer.writeInt(0); w.buffer.writeInt(0); w.buffer.writeInt(0);
        w.buffer.writeFloat(width);
        w.buffer.writeFloat(corner);
        w.buffer.writeFloat(r); w.buffer.writeFloat(g); w.buffer.writeFloat(b); w.buffer.writeFloat(a);
        w.buffer.writeInt(shape);
    };
}

export function modWidthIn(minBits: number, maxBits: number): ModifierEmitter {
    return (w) => {
        w.buffer.start(MODIFIER_WIDTH_IN);
        w.buffer.writeInt(minBits);
        w.buffer.writeInt(maxBits);
    };
}

export function modHeightIn(minBits: number, maxBits: number): ModifierEmitter {
    return (w) => {
        w.buffer.start(MODIFIER_HEIGHT_IN);
        w.buffer.writeInt(minBits);
        w.buffer.writeInt(maxBits);
    };
}

export function modClipRoundedRect(ts: number, te: number, bs: number, be: number): ModifierEmitter {
    return (w) => {
        w.buffer.start(MODIFIER_ROUNDED_CLIP_RECT);
        for (const v of [ts, te, bs, be]) w.buffer.writeFloat(v);
    };
}
