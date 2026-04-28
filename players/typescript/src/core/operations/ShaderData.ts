// ShaderData: shader uniform data (float/int maps and bitmap refs).
// Matches Java ShaderData.java.

import { Operation } from '../Operation';
import type { WireBuffer } from '../WireBuffer';
import type { RemoteContext } from '../RemoteContext';
import type { VariableSupport } from '../VariableSupport';
import { idFromNan } from './Utils';

export class ShaderData extends Operation implements VariableSupport {
    static readonly OP_CODE = 45;
    private mShaderId: number;
    private mShaderTextId: number;
    private mUniformRawFloatMap: Map<string, Float32Array> | null;
    private mUniformFloatMap: Map<string, Float32Array> | null;
    private mIntMap: Map<string, Int32Array> | null;
    private mBitmapMap: Map<string, number> | null;
    private mShaderValid = false;

    constructor(shaderId: number, shaderTextId: number,
                floatMap: Map<string, Float32Array> | null,
                intMap: Map<string, Int32Array> | null,
                bitmapMap: Map<string, number> | null) {
        super();
        this.mShaderId = shaderId;
        this.mShaderTextId = shaderTextId;
        this.mIntMap = intMap;
        this.mBitmapMap = bitmapMap;
        if (floatMap) {
            this.mUniformRawFloatMap = new Map();
            this.mUniformFloatMap = new Map();
            for (const [name, values] of floatMap) {
                this.mUniformRawFloatMap.set(name, new Float32Array(values));
                this.mUniformFloatMap.set(name, new Float32Array(values));
            }
        } else {
            this.mUniformRawFloatMap = null;
            this.mUniformFloatMap = null;
        }
    }

    getShaderTextId(): number { return this.mShaderTextId; }

    getUniformFloatNames(): string[] {
        return this.mUniformFloatMap ? Array.from(this.mUniformFloatMap.keys()) : [];
    }

    getUniformFloats(name: string): Float32Array {
        return this.mUniformFloatMap?.get(name) ?? new Float32Array(0);
    }

    getUniformIntegerNames(): string[] {
        return this.mIntMap ? Array.from(this.mIntMap.keys()) : [];
    }

    getUniformInts(name: string): Int32Array {
        return this.mIntMap?.get(name) ?? new Int32Array(0);
    }

    getUniformBitmapNames(): string[] {
        return this.mBitmapMap ? Array.from(this.mBitmapMap.keys()) : [];
    }

    getUniformBitmapId(name: string): number {
        return this.mBitmapMap?.get(name) ?? -1;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    registerListening(context: RemoteContext): void {
        if (!this.mUniformRawFloatMap) return;
        for (const values of this.mUniformRawFloatMap.values()) {
            for (let i = 0; i < values.length; i++) {
                if (Number.isNaN(values[i])) {
                    context.listensTo(idFromNan(values[i]), this);
                }
            }
        }
    }

    updateVariables(context: RemoteContext): void {
        if (!this.mUniformRawFloatMap || !this.mUniformFloatMap) return;
        for (const [name, rawValues] of this.mUniformRawFloatMap) {
            let out: Float32Array | null = null;
            for (let i = 0; i < rawValues.length; i++) {
                if (Number.isNaN(rawValues[i])) {
                    const collectionsAccess = context.getCollectionsAccess();
                    let dynamicValues: Float32Array | null = null;
                    if (collectionsAccess) {
                        dynamicValues = collectionsAccess.getDynamicFloats(idFromNan(rawValues[i]));
                    }
                    if (!out) {
                        out = new Float32Array(rawValues);
                    }
                    if (!dynamicValues) {
                        out[i] = context.getFloat(idFromNan(rawValues[i]));
                    } else {
                        out[i] = rawValues[i];
                    }
                }
            }
            this.mUniformFloatMap.set(name, out ?? rawValues);
        }
    }

    markDirty(): void { /* inherited from Operation */ }

    enable(shaderValid: boolean): void {
        this.mShaderValid = shaderValid;
    }

    apply(context: RemoteContext): void {
        if (this.mShaderValid) {
            context.loadShader(this.mShaderId, this);
        }
    }

    deepToString(indent: string): string { return `${indent}ShaderData(${this.mShaderId})`; }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const shaderId = buffer.readInt();
        const shaderTextId = buffer.readInt();
        const sizes = buffer.readInt();
        const floatMapSize = sizes & 0xFF;
        const intMapSize = (sizes >> 8) & 0xFF;
        const bitmapMapSize = (sizes >> 16) & 0xFF;

        let floatMap: Map<string, Float32Array> | null = null;
        if (floatMapSize > 0) {
            floatMap = new Map();
            for (let i = 0; i < floatMapSize; i++) {
                const name = buffer.readUTF8();
                const len = buffer.readInt();
                const val = new Float32Array(len);
                for (let j = 0; j < len; j++) {
                    val[j] = buffer.readFloat();
                }
                floatMap.set(name, val);
            }
        }

        let intMap: Map<string, Int32Array> | null = null;
        if (intMapSize > 0) {
            intMap = new Map();
            for (let i = 0; i < intMapSize; i++) {
                const name = buffer.readUTF8();
                const len = buffer.readInt();
                const val = new Int32Array(len);
                for (let j = 0; j < len; j++) {
                    val[j] = buffer.readInt();
                }
                intMap.set(name, val);
            }
        }

        let bitmapMap: Map<string, number> | null = null;
        if (bitmapMapSize > 0) {
            bitmapMap = new Map();
            for (let i = 0; i < bitmapMapSize; i++) {
                const name = buffer.readUTF8();
                const val = buffer.readInt();
                bitmapMap.set(name, val);
            }
        }

        const sd = new ShaderData(shaderId, shaderTextId, floatMap, intMap, bitmapMap);
        sd.enable(true);  // Always enable — validation happens at transpile time
        operations.push(sd);
    }
}
