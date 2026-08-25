// Component: base class for layout components in the component tree.
// Port of Java Component.java — extends PaintOperation, implements Container, Measurable.

import { PaintOperation } from '../../PaintOperation';
import type { PaintContext } from '../../PaintContext';
import type { Operation } from '../../Operation';
import type { Container } from './Container';
import type { RemoteContext } from '../../RemoteContext';
import { ContextMode } from '../../RemoteContext';
import type { WireBuffer } from '../../WireBuffer';
import type { MeasurePass } from './measure/MeasurePass';
import { TouchExpression } from '../TouchExpression';
import { ComponentMeasure } from './measure/ComponentMeasure';
import { AnimationSpec, ANIMATION } from './animation/AnimationSpec';
import { AnimateMeasure } from './animation/AnimateMeasure';

export class Visibility {
    // Matches Java Component.Visibility encoding
    static readonly GONE = 0;
    static readonly VISIBLE = 1;
    static readonly INVISIBLE = 2;
    static readonly OVERRIDE_GONE = 16;
    static readonly OVERRIDE_VISIBLE = 32;
    static readonly OVERRIDE_INVISIBLE = 64;
    static readonly CLEAR_OVERRIDE = 128;

    static isGone(v: number): boolean {
        if ((v >> 4) > 0) return (v & Visibility.OVERRIDE_GONE) === Visibility.OVERRIDE_GONE;
        return v === Visibility.GONE;
    }
    static isVisible(v: number): boolean {
        if ((v >> 4) > 0) return (v & Visibility.OVERRIDE_VISIBLE) === Visibility.OVERRIDE_VISIBLE;
        return v === Visibility.VISIBLE;
    }
    static isInvisible(v: number): boolean {
        if ((v >> 4) > 0) return (v & Visibility.OVERRIDE_INVISIBLE) === Visibility.OVERRIDE_INVISIBLE;
        return v === Visibility.INVISIBLE;
    }
    static hasOverride(v: number): boolean { return (v >> 4) > 0; }
    static clearOverride(v: number): number { return v & 15; }
    static add(v: number, override: number): number {
        let result = (v & 15) + override;
        if ((result & Visibility.CLEAR_OVERRIDE) === Visibility.CLEAR_OVERRIDE) {
            result = result & 15;
        }
        return result;
    }
}

export class Component extends PaintOperation implements Container {
    mComponentId: number;
    mAnimationId = -1;
    mParent: Component | null = null;
    mChildren: Operation[] = [];

    // Position & dimensions
    mX = 0;
    mY = 0;
    mWidth = 0;
    mHeight = 0;
    mZIndex = 0;
    mVisibility = Visibility.VISIBLE;
    mNeedsMeasure = true;
    mNeedsRepaint = true;
    mFirstLayout = true;

    mAnimationSpec: AnimationSpec = AnimationSpec.DEFAULT;
    mAnimateMeasure: AnimateMeasure | null = null;
    mNeedsBoundsAnimation = false;

    constructor(componentId: number, animationId = -1,
                x = 0, y = 0, width = 0, height = 0) {
        super();
        this.mComponentId = componentId;
        this.mAnimationId = animationId;
        this.mX = x; this.mY = y;
        this.mWidth = width; this.mHeight = height;
    }

    getComponentId(): number { return this.mComponentId; }
    setComponentId(id: number): void { this.mComponentId = id; }
    getAnimationId(): number { return this.mAnimationId; }
    setAnimationId(id: number): void { this.mAnimationId = id; }

    getParent(): Component | null { return this.mParent; }
    setParent(parent: Component): void { this.mParent = parent; }
    getList(): Operation[] { return this.mChildren; }

    getX(): number { return this.mX; }
    setX(v: number): void { this.mX = v; }
    getY(): number { return this.mY; }
    setY(v: number): void { this.mY = v; }
    getWidth(): number { return this.mWidth; }
    setWidth(v: number): void { this.mWidth = v; }
    getHeight(): number { return this.mHeight; }
    setHeight(v: number): void { this.mHeight = v; }
    getZIndex(): number { return this.mZIndex; }

    getScrollX(): number { return 0; }
    getScrollY(): number { return 0; }

