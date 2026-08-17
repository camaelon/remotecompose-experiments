#pragma once
// VectorRpn: reverse-polish evaluator for vector-valued expressions (op 116's kernel).
//
// Port of the reference VectorRpn.java. Every stack value occupies MAX_DIM (4) lanes; a scalar
// broadcasts across all four and unused high lanes are zero-padded, which is what makes dot and
// length correct at any dimensionality without branching per operator.

#include <cstdint>
#include <vector>

namespace rccore::d3 {

constexpr int VEC_OFFSET = 0x310000;
constexpr int VEC_MAX_DIM = 4;

/** True iff v is one of the vector-specific opcodes (OFFSET+100..107). */
bool isVectorOp(float v);

class VectorRpn {
public:
    /**
     * When true, divide and normalize substitute a tiny denominator for a near-zero one instead
     * of producing Inf/NaN. Off by default; the owning op flips it for a corrective retry.
     */
    bool mSoftDomain = false;

    /** Evaluate program[0..len) into out (>= MAX_DIM). Returns the result's dimensionality. */
    int apply(const float* program, int len, float* out);

private:
    int opEval(int sp, int id);
    int build(int sp, int n);
    float softDenom(float denom) const;

    float mProgram[512]{};
    float mStack[64 * VEC_MAX_DIM]{};
    int mDim[64]{};
};

} // namespace rccore::d3
