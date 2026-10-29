// StateLayout: state-based layout manager that switches between child layouts.
// Port of Java StateLayout.java: measures and paints the current state, and animates the
// switch (shared components move from their previous bounds, the others exit and enter).

import { LayoutManager } from './LayoutManager';
import { LayoutComponent } from '../LayoutComponent';
import { Component, Visibility } from '../Component';
import type { Operation } from '../../../Operation';
import type { WireBuffer } from '../../../WireBuffer';
import type { RemoteContext } from '../../../RemoteContext';
import type { PaintContext } from '../../../PaintContext';
import type { MeasurePass } from '../measure/MeasurePass';
import type { Size } from '../measure/Size';

export class StateLayout extends LayoutManager {
    static readonly OP_CODE = 217;

    private mIndexId: number;
    measuredLayoutIndex = 0;
    currentLayoutIndex = 0;
    previousLayoutIndex = 0;
    inTransition = false;
    private mIndexInitialized = false;

    // For each animation id, its component in each state (StateLayout.statePaintedComponents).
    statePaintedComponents = new Map<number, (Component | null)[]>();

    constructor(componentId: number, animationId: number, indexId: number) {
        super(componentId, animationId);
        this.mIndexId = indexId;
    }

    inflate(): void {
        super.inflate();
        this.hideLayoutsOtherThan(this.currentLayoutIndex);
    }

    private collectAnimatedComponents(component: Component, out: Component[]): void {
        if (component.getAnimationId() !== -1) out.push(component);
        if (component instanceof LayoutComponent) {
            for (const child of component.mChildrenComponents) this.collectAnimatedComponents(child, out);
        }
    }

    private getAnimatedComponentsIn(root: Component | null): Component[] {
        const list: Component[] = [];
        if (root) this.collectAnimatedComponents(root, list);
        return list;
    }

    /**
     * Identify the animated components across states. (The reference then collapses the
     * components of identical states into one, but only when Component.suitableForTransition
     * holds, which the ComponentModifiers every layout component carries never are: it is
     * never done.)
     */
    findAnimatedComponents(): void {
        const n = this.mChildrenComponents.length;
        for (let i = 0; i < n; i++) {
            const state = this.mChildrenComponents[i];
            if (!(state instanceof LayoutComponent)) continue;
            state.setX(0);
            state.setY(0);
            for (const child of this.getAnimatedComponentsIn(state)) {
                let list = this.statePaintedComponents.get(child.getAnimationId());
                if (!list) {
                    list = new Array(n).fill(null);
                    this.statePaintedComponents.set(child.getAnimationId(), list);
                }
                list[i] = child;
            }
        }
    }

    /** The shared component for an animation id in a state, if any. */
    getSharedComponent(animationId: number, stateIndex: number): Component | null {
        const list = this.statePaintedComponents.get(animationId);
        return list && stateIndex >= 0 && stateIndex < list.length ? list[stateIndex] : null;
    }

    computeWrapSize(context: PaintContext, minWidth: number, maxWidth: number,
                    minHeight: number, maxHeight: number,
                    horizontalWrap: boolean, verticalWrap: boolean,
                    measure: MeasurePass, size: Size): void {
        this.getLayout(this.currentLayoutIndex)?.computeWrapSize(context, minWidth, maxWidth,
            minHeight, maxHeight, horizontalWrap, verticalWrap, measure, size);
    }

    computeSize(context: PaintContext, minWidth: number, maxWidth: number,
                minHeight: number, maxHeight: number, measure: MeasurePass): void {
        this.getLayout(this.currentLayoutIndex)?.computeSize(context, minWidth, maxWidth,
            minHeight, maxHeight, measure);
    }

    internalLayoutMeasure(context: PaintContext, measure: MeasurePass): void {
        this.getLayout(this.currentLayoutIndex)?.internalLayoutMeasure(context, measure);
    }

