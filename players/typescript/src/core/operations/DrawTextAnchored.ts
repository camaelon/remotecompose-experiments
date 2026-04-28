// DrawTextAnchored: anchored text drawing with variable-driven position.
// Matches Java DrawTextAnchored.java — extends PaintOperation, implements VariableSupport.

import { PaintOperation } from '../PaintOperation';
import { PaintContext } from '../PaintContext';
import type { Operation } from '../Operation';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import type { VariableSupport } from '../VariableSupport';
import { idFromNan } from './Utils';

export class DrawTextAnchored extends PaintOperation implements VariableSupport {
    static readonly OP_CODE = 133;

    static readonly ANCHOR_TEXT_RTL = 1;
    static readonly ANCHOR_MONOSPACE_MEASURE = 2;
    static readonly MEASURE_EVERY_TIME = 4;
    static readonly BASELINE_RELATIVE = 8;

    // Original wire values (may be NaN-encoded variable references)
    mTextID: number;
    mX: number;
    mY: number;
    mPanX: number;
    mPanY: number;
    mFlags: number;

    // Resolved output values (updated by updateVariables)
    mOutX: number;
    mOutY: number;
    mOutPanX: number;
    mOutPanY: number;

    // Cached text measurement
    mBounds = new Float32Array(4);
    mLastString: string | null = null;

    constructor(textId: number, x: number, y: number, panX: number, panY: number, flags: number) {
        super();
        this.mTextID = textId;
        this.mX = x;
        this.mY = y;
        this.mOutX = x;
        this.mOutY = y;
        this.mFlags = flags;
        this.mOutPanX = this.mPanX = panX;
        this.mOutPanY = this.mPanY = panY;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        context.listensTo(this.mTextID, this);
        if (Number.isNaN(this.mX)) {
            context.listensTo(idFromNan(this.mX), this);
        }
        if (Number.isNaN(this.mY)) {
            context.listensTo(idFromNan(this.mY), this);
        }
        if (Number.isNaN(this.mPanX)) {
            context.listensTo(idFromNan(this.mPanX), this);
        }
        if (Number.isNaN(this.mPanY) && idFromNan(this.mPanY) > 0) {
            context.listensTo(idFromNan(this.mPanY), this);
        }
    }

    updateVariables(context: RemoteContext): void {
        this.mOutX = Number.isNaN(this.mX) ? context.getFloat(idFromNan(this.mX)) : this.mX;
        this.mOutY = Number.isNaN(this.mY) ? context.getFloat(idFromNan(this.mY)) : this.mY;
        this.mOutPanX = Number.isNaN(this.mPanX) ? context.getFloat(idFromNan(this.mPanX)) : this.mPanX;
        this.mOutPanY = Number.isNaN(this.mPanY) ? context.getFloat(idFromNan(this.mPanY)) : this.mPanY;
    }

    private getHorizontalOffset(): number {
        // TODO scale TextSize / BaseTextSize
        const scale = 1.0;
        const textWidth = scale * (this.mBounds[2] - this.mBounds[0]);
        const boxWidth = 0;
        return (boxWidth - textWidth) * (1 + this.mOutPanX) / 2 - (scale * this.mBounds[0]);
    }

    private getVerticalOffset(baseline: boolean): number {
        // TODO scale TextSize / BaseTextSize
        const scale = 1.0;
        const boxHeight = 0;
        const textHeight = scale * (this.mBounds[3] - this.mBounds[1]);
        return (boxHeight - textHeight) * (1 - this.mOutPanY) / 2
            + (baseline ? textHeight / 2 : (-scale * this.mBounds[1]));
    }

    paint(context: PaintContext): void {
        const flags = ((this.mFlags & DrawTextAnchored.ANCHOR_MONOSPACE_MEASURE) !== 0)
            ? PaintContext.TEXT_MEASURE_MONOSPACE_WIDTH
            : 0;

        const str = context.getText(this.mTextID);
        // Only re-measure when text changes or MEASURE_EVERY_TIME flag is set
        if (str !== this.mLastString || (this.mFlags & DrawTextAnchored.MEASURE_EVERY_TIME) !== 0) {
            this.mLastString = str;
            context.getTextBounds(this.mTextID, 0, -1, flags, this.mBounds);
        }

        const baseline = (this.mFlags & DrawTextAnchored.BASELINE_RELATIVE) !== 0;
        const x = this.mOutX + this.getHorizontalOffset();
        const y = Number.isNaN(this.mOutPanY) ? this.mOutY : this.mOutY + this.getVerticalOffset(baseline);

        context.drawTextRun(this.mTextID, 0, -1, 0, 1, x, y,
            (this.mFlags & DrawTextAnchored.ANCHOR_TEXT_RTL) === 1);
    }

    deepToString(indent: string): string { return `${indent}DrawTextAnchored(${this.mTextID})`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new DrawTextAnchored(
            buffer.readInt(), buffer.readFloat(), buffer.readFloat(),
            buffer.readFloat(), buffer.readFloat(), buffer.readInt()
        ));
    }
}
