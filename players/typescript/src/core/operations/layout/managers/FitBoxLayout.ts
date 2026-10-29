// FitBoxLayout: only displays the first child that fits in the available space.
// Port of Java FitBoxLayout.java.

import { LayoutManager } from './LayoutManager';
import { LayoutComponent } from '../LayoutComponent';
import { Component, Visibility } from '../Component';
import type { Operation } from '../../../Operation';
import type { WireBuffer } from '../../../WireBuffer';
import type { RemoteContext } from '../../../RemoteContext';
import type { PaintContext } from '../../../PaintContext';
import type { MeasurePass } from '../measure/MeasurePass';
import type { Size } from '../measure/Size';
import { Header } from '../../Header';

export class FitBoxLayout extends LayoutManager {
    static readonly OP_CODE = 176;

    static readonly START = 1;
    static readonly CENTER = 2;
    static readonly END = 3;
    static readonly TOP = 4;
    static readonly BOTTOM = 5;

    private mAnimationId: number;
    private mHorizontalPositioning: number;
    private mVerticalPositioning: number;

    constructor(componentId: number, animationId: number,
                horizontalPositioning: number, verticalPositioning: number) {
        super(componentId, animationId);
        this.mAnimationId = animationId;
        this.mHorizontalPositioning = horizontalPositioning;
        this.mVerticalPositioning = verticalPositioning;
    }

    // Java FitBoxLayout picks between two algorithms on FEATURE_PRIORITY_FIX (23), which
    // defaults to on (CoreDocument.DEFAULT_FEATURE_PRIORITY_FIX = 1).
    private usePriorityFix(context: PaintContext): boolean {
        const doc = context.getContext().getDocument?.();
        return doc ? doc.useFeature(Header.FEATURE_PRIORITY_FIX, 1) : true;
    }

    computeWrapSize(context: PaintContext, minWidth: number, maxWidth: number,
                    minHeight: number, maxHeight: number,
                    _horizontalWrap: boolean, _verticalWrap: boolean,
                    measure: MeasurePass, size: Size): void {
        if (this.usePriorityFix(context)) {
            this.measurePriorityFix(context, maxWidth, maxHeight, measure, size);
            return;
        }
        // computeWrapSizeOriginal
        let found = false;
        const self = measure.get(this);
        for (const c of this.mChildrenComponents) {
            const [cw, ch] = FitBoxLayout.minConstraints(c);
            c.measure(context, 0, maxWidth, 0, maxHeight, measure);
            const m = measure.get(c);
            if (!found && cw <= maxWidth && ch <= maxHeight) {
                found = true;
                m.addVisibilityOverride(Visibility.OVERRIDE_VISIBLE);
                size.setWidth(m.getW());
                size.setHeight(m.getH());
            } else {
                m.addVisibilityOverride(Visibility.OVERRIDE_GONE);
            }
        }
        self.setVisibility(found ? Visibility.VISIBLE : Visibility.GONE);
    }

    computeSize(context: PaintContext, minWidth: number, maxWidth: number,
                minHeight: number, maxHeight: number, measure: MeasurePass): void {
        if (this.usePriorityFix(context)) {
            this.measurePriorityFix(context, maxWidth, maxHeight, measure, null);
            return;
        }
        // computeSizeOriginal
        let found = false;
        for (const c of this.mChildrenComponents) {
            const [cw, ch] = FitBoxLayout.minConstraints(c);
            c.measure(context, minWidth, maxWidth, minHeight, maxHeight, measure);
            const m = measure.get(c);
            m.clearVisibilityOverride();
            if (!found && cw <= maxWidth && ch <= maxHeight) {
                found = true;
                m.addVisibilityOverride(Visibility.OVERRIDE_VISIBLE);
            } else {
                m.addVisibilityOverride(Visibility.OVERRIDE_GONE);
            }
        }
    }