    /**
     * StateLayout.onClick: only the current state receives the tap. TS click coordinates are
     * parent-relative (LayoutComponent.onClick hands its children x - mX - paddingLeft), so
     * the bounds test is against our own box and the state gets our content coordinates.
     * This used to call `contains(context, x, y)` — TS `contains` is `(x, y)` in window
     * space, so the context landed in x, the test always failed and no state was tappable.
     */
    onClick(context: RemoteContext, document: any, x: number, y: number): boolean {
        if (x < this.mX || x > this.mX + this.mWidth || y < this.mY || y > this.mY + this.mHeight) return false;
        const layout = this.getLayout(this.currentLayoutIndex) as any;
        if (!layout || typeof layout.onClick !== 'function') return false;
        return layout.onClick(context, document, x - this.mX - this.mPaddingLeft, y - this.mY - this.mPaddingTop);
    }

    /**
     * StateLayout.measure: only the current state is measured, with the constraints the
     * StateLayout was given (its own modifiers play no part in its size), and the StateLayout
     * takes that state's measure.
     */
    measure(context: PaintContext, minWidth: number, maxWidth: number,
            minHeight: number, maxHeight: number, measure: MeasurePass): void {
        if (!this.mIndexInitialized) {
            // The reference starts from state 0 and switches on its first paint (which, with
            // animations on, plays the first state's exit); this starts at the index as is.
            this.mIndexInitialized = true;
            if (this.mIndexId !== 0) {
                const v = context.getContext().mRemoteComposeState.getInteger(this.mIndexId);
                this.currentLayoutIndex = this.previousLayoutIndex = this.measuredLayoutIndex = v;
                this.hideLayoutsOtherThan(v);
            }
        }
        if (this.statePaintedComponents.size === 0) this.findAnimatedComponents();

        const layout = this.getLayout(this.currentLayoutIndex);
        if (!layout) {
            super.measure(context, minWidth, maxWidth, minHeight, maxHeight, measure);
            return;
        }
        layout.setVisibility(Visibility.VISIBLE);
        measure.get(layout).setVisibility(Visibility.VISIBLE);
        layout.measure(context, minWidth, maxWidth, minHeight, maxHeight, measure);

        // After the measure, the new state's components that share an animation id with one
        // of the previous state start from that one's bounds.
        if (this.inTransition && this.currentLayoutIndex !== this.previousLayoutIndex) {
            const previousLayout = this.getLayout(this.previousLayoutIndex);
            const previousAnimated = this.getAnimatedComponentsIn(previousLayout);
            for (const c of this.getAnimatedComponentsIn(layout)) {
                const id = c.getAnimationId();
                if (!previousAnimated.some((pc) => pc.getAnimationId() === id)) continue;
                const prev = this.statePaintedComponents.get(id)?.[this.previousLayoutIndex] ?? null;
                if (prev && c !== prev) {
                    c.mFirstLayout = false;
                    c.setX(prev.getX());
                    c.setY(prev.getY());
                    c.setWidth(prev.getWidth());
                    c.setHeight(prev.getHeight());
                }
            }
        }

        // Recopy to the animation ids: the measure of each animated component of the current
        // state goes to the animation id (in the same MeasurePass as the components, so a
        // component whose id equals an animation id gets it too) and to the components
        // sharing the id in the other states, measured at exactly that size.
        for (const c of this.getAnimatedComponentsIn(layout)) {
            const cm = measure.get(c);
            cm.setVisibility(Visibility.VISIBLE);
            c.setVisibility(Visibility.VISIBLE);
            const m = measure.get(c.getAnimationId());
            m.copyFrom(cm);
            m.setVisibility(Visibility.VISIBLE);
            for (const ac of this.statePaintedComponents.get(c.getAnimationId()) ?? []) {
                if (!ac) continue;
                const m2 = measure.get(ac.getComponentId());
                if (c !== ac) m2.copyFrom(cm);
                m2.setVisibility(Visibility.VISIBLE);
                ac.setVisibility(Visibility.VISIBLE);
                if (c !== ac) ac.measure(context, cm.getW(), cm.getW(), cm.getH(), cm.getH(), measure);
            }
        }

        // The previous state's children not in the new one are GONE, at their bounds.
        if (this.previousLayoutIndex !== this.currentLayoutIndex) {
            const previousLayout = this.getLayout(this.previousLayoutIndex);
            // A component whose id is also in the new state shares its measure (keyed by id)
            // and the new state's one wins: the reference re-measures that subtree on its own
            // once its state is laid out (a relayout boundary).
            const currentIds = new Set<number>();
            const walk = (c: Component) => {
                currentIds.add(c.getComponentId());
                if (c instanceof LayoutComponent) c.mChildrenComponents.forEach(walk);
            };
            walk(layout);
            for (const c of previousLayout?.mChildrenComponents ?? []) {
                if (currentIds.has(c.getComponentId())) continue;
                let inNewLayout = false;
                if (c.getAnimationId() !== -1) {
                    const rc = this.statePaintedComponents.get(c.getAnimationId());
                    inNewLayout = !!rc && this.currentLayoutIndex < rc.length && rc[this.currentLayoutIndex] !== null;
                }
                if (!inNewLayout) {
                    const m = measure.get(c.getComponentId());
                    m.setX(c.getX());
                    m.setY(c.getY());
                    m.setW(c.getWidth());
                    m.setH(c.getHeight());
                    m.setVisibility(Visibility.GONE);
                }
            }
        }

        measure.get(this).copyFrom(measure.get(layout));
        this.measuredLayoutIndex = this.currentLayoutIndex;
    }

