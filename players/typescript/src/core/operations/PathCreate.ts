import { Operation } from '../Operation';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import { ContextMode } from '../RemoteContext';
import { asNan, idFromNan, isVariable } from './Utils';

export class PathCreate extends Operation {
    static readonly OP_CODE = 159;
    private static readonly MOVE_NAN = asNan(10);
    private mId: number;
    private mFloatPath: Float32Array;
    private mOutputPath: Float32Array;

    constructor(id: number, startX: number, startY: number) {
        super();
        this.mId = id;
        this.mFloatPath = new Float32Array([PathCreate.MOVE_NAN, startX, startY]);
        this.mOutputPath = new Float32Array(this.mFloatPath);
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
        context.loadPathData(this.mId, 0, this.mOutputPath);
    }

    deepToString(indent: string): string { return `${indent}PathCreate(${this.mId})`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const id = buffer.readInt();
        const startX = buffer.readFloat();
        const startY = buffer.readFloat();
        operations.push(new PathCreate(id, startX, startY));
    }
}
