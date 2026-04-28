import { Operation } from '../Operation';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import { idFromNan } from './Utils';
import { MatrixOperations } from './utilities/MatrixOperations';

export class MatrixExpression extends Operation {
    static readonly OP_CODE = 187;
    private mMatrixId: number;
    private mType: number;
    private mValues = new Float32Array(16);
    private mExpression: Float32Array;
    private mOutExpression: Float32Array | null = null;
    private mMatrixOperations = new MatrixOperations();

    constructor(matrixId: number, type: number, expression: Float32Array) {
        super();
        this.mMatrixId = matrixId;
        this.mType = type;
        this.mExpression = expression;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        for (const v of this.mExpression) {
            if (Number.isNaN(v) && !MatrixOperations.isOperator(v)) {
                context.listensTo(idFromNan(v), this);
            }
        }
    }

    updateVariables(context: RemoteContext): void {
        if (this.mOutExpression === null || this.mOutExpression.length !== this.mExpression.length) {
            this.mOutExpression = new Float32Array(this.mExpression.length);
        }
        for (let i = 0; i < this.mExpression.length; i++) {
            const v = this.mExpression[i];
            if (Number.isNaN(v) && !MatrixOperations.isOperator(v)) {
                this.mOutExpression[i] = context.getFloat(idFromNan(v));
            } else {
                this.mOutExpression[i] = v;
            }
        }
    }

    apply(context: RemoteContext): void {
        const m = this.mMatrixOperations.eval(this.mOutExpression);
        m.putValues(this.mValues);
        context.putObject(this.mMatrixId, this);
        context.loadFloat(this.mMatrixId, performance.now() * 1e6);
    }

    getValues(): Float32Array { return this.mValues; }

    deepToString(indent: string): string { return `${indent}MatrixExpression(${this.mMatrixId})`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const id = buffer.readInt();
        const type = buffer.readInt();
        const len = buffer.readInt();
        if (len > 32 || len < 0) throw new Error(`Invalid matrix expression length ${len}`);
        const exp = new Float32Array(len);
        for (let i = 0; i < len; i++) exp[i] = buffer.readFloat();
        operations.push(new MatrixExpression(id, type, exp));
    }
}
