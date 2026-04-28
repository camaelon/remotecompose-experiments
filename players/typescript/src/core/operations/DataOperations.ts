// DataOperations: data-loading operations (text, bitmap, path, paint, constants, etc.)

import { Operation } from '../Operation';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import { ContextMode } from '../RemoteContext';
import type { VariableSupport } from '../VariableSupport';
import { PaintBundle } from './paint/PaintBundle';
import { idFromNan, isVariable } from './Utils';

export class TextData extends Operation {
    static readonly OP_CODE = 102;
    mTextId: number;
    mText: string;

    constructor(textId: number, text: string) {
        super(); this.mTextId = textId; this.mText = text;
    }

    update(other: TextData): void { this.mText = other.mText; }

    write(_buffer: WireBuffer): void { /* stub */ }

    apply(context: RemoteContext): void {
        context.loadText(this.mTextId, this.mText);
    }

    deepToString(indent: string): string { return `${indent}TextData(${this.mTextId}, "${this.mText}")`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const id = buffer.readInt();
        const text = buffer.readUTF8();
        operations.push(new TextData(id, text));
    }
}

export class BitmapData extends Operation {
    static readonly OP_CODE = 101;
    mImageId: number;
    private mEncoding: number;
    private mType: number;
    private mWidth: number;
    private mHeight: number;
    private mBitmap: Uint8Array;

    constructor(imageId: number, encoding: number, type: number, width: number, height: number, bitmap: Uint8Array) {
        super();
        this.mImageId = imageId; this.mEncoding = encoding; this.mType = type;
        this.mWidth = width; this.mHeight = height; this.mBitmap = bitmap;
    }

    getWidth(): number { return this.mWidth; }
    getHeight(): number { return this.mHeight; }

    update(other: BitmapData): void {
        this.mEncoding = other.mEncoding; this.mType = other.mType;
        this.mWidth = other.mWidth; this.mHeight = other.mHeight;
        this.mBitmap = other.mBitmap;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    apply(context: RemoteContext): void {
        context.putObject(this.mImageId, this);
        context.loadBitmap(this.mImageId, this.mEncoding, this.mType, this.mWidth, this.mHeight, this.mBitmap);
    }

    deepToString(indent: string): string { return `${indent}BitmapData(${this.mImageId}, ${this.mWidth}x${this.mHeight})`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const id = buffer.readInt();
        let rawWidth = buffer.readInt();
        let rawHeight = buffer.readInt();
        let type = 0; // TYPE_PNG_8888
        let encoding = 0; // ENCODING_INLINE
        if (rawWidth > 0xFFFF) {
            type = rawWidth >> 16;
            rawWidth = rawWidth & 0xFFFF;
        }
        if (rawHeight > 0xFFFF) {
            encoding = rawHeight >> 16;
            rawHeight = rawHeight & 0xFFFF;
        }
        const bitmap = buffer.readBuffer();
        operations.push(new BitmapData(id, encoding, type, rawWidth, rawHeight, bitmap));
    }
}

export class PaintData extends Operation {
    static readonly OP_CODE = 40;
    mPaintBundle: PaintBundle;

    constructor(paintBundle: PaintBundle) {
        super(); this.mPaintBundle = paintBundle;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        this.mPaintBundle.registerListening(context, this);
    }

    updateVariables(context: RemoteContext): void {
        this.mPaintBundle.updateVariables(context);
    }

    apply(context: RemoteContext): void {
        if (context.mMode === ContextMode.DATA) return;
        context.getPaintContext()?.applyPaint(this.mPaintBundle);
    }

    deepToString(indent: string): string { return `${indent}PaintData`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const bundle = new PaintBundle();
        bundle.read(buffer);
        operations.push(new PaintData(bundle));
    }
}

export class PathData extends Operation implements VariableSupport {
    static readonly OP_CODE = 123;
    private mPathId: number;
    private mWinding: number;
    private mPathData: Float32Array;
    private mOutputPath: Float32Array;
    private mPathChanged = false;

    constructor(pathId: number, winding: number, pathData: Float32Array) {
        super(); this.mPathId = pathId; this.mWinding = winding;
        this.mPathData = pathData;
        this.mOutputPath = new Float32Array(pathData);
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        for (const v of this.mPathData) {
            if (Number.isNaN(v)) {
                context.listensTo(idFromNan(v), this);
            }
        }
    }

