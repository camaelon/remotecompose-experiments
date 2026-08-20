// LayoutManager: abstract base class for layout managers (Box, Row, Column, Canvas).
// Port of Java LayoutManager.java — handles measurement with fill/wrap/exact sizing.

import { LayoutComponent } from '../LayoutComponent';
import type { PaintContext } from '../../../PaintContext';
import { RemoteContext } from '../../../RemoteContext';
import type { MeasurePass } from '../measure/MeasurePass';
import { Size } from '../measure/Size';
import { WidthModifier, HeightModifier, ScrollModifier } from '../modifiers/ModifierOperations';
import { isNaNBits, idFromBits } from '../../Utils';

export abstract class LayoutManager extends LayoutComponent {
    protected mCachedWrapSize = new Size();

    measure(context: PaintContext, minWidth: number, maxWidth: number,
            minHeight: number, maxHeight: number, measure: MeasurePass): void {
        const selfMeasure = measure.get(this);
        const padding_w = this.mPaddingLeft + this.mPaddingRight;
        const padding_h = this.mPaddingTop + this.mPaddingBottom;

        const wMod = this.getWidthModifier();
        const hMod = this.getHeightModifier();

        // Determine width
        let w: number;
        if (wMod && (wMod.getType() === WidthModifier.EXACT || wMod.getType() === WidthModifier.EXACT_DP)) {
            // Clamp to the incoming constraint. Without this a child larger than its
            // parent keeps its requested size and overflows; the reference and the C++
            // player both clamp (BaseModernMeasurePolicy: min(measuredWidth, maxWidth)).
            w = Math.min(wMod.getValue() + this.mPadBeforeWidth, maxWidth);
        } else if (wMod && wMod.getType() === WidthModifier.FILL) {
            // A fill may carry a fraction of the parent; a bare fill carries NaN.
            w = wMod.hasFraction() ? maxWidth * wMod.getValue() : maxWidth;
        } else if (wMod && wMod.getType() === WidthModifier.WEIGHT) {
            // A weighted child gets its share from the parent's distribution pass. Until
            // then its own size is just its modifier-defined size, as in the reference
            // (max(measured, computeModifierDefinedWidth)). Defaulting to maxWidth here
            // leaks the full width whenever no distribution happens — a weight on the
            // cross axis, or in a parent that wraps and so has no slack to share.
            //
            // ...but once the distribution HAS run, it pins the width by calling
            // measure(share, share, ...), and that has to be honoured *here*, before the
            // children are measured. Taking mPadBeforeWidth unconditionally made a
            // weighted container offer its children `0 - padding` — a negative width —
            // so every child collapsed to 0 and never recovered: the `w = max(w, minWidth)`
            // further down repairs only this component's own reported size, long after the
            // children were measured against nonsense.
            w = Math.max(this.mPadBeforeWidth, minWidth);
        } else {
            // WRAP or other — compute from children
            w = maxWidth; // temporary, will be adjusted by computeWrapSize
        }

        // Determine height
        let h: number;
        if (hMod && (hMod.getType() === HeightModifier.EXACT || hMod.getType() === HeightModifier.EXACT_DP)) {
            h = Math.min(hMod.getValue() + this.mPadBeforeHeight, maxHeight);
        } else if (hMod && hMod.getType() === HeightModifier.FILL) {
            h = hMod.hasFraction() ? maxHeight * hMod.getValue() : maxHeight;
        } else if (hMod && hMod.getType() === HeightModifier.WEIGHT) {
            h = Math.max(this.mPadBeforeHeight, minHeight);   // see the width case above
        } else {
            h = maxHeight;
        }

        selfMeasure.setW(w);
        selfMeasure.setH(h);

        const horizontalWrap = wMod?.getType() === WidthModifier.WRAP;
        const verticalWrap = hMod?.getType() === HeightModifier.WRAP;

        if (horizontalWrap || verticalWrap) {
            this.mCachedWrapSize.clear();
            // Children must be measured against *this* component's resolved size, not
            // against the space it was offered. The reference tightens the inset to the
            // measured size for any non-wrapping axis (BaseModernMeasurePolicy: "non-WRAP
            // gets exact inset"), and C++ does the same. Without it a box with an explicit
            // width measures its children at the parent's full width first, and a
            // wrapping height then locks in from that wrong measurement — which is why
            // text in a narrow fixed-width box was sized to one line and never re-grew.
            const childMaxW = (horizontalWrap ? maxWidth : w) - padding_w;
            const childMaxH = (verticalWrap ? maxHeight : h) - padding_h;
            this.computeWrapSize(context, minWidth, childMaxW, minHeight,
                childMaxH, horizontalWrap, verticalWrap, measure, this.mCachedWrapSize);

            if (horizontalWrap) {
                w = this.mCachedWrapSize.getWidth() + padding_w;
                // Apply WidthIn constraints
                const wIn = this.getWidthInModifier();
                if (wIn) {
                    if (wIn.getMin() >= 0) w = Math.max(w, wIn.getMin());
                    if (wIn.getMax() >= 0) w = Math.min(w, wIn.getMax());
                }
                w = Math.min(w, maxWidth);
            }
            if (verticalWrap) {
                h = this.mCachedWrapSize.getHeight() + padding_h;
                const hIn = this.getHeightInModifier();
                if (hIn) {
                    if (hIn.getMin() >= 0) h = Math.max(h, hIn.getMin());
                    if (hIn.getMax() >= 0) h = Math.min(h, hIn.getMax());
                }
                h = Math.min(h, maxHeight);
            }

            selfMeasure.setW(w);
            selfMeasure.setH(h);
        }

        // Scroll-aware measurement (matching Java LayoutManager.measure_v1_1_0):
        // Re-measure children with unbounded dimension on the scroll axis to discover
        // full content size, then store scroll dimensions for variable writing.
        const scrollMod = this.getScrollModifier();
        if (scrollMod) {
            const isVertical = (scrollMod.getDirection() === ScrollModifier.VERTICAL);
            const hostW = Math.min(w, maxWidth) - padding_w;
            const hostH = Math.min(h, maxHeight) - padding_h;
            const unboundW = isVertical ? hostW : 1e9;
            const unboundH = isVertical ? 1e9 : hostH;

            this.mCachedWrapSize.clear();
            this.computeWrapSize(context, 0, unboundW, 0, unboundH,
                true, true, measure, this.mCachedWrapSize);

            if (isVertical) {
                this.mScrollHostDimension = hostH;
                this.mScrollContentDimension = this.mCachedWrapSize.getHeight();
                // The modifier needs these too: they are what bound a direct-mode drag.
                // Without them its max stays 0 and dragging is clamped to nothing, which
                // looks exactly like scrolling not being implemented.
                scrollMod.setVerticalScrollDimension(
                    this.mScrollHostDimension, this.mScrollContentDimension);
            } else {
                this.mScrollHostDimension = hostW;
                this.mScrollContentDimension = this.mCachedWrapSize.getWidth();
                scrollMod.setHorizontalScrollDimension(
                    this.mScrollHostDimension, this.mScrollContentDimension);
            }

            // Re-measure children with unbounded content dimension
            const childMaxW = isVertical ? (w - padding_w) : Math.max(w - padding_w, this.mScrollContentDimension);
            const childMaxH = isVertical ? Math.max(h - padding_h, this.mScrollContentDimension) : (h - padding_h);
            this.computeSize(context, 0, childMaxW, 0, childMaxH, measure);
        }

        // Update ComponentValue float bindings with our final dimensions
        // so LAYOUT_COMPUTE expressions can reference parent width/height.
        // Java does this via ComponentData.updateComponentData in LayoutComponent.
        this.updateComponentValues(context.getContext(), w, h);

        // Measure children with fill sizing (skip if already done in scroll path)
        if (!scrollMod) {
            const childMaxW = Math.max(0, w - padding_w);
            const childMaxH = Math.max(0, h - padding_h);
            this.computeSize(context, 0, childMaxW, 0, childMaxH, measure);
        }

        // Re-assign final dimensions after computeSize() (matching Java lines 558-563).
        // Subclass computeSize() overrides (e.g. CoreText) may overwrite selfMeasure
        // with content-only dimensions; restore the container's computed w/h here.
        w = Math.max(w, minWidth);
        h = Math.max(h, minHeight);
        selfMeasure.setW(w);
        selfMeasure.setH(h);

        // Run internal layout measure (positioning children)
        this.internalLayoutMeasure(context, measure);
    }

