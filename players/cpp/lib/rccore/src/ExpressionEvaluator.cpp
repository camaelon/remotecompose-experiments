#include "rccore/ExpressionEvaluator.h"
#include "rccore/RemoteContext.h"
#include <cmath>
#include <algorithm>
#include <numeric>

namespace rccore {

float ExpressionEvaluator::eval(const RemoteContext& context,
                                 const CollectionsAccess* ca,
                                 const float* expr, int len) {
    mCollections = ca;
    if (len <= 0) return 0.0f;

    // Ensure stack capacity
    if ((int)mStack.size() < len + 16) {
        mStack.resize(len + 16);
    }

    int sp = -1;

    for (int i = 0; i < len; i++) {
        float v = expr[i];
        if (std::isnan(v)) {
            int id = fromNaN(v);
            if ((id & ID_REGION_MASK) == ID_REGION_ARRAY) {
                // Array reference - push as-is for array operators
                mStack[++sp] = v;
            } else if ((id & ID_REGION_MASK) == ID_REGION_OP) {
                // Math operator
                sp = opEval(sp, id);
            } else {
                // Variable reference - resolve from context
                float resolved = context.getFloat(id);
                mStack[++sp] = resolved;
            }
        } else {
            // Literal float value
            mStack[++sp] = v;
        }
    }

    return sp >= 0 ? mStack[sp] : 0.0f;
}

int ExpressionEvaluator::opEval(int sp, int opId) {
    switch (opId) {
        // Binary arithmetic
        case ADD: { float b = mStack[sp--]; mStack[sp] += b; break; }
        case SUB: { float b = mStack[sp--]; mStack[sp] -= b; break; }
        case MUL: { float b = mStack[sp--]; mStack[sp] *= b; break; }
        case DIV: {
            float b = mStack[sp--];
            mStack[sp] = (b != 0.0f) ? mStack[sp] / b : 0.0f;
            break;
        }
        case MOD: {
            float b = mStack[sp--];
            mStack[sp] = (b != 0.0f) ? std::fmod(mStack[sp], b) : 0.0f;
            break;
        }
        case MIN_OP: { float b = mStack[sp--]; mStack[sp] = std::min(mStack[sp], b); break; }
        case MAX_OP: { float b = mStack[sp--]; mStack[sp] = std::max(mStack[sp], b); break; }
        case POW: { float b = mStack[sp--]; mStack[sp] = std::pow(mStack[sp], b); break; }
        case ATAN2_OP: { float b = mStack[sp--]; mStack[sp] = std::atan2(mStack[sp], b); break; }
        case COPY_SIGN: { float b = mStack[sp--]; mStack[sp] = std::copysign(mStack[sp], b); break; }

        // Unary math
        case SQRT_OP: mStack[sp] = std::sqrt(mStack[sp]); break;
        case ABS_OP: mStack[sp] = std::abs(mStack[sp]); break;
        case SIGN: mStack[sp] = (mStack[sp] > 0) ? 1.0f : (mStack[sp] < 0) ? -1.0f : 0.0f; break;
        case EXP_OP: mStack[sp] = std::exp(mStack[sp]); break;
        case FLOOR_OP: mStack[sp] = std::floor(mStack[sp]); break;
        case CEIL_OP: mStack[sp] = std::ceil(mStack[sp]); break;
        case LOG10_OP: mStack[sp] = std::log10(mStack[sp]); break;
        case LN_OP: mStack[sp] = std::log(mStack[sp]); break;
        case LOG2_OP: mStack[sp] = std::log2(mStack[sp]); break;
        case ROUND_OP: mStack[sp] = std::round(mStack[sp]); break;
        case CBRT_OP: mStack[sp] = std::cbrt(mStack[sp]); break;
        case DEG: mStack[sp] = mStack[sp] * 57.29578f; break;
        case RAD: mStack[sp] = mStack[sp] * 0.017453292f; break;
        case CHANGE_SIGN: mStack[sp] = -mStack[sp]; break;
        case SQUARE: mStack[sp] = mStack[sp] * mStack[sp]; break;
        case INV: mStack[sp] = (mStack[sp] != 0.0f) ? 1.0f / mStack[sp] : 0.0f; break;
        case FRACT: { float x = mStack[sp]; mStack[sp] = x - std::trunc(x); break; }

        // Trig
        case SIN_OP: mStack[sp] = std::sin(mStack[sp]); break;
        case COS_OP: mStack[sp] = std::cos(mStack[sp]); break;
        case TAN_OP: mStack[sp] = std::tan(mStack[sp]); break;
        case ASIN_OP: mStack[sp] = std::asin(mStack[sp]); break;
        case ACOS_OP: mStack[sp] = std::acos(mStack[sp]); break;
        case ATAN_OP: mStack[sp] = std::atan(mStack[sp]); break;

        // Ternary
        case MAD: {
            float a = mStack[sp--]; float b = mStack[sp--];
            mStack[sp] = mStack[sp] + b * a;
            break;
        }
        case IFELSE: {
            // TS: cond=pop, trueVal=pop, falseVal=pop; push cond>0 ? trueVal : falseVal
            float cond = mStack[sp--]; float trueVal = mStack[sp--];
            mStack[sp] = (cond > 0) ? trueVal : mStack[sp];
            break;
        }
        case CLAMP: {
            // Match Java: min(max(sp-2, sp), sp-1)
            float top = mStack[sp--]; float second = mStack[sp--];
            mStack[sp] = std::min(std::max(mStack[sp], top), second);
            break;
        }
        case LERP: {
            float t = mStack[sp--]; float b = mStack[sp--];
            mStack[sp] = mStack[sp] + (b - mStack[sp]) * t;
            break;
        }

        // Binary comparison
        case SQUARE_SUM: {
            float b = mStack[sp--];
            mStack[sp] = mStack[sp] * mStack[sp] + b * b;
            break;
        }
        case STEP: {
            float b = mStack[sp--];
            mStack[sp] = (mStack[sp] > b) ? 1.0f : 0.0f;
            break;
        }
        case HYPOT_OP: {
            float b = mStack[sp--];
            mStack[sp] = std::hypot(mStack[sp], b);
            break;
        }
        case PINGPONG: {
            float max = mStack[sp--];
            float x = mStack[sp];
            if (max > 0) {
                float t = std::fmod(x, max * 2.0f);
                if (t < 0) t += max * 2.0f;
                mStack[sp] = (t < max) ? t : (max * 2.0f - t);
            } else {
                mStack[sp] = 0.0f;
            }
            break;
        }

        // Smooth step
        case SMOOTH_STEP: {
            // TS: mn=pop, mx=pop, val=pop; smoothstep(val, mn, mx)
            float mn = mStack[sp--]; float mx = mStack[sp--]; float val = mStack[sp];
            if (val < mn) { mStack[sp] = 0.0f; }
            else if (val > mx) { mStack[sp] = 1.0f; }
            else {
                float t = (mx != mn) ? (val - mn) / (mx - mn) : 0.0f;
                mStack[sp] = t * t * (3.0f - 2.0f * t);
            }
            break;
        }

        // Stack ops
        case DUP: { mStack[sp + 1] = mStack[sp]; sp++; break; }
        case SWAP: { float t = mStack[sp]; mStack[sp] = mStack[sp - 1]; mStack[sp - 1] = t; break; }
        case NOP: break;

        // Registers
        case STORE_R0: mRegisters[0] = mStack[sp--]; break;
        case STORE_R1: mRegisters[1] = mStack[sp--]; break;
        case STORE_R2: mRegisters[2] = mStack[sp--]; break;
        case STORE_R3: mRegisters[3] = mStack[sp--]; break;
        case LOAD_R0: mStack[++sp] = mRegisters[0]; break;
        case LOAD_R1: mStack[++sp] = mRegisters[1]; break;
        case LOAD_R2: mStack[++sp] = mRegisters[2]; break;
        case LOAD_R3: mStack[++sp] = mRegisters[3]; break;

        // Random
        case RAND_OP: {
            std::uniform_real_distribution<float> dist(0.0f, 1.0f);
            mStack[++sp] = dist(mRng);
            break;
        }
        case RAND_SEED: {
            mRng.seed(static_cast<unsigned>(mStack[sp--]));
            break;
        }
        case NOISE_FROM: {
            // Deterministic hash-based noise
            int32_t bits;
            memcpy(&bits, &mStack[sp], sizeof(bits));
            uint32_t h = static_cast<uint32_t>(bits);
            h ^= h >> 16; h *= 0x45d9f3b; h ^= h >> 16; h *= 0x45d9f3b; h ^= h >> 16;
            mStack[sp] = static_cast<float>(h & 0x7FFFFFFF) / 2147483647.0f;
            break;
        }
        case RAND_IN_RANGE: {
            float b = mStack[sp--]; float a = mStack[sp];
            std::uniform_real_distribution<float> dist(a, b);
            mStack[sp] = dist(mRng);
            break;
        }

        // Array operations
        case A_DEREF: {
            float idx = mStack[sp--];
            float arrRef = mStack[sp];
            if (mCollections && std::isnan(arrRef)) {
                int arrId = fromNaN(arrRef);
                auto* arr = mCollections->getFloats(arrId);
                if (arr && !arr->empty()) {
                    int i = std::clamp((int)idx, 0, (int)arr->size() - 1);
                    mStack[sp] = (*arr)[i];
                } else {
                    mStack[sp] = 0.0f;
                }
            } else {
                mStack[sp] = 0.0f;
            }
            break;
        }
        case A_LEN: {
            float arrRef = mStack[sp];
            if (mCollections && std::isnan(arrRef)) {
                int arrId = fromNaN(arrRef);
                auto* arr = mCollections->getFloats(arrId);
                mStack[sp] = arr ? (float)arr->size() : 0.0f;
            } else {
                mStack[sp] = 0.0f;
            }
            break;
        }
        case A_SUM: {
            float arrRef = mStack[sp];
            if (mCollections && std::isnan(arrRef)) {
                int arrId = fromNaN(arrRef);
                auto* arr = mCollections->getFloats(arrId);
                if (arr && !arr->empty()) {
                    float sum = 0;
                    for (float f : *arr) sum += f;
                    mStack[sp] = sum;
                } else {
                    mStack[sp] = 0.0f;
                }
            } else {
                mStack[sp] = 0.0f;
            }
            break;
        }
        case A_MAX: {
            float arrRef = mStack[sp];
            if (mCollections && std::isnan(arrRef)) {
                int arrId = fromNaN(arrRef);
                auto* arr = mCollections->getFloats(arrId);
                if (arr && !arr->empty()) {
                    mStack[sp] = *std::max_element(arr->begin(), arr->end());
                } else {
                    mStack[sp] = 0.0f;
                }
            } else {
                mStack[sp] = 0.0f;
            }
            break;
        }
        case A_MIN: {
            float arrRef = mStack[sp];
            if (mCollections && std::isnan(arrRef)) {
                int arrId = fromNaN(arrRef);
                auto* arr = mCollections->getFloats(arrId);
                if (arr && !arr->empty()) {
                    mStack[sp] = *std::min_element(arr->begin(), arr->end());
                } else {
                    mStack[sp] = 0.0f;
                }
            } else {
                mStack[sp] = 0.0f;
            }
            break;
        }
        case A_AVG: {
            float arrRef = mStack[sp];
            if (mCollections && std::isnan(arrRef)) {
                int arrId = fromNaN(arrRef);
                auto* arr = mCollections->getFloats(arrId);
                if (arr && !arr->empty()) {
                    float sum = 0;
                    for (float f : *arr) sum += f;
                    mStack[sp] = sum / (float)arr->size();
                } else {
                    mStack[sp] = 0.0f;
                }
            } else {
                mStack[sp] = 0.0f;
            }
            break;
        }
        case A_SUM_TILL: {
            // TS: inclusive loop: for j = 0..stLast (j <= stLast)
            float n = mStack[sp--];
            float arrRef = mStack[sp];
            if (mCollections && std::isnan(arrRef)) {
                int arrId = fromNaN(arrRef);
                auto* arr = mCollections->getFloats(arrId);
                if (arr) {
                    int last = (int)std::trunc(n);
                    float sum = 0;
                    for (int j = 0; j <= last && j < (int)arr->size(); j++) sum += (*arr)[j];
                    mStack[sp] = sum;
                } else {
                    mStack[sp] = 0.0f;
                }
            } else {
                mStack[sp] = 0.0f;
            }
            break;
        }
        case A_SUM_SQR: {
            float arrRef = mStack[sp];
            if (mCollections && std::isnan(arrRef)) {
                int arrId = fromNaN(arrRef);
                auto* arr = mCollections->getFloats(arrId);
                if (arr && !arr->empty()) {
                    float sum = 0;
                    for (float f : *arr) sum += f * f;
                    mStack[sp] = sum;
                } else {
                    mStack[sp] = 0.0f;
                }
            } else {
                mStack[sp] = 0.0f;
            }
            break;
        }
        case A_SPLINE: {
            // Monotonic cubic Hermite spline interpolation
            float pos = mStack[sp--];
            float arrRef = mStack[sp];
            if (mCollections && std::isnan(arrRef)) {
                int arrId = fromNaN(arrRef);
                auto* arr = mCollections->getFloats(arrId);
                mStack[sp] = (arr && !arr->empty()) ? splineInterp(*arr, pos) : 0.0f;
            } else {
                mStack[sp] = 0.0f;
            }
            break;
        }
        case A_SPLINE_LOOP: {
            float sli = mStack[sp--];
            float arrRef = mStack[sp];
            if (mCollections && std::isnan(arrRef)) {
                int arrId = fromNaN(arrRef);
                auto* arr = mCollections->getFloats(arrId);
                if (arr && !arr->empty()) {
                    float slr = sli - std::floor(sli);
                    if (slr < 0) slr += 1.0f;
                    mStack[sp] = splineInterp(*arr, slr);
                } else {
                    mStack[sp] = 0.0f;
                }
            } else {
                mStack[sp] = 0.0f;
            }
            break;
        }
        case A_SUM_XY: {
            // Sum of element-wise products of two arrays
            float arrRefY = mStack[sp--];
            float arrRefX = mStack[sp];
            if (mCollections && std::isnan(arrRefX) && std::isnan(arrRefY)) {
                int idX = fromNaN(arrRefX);
                int idY = fromNaN(arrRefY);
                auto* arrX = mCollections->getFloats(idX);
                auto* arrY = mCollections->getFloats(idY);
                float sum = 0.0f;
                if (arrX && arrY) {
                    int len = std::min((int)arrX->size(), (int)arrY->size());
                    for (int j = 0; j < len; j++) sum += (*arrX)[j] * (*arrY)[j];
                }
                mStack[sp] = sum;
            } else {
                mStack[sp] = 0.0f;
            }
            break;
        }
        case A_LERP: {
            // Linear interpolation in array: pos in [0,1] maps across array
            float alPos = mStack[sp--];
            float arrRef = mStack[sp];
            if (mCollections && std::isnan(arrRef)) {
                int arrId = fromNaN(arrRef);
                auto* arr = mCollections->getFloats(arrId);
                if (arr && !arr->empty()) {
                    float alP = alPos * ((float)arr->size() - 1);
                    int alIdx = (int)std::trunc(alP);
                    if (alIdx < 0) {
                        mStack[sp] = (*arr)[0];
                    } else if (alIdx >= (int)arr->size() - 1) {
                        mStack[sp] = (*arr)[arr->size() - 1];
                    } else {
                        float t = alP - alIdx;
                        mStack[sp] = (*arr)[alIdx] + t * ((*arr)[alIdx + 1] - (*arr)[alIdx]);
                    }
                } else {
                    mStack[sp] = 0.0f;
                }
            } else {
                mStack[sp] = 0.0f;
            }
            break;
        }

        // Variable parameters (used by PathExpression, ParticlesLoop, etc.)
        case VAR1: mStack[++sp] = mVar1; break;
        case VAR2: mStack[++sp] = mVar2; break;
        case VAR3: mStack[++sp] = mVar3; break;

        // Cubic bezier easing
        case CUBIC: {
            // pops: pos, y2, x2, y1, x1
            float pos = mStack[sp--];
            float y2 = mStack[sp--]; float x2 = mStack[sp--];
            float y1 = mStack[sp--]; float x1 = mStack[sp];
            // Simple cubic approximation
            float t = pos;
            // Newton's method to solve for t given x
            for (int iter = 0; iter < 8; iter++) {
                float cx = 3.0f * x1 * t * (1-t) * (1-t) + 3.0f * x2 * t * t * (1-t) + t * t * t;
                float dx = 3.0f * x1 * (1-t) * (1-t) - 6.0f * x1 * t * (1-t) + 6.0f * x2 * t * (1-t) - 3.0f * x2 * t * t + 3.0f * t * t;
                if (std::abs(dx) < 1e-6f) break;
                t -= (cx - pos) / dx;
                t = std::clamp(t, 0.0f, 1.0f);
            }
            mStack[sp] = 3.0f * y1 * t * (1-t) * (1-t) + 3.0f * y2 * t * t * (1-t) + t * t * t;
            break;
        }

        default:
            // Unknown operator - nop
            break;
    }
    return sp;
}

float ExpressionEvaluator::splineInterp(const std::vector<float>& y, float pos) {
    int n = (int)y.size();
    if (n == 0) return 0.0f;
    if (n == 1) return y[0];

    // Build evenly-spaced time array [0..1]
    std::vector<double> t(n);
    for (int i = 0; i < n; i++) t[i] = (double)i / (n - 1);

    // Compute slopes between consecutive points
    std::vector<double> slope(n - 1);
    std::vector<double> tangent(n);
    for (int i = 0; i < n - 1; i++) {
        double dt = t[i + 1] - t[i];
        slope[i] = ((double)y[i + 1] - (double)y[i]) / dt;
        if (i == 0) {
            tangent[i] = slope[i];
        } else {
            tangent[i] = (slope[i - 1] + slope[i]) * 0.5;
        }
    }
    tangent[n - 1] = slope[n - 2];

    // Monotonicity correction (Fritsch-Carlson)
    for (int i = 0; i < n - 1; i++) {
        if (slope[i] == 0.0) {
            tangent[i] = 0.0;
            tangent[i + 1] = 0.0;
        } else {
            double a = tangent[i] / slope[i];
            double b = tangent[i + 1] / slope[i];
            double h = std::hypot(a, b);
            if (h > 9.0) {
                double s = 3.0 / h;
                tangent[i] = s * a * slope[i];
                tangent[i + 1] = s * b * slope[i];
            }
        }
    }

    // Extrapolate beyond boundaries
    double dp = (double)pos;
    if (dp <= t[0]) {
        double h0 = t[1] - t[0];
        double d0 = tangent[0]; // derivative at start
        return (float)((double)y[0] + (dp - t[0]) * d0);
    }
    if (dp >= t[n - 1]) {
        double hn = t[n - 1] - t[n - 2];
        double d1 = tangent[n - 1]; // derivative at end
        return (float)((double)y[n - 1] + (dp - t[n - 1]) * d1);
    }

    // Find the segment containing pos
    for (int i = 0; i < n - 1; i++) {
        if (dp < t[i + 1]) {
            double h = t[i + 1] - t[i];
            double x = (dp - t[i]) / h;
            double x2 = x * x;
            double x3 = x2 * x;
            double y1 = y[i], y2v = y[i + 1], t1 = tangent[i], t2 = tangent[i + 1];
            return (float)(-2.0 * x3 * y2v + 3.0 * x2 * y2v + 2.0 * x3 * y1 - 3.0 * x2 * y1 + y1
                + h * t2 * x3 + h * t1 * x3 - h * t2 * x2 - 2.0 * h * t1 * x2 + h * t1 * x);
        }
    }
    return y[n - 1];
}

} // namespace rccore
