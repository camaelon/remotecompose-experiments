import { Operation } from '../Operation';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import { idFromNan, listenFloat } from './Utils';

export class TextLookup extends Operation {
    static readonly OP_CODE = 151;
    private mTextId: number;
    private mDataSetId: number;
    private mIndex: number;
    private mOutIndex: number;

    constructor(textId: number, dataSetId: number, index: number) {
        super();
        this.mTextId = textId;
        this.mDataSetId = dataSetId;
        this.mIndex = index;
        this.mOutIndex = Number.isNaN(index) ? 0 : index;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        listenFloat(this.mIndex, context, this);
    }

    updateVariables(context: RemoteContext): void {
        if (Number.isNaN(this.mIndex)) {
            this.mOutIndex = context.getFloat(idFromNan(this.mIndex));
        }
    }

    apply(context: RemoteContext): void {
        if (Number.isNaN(this.mIndex)) {
            this.mOutIndex = context.getFloat(idFromNan(this.mIndex));
        }
        const id = context.getCollectionsAccess().getId(this.mDataSetId, Math.trunc(this.mOutIndex));
        if (id >= 0) {
            const text = context.getText(id);
            if (text !== null) {
                context.loadText(this.mTextId, text);
            }
        }
    }

    deepToString(indent: string): string {
        return `${indent}TextLookup(textId=${this.mTextId}, dataSet=${this.mDataSetId}, index=${this.mIndex})`;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const textId = buffer.readInt();
        const dataSetId = buffer.readInt();
        const index = buffer.readFloat();
        operations.push(new TextLookup(textId, dataSetId, index));
    }
}
