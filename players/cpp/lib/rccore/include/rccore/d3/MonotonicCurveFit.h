#pragma once
// MonotonicCurveFit: monotone cubic Hermite spline over N-dimensional samples.
//
// Port of the reference MonotonicCurveFit.java. The tube family fits its centreline to one of
// these: chord-length parametrized, so the spline passes through every control point without the
// overshoot a plain Catmull-Rom gives on a tight corner. All arithmetic is double in the
// reference too, so this port is exact by construction.

#include <vector>

namespace rccore::d3 {

class MonotonicCurveFit {
public:
    MonotonicCurveFit(const std::vector<double>& time,
                      const std::vector<std::vector<double>>& y);

    /** Position of every curve at t. Extrapolates linearly beyond the ends. */
    void getPos(double t, std::vector<double>& v) const;
    void getPos(double t, float* v) const;
    /** Position of curve j at t. */
    double getPosAt(double t, int j) const;
    /** Slope of every curve at t. Clamped to the knot range. */
    void getSlope(double t, std::vector<double>& v) const;
    double getSlopeAt(double t, int j) const;

private:
    std::vector<double> mT;
    std::vector<std::vector<double>> mY;
    std::vector<std::vector<double>> mTangent;
    bool mExtrapolate = true;
};

} // namespace rccore::d3
