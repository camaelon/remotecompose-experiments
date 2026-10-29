import { intBitsToFloat } from '../../Utils';
// ActionOperations: action modifier operations that execute on click/touch events.
// Port of Java HostActionOperation, HostNamedActionOperation,
// ValueIntegerChangeAction, ValueStringChangeAction, ValueFloatChangeAction.

import { Operation } from '../../../Operation';
import type { WireBuffer } from '../../../WireBuffer';
import { ContextMode, type RemoteContext } from '../../../RemoteContext';

// ── HostActionOperation (209): INT actionId ───────────────────────────
export class HostActionOperation extends Operation {
    static readonly OP_CODE = 209;
    private mActionId: number;

    constructor(actionId: number) {
        super();
        this.mActionId = actionId;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    apply(context: RemoteContext): void {
        context.runAction(this.mActionId, '');
    }

    deepToString(indent: string): string {
        return `${indent}HostActionOperation(${this.mActionId})`;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        operations.push(new HostActionOperation(buffer.readId()));
    }
}

// ── HostNamedActionOperation (210): INT textId, INT type, INT valueId ──
export class HostNamedActionOperation extends Operation {
    static readonly OP_CODE = 210;

    private static readonly FLOAT_TYPE = 0;
    private static readonly INT_TYPE = 1;
    private static readonly STRING_TYPE = 2;
    private static readonly NONE_TYPE = -1;

    private mTextId: number;
    private mType: number;
    private mValueId: number;

    constructor(textId: number, type: number, valueId: number) {
        super();
        this.mTextId = textId;
        this.mType = type;
        this.mValueId = valueId;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    apply(context: RemoteContext): void {
        let value: any;
        switch (this.mType) {
            case HostNamedActionOperation.FLOAT_TYPE:
                value = context.getFloat(this.mValueId);
                break;
            case HostNamedActionOperation.INT_TYPE:
                value = context.mRemoteComposeState.getInteger(this.mValueId);
                break;
            case HostNamedActionOperation.STRING_TYPE:
                value = context.mRemoteComposeState.getFromId(this.mValueId);
                break;
            case HostNamedActionOperation.NONE_TYPE:
            default:
                value = '';
                break;
        }
        context.runNamedAction(this.mTextId, value);
    }

    deepToString(indent: string): string {
        return `${indent}HostNamedActionOperation(text=${this.mTextId}, type=${this.mType}, value=${this.mValueId})`;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const textId = buffer.readId();
        const type = buffer.readInt();
        const valueId = buffer.readId();
        operations.push(new HostNamedActionOperation(textId, type, valueId));
    }
}

// ── ValueIntegerChangeAction (212): INT valueId, INT value ────────────
export class ValueIntegerChangeAction extends Operation {
    static readonly OP_CODE = 212;
    private mTargetValueId: number;
    private mValue: number;

    constructor(valueId: number, value: number) {
        super();
        this.mTargetValueId = valueId;
        this.mValue = value;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    apply(context: RemoteContext): void {
        context.overrideInteger(this.mTargetValueId, this.mValue);
    }

    deepToString(indent: string): string {
        return `${indent}ValueIntegerChangeAction(${this.mTargetValueId}, ${this.mValue})`;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const valueId = buffer.readId();
        const value = buffer.readInt();
        operations.push(new ValueIntegerChangeAction(valueId, value));
    }
}

// ── ValueStringChangeAction (213): INT valueId, INT stringId ──────────
export class ValueStringChangeAction extends Operation {
    static readonly OP_CODE = 213;
    private mTargetValueId: number;
    private mValueId: number;

    constructor(valueId: number, stringId: number) {
        super();
        this.mTargetValueId = valueId;
        this.mValueId = stringId;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    apply(context: RemoteContext): void {
        context.overrideText(this.mTargetValueId, this.mValueId);
    }

    deepToString(indent: string): string {
        return `${indent}ValueStringChangeAction(${this.mTargetValueId}, ${this.mValueId})`;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const valueId = buffer.readId();
        const stringId = buffer.readId();
        operations.push(new ValueStringChangeAction(valueId, stringId));
    }
}

// ── ValueIntegerExpressionChangeAction (218): LONG valueId, LONG expressionId
export class ValueIntegerExpressionChangeAction extends Operation {
    static readonly OP_CODE = 218;
    private mTargetValueId: number;
    private mValueExpressionId: number;

    constructor(valueId: number, expressionId: number) {
        super();
        this.mTargetValueId = valueId;
        this.mValueExpressionId = expressionId;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    /**
     * ValueIntegerExpressionChangeActionOperation.runAction: evaluate the integer
     * expression and write it into the target. Both ids arrive long-encoded (id + 2^32, see
     * Utils.longIdFromNan); the reference casts the target with `(int)`, keeping the low 32
     * bits, and looks the expression up by its long id, then by the decoded id.
     */
    apply(context: RemoteContext): void {
        if (context.mMode === ContextMode.DATA) return;
        const document: any = context.getDocument();
        if (!document?.evaluateIntExpression) return;
        document.evaluateIntExpression(this.mValueExpressionId, toInt32(this.mTargetValueId), context);
    }

    deepToString(indent: string): string {
        return `${indent}ValueIntegerExpressionChangeAction(${this.mTargetValueId}, ${this.mValueExpressionId})`;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const valueId = buffer.readLongNanId();
        const expressionId = buffer.readLongNanId();
        operations.push(new ValueIntegerExpressionChangeAction(valueId, expressionId));
    }
}

/** Java's (int) cast of a long: the low 32 bits, signed. */
function toInt32(v: number): number {
    return Number(BigInt.asIntN(32, BigInt(Math.trunc(v))));
}

// ── ValueFloatChangeAction (222): INT valueId, FLOAT value ────────────
export class ValueFloatChangeAction extends Operation {
    static readonly OP_CODE = 222;
    private mTargetValueId: number;
    private mValue: number;

    constructor(valueId: number, value: number) {
        super();
        this.mTargetValueId = valueId;
        this.mValue = value;
    }

    write(_buffer: WireBuffer): void { /* stub */ }

    apply(context: RemoteContext): void {
        context.overrideFloat(this.mTargetValueId, this.mValue);
    }

    deepToString(indent: string): string {
        return `${indent}ValueFloatChangeAction(${this.mTargetValueId}, ${this.mValue})`;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const valueId = buffer.readId();
        const value = intBitsToFloat(buffer.readNanIdBits());
        operations.push(new ValueFloatChangeAction(valueId, value));
    }
}