    /** widthIn / heightIn minimums, the only fit test of the original algorithm. */
    private static minConstraints(c: Component): [number, number] {
        let cw = 0, ch = 0;
        if (c instanceof LayoutComponent) {
            const wIn = c.getWidthInModifier();
            if (wIn) cw = wIn.getMin();
            const hIn = c.getHeightInModifier();
            if (hIn) ch = hIn.getMin();
        }
        return [cw, ch];
    }

    /**
     * Java computeWrapSizePriorityFix / computeSizePriorityFix: the first child whose min
     * intrinsic size fits, and which, measured from that minimum, still fits, is shown;
     * the rest are gone. No child fitting makes the fitBox itself gone.
     */
    private measurePriorityFix(context: PaintContext, maxWidth: number, maxHeight: number,
                               measure: MeasurePass, size: Size | null): void {
        let found = false;
        const self = measure.get(this);
        self.clearVisibilityOverride();
        for (const c of this.mChildrenComponents) {
            const m = measure.get(c);
            m.clearVisibilityOverride();
            if (!found) {
                const childMinWidth = c.minIntrinsicWidth();
                const childMinHeight = c.minIntrinsicHeight();
                if (childMinWidth <= maxWidth && childMinHeight <= maxHeight) {
                    c.measure(context, childMinWidth, maxWidth, childMinHeight, maxHeight, measure);
                    if (m.getW() <= maxWidth && m.getH() <= maxHeight) {
                        found = true;
                        m.addVisibilityOverride(Visibility.OVERRIDE_VISIBLE);
                        if (size) {
                            size.setWidth(m.getW());
                            size.setHeight(m.getH());
                        }
                    } else {
                        m.addVisibilityOverride(Visibility.OVERRIDE_GONE);
                    }
                } else {
                    m.addVisibilityOverride(Visibility.OVERRIDE_GONE);
                }
            } else {
                m.addVisibilityOverride(Visibility.OVERRIDE_GONE);
            }
        }
        self.addVisibilityOverride(found ? Visibility.OVERRIDE_VISIBLE : Visibility.OVERRIDE_GONE);
    }

    internalLayoutMeasure(_context: PaintContext, measure: MeasurePass): void {
        const selfMeasure = measure.get(this);
        const selfWidth = selfMeasure.getW() - this.mPaddingLeft - this.mPaddingRight;
        const selfHeight = selfMeasure.getH() - this.mPaddingTop - this.mPaddingBottom;

        for (const child of this.mChildrenComponents) {
            const m = measure.get(child);
            let tx = 0;
            let ty = 0;

            switch (this.mVerticalPositioning) {
                case FitBoxLayout.TOP: ty = 0; break;
                case FitBoxLayout.CENTER: ty = (selfHeight - m.getH()) / 2; break;
                case FitBoxLayout.BOTTOM: ty = selfHeight - m.getH(); break;
            }
            switch (this.mHorizontalPositioning) {
                case FitBoxLayout.START: tx = 0; break;
                case FitBoxLayout.CENTER: tx = (selfWidth - m.getW()) / 2; break;
                case FitBoxLayout.END: tx = selfWidth - m.getW(); break;
            }

            m.setX(tx);
            m.setY(ty);
        }
    }

    write(buffer: WireBuffer): void {
        buffer.start(FitBoxLayout.OP_CODE);
        buffer.writeInt(this.getComponentId());
        buffer.writeInt(this.mAnimationId);
        buffer.writeInt(this.mHorizontalPositioning);
        buffer.writeInt(this.mVerticalPositioning);
    }

    deepToString(indent: string): string {
        return `${indent}FitBoxLayout(${this.getComponentId()})`;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const componentId = buffer.declareId();
        const animationId = buffer.declareId();
        const horizontalPositioning = buffer.readInt();
        const verticalPositioning = buffer.readInt();
        operations.push(new FitBoxLayout(componentId, animationId,
            horizontalPositioning, verticalPositioning));
    }
}
