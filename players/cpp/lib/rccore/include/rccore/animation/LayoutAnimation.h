#pragma once
// Layout-animation subsystem: animates component bounds (x/y/w/h) and opacity
// (enter/exit fades) over time, so layout changes (notably StateLayout index
// changes) transition smoothly instead of snapping. Port of the androidx
// AnimateMeasure model, adapted to the C++ functional layout pipeline.
//
// The pipeline rebuilds MeasurePass and LayoutState every frame, so the
// "previous painted bounds" a component must animate FROM are kept in a
// persistent store keyed by componentId (below), surviving frame rebuilds.
//
// The store belongs to a CoreDocument, not to the process. Component ids are only
// unique *within* a document, and more than one document is routinely live at once —
// a document embedding another via `rc:`, or a player rendering a still of a second
// document off-screen while the first keeps playing. A shared store lets those
// documents read each other's bounds through colliding ids, which surfaces as
// components animating from positions they never occupied.

#include <unordered_map>
#include <cstdio>
#include <cstdlib>
#include "rccore/LayoutSystem.h"
#include "rccore/easing/CubicEasing.h"

namespace rccore {

// Enter/exit effects (wire ordinals from AnimationSpec.ANIMATION).
enum class AnimEffect {
    FADE_IN = 0, FADE_OUT = 1,
    SLIDE_LEFT = 2, SLIDE_RIGHT = 3, SLIDE_TOP = 4, SLIDE_BOTTOM = 5,
    ROTATE = 6, PARTICLE = 7, CUSTOM = 8,
};

struct AnimSpecParams {
    float motionDuration = 0.30f;              // seconds
    int   motionEasing = Easing::CUBIC_STANDARD;
    float visDuration = 0.30f;                 // seconds (enter/exit fade)
    int   visEasing = Easing::CUBIC_STANDARD;
    AnimEffect enter = AnimEffect::FADE_IN;
    AnimEffect exit  = AnimEffect::FADE_OUT;
    // AnimationSpec.SEQUENCE of the visibility change against the motion:
    // 0 CONCURRENT, 1 BEFORE, 2 AFTER (the visibility change waits for the motion).
    int enterSequence = 0, exitSequence = 0;
    int enterFunctionId = -1, exitFunctionId = -1;   // CUSTOM effects
};

struct AnimState {
    bool hasLive = false;          // have we shown this component before?
    ComponentMeasure live;         // bounds shown last frame (the animation "from")
    bool animating = false;
    ComponentMeasure from, to;
    double startTime = 0;          // ID_ANIMATION_TIME seconds when the animation began
    double lastChange = -1e9;      // when the destination last changed (continuous drivers)
    AnimSpecParams spec;
};

// Persistent per-componentId store; NOT cleared each frame. Cleared on doc load.
// One per CoreDocument — see the note at the top of this file.
using LayoutAnimStore = std::unordered_map<int, AnimState>;

inline float animLerp(float a, float b, float t) { return a * (1.0f - t) + b * t; }

inline float animEase(int type, float x) {
    if (x <= 0.0f) return 0.0f;
    if (x >= 1.0f) return 1.0f;
    CubicEasing e(type);
    return e.get(x);
}

// Advance/one-shot the animation for component `cid`, given the freshly measured
// `target` bounds. Rewrites `target` (bounds + alpha) with the interpolated values
// that should actually be painted this frame. Returns true while still animating
// (caller should request another frame).
//
// Semantics:
//  * first appearance: adopt target, no animation.
//  * both visible, bounds changed: tween x/y/w/h (move/resize), alpha 1.
//  * entering (from GONE → visible): hold at target bounds, alpha 0→1.
//  * exiting  (visible → GONE): hold at previous bounds, alpha 1→0, keep painting
//    until done, then settle to GONE.
// The effect of an enter (`entering`) or exit drawn at visibility progress vp
// (AnimateMeasure.paint): fades change the alpha, slides move by vp of the parent's size,
// ROTATE enters spinning a full turn while it grows and fades in; an exit PARTICLE (or any
// exit effect without its own case: ROTATE, FADE_IN) is drawn as ParticleAnimation. CUSTOM hands the
// progress to the visibility function.
inline void animEffect(ComponentMeasure& cur, bool entering, const AnimSpecParams& spec,
                       float vp, float parentW, float parentH) {
    AnimEffect e = entering ? spec.enter : spec.exit;
    cur.alpha = 1.0f;
    float k = entering ? (1.0f - vp) : vp;        // how far from the resting place
    switch (e) {
        case AnimEffect::SLIDE_LEFT:   cur.effTx = (entering ? 1.0f : -1.0f) * k * parentW; break;
        case AnimEffect::SLIDE_RIGHT:  cur.effTx = (entering ? -1.0f : 1.0f) * k * parentW; break;
        case AnimEffect::SLIDE_TOP:    cur.effTy = (entering ? 1.0f : -1.0f) * k * parentH; break;
        case AnimEffect::SLIDE_BOTTOM: cur.effTy = (entering ? -1.0f : 1.0f) * k * parentH; break;
        case AnimEffect::ROTATE:
            if (entering) { cur.effRot = vp * 360.0f; cur.effScale = vp; cur.alpha = vp; }
            else cur.particle = vp;   // AnimateMeasure.paint: no exit case, so particles
            break;
        case AnimEffect::CUSTOM: {
            int fn = entering ? spec.enterFunctionId : spec.exitFunctionId;
            if (fn != -1) { cur.customFn = fn; cur.customProgress = vp; }
            else cur.alpha = entering ? vp : 1.0f - vp;
            break;
        }
        case AnimEffect::FADE_IN: case AnimEffect::FADE_OUT: case AnimEffect::PARTICLE:
        default:
            // An enter other than these is not drawn until it is over (AnimateMeasure.paint).
            if (entering) cur.alpha = e == AnimEffect::FADE_IN ? vp : 0.0f;
            else if (e == AnimEffect::FADE_OUT) cur.alpha = 1.0f - vp;
            else cur.particle = vp;   // PARTICLE (and FADE_IN as an exit): ParticleAnimation
            break;
    }
}

inline bool animUpdate(LayoutAnimStore& store, int cid, ComponentMeasure& target,
                       double timeSec, bool enabled, const AnimSpecParams& spec,
                       float parentW = 0.0f, float parentH = 0.0f) {
    AnimState& st = store[cid];

    if (!st.hasLive) {
        st.hasLive = true;
        st.live = target;
        st.animating = false;
        target.alpha = target.isVisible() ? 1.0f : 0.0f;
        return false;
    }

    if (!enabled) {
        st.live = target;
        st.animating = false;
        target.alpha = target.isVisible() ? 1.0f : 0.0f;
        return false;
    }

    // Restart only when the *destination* changes. While an animation is in flight,
    // st.live is a held or interpolated frame rather than a layout result: an exit fade
    // deliberately keeps the component VISIBLE at its old bounds while the measure pass
    // goes on reporting GONE every frame. Comparing the fresh measurement against st.live
    // therefore never matched, so startTime was pushed forward on every frame and the fade
    // could not finish — a component that became GONE stayed on screen for good, which is
    // what made filter chips look dead while the list never filtered. (Entering escaped
    // this: it holds st.to, which does compare equal.)
    const ComponentMeasure& destination = st.animating ? st.to : st.live;
    if (!target.sameBounds(destination)) {
        // A destination that moves again within a moment of the last move is being driven —
        // a width from an expression on the clock, say. Tweening each step restarts the
        // animation every frame at progress 0, which holds the component still forever; follow
        // the driver instead. Only a change that stands alone (a click, a state flip) animates.
        const bool driven = (timeSec - st.lastChange) < 0.1 && target.isVisible() == destination.isVisible();
        st.lastChange = timeSec;
        if (driven) {
            st.animating = false;
            st.live = target;
            target.alpha = target.isVisible() ? 1.0f : 0.0f;
            return false;
        }
        st.from = st.live;
        st.to = target;
        st.startTime = timeSec;
        st.spec = spec;
        st.animating = true;
    }

    if (!st.animating) {
        st.live = target;
        target.alpha = target.isVisible() ? 1.0f : 0.0f;
        return false;
    }

    float elapsed = static_cast<float>(timeSec - st.startTime);
    bool entering = st.from.isGone() && st.to.isVisible();
    bool exiting  = st.from.isVisible() && st.to.isGone();
    // AnimateMeasure.update: with an AFTER sequence the visibility change starts once the
    // motion is over.
    const int seq = entering ? st.spec.enterSequence : exiting ? st.spec.exitSequence : 0;
    const bool after = seq == 2;
    float p  = animEase(st.spec.motionEasing, st.spec.motionDuration > 0 ? elapsed / st.spec.motionDuration : 1.0f);
    float visElapsed = after ? elapsed - st.spec.motionDuration : elapsed;
    float vp = visElapsed < 0.0f ? 0.0f
             : animEase(st.spec.visEasing, st.spec.visDuration > 0 ? visElapsed / st.spec.visDuration : 1.0f);

    ComponentMeasure cur = st.to;
    cur.effTx = cur.effTy = cur.effRot = 0.0f; cur.effScale = 1.0f; cur.customFn = -1; cur.particle = -1.0f;

    if (entering) {
        cur = st.to;                 // appear in final place
        cur.visibility = VIS_VISIBLE;
        if (after && visElapsed < 0.0f) cur.alpha = 0.0f;    // not drawn before the motion ends
        else animEffect(cur, true, st.spec, vp, parentW, parentH);
    } else if (exiting) {
        cur = st.from;               // leave from where it was
        cur.visibility = VIS_VISIBLE;
        cur.effTx = cur.effTy = cur.effRot = 0.0f; cur.effScale = 1.0f; cur.customFn = -1; cur.particle = -1.0f;
        if (after && visElapsed < 0.0f) cur.alpha = 1.0f;    // drawn as is until the motion ends
        else animEffect(cur, false, st.spec, vp, parentW, parentH);
    } else {
        cur.x = animLerp(st.from.x, st.to.x, p);
        cur.y = animLerp(st.from.y, st.to.y, p);
        cur.w = animLerp(st.from.w, st.to.w, p);
        cur.h = animLerp(st.from.h, st.to.h, p);
        cur.visibility = VIS_VISIBLE;
        cur.alpha = 1.0f;
    }
    cur.id = target.id;

    bool done = (p >= 1.0f && vp >= 1.0f && visElapsed >= 0.0f);
    if (done) {
        st.animating = false;
        st.live = st.to;
        st.live.effTx = st.live.effTy = st.live.effRot = 0.0f; st.live.effScale = 1.0f;
        st.live.customFn = -1; st.live.particle = -1.0f;
        target = st.live;
        target.alpha = st.to.isVisible() ? 1.0f : 0.0f;
        return false;
    }

    st.live = cur;
    target = cur;
    return true;
}

} // namespace rccore
