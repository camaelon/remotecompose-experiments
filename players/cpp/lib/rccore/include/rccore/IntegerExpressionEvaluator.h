#pragma once
#include <cstdint>
#include <cstdlib>
#include <algorithm>
#include <vector>

namespace rccore {

// Integer expression evaluator using bitmask-based operator identification.
// Operators are identified by checking (1 << i) & mask, not NaN encoding.
// Operator values are offset by OFFSET (0x10000).
class IntegerExpressionEvaluator {
public:
    static constexpr int OFFSET = 0x10000;

    // Operator constants (match Java IntegerExpressionEvaluator)
    // Binary operators (consume 2 operands)
    static constexpr int I_ADD       = OFFSET + 1;
    static constexpr int I_SUB       = OFFSET + 2;
    static constexpr int I_MUL       = OFFSET + 3;
    static constexpr int I_DIV       = OFFSET + 4;
    static constexpr int I_MOD       = OFFSET + 5;
    static constexpr int I_SHL       = OFFSET + 6;
    static constexpr int I_SHR       = OFFSET + 7;
    static constexpr int I_USHR      = OFFSET + 8;
    static constexpr int I_OR        = OFFSET + 9;
    static constexpr int I_AND       = OFFSET + 10;
    static constexpr int I_XOR       = OFFSET + 11;
    static constexpr int I_COPY_SIGN = OFFSET + 12;
    static constexpr int I_MIN       = OFFSET + 13;
    static constexpr int I_MAX       = OFFSET + 14;

    // Unary operators (consume 1 operand)
    static constexpr int I_NEG       = OFFSET + 15;
    static constexpr int I_ABS       = OFFSET + 16;
    static constexpr int I_INCR      = OFFSET + 17;
    static constexpr int I_DECR      = OFFSET + 18;
    static constexpr int I_NOT       = OFFSET + 19;
    static constexpr int I_SIGN      = OFFSET + 20;

    // Ternary operators (consume 3 operands)
    static constexpr int I_CLAMP     = OFFSET + 21;
    static constexpr int I_IFELSE    = OFFSET + 22;
    static constexpr int I_MAD       = OFFSET + 23;

    // Variable references
    static constexpr int I_VAR1      = OFFSET + 24;
    static constexpr int I_VAR2      = OFFSET + 25;
    static constexpr int I_VAR3      = OFFSET + 26;

    IntegerExpressionEvaluator() {
        mLocalStack.resize(128);
    }

    // Evaluate an integer RPN expression.
    // mask: bitmask where bit i set means exp[i] is an operator.
    // exp: array of values and operators (modified in-place as stack).
    // len: number of elements.
    int eval(int mask, int* exp, int len) {
        // Copy to local stack to avoid modifying caller's array
        if ((int)mLocalStack.size() < len) {
            mLocalStack.resize(len);
        }
        for (int i = 0; i < len; i++) mLocalStack[i] = exp[i];

        int sp = -1;
        for (int i = 0; i < len; i++) {
            int v = mLocalStack[i];
            if (((1 << i) & mask) != 0) {
                sp = opEval(sp, v);
            } else {
                mLocalStack[++sp] = v;
            }
        }
        return sp >= 0 ? mLocalStack[sp] : 0;
    }

    void setVar1(int v) { mVar[0] = v; }
    void setVar2(int v) { mVar[1] = v; }
    void setVar3(int v) { mVar[2] = v; }

    // Check if bit i in mask is set (i.e., position i is an operator)
    static bool isOperation(int mask, int i) {
        return ((1 << i) & mask) != 0;
    }

