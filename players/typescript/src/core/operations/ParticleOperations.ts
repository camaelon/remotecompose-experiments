// ParticleOperations: particle system operations for RemoteCompose.
// Implements ParticlesCreateOp (161), ParticlesLoopOp (163), ParticlesCompareOp (194).

import { Operation } from '../Operation';
import { PaintOperation } from '../PaintOperation';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import { ContextMode } from '../RemoteContext';
import type { PaintContext } from '../PaintContext';
import type { VariableSupport } from '../VariableSupport';
import { idFromNan } from './Utils';
import { FloatExpression } from './FloatExpression';

// Constants matching FloatExpression
const OFFSET = 0x310000;
const ID_REGION_MASK = 0x700000;
const ID_REGION_ARRAY = 0x200000;

/** Check if a NaN-encoded value is a math operator */
function isMathOperator(v: number): boolean {
    if (!Number.isNaN(v)) return false;
    const id = idFromNan(v);
    return id > OFFSET && id <= OFFSET + 79;
}

/** Check if a NaN-encoded value is a data variable (array/collection) */
function isDataVariable(v: number): boolean {
    if (!Number.isNaN(v)) return false;
    const id = idFromNan(v);
    return (id & ID_REGION_MASK) === ID_REGION_ARRAY;
}

/**
 * Resolve variable references in an equation array.
 * Copies tokens, replacing variable NaN refs with their current float values from context.
 * Math operators and data variables are preserved as-is.
 */
function resolveEquation(src: Float32Array, context: RemoteContext): Float32Array {
    const out = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) {
        const v = src[i];
        if (Number.isNaN(v) && !isMathOperator(v) && !isDataVariable(v)) {
            out[i] = context.getFloat(idFromNan(v));
        } else {
            out[i] = v;
        }
    }
    return out;
}

/**
 * Register variable dependencies from an equation array.
 */
function registerEquationListening(eq: Float32Array, context: RemoteContext, op: VariableSupport): void {
    for (let i = 0; i < eq.length; i++) {
        const v = eq[i];
        if (Number.isNaN(v) && !isMathOperator(v) && !isDataVariable(v)) {
            context.listensTo(idFromNan(v), op);
        }
    }
}

// ── ParticlesCreateOp (161) ────────────────────────────────────────────
export class ParticlesCreateOp extends Operation implements VariableSupport {
    static readonly OP_CODE = 161;

    mId: number;
    private mParticleCount: number;
    private mVarId: number[];
    private mEquations: Float32Array[];
    private mOutEquations: Float32Array[];
    private mParticles: number[][];
    private mInitialized = false;
    private mContext: RemoteContext | null = null;

    constructor(id: number, particleCount: number, varId: number[], equations: Float32Array[]) {
        super();
        this.mId = id;
        this.mParticleCount = particleCount;
        this.mVarId = varId;
        this.mEquations = equations;
        this.mOutEquations = equations.map(eq => new Float32Array(eq));
        this.mParticles = [];
        for (let i = 0; i < particleCount; i++) {
            this.mParticles.push(new Array(varId.length).fill(0));
        }
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        context.putObject(this.mId, this);
        for (const eq of this.mEquations) {
            registerEquationListening(eq, context, this);
        }
    }

    updateVariables(context: RemoteContext): void {
        this.mContext = context;
        for (let j = 0; j < this.mEquations.length; j++) {
            this.mOutEquations[j] = resolveEquation(this.mEquations[j], context);
        }
    }

    apply(context: RemoteContext): void {
        if (context.mMode === ContextMode.PAINT && !this.mInitialized) {
            this.mContext = context;
            for (let i = 0; i < this.mParticleCount; i++) {
                this.initializeParticle(i, context);
            }
            this.mInitialized = true;
        }
    }

    initializeParticle(i: number, context: RemoteContext): void {
        const varCount = this.mVarId.length;
        for (let j = 0; j < varCount; j++) {
            this.mParticles[i][j] = FloatExpression.evalRPN(
                context, this.mOutEquations[j], [i, 0, 0]
            );
        }
    }

    getParticles(): number[][] { return this.mParticles; }
    getVariableIds(): number[] { return this.mVarId; }

