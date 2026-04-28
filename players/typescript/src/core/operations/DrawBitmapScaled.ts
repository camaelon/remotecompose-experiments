// DrawBitmapScaled: draw a bitmap with float source/dest bounds and scale type.
// Matches Java DrawBitmapScaled.java — extends PaintOperation, implements VariableSupport.

import { PaintOperation } from '../PaintOperation';
import type { PaintContext } from '../PaintContext';
import type { Operation } from '../Operation';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import type { VariableSupport } from '../VariableSupport';
import { idFromNan } from './Utils';
import { ImageScaling } from './utilities/ImageScaling';

export class DrawBitmapScaled extends PaintOperation implements VariableSupport {
    static readonly OP_CODE = 149;
    mImageId: number;
    private mSrcLeft: number; private mOutSrcLeft: number;
    private mSrcTop: number; private mOutSrcTop: number;
    private mSrcRight: number; private mOutSrcRight: number;
    private mSrcBottom: number; private mOutSrcBottom: number;
    private mDstLeft: number; private mOutDstLeft: number;
    private mDstTop: number; private mOutDstTop: number;
    private mDstRight: number; private mOutDstRight: number;
    private mDstBottom: number; private mOutDstBottom: number;
    private mScaleType: number;
    private mScaleFactor: number; private mOutScaleFactor: number;
    private mCdId: number;
    private mScaling = new ImageScaling();

    constructor(imageId: number, srcL: number, srcT: number, srcR: number, srcB: number,
                dstL: number, dstT: number, dstR: number, dstB: number,
                scaleType: number, scaleFactor: number, cdId: number) {
        super();
        this.mImageId = imageId;
        this.mOutSrcLeft = this.mSrcLeft = srcL;
        this.mOutSrcTop = this.mSrcTop = srcT;
        this.mOutSrcRight = this.mSrcRight = srcR;
        this.mOutSrcBottom = this.mSrcBottom = srcB;
        this.mOutDstLeft = this.mDstLeft = dstL;
        this.mOutDstTop = this.mDstTop = dstT;
        this.mOutDstRight = this.mDstRight = dstR;
        this.mOutDstBottom = this.mDstBottom = dstB;
        this.mScaleType = scaleType & 0xFF;
        if (((scaleType >> 8) & 0x1) !== 0) {
            this.mImageId |= PaintOperation.PTR_DEREFERENCE;
        }
        this.mOutScaleFactor = this.mScaleFactor = scaleFactor;
        this.mCdId = cdId;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        const register = (v: number) => {
            if (Number.isNaN(v)) context.listensTo(idFromNan(v), this);
        };
        register(this.mSrcLeft); register(this.mSrcTop);
        register(this.mSrcRight); register(this.mSrcBottom);
        register(this.mDstLeft); register(this.mDstTop);
        register(this.mDstRight); register(this.mDstBottom);
        register(this.mScaleFactor);
    }

    updateVariables(context: RemoteContext): void {
        const resolve = (wire: number) =>
            Number.isNaN(wire) ? context.getFloat(idFromNan(wire)) : wire;
        this.mOutSrcLeft = resolve(this.mSrcLeft);
        this.mOutSrcTop = resolve(this.mSrcTop);
        this.mOutSrcRight = resolve(this.mSrcRight);
        this.mOutSrcBottom = resolve(this.mSrcBottom);
        this.mOutDstLeft = resolve(this.mDstLeft);
        this.mOutDstTop = resolve(this.mDstTop);
        this.mOutDstRight = resolve(this.mDstRight);
        this.mOutDstBottom = resolve(this.mDstBottom);
        this.mOutScaleFactor = resolve(this.mScaleFactor);
    }

    paint(context: PaintContext): void {
        this.mScaling.setup(
            this.mOutSrcLeft, this.mOutSrcTop, this.mOutSrcRight, this.mOutSrcBottom,
            this.mOutDstLeft, this.mOutDstTop, this.mOutDstRight, this.mOutDstBottom,
            this.mScaleType, this.mOutScaleFactor
        );
        context.save();
        context.clipRect(this.mOutDstLeft, this.mOutDstTop, this.mOutDstRight, this.mOutDstBottom);
        context.drawBitmap(
            this.getId(this.mImageId, context),
            this.mOutSrcLeft | 0, this.mOutSrcTop | 0,
            this.mOutSrcRight | 0, this.mOutSrcBottom | 0,
            this.mScaling.mFinalDstLeft | 0, this.mScaling.mFinalDstTop | 0,
            this.mScaling.mFinalDstRight | 0, this.mScaling.mFinalDstBottom | 0,
            this.mCdId
        );
        context.restore();
    }

    deepToString(indent: string): string { return `${indent}DrawBitmapScaled(${this.mImageId})`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const id = buffer.readInt();
        const srcL = buffer.readFloat(); const srcT = buffer.readFloat();
        const srcR = buffer.readFloat(); const srcB = buffer.readFloat();
        const dstL = buffer.readFloat(); const dstT = buffer.readFloat();
        const dstR = buffer.readFloat(); const dstB = buffer.readFloat();
        const scaleType = buffer.readInt();
        const scaleFactor = buffer.readFloat();
        const cdId = buffer.readInt();
        operations.push(new DrawBitmapScaled(id, srcL, srcT, srcR, srcB, dstL, dstT, dstR, dstB, scaleType, scaleFactor, cdId));
    }
}
