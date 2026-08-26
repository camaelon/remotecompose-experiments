// AnimateMeasure: interpolation manager between two ComponentMeasures.
// Port of Java AnimateMeasure.java.

import type { Component } from '../Component';
import { ComponentMeasure } from '../measure/ComponentMeasure';
import { ANIMATION } from './AnimationSpec';
import { CubicEasing } from '../../utilities/easing/CubicEasing';
import { Easing } from '../../utilities/easing/Easing';
import { PaintBundle } from '../../paint/PaintBundle';
import type { RemoteContext } from '../../../RemoteContext';
import type { PaintContext } from '../../../PaintContext';

export class AnimateMeasure {
    protected mStartTime: number;
    protected mComponent: Component;
    protected mOriginal: ComponentMeasure;
    protected mTarget: ComponentMeasure;
    protected mDuration: number;
    protected mDurationVisibilityChange: number;
    protected mEnterAnimation: ANIMATION;
    protected mExitAnimation: ANIMATION;
    protected mMotionEasingType: number;
    protected mVisibilityEasingType: number;

    protected mP = 0;
    protected mVp = 0;

    protected mMotionEasing: CubicEasing;
    protected mVisibilityEasing: CubicEasing;

    public paintBundle: PaintBundle = new PaintBundle();

    constructor(
        startTime: number,
        component: Component,
        original: ComponentMeasure,
        target: ComponentMeasure,
        duration: number,
        durationVisibilityChange: number,
        enterAnimation: ANIMATION = ANIMATION.FADE_IN,
        exitAnimation: ANIMATION = ANIMATION.FADE_OUT,
        motionEasingType: number = Easing.CUBIC_STANDARD,
        visibilityEasingType: number = Easing.CUBIC_ACCELERATE
    ) {
        this.mStartTime = startTime;
        this.mComponent = component;
        this.mOriginal = original;
        this.mTarget = target;
        this.mDuration = duration;
        this.mDurationVisibilityChange = durationVisibilityChange;
        this.mEnterAnimation = enterAnimation;
        this.mExitAnimation = exitAnimation;
        this.mMotionEasingType = motionEasingType;
        this.mVisibilityEasingType = visibilityEasingType;

        this.mMotionEasing = new CubicEasing(motionEasingType);
        this.mVisibilityEasing = new CubicEasing(visibilityEasingType);

        component.mVisibility = target.getVisibility();
    }

    update(currentTime: number): void {
        const elapsed = Math.max(0, currentTime - this.mStartTime);
        const motionProgress = this.mDuration > 0 ? Math.min(1, elapsed / this.mDuration) : 1;
        const visProgress = this.mDurationVisibilityChange > 0 ? Math.min(1, elapsed / this.mDurationVisibilityChange) : 1;

        this.mP = this.mMotionEasing.get(motionProgress);
        this.mVp = this.mVisibilityEasing.get(visProgress);
    }

    apply(context: RemoteContext): void {
        const time = context.mClock?.millis() ?? Date.now();
        this.update(time);
        this.mComponent.setX(this.getX());
        this.mComponent.setY(this.getY());
        this.mComponent.setWidth(this.getWidth());
        this.mComponent.setHeight(this.getHeight());
        if (typeof (this.mComponent as any).updateVariables === 'function') {
            (this.mComponent as any).updateVariables(context);
        }
    }

