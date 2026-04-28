import { Operation } from '../Operation';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import { idFromNan, listenFloat } from './Utils';
import { Matrix } from './utilities/Matrix';

export class MatrixVectorMath extends Operation {
    static readonly OP_CODE = 188;
    private mType: number;
    mMatrixId: number;
    private mOutputs: Int32Array;
    private mInputs: Float32Array;
    private mOutInputs: Float32Array;
    private mTempOut: Float32Array;
    private mMatrix = new Matrix();

    constructor(type: number, outputs: Int32Array, matrixId: number, inputs: Float32Array) {
        super();
        this.mType = type;
        this.mMatrixId = matrixId;
        this.mOutputs = outputs;
        this.mOutInputs = new Float32Array(inputs.length);
        this.mInputs = inputs;
        this.mTempOut = new Float32Array(outputs.length);
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        context.listensTo(this.mMatrixId, this);
        for (const v of this.mInputs) {
            listenFloat(v, context, this);
        }
    }

    updateVariables(context: RemoteContext): void {
        for (let i = 0; i < this.mInputs.length; i++) {
            const v = this.mInputs[i];
            if (Number.isNaN(v)) {
                this.mOutInputs[i] = context.getFloat(idFromNan(v));
            } else {
                this.mOutInputs[i] = v;
            }
        }
    }

    apply(context: RemoteContext): void {
        const obj = context.getObject(this.mMatrixId) as any;
        if (!obj) return;
        const values = obj.getValues ? obj.getValues() : obj.mValues;
        if (!values) return;
        this.mMatrix.copyFrom(values);
        if (this.mType === 0) {
            this.mMatrix.multiplyVec(this.mOutInputs, this.mTempOut);
        } else {
            this.mMatrix.evalPerspective(this.mOutInputs, this.mTempOut);
        }
        for (let i = 0; i < this.mOutputs.length; i++) {
            context.loadFloat(this.mOutputs[i], this.mTempOut[i]);
        }
    }

    deepToString(indent: string): string { return `${indent}MatrixVectorMath(matrix=${this.mMatrixId})`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const type = buffer.readShort();
        const matrixId = buffer.readInt();
        const lenOut = buffer.readInt();
        if (lenOut > 4 || lenOut < 1) throw new Error(`Invalid output length ${lenOut}`);
        const out = new Int32Array(lenOut);
        for (let i = 0; i < lenOut; i++) out[i] = buffer.readInt();
        const lenIn = buffer.readInt();
        if (lenIn > 4 || lenIn < 1) throw new Error(`Invalid input length ${lenIn}`);
        const inputs = new Float32Array(lenIn);
        for (let i = 0; i < lenIn; i++) inputs[i] = buffer.readFloat();
        operations.push(new MatrixVectorMath(type, out, matrixId, inputs));
    }
}
