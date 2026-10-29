// Float functions: FUNCTION_DEFINE (168) and FUNCTION_CALL (166).
// Port of FloatFunctionDefine.java / FloatFunctionCall.java (remote-core).
//
// A define is a Container: its body (up to the matching ContainerEnd) is a list of ordinary
// operations, usually FloatExpressions, that read the parameter variables mFloatVarId and
// write variables declared outside the function — that is how a function "returns". The
// define registers itself as an object under its id; it does nothing when applied (the
// document's data pass still walks the body once, as the reference's applyOperations does).
//
// A call is a PaintOperation: when painted it loads each resolved argument into the
// matching parameter variable, then runs the body in order (updateVariables + apply on
// each op). Because it runs inline in the paint list, two calls with different arguments
// give the ops between them different results within one frame.

import { Operation } from '../Operation';
import { PaintOperation } from '../PaintOperation';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import type { PaintContext } from '../PaintContext';
import type { VariableSupport } from '../VariableSupport';
import { idFromBits, intBitsToFloat, isNaNBits } from './Utils';

const OFFSET = 0x310000;            // math operator ids (AnimatedFloatExpression.OFFSET)
const ID_REGION_MASK = 0x700000;
const ID_REGION_ARRAY = 0x200000;   // data variables (NanMap.isDataVariable)
const MAX_FLOAT_ARRAY_SIZE = 80;
const MAX_FUNCTION_ARGUMENTS = 32;

/** A NaN id naming a plain float variable (not an operator token, not an array). */
function isVariableBits(b: number): boolean {
    if (!isNaNBits(b)) return false;
    const id = idFromBits(b);
    if (id > OFFSET && id <= OFFSET + 79) return false;
    return (id & ID_REGION_MASK) !== ID_REGION_ARRAY;
}

function hasUpdateVariables(op: Operation): op is Operation & VariableSupport {
    return typeof (op as any).updateVariables === 'function';
}

export class FloatFunctionDefine extends Operation implements VariableSupport {
    static readonly OP_CODE = 168;
    private static readonly MAX_EXECUTION_DEPTH = 16;
    mId: number;
    /** The parameter variables, in argument order. */
    mFloatVarId: number[];
    mList: Operation[] = [];
    private mExecutionDepth = 0;

    constructor(id: number, floatVarId: number[]) {
        super();
        this.mId = id;
        this.mFloatVarId = floatVarId;
    }

    getList(): Operation[] { return this.mList; }
    getArgs(): number[] { return this.mFloatVarId; }

    updateVariables(_context: RemoteContext): void { /* nothing to resolve */ }

    registerListening(context: RemoteContext): void {
        context.putObject(this.mId, this);
    }

    apply(_context: RemoteContext): void { /* the body runs only from a call */ }

    /** Run the body (FloatFunctionDefine.execute). */
    execute(context: RemoteContext): void {
        if (this.mExecutionDepth >= FloatFunctionDefine.MAX_EXECUTION_DEPTH) {
            throw new Error('Recursion not allowed');
        }
        this.mExecutionDepth++;
        try {
            for (const op of this.mList) {
                if (hasUpdateVariables(op)) op.updateVariables(context);
                context.incrementOpCount(op);
                op.apply(context);
            }
        } finally {
            this.mExecutionDepth--;
        }
    }

    write(buffer: WireBuffer): void {
        buffer.start(FloatFunctionDefine.OP_CODE);
        buffer.writeInt(this.mId);
        buffer.writeInt(this.mFloatVarId.length);
        for (const v of this.mFloatVarId) buffer.writeInt(v);
    }

    deepToString(indent: string): string {
        let s = `${indent}FloatFunctionDefine[${this.mId}] (${this.mFloatVarId.map(v => `[${v}]`).join(' ')})`;
        for (const op of this.mList) s += '\n' + op.deepToString(indent + '  ');
        return s;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const id = buffer.readId();
        const varLen = buffer.readInt();
        if (varLen > MAX_FUNCTION_ARGUMENTS) throw new Error('Too many arguments');
        const varId: number[] = [];
        for (let i = 0; i < varLen; i++) varId.push(buffer.readId());
        operations.push(new FloatFunctionDefine(id, varId));
    }
}

export class FloatFunctionCall extends PaintOperation implements VariableSupport {
    static readonly OP_CODE = 166;
    /** The function's id (its FloatFunctionDefine registers under it). */
    mId: number;
    /** Arguments as raw float bits (NaN ids for variable arguments). */
    mArgs: Int32Array;
    mOutArgs: Float32Array;
    mFunction: FloatFunctionDefine | null = null;

    constructor(id: number, args: Int32Array) {
        super();
        this.mId = id;
        this.mArgs = args;
        this.mOutArgs = new Float32Array(args.length);
        for (let i = 0; i < args.length; i++) this.mOutArgs[i] = intBitsToFloat(args[i]);
    }

    updateVariables(context: RemoteContext): void {
        for (let i = 0; i < this.mArgs.length; i++) {
            const b = this.mArgs[i];
            this.mOutArgs[i] = isVariableBits(b) ? context.getFloat(idFromBits(b)) : intBitsToFloat(b);
        }
    }

    registerListening(context: RemoteContext): void {
        const f = context.getObject(this.mId);
        this.mFunction = f instanceof FloatFunctionDefine ? f : null;
        for (const b of this.mArgs) {
            if (isVariableBits(b)) context.listensTo(idFromBits(b), this);
        }
    }

    paint(context: PaintContext): void {
        const remote = context.getContext();
        if (!this.mFunction) {
            // A call registered before its define (or a missing define): look it up now.
            const f = remote.getObject(this.mId);
            if (!(f instanceof FloatFunctionDefine)) return;
            this.mFunction = f;
        }
        const params = this.mFunction.getArgs();
        this.updateVariables(remote);
        const n = Math.min(params.length, this.mOutArgs.length);
        for (let j = 0; j < n; j++) remote.loadFloat(params[j], this.mOutArgs[j]);
        this.mFunction.execute(remote);
    }

    write(buffer: WireBuffer): void {
        buffer.start(FloatFunctionCall.OP_CODE);
        buffer.writeInt(this.mId);
        buffer.writeInt(this.mArgs.length);
        for (const b of this.mArgs) buffer.writeInt(b);
    }

    deepToString(indent: string): string {
        return `${indent}callFunction[${this.mId}] ${Array.from(this.mOutArgs).join(', ')}`;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const id = buffer.readId();
        const argLen = buffer.readInt();
        if (argLen > MAX_FLOAT_ARRAY_SIZE) throw new Error(`array too big ${argLen}`);
        const args = new Int32Array(argLen);
        for (let i = 0; i < argLen; i++) args[i] = buffer.readNanIdBits();
        operations.push(new FloatFunctionCall(id, args));
    }
}
