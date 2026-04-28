// IdLookup: looks up an ID from an ID collection by index.
// Port of Java IdLookup.java.

import { Operation } from '../Operation';
import type { VariableSupport } from '../VariableSupport';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import { idFromNan } from './Utils';

export class IdLookup extends Operation implements VariableSupport {
    static readonly OP_CODE = 192;

    private mTextId: number;
    private mDataSetId: number;
    private mIndex: number;
    private mOutIndex: number;

    constructor(textId: number, dataSetId: number, index: number) {
        super();
        this.mTextId = textId;
        this.mDataSetId = dataSetId;
        this.mOutIndex = this.mIndex = index;
    }

    updateVariables(context: RemoteContext): void {
        if (Number.isNaN(this.mIndex)) {
            this.mOutIndex = context.getFloat(idFromNan(this.mIndex));
        }
    }

    registerListening(context: RemoteContext): void {
        if (Number.isNaN(this.mIndex)) {
            context.listensTo(idFromNan(this.mIndex), this);
        }
    }

    apply(context: RemoteContext): void {
        const id = context.getCollectionsAccess().getId(this.mDataSetId, Math.floor(this.mOutIndex));
        context.loadInteger(this.mTextId, id);
    }

    write(buffer: WireBuffer): void {
        buffer.start(IdLookup.OP_CODE);
        buffer.writeInt(this.mTextId);
        buffer.writeInt(this.mDataSetId);
        buffer.writeFloat(this.mIndex);
    }

    deepToString(indent: string): string {
        return `${indent}IdLookup(textId=${this.mTextId}, dataSetId=${this.mDataSetId}, index=${this.mIndex})`;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const textId = buffer.readInt();
        const dataSetId = buffer.readInt();
        const index = buffer.readFloat();
        operations.push(new IdLookup(textId, dataSetId, index));
    }
}
