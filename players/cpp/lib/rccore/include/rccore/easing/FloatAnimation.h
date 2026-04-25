#pragma once
#include "Easing.h"
#include "CubicEasing.h"
#include "BounceCurve.h"
#include "ElasticOutCurve.h"
#include "StepCurve.h"
#include <cmath>
#include <cstring>
#include <memory>
#include <vector>

namespace rccore {

// Animation controller for FloatExpression.
// Parses packed float spec, creates easing curves, handles wrap/directional snap.
// Matches Java: FloatAnimation.java
class FloatAnimation : public Easing {
public:
    explicit FloatAnimation(const float* description, int descLen) {
        mType = CUBIC_STANDARD;
        setAnimationDescription(description, descLen);
    }

    float getDuration() const { return mDuration; }
    float getInitialValue() const { return mInitialValue; }
    float getTargetValue() const { return mTargetValue; }

    void setInitialValue(float value) {
        if (std::isnan(mWrap)) {
            mInitialValue = value;
        } else {
            mInitialValue = std::fmod(value, mWrap);
        }
        setScaleOffset();
    }

    void setTargetValue(float value) {
        mTargetValue = value;
        if (!std::isnan(mWrap)) {
            mInitialValue = wrap(mWrap, mInitialValue);
            mTargetValue = wrap(mWrap, mTargetValue);
            if (std::isnan(mInitialValue)) {
                mInitialValue = mTargetValue;
            }
            float dist = wrapDistance(mWrap, mInitialValue, mTargetValue);
            if ((dist > 0) && (mTargetValue < mInitialValue)) {
                mTargetValue += mWrap;
            } else if ((dist < 0) && mDirectionalSnap != 0) {
                if (mDirectionalSnap == 1 && mTargetValue > mInitialValue) {
                    mInitialValue = mTargetValue;
                }
                if (mDirectionalSnap == 2 && mTargetValue < mInitialValue) {
                    mInitialValue = mTargetValue;
                }
                mTargetValue -= mWrap;
            }
        }
        setScaleOffset();
    }

    // Get interpolated value at time t (seconds since animation start)
    float get(float t) override {
        if (mDirectionalSnap == 1 && mTargetValue < mInitialValue) {
            mInitialValue = mTargetValue;
            return mTargetValue;
        }
        if (mDirectionalSnap == 2 && mTargetValue > mInitialValue) {
            mInitialValue = mTargetValue;
            return mTargetValue;
        }
        return mEasingCurve->get(t / mDuration) * (mTargetValue - mInitialValue) + mInitialValue;
    }

    float getDiff(float t) override {
        return mEasingCurve->getDiff(t / mDuration) * (mTargetValue - mInitialValue);
    }

private:
    void setAnimationDescription(const float* spec, int specLen) {
        mDuration = (specLen == 0) ? 1.0f : spec[0];
        int len = 0;
        if (specLen > 1) {
            int32_t bits;
            memcpy(&bits, &spec[1], sizeof(bits));
            mType = bits & 0xFF;
            bool hasWrap = ((bits >> 8) & 0x1) > 0;
            bool hasInit = ((bits >> 8) & 0x2) > 0;
            mDirectionalSnap = (bits >> 10) & 0x3;
            // mPropagate = ((bits >> 12) & 0x1) > 0;
            len = (bits >> 16) & 0xFFFF;
            int off = 2 + len;
            if (hasInit) {
                mInitialValue = spec[off++];
            }
            if (hasWrap) {
                mWrap = spec[off];
            }
        }
        create(mType, spec, 2, len);
    }

    void create(int type, const float* params, int offset, int len) {
        switch (type) {
            case CUBIC_STANDARD:
            case CUBIC_ACCELERATE:
            case CUBIC_DECELERATE:
            case CUBIC_LINEAR:
            case CUBIC_ANTICIPATE:
            case CUBIC_OVERSHOOT:
                mEasingCurve = std::make_unique<CubicEasing>(type);
                break;
            case CUBIC_CUSTOM:
                mEasingCurve = std::make_unique<CubicEasing>(
                    params[offset + 0], params[offset + 1],
                    params[offset + 2], params[offset + 3]);
                break;
            case EASE_OUT_BOUNCE:
                mEasingCurve = std::make_unique<BounceCurve>(type);
                break;
            case EASE_OUT_ELASTIC:
                mEasingCurve = std::make_unique<ElasticOutCurve>();
                break;
            case SPLINE_CUSTOM:
                mEasingCurve = std::make_unique<StepCurve>(params, offset, len);
                break;
            default:
                mEasingCurve = std::make_unique<CubicEasing>(CUBIC_STANDARD);
                break;
        }
    }

    static float wrap(float wrapVal, float value) {
        value = std::fmod(value, wrapVal);
        if (value < 0) value += wrapVal;
        return value;
    }

    float wrapDistance(float wrapVal, float from, float to) const {
        float delta = std::fmod(to - from, 360.0f);
        if (delta < -wrapVal / 2.0f) delta += wrapVal;
        else if (delta > wrapVal / 2.0f) delta -= wrapVal;
        return delta;
    }

    void setScaleOffset() {
        if (!std::isnan(mInitialValue) && !std::isnan(mTargetValue)) {
            mOffset = mInitialValue;
        } else {
            mOffset = 0.0f;
        }
    }

    float mDuration = 1.0f;
    float mWrap = NAN;
    float mInitialValue = NAN;
    float mTargetValue = NAN;
    int mDirectionalSnap = 0;
    float mOffset = 0.0f;
    std::unique_ptr<Easing> mEasingCurve;
};

} // namespace rccore
