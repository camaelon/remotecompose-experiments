// DrawTextOnPath: draw text along a path with variable-driven offsets.
// Matches Java DrawTextOnPath.java — extends PaintOperation, implements VariableSupport.

import { PaintOperation } from '../PaintOperation';
import type { PaintContext } from '../PaintContext';
import type { Operation } from '../Operation';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import type { VariableSupport } from '../VariableSupport';
import { idFromNan } from './Utils';

export class DrawTextOnPath extends PaintOperation implements VariableSupport {
    static readonly OP_CODE = 53;
    mTextId: number;
    mPathId: number;

    // Wire values (may be NaN-encoded variable references)
    private mHOffsetValue: number;
    private mVOffsetValue: number;

    // Resolved output values
    private mOutHOffset: number;
    private mOutVOffset: number;

    constructor(textId: number, pathId: number, hOffset: number, vOffset: number) {
        super();
        this.mTextId = textId;
        this.mPathId = pathId;
        this.mHOffsetValue = hOffset;
        this.mVOffsetValue = vOffset;
        this.mOutHOffset = hOffset;
        this.mOutVOffset = vOffset;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        context.listensTo(this.mTextId, this);
        if (Number.isNaN(this.mHOffsetValue)) context.listensTo(idFromNan(this.mHOffsetValue), this);
        if (Number.isNaN(this.mVOffsetValue)) context.listensTo(idFromNan(this.mVOffsetValue), this);
    }

    updateVariables(context: RemoteContext): void {
        this.mOutHOffset = Number.isNaN(this.mHOffsetValue) ? context.getFloat(idFromNan(this.mHOffsetValue)) : this.mHOffsetValue;
        this.mOutVOffset = Number.isNaN(this.mVOffsetValue) ? context.getFloat(idFromNan(this.mVOffsetValue)) : this.mVOffsetValue;
    }

    paint(context: PaintContext): void {
        context.drawTextOnPath(this.mTextId, this.getId(this.mPathId, context), this.mOutHOffset, this.mOutVOffset);
    }

    deepToString(indent: string): string { return `${indent}DrawTextOnPath`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const textId = buffer.readInt();
        const pathId = buffer.readInt();
        const vOffset = buffer.readFloat();
        const hOffset = buffer.readFloat();
        operations.push(new DrawTextOnPath(textId, pathId, hOffset, vOffset));
    }
}