    updateVariables(context: RemoteContext): void {
        for (let i = 0; i < this.mPathData.length; i++) {
            const v = this.mPathData[i];
            if (isVariable(v)) {
                const prev = this.mOutputPath[i];
                this.mOutputPath[i] = Number.isNaN(v) ? context.getFloat(idFromNan(v)) : v;
                if (prev !== this.mOutputPath[i]) this.mPathChanged = true;
            } else {
                this.mOutputPath[i] = v;
            }
        }
    }

    apply(context: RemoteContext): void {
        context.loadPathData(this.mPathId, this.mWinding, this.mOutputPath);
    }

    deepToString(indent: string): string { return `${indent}PathData(${this.mPathId})`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const rawId = buffer.readInt();
        const winding = rawId >> 24;
        const id = rawId & 0xFFFFFF;
        const count = buffer.readInt();
        if (count < 0 || count > 20000) {
            throw new Error(`PathData: invalid path length ${count}`);
        }
        const data = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            data[i] = buffer.readFloat();
        }
        operations.push(new PathData(id, winding, data));
    }
}

export class FloatConstant extends Operation {
    static readonly OP_CODE = 80;
    // RAND operator ID: OFFSET(0x310000) + 39 = 0x310027
    private static readonly RAND_ID = 0x310027;
    mId: number;
    mValue: number;

    constructor(id: number, value: number) {
        super(); this.mId = id;
        // If the value encodes RAND, generate a random number
        this.mValue = (Number.isNaN(value) && idFromNan(value) === FloatConstant.RAND_ID)
            ? Math.random() : value;
    }

    update(other: FloatConstant): void { this.mValue = other.mValue; }

    write(_buffer: WireBuffer): void { /* stub */ }

    apply(context: RemoteContext): void {
        context.loadFloat(this.mId, this.mValue);
    }

    deepToString(indent: string): string { return `${indent}FloatConstant(${this.mId}, ${this.mValue})`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const id = buffer.readInt();
        const value = buffer.readFloat();
        operations.push(new FloatConstant(id, value));
    }
}

export class ColorConstant extends Operation {
    static readonly OP_CODE = 138;
    private mId: number;
    private mColor: number;

    constructor(id: number, color: number) {
        super(); this.mId = id; this.mColor = color;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    apply(context: RemoteContext): void {
        context.loadColor(this.mId, this.mColor);
    }

    deepToString(indent: string): string { return `${indent}ColorConstant(${this.mId})`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new ColorConstant(buffer.readInt(), buffer.readInt()));
    }
}

export class Theme extends Operation {
    static readonly OP_CODE = 63;
    static readonly UNSPECIFIED = -1;
    static readonly DARK = -2;
    static readonly LIGHT = -3;
    static readonly SYSTEM = 0;

    private mTheme: number;

    constructor(theme: number) { super(); this.mTheme = theme; }

    write(_buffer: WireBuffer): void { /* stub */ }

    apply(context: RemoteContext): void {
        context.setTheme(this.mTheme);
    }

    deepToString(indent: string): string { return `${indent}Theme(${this.mTheme})`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new Theme(buffer.readInt()));
    }
}

export class ClickArea extends Operation implements VariableSupport {
    static readonly OP_CODE = 64;
    private mId: number; private mContentDescriptionId: number;
    private mLeft: number; private mTop: number; private mRight: number; private mBottom: number;
    private mOutLeft: number; private mOutTop: number; private mOutRight: number; private mOutBottom: number;
    private mMetadataId: number;

    constructor(id: number, cdId: number, left: number, top: number, right: number, bottom: number, metaId: number) {
        super();
        this.mId = id; this.mContentDescriptionId = cdId;
        this.mLeft = left; this.mTop = top; this.mRight = right; this.mBottom = bottom;
        this.mOutLeft = left; this.mOutTop = top; this.mOutRight = right; this.mOutBottom = bottom;
        this.mMetadataId = metaId;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        if (Number.isNaN(this.mLeft)) context.listensTo(idFromNan(this.mLeft), this);
        if (Number.isNaN(this.mTop)) context.listensTo(idFromNan(this.mTop), this);
        if (Number.isNaN(this.mRight)) context.listensTo(idFromNan(this.mRight), this);
        if (Number.isNaN(this.mBottom)) context.listensTo(idFromNan(this.mBottom), this);
    }

