// LayoutManager: abstract base class for layout managers (Box, Row, Column, Canvas).
// Port of Java LayoutManager.java — handles measurement with fill/wrap/exact sizing.

import { LayoutComponent } from '../LayoutComponent';
import type { PaintContext } from '../../../PaintContext';
import { RemoteContext } from '../../../RemoteContext';
import type { MeasurePass } from '../measure/MeasurePass';
import { Size } from '../measure/Size';
import { WidthModifier, HeightModifier, ScrollModifier, DimensionConstraintsModifier } from '../modifiers/ModifierOperations';
import { isNaNBits, idFromBits } from '../../Utils';

export abstract class LayoutManager extends LayoutComponent {
    protected mCachedWrapSize = new Size();
    protected mLastMeasurePass: MeasurePass | null = null;
    protected mLastMinW = -1;
    protected mLastMaxW = -1;
    protected mLastMinH = -1;
    protected mLastMaxH = -1;

    measure(context: PaintContext, minWidth: number, maxWidth: number,
            minHeight: number, maxHeight: number, measure: MeasurePass): void {
        if (this.mLastMeasurePass === measure &&
            this.mLastMinW === minWidth && this.mLastMaxW === maxWidth &&
            this.mLastMinH === minHeight && this.mLastMaxH === maxHeight &&
            !this.mNeedsMeasure) {
            return;
        }
        this.mLastMeasurePass = measure;
        this.mLastMinW = minWidth;
        this.mLastMaxW = maxWidth;
        this.mLastMinH = minHeight;
        this.mLastMaxH = maxHeight;

        // Padding resolves in the modifiers' updateVariables (variables, DP scaling); pick up
        // the resolved values, as Java's computeModifierDefinedWidth does via updatePadding.
        this.updatePadding();
        const selfMeasure = measure.get(this);
        const padding_w = this.mPaddingLeft + this.mPaddingRight;
        const padding_h = this.mPaddingTop + this.mPaddingBottom;

        const wMod = this.getWidthModifier();
        const hMod = this.getHeightModifier();

        // widthIn / heightIn tighten the incoming constraints before anything is sized,
        // as BaseModernMeasurePolicy does (minWidth = max(minWidth, widthIn.min),
        // maxWidth = min(maxWidth, widthIn.max)). An explicit width is then clamped into
        // them: `width(40).widthIn(100, 260)` is 100, not 40.
        {
            const wIn = this.getWidthInModifier();
            if (wIn) {
                if (wIn.getMin() >= 0) minWidth = Math.max(minWidth, wIn.getMin());
                if (wIn.getMax() >= 0) maxWidth = Math.min(maxWidth, wIn.getMax());
            }
            const hIn = this.getHeightInModifier();
            if (hIn) {
                if (hIn.getMin() >= 0) minHeight = Math.max(minHeight, hIn.getMin());
                if (hIn.getMax() >= 0) maxHeight = Math.min(maxHeight, hIn.getMax());
            }
        }

        // RowLayout.isInHorizontalFill / ColumnLayout.isInVerticalFill: a row with a
        // horizontally weighted child fills horizontally, a column with a vertically weighted
        // child fills vertically, whatever its own size modifier says.
        const [weightFillW, weightFillH] = this.weightFill();

        // Determine width
        let w: number;
        if (weightFillW && wMod?.getType() !== WidthModifier.FILL) {
            w = maxWidth;
        } else if (wMod && (wMod.getType() === WidthModifier.EXACT || wMod.getType() === WidthModifier.EXACT_DP)) {
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
        if (weightFillH && hMod?.getType() !== HeightModifier.FILL) {
            h = maxHeight;
        } else if (hMod && (hMod.getType() === HeightModifier.EXACT || hMod.getType() === HeightModifier.EXACT_DP)) {
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

        // A weight is not a wrap, even before the parent has distributed its share:
        // BaseModernMeasurePolicy sizes it to its modifier-defined size (0 for a bare
        // weight) and measures its children against that. Measuring it as a wrap made a
        // weighted column holding a fillMaxWidth child take the whole row in the row's
        // first computeSize pass, so a fixed spacer after it was offered 0 and collapsed.
        const horizontalWrap = !weightFillW && wMod?.getType() === WidthModifier.WRAP;
        const verticalWrap = !weightFillH && hMod?.getType() === HeightModifier.WRAP;

        if (horizontalWrap || verticalWrap) {
            this.mCachedWrapSize.clear();
            // Children must be measured against *this* component's resolved size, not
            // against the space it was offered. The reference tightens the inset to the
            // measured size for any non-wrapping axis (BaseModernMeasurePolicy: "non-WRAP
            // gets exact inset"), and C++ does the same. Without it a box with an explicit
            // width measures its children at the parent's full width first, and a
            // wrapping height then locks in from that wrong measurement — which is why
            // text in a narrow fixed-width box was sized to one line and never re-grew.
            //
            // A weighted axis is the exception: InsetWrapMeasurePolicy tightens only in its
            // fixed/wrap branch, so a weight keeps the offered inset (maxWidth - padding).
            // Its own size there is just its modifier-defined size (0 for a bare weight),
            // and `0 - padding` would measure the children at a negative width: a weighted
            // column with start padding then wrapped to 0 high and was pinned at that by the
            // row's weight distribution (T12).
            const weightW = wMod?.getType() === WidthModifier.WEIGHT;
            const weightH = hMod?.getType() === HeightModifier.WEIGHT;
            const childMaxW = (horizontalWrap || weightW ? maxWidth : w) - padding_w;
            const childMaxH = (verticalWrap || weightH ? maxHeight : h) - padding_h;
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
        if (!scrollMod && !(horizontalWrap || verticalWrap)) {
            const childMaxW = Math.max(0, w - padding_w);
            const childMaxH = Math.max(0, h - padding_h);
            this.computeSize(context, 0, childMaxW, 0, childMaxH, measure);
        }

        // Re-assign final dimensions after computeSize() (matching Java lines 558-563).
        // Subclass computeSize() overrides (e.g. CoreText) may overwrite selfMeasure
        // with content-only dimensions; restore the container's computed w/h here.
        w = Math.max(w, minWidth);
        h = Math.max(h, minHeight);
        // EnforceConstraintsMeasurePolicy (the default measure version) then clamps to the
        // max, so a widthIn minimum larger than the space offered still gives way to it.
        w = Math.min(w, maxWidth);
        h = Math.min(h, maxHeight);
        // ...and a *required* constraint (DimensionConstraints REQUIRED_*) wins over that
        // (DimensionConstraintsModifierOperation.applyWidthConstraint).
        const wReq = this.getWidthInModifier();
        if (wReq instanceof DimensionConstraintsModifier
            && wReq.getType() === DimensionConstraintsModifier.REQUIRED_HORIZONTAL) {
            w = Math.max(wReq.getMin(), Math.min(w, wReq.getMax()));
        }
        const hReq = this.getHeightInModifier();
        if (hReq instanceof DimensionConstraintsModifier
            && hReq.getType() === DimensionConstraintsModifier.REQUIRED_VERTICAL) {
            h = Math.max(hReq.getMin(), Math.min(h, hReq.getMax()));
        }
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

    /** Whether the children's weights make this fill [horizontally, vertically]. */
    protected weightFill(): [boolean, boolean] { return [false, false]; }

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