    deepToString(indent: string): string {
        return `${indent}ParticlesCreateOp(id=${this.mId}, count=${this.mParticleCount}, vars=${this.mVarId.length})`;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const id = buffer.readInt();
        const particleCount = buffer.readInt();
        const varLen = buffer.readInt();
        const varIds: number[] = [];
        const equations: Float32Array[] = [];
        for (let i = 0; i < varLen; i++) {
            varIds.push(buffer.readInt());
            const equLen = buffer.readInt();
            const eq = new Float32Array(equLen);
            for (let j = 0; j < equLen; j++) eq[j] = buffer.readFloat();
            equations.push(eq);
        }
        operations.push(new ParticlesCreateOp(id, particleCount, varIds, equations));
    }
}

// ── ParticlesLoopOp (163) ──────────────────────────────────────────────
export class ParticlesLoopOp extends PaintOperation implements VariableSupport {
    static readonly OP_CODE = 163;

    private mId: number;
    private mRestart: Float32Array;
    private mOutRestart: Float32Array;
    private mEquations: Float32Array[];
    private mOutEquations: Float32Array[];
    mList: Operation[] = [];
    private mSource: ParticlesCreateOp | null = null;

    constructor(id: number, restart: Float32Array, equations: Float32Array[]) {
        super();
        this.mId = id;
        this.mRestart = restart;
        this.mOutRestart = new Float32Array(restart);
        this.mEquations = equations;
        this.mOutEquations = equations.map(eq => new Float32Array(eq));
    }

    getList(): Operation[] { return this.mList; }

    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        registerEquationListening(this.mRestart, context, this);
        for (const eq of this.mEquations) {
            registerEquationListening(eq, context, this);
        }
    }

    updateVariables(context: RemoteContext): void {
        this.mOutRestart = resolveEquation(this.mRestart, context);
        for (let j = 0; j < this.mEquations.length; j++) {
            this.mOutEquations[j] = resolveEquation(this.mEquations[j], context);
        }
    }

    paint(paintContext: PaintContext): void {
        const context = paintContext.getContext();
        if (context.mMode !== ContextMode.PAINT) return;

        // Resolve source ParticlesCreateOp
        if (!this.mSource) {
            const obj = context.getObject(this.mId);
            if (obj instanceof ParticlesCreateOp) {
                this.mSource = obj;
            } else {
                return;
            }
        }

        const source = this.mSource;
        const particles = source.getParticles();
        const varIds = source.getVariableIds();
        const varCount = varIds.length;

        for (let i = 0; i < particles.length; i++) {
            // Load particle variable values into context
            for (let j = 0; j < varCount; j++) {
                context.loadFloat(varIds[j], particles[i][j]);
            }

            // Re-resolve equations with current particle var values loaded
            this.updateVariables(context);

            // Evaluate update equations
            for (let j = 0; j < this.mOutEquations.length && j < varCount; j++) {
                particles[i][j] = FloatExpression.evalRPN(context, this.mOutEquations[j]);
                context.loadFloat(varIds[j], particles[i][j]);
            }

            // Check restart condition
            const restartVal = FloatExpression.evalRPN(context, this.mOutRestart);
            if (restartVal > 0) {
                source.initializeParticle(i, context);
                // Reload initialized values and re-run updates so derived
                // variables (e.g. tail position) are consistent with the
                // new birth position — avoids stray lines on restart frame
                for (let j = 0; j < varCount; j++) {
                    context.loadFloat(varIds[j], particles[i][j]);
                }
                this.updateVariables(context);
                for (let j = 0; j < this.mOutEquations.length && j < varCount; j++) {
                    particles[i][j] = FloatExpression.evalRPN(context, this.mOutEquations[j]);
                    context.loadFloat(varIds[j], particles[i][j]);
                }
            }

            // Execute child operations
            for (const child of this.mList) {
                if (child.isDirty() && typeof (child as any).updateVariables === 'function') {
                    child.markNotDirty();
                    (child as any).updateVariables(context);
                }
                context.incrementOpCount();
                child.apply(context);
            }
        }

        context.needsRepaint();
    }

    deepToString(indent: string): string {
        return `${indent}ParticlesLoopOp(id=${this.mId}, children=${this.mList.length})`;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const id = buffer.readInt();
        const restartLen = buffer.readInt();
        const restart = new Float32Array(restartLen);
        for (let i = 0; i < restartLen; i++) restart[i] = buffer.readFloat();
        const varLen = buffer.readInt();
        const equations: Float32Array[] = [];
        for (let i = 0; i < varLen; i++) {
            const equLen = buffer.readInt();
            const eq = new Float32Array(equLen);
            for (let j = 0; j < equLen; j++) eq[j] = buffer.readFloat();
            equations.push(eq);
        }
        operations.push(new ParticlesLoopOp(id, restart, equations));
    }
}

