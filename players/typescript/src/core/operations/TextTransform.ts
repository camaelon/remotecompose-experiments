// TextTransform: case conversion / trimming of a (sub)range of a text variable.
// Port of TextTransform.java (opcode 199). start/len may be NaN-id variables, resolved in
// updateVariables; len == -1 means "to the end of the string" (the reference's contract —
// the old port did substring(start, start - 1) and loaded an empty string).

import { Operation } from '../Operation';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import type { VariableSupport } from '../VariableSupport';
import { isNaNBits, idFromBits, intBitsToFloat } from './Utils';

const isWs = (c: string) => /\s/.test(c);

export class TextTransform extends Operation implements VariableSupport {
    static readonly OP_CODE = 199;
    static readonly TEXT_TO_LOWERCASE = 1;
    static readonly TEXT_TO_UPPERCASE = 2;
    static readonly TEXT_TRIM = 3;
    static readonly TEXT_CAPITALIZE = 4;
    static readonly TEXT_UPPERCASE_FIRST_CHAR = 5;

    mTextId: number;
    mSrcId1: number;
    /** start/len as raw float32 bits (a NaN id when they are variables). */
    mStartBits: number;
    mLenBits: number;
    mOutStart: number;
    mOutLen: number;
    mOperation: number;

    constructor(textId: number, srcId: number, startBits: number, lenBits: number, operation: number) {
        super();
        this.mTextId = textId; this.mSrcId1 = srcId;
        this.mStartBits = startBits; this.mLenBits = lenBits; this.mOperation = operation;
        this.mOutStart = isNaNBits(startBits) ? 0 : intBitsToFloat(startBits);
        this.mOutLen = isNaNBits(lenBits) ? -1 : intBitsToFloat(lenBits);
    }

    write(buffer: WireBuffer): void {
        buffer.start(TextTransform.OP_CODE);
        buffer.writeInt(this.mTextId);
        buffer.writeInt(this.mSrcId1);
        buffer.writeInt(this.mStartBits);
        buffer.writeInt(this.mLenBits);
        buffer.writeInt(this.mOperation);
    }

    registerListening(context: RemoteContext): void {
        context.listensTo(this.mSrcId1, this);
        if (isNaNBits(this.mStartBits)) context.listensTo(idFromBits(this.mStartBits), this);
        if (isNaNBits(this.mLenBits)) context.listensTo(idFromBits(this.mLenBits), this);
    }

    updateVariables(context: RemoteContext): void {
        if (isNaNBits(this.mStartBits)) this.mOutStart = context.getFloat(idFromBits(this.mStartBits));
        if (isNaNBits(this.mLenBits)) this.mOutLen = context.getFloat(idFromBits(this.mLenBits));
    }

    apply(context: RemoteContext): void {
        const str = context.getText(this.mSrcId1) || '';
        const s = Math.max(0, Math.min(Math.trunc(this.mOutStart), str.length));
        let text = this.mOutLen === -1
            ? str.substring(s)
            : str.substring(s, Math.min(str.length, s + Math.trunc(this.mOutLen)));
        switch (this.mOperation) {
            case TextTransform.TEXT_TO_LOWERCASE: text = text.toLowerCase(); break;
            case TextTransform.TEXT_TO_UPPERCASE: text = text.toUpperCase(); break;
            case TextTransform.TEXT_TRIM: text = text.trim(); break;
            case TextTransform.TEXT_CAPITALIZE: text = TextTransform.capitalizeWords(text); break;
            case TextTransform.TEXT_UPPERCASE_FIRST_CHAR: text = TextTransform.capitalizeFirstWord(text); break;
        }
        context.loadText(this.mTextId, text);
    }

    /** Title-case the first letter of every whitespace-separated word (capitalizeWords). */
    private static capitalizeWords(input: string): string {
        let out = '';
        let nextIsUpper = true;
        for (const c of input) {
            if (isWs(c)) { nextIsUpper = true; out += c; }
            else if (nextIsUpper) { out += c.toUpperCase(); nextIsUpper = false; }
            else out += c;
        }
        return out;
    }

    /** Title-case the first non-whitespace character (capitalizeFirstWord). */
    private static capitalizeFirstWord(input: string): string {
        for (let i = 0; i < input.length; i++) {
            if (!isWs(input[i])) return input.substring(0, i) + input[i].toUpperCase() + input.substring(i + 1);
        }
        return input;
    }

    deepToString(indent: string): string {
        return `${indent}TextTransform[${this.mTextId}] = [${this.mSrcId1}] ${this.mOutStart} - ${this.mOutLen} ${this.mOperation}`;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const textId = buffer.declareId();
        const srcId = buffer.readId();
        const start = buffer.readNanIdBits();
        const len = buffer.readNanIdBits();
        const operation = buffer.readInt();
        operations.push(new TextTransform(textId, srcId, start, len, operation));
    }
}
