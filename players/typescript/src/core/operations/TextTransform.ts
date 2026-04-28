import { Operation } from '../Operation';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';

export class TextTransform extends Operation {
    static readonly OP_CODE = 199;
    static readonly TEXT_TO_LOWERCASE = 1;
    static readonly TEXT_TO_UPPERCASE = 2;
    static readonly TEXT_TRIM = 3;
    static readonly TEXT_CAPITALIZE = 4;
    static readonly TEXT_UPPERCASE_FIRST_CHAR = 5;

    private mTextId: number;
    private mSrcId: number;
    private mStart: number;
    private mLen: number;
    private mOperation: number;

    constructor(textId: number, srcId: number, start: number, len: number, operation: number) {
        super();
        this.mTextId = textId; this.mSrcId = srcId;
        this.mStart = start; this.mLen = len; this.mOperation = operation;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    apply(context: RemoteContext): void {
        let text = context.getText(this.mSrcId) || '';
        const start = Number.isNaN(this.mStart) ? 0 : Math.trunc(this.mStart);
        const len = Number.isNaN(this.mLen) ? text.length : Math.trunc(this.mLen);
        if (start > 0 || len < text.length) {
            text = text.substring(start, start + len);
        }
        switch (this.mOperation) {
            case TextTransform.TEXT_TO_LOWERCASE: text = text.toLowerCase(); break;
            case TextTransform.TEXT_TO_UPPERCASE: text = text.toUpperCase(); break;
            case TextTransform.TEXT_TRIM: text = text.trim(); break;
            case TextTransform.TEXT_CAPITALIZE:
                text = text.replace(/\b\w/g, c => c.toUpperCase()); break;
            case TextTransform.TEXT_UPPERCASE_FIRST_CHAR:
                if (text.length > 0) text = text[0].toUpperCase() + text.substring(1); break;
        }
        context.loadText(this.mTextId, text);
    }

    deepToString(indent: string): string { return `${indent}TextTransform(${this.mTextId})`; }
    static read(buffer: WireBuffer, operations: Operation[]): void {
        const textId = buffer.readInt();
        const srcId = buffer.readInt();
        const start = buffer.readFloat();
        const len = buffer.readFloat();
        const operation = buffer.readInt();
        operations.push(new TextTransform(textId, srcId, start, len, operation));
    }
}
