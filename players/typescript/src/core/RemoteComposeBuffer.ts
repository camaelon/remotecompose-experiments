// RemoteComposeBuffer: wraps WireBuffer with inflateFromBuffer deserialization.

import { WireBuffer } from './WireBuffer';
import { Operations } from './Operations';
import { Header } from './operations/Header';
import type { Operation } from './Operation';
import type { RemapContext } from './operations/loom/RemapContext';
import { LoomWireBuffer } from './operations/loom/LoomWireBuffer';

// Per-op byte span attached during inflation so macro bodies can be re-sliced
// out of the original input buffer (the players have no op serialization).
export interface ByteSpan {
    _byteStart: number;
    _byteEnd: number;
}

/**
 * Opcodes whose reference class implements VariableProvider. CoreDocument.initFromBuffer
 * starts allocating ids above the largest VariableProvider id, and pattern inflation draws
 * from that counter, so the set must be the reference's for inflated ids to match. Each one's
 * getId() is the first id its reader reads, except ComponentValue (150): its second, the value.
 * Components are VariableProviders too and report their component id (see CoreDocument).
 */
export const VARIABLE_PROVIDERS = new Set([45, 64, 80, 81, 101, 102, 123, 134, 135, 136, 138, 142, 144, 145,
    146, 147, 150, 153, 156, 157, 158, 159, 161, 175, 180, 186, 187, 193, 196, 197, 242]);

export class RemoteComposeBuffer {
    private mBuffer: WireBuffer;

    constructor(buffer: WireBuffer) {
        this.mBuffer = buffer;
    }

    static fromArrayBuffer(data: ArrayBuffer): RemoteComposeBuffer {
        return new RemoteComposeBuffer(WireBuffer.fromArrayBuffer(data));
    }

    getBuffer(): WireBuffer { return this.mBuffer; }

    /**
     * Inflate operations from the buffer into a flat list.
     *
     * @param operations output list
     * @param remapContext if provided, ID reads are routed through this context
     *        (used during macro/pattern body re-inflation for uniqueification).
     */
    inflateFromBuffer(operations: Operation[], remapContext?: RemapContext): void {
        this.mBuffer.setIndex(0);

        // When remapping, wrap the raw buffer so declareId/readId/readNanId apply.
        const buf: WireBuffer = remapContext ? new LoomWireBuffer(this.mBuffer, remapContext) : this.mBuffer;

        const map = Operations.getOperations();

        while (this.mBuffer.available()) {
            const startOffset = this.mBuffer.getIndex();
            const opId = this.mBuffer.readByte();
            const reader = map.get(opId);
            if (!reader) {
                console.warn(`Unknown operation opcode: ${opId}, skipping rest of buffer`);
                return;
            }
            const before = operations.length;
            const trace: number[] = [];
            this.mBuffer.mIdTrace = trace;
            reader(buf, operations);
            this.mBuffer.mIdTrace = null;
            const endOffset = this.mBuffer.getIndex();
            // Tag every op produced by this read with its byte span in the source buffer, and
            // with its VariableProvider id when the reference class is one (see below).
            for (let i = before; i < operations.length; i++) {
                const span = operations[i] as unknown as ByteSpan & { _providerId?: number };
                span._byteStart = startOffset;
                span._byteEnd = endOffset;
                if (VARIABLE_PROVIDERS.has(opId) && trace.length) {
                    span._providerId = opId === 150 ? trace[trace.length - 1] : trace[0];
                }
            }
        }
    }
}
