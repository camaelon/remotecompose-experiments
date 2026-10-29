// ModifierOperations: layout modifier operations for the layout system.

import { Operation } from '../../../Operation';
import type { VariableSupport } from '../../../VariableSupport';
import type { WireBuffer } from '../../../WireBuffer';
import { ContextMode, RemoteContext } from '../../../RemoteContext';
import { PaintBundle } from '../../paint/PaintBundle';
import { isNaNBits, idFromBits, intBitsToFloat, isVariableBits, interpolateColor } from '../../Utils';
import { Visibility } from '../Component';
import { TouchExpression } from '../../TouchExpression';
import type { PaintContext } from '../../../PaintContext';
import { CubicEasing } from '../../utilities/easing/CubicEasing';
import { Easing } from '../../utilities/easing/Easing';

/**
 * What the measure pass needs from a min/max constraint, regardless of which op it
 * arrived as (WidthIn/HeightIn 231/232, or DimensionConstraints 243).
 */
export interface DimensionConstraint {
    getMin(): number;
    getMax(): number;
}

// ── MODIFIER_WIDTH (16): INT type, FLOAT value ───────────────────────
export class WidthModifier extends Operation implements VariableSupport {
    static readonly OP_CODE = 16;
    static readonly EXACT = 0;
    static readonly FILL = 1;
    static readonly WRAP = 2;
    static readonly WEIGHT = 3;
    static readonly INTRINSIC_MIN = 4;
    static readonly INTRINSIC_MAX = 5;
    static readonly EXACT_DP = 6;
    static readonly FILL_PARENT_MAX_WIDTH = 7;
    static readonly FILL_PARENT_MAX_HEIGHT = 8;
    private mType: number;
    private mValueBits: number;
    private mOutValue: number;
    constructor(type: number, valueBits: number) {
        super(); this.mType = type; this.mValueBits = valueBits;
        this.mOutValue = isNaNBits(valueBits) ? 0 : intBitsToFloat(valueBits);
    }
    getType(): number { return this.mType; }
    getValue(): number { return this.mOutValue; }
    /** True when a fill fraction was supplied. A bare fill encodes NaN, which
     *  getValue() reports as 0 — so the raw bits are the only way to tell
     *  "fill half" from "fill completely". */
    hasFraction(): boolean { return !isNaNBits(this.mValueBits); }
    // Java DimensionModifierOperation.registerListening / updateVariables: EXACT scales by
    // density only under DENSITY_BEHAVIOR_DP, EXACT_DP always; both re-resolve from the
    // authored value (a literal or a variable) each time.
    registerListening(context: RemoteContext): void {
        if (this.mType === WidthModifier.EXACT || this.mType === WidthModifier.EXACT_DP) {
            if (isNaNBits(this.mValueBits)) context.listensTo(idFromBits(this.mValueBits), this);
            if (this.mType === WidthModifier.EXACT_DP
                || context.getDensityBehavior?.() === RemoteContext.DENSITY_BEHAVIOR_DP) {
                context.listensTo(27 /* ID_DENSITY */, this);
            }
        }
    }
    updateVariables(context: RemoteContext): void {
        if (this.mType === WidthModifier.EXACT || this.mType === WidthModifier.EXACT_DP) {
            const pre = this.mOutValue;
            this.mOutValue = isNaNBits(this.mValueBits)
                ? context.getFloat(idFromBits(this.mValueBits)) : intBitsToFloat(this.mValueBits);
            if (this.mType === WidthModifier.EXACT_DP
                || context.getDensityBehavior?.() === RemoteContext.DENSITY_BEHAVIOR_DP) {
                const density = context.getDensity();
                if (density > 0 && !Number.isNaN(density)) this.mOutValue *= density;
            }
            // Java: a changed value re-measures the document (root invalidateMeasure), so a
            // width/height bound to a variable a click changes takes effect (T: was missing).
            if (pre !== this.mOutValue) context.getDocument?.()?.invalidateMeasure();
        }
    }
    write(_buffer: WireBuffer): void { /* stub */ }
    apply(_context: RemoteContext): void { /* handled by layout */ }
    deepToString(indent: string): string { return `${indent}WidthModifier(${this.mType}, ${this.mOutValue})`; }
    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new WidthModifier(buffer.readInt(), buffer.readNanIdBits()));
    }
}

// ── MODIFIER_HEIGHT (67): INT type, FLOAT value ──────────────────────
export class HeightModifier extends Operation implements VariableSupport {
    static readonly OP_CODE = 67;
    static readonly EXACT = 0;
    static readonly FILL = 1;
    static readonly WRAP = 2;
    static readonly WEIGHT = 3;
    static readonly INTRINSIC_MIN = 4;
    static readonly INTRINSIC_MAX = 5;
    static readonly EXACT_DP = 6;
    static readonly FILL_PARENT_MAX_WIDTH = 7;
    static readonly FILL_PARENT_MAX_HEIGHT = 8;
    private mType: number;
    private mValueBits: number;
    private mOutValue: number;
    constructor(type: number, valueBits: number) {
        super(); this.mType = type; this.mValueBits = valueBits;
        this.mOutValue = isNaNBits(valueBits) ? 0 : intBitsToFloat(valueBits);
    }
    getType(): number { return this.mType; }
    getValue(): number { return this.mOutValue; }
    /** True when a fill fraction was supplied. A bare fill encodes NaN, which
     *  getValue() reports as 0 — so the raw bits are the only way to tell
     *  "fill half" from "fill completely". */
    hasFraction(): boolean { return !isNaNBits(this.mValueBits); }
    // Java DimensionModifierOperation.registerListening / updateVariables: EXACT scales by
    // density only under DENSITY_BEHAVIOR_DP, EXACT_DP always; both re-resolve from the
    // authored value (a literal or a variable) each time.
    registerListening(context: RemoteContext): void {
        if (this.mType === HeightModifier.EXACT || this.mType === HeightModifier.EXACT_DP) {
            if (isNaNBits(this.mValueBits)) context.listensTo(idFromBits(this.mValueBits), this);
            if (this.mType === HeightModifier.EXACT_DP
                || context.getDensityBehavior?.() === RemoteContext.DENSITY_BEHAVIOR_DP) {
                context.listensTo(27 /* ID_DENSITY */, this);
            }
        }
    }
    updateVariables(context: RemoteContext): void {
        if (this.mType === HeightModifier.EXACT || this.mType === HeightModifier.EXACT_DP) {
            const pre = this.mOutValue;
            this.mOutValue = isNaNBits(this.mValueBits)
                ? context.getFloat(idFromBits(this.mValueBits)) : intBitsToFloat(this.mValueBits);
            if (this.mType === HeightModifier.EXACT_DP
                || context.getDensityBehavior?.() === RemoteContext.DENSITY_BEHAVIOR_DP) {
                const density = context.getDensity();
                if (density > 0 && !Number.isNaN(density)) this.mOutValue *= density;
            }
            // Java: a changed value re-measures the document (root invalidateMeasure), so a
            // width/height bound to a variable a click changes takes effect (T: was missing).
            if (pre !== this.mOutValue) context.getDocument?.()?.invalidateMeasure();
        }
    }
    write(_buffer: WireBuffer): void { /* stub */ }
    apply(_context: RemoteContext): void { /* handled by layout */ }
    deepToString(indent: string): string { return `${indent}HeightModifier(${this.mType}, ${this.mOutValue})`; }
    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new HeightModifier(buffer.readInt(), buffer.readNanIdBits()));
    }
}

