// DrawBase6: abstract base for draw operations with 6 float parameters.
// Matches Java DrawBase6.java — extends PaintOperation, implements VariableSupport.

import { PaintOperation } from '../PaintOperation';
import type { PaintContext } from '../PaintContext';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import type { VariableSupport } from '../VariableSupport';
import { idFromNan } from './Utils';

export abstract class DrawBase6 extends PaintOperation implements VariableSupport {
    // Wire values (may be NaN-encoded variable references)
    private mV1Value: number;
    private mV2Value: number;
    private mV3Value: number;
    private mV4Value: number;
    private mV5Value: number;
    private mV6Value: number;

    // Resolved output values (updated by updateVariables)
    mV1: number;
    mV2: number;
    mV3: number;
    mV4: number;
    mV5: number;
    mV6: number;

    constructor(v1: number, v2: number, v3: number, v4: number, v5: number, v6: number) {
        super();
        this.mV1Value = v1;
        this.mV2Value = v2;
        this.mV3Value = v3;
        this.mV4Value = v4;
        this.mV5Value = v5;
        this.mV6Value = v6;
        this.mV1 = v1;
        this.mV2 = v2;
        this.mV3 = v3;
        this.mV4 = v4;
        this.mV5 = v5;
        this.mV6 = v6;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        if (Number.isNaN(this.mV1Value)) context.listensTo(idFromNan(this.mV1Value), this);
        if (Number.isNaN(this.mV2Value)) context.listensTo(idFromNan(this.mV2Value), this);
        if (Number.isNaN(this.mV3Value)) context.listensTo(idFromNan(this.mV3Value), this);
        if (Number.isNaN(this.mV4Value)) context.listensTo(idFromNan(this.mV4Value), this);
        if (Number.isNaN(this.mV5Value)) context.listensTo(idFromNan(this.mV5Value), this);
        if (Number.isNaN(this.mV6Value)) context.listensTo(idFromNan(this.mV6Value), this);
    }

    updateVariables(context: RemoteContext): void {
        this.mV1 = Number.isNaN(this.mV1Value) ? context.getFloat(idFromNan(this.mV1Value)) : this.mV1Value;
        this.mV2 = Number.isNaN(this.mV2Value) ? context.getFloat(idFromNan(this.mV2Value)) : this.mV2Value;
        this.mV3 = Number.isNaN(this.mV3Value) ? context.getFloat(idFromNan(this.mV3Value)) : this.mV3Value;
        this.mV4 = Number.isNaN(this.mV4Value) ? context.getFloat(idFromNan(this.mV4Value)) : this.mV4Value;
        this.mV5 = Number.isNaN(this.mV5Value) ? context.getFloat(idFromNan(this.mV5Value)) : this.mV5Value;
        this.mV6 = Number.isNaN(this.mV6Value) ? context.getFloat(idFromNan(this.mV6Value)) : this.mV6Value;
    }

    abstract paintBase6(context: PaintContext, v1: number, v2: number, v3: number, v4: number, v5: number, v6: number): void;

    paint(context: PaintContext): void {
        this.paintBase6(context, this.mV1, this.mV2, this.mV3, this.mV4, this.mV5, this.mV6);
    }
}
