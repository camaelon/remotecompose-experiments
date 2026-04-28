// Operation: abstract base class for all RemoteCompose operations.

import type { WireBuffer } from './WireBuffer';
import type { RemoteContext } from './RemoteContext';

export abstract class Operation {
    private static readonly ENABLE_DIRTY_FLAG_OPTIMIZATION = true;
    private mDirty = true;

    abstract write(buffer: WireBuffer): void;
    abstract apply(context: RemoteContext): void;
    abstract deepToString(indent: string): string;

    markDirty(): void {
        this.mDirty = true;
    }

    markNotDirty(): void {
        if (Operation.ENABLE_DIRTY_FLAG_OPTIMIZATION) {
            this.mDirty = false;
        }
    }

    isDirty(): boolean {
        if (Operation.ENABLE_DIRTY_FLAG_OPTIMIZATION) {
            return this.mDirty;
        }
        return true;
    }
}