// ── MODIFIER_WIDTH_IN (231): FLOAT min, FLOAT max ────────────────────
export class WidthInModifier extends Operation implements VariableSupport {
    static readonly OP_CODE = 231;
    private mMinBits: number; private mMaxBits: number;
    private mOutMin: number; private mOutMax: number;
    constructor(minBits: number, maxBits: number) {
        super();
        this.mMinBits = minBits; this.mMaxBits = maxBits;
        this.mOutMin = isNaNBits(minBits) ? 0 : intBitsToFloat(minBits);
        this.mOutMax = isNaNBits(maxBits) ? 0 : intBitsToFloat(maxBits);
    }
    getMin(): number { return this.mOutMin; }
    getMax(): number { return this.mOutMax; }
    registerListening(context: RemoteContext): void {
        if (isNaNBits(this.mMinBits)) context.listensTo(idFromBits(this.mMinBits), this);
        if (isNaNBits(this.mMaxBits)) context.listensTo(idFromBits(this.mMaxBits), this);
    }
    updateVariables(context: RemoteContext): void {
        if (isNaNBits(this.mMinBits)) this.mOutMin = context.getFloat(idFromBits(this.mMinBits));
        if (isNaNBits(this.mMaxBits)) this.mOutMax = context.getFloat(idFromBits(this.mMaxBits));
        // These bounds are authored in dp, so they scale with density — the reference
        // does the same in DimensionInModifierOperation.updateVariables, and scales unless
        // the document explicitly says PIXELS (LEGACY, the default, still scales).
        // Without it a `widthIn(120, MAX)` card was compared against a pixel viewport as
        // if it were 120 physical pixels, so a Flow packed four cards into a row the
        // device fits three into.
        if (context.getDensityBehavior?.() !== RemoteContext.DENSITY_BEHAVIOR_PIXELS) {
            const density = context.getDensity();
            if (density > 0 && !Number.isNaN(density)) {
                if (this.mOutMin !== -1) this.mOutMin *= density;
                if (this.mOutMax !== -1 && Number.isFinite(this.mOutMax)) this.mOutMax *= density;
            }
        }
    }
    write(_buffer: WireBuffer): void { /* stub */ }
    apply(_context: RemoteContext): void { /* handled by layout */ }
    deepToString(indent: string): string { return `${indent}WidthInModifier(${this.mOutMin}, ${this.mOutMax})`; }
    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new WidthInModifier(buffer.readNanIdBits(), buffer.readNanIdBits()));
    }
}

// ── MODIFIER_HEIGHT_IN (232): FLOAT min, FLOAT max ───────────────────
export class HeightInModifier extends Operation implements VariableSupport {
    static readonly OP_CODE = 232;
    private mMinBits: number; private mMaxBits: number;
    private mOutMin: number; private mOutMax: number;
    constructor(minBits: number, maxBits: number) {
        super();
        this.mMinBits = minBits; this.mMaxBits = maxBits;
        this.mOutMin = isNaNBits(minBits) ? 0 : intBitsToFloat(minBits);
        this.mOutMax = isNaNBits(maxBits) ? 0 : intBitsToFloat(maxBits);
    }
    getMin(): number { return this.mOutMin; }
    getMax(): number { return this.mOutMax; }
    registerListening(context: RemoteContext): void {
        if (isNaNBits(this.mMinBits)) context.listensTo(idFromBits(this.mMinBits), this);
        if (isNaNBits(this.mMaxBits)) context.listensTo(idFromBits(this.mMaxBits), this);
    }
    updateVariables(context: RemoteContext): void {
        if (isNaNBits(this.mMinBits)) this.mOutMin = context.getFloat(idFromBits(this.mMinBits));
        if (isNaNBits(this.mMaxBits)) this.mOutMax = context.getFloat(idFromBits(this.mMaxBits));
        // These bounds are authored in dp, so they scale with density — the reference
        // does the same in DimensionInModifierOperation.updateVariables, and scales unless
        // the document explicitly says PIXELS (LEGACY, the default, still scales).
        // Without it a `widthIn(120, MAX)` card was compared against a pixel viewport as
        // if it were 120 physical pixels, so a Flow packed four cards into a row the
        // device fits three into.
        if (context.getDensityBehavior?.() !== RemoteContext.DENSITY_BEHAVIOR_PIXELS) {
            const density = context.getDensity();
            if (density > 0 && !Number.isNaN(density)) {
                if (this.mOutMin !== -1) this.mOutMin *= density;
                if (this.mOutMax !== -1 && Number.isFinite(this.mOutMax)) this.mOutMax *= density;
            }
        }
    }
    write(_buffer: WireBuffer): void { /* stub */ }
    apply(_context: RemoteContext): void { /* handled by layout */ }
    deepToString(indent: string): string { return `${indent}HeightInModifier(${this.mOutMin}, ${this.mOutMax})`; }
    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new HeightInModifier(buffer.readNanIdBits(), buffer.readNanIdBits()));
    }
}

// ── MODIFIER_COLLAPSIBLE_PRIORITY (235): INT orientation, FLOAT priority
export class CollapsiblePriorityModifier extends Operation {
    static readonly OP_CODE = 235;
    private mOrientation: number; private mPriority: number;
    constructor(orientation: number, priority: number) { super(); this.mOrientation = orientation; this.mPriority = priority; }
    getOrientation(): number { return this.mOrientation; }
    getPriority(): number { return this.mPriority; }
    write(_buffer: WireBuffer): void { /* stub */ }
    apply(_context: RemoteContext): void { /* handled by layout */ }
    deepToString(indent: string): string { return `${indent}CollapsiblePriorityModifier`; }
    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new CollapsiblePriorityModifier(buffer.readInt(), intBitsToFloat(buffer.readNanIdBits())));
    }
}

// ── MODIFIER_BACKGROUND (55): INT flags, INT colorId, INT res1, INT res2,
//    FLOAT r, FLOAT g, FLOAT b, FLOAT a, INT shapeType ────────────────
export class BackgroundModifier extends Operation implements VariableSupport {
    static readonly OP_CODE = 55;
    private static readonly COLOR_REF = 2;
    private mFlags: number; private mColorId: number;
    // r/g/b/a as raw float32 int bits (may be NaN-encoded color-var refs).
    private mR: number; private mG: number; private mB: number; private mA: number;
    private mOutR: number; private mOutG: number; private mOutB: number; private mOutA: number;
    private mShapeType: number;
    private mComponent: any = null;
    private mLayoutW = 0; private mLayoutH = 0;
    constructor(flags: number, colorId: number, r: number, g: number, b: number, a: number, shapeType: number) {
        super(); this.mFlags = flags; this.mColorId = colorId;
        this.mR = r; this.mG = g; this.mB = b; this.mA = a;
        this.mOutR = isNaNBits(r) ? 0 : intBitsToFloat(r);
        this.mOutG = isNaNBits(g) ? 0 : intBitsToFloat(g);
        this.mOutB = isNaNBits(b) ? 0 : intBitsToFloat(b);
        this.mOutA = isNaNBits(a) ? 0 : intBitsToFloat(a);
        this.mShapeType = shapeType;
    }
    setComponent(c: any): void { this.mComponent = c; }
    layoutDecorator(w: number, h: number): void { this.mLayoutW = w; this.mLayoutH = h; }
    registerListening(context: RemoteContext): void {
        if (this.mFlags === BackgroundModifier.COLOR_REF) {
            context.listensTo(this.mColorId, this);
        } else {
            if (isNaNBits(this.mR)) context.listensTo(idFromBits(this.mR), this);
            if (isNaNBits(this.mG)) context.listensTo(idFromBits(this.mG), this);
            if (isNaNBits(this.mB)) context.listensTo(idFromBits(this.mB), this);
            if (isNaNBits(this.mA)) context.listensTo(idFromBits(this.mA), this);
        }
    }
    updateVariables(context: RemoteContext): void {
        if (this.mFlags !== BackgroundModifier.COLOR_REF) {
            if (isNaNBits(this.mR)) this.mOutR = context.getFloat(idFromBits(this.mR));
            if (isNaNBits(this.mG)) this.mOutG = context.getFloat(idFromBits(this.mG));
            if (isNaNBits(this.mB)) this.mOutB = context.getFloat(idFromBits(this.mB));
            if (isNaNBits(this.mA)) this.mOutA = context.getFloat(idFromBits(this.mA));
        }
    }
    write(_buffer: WireBuffer): void { /* stub */ }
    apply(context: RemoteContext): void {
        if (context.mMode !== ContextMode.PAINT) return;
        const pc = context.getPaintContext();
        if (!pc) return;

        const w = this.mLayoutW;
        const h = this.mLayoutH;
        if (w <= 0 || h <= 0) return;

        pc.savePaint();

        // Build a minimal PaintBundle: STYLE=FILL + COLOR=argb
        let argb: number;
        if (this.mFlags === BackgroundModifier.COLOR_REF) {
            argb = context.mRemoteComposeState.getColor(this.mColorId);
        } else {
            const a = Math.trunc(this.mOutA * 255 + 0.5);
            const r = Math.trunc(this.mOutR * 255 + 0.5);
            const g = Math.trunc(this.mOutG * 255 + 0.5);
            const b = Math.trunc(this.mOutB * 255 + 0.5);
            argb = ((a << 24) | (r << 16) | (g << 8) | b) | 0;
        }
        const pb = new PaintBundle();
        pb.mArray = [PaintBundle.STYLE, PaintBundle.COLOR, argb];
        pb.mPos = 3;
        pc.replacePaint(pb);

        if (this.mShapeType === 1) { // CIRCLE
            pc.drawCircle(w / 2, h / 2, Math.min(w, h) / 2);
        } else { // RECTANGLE (0)
            pc.drawRect(0, 0, w, h);
        }

        pc.restorePaint();
    }
    deepToString(indent: string): string { return `${indent}BackgroundModifier`; }
    static read(buffer: WireBuffer, operations: Operation[]): void {
        // Java BackgroundModifierOperation.read: colorId remapped (readId),
        // r/g/b/a are readNanId (NaN-encoded color-var refs remap in macros).
        const flags = buffer.readInt();
        // As the reference: the colour is an id only when COLOR_REF is set, and only then is it
        // remapped inside a pattern; otherwise the word is a literal and must not be touched.
        let colorId = buffer.readInt();
        if ((flags & 2) !== 0) colorId = (buffer as any).getRemapContext?.()?.resolveId(colorId) ?? colorId;
        buffer.readInt(); // reserve1
        buffer.readInt(); // reserve2
        const r = buffer.readNanIdBits();
        const g = buffer.readNanIdBits();
        const b = buffer.readNanIdBits();
        const a = buffer.readNanIdBits();
        const shapeType = buffer.readInt();
        operations.push(new BackgroundModifier(flags, colorId, r, g, b, a, shapeType));
    }
}

