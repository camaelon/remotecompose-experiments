// DataListFloat: store a list of float values as a collection.
// Matches Java DataListFloat.java.

import { Operation } from '../Operation';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import type { VariableSupport } from '../VariableSupport';
import { idFromNan, isVariable } from './Utils';

export class DataListFloat extends Operation implements VariableSupport {
    static readonly OP_CODE = 147;
    mId: number;
    private mValues: Float32Array;

    constructor(id: number, values: Float32Array) {
        super(); this.mId = id; this.mValues = values;
    }

    update(other: DataListFloat): void { this.mValues = other.mValues; }

    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        context.addCollection(this.mId, {
            values: this.mValues,
            getLength: () => this.mValues.length,
            getFloatValue: (i: number) => this.mValues[i],
            getFloats: () => this.mValues
        });
        for (const v of this.mValues) {
            if (isVariable(v)) {
                context.listensTo(idFromNan(v), this);
            }
        }
    }

    updateVariables(_context: RemoteContext): void {
        // TODO: add support for variables in arrays (matches Java TODO)
    }

    apply(context: RemoteContext): void {
        context.addCollection(this.mId, {
            values: this.mValues,
            getLength: () => this.mValues.length,
            getFloatValue: (i: number) => this.mValues[i],
            getFloats: () => this.mValues
        });
    }

    deepToString(indent: string): string { return `${indent}DataListFloat(${this.mId})`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const id = buffer.readInt();
        const count = buffer.readInt();
        const values = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            values[i] = buffer.readFloat();
        }
        operations.push(new DataListFloat(id, values));
    }
}