    needsMeasure(): boolean { return this.mNeedsMeasure; }
    invalidateMeasure(): void {
        this.mNeedsMeasure = true;
        if (this.mParent) this.mParent.invalidateMeasure();
    }
    clearNeedsMeasure(): void { this.mNeedsMeasure = false; }

    needsRepaint(): boolean { return this.mNeedsRepaint; }
    doesNeedsRepaint(): boolean { return this.mNeedsRepaint; }
    setNeedsRepaint(v: boolean): void { this.mNeedsRepaint = v; }

    needsBoundsAnimation(): boolean {
        return this.mNeedsBoundsAnimation;
    }

    markNeedsBoundsAnimation(): void {
        this.mNeedsBoundsAnimation = true;
        if (this.mParent) {
            this.mParent.markNeedsBoundsAnimation();
        }
    }

    clearNeedsBoundsAnimation(): void {
        this.mNeedsBoundsAnimation = false;
    }

    isVisible(): boolean {
        if (Visibility.isGone(this.mVisibility)) return false;
        if (this.mParent) return this.mParent.isVisible();
        return true;
    }
    isGone(): boolean { return Visibility.isGone(this.mVisibility); }
    getVisibility(): number { return this.mVisibility; }

    setVisibility(v: number): void {
        if (v === this.mVisibility) return;
        this.mVisibility = v;
        this.invalidateMeasure();
        // A child becoming GONE changes the *parent's* layout, so the parent has to
        // re-measure too — matching Component.setVisibility in the reference.
        if (this.mParent) this.mParent.invalidateMeasure();
    }

    inflate(): void {
        // Set parent references for child components & extract AnimationSpec
        for (const op of this.mChildren) {
            if (op instanceof AnimationSpec) {
                this.mAnimationSpec = op;
                this.mAnimationId = op.getAnimationId();
            }
            if (op instanceof Component) {
                op.setParent(this);
            }
        }
    }

    // --- Intrinsic size (matches Java Component.minIntrinsicHeight/Width) ---

    minIntrinsicHeight(): number {
        let height = 0;
        for (const op of this.mChildren) {
            if (op instanceof Component) {
                height = Math.max(height, op.minIntrinsicHeight());
            }
        }
        return height;
    }

    minIntrinsicWidth(): number {
        let width = 0;
        for (const op of this.mChildren) {
            if (op instanceof Component) {
                width = Math.max(width, op.minIntrinsicWidth());
            }
        }
        return width;
    }

    // --- Measure/Layout ---

    measure(_context: PaintContext, _minWidth: number, _maxWidth: number,
            _minHeight: number, _maxHeight: number, measure: MeasurePass): void {
        const m = measure.get(this);
        m.setW(this.mWidth);
        m.setH(this.mHeight);
    }

    layout(context: RemoteContext, measure: MeasurePass): void {
        const m = measure.get(this);
        const allowAnimation = !this.mFirstLayout &&
            context.isAnimationEnabled() &&
            this.mAnimationSpec.isAnimationEnabled() &&
            m.getAllowsAnimation();

        if (allowAnimation) {
            if (this.mAnimateMeasure === null) {
                const origin = new ComponentMeasure(this.mComponentId, this.mX, this.mY, this.mWidth, this.mHeight, this.mVisibility);
                const target = new ComponentMeasure(this.mComponentId, m.getX(), m.getY(), m.getW(), m.getH(), m.getVisibility());
                if (!target.same(origin)) {
                    const now = context.mClock?.millis() ?? Date.now();
                    this.mAnimateMeasure = new AnimateMeasure(
                        now,
                        this,
                        origin,
                        target,
                        this.mAnimationSpec.getMotionDuration(),
                        this.mAnimationSpec.getVisibilityDuration(),
                        this.mAnimationSpec.getEnterAnimation(),
                        this.mAnimationSpec.getExitAnimation(),
                        this.mAnimationSpec.getMotionEasingType(),
                        this.mAnimationSpec.getVisibilityEasingType()
                    );
                }
            } else {
                const now = context.mClock?.millis() ?? Date.now();
                this.mAnimateMeasure.updateTarget(context, m, now);
            }
        } else {
            this.mAnimateMeasure = null;
        }

        if (this.mAnimateMeasure === null) {
            this.mVisibility = m.getVisibility();
            this.mX = m.getX();
            this.mY = m.getY();
            this.mWidth = m.getW();
            this.mHeight = m.getH();
            if (this.mParent) {
                this.clearNeedsBoundsAnimation();
            }
        } else {
            this.mAnimateMeasure.apply(context);
            this.markNeedsBoundsAnimation();
        }
        this.mFirstLayout = false;
    }

