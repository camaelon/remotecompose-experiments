// SoundOperations: sound data, sound expression, and play-sound operations.
// Parse-only tier: read() must consume the exact bytes; apply() is a no-op for now.

import { Operation } from '../Operation';
import type { WireBuffer } from '../WireBuffer';
import { ContextMode, type RemoteContext } from '../RemoteContext';
import { idFromBits, intBitsToFloat, isNaNBits } from './Utils';
import type { VariableSupport } from '../VariableSupport';
import { ToneSynthesizer } from './utilities/ToneSynthesizer';

export class SoundData extends Operation {
    static readonly OP_CODE = 169;
    private mSoundId: number;
    private mData: Uint8Array;

    constructor(soundId: number, data: Uint8Array) {
        super(); this.mSoundId = soundId; this.mData = data;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    apply(context: RemoteContext): void { context.loadSound(this.mSoundId, this.mData); }

    deepToString(indent: string): string { return `${indent}SoundData(${this.mSoundId}, ${this.mData.length} bytes)`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const soundId = buffer.readId();
        const data = buffer.readBuffer();
        operations.push(new SoundData(soundId, data));
    }
}

/**
 * A NaN-encoded variable reference, as the reference's Utils.isVariable: not id 0, and not the
 * 10..40 range the synthesis type tags (TYPE_TONE = 10) live in.
 */
function isSoundVariable(bits: number): boolean {
    if (!isNaNBits(bits)) return false;
    const id = idFromBits(bits);
    return id !== 0 && (id > 40 || id < 10);
}

export class SoundExpression extends Operation implements VariableSupport {
    static readonly OP_CODE = 206;
    private static readonly MAX_PARAMS = 64;

    private mId: number;
    // Raw bits throughout: a NaN-encoded variable id does not survive becoming a JS number.
    private mLeftVolume: number;
    private mRightVolume: number;
    private mRate: number;
    /** mParams[0] is a NaN-boxed type id, the rest literals or NaN-encoded variable references. */
    private mParams: Int32Array;
    /** The params with variables resolved (the reference's mOutputParams). */
    private mOut: Float32Array;
    /** The resolved inputs last synthesized, so an unchanged sound is not rebuilt. */
    private mLastKey = "";

    constructor(id: number, leftVolume: number, rightVolume: number, rate: number, params: Int32Array) {
        super();
        this.mId = id; this.mLeftVolume = leftVolume; this.mRightVolume = rightVolume;
        this.mRate = rate; this.mParams = params;
        this.mOut = new Float32Array(params.length);
        for (let i = 0; i < params.length; i++) this.mOut[i] = intBitsToFloat(params[i]);
    }

    static readonly TYPE_TONE = 10;

    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        for (let i = 1; i < this.mParams.length; i++) {
            if (isSoundVariable(this.mParams[i])) context.listensTo(idFromBits(this.mParams[i]), this);
        }
        for (const b of [this.mLeftVolume, this.mRightVolume, this.mRate]) {
            if (isSoundVariable(b)) context.listensTo(idFromBits(b), this);
        }
    }

    updateVariables(context: RemoteContext): void {
        for (let i = 1; i < this.mParams.length; i++) {
            const b = this.mParams[i];
            this.mOut[i] = isSoundVariable(b) ? context.getFloat(idFromBits(b)) : intBitsToFloat(b);
        }
    }

    apply(context: RemoteContext): void {
        if (this.mParams.length === 0) return;
        // As the reference: the variables are resolved first, so a frequency bound to a
        // variable (a slider, a key) is synthesized at its current value.
        this.updateVariables(context);
        const typeId = idFromBits(this.mParams[0]);
        if (typeId === SoundExpression.TYPE_TONE && this.mParams.length >= 4) {
            const key = `${this.mOut[1]}|${this.mOut[2]}|${this.mOut[3]}`;
            if (key === this.mLastKey) return;
            this.mLastKey = key;
            const wav = ToneSynthesizer.synthesizeWav(this.mOut[1], this.mOut[2], this.mOut[3]);
            context.loadSound(this.mId, wav);
        }
    }

    deepToString(indent: string): string { return `${indent}SoundExpression(${this.mId})`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const id = buffer.readId();
        const leftVolume = buffer.readInt();
        const rightVolume = buffer.readInt();
        const rate = buffer.readInt();
        const len = buffer.readInt();
        if (len > SoundExpression.MAX_PARAMS) {
            throw new Error(`SoundExpression: too many params ${len} > ${SoundExpression.MAX_PARAMS}`);
        }
        const params = new Int32Array(len);
        for (let i = 0; i < len; i++) {
            params[i] = buffer.readInt();
        }
        operations.push(new SoundExpression(id, leftVolume, rightVolume, rate, params));
    }
}

export class PlaySound extends Operation {
    static readonly OP_CODE = 141;
    private mSoundExpressionId: number;

    constructor(soundExpressionId: number) {
        super(); this.mSoundExpressionId = soundExpressionId;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    apply(context: RemoteContext): void {
        // The data pass applies every operation, a conditional's included, once at load: a
        // sound there would play whether or not its condition holds. Play only when painting.
        // (The reference has no such check: CoreDocument.applyOperations reaches it too.)
        if (context.getMode() === ContextMode.DATA) return;
        context.playSound(this.mSoundExpressionId);
    }

    deepToString(indent: string): string { return `${indent}PlaySound(${this.mSoundExpressionId})`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new PlaySound(buffer.readId()));
    }
}
