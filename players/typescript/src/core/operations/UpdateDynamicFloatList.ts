// UpdateDynamicFloatList: updates a value in a dynamic float list.
// Port of Java UpdateDynamicFloatList.java.

import { Operation } from '../Operation';
import type { VariableSupport } from '../VariableSupport';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import { idFromNan } from './Utils';

export class UpdateDynamicFloatList extends Operation implements VariableSupport {
    static readonly OP_CODE = 198;

    private mArrayId: number;
    private mIndex: number;
    private mIndexOut: number;
    private mValue: number;
    private mValueOut: number;

    constructor(arrayId: number, index: number, value: number) {
        super();
        this.mArrayId = arrayId;
        this.mIndex = index;
        this.mIndexOut = index;
        this.mValue = value;
        this.mValueOut = value;
    }

    updateVariables(context: RemoteContext): void {
        this.mIndexOut = Number.isNaN(this.mIndex) ? context.getFloat(idFromNan(this.mIndex)) : this.mIndex;
        this.mValueOut = Number.isNaN(this.mValue) ? context.getFloat(idFromNan(this.mValue)) : this.mValue;
    }

    registerListening(context: RemoteContext): void {
        if (Number.isNaN(this.mIndex)) {
            context.listensTo(idFromNan(this.mIndex), this);
        }
        if (Number.isNaN(this.mValue)) {
            context.listensTo(idFromNan(this.mValue), this);
        }
    }

    apply(context: RemoteContext): void {
        const state = context.mRemoteComposeState;
        const values = state.getDynamicFloats(this.mArrayId);
        if (values !== null) {
            const index = Math.floor(this.mIndexOut);
            if (index < values.length) {
                values[index] = this.mValueOut;
            }
            state.markVariableDirty(this.mArrayId);
        }
    }

    write(buffer: WireBuffer): void {
        buffer.start(UpdateDynamicFloatList.OP_CODE);
        buffer.writeInt(this.mArrayId);
        buffer.writeFloat(this.mIndexOut);
        buffer.writeFloat(this.mValueOut);
    }

    deepToString(indent: string): string {
        return `${indent}UpdateDynamicFloatList(arrayId=${this.mArrayId}, index=${this.mIndexOut}, value=${this.mValueOut})`;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const id = buffer.readInt();
        const index = buffer.readFloat();
        const value = buffer.readFloat();
        operations.push(new UpdateDynamicFloatList(id, index, value));
    }
}
