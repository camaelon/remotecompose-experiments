// DataDynamicListFloat: a dynamic float list registered as a collection.
// Port of Java DataDynamicListFloat.java.

import { Operation } from '../Operation';
import type { VariableSupport } from '../VariableSupport';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import { idFromNan } from './Utils';

export class DataDynamicListFloat extends Operation implements VariableSupport {
    static readonly OP_CODE = 197;
    private static readonly MAX_FLOAT_ARRAY = 2000;

    readonly mId: number;
    readonly isDynamic = true;
    private mArrayLength: number;
    private mArrayLengthOut: number;
    private mValues: Float32Array;

    constructor(id: number, nbValues: number) {
        super();
        this.mId = id;
        if (nbValues > DataDynamicListFloat.MAX_FLOAT_ARRAY) {
            throw new Error('Array too large');
        }
        this.mValues = new Float32Array(Math.floor(nbValues));
        this.mArrayLength = this.mArrayLengthOut = nbValues;
    }

    updateVariables(context: RemoteContext): void {
        if (Number.isNaN(this.mArrayLength)) {
            this.mArrayLengthOut = context.getFloat(idFromNan(this.mArrayLength));
        }
        if (Math.floor(this.mArrayLengthOut) !== this.mValues.length) {
            this.mValues = new Float32Array(Math.floor(this.mArrayLengthOut));
        }
    }

    registerListening(context: RemoteContext): void {
        context.addCollection(this.mId, this);
        if (Number.isNaN(this.mArrayLength)) {
            context.listensTo(idFromNan(this.mArrayLength), this);
        }
    }

    apply(context: RemoteContext): void {
        context.addCollection(this.mId, this);
    }

    getFloatValue(index: number): number {
        return this.mValues[index];
    }

    getFloats(): Float32Array {
        return this.mValues;
    }

    getLength(): number {
        return this.mValues.length;
    }

    updateValues(values: number[] | Float32Array): void {
        if (values.length !== this.mValues.length) {
            this.mValues = new Float32Array(values.length);
        }
        this.mValues.set(values);
    }

    write(buffer: WireBuffer): void {
        buffer.start(DataDynamicListFloat.OP_CODE);
        buffer.writeInt(this.mId);
        buffer.writeFloat(this.mValues.length);
    }

    deepToString(indent: string): string {
        return `${indent}DataDynamicListFloat(id=${this.mId}, len=${this.mValues.length})`;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const id = buffer.readInt();
        const len = buffer.readFloat();
        if (len > DataDynamicListFloat.MAX_FLOAT_ARRAY) {
            throw new Error(`${len} entries exceeds max = ${DataDynamicListFloat.MAX_FLOAT_ARRAY}`);
        }
        operations.push(new DataDynamicListFloat(id, len));
    }
}
