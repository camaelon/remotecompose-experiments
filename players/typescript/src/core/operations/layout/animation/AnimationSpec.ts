// AnimationSpec: definition and op parsing for layout animations.
// Port of Java AnimationSpec.java (OpCode 14).

import { Operation } from '../../../Operation';
import type { WireBuffer } from '../../../WireBuffer';
import type { RemoteContext } from '../../../RemoteContext';
import { Easing } from '../../utilities/easing/Easing';

export enum ANIMATION {
    FADE_IN = 0,
    FADE_OUT = 1,
    SLIDE_LEFT = 2,
    SLIDE_RIGHT = 3,
    SLIDE_TOP = 4,
    SLIDE_BOTTOM = 5,
    ROTATE = 6,
    PARTICLE = 7,
}

export function intToAnimation(v: number): ANIMATION {
    switch (v) {
        case 0: return ANIMATION.FADE_IN;
        case 1: return ANIMATION.FADE_OUT;
        case 2: return ANIMATION.SLIDE_LEFT;
        case 3: return ANIMATION.SLIDE_RIGHT;
        case 4: return ANIMATION.SLIDE_TOP;
        case 5: return ANIMATION.SLIDE_BOTTOM;
        case 6: return ANIMATION.ROTATE;
        case 7: return ANIMATION.PARTICLE;
        default: return ANIMATION.FADE_IN;
    }
}

export class AnimationSpec extends Operation {
    static readonly OP_CODE = 14;

    static readonly DEFAULT = new AnimationSpec(-1, 300, Easing.CUBIC_STANDARD, 300, Easing.CUBIC_STANDARD, ANIMATION.FADE_IN, ANIMATION.FADE_OUT);
    static readonly DISABLED = new AnimationSpec(0, 0, Easing.CUBIC_STANDARD, 0, Easing.CUBIC_STANDARD, ANIMATION.FADE_IN, ANIMATION.FADE_OUT);

    private mAnimationId: number;
    private mMotionDuration: number;
    private mMotionEasingType: number;
    private mVisibilityDuration: number;
    private mVisibilityEasingType: number;
    private mEnterAnimation: ANIMATION;
    private mExitAnimation: ANIMATION;

    constructor(
        animationId = -1,
        motionDuration = 300,
        motionEasingType = Easing.CUBIC_STANDARD,
        visibilityDuration = 300,
        visibilityEasingType = Easing.CUBIC_STANDARD,
        enterAnimation: ANIMATION = ANIMATION.FADE_IN,
        exitAnimation: ANIMATION = ANIMATION.FADE_OUT
    ) {
        super();
        this.mAnimationId = animationId;
        this.mMotionDuration = motionDuration;
        this.mMotionEasingType = motionEasingType;
        this.mVisibilityDuration = visibilityDuration;
        this.mVisibilityEasingType = visibilityEasingType;
        this.mEnterAnimation = enterAnimation;
        this.mExitAnimation = exitAnimation;
    }

    isAnimationEnabled(): boolean {
        return this.mAnimationId !== 0;
    }

    getAnimationId(): number { return this.mAnimationId; }
    getMotionDuration(): number { return this.mMotionDuration; }
    getMotionEasingType(): number { return this.mMotionEasingType; }
    getVisibilityDuration(): number { return this.mVisibilityDuration; }
    getVisibilityEasingType(): number { return this.mVisibilityEasingType; }
    getEnterAnimation(): ANIMATION { return this.mEnterAnimation; }
    getExitAnimation(): ANIMATION { return this.mExitAnimation; }

    write(buffer: WireBuffer): void {
        buffer.start(AnimationSpec.OP_CODE);
        buffer.writeInt(this.mAnimationId);
        buffer.writeFloat(this.mMotionDuration);
        buffer.writeInt(this.mMotionEasingType);
        buffer.writeFloat(this.mVisibilityDuration);
        buffer.writeInt(this.mVisibilityEasingType);
        buffer.writeInt(this.mEnterAnimation);
        buffer.writeInt(this.mExitAnimation);
    }

    apply(_context: RemoteContext): void {
        // Modifier application handled during Component.inflate
    }

    deepToString(indent: string): string {
        return `${indent}AnimationSpec(id=${this.mAnimationId}, motion=${this.mMotionDuration}ms, vis=${this.mVisibilityDuration}ms)`;
    }

    static read(buffer: WireBuffer, operations: Operation[]): void {
        const animationId = buffer.readInt();
        const motionDuration = buffer.readFloat();
        const motionEasingType = buffer.readInt();
        const visibilityDuration = buffer.readFloat();
        const visibilityEasingType = buffer.readInt();
        const enterAnimation = intToAnimation(buffer.readInt());
        const exitAnimation = intToAnimation(buffer.readInt());
        const op = new AnimationSpec(
            animationId,
            motionDuration,
            motionEasingType,
            visibilityDuration,
            visibilityEasingType,
            enterAnimation,
            exitAnimation
        );
        operations.push(op);
    }
}