    animatingBounds(context: RemoteContext): void {
        if (!context.isAnimationEnabled()) {
            this.mAnimateMeasure = null;
            if (this.mParent) {
                this.clearNeedsBoundsAnimation();
            }
        } else if (this.mAnimateMeasure !== null) {
            this.mAnimateMeasure.apply(context);
            if (this.mAnimateMeasure.isDone()) {
                this.mAnimateMeasure = null;
                if (this.mParent) {
                    this.clearNeedsBoundsAnimation();
                }
            } else {
                this.markNeedsBoundsAnimation();
            }
        } else {
            if (this.mParent) {
                this.clearNeedsBoundsAnimation();
            }
        }
        for (const op of this.mChildren) {
            if (op instanceof Component) {
                op.animatingBounds(context);
            }
        }
    }

    // --- Paint ---

    applyAnimationAsNeeded(paintContext: PaintContext): boolean {
        if (!paintContext.isAnimationEnabled()) {
            if (this.mAnimateMeasure !== null) {
                this.mAnimateMeasure = null;
                if (this.mParent) {
                    this.clearNeedsBoundsAnimation();
                }
            }
            return false;
        }
        if (this.mAnimateMeasure !== null) {
            this.mAnimateMeasure.paint(paintContext);
            if (this.mAnimateMeasure.isDone()) {
                this.mAnimateMeasure = null;
                if (this.mParent) {
                    this.clearNeedsBoundsAnimation();
                }
                paintContext.needsRepaint();
            } else {
                this.markNeedsBoundsAnimation();
                paintContext.needsRepaint();
            }
            return true;
        }
        return false;
    }

    paint(paintContext: PaintContext): void {
        if (this.applyAnimationAsNeeded(paintContext)) {
            return;
        }
        if (Visibility.isGone(this.mVisibility)) return;
        if (Visibility.isInvisible(this.mVisibility)) return;
        this.paintingComponent(paintContext);
    }

    paintingComponent(paintContext: PaintContext): void {
        const context = paintContext.getContext();
        paintContext.matrixSave();
        paintContext.matrixTranslate(this.mX, this.mY);

        for (const op of this.mChildren) {
            context.incrementOpCount(op);
            if (op.isDirty() && typeof (op as any).updateVariables === 'function') {
                op.markNotDirty();
                (op as any).updateVariables(context);
            }
            op.apply(context);
        }

        paintContext.matrixRestore();
    }

    apply(context: RemoteContext): void {
        // Update child variables before delegating (matches Java Component.apply)
        for (const op of this.mChildren) {
            if (op.isDirty() && typeof (op as any).updateVariables === 'function') {
                op.markNotDirty();
                (op as any).updateVariables(context);
            }
        }
        super.apply(context);
    }

    // --- Touch/Input ---

    onClick(context: RemoteContext, doc: any, x: number, y: number): boolean {
        // Iterate children in reverse z-order
        for (let i = this.mChildren.length - 1; i >= 0; i--) {
            const child = this.mChildren[i];
            if (child instanceof Component) {
                if (child.onClick(context, doc, x, y)) return true;
            }
        }
        return false;
    }

    onTouchDown(context: RemoteContext, doc: any, x: number, y: number): boolean {
        if (!this.contains(x, y)) return false;
        const loc = this.getLocationInWindow();
        const lx = x - loc[0];
        const ly = y - loc[1];
        let handled = false;
        let componentHandled = false;
        for (let i = this.mChildren.length - 1; i >= 0; i--) {
            const op = this.mChildren[i];
            if (op instanceof Component) {
                if (!componentHandled && op.onTouchDown(context, doc, x, y)) {
                    componentHandled = true;
                }
            } else if (op instanceof TouchExpression) {
                op.updateVariables(context);
                op.touchDown(context, lx, ly);
                doc.appliedTouchOperation(this);
                handled = true;
            }
        }
        return componentHandled || handled;
    }

