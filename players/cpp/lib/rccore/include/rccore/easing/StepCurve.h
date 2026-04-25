#pragma once
#include "Easing.h"
#include "MonotonicCurveFit.h"
#include <memory>
#include <vector>

namespace rccore {

// Custom spline-based easing curve.
// Matches Java: StepCurve.java
class StepCurve : public Easing {
public:
    StepCurve(const float* params, int offset, int len) {
        mType = SPLINE_CUSTOM;
        mCurveFit = genSpline(params, offset, len);
    }

    float get(float x) override {
        if (x < 0.0f) return 0.0f;
        if (x > 1.0f) return 1.0f;
        return (float)mCurveFit->getPos(x, 0);
    }

    float getDiff(float x) override {
        if (x < 0.0f) return 0.0f;
        if (x > 1.0f) return 0.0f;
        return (float)mCurveFit->getSlope(x, 0);
    }

private:
    static std::unique_ptr<MonotonicCurveFit> genSpline(
            const float* values, int off, int arrayLen) {
        int length = arrayLen * 3 - 2;
        int len = arrayLen - 1;
        double gap = 1.0 / len;

        std::vector<std::vector<double>> points(length, std::vector<double>(1));
        std::vector<double> time(length);

        for (int i = 0; i < arrayLen; i++) {
            double v = values[i + off];
            points[i + len][0] = v;
            time[i + len] = i * gap;
            if (i > 0) {
                points[i + len * 2][0] = v + 1;
                time[i + len * 2] = i * gap + 1;
                points[i - 1][0] = v - 1 - gap;
                time[i - 1] = i * gap + -1 - gap;
            }
        }

        return std::make_unique<MonotonicCurveFit>(time, points);
    }

    std::unique_ptr<MonotonicCurveFit> mCurveFit;
};

} // namespace rccore
