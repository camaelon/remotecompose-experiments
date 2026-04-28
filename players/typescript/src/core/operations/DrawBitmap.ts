// DrawBitmap: draw a bitmap with float destination bounds.
// Matches Java DrawBitmap.java — extends PaintOperation, implements VariableSupport.

import { PaintOperation } from '../PaintOperation';
import type { PaintContext } from '../PaintContext';
import type { Operation } from '../Operation';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import type { VariableSupport } from '../VariableSupport';
import { idFromNan } from './Utils';

export class DrawBitmap extends PaintOperation implements VariableSupport {
    static readonly OP_CODE = 44;

    mImageId: number;
    mCdId: number;

    // Wire values (may be NaN-encoded variable references)
    private mLeft: number;
    private mTop: number;
    private mRight: number;
    private mBottom: number;

    // Resolved output values
    private mOutLeft: number;
    private mOutTop: number;
    private mOutRight: number;
    private mOutBottom: number;

    constructor(imageId: number, left: number, top: number, right: number, bottom: number, cdId: number) {
        super();
        this.mImageId = imageId;
        this.mLeft = left;
        this.mTop = top;
        this.mRight = right;
        this.mBottom = bottom;
        this.mCdId = cdId;
        this.mOutLeft = left;
        this.mOutTop = top;
        this.mOutRight = right;
        this.mOutBottom = bottom;
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

    paint(context: PaintContext): void {
        context.drawBitmapSimple(
            this.getId(this.mImageId, context),
            this.mOutLeft, this.mOutTop, this.mOutRight, this.mOutBottom
        );
    }

    deepToString(indent: string): string { return `${indent}DrawBitmap(${this.mImageId})`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const id = buffer.readInt();
        const left = buffer.readFloat();
        const top = buffer.readFloat();
        const right = buffer.readFloat();
        const bottom = buffer.readFloat();
        const cdId = buffer.readInt();
        operations.push(new DrawBitmap(id, left, top, right, bottom, cdId));
    }
}