// ── ParticlesCompareOp (194) ───────────────────────────────────────────
export class ParticlesCompareOp extends PaintOperation implements VariableSupport {
    static readonly OP_CODE = 194;

    private mId: number;
    private mFlags: number;
    private mMin: number;
    private mMax: number;
    private mCondition: Float32Array;
    private mOutCondition: Float32Array;
    private mEquations1: Float32Array[];
    private mOutEquations1: Float32Array[];
    private mEquations2: Float32Array[];
    mList: Operation[] = [];
    private mSource: ParticlesCreateOp | null = null;

    constructor(
        id: number, flags: number, min: number, max: number,
        condition: Float32Array, equations1: Float32Array[], equations2: Float32Array[]
    ) {
        super();
        this.mId = id;
        this.mFlags = flags;
        this.mMin = min;
        this.mMax = max;
        this.mCondition = condition;
        this.mOutCondition = new Float32Array(condition);
        this.mEquations1 = equations1;
        this.mOutEquations1 = equations1.map(eq => new Float32Array(eq));
        this.mEquations2 = equations2;
    }

    getList(): Operation[] { return this.mList; }

    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        registerEquationListening(this.mCondition, context, this);
        for (const eq of this.mEquations1) {
            registerEquationListening(eq, context, this);
        }
        for (const eq of this.mEquations2) {
            registerEquationListening(eq, context, this);
        }
    }

    updateVariables(context: RemoteContext): void {
        this.mOutCondition = resolveEquation(this.mCondition, context);
        for (let j = 0; j < this.mEquations1.length; j++) {
            this.mOutEquations1[j] = resolveEquation(this.mEquations1[j], context);
        }
    }

    paint(paintContext: PaintContext): void {
        const context = paintContext.getContext();
        if (context.mMode !== ContextMode.PAINT) return;

        // Resolve source ParticlesCreateOp
        if (!this.mSource) {
            const obj = context.getObject(this.mId);
            if (obj instanceof ParticlesCreateOp) {
                this.mSource = obj;
            } else {
                return;
            }
        }

        const source = this.mSource;
        const particles = source.getParticles();
        const varIds = source.getVariableIds();
        const varCount = varIds.length;

        const startIdx = this.mMin < 0 ? 0 : Math.min(this.mMin, particles.length);
        const endIdx = this.mMax < 0 ? particles.length : Math.min(this.mMax, particles.length);

        for (let i = startIdx; i < endIdx; i++) {
            // Load particle variable values into context
            for (let j = 0; j < varCount; j++) {
                context.loadFloat(varIds[j], particles[i][j]);
            }

            // Re-resolve equations with current particle var values loaded
            this.updateVariables(context);

            // Evaluate condition
            const condVal = FloatExpression.evalRPN(context, this.mOutCondition);
            if (condVal > 0) {
                // Apply equations1 to update particle variables
                for (let j = 0; j < this.mOutEquations1.length && j < varCount; j++) {
                    particles[i][j] = FloatExpression.evalRPN(context, this.mOutEquations1[j]);
                    context.loadFloat(varIds[j], particles[i][j]);
                }

                // Execute child operations
                for (const child of this.mList) {
                    if (child.isDirty() && typeof (child as any).updateVariables === 'function') {
                        child.markNotDirty();
                        (child as any).updateVariables(context);
                    }
                    context.incrementOpCount();
                    child.apply(context);
                }
            }
        }

        context.needsRepaint();
    }

    deepToString(indent: string): string {
        return `${indent}ParticlesCompareOp(id=${this.mId}, flags=${this.mFlags})`;
    }

    private static readFloats(buffer: WireBuffer): Float32Array {
        const len = buffer.readInt();
        const arr = new Float32Array(len);
        for (let i = 0; i < len; i++) arr[i] = buffer.readFloat();
        return arr;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const id = buffer.readInt();
        const flags = buffer.readShort();
        const min = buffer.readFloat();
        const max = buffer.readFloat();
        const condition = ParticlesCompareOp.readFloats(buffer);
        const result1Len = buffer.readInt();
        const equations1: Float32Array[] = [];
        for (let i = 0; i < result1Len; i++) {
            equations1.push(ParticlesCompareOp.readFloats(buffer));
        }
        const result2Len = buffer.readInt();
        const equations2: Float32Array[] = [];
        for (let i = 0; i < result2Len; i++) {
            equations2.push(ParticlesCompareOp.readFloats(buffer));
        }
        operations.push(new ParticlesCompareOp(id, flags, min, max, condition, equations1, equations2));
    }
}
