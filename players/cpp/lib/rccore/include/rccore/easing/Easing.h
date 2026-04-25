#pragma once

namespace rccore {

// Abstract base class for easing functions.
// Matches Java: Easing.java
class Easing {
public:
    virtual ~Easing() = default;

    // Get the value at point x (x in [0,1] for normalized time)
    virtual float get(float x) = 0;

    // Get the slope of the easing function at x
    virtual float getDiff(float x) = 0;

    int getType() const { return mType; }

    // Easing type constants (match Java Easing.java)
    static constexpr int CUBIC_STANDARD    = 1;
    static constexpr int CUBIC_ACCELERATE  = 2;
    static constexpr int CUBIC_DECELERATE  = 3;
    static constexpr int CUBIC_LINEAR      = 4;
    static constexpr int CUBIC_ANTICIPATE  = 5;
    static constexpr int CUBIC_OVERSHOOT   = 6;
    static constexpr int CUBIC_CUSTOM      = 11;
    static constexpr int SPLINE_CUSTOM     = 12;
    static constexpr int EASE_OUT_BOUNCE   = 13;
    static constexpr int EASE_OUT_ELASTIC  = 14;

protected:
    int mType = 0;
};

} // namespace rccore
