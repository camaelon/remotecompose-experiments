#pragma once
#include <cmath>
#include <cstring>

namespace rccore {

// Damped spring physics engine with boundary modes and energy-based stop detection.
// Matches Java: SpringStopEngine.java
class SpringStopEngine {
public:
    SpringStopEngine() = default;

    // Construct from packed float parameters (animation array from wire).
    // parameters[0] must be 0 (marker distinguishing from FloatAnimation).
    // parameters[1] = stiffness
    // parameters[2] = damping
    // parameters[3] = stop threshold
    // parameters[4] = boundary mode (encoded as float bits → int)
    explicit SpringStopEngine(const float* parameters) {
        int32_t boundaryBits;
        memcpy(&boundaryBits, &parameters[4], sizeof(boundaryBits));
        springParameters(1.0f, parameters[1], parameters[2],
                         parameters[3], boundaryBits);
    }

    float getTargetValue() const { return (float)mTargetPos; }

    void setInitialValue(float v) { mPos = v; }

    void setTargetValue(float v) { mTargetPos = v; }

    void springParameters(float mass, float stiffness, float damping,
                          float stopThreshold, int boundaryMode) {
        mMass = mass;
        mStiffness = stiffness;
        mDamping = damping;
        mStopThreshold = stopThreshold;
        mBoundaryMode = boundaryMode;
        mLastTime = 0.0f;
    }

    // Get spring position at absolute time.
    // Spring internally tracks mLastTime to compute delta.
    float get(float time) {
        compute(time - mLastTime);
        mLastTime = time;
        if (isStopped()) {
            mPos = (float)mTargetPos;
        }
        return mPos;
    }

    float getVelocity() const { return mV; }

    float getAcceleration() const {
        double k = mStiffness;
        double c = mDamping;
        double x = mPos - mTargetPos;
        return (float)((-k * x - c * mV) / mMass);
    }

    // Energy-based stop detection.
    // Spring stops when total energy (kinetic + potential) can't produce
    // displacement greater than threshold.
    bool isStopped() const {
        double x = mPos - mTargetPos;
        double k = mStiffness;
        double v = mV;
        double m = mMass;
        double energy = v * v * m + k * x * x;
        double max_def = std::sqrt(energy / k);
        return max_def <= mStopThreshold;
    }

private:
    // RK2 (improved Euler) spring physics simulation.
    // Adaptive oversampling based on natural frequency to prevent instability.
    void compute(double dt) {
        if (dt <= 0.0) return;

        double k = mStiffness;
        double c = mDamping;
        // Adaptive oversampling: higher stiffness → more samples
        int overSample = (int)(1 + 9.0 / (std::sqrt(mStiffness / mMass) * dt * 4.0));
        dt /= overSample;

        for (int i = 0; i < overSample; i++) {
            double x = mPos - mTargetPos;
            double a = (-k * x - c * mV) / mMass;

            // RK2: average velocity and position for better accuracy
            double avgV = mV + a * dt / 2.0;
            double avgX = mPos + dt * avgV / 2.0 - mTargetPos;
            a = (-avgX * k - avgV * c) / mMass;

            double dv = a * dt;
            avgV = mV + dv / 2.0;
            mV += (float)dv;
            mPos += (float)(avgV * dt);

            // Boundary collision (bounce)
            if (mBoundaryMode > 0) {
                if (mPos < 0 && ((mBoundaryMode & 1) == 1)) {
                    mPos = -mPos;
                    mV = -mV;
                }
                if (mPos > 1 && ((mBoundaryMode & 2) == 2)) {
                    mPos = 2.0f - mPos;
                    mV = -mV;
                }
            }
        }
    }

    double mStiffness = 0.0;
    double mDamping = 0.5;
    double mTargetPos = 0.0;
    float mMass = 1.0f;
    float mStopThreshold = 0.0f;
    float mLastTime = 0.0f;
    float mPos = 0.0f;
    float mV = 0.0f;
    int mBoundaryMode = 0;
};

} // namespace rccore
