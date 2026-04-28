// DrawText: draw a text run with variable-driven position.
// Matches Java DrawText.java — extends PaintOperation, implements VariableSupport.

import { PaintOperation } from '../PaintOperation';
import type { PaintContext } from '../PaintContext';
import type { Operation } from '../Operation';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import type { VariableSupport } from '../VariableSupport';
import { idFromNan } from './Utils';

export class DrawText extends PaintOperation implements VariableSupport {
    static readonly OP_CODE = 43;
    mTextId: number; mStart: number; mEnd: number;
    mContextStart: number; mContextEnd: number;
    mRtl: boolean;

    // Wire values (may be NaN-encoded variable references)
    private mXValue: number;
    private mYValue: number;

    // Resolved output values
    mX: number;
    mY: number;

    constructor(textId: number, start: number, end: number, contextStart: number, contextEnd: number,
                x: number, y: number, rtl: boolean) {
        super();
        this.mTextId = textId; this.mStart = start; this.mEnd = end;
        this.mContextStart = contextStart; this.mContextEnd = contextEnd;
        this.mXValue = x; this.mYValue = y;
        this.mX = x; this.mY = y;
        this.mRtl = rtl;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        context.listensTo(this.mTextId, this);
        if (Number.isNaN(this.mXValue)) context.listensTo(idFromNan(this.mXValue), this);
        if (Number.isNaN(this.mYValue)) context.listensTo(idFromNan(this.mYValue), this);
    }

    updateVariables(context: RemoteContext): void {
        this.mX = Number.isNaN(this.mXValue) ? context.getFloat(idFromNan(this.mXValue)) : this.mXValue;
        this.mY = Number.isNaN(this.mYValue) ? context.getFloat(idFromNan(this.mYValue)) : this.mYValue;
    }

    paint(context: PaintContext): void {
        context.drawTextRun(
            this.mTextId, this.mStart, this.mEnd,
            this.mContextStart, this.mContextEnd,
            this.mX, this.mY, this.mRtl
        );
    }

    deepToString(indent: string): string { return `${indent}DrawText(${this.mTextId})`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new DrawText(
            buffer.readInt(), buffer.readInt(), buffer.readInt(),
            buffer.readInt(), buffer.readInt(),
            buffer.readFloat(), buffer.readFloat(), buffer.readBoolean()
        ));
    }
}
