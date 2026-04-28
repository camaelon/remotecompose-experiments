// DrawBase4: abstract base for draw operations with 4 float parameters.
// Matches Java DrawBase4.java — extends PaintOperation, implements VariableSupport.

import { PaintOperation } from '../PaintOperation';
import type { PaintContext } from '../PaintContext';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import type { VariableSupport } from '../VariableSupport';
import { idFromNan } from './Utils';

export abstract class DrawBase4 extends PaintOperation implements VariableSupport {
    // Wire values (may be NaN-encoded variable references)
    private mX1Value: number;
    private mY1Value: number;
    private mX2Value: number;
    private mY2Value: number;

    // Resolved output values (updated by updateVariables)
    mX1: number;
    mY1: number;
    mX2: number;
    mY2: number;

    constructor(x1: number, y1: number, x2: number, y2: number) {
        super();
        this.mX1Value = x1;
        this.mY1Value = y1;
        this.mX2Value = x2;
        this.mY2Value = y2;
        this.mX1 = x1;
        this.mY1 = y1;
        this.mX2 = x2;
        this.mY2 = y2;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        if (Number.isNaN(this.mX1Value)) context.listensTo(idFromNan(this.mX1Value), this);
        if (Number.isNaN(this.mY1Value)) context.listensTo(idFromNan(this.mY1Value), this);
        if (Number.isNaN(this.mX2Value)) context.listensTo(idFromNan(this.mX2Value), this);
        if (Number.isNaN(this.mY2Value)) context.listensTo(idFromNan(this.mY2Value), this);
    }

    updateVariables(context: RemoteContext): void {
        this.mX1 = Number.isNaN(this.mX1Value) ? context.getFloat(idFromNan(this.mX1Value)) : this.mX1Value;
        this.mY1 = Number.isNaN(this.mY1Value) ? context.getFloat(idFromNan(this.mY1Value)) : this.mY1Value;
        this.mX2 = Number.isNaN(this.mX2Value) ? context.getFloat(idFromNan(this.mX2Value)) : this.mX2Value;
        this.mY2 = Number.isNaN(this.mY2Value) ? context.getFloat(idFromNan(this.mY2Value)) : this.mY2Value;
    }

    abstract paintBase4(context: PaintContext, x1: number, y1: number, x2: number, y2: number): void;

    paint(context: PaintContext): void {
        this.paintBase4(context, this.mX1, this.mY1, this.mX2, this.mY2);
    }
}
