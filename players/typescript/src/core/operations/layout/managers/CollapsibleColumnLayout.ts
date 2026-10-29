// CollapsibleColumnLayout: a column that hides children that don't fit vertically.
// Port of Java CollapsibleColumnLayout.java (computeVisibleChildren is shared, in CollapsiblePriority.ts).

import { ColumnLayout } from './ColumnLayout';
import { Component, Visibility } from '../Component';
import { CollapsiblePriority, computeVisibleChildren } from './CollapsiblePriority';
import type { Operation } from '../../../Operation';
import type { WireBuffer } from '../../../WireBuffer';
import type { PaintContext } from '../../../PaintContext';
import type { MeasurePass } from '../measure/MeasurePass';
import type { Size } from '../measure/Size';
import { Header } from '../../Header';

export class CollapsibleColumnLayout extends ColumnLayout {
    static override readonly OP_CODE = 233;

    // Set by a wrapping measure of the cross axis: the incoming minimum, so that
    // internalLayoutMeasure can settle the cross size on the children kept.
    private mSettleCrossMin: number | null = null;
    // FEATURE_PRIORITY_FIX (23, on by default), read at measure: the intrinsic size is that
    // of the child that stays last rather than of the first child.
    private mPriorityFix = true;

    constructor(componentId: number, animationId: number,
                horizontalPositioning: number, verticalPositioning: number,
                spacedBy: number) {
        super(componentId, animationId, horizontalPositioning, verticalPositioning, spacedBy);
    }

    private axis(): number { return CollapsiblePriority.VERTICAL; }

    override minIntrinsicHeight(): number {
        let v = this.modifierDefinedHeight(true);
        const exact = this.getHeightModifier();
        if (exact && (exact.getType() === 0 || exact.getType() === 6)) return v;
        const c = this.mPriorityFix
            ? CollapsiblePriority.findLastStanding(this.mChildrenComponents, this.axis())
            : this.mChildrenComponents[0];
        if (c) v += c.minIntrinsicHeight();
        return v;
    }

    override minIntrinsicWidth(): number {
        let v = this.modifierDefinedWidth(true);
        const exact = this.getWidthModifier();
        if (exact && (exact.getType() === 0 || exact.getType() === 6)) return v;
        const c = this.mPriorityFix
            ? CollapsiblePriority.findLastStanding(this.mChildrenComponents, this.axis())
            : this.mChildrenComponents[0];
        if (c) v += c.minIntrinsicWidth();
        return v;
    }

    override measure(context: PaintContext, minWidth: number, maxWidth: number,
                     minHeight: number, maxHeight: number, measure: MeasurePass): void {
        this.mSettleCrossMin = null;
        const doc = context.getContext().getDocument?.();
        this.mPriorityFix = doc ? doc.useFeature(Header.FEATURE_PRIORITY_FIX, 1) : true;
        super.measure(context, minWidth, maxWidth, minHeight, maxHeight, measure);
    }

    override computeWrapSize(context: PaintContext, minWidth: number, maxWidth: number,
                             minHeight: number, maxHeight: number,
                             horizontalWrap: boolean, verticalWrap: boolean,
                             measure: MeasurePass, size: Size): void {
        const r = computeVisibleChildren(this, this.axis(), context, maxHeight, maxWidth,
            measure, true, (c) => c instanceof CollapsibleColumnLayout);
        // The first frame wraps the cross axis to every child not GONE before the drop, the
        // main axis to the sum of those plus the spacing, or, wrapping, to what was kept
        // (at most the space, and without the spacing).
        size.setWidth(r.preDropCross);
        size.setHeight(verticalWrap ? Math.min(maxHeight, r.keptMain)
            : r.preDropMain + this.spacedByPx(context, this.mSpacedBy) * (r.preDropCount - 1));
        if (horizontalWrap) this.mSettleCrossMin = minWidth;
        if (r.preDropCount + r.kept === 0 || ((verticalWrap ? Math.min(maxHeight, r.keptMain)
            : r.preDropMain) <= 0)) {
            measure.get(this).addVisibilityOverride(Visibility.OVERRIDE_GONE);
        }
    }

    override computeSize(context: PaintContext, _minWidth: number, maxWidth: number,
                         _minHeight: number, maxHeight: number, measure: MeasurePass): void {
        const r = computeVisibleChildren(this, this.axis(), context, maxHeight, maxWidth,
            measure, true, (c) => c instanceof CollapsibleColumnLayout);
        if (r.preDropCount + r.kept === 0) measure.get(this).addVisibilityOverride(Visibility.OVERRIDE_GONE);
    }

    override internalLayoutMeasure(context: PaintContext, measure: MeasurePass): void {
        const m = measure.get(this);
        // The reference measures the children again against its own measured size (padding
        // included), the dropped ones staying GONE.
        const r = computeVisibleChildren(this, this.axis(), context, m.getH(), m.getW(),
            measure, false, (c) => c instanceof CollapsibleColumnLayout);
        if (r.preDropCount + r.kept === 0) m.addVisibilityOverride(Visibility.OVERRIDE_GONE);
        // On the next frame its children keep that GONE, so a wrapping cross axis settles on
        // the largest child kept.
        if (this.mSettleCrossMin !== null) {
            let cross = r.keptCross + this.mPaddingLeft + this.mPaddingRight;
            const cIn = this.getWidthInModifier();
            if (cIn) {
                if (cIn.getMin() >= 0) cross = Math.max(cross, cIn.getMin());
                if (cIn.getMax() >= 0) cross = Math.min(cross, cIn.getMax());
            }
            cross = Math.max(cross, this.mSettleCrossMin);
            m.setW(Math.min(m.getW(), cross));
        }
        super.internalLayoutMeasure(context, measure);
    }

    override write(buffer: WireBuffer): void {
        buffer.start(CollapsibleColumnLayout.OP_CODE);
        buffer.writeInt(this.getComponentId());
        buffer.writeInt(this.getAnimationId());
        buffer.writeInt(this.mHorizontalPositioning);
        buffer.writeInt(this.mVerticalPositioning);
        buffer.writeFloat(this.mSpacedBy);
    }

    override deepToString(indent: string): string {
        return `${indent}CollapsibleColumnLayout(${this.getComponentId()})`;
    }

    static override read(buffer: WireBuffer, operations: Operation[]): void {
        const componentId = buffer.declareId();   // declared, as every layout component
        const animationId = buffer.declareId();
        const horizontalPositioning = buffer.readInt();
        const verticalPositioning = buffer.readInt();
        const spacedBy = buffer.readFloat();
        operations.push(new CollapsibleColumnLayout(componentId, animationId,
            horizontalPositioning, verticalPositioning, spacedBy));
    }
}
