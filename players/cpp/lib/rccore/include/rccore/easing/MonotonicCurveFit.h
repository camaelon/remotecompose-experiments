#pragma once
#include <vector>
#include <cmath>

namespace rccore {

// Multi-dimensional monotonic cubic Hermite spline interpolation.
// Matches Java: MonotonicCurveFit.java
class MonotonicCurveFit {
public:
    // time: array of time points
    // y: 2D array [n][dim] of values at each time point
    MonotonicCurveFit(const std::vector<double>& time,
                      const std::vector<std::vector<double>>& y)
        : mT(time), mY(y) {
        const int n = (int)time.size();
        const int dim = (int)y[0].size();
        mSlopeTemp.resize(dim);

        // Compute slopes and initial tangents
        std::vector<std::vector<double>> slope(n - 1, std::vector<double>(dim));
        mTangent.resize(n, std::vector<double>(dim));

        for (int j = 0; j < dim; j++) {
            for (int i = 0; i < n - 1; i++) {
                double dt = time[i + 1] - time[i];
                slope[i][j] = (y[i + 1][j] - y[i][j]) / dt;
                if (i == 0) {
                    mTangent[i][j] = slope[i][j];
                } else {
                    mTangent[i][j] = (slope[i - 1][j] + slope[i][j]) * 0.5;
                }
            }
            mTangent[n - 1][j] = slope[n - 2][j];
        }

        // Monotonicity correction (Fritsch-Carlson)
        for (int i = 0; i < n - 1; i++) {
            for (int j = 0; j < dim; j++) {
                if (slope[i][j] == 0.0) {
                    mTangent[i][j] = 0.0;
                    mTangent[i + 1][j] = 0.0;
                } else {
                    double a = mTangent[i][j] / slope[i][j];
                    double b = mTangent[i + 1][j] / slope[i][j];
                    double h = std::hypot(a, b);
                    if (h > 9.0) {
                        double s = 3.0 / h;
                        mTangent[i][j] = s * a * slope[i][j];
                        mTangent[i + 1][j] = s * b * slope[i][j];
                    }
                }
            }
        }
    }

    // Get position of the jth curve at time t
    double getPos(double t, int j) const {
        const int n = (int)mT.size();
        // Extrapolation
        if (t <= mT[0]) {
            return mY[0][j] + (t - mT[0]) * getSlope(mT[0], j);
        }
        if (t >= mT[n - 1]) {
            return mY[n - 1][j] + (t - mT[n - 1]) * getSlope(mT[n - 1], j);
        }
        // Find segment
        for (int i = 0; i < n - 1; i++) {
            if (t == mT[i]) return mY[i][j];
            if (t < mT[i + 1]) {
                double h = mT[i + 1] - mT[i];
                double x = (t - mT[i]) / h;
                return interpolate(h, x, mY[i][j], mY[i + 1][j],
                                   mTangent[i][j], mTangent[i + 1][j]);
            }
        }
        return 0.0;
    }

    // Get slope of the jth curve at time t
    double getSlope(double t, int j) const {
        const int n = (int)mT.size();
        if (t < mT[0]) t = mT[0];
        else if (t >= mT[n - 1]) t = mT[n - 1];

        for (int i = 0; i < n - 1; i++) {
            if (t <= mT[i + 1]) {
                double h = mT[i + 1] - mT[i];
                double x = (t - mT[i]) / h;
                return diff(h, x, mY[i][j], mY[i + 1][j],
                            mTangent[i][j], mTangent[i + 1][j]) / h;
            }
        }
        return 0.0;
    }

    // Get slope of all curves
    void getSlope(double t, std::vector<double>& v) const {
        const int n = (int)mT.size();
        const int dim = (int)mY[0].size();
        if (t <= mT[0]) t = mT[0];
        else if (t >= mT[n - 1]) t = mT[n - 1];

        for (int i = 0; i < n - 1; i++) {
            if (t <= mT[i + 1]) {
                double h = mT[i + 1] - mT[i];
                double x = (t - mT[i]) / h;
                for (int j = 0; j < dim; j++) {
                    v[j] = diff(h, x, mY[i][j], mY[i + 1][j],
                                mTangent[i][j], mTangent[i + 1][j]) / h;
                }
                break;
            }
        }
    }

private:
    // Cubic Hermite spline interpolation
    static double interpolate(double h, double x,
                              double y1, double y2, double t1, double t2) {
        double x2 = x * x;
        double x3 = x2 * x;
        return -2 * x3 * y2 + 3 * x2 * y2 + 2 * x3 * y1 - 3 * x2 * y1 + y1
               + h * t2 * x3 + h * t1 * x3 - h * t2 * x2
               - 2 * h * t1 * x2 + h * t1 * x;
    }

    // Cubic Hermite spline slope (derivative)
    static double diff(double h, double x,
                       double y1, double y2, double t1, double t2) {
        double x2 = x * x;
        return -6 * x2 * y2 + 6 * x * y2 + 6 * x2 * y1 - 6 * x * y1
               + 3 * h * t2 * x2 + 3 * h * t1 * x2
               - 2 * h * t2 * x - 4 * h * t1 * x + h * t1;
    }

    std::vector<double> mT;
    std::vector<std::vector<double>> mY;
    std::vector<std::vector<double>> mTangent;
    mutable std::vector<double> mSlopeTemp;
};

} // namespace rccore
