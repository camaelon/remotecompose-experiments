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
#include "rccore/LayoutSystem.h"
#include "rccore/easing/CubicEasing.h"

namespace rccore {

// Enter/exit effects (wire ordinals from AnimationSpec.ANIMATION).
enum class AnimEffect {
    FADE_IN = 0, FADE_OUT = 1,
    SLIDE_LEFT = 2, SLIDE_RIGHT = 3, SLIDE_TOP = 4, SLIDE_BOTTOM = 5,
    ROTATE = 6, PARTICLE = 7,
};

struct AnimSpecParams {
    float motionDuration = 0.60f;              // seconds
    int   motionEasing = Easing::CUBIC_STANDARD;
    float visDuration = 0.60f;                 // seconds (enter/exit fade)
    int   visEasing = Easing::CUBIC_STANDARD;
    AnimEffect enter = AnimEffect::FADE_IN;
    AnimEffect exit  = AnimEffect::FADE_OUT;
};

struct AnimState {
    bool hasLive = false;          // have we shown this component before?
    ComponentMeasure live;         // bounds shown last frame (the animation "from")
    bool animating = false;
    ComponentMeasure from, to;
    double startTime = 0;          // ID_ANIMATION_TIME seconds when the animation began
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
inline bool animUpdate(LayoutAnimStore& store, int cid, ComponentMeasure& target,
                       double timeSec, bool enabled, const AnimSpecParams& spec) {
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

    if (!target.sameBounds(st.live)) {
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
    float p  = animEase(st.spec.motionEasing, st.spec.motionDuration > 0 ? elapsed / st.spec.motionDuration : 1.0f);
    float vp = animEase(st.spec.visEasing,    st.spec.visDuration    > 0 ? elapsed / st.spec.visDuration    : 1.0f);

    ComponentMeasure cur = st.to;
    bool entering = st.from.isGone() && st.to.isVisible();
    bool exiting  = st.from.isVisible() && st.to.isGone();

    if (entering) {
        cur = st.to;                 // appear in final place
        cur.visibility = VIS_VISIBLE;
        cur.alpha = vp;
    } else if (exiting) {
        cur = st.from;               // fade out where it was
        cur.visibility = VIS_VISIBLE;
        cur.alpha = 1.0f - vp;
    } else {
        cur.x = animLerp(st.from.x, st.to.x, p);
        cur.y = animLerp(st.from.y, st.to.y, p);
        cur.w = animLerp(st.from.w, st.to.w, p);
        cur.h = animLerp(st.from.h, st.to.h, p);
        cur.visibility = VIS_VISIBLE;
        cur.alpha = 1.0f;
    }
    cur.id = target.id;

    bool done = (p >= 1.0f && vp >= 1.0f);
    if (done) {
        st.animating = false;
        st.live = st.to;
        target = st.to;
        target.alpha = st.to.isVisible() ? 1.0f : 0.0f;
        return false;
    }

    st.live = cur;
    target = cur;
    return true;
}

} // namespace rccore
