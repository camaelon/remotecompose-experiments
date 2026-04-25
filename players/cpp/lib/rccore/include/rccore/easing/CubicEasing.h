#pragma once
#include "Easing.h"

namespace rccore {

// CSS cubic-bezier style easing function.
// Binary search for t parameter, then linear interpolation.
// Matches Java: CubicEasing.java
class CubicEasing : public Easing {
public:
    CubicEasing() {
        setup(STANDARD[0], STANDARD[1], STANDARD[2], STANDARD[3]);
    }

    explicit CubicEasing(int type) {
        mType = type;
        config(type);
    }

    CubicEasing(float x1, float y1, float x2, float y2) {
        setup(x1, y1, x2, y2);
    }

    void config(int type) {
        switch (type) {
            case CUBIC_STANDARD:   setup(STANDARD); break;
            case CUBIC_ACCELERATE: setup(ACCELERATE); break;
            case CUBIC_DECELERATE: setup(DECELERATE); break;
            case CUBIC_LINEAR:     setup(LINEAR); break;
            case CUBIC_ANTICIPATE: setup(ANTICIPATE); break;
            case CUBIC_OVERSHOOT:  setup(OVERSHOOT); break;
        }
        mType = type;
    }

    void setup(float x1, float y1, float x2, float y2) {
        mX1 = x1; mY1 = y1; mX2 = x2; mY2 = y2;
    }

    // Binary search for the region and linear interpolate the answer
    float get(float x) override {
        if (x <= 0.0f) return 0.0f;
        if (x >= 1.0f) return 1.0f;
        float t = 0.5f;
        float range = 0.5f;
        while (range > ERROR) {
            float tx = getX(t);
            range *= 0.5f;
            if (tx < x) t += range;
            else t -= range;
        }
        float x1 = getX(t - range);
        float x2 = getX(t + range);
        float y1 = getY(t - range);
        float y2 = getY(t + range);
        return (y2 - y1) * (x - x1) / (x2 - x1) + y1;
    }

    float getDiff(float x) override {
        float t = 0.5f;
        float range = 0.5f;
        while (range > D_ERROR) {
            float tx = getX(t);
            range *= 0.5f;
            if (tx < x) t += range;
            else t -= range;
        }
        float x1 = getX(t - range);
        float x2 = getX(t + range);
        float y1 = getY(t - range);
        float y2 = getY(t + range);
        return (y2 - y1) / (x2 - x1);
    }

private:
    void setup(const float* v) { setup(v[0], v[1], v[2], v[3]); }

    float getX(float t) const {
        float t1 = 1.0f - t;
        float f1 = 3.0f * t1 * t1 * t;
        float f2 = 3.0f * t1 * t * t;
        float f3 = t * t * t;
        return mX1 * f1 + mX2 * f2 + f3;
    }

    float getY(float t) const {
        float t1 = 1.0f - t;
        float f1 = 3.0f * t1 * t1 * t;
        float f2 = 3.0f * t1 * t * t;
        float f3 = t * t * t;
        return mY1 * f1 + mY2 * f2 + f3;
    }

    float mX1 = 0.0f, mY1 = 0.0f, mX2 = 0.0f, mY2 = 0.0f;

    static constexpr float ERROR = 0.01f;
    static constexpr float D_ERROR = 0.0001f;

    static constexpr float STANDARD[4]   = {0.4f, 0.0f, 0.2f, 1.0f};
    static constexpr float ACCELERATE[4] = {0.4f, 0.05f, 0.8f, 0.7f};
    static constexpr float DECELERATE[4] = {0.0f, 0.0f, 0.2f, 0.95f};
    static constexpr float LINEAR[4]     = {1.0f, 1.0f, 0.0f, 0.0f};
    static constexpr float ANTICIPATE[4] = {0.36f, 0.0f, 0.66f, -0.56f};
    static constexpr float OVERSHOOT[4]  = {0.34f, 1.56f, 0.64f, 1.0f};
};

} // namespace rccore