// ── MODIFIER_BORDER (107): INT flags, INT colorId, INT res1, INT res2,
//    FLOAT borderWidth, FLOAT roundedCorner, FLOAT r, FLOAT g, FLOAT b, FLOAT a, INT shapeType
export class BorderModifier extends Operation {
    static readonly OP_CODE = 107;
    private static readonly COLOR_REF = 2;
    private mFlags: number;
    private mColorId: number;
    private mBorderWidth: number;
    private mRoundedCorner: number;
    private mR: number; private mG: number; private mB: number; private mA: number;
    private mShapeType: number;
    private mComponent: any = null;
    private mLayoutW = 0; private mLayoutH = 0;
    constructor(flags: number, colorId: number, borderWidth: number, roundedCorner: number,
                r: number, g: number, b: number, a: number, shapeType: number) {
        super();
        this.mFlags = flags; this.mColorId = colorId;
        this.mBorderWidth = borderWidth; this.mRoundedCorner = roundedCorner;
        this.mR = r; this.mG = g; this.mB = b; this.mA = a; this.mShapeType = shapeType;
    }
    setComponent(c: any): void { this.mComponent = c; }
    layoutDecorator(w: number, h: number): void { this.mLayoutW = w; this.mLayoutH = h; }
    write(_buffer: WireBuffer): void { /* stub */ }
    apply(context: RemoteContext): void {
        if (context.mMode !== ContextMode.PAINT) return;
        const pc = context.getPaintContext();
        if (!pc) return;
        const w = this.mLayoutW;
        const h = this.mLayoutH;
        if (w <= 0 || h <= 0) return;

        pc.savePaint();
        const pb = new PaintBundle();
        let argb: number;
        if (this.mFlags === BorderModifier.COLOR_REF) {
            argb = context.mRemoteComposeState.getColor(this.mColorId);
        } else {
            const a = Math.trunc(this.mA * 255 + 0.5);
            const r = Math.trunc(this.mR * 255 + 0.5);
            const g = Math.trunc(this.mG * 255 + 0.5);
            const b = Math.trunc(this.mB * 255 + 0.5);
            argb = ((a << 24) | (r << 16) | (g << 8) | b) | 0;
        }
        pb.reset();
        pb.setStyle(PaintBundle.STROKE);
        pb.setColor(argb);
        pb.setStrokeWidth(this.mBorderWidth);
        pc.replacePaint(pb);

        if (this.mRoundedCorner > 0) {
            pc.drawRoundRect(0, 0, w, h, this.mRoundedCorner, this.mRoundedCorner);
        } else {
            pc.drawRect(0, 0, w, h);
        }
        pc.restorePaint();
    }
    deepToString(indent: string): string { return `${indent}BorderModifier`; }
    static read(buffer: WireBuffer, operations: Operation[]): void {
        // Java BorderModifierOperation.read: the colour is an id, remapped in macros, only
        // with COLOR_REF (flag 2); float fields are readNanId.
        const flags = buffer.readInt();
        let colorId = buffer.readInt();
        if ((flags & 2) !== 0) colorId = (buffer as any).getRemapContext?.()?.resolveId(colorId) ?? colorId;
        buffer.readInt(); // reserve1
        buffer.readInt(); // reserve2
        // Bits, then literal — see PaddingModifier below, which has always done this.
        // BorderModifier does not implement VariableSupport, so a variable here has never
        // resolved; taking the literal gives 0 rather than a NaN that erases the border.
        const lit = (bits: number) => (isNaNBits(bits) ? 0 : intBitsToFloat(bits));
        const borderWidth = lit(buffer.readNanIdBits());
        const roundedCorner = lit(buffer.readNanIdBits());
        const r = lit(buffer.readNanIdBits());
        const g = lit(buffer.readNanIdBits());
        const b = lit(buffer.readNanIdBits());
        const a = lit(buffer.readNanIdBits());
        const shapeType = buffer.readInt();
        operations.push(new BorderModifier(flags, colorId, borderWidth, roundedCorner, r, g, b, a, shapeType));
    }
}

// ── MODIFIER_PADDING (58): FLOAT left, FLOAT top, FLOAT right, FLOAT bottom
export class PaddingModifier extends Operation implements VariableSupport {
    static readonly OP_CODE = 58;
    // l/t/r/b as raw float32 int bits (may be NaN-encoded variable refs).
    private mLeft: number; private mTop: number; private mRight: number; private mBottom: number;
    mLeftValue: number; mTopValue: number; mRightValue: number; mBottomValue: number;
    constructor(l: number, t: number, r: number, b: number) {
        super();
        this.mLeft = l; this.mTop = t; this.mRight = r; this.mBottom = b;
        this.mLeftValue = isNaNBits(l) ? 0 : intBitsToFloat(l);
        this.mTopValue = isNaNBits(t) ? 0 : intBitsToFloat(t);
        this.mRightValue = isNaNBits(r) ? 0 : intBitsToFloat(r);
        this.mBottomValue = isNaNBits(b) ? 0 : intBitsToFloat(b);
    }
    registerListening(context: RemoteContext): void {
        if (isNaNBits(this.mLeft)) context.listensTo(idFromBits(this.mLeft), this);
        if (isNaNBits(this.mTop)) context.listensTo(idFromBits(this.mTop), this);
        if (isNaNBits(this.mRight)) context.listensTo(idFromBits(this.mRight), this);
        if (isNaNBits(this.mBottom)) context.listensTo(idFromBits(this.mBottom), this);
    }
    updateVariables(context: RemoteContext): void {
        // Reassign from the source bits every time rather than only in the NaN branch, which
        // is what Java does. It matters now that density scaling follows: leaving a literal
        // in place and scaling it again on the next call would multiply the density in.
        this.mLeftValue = isNaNBits(this.mLeft)
            ? context.getFloat(idFromBits(this.mLeft)) : intBitsToFloat(this.mLeft);
        this.mTopValue = isNaNBits(this.mTop)
            ? context.getFloat(idFromBits(this.mTop)) : intBitsToFloat(this.mTop);
        this.mRightValue = isNaNBits(this.mRight)
            ? context.getFloat(idFromBits(this.mRight)) : intBitsToFloat(this.mRight);
        this.mBottomValue = isNaNBits(this.mBottom)
            ? context.getFloat(idFromBits(this.mBottom)) : intBitsToFloat(this.mBottom);

        // Padding is dp only when the document says so — note this is `== DP`, not the
        // `!= PIXELS` the dimension modifiers use. Under the default LEGACY behaviour Java
        // does not scale padding either, so this is deliberately inert for most documents.
        if (context.getDensityBehavior() === RemoteContext.DENSITY_BEHAVIOR_DP) {
            const density = context.getDensity();
            if (density > 0 && !Number.isNaN(density)) {
                this.mLeftValue *= density;
                this.mTopValue *= density;
                this.mRightValue *= density;
                this.mBottomValue *= density;
            }
        }
    }
    write(_buffer: WireBuffer): void { /* stub */ }
    apply(_context: RemoteContext): void { /* handled by layout */ }
    deepToString(indent: string): string { return `${indent}PaddingModifier(${this.mLeftValue}, ${this.mTopValue}, ${this.mRightValue}, ${this.mBottomValue})`; }
    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new PaddingModifier(
            buffer.readNanIdBits(), buffer.readNanIdBits(), buffer.readNanIdBits(), buffer.readNanIdBits()));
    }
}