    layout(context: RemoteContext, measure: MeasurePass): void {
        // selfLayout: this component alone (Component.layout), then its modifiers.
        Component.prototype.layout.call(this, context, measure);
        this.updateComponentValues(context, this.mWidth, this.mHeight);
        const self = measure.get(this);
        this.layoutModifiers(self.getW(), self.getH());

        const layout = this.getLayout(this.currentLayoutIndex);
        if (layout) {
            const layoutMeasure = measure.get(layout.getComponentId());
            layoutMeasure.copyFrom(self);
            layoutMeasure.setX(0);
            layoutMeasure.setY(0);
            layout.layout(context, measure);
        }

        // In a transition the previous state's children are laid out too (their exit, or
        // their move to the bounds of the shared components).
        if (this.inTransition && this.previousLayoutIndex !== this.currentLayoutIndex) {
            const previous = this.getLayout(this.previousLayoutIndex);
            for (const c of previous?.mChildrenComponents ?? []) {
                let id = c.getComponentId();
                if (c.getAnimationId() !== -1) {
                    id = c.getAnimationId();
                    for (const ac of this.statePaintedComponents.get(id) ?? []) {
                        if (ac) ac.layout(context, measure);
                    }
                }
                if (measure.contains(id)) c.layout(context, measure);
            }
        }
        this.mNeedsMeasure = false;
        this.mFirstLayout = false;
    }

    paint(paintContext: PaintContext): void {
        if (this.mIndexId !== 0) {
            const newValue = paintContext.getContext().mRemoteComposeState.getInteger(this.mIndexId);
            if (newValue !== this.currentLayoutIndex) {
                this.previousLayoutIndex = this.currentLayoutIndex;
                this.currentLayoutIndex = newValue;
                this.inTransition = true;
                this.invalidateMeasure();
                paintContext.needsRepaint();
            }
        }
        // The states that are neither the current nor the previous one are GONE.
        let index = 0;
        for (const pane of this.mChildrenComponents) {
            if (pane instanceof LayoutComponent) {
                if (index !== this.currentLayoutIndex && index !== this.previousLayoutIndex) {
                    pane.mVisibility = Visibility.GONE;
                }
                if (index === this.currentLayoutIndex && !pane.isVisible()) {
                    pane.mVisibility = Visibility.VISIBLE;
                }
                index++;
            }
        }

        const currentLayout = this.getLayout(this.measuredLayoutIndex);
        if (!currentLayout) return;
        const needsToPaintTransition = this.inTransition
            && this.previousLayoutIndex !== this.measuredLayoutIndex;

        // The reference paints the states at the StateLayout's parent's origin (it does not
        // translate by its own position, nor paint its own modifiers); the states are placed
        // here at the StateLayout's position, where its layout puts them.
        paintContext.save();
        paintContext.translate(this.mX, this.mY);
        if (needsToPaintTransition) {
            // The previous state's children that are not in the new one (by paint id) are
            // painted first, for their exit animation.
            const previousLayout = this.getLayout(this.previousLayoutIndex);
            if (previousLayout) {
                const paintId = (c: Component) => (c.getAnimationId() !== -1 ? c.getAnimationId() : c.getComponentId());
                const current = new Set(currentLayout.mChildrenComponents.map(paintId));
                const leaving = previousLayout.mChildrenComponents.filter((c) => !current.has(paintId(c)));
                if (leaving.length > 0) {
                    paintContext.save();
                    paintContext.translate(previousLayout.getX(), previousLayout.getY());
                    for (const c of leaving) c.paint(paintContext);
                    paintContext.restore();
                }
            }
        }
        currentLayout.paint(paintContext);
        paintContext.restore();

        if (needsToPaintTransition) this.checkEndOfTransition(paintContext);
    }