    layout(context: RemoteContext, measure: MeasurePass): void {
        // super.layout() already recurses into children, so we only add
        // layoutModifiers here (passes dimensions to Border/Background decorators).
        super.layout(context, measure);
        const self = measure.get(this);
        this.layoutModifiers(self.getW(), self.getH());

        // Write scroll max/notch variables to context
        // (matching Java ScrollModifierOperation.layout())
        const scrollMod = this.getScrollModifier();
        if (scrollMod) {
            const maxScroll = Math.max(0, this.mScrollContentDimension - this.mScrollHostDimension);
            const maxNan = scrollMod.getMaxNan();
            const notchNan = scrollMod.getNotchMaxNan();
            if (isNaNBits(maxNan)) {
                context.loadFloat(idFromBits(maxNan), maxScroll);
            }
            if (isNaNBits(notchNan)) {
                context.loadFloat(idFromBits(notchNan), this.mScrollContentDimension);
            }
        }
    }

    // Override in subclasses to compute wrap-content size
    computeWrapSize(_context: PaintContext, _minWidth: number, _maxWidth: number,
                    _minHeight: number, _maxHeight: number,
                    _horizontalWrap: boolean, _verticalWrap: boolean,
                    _measure: MeasurePass, _size: Size): void { /* override */ }

    // Override in subclasses to measure non-wrap children
    computeSize(_context: PaintContext, _minWidth: number, _maxWidth: number,
                _minHeight: number, _maxHeight: number, _measure: MeasurePass): void { /* override */ }

    // Override in subclasses to position children
    internalLayoutMeasure(_context: PaintContext, _measure: MeasurePass): void { /* override */ }

    /**
     * `spacedBy` in physical pixels.
     *
     * Spacing is authored in dp but only scales when the document declares DENSITY_BEHAVIOR_DP
     * — note `== DP`, not the `!= PIXELS` the dimension modifiers use. Under the default
     * LEGACY behaviour the reference does not scale spacing either, so this returns the raw
     * value for almost every document in the corpus.
     *
     * Takes a PaintContext because that is all the layout managers are handed.
     */
    protected spacedByPx(context: PaintContext, spacedBy: number): number {
        if (context.getDensityBehavior?.() !== RemoteContext.DENSITY_BEHAVIOR_DP) {
            return spacedBy;
        }
        const density = context.getDensity();
        return (density > 0 && !Number.isNaN(density)) ? spacedBy * density : spacedBy;
    }
}