// ── MODIFIER_ROUNDED_CLIP_RECT (54): FLOAT topStart, FLOAT topEnd, FLOAT bottomStart, FLOAT bottomEnd
export class RoundedClipRectModifier extends Operation {
    static readonly OP_CODE = 54;
    private mTopStart: number; private mTopEnd: number;
    private mBottomStart: number; private mBottomEnd: number;
    private mLayoutW = 0; private mLayoutH = 0;
    private mComponent: any = null;
    constructor(topStart: number, topEnd: number, bottomStart: number, bottomEnd: number) {
        super();
        this.mTopStart = topStart; this.mTopEnd = topEnd;
        this.mBottomStart = bottomStart; this.mBottomEnd = bottomEnd;
    }
    setComponent(c: any): void { this.mComponent = c; }
    layoutDecorator(w: number, h: number): void { this.mLayoutW = w; this.mLayoutH = h; }
    write(_buffer: WireBuffer): void { /* stub */ }
    apply(context: RemoteContext): void {
        if (context.mMode !== ContextMode.PAINT) return;
        const pc = context.getPaintContext();
        if (!pc) return;
        const w = this.mLayoutW;
        const h = this.mLayoutH;
        if (w > 0 && h > 0) {
            pc.roundedClipRect(w, h, this.mTopStart, this.mTopEnd, this.mBottomStart, this.mBottomEnd);
        }
    }
    deepToString(indent: string): string { return `${indent}RoundedClipRectModifier`; }
    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new RoundedClipRectModifier(
            buffer.readFloat(), buffer.readFloat(), buffer.readFloat(), buffer.readFloat()));
    }
}

// ── MODIFIER_CLIP_RECT (108): no payload ──────────────────────────────
export class ClipRectModifier extends Operation {
    static readonly OP_CODE = 108;
    private mComponent: any = null;
    private mLayoutW = 0; private mLayoutH = 0;
    constructor() { super(); }
    setComponent(c: any): void { this.mComponent = c; }
    layoutDecorator(w: number, h: number): void { this.mLayoutW = w; this.mLayoutH = h; }
    write(_buffer: WireBuffer): void { /* stub */ }
    apply(context: RemoteContext): void {
        if (context.mMode !== ContextMode.PAINT) return;
        const pc = context.getPaintContext();
        if (!pc) return;
        const w = this.mLayoutW;
        const h = this.mLayoutH;
        if (w > 0 && h > 0) {
            pc.clipRect(0, 0, w, h);
        }
    }
    deepToString(indent: string): string { return `${indent}ClipRectModifier`; }
    static read(_buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new ClipRectModifier());
    }
}

/**
 * The press ripple Java's ClickModifierOperation, MultiClickModifier and RippleModifierOperation
 * paint (animateRipple + paint): from the touch point a circle grows to the component's larger
 * side in half a second (CUBIC_STANDARD) while its colour goes from (250,250,250,a180) to
 * (200,200,200,a0) over one second (Utils.interpolateColor), clipped to the component.
 * Times are the clock's milliseconds (context.getClock().millis()), as in Java.
 */
export class Ripple {
    private static readonly EASE = new CubicEasing(Easing.CUBIC_STANDARD);
    start = 0; x = 0; y = 0;
    animate(context: RemoteContext, x: number, y: number): void {
        this.start = context.getClock?.()?.millis?.() ?? Date.now();
        if (this.start === 0) this.start = 1;
        this.x = x; this.y = y;
        context.needsRepaint();
    }
    paint(pc: PaintContext, context: RemoteContext, w: number, h: number): void {
        if (this.start === 0 || w <= 0 || h <= 0) return;
        pc.needsRepaint();
        const now = context.getClock?.()?.millis?.() ?? Date.now();
        let progress = (now - this.start) / 1000;
        if (progress > 1) this.start = 0;
        progress = Math.min(1, Math.max(0, progress));
        const tween = Ripple.EASE.get(progress);
        const tweenRadius = Ripple.EASE.get(Math.min(1, progress / 0.5));
        const color = interpolateColor(((180 << 24) | (250 << 16) | (250 << 8) | 250) | 0,
                                       ((0 << 24) | (200 << 16) | (200 << 8) | 200) | 0, tween);
        pc.matrixSave();
        pc.savePaint();
        const pb = new PaintBundle();
        pb.mArray = [PaintBundle.STYLE, PaintBundle.COLOR, color];
        pb.mPos = 3;
        pc.replacePaint(pb);
        pc.clipRect(0, 0, w, h);
        pc.drawCircle(this.x, this.y, Math.max(w, h) * tweenRadius);
        pc.restorePaint();
        pc.matrixRestore();
    }
}

// ── MODIFIER_CLICK (59): no payload (container — children follow) ─────
export class ClickModifier extends Operation {
    static readonly OP_CODE = 59;
    mList: Operation[] = [];
    private mComponent: any = null;
    /** Java ClickModifierOperation: a click ripples when animations are enabled. */
    readonly ripple = new Ripple();
    constructor() { super(); }
    getList(): Operation[] { return this.mList; }
    setComponent(c: any): void { this.mComponent = c; }

    onClick(context: RemoteContext, _doc: any, x: number, y: number): boolean {
        // x, y: the component's own coordinates (LayoutComponent.onClick passes them so).
        if (context.isAnimationEnabled?.() ?? true) this.ripple.animate(context, x, y);
        // Execute action operations
        for (const op of this.mList) {
            context.incrementOpCount(op);
            op.apply(context);
        }
        context.needsRepaint();
        return true;
    }

    write(_buffer: WireBuffer): void { /* stub */ }
    apply(_context: RemoteContext): void { /* handled by layout */ }
    deepToString(indent: string): string { return `${indent}ClickModifier(${this.mList.length} actions)`; }
    static read(_buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new ClickModifier());
    }
}

// ── MODIFIER_MULTI_CLICK (83): INT clickType (container — children follow) ─
// Java source: operations/layout/MultiClickModifier.java
// clickType: 0 = single, 1 = long press, 2 = double click
export class MultiClickModifier extends Operation {
    static readonly OP_CODE = 83;
    static readonly CLICK_TYPE_SINGLE = 0;
    static readonly CLICK_TYPE_LONG = 1;
    static readonly CLICK_TYPE_DOUBLE = 2;

    mClickType: number = 0;
    mList: Operation[] = [];
    private mComponent: any = null;

    constructor(clickType: number = 0) {
        super();
        this.mClickType = clickType;
    }
    getList(): Operation[] { return this.mList; }
    getClickType(): number { return this.mClickType; }
    setComponent(c: any): void { this.mComponent = c; }

    /** Java MultiClickModifier: a single click ripples too, when animations are enabled. */
    readonly ripple = new Ripple();
    onClick(context: RemoteContext, _doc: any, x: number, y: number): boolean {
        if (this.mClickType !== MultiClickModifier.CLICK_TYPE_SINGLE) return false;
        if (context.isAnimationEnabled?.() ?? true) this.ripple.animate(context, x, y);
        for (const op of this.mList) { context.incrementOpCount(op); op.apply(context); }
        context.needsRepaint();
        return true;
    }

    onLongPress(context: RemoteContext, _doc: any, _x: number, _y: number): boolean {
        if (this.mClickType !== MultiClickModifier.CLICK_TYPE_LONG) return false;
        for (const op of this.mList) { context.incrementOpCount(op); op.apply(context); }
        context.needsRepaint();
        return true;
    }

    onDoubleClick(context: RemoteContext, _doc: any, _x: number, _y: number): boolean {
        if (this.mClickType !== MultiClickModifier.CLICK_TYPE_DOUBLE) return false;
        for (const op of this.mList) { context.incrementOpCount(op); op.apply(context); }
        context.needsRepaint();
        return true;
    }

