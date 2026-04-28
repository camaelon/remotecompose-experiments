// ColorExpression: color interpolation and computation expression.
// Matches Java ColorExpression.java — extends Operation, implements VariableSupport.

import { Operation } from '../Operation';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import type { VariableSupport } from '../VariableSupport';
import { idFromNan, intBitsToFloat, hsvToRgb, toARGB, interpolateColor } from './Utils';

export class ColorExpression extends Operation implements VariableSupport {
    static readonly OP_CODE = 134;

    static readonly COLOR_COLOR_INTERPOLATE = 0;
    static readonly ID_COLOR_INTERPOLATE = 1;
    static readonly COLOR_ID_INTERPOLATE = 2;
    static readonly ID_ID_INTERPOLATE = 3;
    static readonly HSV_MODE = 4;
    static readonly ARGB_MODE = 5;
    static readonly IDARGB_MODE = 6;

    mId: number;
    private mMode: number;
    private mAlpha: number;

    // Interpolation mode fields
    private mColor1: number;
    private mColor2: number;
    private mTween: number;
    private mOutColor1: number;
    private mOutColor2: number;
    private mOutTween: number;

    // HSV mode fields
    private mHue: number;
    private mSat: number;
    private mValue: number;
    private mOutHue: number;
    private mOutSat: number;
    private mOutValue: number;

    // ARGB mode fields
    private mArgbAlpha: number;
    private mArgbRed: number;
    private mArgbGreen: number;
    private mArgbBlue: number;
    private mOutArgbAlpha: number;
    private mOutArgbRed: number;
    private mOutArgbGreen: number;
    private mOutArgbBlue: number;

    constructor(id: number, param1: number, param2: number, param3: number, param4: number) {
        super();
        this.mId = id;
        this.mMode = param1 & 0xFF;
        this.mAlpha = (param1 >> 16) & 0xFF;

        // Interpolation defaults
        this.mColor1 = param2;
        this.mColor2 = param3;
        this.mTween = intBitsToFloat(param4);
        this.mOutColor1 = param2;
        this.mOutColor2 = param3;
        this.mOutTween = this.mTween;

        // HSV defaults
        this.mHue = 0; this.mSat = 0; this.mValue = 0;
        this.mOutHue = 0; this.mOutSat = 0; this.mOutValue = 0;

        // ARGB defaults
        this.mArgbAlpha = 0; this.mArgbRed = 0; this.mArgbGreen = 0; this.mArgbBlue = 0;
        this.mOutArgbAlpha = 0; this.mOutArgbRed = 0; this.mOutArgbGreen = 0; this.mOutArgbBlue = 0;

        if (this.mMode === ColorExpression.HSV_MODE) {
            this.mOutHue = this.mHue = intBitsToFloat(param2);
            this.mOutSat = this.mSat = intBitsToFloat(param3);
            this.mOutValue = this.mValue = intBitsToFloat(param4);
        } else if (this.mMode === ColorExpression.ARGB_MODE) {
            this.mOutArgbAlpha = this.mArgbAlpha = (param1 >> 16) / 1024.0;
            this.mOutArgbRed = this.mArgbRed = intBitsToFloat(param2);
            this.mOutArgbGreen = this.mArgbGreen = intBitsToFloat(param3);
            this.mOutArgbBlue = this.mArgbBlue = intBitsToFloat(param4);
        } else if (this.mMode === ColorExpression.IDARGB_MODE) {
            this.mArgbAlpha = intBitsToFloat((param1 >> 16) | 0xFF800000); // NaN-encoded ID
            this.mOutArgbAlpha = this.mArgbAlpha;
            this.mOutArgbRed = this.mArgbRed = intBitsToFloat(param2);
            this.mOutArgbGreen = this.mArgbGreen = intBitsToFloat(param3);
            this.mOutArgbBlue = this.mArgbBlue = intBitsToFloat(param4);
        }
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        if (Number.isNaN(this.mTween)) context.listensTo(idFromNan(this.mTween), this);
        if (this.mMode === ColorExpression.HSV_MODE) {
            if (Number.isNaN(this.mHue)) context.listensTo(idFromNan(this.mHue), this);
            if (Number.isNaN(this.mSat)) context.listensTo(idFromNan(this.mSat), this);
            if (Number.isNaN(this.mValue)) context.listensTo(idFromNan(this.mValue), this);
        }
        if (this.mMode === ColorExpression.ARGB_MODE || this.mMode === ColorExpression.IDARGB_MODE) {
            if (Number.isNaN(this.mArgbAlpha)) context.listensTo(idFromNan(this.mArgbAlpha), this);
            if (Number.isNaN(this.mArgbRed)) context.listensTo(idFromNan(this.mArgbRed), this);
            if (Number.isNaN(this.mArgbGreen)) context.listensTo(idFromNan(this.mArgbGreen), this);
            if (Number.isNaN(this.mArgbBlue)) context.listensTo(idFromNan(this.mArgbBlue), this);
        }
    }


