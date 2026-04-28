// RemoteComposeBuffer: wraps WireBuffer with inflateFromBuffer deserialization.

import { WireBuffer } from './WireBuffer';
import { Operations } from './Operations';
import { Header } from './operations/Header';
import type { Operation } from './Operation';

export class RemoteComposeBuffer {
    private mBuffer: WireBuffer;

    constructor(buffer: WireBuffer) {
        this.mBuffer = buffer;
    }

    static fromArrayBuffer(data: ArrayBuffer): RemoteComposeBuffer {
        return new RemoteComposeBuffer(WireBuffer.fromArrayBuffer(data));
    }

    getBuffer(): WireBuffer { return this.mBuffer; }

    inflateFromBuffer(operations: Operation[]): void {
        this.mBuffer.setIndex(0);

        const map = Operations.getOperations();

        while (this.mBuffer.available()) {
            const opId = this.mBuffer.readByte();
            const reader = map.get(opId);
            if (!reader) {
                console.warn(`Unknown operation opcode: ${opId}, skipping rest of buffer`);
                return;
            }
            reader(this.mBuffer, operations);
        }
    }
}