    write(_buffer: WireBuffer): void { /* stub */ }
    apply(_context: RemoteContext): void { /* handled by layout */ }
    deepToString(indent: string): string {
        return `${indent}MultiClickModifier(type=${this.mClickType}, ${this.mList.length} actions)`;
    }
    static read(buffer: WireBuffer, operations: Operation[]): void {
        const clickType = buffer.readInt();
        operations.push(new MultiClickModifier(clickType));
    }
}

// ── MODIFIER_DIMENSION_CONSTRAINTS (243): BYTE type, FLOAT min, FLOAT max ───
// Java source: operations/layout/modifiers/DimensionConstraintsModifierOperation.java
// type: 0 = horizontal, 1 = vertical, 2 = required horizontal, 3 = required vertical.
// "Required" variants override parent constraints; soft variants are clamped.
export class DimensionConstraintsModifier extends Operation {
    static readonly OP_CODE = 243;
    static readonly HORIZONTAL = 0;
    static readonly VERTICAL = 1;
    static readonly REQUIRED_HORIZONTAL = 2;
    static readonly REQUIRED_VERTICAL = 3;

    mType: number;
    mMin: number;
    mMax: number;

    constructor(type: number, min: number, max: number) {
        super();
        this.mType = type;
        this.mMin = min;
        this.mMax = max;
    }

    getType(): number { return this.mType; }
    getMin(): number { return this.mMin; }
    getMax(): number { return this.mMax; }

    write(_buffer: WireBuffer): void { /* stub */ }
    apply(_context: RemoteContext): void { /* handled by layout */ }
    deepToString(indent: string): string {
        return `${indent}DimensionConstraintsModifier(type=${this.mType}, min=${this.mMin}, max=${this.mMax})`;
    }
    static read(buffer: WireBuffer, operations: Operation[]): void {
        const type = buffer.readByte();
        const min = intBitsToFloat(buffer.readNanIdBits());
        const max = intBitsToFloat(buffer.readNanIdBits());
        operations.push(new DimensionConstraintsModifier(type, min, max));
    }
}

// ── MODIFIER_TOUCH_DOWN (219): no payload (container) ─────────────────
export class TouchDownModifier extends Operation {
    static readonly OP_CODE = 219;
    mList: Operation[] = [];
    constructor() { super(); }
    getList(): Operation[] { return this.mList; }

    onTouchDown(context: RemoteContext): void {
        for (const op of this.mList) {
            context.incrementOpCount(op);
            op.apply(context);
        }
    }

    write(_buffer: WireBuffer): void { /* stub */ }
    apply(_context: RemoteContext): void { /* handled by layout */ }
    deepToString(indent: string): string { return `${indent}TouchDownModifier(${this.mList.length} actions)`; }
    static read(_buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new TouchDownModifier());
    }
}

// ── MODIFIER_TOUCH_UP (220): no payload (container) ───────────────────
export class TouchUpModifier extends Operation {
    static readonly OP_CODE = 220;
    mList: Operation[] = [];
    constructor() { super(); }
    getList(): Operation[] { return this.mList; }

    onTouchUp(context: RemoteContext): void {
        for (const op of this.mList) {
            context.incrementOpCount(op);
            op.apply(context);
        }
    }

    write(_buffer: WireBuffer): void { /* stub */ }
    apply(_context: RemoteContext): void { /* handled by layout */ }
    deepToString(indent: string): string { return `${indent}TouchUpModifier(${this.mList.length} actions)`; }
    static read(_buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new TouchUpModifier());
    }
}

// ── MODIFIER_TOUCH_CANCEL (225): no payload (container) ───────────────
export class TouchCancelModifier extends Operation {
    static readonly OP_CODE = 225;
    mList: Operation[] = [];
    constructor() { super(); }
    getList(): Operation[] { return this.mList; }

    onTouchCancel(context: RemoteContext): void {
        for (const op of this.mList) {
            context.incrementOpCount(op);
            op.apply(context);
        }
    }

    write(_buffer: WireBuffer): void { /* stub */ }
    apply(_context: RemoteContext): void { /* handled by layout */ }
    deepToString(indent: string): string { return `${indent}TouchCancelModifier(${this.mList.length} actions)`; }
    static read(_buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new TouchCancelModifier());
    }
}

// ── MODIFIER_VISIBILITY (211): INT visibilityId ──────────────────────
export class VisibilityModifier extends Operation {
    static readonly OP_CODE = 211;
    private mVisibilityId: number;
    private mVisibility = Visibility.VISIBLE;
    private mParent: any = null;
    constructor(visibilityId: number) { super(); this.mVisibilityId = visibilityId; }
    setParent(parent: any): void { this.mParent = parent; }
    registerListening(context: RemoteContext): void {
        context.listensTo(this.mVisibilityId, this);
    }
    updateVariables(context: RemoteContext): void {
        const v = context.getInteger(this.mVisibilityId);
        // Match Java ComponentVisibilityOperation.updateVariables:
        // interpret the protocol value using Visibility helpers
        if (Visibility.isVisible(v)) {
            this.mVisibility = Visibility.VISIBLE;
        } else if (Visibility.isGone(v)) {
            this.mVisibility = Visibility.GONE;
        } else if (Visibility.isInvisible(v)) {
            this.mVisibility = Visibility.INVISIBLE;
        } else {
            this.mVisibility = Visibility.GONE;
        }
        if (this.mParent && typeof this.mParent.setVisibility === 'function') {
            this.mParent.setVisibility(this.mVisibility);
        }
        this.markNotDirty();
    }
    write(_buffer: WireBuffer): void { /* stub */ }
    apply(context: RemoteContext): void {
        if (this.isDirty()) {
            this.updateVariables(context);
        }
    }
    /**
     * Re-resolve the visibility every layout pass, matching
     * ComponentVisibilityOperation.evaluateInLayout in the reference.
     *
     * `apply` only runs when the op is dirty, which never happens for a visibility id
     * that nothing writes — so the component stayed VISIBLE while the reference
     * resolved the same id to GONE. A document using visibility to switch between
     * mutually exclusive branches therefore drew *both* of them.
     */
    evaluateInLayout(context: RemoteContext): boolean {
        const before = this.mVisibility;
        this.updateVariables(context);
        return before !== this.mVisibility;
    }
    deepToString(indent: string): string { return `${indent}VisibilityModifier(${this.mVisibilityId})`; }
    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new VisibilityModifier(buffer.readId()));
    }
}

// ── MODIFIER_OFFSET (221): FLOAT x, FLOAT y ──────────────────────────
export class OffsetModifier extends Operation implements VariableSupport {
    static readonly OP_CODE = 221;
    // x/y as raw float32 int bits (may be NaN-encoded variable refs).
    private mOffX: number; private mOffY: number;
    private mOutX: number; private mOutY: number;
    constructor(x: number, y: number) {
        super();
        this.mOffX = x; this.mOffY = y;
        this.mOutX = isNaNBits(x) ? 0 : intBitsToFloat(x);
        this.mOutY = isNaNBits(y) ? 0 : intBitsToFloat(y);
    }
    registerListening(context: RemoteContext): void {
        if (isNaNBits(this.mOffX)) context.listensTo(idFromBits(this.mOffX), this);
        if (isNaNBits(this.mOffY)) context.listensTo(idFromBits(this.mOffY), this);
    }
    updateVariables(context: RemoteContext): void {
        if (isNaNBits(this.mOffX)) this.mOutX = context.getFloat(idFromBits(this.mOffX));
        if (isNaNBits(this.mOffY)) this.mOutY = context.getFloat(idFromBits(this.mOffY));
    }
    write(_buffer: WireBuffer): void { /* stub */ }
    apply(context: RemoteContext): void {
        if (context.mMode !== ContextMode.PAINT) return;
        const pc = context.getPaintContext();
        if (!pc) return;
        pc.translate(this.mOutX, this.mOutY);
    }
    deepToString(indent: string): string { return `${indent}OffsetModifier(${this.mOutX}, ${this.mOutY})`; }
    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new OffsetModifier(buffer.readNanIdBits(), buffer.readNanIdBits()));
    }
}

