import { Operation } from '../Operation';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import { ContextMode } from '../RemoteContext';
import { idFromNan, isVariable } from './Utils';

export class PathAppend extends Operation {
    static readonly OP_CODE = 160;
    private mId: number;
    private mFloatPath: Float32Array;
    private mOutputPath: Float32Array;

    constructor(id: number, data: Float32Array) {
        super();
        this.mId = id;
        this.mFloatPath = data;
        this.mOutputPath = new Float32Array(data);
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        for (const v of this.mFloatPath) {
            if (isVariable(v) && Number.isNaN(v)) {
                context.listensTo(idFromNan(v), this);
            }
        }
    }

    updateVariables(context: RemoteContext): void {
        for (let i = 0; i < this.mFloatPath.length; i++) {
            const v = this.mFloatPath[i];
            if (isVariable(v)) {
                this.mOutputPath[i] = Number.isNaN(v) ? context.getFloat(idFromNan(v)) : v;
            } else {
                this.mOutputPath[i] = v;
            }
        }
    }

    apply(context: RemoteContext): void {
        if (context.mMode !== ContextMode.PAINT) return;
        const out = this.mOutputPath;
        if (out.length > 0 && PathAppend.isReset(out[0])) {
            context.loadPathData(this.mId, 0, new Float32Array(0));
            return;
        }
        const existing = context.getPathData(this.mId);
        if (existing && existing.length > 0) {
            const combined = new Float32Array(existing.length + out.length);
            combined.set(existing, 0);
            combined.set(out, existing.length);
            context.loadPathData(this.mId, 0, combined);
        } else {
            context.loadPathData(this.mId, 0, out);
        }
    }

    private static isReset(v: number): boolean {
        if (!Number.isNaN(v)) return false;
        return idFromNan(v) === 17;
    }

    deepToString(indent: string): string { return `${indent}PathAppend(${this.mId})`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const id = buffer.readInt();
        const len = buffer.readInt();
        const data = new Float32Array(len);
        for (let i = 0; i < len; i++) data[i] = buffer.readFloat();
        operations.push(new PathAppend(id, data));
    }
}