    paint(context: PaintContext): void {
        this.apply(context.getContext());
        const origVis = this.mOriginal.getVisibility();
        const targetVis = this.mTarget.getVisibility();

        if (origVis !== targetVis) {
            if (this.mTarget.isGone()) {
                // Exit animation
                switch (this.mExitAnimation) {
                    case ANIMATION.FADE_OUT: {
                        context.save();
                        context.savePaint();
                        this.paintBundle.reset();
                        this.paintBundle.setColor(Math.max(0, Math.min(1, 1 - this.mVp)), 0, 0, 0);
                        context.applyPaint(this.paintBundle);
                        context.saveLayer(
                            this.mComponent.getX(),
                            this.mComponent.getY(),
                            this.mComponent.getWidth(),
                            this.mComponent.getHeight()
                        );
                        this.mComponent.paintingComponent(context);
                        context.restore();
                        context.restorePaint();
                        context.restore();
                        break;
                    }
                    case ANIMATION.SLIDE_LEFT: {
                        const parentW = this.mComponent.getParent()?.getWidth() ?? context.getContext().mWidth;
                        context.save();
                        context.translate(-this.mVp * parentW, 0);
                        context.saveLayer(
                            this.mComponent.getX(),
                            this.mComponent.getY(),
                            this.mComponent.getWidth(),
                            this.mComponent.getHeight()
                        );
                        this.mComponent.paintingComponent(context);
                        context.restore();
                        context.restore();
                        break;
                    }
                    case ANIMATION.SLIDE_RIGHT: {
                        const parentW = this.mComponent.getParent()?.getWidth() ?? context.getContext().mWidth;
                        context.save();
                        context.translate(this.mVp * parentW, 0);
                        context.saveLayer(
                            this.mComponent.getX(),
                            this.mComponent.getY(),
                            this.mComponent.getWidth(),
                            this.mComponent.getHeight()
                        );
                        this.mComponent.paintingComponent(context);
                        context.restore();
                        context.restore();
                        break;
                    }
                    case ANIMATION.SLIDE_TOP: {
                        const parentH = this.mComponent.getParent()?.getHeight() ?? context.getContext().mHeight;
                        context.save();
                        context.translate(0, -this.mVp * parentH);
                        context.saveLayer(
                            this.mComponent.getX(),
                            this.mComponent.getY(),
                            this.mComponent.getWidth(),
                            this.mComponent.getHeight()
                        );
                        this.mComponent.paintingComponent(context);
                        context.restore();
                        context.restore();
                        break;
                    }
                    case ANIMATION.SLIDE_BOTTOM: {
                        const parentH = this.mComponent.getParent()?.getHeight() ?? context.getContext().mHeight;
                        context.save();
                        context.translate(0, this.mVp * parentH);
                        context.saveLayer(
                            this.mComponent.getX(),
                            this.mComponent.getY(),
                            this.mComponent.getWidth(),
                            this.mComponent.getHeight()
                        );
                        this.mComponent.paintingComponent(context);
                        context.restore();
                        context.restore();
                        break;
                    }
                    default: {
                        context.save();
                        context.savePaint();
                        this.paintBundle.reset();
                        this.paintBundle.setColor(Math.max(0, Math.min(1, 1 - this.mVp)), 0, 0, 0);
                        context.applyPaint(this.paintBundle);
                        context.saveLayer(
                            this.mComponent.getX(),
                            this.mComponent.getY(),
                            this.mComponent.getWidth(),
                            this.mComponent.getHeight()
                        );
                        this.mComponent.paintingComponent(context);
                        context.restore();
                        context.restorePaint();
                        context.restore();
                        break;
                    }
                }
            } else if (this.mOriginal.isGone() && !this.mTarget.isGone()) {
                // Enter animation
                switch (this.mEnterAnimation) {
                    case ANIMATION.ROTATE: {
                        const px = this.mTarget.getX() + this.mTarget.getW() / 2;
                        const py = this.mTarget.getY() + this.mTarget.getH() / 2;
                        context.save();
                        context.savePaint();
                        context.matrixRotate(this.mVp * 360, px, py);
                        context.matrixScale(this.mVp, this.mVp, px, py);
                        this.paintBundle.reset();
                        this.paintBundle.setColor(Math.max(0, Math.min(1, this.mVp)), 0, 0, 0);
                        context.applyPaint(this.paintBundle);
                        context.saveLayer(
                            this.mComponent.getX(),
                            this.mComponent.getY(),
                            this.mComponent.getWidth(),
                            this.mComponent.getHeight()
                        );
                        this.mComponent.paintingComponent(context);
                        context.restore();
                        context.restorePaint();
                        context.restore();
                        break;
                    }
                    case ANIMATION.FADE_IN: {
                        context.save();
                        context.savePaint();
                        this.paintBundle.reset();
                        this.paintBundle.setColor(Math.max(0, Math.min(1, this.mVp)), 0, 0, 0);
                        context.applyPaint(this.paintBundle);
                        context.saveLayer(
                            this.mComponent.getX(),
                            this.mComponent.getY(),
                            this.mComponent.getWidth(),
                            this.mComponent.getHeight()
                        );
                        this.mComponent.paintingComponent(context);
                        context.restore();
                        context.restorePaint();
                        context.restore();
                        break;
                    }
                    case ANIMATION.SLIDE_LEFT: {
                        const parentW = this.mComponent.getParent()?.getWidth() ?? context.getContext().mWidth;
                        context.save();
                        context.translate((1 - this.mVp) * parentW, 0);
                        context.saveLayer(
                            this.mComponent.getX(),
                            this.mComponent.getY(),
                            this.mComponent.getWidth(),
                            this.mComponent.getHeight()
                        );
                        this.mComponent.paintingComponent(context);
                        context.restore();
                        context.restore();
                        break;
                    }
                    case ANIMATION.SLIDE_RIGHT: {
                        const parentW = this.mComponent.getParent()?.getWidth() ?? context.getContext().mWidth;
                        context.save();
                        context.translate(-(1 - this.mVp) * parentW, 0);
                        context.saveLayer(
                            this.mComponent.getX(),
                            this.mComponent.getY(),
                            this.mComponent.getWidth(),
                            this.mComponent.getHeight()
                        );
                        this.mComponent.paintingComponent(context);
                        context.restore();
                        context.restore();
                        break;
                    }
                    case ANIMATION.SLIDE_TOP: {
                        const parentH = this.mComponent.getParent()?.getHeight() ?? context.getContext().mHeight;
                        context.save();
                        context.translate(0, (1 - this.mVp) * parentH);
                        context.saveLayer(
                            this.mComponent.getX(),
                            this.mComponent.getY(),
                            this.mComponent.getWidth(),
                            this.mComponent.getHeight()
                        );
                        this.mComponent.paintingComponent(context);
                        context.restore();
                        context.restore();
                        break;
                    }
                    case ANIMATION.SLIDE_BOTTOM: {
                        const parentH = this.mComponent.getParent()?.getHeight() ?? context.getContext().mHeight;
                        context.save();
                        context.translate(0, -(1 - this.mVp) * parentH);
                        context.saveLayer(
                            this.mComponent.getX(),
                            this.mComponent.getY(),
                            this.mComponent.getWidth(),
                            this.mComponent.getHeight()
                        );
                        this.mComponent.paintingComponent(context);
                        context.restore();
                        context.restore();
                        break;
                    }
                    default: {
                        this.mComponent.paintingComponent(context);
                        break;
                    }
                }
            } else {
                this.mComponent.paintingComponent(context);
            }
        } else if (!this.mTarget.isGone()) {
            this.mComponent.paintingComponent(context);
        }

        if (this.mP >= 1 && this.mVp >= 1) {
            this.mComponent.mVisibility = this.mTarget.getVisibility();
            this.mComponent.setX(this.mTarget.getX());
            this.mComponent.setY(this.mTarget.getY());
            this.mComponent.setWidth(this.mTarget.getW());
            this.mComponent.setHeight(this.mTarget.getH());
        }
    }