// ── MODIFIER_ZINDEX (223): FLOAT value ────────────────────────────────
export class ZIndexModifier extends Operation {
    static readonly OP_CODE = 223;
    private mValueBits: number;
    private mCurrentValue: number;
    constructor(valueBits: number) {
        super(); this.mValueBits = valueBits;
        this.mCurrentValue = isNaNBits(valueBits) ? 0 : intBitsToFloat(valueBits);
    }
    getValue(): number { return this.mCurrentValue; }
    write(_buffer: WireBuffer): void { /* stub */ }
    apply(context: RemoteContext): void {
        if (context.mMode === ContextMode.PAINT && isVariableBits(this.mValueBits)) {
            this.mCurrentValue = context.getFloat(idFromBits(this.mValueBits));
        }
    }
    deepToString(indent: string): string { return `${indent}ZIndexModifier(${this.mCurrentValue})`; }
    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new ZIndexModifier(buffer.readNanIdBits()));
    }
}

/**
 * A graphicsLayer value that follows a variable, as Java's AnimatableValue: the first value
 * is taken as is, and a later change animates over 300 ms (CUBIC_STANDARD) unless it came
 * within 300 ms of the previous one, in which case it snaps.
 */
class GraphicsLayerAnimatableValue {
    private mIsVariable = false;
    private mId = 0;
    private mValue = 0;
    private mAnimateValueChanges = true;
    private mAnimate = false;
    private mAnimateTargetTime = 0;
    private readonly mAnimateDuration = 300;
    private mTarget = 0;
    private mStart = 0;
    private mLastUpdate = 0;
    private mEasing: CubicEasing | null = null;

    constructor(bits: number) {
        if (isVariableBits(bits)) {
            this.mId = idFromBits(bits);
            this.mIsVariable = true;
        } else {
            this.mValue = intBitsToFloat(bits);
        }
    }

    getValue(): number { return this.mValue; }

    evaluate(context: PaintContext): number {
        if (!this.mIsVariable) return this.mValue;
        const value = context.getContext().getFloat(this.mId);
        const timeMillis = context.getClock().millis();
        if (value !== this.mValue) {
            const interval = timeMillis - this.mLastUpdate;
            this.mAnimateValueChanges = interval > this.mAnimateDuration && this.mLastUpdate !== 0;
            this.mLastUpdate = timeMillis;
        }
        if (!this.mAnimateValueChanges) {
            this.mValue = value;
        } else {
            if (value !== this.mValue && !this.mAnimate) {
                this.mStart = this.mValue;
                this.mTarget = value;
                this.mAnimate = true;
                this.mAnimateTargetTime = timeMillis;
                this.mEasing = new CubicEasing(Easing.CUBIC_STANDARD);
            }
            if (this.mAnimate) {
                const elapsed = timeMillis - this.mAnimateTargetTime;
                // Java: FloatAnimation(CUBIC_STANDARD, 0.3 s).get(elapsed / 300), which is
                // the easing at (elapsed / 300) / 0.3.
                const t = Math.min(1, Math.max(0, elapsed / this.mAnimateDuration / 0.3));
                const p = t >= 1 ? 1 : this.mEasing!.get(t);
                this.mValue = (1 - p) * this.mStart + p * this.mTarget;
                if (p >= 1) this.mAnimate = false;
            } else {
                this.mValue = this.mTarget;
            }
        }
        return this.mValue;
    }
}

/** One attribute of a graphics layer. `bits` keeps the authored float bits (a NaN-encoded
 *  variable reference stays visible to the inspector); `value` is the current value. */
export interface GraphicsLayerAttribute {
    id: number;
    name: string;
    isFloat: boolean;
    bits: number | null;
    value: number;
}

// ── MODIFIER_GRAPHICS_LAYER (224): INT count, then (INT tag, FLOAT|INT value)* ────────
// Port of Java GraphicsLayerModifierOperation. The tag is `index | (dataType << 10)`.
export class GraphicsLayerModifier extends Operation {
    static readonly OP_CODE = 224;
    static readonly SCALE_X = 0;
    static readonly SCALE_Y = 1;
    static readonly ROTATION_X = 2;
    static readonly ROTATION_Y = 3;
    static readonly ROTATION_Z = 4;
    static readonly TRANSFORM_ORIGIN_X = 5;
    static readonly TRANSFORM_ORIGIN_Y = 6;
    static readonly TRANSLATION_X = 7;
    static readonly TRANSLATION_Y = 8;
    static readonly TRANSLATION_Z = 9;
    static readonly SHADOW_ELEVATION = 10;
    static readonly ALPHA = 11;
    static readonly CAMERA_DISTANCE = 12;
    static readonly COMPOSITING_STRATEGY = 13;
    static readonly SPOT_SHADOW_COLOR = 14;
    static readonly AMBIENT_SHADOW_COLOR = 15;
    static readonly HAS_BLUR = 16;
    static readonly BLUR_RADIUS_X = 17;
    static readonly BLUR_RADIUS_Y = 18;
    static readonly BLUR_TILE_MODE = 19;
    static readonly SHAPE = 20;
    static readonly SHAPE_RADIUS = 21;

    private static readonly DATA_TYPE_INT = 0;
    private static readonly DATA_TYPE_FLOAT = 1;

    // [name, isFloat, default] in Java's mValues order.
    private static readonly DEFS: [string, boolean, number][] = [
        ['SCALE_X', true, 1], ['SCALE_Y', true, 1], ['ROTATION_X', true, 0],
        ['ROTATION_Y', true, 0], ['ROTATION_Z', true, 0], ['TRANSFORM_ORIGIN_X', true, 0],
        ['TRANSFORM_ORIGIN_Y', true, 0], ['TRANSLATION_X', true, 0], ['TRANSLATION_Y', true, 0],
        ['TRANSLATION_Z', true, 0], ['SHADOW_ELEVATION', true, 0], ['ALPHA', true, 1],
        ['CAMERA_DISTANCE', true, 8], ['COMPOSITING_STRATEGY', false, 0],
        ['SPOT_SHADOW_COLOR', false, 0], ['AMBIENT_SHADOW_COLOR', false, 0],
        ['HAS_BLUR', false, 0], ['BLUR_RADIUS_X', true, 0], ['BLUR_RADIUS_Y', true, 0],
        ['BLUR_TILE_MODE', false, 0], ['SHAPE', false, -1], ['SHAPE_RADIUS', true, 0],
    ];

    /** Every attribute the document set, by Java index. */
    mAttributes: Map<number, GraphicsLayerAttribute> = new Map();
    private mAnimatable: Map<number, GraphicsLayerAnimatableValue> = new Map();
    mHasBlurEffect = false;

    private setFloat(index: number, bits: number): void {
        const [name] = GraphicsLayerModifier.DEFS[index];
        const anim = new GraphicsLayerAnimatableValue(bits);
        this.mAnimatable.set(index, anim);
        this.mAttributes.set(index, { id: index, name, isFloat: true, bits, value: anim.getValue() });
    }

    private setInt(index: number, value: number): void {
        const [name] = GraphicsLayerModifier.DEFS[index];
        this.mAttributes.set(index, { id: index, name, isFloat: false, bits: null, value });
    }

    // Not `valueOf`: that name overrides Object.prototype.valueOf, so any numeric coercion of the
    // modifier (e.g. the inspector scanning op fields with `>>> 0`) would call it with no index.
    private attributeValue(index: number): number {
        const a = this.mAttributes.get(index);
        return a ? a.value : GraphicsLayerModifier.DEFS[index][2];
    }

    getAlpha(): number { return this.attributeValue(GraphicsLayerModifier.ALPHA); }
    getScaleX(): number { return this.attributeValue(GraphicsLayerModifier.SCALE_X); }
    getScaleY(): number { return this.attributeValue(GraphicsLayerModifier.SCALE_Y); }
    getRotationZ(): number { return this.attributeValue(GraphicsLayerModifier.ROTATION_Z); }
    getTranslationX(): number { return this.attributeValue(GraphicsLayerModifier.TRANSLATION_X); }
    getTranslationY(): number { return this.attributeValue(GraphicsLayerModifier.TRANSLATION_Y); }

    /**
     * Java fillInAttributes: the attributes whose current value differs from the default
     * (needsToWrite), as the map PaintContext.setGraphicsLayer takes.
     */
    fillInAttributes(out: Map<number, any>): void {
        for (const [index, a] of this.mAttributes) {
            const def = GraphicsLayerModifier.DEFS[index][2];
            if (a.value !== def) out.set(index, a.value);
        }
    }

    /** Java paint(): evaluate each animatable value (variables resolve here). */
    evaluate(context: PaintContext): void {
        for (const [index, anim] of this.mAnimatable) {
            const a = this.mAttributes.get(index)!;
            a.value = anim.evaluate(context);
        }
    }