    // Check if position i is an ID reference (mask bit set AND value < OFFSET)
    static bool isId(int mask, int i, int value) {
        return ((1 << i) & mask) != 0 && value < OFFSET;
    }

private:
    int opEval(int sp, int id) {
        switch (id) {
            // Binary arithmetic
            case I_ADD:
                mLocalStack[sp - 1] = mLocalStack[sp - 1] + mLocalStack[sp];
                return sp - 1;
            case I_SUB:
                mLocalStack[sp - 1] = mLocalStack[sp - 1] - mLocalStack[sp];
                return sp - 1;
            case I_MUL:
                mLocalStack[sp - 1] = mLocalStack[sp - 1] * mLocalStack[sp];
                return sp - 1;
            case I_DIV:
                mLocalStack[sp - 1] = mLocalStack[sp - 1] / mLocalStack[sp];
                return sp - 1;
            case I_MOD:
                mLocalStack[sp - 1] = mLocalStack[sp - 1] % mLocalStack[sp];
                return sp - 1;

            // Bit shifts
            case I_SHL:
                mLocalStack[sp - 1] = mLocalStack[sp - 1] << mLocalStack[sp];
                return sp - 1;
            case I_SHR:
                mLocalStack[sp - 1] = mLocalStack[sp - 1] >> mLocalStack[sp];
                return sp - 1;
            case I_USHR:
                // Unsigned right shift (Java's >>>)
                mLocalStack[sp - 1] = static_cast<int>(
                    static_cast<uint32_t>(mLocalStack[sp - 1]) >> mLocalStack[sp]);
                return sp - 1;

            // Bitwise logic
            case I_OR:
                mLocalStack[sp - 1] = mLocalStack[sp - 1] | mLocalStack[sp];
                return sp - 1;
            case I_AND:
                mLocalStack[sp - 1] = mLocalStack[sp - 1] & mLocalStack[sp];
                return sp - 1;
            case I_XOR:
                mLocalStack[sp - 1] = mLocalStack[sp - 1] ^ mLocalStack[sp];
                return sp - 1;

            // Copy sign via bit manipulation (matches Java)
            case I_COPY_SIGN:
                mLocalStack[sp - 1] =
                    (mLocalStack[sp - 1] ^ (mLocalStack[sp] >> 31)) - (mLocalStack[sp] >> 31);
                return sp - 1;

            // Min / Max
            case I_MIN:
                mLocalStack[sp - 1] = std::min(mLocalStack[sp - 1], mLocalStack[sp]);
                return sp - 1;
            case I_MAX:
                mLocalStack[sp - 1] = std::max(mLocalStack[sp - 1], mLocalStack[sp]);
                return sp - 1;

            // Unary
            case I_NEG:
                mLocalStack[sp] = -mLocalStack[sp];
                return sp;
            case I_ABS:
                mLocalStack[sp] = std::abs(mLocalStack[sp]);
                return sp;
            case I_INCR:
                mLocalStack[sp] = mLocalStack[sp] + 1;
                return sp;
            case I_DECR:
                mLocalStack[sp] = mLocalStack[sp] - 1;
                return sp;
            case I_NOT:
                mLocalStack[sp] = ~mLocalStack[sp];
                return sp;
            case I_SIGN:
                // Java: (x >> 31) | (-x >>> 31)
                mLocalStack[sp] = (mLocalStack[sp] >> 31) |
                    static_cast<int>(static_cast<uint32_t>(-mLocalStack[sp]) >> 31);
                return sp;

            // Ternary: CLAMP(val, max, min) — note Java order: min(max(val, min_val), max_val)
            // Java: mStack[sp-2] = Math.min(Math.max(mStack[sp-2], mStack[sp]), mStack[sp-1])
            case I_CLAMP:
                mLocalStack[sp - 2] = std::min(
                    std::max(mLocalStack[sp - 2], mLocalStack[sp]),
                    mLocalStack[sp - 1]);
                return sp - 2;

            // Ternary conditional: (cond > 0) ? trueVal : falseVal
            // Java: mStack[sp-2] = (mStack[sp] > 0) ? mStack[sp-1] : mStack[sp-2]
            case I_IFELSE:
                mLocalStack[sp - 2] = (mLocalStack[sp] > 0)
                    ? mLocalStack[sp - 1] : mLocalStack[sp - 2];
                return sp - 2;

            // Multiply-add: a + b * c
            // Java: mStack[sp-2] = mStack[sp] + mStack[sp-1] * mStack[sp-2]
            case I_MAD:
                mLocalStack[sp - 2] =
                    mLocalStack[sp] + mLocalStack[sp - 1] * mLocalStack[sp - 2];
                return sp - 2;

            // Variable references
            case I_VAR1:
                mLocalStack[++sp] = mVar[0];
                return sp;
            case I_VAR2:
                mLocalStack[++sp] = mVar[1];
                return sp;
            case I_VAR3:
                mLocalStack[++sp] = mVar[2];
                return sp;

            default:
                return sp;
        }
    }

    std::vector<int> mLocalStack;
    int mVar[3] = {0, 0, 0};
};

} // namespace rccore
