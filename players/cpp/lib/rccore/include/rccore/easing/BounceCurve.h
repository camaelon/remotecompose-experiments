#pragma once
#include "Easing.h"

namespace rccore {

// Bouncing ease-out easing function.
// Matches Java: BounceCurve.java
class BounceCurve : public Easing {
public:
    explicit BounceCurve(int type) { mType = type; }

    float get(float x) override {
        float t = x;
        if (t < 0.0f) return 0.0f;
        if (t < 1.0f / D1) {
            return 1.0f / (1.0f + 1.0f / D1) * (N1 * t * t + t);
        } else if (t < 2.0f / D1) {
            t -= 1.5f / D1;
            return N1 * t * t + 0.75f;
        } else if (t < 2.5f / D1) {
            t -= 2.25f / D1;
            return N1 * t * t + 0.9375f;
        } else if (t <= 1.0f) {
            t -= 2.625f / D1;
            return N1 * t * t + 0.984375f;
        }
        return 1.0f;
    }

    float getDiff(float x) override {
        if (x < 0.0f) return 0.0f;
        if (x < 1.0f / D1) {
            return 2.0f * N1 * x / (1.0f + 1.0f / D1) + 1.0f / (1.0f + 1.0f / D1);
        } else if (x < 2.0f / D1) {
            return 2.0f * N1 * (x - 1.5f / D1);
        } else if (x < 2.5f / D1) {
            return 2.0f * N1 * (x - 2.25f / D1);
        } else if (x <= 1.0f) {
            return 2.0f * N1 * (x - 2.625f / D1);
        }
        return 0.0f;
    }

private:
    static constexpr float N1 = 7.5625f;
    static constexpr float D1 = 2.75f;
};

} // namespace rccore
