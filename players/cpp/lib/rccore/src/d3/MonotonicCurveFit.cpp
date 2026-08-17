#include "rccore/d3/MonotonicCurveFit.h"

#include "rccore/d3/JavaMath.h"

#include <cmath>

namespace rccore::d3 {
namespace {

/** Cubic Hermite basis, in the reference's exact term order. */
double interpolate(double h, double x, double y1, double y2, double t1, double t2) {
    double x2 = x * x;
    double x3 = x2 * x;
    return -2 * x3 * y2 + 3 * x2 * y2 + 2 * x3 * y1 - 3 * x2 * y1 + y1
         + h * t2 * x3 + h * t1 * x3 - h * t2 * x2 - 2 * h * t1 * x2 + h * t1 * x;
}

/** Derivative of the Hermite basis with respect to x. */
double diff(double h, double x, double y1, double y2, double t1, double t2) {
    double x2 = x * x;
    return -6 * x2 * y2 + 6 * x * y2 + 6 * x2 * y1 - 6 * x * y1
         + 3 * h * t2 * x2 + 3 * h * t1 * x2 - 2 * h * t2 * x - 4 * h * t1 * x + h * t1;
}

} // namespace

MonotonicCurveFit::MonotonicCurveFit(const std::vector<double>& time,
                                     const std::vector<std::vector<double>>& y)
    : mT(time), mY(y) {
    int n = (int) time.size();
    int dim = (int) y[0].size();
    std::vector<std::vector<double>> slope(n - 1, std::vector<double>(dim, 0.0));
    mTangent.assign(n, std::vector<double>(dim, 0.0));
    for (int j = 0; j < dim; j++) {
        for (int i = 0; i < n - 1; i++) {
            double dt = time[i + 1] - time[i];
            slope[i][j] = (y[i + 1][j] - y[i][j]) / dt;
            if (i == 0) mTangent[i][j] = slope[i][j];
            else mTangent[i][j] = (slope[i - 1][j] + slope[i][j]) * 0.5f;
        }
        mTangent[n - 1][j] = slope[n - 2][j];
    }
    // Fritsch-Carlson limiter: clamp tangents that would make a segment non-monotone.
    for (int i = 0; i < n - 1; i++) {
        for (int j = 0; j < dim; j++) {
            if (slope[i][j] == 0.) {
                mTangent[i][j] = 0.;
                mTangent[i + 1][j] = 0.;
            } else {
                double a = mTangent[i][j] / slope[i][j];
                double b = mTangent[i + 1][j] / slope[i][j];
                double hh = jhypot((double)(a), b);
                if (hh > 9.0) {
                    double tt = 3. / hh;
                    mTangent[i][j] = tt * a * slope[i][j];
                    mTangent[i + 1][j] = tt * b * slope[i][j];
                }
            }
        }
    }
}

void MonotonicCurveFit::getPos(double t, std::vector<double>& v) const {
    int n = (int) mT.size();
    int dim = (int) mY[0].size();
    if (mExtrapolate) {
        if (t <= mT[0]) {
            std::vector<double> tmp(dim);
            getSlope(mT[0], tmp);
            for (int j = 0; j < dim; j++) v[j] = mY[0][j] + (t - mT[0]) * tmp[j];
            return;
        }
        if (t >= mT[n - 1]) {
            std::vector<double> tmp(dim);
            getSlope(mT[n - 1], tmp);
            for (int j = 0; j < dim; j++) v[j] = mY[n - 1][j] + (t - mT[n - 1]) * tmp[j];
            return;
        }
    }
    for (int i = 0; i < n - 1; i++) {
        if (t == mT[i]) for (int j = 0; j < dim; j++) v[j] = mY[i][j];
        if (t < mT[i + 1]) {
            double h = mT[i + 1] - mT[i];
            double x = (t - mT[i]) / h;
            for (int j = 0; j < dim; j++)
                v[j] = interpolate(h, x, mY[i][j], mY[i + 1][j], mTangent[i][j],
                                   mTangent[i + 1][j]);
            return;
        }
    }
}

void MonotonicCurveFit::getPos(double t, float* v) const {
    int dim = (int) mY[0].size();
    std::vector<double> tmp(dim);
    getPos(t, tmp);
    for (int j = 0; j < dim; j++) v[j] = (float) tmp[j];
}

double MonotonicCurveFit::getPosAt(double t, int j) const {
    int n = (int) mT.size();
    if (mExtrapolate) {
        if (t <= mT[0]) return mY[0][j] + (t - mT[0]) * getSlopeAt(mT[0], j);
        if (t >= mT[n - 1]) return mY[n - 1][j] + (t - mT[n - 1]) * getSlopeAt(mT[n - 1], j);
    }
    for (int i = 0; i < n - 1; i++) {
        if (t == mT[i]) return mY[i][j];
        if (t < mT[i + 1]) {
            double h = mT[i + 1] - mT[i];
            double x = (t - mT[i]) / h;
            return interpolate(h, x, mY[i][j], mY[i + 1][j], mTangent[i][j], mTangent[i + 1][j]);
        }
    }
    return 0.0;
}

void MonotonicCurveFit::getSlope(double t, std::vector<double>& v) const {
    int n = (int) mT.size();
    int dim = (int) mY[0].size();
    if (t <= mT[0]) t = mT[0];
    else if (t >= mT[n - 1]) t = mT[n - 1];
    for (int i = 0; i < n - 1; i++) {
        if (t <= mT[i + 1]) {
            double h = mT[i + 1] - mT[i];
            double x = (t - mT[i]) / h;
            for (int j = 0; j < dim; j++)
                v[j] = diff(h, x, mY[i][j], mY[i + 1][j], mTangent[i][j], mTangent[i + 1][j]) / h;
            break;
        }
    }
}

double MonotonicCurveFit::getSlopeAt(double t, int j) const {
    int n = (int) mT.size();
    if (t <= mT[0]) t = mT[0];
    else if (t >= mT[n - 1]) t = mT[n - 1];
    for (int i = 0; i < n - 1; i++) {
        if (t <= mT[i + 1]) {
            double h = mT[i + 1] - mT[i];
            double x = (t - mT[i]) / h;
            return diff(h, x, mY[i][j], mY[i + 1][j], mTangent[i][j], mTangent[i + 1][j]) / h;
        }
    }
    return 0.0;
}

} // namespace rccore::d3