    write(_buffer: WireBuffer): void { /* stub */ }
    apply(_context: RemoteContext): void { /* painted by LayoutComponent */ }

    deepToString(indent: string): string {
        return `${indent}GraphicsLayerModifier(${this.getScaleX()}, ${this.getScaleY()})`;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const length = buffer.readInt();
        const op = new GraphicsLayerModifier();
        if (length < 0 || length > GraphicsLayerModifier.DEFS.length) {
            throw new Error(`attempt to allocate an invalid number of attributes: ${length}`);
        }
        const remap = (buffer as any).getRemapContext?.();
        for (let i = 0; i < length; i++) {
            const tag = buffer.readInt();
            const dataType = tag >> 10;
            const index = tag & 0x3F;
            if (index < 0 || index >= GraphicsLayerModifier.DEFS.length) {
                throw new Error(`attempt to read an invalid attribute index: ${index}`);
            }
            if (index === GraphicsLayerModifier.BLUR_RADIUS_X
                || index === GraphicsLayerModifier.BLUR_RADIUS_Y) {
                op.mHasBlurEffect = true;
                op.setInt(GraphicsLayerModifier.HAS_BLUR, 1);
            }
            if (dataType === GraphicsLayerModifier.DATA_TYPE_FLOAT) {
                // readNanId: a variable reference keeps its NaN payload (and is remapped
                // inside a Loom pattern by the buffer).
                op.setFloat(index, buffer.readNanIdBits());
            } else if (dataType === GraphicsLayerModifier.DATA_TYPE_INT) {
                let value = buffer.readInt();
                if ((index === GraphicsLayerModifier.SPOT_SHADOW_COLOR
                     || index === GraphicsLayerModifier.AMBIENT_SHADOW_COLOR) && remap) {
                    value = remap.resolveId(value);
                }
                op.setInt(index, value);
            }
        }
        operations.push(op);
    }
}

// ── MODIFIER_SCROLL (226): INT direction, FLOAT position, FLOAT max, FLOAT notchMax
export class ScrollModifier extends Operation {
    static readonly OP_CODE = 226;
    static readonly VERTICAL = 0;
    static readonly HORIZONTAL = 1;
    /** LayoutManager.FIX_TOUCH_EVENT — touch coordinates are component-local from here on. */
    static readonly FIX_TOUCH_EVENT = 1;
    mList: Operation[] = [];
    private mDirection: number;
    // position/max/notchMax as raw float32 int bits (NaN-encoded variable refs;
    // getMaxNan/getNotchMaxNan return the bits which LayoutManager decodes).
    private mPositionId: number;
    private mMax: number;
    private mNotchMax: number;
    constructor(direction: number, positionId: number, max: number, notchMax: number) {
        super();
        this.mDirection = direction;
        this.mPositionId = positionId;
        this.mMax = max;
        this.mNotchMax = notchMax;
    }

    // ── Scroll state ────────────────────────────────────────────────────────────────
    // Two ways a scroll position is driven, and a document picks one by whether its
    // position field is a NaN-encoded variable reference:
    //
    //   expression-driven — the TouchExpression below computes the position and writes it
    //       to that variable. The modifier only feeds it touch events. (stock.rc)
    //   direct — no variable, so the modifier tracks the offset itself, clamped to
    //       [-maxScroll, 0]. (dsl_ticker.rc, 02_ticker.rc)
    //
    // Both need touch events, which is what was missing: the TouchExpression lives in this
    // modifier's own list rather than the component's children, so the component's touch
    // walk never reached it and nothing ever moved.
    private mTouchExpression: TouchExpression | null = null;
    private mTouchDown = false;
    private mTouchDownX = 0;
    private mTouchDownY = 0;
    private mInitialScrollX = 0;
    private mInitialScrollY = 0;
    private mScrollX = 0;
    private mScrollY = 0;
    private mMaxScrollX = 0;
    private mMaxScrollY = 0;
    private mContentDimension = 0;

    getList(): Operation[] { return this.mList; }
    getDirection(): number { return this.mDirection; }
    getMaxNan(): number { return this.mMax; }
    getNotchMaxNan(): number { return this.mNotchMax; }
    getScrollX(): number { return this.mScrollX; }
    getScrollY(): number { return this.mScrollY; }
    isVertical(): boolean { return this.mDirection === ScrollModifier.VERTICAL; }

    /** True when the position is a variable the contained TouchExpression writes. */
    private isExpressionDriven(): boolean { return isNaNBits(this.mPositionId); }

    /** Bind the contained TouchExpression to the component, as Java's inflate() does. */
    inflate(component: any): void {
        for (const op of this.mList) {
            if (op instanceof TouchExpression) {
                this.mTouchExpression = op;
                op.setComponent(component);
            }
        }
    }

    updateVariables(context: RemoteContext): void {
        this.mTouchExpression?.updateVariables(context);
    }

    /** Called by the layout pass once the host and content sizes are known. */
    setVerticalScrollDimension(hostDimension: number, contentDimension: number): void {
        this.mContentDimension = contentDimension;
        this.mMaxScrollY = Math.max(0, contentDimension - hostDimension);
    }

    setHorizontalScrollDimension(hostDimension: number, contentDimension: number): void {
        this.mContentDimension = contentDimension;
        this.mMaxScrollX = Math.max(0, contentDimension - hostDimension);
    }

    onTouchDown(context: RemoteContext, x: number, y: number): boolean {
        this.mTouchDown = true;
        this.mTouchDownX = x;
        this.mTouchDownY = y;
        this.mInitialScrollX = this.mScrollX;
        this.mInitialScrollY = this.mScrollY;
        if (this.mTouchExpression) {
            this.mTouchExpression.updateVariables(context);
            if (context.getTouchVersion() === ScrollModifier.FIX_TOUCH_EVENT) {
                this.mTouchExpression.touchDown(context, x, y);
            } else {
                this.mTouchExpression.touchDown(context, x + this.mScrollX, y + this.mScrollY);
            }
        }
        return true;
    }

    onTouchDrag(context: RemoteContext, x: number, y: number): boolean {
        this.mTouchDown = true;
        if (this.mTouchExpression) {
            this.mTouchExpression.updateVariables(context);
            if (context.getTouchVersion() === ScrollModifier.FIX_TOUCH_EVENT) {
                this.mTouchExpression.touchDrag(context, x, y);
            } else {
                this.mTouchExpression.touchDrag(context, x + this.mScrollX, y + this.mScrollY);
            }
        }
        // Integrate the drag ourselves only when the position is a plain value. When it is
        // a variable, apply() below recomputes the offset from it every frame and would
        // overwrite anything set here.
        if (!this.isExpressionDriven()) {
            if (this.isVertical()) {
                const dy = y - this.mTouchDownY;
                this.mScrollY = Math.max(-this.mMaxScrollY,
                    Math.min(0, this.mInitialScrollY + dy));
            } else {
                const dx = x - this.mTouchDownX;
                this.mScrollX = Math.max(-this.mMaxScrollX,
                    Math.min(0, this.mInitialScrollX + dx));
            }
        }
        return true;
    }

    onTouchUp(context: RemoteContext, x: number, y: number, dx: number, dy: number): boolean {
        const handled = this.mTouchDown;
        this.mTouchDown = false;
        if (this.mTouchExpression) {
            this.mTouchExpression.updateVariables(context);
            if (context.getTouchVersion() === ScrollModifier.FIX_TOUCH_EVENT) {
                this.mTouchExpression.touchUp(context, x, y, dx, dy);
            } else {
                this.mTouchExpression.touchUp(context, x + this.mScrollX, y + this.mScrollY, dx, dy);
            }
        }
        return handled;
    }

    onTouchCancel(context: RemoteContext, x: number, y: number): boolean {
        const handled = this.mTouchDown;
        this.mTouchDown = false;
        this.mTouchExpression?.touchUp(context, x, y, 0, 0);
        return handled;
    }

