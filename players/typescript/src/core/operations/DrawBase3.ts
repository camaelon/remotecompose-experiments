// DrawBase3: abstract base for draw operations with 3 float parameters.
// Matches Java DrawBase3.java — extends PaintOperation, implements VariableSupport.

import { PaintOperation } from '../PaintOperation';
import type { PaintContext } from '../PaintContext';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import type { VariableSupport } from '../VariableSupport';
import { idFromNan, isVariable } from './Utils';

export abstract class DrawBase3 extends PaintOperation implements VariableSupport {
    // Wire values (may be NaN-encoded variable references)
    private mV1Value: number;
    private mV2Value: number;
    private mV3Value: number;

    // Resolved output values (updated by updateVariables)
    mV1: number;
    mV2: number;
    mV3: number;

    constructor(v1: number, v2: number, v3: number) {
        super();
        this.mV1Value = v1;
        this.mV2Value = v2;
        this.mV3Value = v3;
        this.mV1 = v1;
        this.mV2 = v2;
        this.mV3 = v3;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        if (isVariable(this.mV1Value)) context.listensTo(idFromNan(this.mV1Value), this);
        if (isVariable(this.mV2Value)) context.listensTo(idFromNan(this.mV2Value), this);
        if (isVariable(this.mV3Value)) context.listensTo(idFromNan(this.mV3Value), this);
    }

    updateVariables(context: RemoteContext): void {
        this.mV1 = Number.isNaN(this.mV1Value) ? context.getFloat(idFromNan(this.mV1Value)) : this.mV1Value;
        this.mV2 = Number.isNaN(this.mV2Value) ? context.getFloat(idFromNan(this.mV2Value)) : this.mV2Value;
        this.mV3 = Number.isNaN(this.mV3Value) ? context.getFloat(idFromNan(this.mV3Value)) : this.mV3Value;
    }

    abstract paintBase3(context: PaintContext, v1: number, v2: number, v3: number): void;

    paint(context: PaintContext): void {
        this.paintBase3(context, this.mV1, this.mV2, this.mV3);
    }
}
