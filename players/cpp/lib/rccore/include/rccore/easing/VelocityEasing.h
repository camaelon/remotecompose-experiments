#pragma once
#include <cmath>

namespace rccore {

// Port of Java VelocityEasing.java
// Computes velocity-constrained easing: multi-stage linear acceleration segments
// for smooth deceleration after touch-up events.
class VelocityEasing {
public:
    float getDuration() const {
        return mDuration;
    }

    float getPos(float t) const {
        for (int i = 0; i < mNumberOfStages; i++) {
            if (mStage[i].mEndTime > t) {
                return mStage[i].getPos(t);
            }
        }
        return mEndPos;
    }

    float getVel(float t) const {
        for (int i = 0; i < mNumberOfStages; i++) {
            if (mStage[i].mEndTime > t) {
                return mStage[i].getVel(t);
            }
        }
        return 0.0f;
    }

    // Configure the velocity easing curve.
    // easing=null path only (Java TouchExpression always passes null).
    void config(float currentPos, float destination, float currentVelocity,
                float maxTime, float maxAcceleration, float maxVelocity) {
        float pos = currentPos;
        float velocity = currentVelocity;
        if (pos == destination) {
            pos += 1.0f;
        }
        mStartPos = pos;
        mEndPos = destination;

        float dir = (destination - pos) > 0 ? 1.0f : -1.0f;
        float maxV = maxVelocity * dir;
        float maxA = maxAcceleration * dir;
        if (velocity == 0.0f) {
            velocity = 0.0001f * dir;
        }
        mStartV = velocity;

        if (!rampDown(pos, destination, velocity, maxTime)) {
            if (!cruseThenRampDown(pos, destination, velocity, maxTime, maxA, maxV)) {
                if (!rampUpRampDown(pos, destination, velocity, maxA, maxV, maxTime)) {
                    rampUpCruseRampDown(pos, destination, velocity, maxA, maxV, maxTime);
                }
            }
        }
    }

private:
    struct Stage {
        float mStartV = 0;
        float mStartPos = 0;
        float mStartTime = 0;
        float mEndV = 0;
        float mEndPos = 0;
        float mEndTime = 0;
        float mDeltaV = 0;
        float mDeltaT = 0;

        void setUp(float startV, float startPos, float startTime,
                   float endV, float endPos, float endTime) {
            this->mStartV = startV;
            this->mStartPos = startPos;
            this->mStartTime = startTime;
            this->mEndV = endV;
            this->mEndTime = endTime;
            this->mEndPos = endPos;
            mDeltaV = this->mEndV - this->mStartV;
            mDeltaT = this->mEndTime - this->mStartTime;
        }

        float getPos(float t) const {
            float dt = t - mStartTime;
            float pt = dt / mDeltaT;
            float v = mStartV + mDeltaV * pt;
            return dt * (mStartV + v) / 2.0f + mStartPos;
        }

        float getVel(float t) const {
            float dt = t - mStartTime;
            float pt = dt / (mEndTime - mStartTime);
            return mStartV + mDeltaV * pt;
        }
    };

    bool rampDown(float currentPos, float destination,
                  float currentVelocity, float maxTime) {
        float timeToDestination = 2.0f * ((destination - currentPos) / currentVelocity);
        if (timeToDestination > 0 && timeToDestination <= maxTime) {
            mNumberOfStages = 1;
            mStage[0].setUp(currentVelocity, currentPos, 0.0f, 0.0f, destination, timeToDestination);
            mDuration = timeToDestination;
            return true;
        }
        return false;
    }

    bool cruseThenRampDown(float currentPos, float destination,
                           float currentVelocity, float maxTime,
                           float maxA, float /*maxV*/) {
        float timeToBreak = currentVelocity / maxA;
        float brakeDist = currentVelocity * timeToBreak / 2.0f;
        float cruseDist = destination - currentPos - brakeDist;
        float cruseTime = cruseDist / currentVelocity;
        float totalTime = cruseTime + timeToBreak;
        if (totalTime > 0 && totalTime < maxTime) {
            mNumberOfStages = 2;
            mStage[0].setUp(currentVelocity, currentPos, 0.0f,
                           currentVelocity, cruseDist, cruseTime);
            mStage[1].setUp(currentVelocity, currentPos + cruseDist, cruseTime,
                           0.0f, destination, cruseTime + timeToBreak);
            mDuration = cruseTime + timeToBreak;
            return true;
        }
        return false;
    }

    bool rampUpRampDown(float currentPos, float destination,
                        float currentVelocity, float maxA,
                        float maxVelocity, float maxTime) {
        float sign = (maxA > 0) ? 1.0f : -1.0f;
        float inner = maxA * (destination - currentPos) + currentVelocity * currentVelocity / 2.0f;
        if (inner < 0) return false;
        float peak_v = sign * std::sqrt(inner);

        if (maxVelocity / peak_v > 1.0f) {
            float t1 = (peak_v - currentVelocity) / maxA;
            float d1 = (peak_v + currentVelocity) * t1 / 2.0f + currentPos;
            float t2 = peak_v / maxA;
            mNumberOfStages = 2;
            mStage[0].setUp(currentVelocity, currentPos, 0.0f, peak_v, d1, t1);
            mStage[1].setUp(peak_v, d1, t1, 0.0f, destination, t2 + t1);
            mDuration = t2 + t1;
            if (mDuration > maxTime) {
                return false;
            }
            if (mDuration < maxTime / 2.0f) {
                t1 = mDuration / 2.0f;
                t2 = t1;
                peak_v = (2.0f * (destination - currentPos) / t1 - currentVelocity) / 2.0f;
                d1 = (peak_v + currentVelocity) * t1 / 2.0f + currentPos;
                mNumberOfStages = 2;
                mStage[0].setUp(currentVelocity, currentPos, 0.0f, peak_v, d1, t1);
                mStage[1].setUp(peak_v, d1, t1, 0.0f, destination, t2 + t1);
                mDuration = t2 + t1;
                if (mDuration > maxTime) {
                    return false;
                }
            }
            return true;
        }
        return false;
    }

    void rampUpCruseRampDown(float currentPos, float destination,
                             float currentVelocity, float /*maxA*/,
                             float /*maxV*/, float maxTime) {
        float t1 = maxTime / 3.0f;
        float t2 = t1 * 2.0f;
        float distance = destination - currentPos;
        float dt2 = t2 - t1;
        float dt3 = maxTime - t2;
        float v1 = (2.0f * distance - currentVelocity * t1) / (t1 + 2.0f * dt2 + dt3);
        mDuration = maxTime;
        float d1 = (currentVelocity + v1) * t1 / 2.0f;
        float d2 = (v1 + v1) * (t2 - t1) / 2.0f;
        mNumberOfStages = 3;
        mStage[0].setUp(currentVelocity, currentPos, 0.0f, v1, currentPos + d1, t1);
        mStage[1].setUp(v1, currentPos + d1, t1, v1, currentPos + d1 + d2, t2);
        mStage[2].setUp(v1, currentPos + d1 + d2, t2, 0.0f, destination, maxTime);
        mDuration = maxTime;
    }

    float mStartPos = 0;
    float mStartV = 0;
    float mEndPos = 0;
    float mDuration = 0;
    Stage mStage[3];
    int mNumberOfStages = 0;
};

} // namespace rccore
