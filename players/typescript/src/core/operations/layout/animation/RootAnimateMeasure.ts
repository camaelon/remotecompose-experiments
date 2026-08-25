// RootAnimateMeasure: specialized AnimateMeasure for root component origin transitions.
// Port of Java RootAnimateMeasure.java.

import { AnimateMeasure } from './AnimateMeasure';
import type { Component } from '../Component';
import type { ComponentMeasure } from '../measure/ComponentMeasure';
import type { ANIMATION } from './AnimationSpec';
import type { RemoteContext } from '../../../RemoteContext';
import type { PaintContext } from '../../../PaintContext';

export class RootAnimateMeasure extends AnimateMeasure {
    protected mOriginalOriginX: number;
    protected mOriginalOriginY: number;
    protected mTargetOriginX: number;
    protected mTargetOriginY: number;
    private mRootInterpolatedX = 0;
    private mRootInterpolatedY = 0;

    constructor(
        startTime: number,
        component: Component,
        original: ComponentMeasure,
        target: ComponentMeasure,
        originalOriginX: number,
        originalOriginY: number,
        targetOriginX: number,
        targetOriginY: number,
        duration: number,
        durationVisibilityChange: number,
        enterAnimation: ANIMATION,
        exitAnimation: ANIMATION,
        motionEasingType: number,
        visibilityEasingType: number
    ) {
        super(
            startTime,
            component,
            original,
            target,
            duration,
            durationVisibilityChange,
            enterAnimation,
            exitAnimation,
            motionEasingType,
            visibilityEasingType
        );
        this.mOriginalOriginX = originalOriginX;
        this.mOriginalOriginY = originalOriginY;
        this.mTargetOriginX = targetOriginX;
        this.mTargetOriginY = targetOriginY;
    }

    apply(context: RemoteContext): void {
        super.apply(context);
        const doc = context.getDocument();
        const targetX = (doc as any)?.getOriginX?.() ?? 0;
        const targetY = (doc as any)?.getOriginY?.() ?? 0;
        this.mRootInterpolatedX = (this.mOriginalOriginX - targetX) * (1 - this.mP);
        this.mRootInterpolatedY = (this.mOriginalOriginY - targetY) * (1 - this.mP);
    }

    paint(context: PaintContext): void {
        context.save();
        context.translate(this.mRootInterpolatedX, this.mRootInterpolatedY);
        super.paint(context);
        context.restore();
    }
}
