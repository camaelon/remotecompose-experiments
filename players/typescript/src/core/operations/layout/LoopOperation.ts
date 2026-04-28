// LoopOperation: repeats child operations for a range of values.
// Binary: [indexId:INT] [from:FLOAT] [step:FLOAT] [until:FLOAT]
// Container: children follow, terminated by ContainerEnd.

import { Operation } from '../../Operation';
import type { WireBuffer } from '../../WireBuffer';
import type { RemoteContext } from '../../RemoteContext';
import { ContextMode } from '../../RemoteContext';
import { idFromNan } from '../Utils';

export class LoopOperation extends Operation {
    static readonly OP_CODE = 215;

    private mIndexId: number;
    private mFrom: number;
    private mStep: number;
    private mUntil: number;
    private mList: Operation[] = [];

    constructor(indexId: number, from: number, step: number, until: number) {
        super();
        this.mIndexId = indexId; this.mFrom = from;
        this.mStep = step; this.mUntil = until;
    }

    getList(): Operation[] { return this.mList; }

    write(_buffer: WireBuffer): void { /* stub */ }

    apply(context: RemoteContext): void {
        if (context.mMode === ContextMode.DATA) {
            // During data pass, just apply children once to register variables
            for (const op of this.mList) {
                op.apply(context);
            }
            return;
        }

        const from = this.rv(this.mFrom, context);
        const step = this.rv(this.mStep, context);
        const until = this.rv(this.mUntil, context);

        if (step <= 0 || !isFinite(from) || !isFinite(until) || !isFinite(step)) return;

        if (this.mIndexId === 0) {
            for (let i = from; i < until; i += step) {
                for (const op of this.mList) {
                    context.incrementOpCount();
                    op.apply(context);
                }
            }
        } else {
            for (let i = from; i < until; i += step) {
                context.loadFloat(this.mIndexId, i);
                for (const op of this.mList) {
                    // Re-evaluate expressions that depend on the loop variable
                    if (typeof (op as any).updateVariables === 'function') {
                        (op as any).updateVariables(context);
                    }
                    context.incrementOpCount();
                    op.apply(context);
                }
            }
        }
    }

    private rv(v: number, ctx: RemoteContext): number {
        return Number.isNaN(v) ? ctx.getFloat(idFromNan(v)) : v;
    }

    deepToString(indent: string): string {
        return `${indent}LoopOperation(${this.mFrom}..${this.mUntil} step ${this.mStep})`;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const indexId = buffer.readInt();
        const from = buffer.readFloat();
        const step = buffer.readFloat();
        const until = buffer.readFloat();
        operations.push(new LoopOperation(indexId, from, step, until));
    }
}
