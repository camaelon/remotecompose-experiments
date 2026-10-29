// Custom: a custom layout component (LAYOUT_CUSTOM op=93).
//
// A container (extends LayoutManager -> Component, inheriting getList()/inflate() so
// CoreDocument nests its children exactly like BoxLayout/RowLayout) that is laid out like
// a box and painted by the platform's CustomComponentHost: the engine translates to the
// component's content box and hands the host the config string — "rc:media/film.rc#…",
// "video:clip.mp4" — and the box size. Without a host it paints as the empty box it
// always was.

import { LayoutManager } from './LayoutManager';
import { Visibility } from '../Component';
import type { Operation } from '../../../Operation';
import type { WireBuffer } from '../../../WireBuffer';
import type { RemoteContext } from '../../../RemoteContext';
import type { PaintContext } from '../../../PaintContext';

interface CustomProperty {
    type: number;
    dataType: number;
    value: number;
}

export class Custom extends LayoutManager {
    static readonly OP_CODE = 93;

    protected mConfigId: number;
    protected mProperties: CustomProperty[];

    constructor(componentId: number, animationId: number, configId: number, properties: CustomProperty[]) {
        super(componentId, animationId);
        this.mConfigId = configId;
        this.mProperties = properties;
    }

    write(buffer: WireBuffer): void {
        buffer.start(Custom.OP_CODE);
        buffer.writeInt(this.getComponentId());
        buffer.writeInt(this.getAnimationId());
        buffer.writeInt(this.mConfigId);
        buffer.writeInt(this.mProperties.length);
        for (const p of this.mProperties) {
            buffer.writeShort(p.type);
            buffer.writeShort(p.dataType);
            if ((p.dataType & 1) === 0) {
                buffer.writeInt(p.value);
            } else {
                buffer.writeFloat(p.value);
            }
        }
    }

    apply(context: RemoteContext): void { super.apply(context); }

    // The same modifier pass as any layout component, then the host draws the content —
    // what the C++ engine does for opcode 93 in LayoutOperations.cpp.
    override paintingComponent(paintContext: PaintContext): void {
        const context = paintContext.getContext();
        const host = context.getCustomHost();
        if (!host) { super.paintingComponent(paintContext); return; }
        if (Visibility.isGone(this.mVisibility) && this.mAnimateMeasure === null) return;

        paintContext.matrixSave();
        paintContext.matrixTranslate(this.mX, this.mY);
        this.paintModifiers(paintContext);
        paintContext.matrixTranslate(this.mPaddingLeft, this.mPaddingTop);

        const config = this.mConfigId >= 0 ? (context.getText(this.mConfigId) ?? '') : '';
        const w = this.mWidth - this.mPaddingLeft - this.mPaddingRight;
        const h = this.mHeight - this.mPaddingTop - this.mPaddingBottom;
        host.drawCustom(this.getComponentId(), config, paintContext, w, h, context.getAnimationTime());
        paintContext.matrixRestore();
    }

    deepToString(indent: string): string {
        return `${indent}Custom(${this.getComponentId()}, config=${this.mConfigId}, ${this.mProperties.length} props)`;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        // The reference reads both as plain ints (Custom.read): declaring them would allocate
        // ids the reference does not, and shift every id a pattern inflates after this one.
        const componentId = buffer.readInt();
        const animationId = buffer.readInt();
        const configId = buffer.readId();
        const propCount = buffer.readInt();
        const properties: CustomProperty[] = [];
        for (let i = 0; i < propCount; i++) {
            const type = buffer.readShort();
            const dataType = buffer.readShort();
            const value = (dataType & 1) === 0 ? buffer.readInt() : buffer.readFloat();
            properties.push({ type, dataType, value });
        }
        operations.push(new Custom(componentId, animationId, configId, properties));
    }
}