    private isLayoutAnimating(layout: LayoutManager | null): boolean {
        if (!layout) return false;
        if (layout.mAnimateMeasure !== null && !layout.mAnimateMeasure.isDone()) return true;
        for (const c of layout.mChildrenComponents) {
            if (c.mAnimateMeasure !== null && !c.mAnimateMeasure.isDone()) return true;
            if (c instanceof LayoutManager && this.isLayoutAnimating(c)) return true;
        }
        return false;
    }

    /** At the end of the transition the previous state goes. */
    checkEndOfTransition(paintContext?: PaintContext): void {
        const currentLayout = this.getLayout(this.measuredLayoutIndex);
        const previousLayout = this.getLayout(this.previousLayoutIndex);
        if (this.inTransition && !this.isLayoutAnimating(currentLayout)
            && !this.isLayoutAnimating(previousLayout)) {
            this.inTransition = false;
            if (previousLayout && previousLayout !== currentLayout && !previousLayout.isGone()) {
                previousLayout.mVisibility = Visibility.GONE;
            }
        } else if (this.inTransition) {
            this.mNeedsRepaint = true;
            paintContext?.needsRepaint();
        }
    }

    /** Returns the idx-th LayoutComponent child (the first child when out of range). */
    getLayout(idx: number): LayoutManager | null {
        let index = 0;
        for (const pane of this.mChildrenComponents) {
            if (pane instanceof LayoutComponent) {
                if (index === idx) return pane as LayoutManager;
                index++;
            }
        }
        if (this.mChildrenComponents.length > 0 && this.mChildrenComponents[0] instanceof LayoutComponent) {
            return this.mChildrenComponents[0] as LayoutManager;
        }
        return null;
    }

    /** Hides all layout children except the one at idx */
    hideLayoutsOtherThan(idx: number): void {
        let index = 0;
        for (const pane of this.mChildrenComponents) {
            if (pane instanceof LayoutComponent) {
                pane.mVisibility = (index === idx) ? Visibility.VISIBLE : Visibility.GONE;
                index++;
            }
        }
    }

    write(buffer: WireBuffer): void {
        buffer.start(StateLayout.OP_CODE);
        buffer.writeInt(this.getComponentId());
        buffer.writeInt(0); // animationId
        buffer.writeInt(0); // horizontalPositioning
        buffer.writeInt(0); // verticalPositioning
        buffer.writeInt(this.mIndexId);
    }

    apply(context: RemoteContext): void { super.apply(context); }

    deepToString(indent: string): string {
        return `${indent}StateLayout(${this.getComponentId()}, index=${this.mIndexId})`;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const componentId = buffer.declareId();
        const animationId = buffer.declareId();
        buffer.readInt(); // horizontalPositioning
        buffer.readInt(); // verticalPositioning
        const indexId = buffer.readId();
        operations.push(new StateLayout(componentId, animationId, indexId));
    }
}
