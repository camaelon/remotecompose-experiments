// TextSubtext: extracts a substring from a text variable.
// Matches Java TextSubtext.java (opcode 182).

import { Operation } from '../Operation';
import type { RemoteContext } from '../RemoteContext';
import type { WireBuffer } from '../WireBuffer';
import type { VariableSupport } from '../VariableSupport';
import { idFromNan } from './Utils';

export class TextSubtext extends Operation implements VariableSupport {
    static readonly OP_CODE = 182;
    private mTextId: number;
    private mSrcId: number;
    private mStart: number;
    private mLen: number;
    private mOutStart: number;
    private mOutLen: number;

    constructor(textId: number, srcId: number, start: number, len: number) {
        super();
        this.mTextId = textId;
        this.mSrcId = srcId;
        this.mStart = start;
        this.mLen = len;
        this.mOutStart = start;
        this.mOutLen = len;
    }

    write(_buffer: WireBuffer): void { /* not needed */ }

    apply(context: RemoteContext): void {
        const str = context.getText(this.mSrcId);
        if (!str) {
            context.loadText(this.mTextId, '');
            return;
        }
        const s = Math.max(0, Math.min(Math.floor(this.mOutStart), str.length));
        let out: string;
        if (this.mOutLen === -1) {
            out = str.substring(s);
        } else {
            const e = Math.min(s + Math.floor(this.mOutLen), str.length);
            out = str.substring(s, e);
        }
        context.loadText(this.mTextId, out);
    }

    deepToString(indent: string): string {
        return `${indent}TextSubtext(${this.mTextId}, ${this.mSrcId}, ${this.mStart}, ${this.mLen})`;
    }

    registerListening(context: RemoteContext): void {
        context.listensTo(this.mSrcId, this);
        if (Number.isNaN(this.mStart)) {
            context.listensTo(idFromNan(this.mStart), this);
        }
        if (Number.isNaN(this.mLen)) {
            context.listensTo(idFromNan(this.mLen), this);
        }
    }

    updateVariables(context: RemoteContext): void {
        if (Number.isNaN(this.mStart)) {
            this.mOutStart = context.getFloat(idFromNan(this.mStart));
        }
        if (Number.isNaN(this.mLen)) {
            this.mOutLen = context.getFloat(idFromNan(this.mLen));
        }
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const textId = buffer.readInt();
        const srcId = buffer.readInt();
        const start = buffer.readFloat();
        const len = buffer.readFloat();
        operations.push(new TextSubtext(textId, srcId, start, len));
    }
}