    onTouchDrag(context: RemoteContext, doc: any, x: number, y: number, force: boolean): boolean {
        if (!force && !this.contains(x, y)) return false;
        const loc = this.getLocationInWindow();
        const lx = x - loc[0];
        const ly = y - loc[1];
        let handled = false;
        let componentHandled = false;
        for (let i = this.mChildren.length - 1; i >= 0; i--) {
            const op = this.mChildren[i];
            if (op instanceof Component) {
                if (!componentHandled && op.onTouchDrag(context, doc, x, y, force)) {
                    componentHandled = true;
                }
            } else if (op instanceof TouchExpression) {
                op.updateVariables(context);
                op.touchDrag(context, lx, ly);
                handled = true;
            }
        }
        return componentHandled || handled;
    }

    onTouchUp(context: RemoteContext, doc: any, x: number, y: number,
              dx: number, dy: number, force: boolean): boolean {
        if (!force && !this.contains(x, y)) return false;
        const loc = this.getLocationInWindow();
        const lx = x - loc[0];
        const ly = y - loc[1];
        let handled = false;
        let componentHandled = false;
        for (let i = this.mChildren.length - 1; i >= 0; i--) {
            const op = this.mChildren[i];
            if (op instanceof Component) {
                if (!componentHandled && op.onTouchUp(context, doc, x, y, dx, dy, force)) {
                    componentHandled = true;
                }
            } else if (op instanceof TouchExpression) {
                op.updateVariables(context);
                op.touchUp(context, lx, ly, dx, dy);
                handled = true;
            }
        }
        return componentHandled || handled;
    }

    onTouchCancel(context: RemoteContext, doc: any, x: number, y: number, force: boolean): boolean {
        if (!force && !this.contains(x, y)) return false;
        const loc = this.getLocationInWindow();
        const lx = x - loc[0];
        const ly = y - loc[1];
        let handled = false;
        let componentHandled = false;
        for (let i = this.mChildren.length - 1; i >= 0; i--) {
            const op = this.mChildren[i];
            if (op instanceof Component) {
                if (!componentHandled && op.onTouchCancel(context, doc, x, y, force)) {
                    componentHandled = true;
                }
            } else if (op instanceof TouchExpression) {
                op.updateVariables(context);
                op.touchUp(context, lx, ly, 0, 0);
                handled = true;
            }
        }
        return componentHandled || handled;
    }

    // --- Utility ---

    contains(x: number, y: number): boolean {
        const loc = this.getLocationInWindow();
        return x >= loc[0] && x <= loc[0] + this.mWidth
            && y >= loc[1] && y <= loc[1] + this.mHeight;
    }

    getLocationInWindow(): [number, number] {
        let x = this.mX;
        let y = this.mY;
        let parent = this.mParent;
        while (parent) {
            x += parent.mX;
            y += parent.mY;
            parent = parent.getParent();
        }
        return [x, y];
    }

    getRoot(): Component {
        let c: Component = this;
        while (c.mParent) c = c.mParent;
        return c;
    }

    getComponent(id: number): Component | null {
        if (this.mComponentId === id) return this;
        for (const child of this.mChildren) {
            if (child instanceof Component) {
                const found = child.getComponent(id);
                if (found) return found;
            }
        }
        return null;
    }

    addComponentValue(_v: any): void { /* override */ }
    registerVariables(_context: RemoteContext): void { /* override */ }
    updateVariables(_context: RemoteContext): void { /* override */ }

    selfOrModifier<T>(cls: new (...args: any[]) => T): T | null {
        for (const op of this.mChildren) {
            if (op instanceof cls) return op;
        }
        return null;
    }

    hasComputedLayout(): boolean { return false; }
    applyComputedLayout(_type: number, _context: PaintContext,
                        _m: any, _parent: any): boolean { return false; }

    write(_buffer: WireBuffer): void { /* stub */ }
    deepToString(indent: string): string {
        return `${indent}Component(${this.mComponentId})`;
    }
}