    updateVariables(context: RemoteContext): void {
        this.mOutLeft = Number.isNaN(this.mLeft) ? context.getFloat(idFromNan(this.mLeft)) : this.mLeft;
        this.mOutTop = Number.isNaN(this.mTop) ? context.getFloat(idFromNan(this.mTop)) : this.mTop;
        this.mOutRight = Number.isNaN(this.mRight) ? context.getFloat(idFromNan(this.mRight)) : this.mRight;
        this.mOutBottom = Number.isNaN(this.mBottom) ? context.getFloat(idFromNan(this.mBottom)) : this.mBottom;
    }

    apply(context: RemoteContext): void {
        if (context.mMode === ContextMode.DATA) return;
        context.addClickArea(this.mId, this.mContentDescriptionId,
            this.mOutLeft, this.mOutTop, this.mOutRight, this.mOutBottom, this.mMetadataId);
    }

    deepToString(indent: string): string { return `${indent}ClickArea(${this.mId})`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new ClickArea(
            buffer.readInt(), buffer.readInt(),
            buffer.readFloat(), buffer.readFloat(), buffer.readFloat(), buffer.readFloat(),
            buffer.readInt()
        ));
    }
}

export class NamedVariable extends Operation {
    static readonly OP_CODE = 137;
    static readonly STRING_TYPE = 0;
    static readonly FLOAT_TYPE = 1;
    static readonly COLOR_TYPE = 2;
    static readonly IMAGE_TYPE = 3;
    static readonly INT_TYPE = 4;
    static readonly LONG_TYPE = 5;
    static readonly FLOAT_ARRAY_TYPE = 6;

    mVarName: string; mVarId: number; mVarType: number;

    constructor(varName: string, varId: number, varType: number) {
        super(); this.mVarName = varName; this.mVarId = varId; this.mVarType = varType;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    apply(context: RemoteContext): void {
        context.loadVariableName(this.mVarName, this.mVarId, this.mVarType);
    }

    deepToString(indent: string): string { return `${indent}NamedVariable("${this.mVarName}", ${this.mVarId})`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const id = buffer.readInt();
        const type = buffer.readInt();
        const name = buffer.readUTF8();
        operations.push(new NamedVariable(name, id, type));
    }
}

export class RootContentDescription extends Operation {
    static readonly OP_CODE = 103;
    private mContentDescription: number;

    constructor(contentDescription: number) {
        super(); this.mContentDescription = contentDescription;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    apply(context: RemoteContext): void {
        context.setDocumentContentDescription(this.mContentDescription);
    }

    deepToString(indent: string): string { return `${indent}RootContentDescription(${this.mContentDescription})`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new RootContentDescription(buffer.readInt()));
    }
}

export class RootContentBehavior extends Operation {
    static readonly OP_CODE = 65;
    static readonly NONE = 0;
    static readonly SIZING_LAYOUT = 1;
    static readonly SIZING_SCALE = 2;
    static readonly ALIGNMENT_TOP = 1;
    static readonly ALIGNMENT_VERTICAL_CENTER = 2;
    static readonly ALIGNMENT_BOTTOM = 4;
    static readonly ALIGNMENT_START = 16;
    static readonly ALIGNMENT_HORIZONTAL_CENTER = 32;
    static readonly ALIGNMENT_END = 64;
    static readonly ALIGNMENT_CENTER = 34; // H_CENTER + V_CENTER
    static readonly SCALE_INSIDE = 1;
    static readonly SCALE_FIT = 2;
    static readonly SCALE_FILL_WIDTH = 3;
    static readonly SCALE_FILL_HEIGHT = 4;
    static readonly SCALE_CROP = 5;
    static readonly SCALE_FILL_BOUNDS = 6;
    static readonly LAYOUT_MATCH_PARENT = 0;
    static readonly LAYOUT_WRAP_CONTENT = 1;

    private mScroll: number; private mAlignment: number;
    private mSizing: number; private mMode: number;

    constructor(scroll: number, alignment: number, sizing: number, mode: number) {
        super();
        this.mScroll = scroll; this.mAlignment = alignment;
        this.mSizing = sizing; this.mMode = mode;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    apply(context: RemoteContext): void {
        context.setRootContentBehavior(this.mScroll, this.mAlignment, this.mSizing, this.mMode);
    }

    deepToString(indent: string): string { return `${indent}RootContentBehavior`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new RootContentBehavior(
            buffer.readInt(), buffer.readInt(), buffer.readInt(), buffer.readInt()
        ));
    }
}
