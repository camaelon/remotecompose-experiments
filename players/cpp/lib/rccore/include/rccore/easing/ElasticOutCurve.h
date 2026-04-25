#pragma once
#include "Easing.h"
#include <cmath>

namespace rccore {

// Elastic ease-out easing function.
// Matches Java: ElasticOutCurve.java
class ElasticOutCurve : public Easing {
public:
    ElasticOutCurve() { mType = EASE_OUT_ELASTIC; }

    float get(float x) override {
        if (x <= 0.0f) return 0.0f;
        if (x >= 1.0f) return 1.0f;
        return (float)(std::pow(2.0, -10.0 * x) *
                       std::sin((x * 10.0 - 0.75) * C4) + 1.0);
    }

    float getDiff(float x) override {
        if (x < 0.0f || x > 1.0f) return 0.0f;
        return (float)(5.0 * std::pow(2.0, 1.0 - 10.0 * x) *
                       (LOG_8 * std::cos(TWENTY_PI * x / 3.0) +
                        2.0 * F_PI * std::sin(TWENTY_PI * x / 3.0)) / 3.0);
    }

private:
    static constexpr double F_PI = 3.14159265358979323846;
    static constexpr double C4 = 2.0 * F_PI / 3.0;
    static constexpr double TWENTY_PI = 20.0 * F_PI;
    static constexpr double LOG_8 = 2.0794415416798357; // ln(8)
};

} // namespace rccore
