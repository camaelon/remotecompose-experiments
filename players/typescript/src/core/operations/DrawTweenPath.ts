// DrawTweenPath: draw an interpolated path between two paths.
// Matches Java DrawTweenPath.java — extends PaintOperation, implements VariableSupport.

import { PaintOperation } from '../PaintOperation';
import type { PaintContext } from '../PaintContext';
import type { Operation } from '../Operation';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import type { VariableSupport } from '../VariableSupport';
import { idFromNan } from './Utils';

export class DrawTweenPath extends PaintOperation implements VariableSupport {
    static readonly OP_CODE = 125;
    private mPath1Id: number;
    private mPath2Id: number;

    // Wire values (may be NaN-encoded variable references)
    private mTween: number;
    private mStart: number;
    private mEnd: number;

    // Resolved output values
    private mOutTween: number;
    private mOutStart: number;
    private mOutEnd: number;

    constructor(path1Id: number, path2Id: number, tween: number, start: number, end: number) {
        super();
        this.mPath1Id = path1Id;
        this.mPath2Id = path2Id;
        this.mTween = tween;
        this.mStart = start;
        this.mEnd = end;
        this.mOutTween = tween;
        this.mOutStart = start;
        this.mOutEnd = end;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        if (Number.isNaN(this.mTween)) context.listensTo(idFromNan(this.mTween), this);
        if (Number.isNaN(this.mStart)) context.listensTo(idFromNan(this.mStart), this);
        if (Number.isNaN(this.mEnd)) context.listensTo(idFromNan(this.mEnd), this);
    }

    updateVariables(context: RemoteContext): void {
        this.mOutTween = Number.isNaN(this.mTween) ? context.getFloat(idFromNan(this.mTween)) : this.mTween;
        this.mOutStart = Number.isNaN(this.mStart) ? context.getFloat(idFromNan(this.mStart)) : this.mStart;
        this.mOutEnd = Number.isNaN(this.mEnd) ? context.getFloat(idFromNan(this.mEnd)) : this.mEnd;
    }

    paint(context: PaintContext): void {
        context.drawTweenPath(this.getId(this.mPath1Id, context), this.getId(this.mPath2Id, context), this.mOutTween, this.mOutStart, this.mOutEnd);
    }

    deepToString(indent: string): string {
        return `${indent}DrawTweenPath`;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new DrawTweenPath(
            buffer.readInt(), buffer.readInt(), buffer.readFloat(),
            buffer.readFloat(), buffer.readFloat()
        ));
    }
}
