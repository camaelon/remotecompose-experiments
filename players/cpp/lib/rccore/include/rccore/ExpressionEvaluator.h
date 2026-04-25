#pragma once
#include <cstdint>
#include <cmath>
#include <cstring>
#include <vector>
#include <algorithm>
#include <functional>
#include <random>

namespace rccore {

class RemoteContext;

// NaN region masks (from NanMap.java)
// ID structure: bits 20-22 = region, bits 0-19 = sub-id
static constexpr int ID_REGION_MASK  = 0x300000;
static constexpr int ID_REGION_SYS   = 0x000000; // system variables
static constexpr int ID_REGION_USER  = 0x100000; // user variables
static constexpr int ID_REGION_ARRAY = 0x200000; // data arrays
static constexpr int ID_REGION_OP    = 0x300000; // operators/commands

// Expression operator offsets (base = 0x310000)
static constexpr int EXPR_OFFSET = 0x310000;

// Float collections access interface
class CollectionsAccess {
public:
    virtual ~CollectionsAccess() = default;
    virtual const std::vector<float>* getFloats(int id) const = 0;
};

class ExpressionEvaluator {
public:
    ExpressionEvaluator() {
        mStack.resize(64);
        mRegisters.resize(4, 0.0f);
    }

    // Evaluate an RPN expression, resolving variables from context
    float eval(const RemoteContext& context, const CollectionsAccess* ca,
               const float* expr, int len);

    // Set loop variable values (used by PathExpression, ParticlesLoop, etc.)
    void setVar1(float v) { mVar1 = v; }
    void setVar2(float v) { mVar2 = v; }
    void setVar3(float v) { mVar3 = v; }

    // Check if a NaN float is a math operator
    static bool isMathOperator(float v) {
        if (!std::isnan(v)) return false;
        int id = fromNaN(v);
        return (id & ID_REGION_MASK) == ID_REGION_OP;
    }

    // Check if a NaN float is a data variable (array)
    static bool isDataVariable(float v) {
        if (!std::isnan(v)) return false;
        int id = fromNaN(v);
        return (id & ID_REGION_MASK) == ID_REGION_ARRAY;
    }

    // Extract integer ID from NaN float
    static int fromNaN(float v) {
        int32_t bits;
        memcpy(&bits, &v, sizeof(bits));
        return bits & 0x7FFFFF;
    }

    // Convert integer to NaN float
    static float toNaN(int v) {
        int32_t bits = v | static_cast<int32_t>(0xFF800000);
        float f;
        memcpy(&f, &bits, sizeof(f));
        return f;
    }

    // Operator constants
    enum Op {
        ADD = EXPR_OFFSET + 1,
        SUB = EXPR_OFFSET + 2,
        MUL = EXPR_OFFSET + 3,
        DIV = EXPR_OFFSET + 4,
        MOD = EXPR_OFFSET + 5,
        MIN_OP = EXPR_OFFSET + 6,
        MAX_OP = EXPR_OFFSET + 7,
        POW = EXPR_OFFSET + 8,
        SQRT_OP = EXPR_OFFSET + 9,
        ABS_OP = EXPR_OFFSET + 10,
        SIGN = EXPR_OFFSET + 11,
        COPY_SIGN = EXPR_OFFSET + 12,
        EXP_OP = EXPR_OFFSET + 13,
        FLOOR_OP = EXPR_OFFSET + 14,
        LOG10_OP = EXPR_OFFSET + 15,
        LN_OP = EXPR_OFFSET + 16,
        ROUND_OP = EXPR_OFFSET + 17,
        SIN_OP = EXPR_OFFSET + 18,
        COS_OP = EXPR_OFFSET + 19,
        TAN_OP = EXPR_OFFSET + 20,
        ASIN_OP = EXPR_OFFSET + 21,
        ACOS_OP = EXPR_OFFSET + 22,
        ATAN_OP = EXPR_OFFSET + 23,
        ATAN2_OP = EXPR_OFFSET + 24,
        MAD = EXPR_OFFSET + 25,
        IFELSE = EXPR_OFFSET + 26,
        CLAMP = EXPR_OFFSET + 27,
        CBRT_OP = EXPR_OFFSET + 28,
        DEG = EXPR_OFFSET + 29,
        RAD = EXPR_OFFSET + 30,
        CEIL_OP = EXPR_OFFSET + 31,
        A_DEREF = EXPR_OFFSET + 32,
        A_MAX = EXPR_OFFSET + 33,
        A_MIN = EXPR_OFFSET + 34,
        A_SUM = EXPR_OFFSET + 35,
        A_AVG = EXPR_OFFSET + 36,
        A_LEN = EXPR_OFFSET + 37,
        A_SPLINE = EXPR_OFFSET + 38,
        RAND_OP = EXPR_OFFSET + 39,
        RAND_SEED = EXPR_OFFSET + 40,
        NOISE_FROM = EXPR_OFFSET + 41,
        RAND_IN_RANGE = EXPR_OFFSET + 42,
        SQUARE_SUM = EXPR_OFFSET + 43,
        STEP = EXPR_OFFSET + 44,
        SQUARE = EXPR_OFFSET + 45,
        DUP = EXPR_OFFSET + 46,
        HYPOT_OP = EXPR_OFFSET + 47,
        SWAP = EXPR_OFFSET + 48,
        LERP = EXPR_OFFSET + 49,
        SMOOTH_STEP = EXPR_OFFSET + 50,
        LOG2_OP = EXPR_OFFSET + 51,
        INV = EXPR_OFFSET + 52,
        FRACT = EXPR_OFFSET + 53,
        PINGPONG = EXPR_OFFSET + 54,
        NOP = EXPR_OFFSET + 55,
        STORE_R0 = EXPR_OFFSET + 56,
        STORE_R1 = EXPR_OFFSET + 57,
        STORE_R2 = EXPR_OFFSET + 58,
        STORE_R3 = EXPR_OFFSET + 59,
        LOAD_R0 = EXPR_OFFSET + 60,
        LOAD_R1 = EXPR_OFFSET + 61,
        LOAD_R2 = EXPR_OFFSET + 62,
        LOAD_R3 = EXPR_OFFSET + 63,
        CMD1 = EXPR_OFFSET + 64,
        CMD2 = EXPR_OFFSET + 65,
        VAR1 = EXPR_OFFSET + 70,
        VAR2 = EXPR_OFFSET + 71,
        VAR3 = EXPR_OFFSET + 72,
        CHANGE_SIGN = EXPR_OFFSET + 73,
        CUBIC = EXPR_OFFSET + 74,
        A_SPLINE_LOOP = EXPR_OFFSET + 75,
        A_SUM_TILL = EXPR_OFFSET + 76,
        A_SUM_XY = EXPR_OFFSET + 77,
        A_SUM_SQR = EXPR_OFFSET + 78,
        A_LERP = EXPR_OFFSET + 79,
    };

    // Monotonic cubic Hermite spline interpolation
    static float splineInterp(const std::vector<float>& y, float pos);

private:
    int opEval(int sp, int opId);

    std::vector<float> mStack;
    std::vector<float> mRegisters;
    const CollectionsAccess* mCollections = nullptr;
    std::mt19937 mRng{42};
    float mVar1 = 0.0f, mVar2 = 0.0f, mVar3 = 0.0f;
};

} // namespace rccore