    isDone(): boolean {
        return this.mP >= 1 && this.mVp >= 1;
    }

    getX(): number {
        return this.mOriginal.getX() * (1 - this.mP) + this.mTarget.getX() * this.mP;
    }

    getY(): number {
        return this.mOriginal.getY() * (1 - this.mP) + this.mTarget.getY() * this.mP;
    }

    getWidth(): number {
        return this.mOriginal.getW() * (1 - this.mP) + this.mTarget.getW() * this.mP;
    }

    getHeight(): number {
        return this.mOriginal.getH() * (1 - this.mP) + this.mTarget.getH() * this.mP;
    }

    getVisibility(): number {
        if (this.mOriginal.getVisibility() === this.mTarget.getVisibility()) {
            return 1;
        } else if (!this.mTarget.isGone()) {
            return this.mVp;
        } else {
            return 1 - this.mVp;
        }
    }

    updateTarget(context: RemoteContext, measure: ComponentMeasure, currentTime: number): void {
        const currentX = this.getX();
        const currentY = this.getY();
        const currentW = this.getWidth();
        const currentH = this.getHeight();

        this.mOriginal.setX(currentX);
        this.mOriginal.setY(currentY);
        this.mOriginal.setW(currentW);
        this.mOriginal.setH(currentH);

        const targetX = measure.getX();
        const targetY = measure.getY();
        const targetW = measure.getW();
        const targetH = measure.getH();
        const targetVisibility = measure.getVisibility();

        if (
            this.mTarget.getX() !== targetX ||
            this.mTarget.getY() !== targetY ||
            this.mTarget.getW() !== targetW ||
            this.mTarget.getH() !== targetH ||
            this.mTarget.getVisibility() !== targetVisibility
        ) {
            this.mTarget.setX(targetX);
            this.mTarget.setY(targetY);
            this.mTarget.setW(targetW);
            this.mTarget.setH(targetH);
            this.mTarget.setVisibility(targetVisibility);
            this.mStartTime = currentTime;
            this.mP = 0;
            this.mVp = 0;
        }
    }

    getOriginal(): ComponentMeasure { return this.mOriginal; }
    getTarget(): ComponentMeasure { return this.mTarget; }
}