    write(_buffer: WireBuffer): void { /* stub */ }
    apply(context: RemoteContext): void {
        if (context.mMode !== ContextMode.PAINT) return;
        // Run the contained operations first. This is what gets the TouchExpression applied
        // — and its apply() is what refreshes the bounds it rejects out-of-range touches
        // against. Without it those bounds stay at 0x0 and every touchDown is discarded,
        // which presents as scrolling being unimplemented rather than as an error.
        for (const op of this.mList) {
            op.apply(context);
            context.incrementOpCount(op);
        }
        const pc = context.getPaintContext();
        if (!pc) return;
        // With an expression, the position variable is authoritative and is recomputed here
        // every frame. Without one, mScroll* is whatever the drag integrated.
        if (this.mTouchExpression) {
            const position = context.getFloat(idFromBits(this.mPositionId));
            if (this.isVertical()) {
                this.mScrollY = -Math.min(this.mMaxScrollY, position);
            } else {
                this.mScrollX = -Math.min(this.mMaxScrollX, position);
            }
        }
        pc.translate(this.mScrollX, this.mScrollY);
    }
    deepToString(indent: string): string { return `${indent}ScrollModifier(dir=${this.mDirection})`; }
    static read(buffer: WireBuffer, operations: Operation[]): void {
        const direction = buffer.readInt();
        const position = buffer.readNanIdBits();
        const max = buffer.readNanIdBits();
        const notchMax = buffer.readNanIdBits();
        operations.push(new ScrollModifier(direction, position, max, notchMax));
    }
}

// ── MODIFIER_MARQUEE (228): INT iterations, INT animationMode,
//    FLOAT repeatDelay, FLOAT initialDelay, FLOAT spacing, FLOAT velocity
export class MarqueeModifier extends Operation {
    static readonly OP_CODE = 228;
    private mIterations: number;
    private mAnimationMode: number;
    private mRepeatDelayMillis: number;
    private mInitialDelayMillis: number;
    private mSpacing: number;
    private mVelocity: number;
    private mComponent: any = null;
    private mScrollX = 0;
    private mStartTime = 0;
    private mLastTime = 0;
    private mComponentWidth = 0;
    private mContentWidth = 0;

    constructor(iterations: number, animationMode: number,
                repeatDelay: number, initialDelay: number,
                spacing: number, velocity: number) {
        super();
        this.mIterations = iterations;
        this.mAnimationMode = animationMode;
        this.mRepeatDelayMillis = repeatDelay;
        this.mInitialDelayMillis = initialDelay;
        this.mSpacing = spacing;
        this.mVelocity = velocity;
    }
    setComponent(c: any): void { this.mComponent = c; }
    write(_buffer: WireBuffer): void { /* stub */ }
    apply(context: RemoteContext): void {
        if (context.mMode !== ContextMode.PAINT) return;
        const pc = context.getPaintContext();
        if (!pc || !this.mComponent) return;

        // Capture component and content dimensions on first call
        this.mComponentWidth = this.mComponent.getWidth?.() ?? 0;
        this.mContentWidth = this.mComponent.getContentWidth?.() ?? this.mComponentWidth;

        const delta = this.mContentWidth - this.mComponentWidth;
        if (delta <= 0) return; // No overflow, no scrolling needed

        const now = context.getAnimationTime();
        if (this.mStartTime === 0) {
            this.mStartTime = now;
        }

        const elapsed = now - this.mStartTime - this.mInitialDelayMillis / 1000;
        if (elapsed < 0) {
            context.needsRepaint();
            return;
        }

        // Compute animation duration from velocity (pixels per second)
        const duration = delta / (this.mVelocity > 0 ? this.mVelocity : 30);
        const totalCycle = duration + this.mRepeatDelayMillis / 1000;
        const cyclePos = elapsed % totalCycle;

        if (cyclePos < duration) {
            // Sine wave animation: offset = (1 + sin(t * 2π - π/2)) / 2 * -delta
            const t = cyclePos / duration;
            const offset = (1 + Math.sin(t * 2 * Math.PI - Math.PI / 2)) / 2 * -delta;
            this.mScrollX = offset;
        } else {
            this.mScrollX = 0; // In repeat delay period
        }

        pc.translate(this.mScrollX, 0);
        context.needsRepaint();
    }
    deepToString(indent: string): string { return `${indent}MarqueeModifier`; }
    static read(buffer: WireBuffer, operations: Operation[]): void {
        const iterations = buffer.readInt();
        const animationMode = buffer.readInt();
        const repeatDelay = buffer.readFloat();
        const initialDelay = buffer.readFloat();
        const spacing = buffer.readFloat();
        const velocity = buffer.readFloat();
        operations.push(new MarqueeModifier(iterations, animationMode, repeatDelay, initialDelay, spacing, velocity));
    }
}

// ── MODIFIER_RIPPLE (229): no payload ─────────────────────────────────
export class RippleModifier extends Operation {
    static readonly OP_CODE = 229;
    /** RippleModifierOperation.onTouchDown starts it (unconditionally), paint draws it. */
    readonly ripple = new Ripple();
    constructor() { super(); }
    write(_buffer: WireBuffer): void { /* stub */ }
    apply(_context: RemoteContext): void { /* handled by layout */ }
    deepToString(indent: string): string { return `${indent}RippleModifier`; }
    static read(_buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new RippleModifier());
    }
}

// ── MODIFIER_DRAW_CONTENT (174): no payload ───────────────────────────
export class DrawContentModifier extends Operation {
    static readonly OP_CODE = 174;
    constructor() { super(); }
    write(_buffer: WireBuffer): void { /* stub */ }
    apply(_context: RemoteContext): void { /* handled by layout */ }
    deepToString(indent: string): string { return `${indent}DrawContentModifier`; }
    static read(_buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new DrawContentModifier());
    }
}

// ── MODIFIER_ALIGN_BY (237): FLOAT line, INT flags ────────────────────
export class AlignByModifier extends Operation {
    static readonly OP_CODE = 237;
    private mLine: number; private mFlags: number;
    constructor(line: number, flags: number) { super(); this.mLine = line; this.mFlags = flags; }
    write(_buffer: WireBuffer): void { /* stub */ }
    apply(_context: RemoteContext): void { /* handled by layout */ }
    deepToString(indent: string): string { return `${indent}AlignByModifier`; }
    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new AlignByModifier(intBitsToFloat(buffer.readNanIdBits()), buffer.readInt()));
    }
}

// ── ACCESSIBILITY_SEMANTICS (250) ─────────────────────────────────────
// Java source: core/semantics/CoreSemantics.java
//   INT contentDescriptionId, BYTE role, INT textId, INT stateDescriptionId,
//   BYTE mode, BOOLEAN enabled, BOOLEAN clickable
//
// Purely accessibility metadata: it describes the component to a screen reader and
// contributes nothing to the painted frame, so `apply` and painting are no-ops. It
// still has to be *read*, because the buffer has no length prefixes — an unknown
// opcode costs the remainder of the document, not just this operation.
export class AccessibilitySemantics extends Operation {
    static readonly OP_CODE = 250;

    mContentDescriptionId: number;
    mRole: number;
    mTextId: number;
    mStateDescriptionId: number;
    mMode: number;
    mEnabled: boolean;
    mClickable: boolean;

    constructor(contentDescriptionId: number, role: number, textId: number,
                stateDescriptionId: number, mode: number,
                enabled: boolean, clickable: boolean) {
        super();
        this.mContentDescriptionId = contentDescriptionId;
        this.mRole = role;
        this.mTextId = textId;
        this.mStateDescriptionId = stateDescriptionId;
        this.mMode = mode;
        this.mEnabled = enabled;
        this.mClickable = clickable;
    }

    getContentDescriptionId(): number { return this.mContentDescriptionId; }

    write(_buffer: WireBuffer): void { /* stub */ }
    apply(_context: RemoteContext): void { /* accessibility only — nothing to paint */ }
    deepToString(indent: string): string {
        return `${indent}AccessibilitySemantics(contentDescriptionId=`
            + `${this.mContentDescriptionId}, role=${this.mRole}, enabled=${this.mEnabled}`
            + `, clickable=${this.mClickable})`;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        // declareId() where the Java side declares, so macro expansion can uniqueify.
        const contentDescriptionId = (buffer as any).declareId
            ? (buffer as any).declareId() : buffer.readInt();
        const role = buffer.readByte();
        const textId = (buffer as any).declareId
            ? (buffer as any).declareId() : buffer.readInt();
        const stateDescriptionId = (buffer as any).declareId
            ? (buffer as any).declareId() : buffer.readInt();
        const mode = buffer.readByte();
        const enabled = buffer.readBoolean();
        const clickable = buffer.readBoolean();
        operations.push(new AccessibilitySemantics(
            contentDescriptionId, role, textId, stateDescriptionId,
            mode, enabled, clickable));
    }
}
