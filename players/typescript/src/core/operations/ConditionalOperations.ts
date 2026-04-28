// ConditionalOperations: conditional execution of child operations.
// Fixed to extend PaintOperation (matching Java: extends PaintOperation implements Container, VariableSupport).

import { Operation } from '../Operation';
import { PaintOperation } from '../PaintOperation';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import type { PaintContext } from '../PaintContext';
import { idFromNan, listenFloat } from './Utils';

export class ConditionalOperations extends PaintOperation {
    static readonly OP_CODE = 178;
    static readonly TYPE_EQ = 0;
    static readonly TYPE_NEQ = 1;
    static readonly TYPE_LT = 2;
    static readonly TYPE_LTE = 3;
    static readonly TYPE_GT = 4;
    static readonly TYPE_GTE = 5;

    mList: Operation[] = [];
    private mType: number;
    private mVarA: number;
    private mVarB: number;
    private mVarAOut: number;
    private mVarBOut: number;

    constructor(type: number, a: number, b: number) {
        super();
        this.mType = type;
        this.mVarAOut = this.mVarA = a;
        this.mVarBOut = this.mVarB = b;
    }

    getList(): Operation[] { return this.mList; }
    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        listenFloat(this.mVarA, context, this);
        listenFloat(this.mVarB, context, this);
    }

    updateVariables(context: RemoteContext): void {
        this.markNotDirty();
        this.mVarAOut = Number.isNaN(this.mVarA) ? context.getFloat(idFromNan(this.mVarA)) : this.mVarA;
        this.mVarBOut = Number.isNaN(this.mVarB) ? context.getFloat(idFromNan(this.mVarB)) : this.mVarB;
        for (const op of this.mList) {
            if (op.isDirty() && typeof (op as any).updateVariables === 'function') {
                (op as any).updateVariables(context);
            }
        }
    }

    paint(paintContext: PaintContext): void {
        const context = paintContext.getContext();
        // Update dirty children's variables
        for (const op of this.mList) {
            if (op.isDirty() && typeof (op as any).updateVariables === 'function') {
                op.markNotDirty();
                (op as any).updateVariables(context);
            }
        }
        let run = false;
        switch (this.mType) {
            case ConditionalOperations.TYPE_EQ: run = this.mVarAOut === this.mVarBOut; break;
            case ConditionalOperations.TYPE_NEQ: run = this.mVarAOut !== this.mVarBOut; break;
            case ConditionalOperations.TYPE_LT: run = this.mVarAOut < this.mVarBOut; break;
            case ConditionalOperations.TYPE_LTE: run = this.mVarAOut <= this.mVarBOut; break;
            case ConditionalOperations.TYPE_GT: run = this.mVarAOut > this.mVarBOut; break;
            case ConditionalOperations.TYPE_GTE: run = this.mVarAOut >= this.mVarBOut; break;
        }
        if (run) {
            for (const op of this.mList) {
                context.incrementOpCount();
                if (op instanceof ConditionalOperations) {
                    op.paint(paintContext);
                } else {
                    op.apply(context);
                }
            }
        }
    }

    deepToString(indent: string): string { return `${indent}ConditionalOperations(type=${this.mType})`; }
    static read(buffer: WireBuffer, operations: Operation[]): void {
        const type = buffer.readByte();
        const a = buffer.readFloat();
        const b = buffer.readFloat();
        operations.push(new ConditionalOperations(type, a, b));
    }
}