    apply(context: RemoteContext): void {
        // Resolve NaN-encoded variable references
        this.updateVariables(context);

        if (this.mMode === ColorExpression.HSV_MODE) {
            context.loadColor(this.mId,
                ((this.mAlpha << 24) | (0xFFFFFF & hsvToRgb(this.mOutHue, this.mOutSat, this.mOutValue))) | 0);
            return;
        }
        if (this.mMode === ColorExpression.ARGB_MODE || this.mMode === ColorExpression.IDARGB_MODE) {
            context.loadColor(this.mId,
                toARGB(this.mOutArgbAlpha, this.mOutArgbRed, this.mOutArgbGreen, this.mOutArgbBlue));
            return;
        }
        // Interpolation modes (0-3)
        if (this.mOutTween === 0.0) {
            if ((this.mMode & 1) === 1) {
                this.mOutColor1 = context.getColor(this.mColor1);
            }
            context.loadColor(this.mId, this.mOutColor1);
        } else {
            if ((this.mMode & 1) === 1) {
                this.mOutColor1 = context.getColor(this.mColor1);
            }
            if ((this.mMode & 2) === 2) {
                this.mOutColor2 = context.getColor(this.mColor2);
            }
            context.loadColor(this.mId, interpolateColor(this.mOutColor1, this.mOutColor2, this.mOutTween));
        }
    }

    updateVariables(context: RemoteContext): void {
        if (this.mMode === ColorExpression.HSV_MODE) {
            if (Number.isNaN(this.mHue)) {
                this.mOutHue = context.getFloat(idFromNan(this.mHue));
            }
            if (Number.isNaN(this.mSat)) {
                this.mOutSat = context.getFloat(idFromNan(this.mSat));
            }
            if (Number.isNaN(this.mValue)) {
                this.mOutValue = context.getFloat(idFromNan(this.mValue));
            }
        }
        if (this.mMode === ColorExpression.ARGB_MODE || this.mMode === ColorExpression.IDARGB_MODE) {
            if (Number.isNaN(this.mArgbAlpha)) {
                this.mOutArgbAlpha = context.getFloat(idFromNan(this.mArgbAlpha));
            }
            if (Number.isNaN(this.mArgbRed)) {
                this.mOutArgbRed = context.getFloat(idFromNan(this.mArgbRed));
            }
            if (Number.isNaN(this.mArgbGreen)) {
                this.mOutArgbGreen = context.getFloat(idFromNan(this.mArgbGreen));
            }
            if (Number.isNaN(this.mArgbBlue)) {
                this.mOutArgbBlue = context.getFloat(idFromNan(this.mArgbBlue));
            }
        }
        if (Number.isNaN(this.mTween)) {
            this.mOutTween = context.getFloat(idFromNan(this.mTween));
        }
        if ((this.mMode & 1) === 1) {
            this.mOutColor1 = context.getColor(this.mColor1);
        }
        if ((this.mMode & 2) === 2) {
            this.mOutColor2 = context.getColor(this.mColor2);
        }
    }

    deepToString(indent: string): string { return `${indent}ColorExpression(${this.mId}, mode=${this.mMode})`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new ColorExpression(
            buffer.readInt(), buffer.readInt(), buffer.readInt(),
            buffer.readInt(), buffer.readInt()
        ));
    }
}
