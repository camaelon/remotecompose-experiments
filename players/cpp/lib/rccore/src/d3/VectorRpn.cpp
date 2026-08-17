#include "rccore/d3/VectorRpn.h"

#include "rccore/d3/JavaMath.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <stdexcept>

namespace rccore::d3 {
namespace {

constexpr int MAX_STACK = 64;
constexpr int MAX_PROGRAM = 512;
constexpr float SOFT_DOMAIN_EPS = 1e-6f;

enum : int {
    OP_ADD = VEC_OFFSET + 1, OP_SUB = VEC_OFFSET + 2, OP_MUL = VEC_OFFSET + 3,
    OP_DIV = VEC_OFFSET + 4, OP_MOD = VEC_OFFSET + 5, OP_MIN = VEC_OFFSET + 6,
    OP_MAX = VEC_OFFSET + 7, OP_POW = VEC_OFFSET + 8, OP_SQRT = VEC_OFFSET + 9,
    OP_ABS = VEC_OFFSET + 10, OP_FLOOR = VEC_OFFSET + 14, OP_ROUND = VEC_OFFSET + 17,
    OP_SIN = VEC_OFFSET + 18, OP_COS = VEC_OFFSET + 19, OP_CEIL = VEC_OFFSET + 31,
    OP_SQUARE = VEC_OFFSET + 45, OP_INV = VEC_OFFSET + 52, OP_NOP = VEC_OFFSET + 55,
    OP_CHANGE_SIGN = VEC_OFFSET + 73,
    OP_VBUILD2 = VEC_OFFSET + 100, OP_VBUILD3 = VEC_OFFSET + 101, OP_VBUILD4 = VEC_OFFSET + 102,
    OP_VDOT = VEC_OFFSET + 103, OP_VCROSS = VEC_OFFSET + 104, OP_VLEN = VEC_OFFSET + 105,
    OP_VLENSQ = VEC_OFFSET + 106, OP_VNORM = VEC_OFFSET + 107,
};

int fromNaN(float v) {
    int32_t b;
    std::memcpy(&b, &v, 4);
    return b & 0x7FFFFF;
}

/** Java's Math.round(float): floor(x + 0.5) as an int, saturating, NaN to 0. */
float javaRound(float x) {
    if (std::isnan(x)) return 0.f;
    double r = jfloor((double)(x + 0.5f));
    if (r >= 2147483647.0) return 2147483647.f;
    if (r <= -2147483648.0) return -2147483648.f;
    return (float)(int32_t) r;
}

} // namespace

bool isVectorOp(float v) {
    if (!std::isnan(v)) return false;
    int pos = fromNaN(v);
    return pos >= OP_VBUILD2 && pos <= OP_VNORM;
}

int VectorRpn::apply(const float* program, int len, float* out) {
    if (len > MAX_PROGRAM) throw std::runtime_error("VectorRpn: program too long");
    std::memcpy(mProgram, program, (size_t) len * sizeof(float));
    float* s = mStack;
    int sp = -1;
    for (int i = 0; i < len; i++) {
        float v = mProgram[i];
        if (std::isnan(v)) {
            sp = opEval(sp, fromNaN(v));
        } else {
            sp++;
            if (sp >= MAX_STACK) throw std::runtime_error("VectorRpn: stack overflow");
            int p = sp * VEC_MAX_DIM;
            s[p] = v; s[p+1] = v; s[p+2] = v; s[p+3] = v;   // a scalar broadcasts
            mDim[sp] = 1;
        }
    }
    if (sp < 0) throw std::runtime_error("VectorRpn: empty program");
    int p = sp * VEC_MAX_DIM;
    out[0] = s[p]; out[1] = s[p+1]; out[2] = s[p+2]; out[3] = s[p+3];
    return mDim[sp];
}

float VectorRpn::softDenom(float denom) const {
    if (mSoftDomain && denom < SOFT_DOMAIN_EPS && denom > -SOFT_DOMAIN_EPS) {
        return (denom < 0.f) ? -SOFT_DOMAIN_EPS : SOFT_DOMAIN_EPS;
    }
    return denom;
}

int VectorRpn::build(int sp, int n) {
    float* s = mStack;
    int base = sp - n + 1;
    float c0 = s[base * VEC_MAX_DIM];
    float c1 = (n > 1) ? s[(base + 1) * VEC_MAX_DIM] : 0.f;
    float c2 = (n > 2) ? s[(base + 2) * VEC_MAX_DIM] : 0.f;
    float c3 = (n > 3) ? s[(base + 3) * VEC_MAX_DIM] : 0.f;
    int p = base * VEC_MAX_DIM;
    s[p] = c0; s[p+1] = c1; s[p+2] = c2; s[p+3] = c3;   // high lanes zero for dot/len
    mDim[base] = n;
    return base;
}

int VectorRpn::opEval(int sp, int id) {
    float* s = mStack;
    int* d = mDim;
    const int a = (sp - 1) * VEC_MAX_DIM;
    const int b = sp * VEC_MAX_DIM;
    switch (id) {
        case OP_ADD:
            s[a] += s[b]; s[a+1] += s[b+1]; s[a+2] += s[b+2]; s[a+3] += s[b+3];
            d[sp-1] = std::max(d[sp-1], d[sp]); return sp - 1;
        case OP_SUB:
            s[a] -= s[b]; s[a+1] -= s[b+1]; s[a+2] -= s[b+2]; s[a+3] -= s[b+3];
            d[sp-1] = std::max(d[sp-1], d[sp]); return sp - 1;
        case OP_MUL:
            s[a] *= s[b]; s[a+1] *= s[b+1]; s[a+2] *= s[b+2]; s[a+3] *= s[b+3];
            d[sp-1] = std::max(d[sp-1], d[sp]); return sp - 1;
        case OP_DIV:
            s[a] /= softDenom(s[b]); s[a+1] /= softDenom(s[b+1]);
            s[a+2] /= softDenom(s[b+2]); s[a+3] /= softDenom(s[b+3]);
            d[sp-1] = std::max(d[sp-1], d[sp]); return sp - 1;
        case OP_MOD:
            s[a] = std::fmod(s[a], softDenom(s[b]));
            s[a+1] = std::fmod(s[a+1], softDenom(s[b+1]));
            s[a+2] = std::fmod(s[a+2], softDenom(s[b+2]));
            s[a+3] = std::fmod(s[a+3], softDenom(s[b+3]));
            d[sp-1] = std::max(d[sp-1], d[sp]); return sp - 1;
        case OP_MIN:
            s[a] = std::fmin(s[a], s[b]); s[a+1] = std::fmin(s[a+1], s[b+1]);
            s[a+2] = std::fmin(s[a+2], s[b+2]); s[a+3] = std::fmin(s[a+3], s[b+3]);
            d[sp-1] = std::max(d[sp-1], d[sp]); return sp - 1;
        case OP_MAX:
            s[a] = std::fmax(s[a], s[b]); s[a+1] = std::fmax(s[a+1], s[b+1]);
            s[a+2] = std::fmax(s[a+2], s[b+2]); s[a+3] = std::fmax(s[a+3], s[b+3]);
            d[sp-1] = std::max(d[sp-1], d[sp]); return sp - 1;
        case OP_POW:
            s[a] = (float) jpow((double)(s[a]), s[b]);
            s[a+1] = (float) jpow((double)(s[a+1]), s[b+1]);
            s[a+2] = (float) jpow((double)(s[a+2]), s[b+2]);
            s[a+3] = (float) jpow((double)(s[a+3]), s[b+3]);
            d[sp-1] = std::max(d[sp-1], d[sp]); return sp - 1;
        case OP_SQRT:
            s[b] = (float) jsqrt((double)(s[b])); s[b+1] = (float) jsqrt((double)(s[b+1]));
            s[b+2] = (float) jsqrt((double)(s[b+2])); s[b+3] = (float) jsqrt((double)(s[b+3]));
            return sp;
        case OP_ABS:
            s[b] = std::fabs(s[b]); s[b+1] = std::fabs(s[b+1]);
            s[b+2] = std::fabs(s[b+2]); s[b+3] = std::fabs(s[b+3]);
            return sp;
        case OP_SQUARE:
            s[b] *= s[b]; s[b+1] *= s[b+1]; s[b+2] *= s[b+2]; s[b+3] *= s[b+3];
            return sp;
        case OP_SIN:
            s[b] = (float) jsin((double)(s[b])); s[b+1] = (float) jsin((double)(s[b+1]));
            s[b+2] = (float) jsin((double)(s[b+2])); s[b+3] = (float) jsin((double)(s[b+3]));
            return sp;
        case OP_COS:
            s[b] = (float) jcos((double)(s[b])); s[b+1] = (float) jcos((double)(s[b+1]));
            s[b+2] = (float) jcos((double)(s[b+2])); s[b+3] = (float) jcos((double)(s[b+3]));
            return sp;
        case OP_FLOOR:
            s[b] = (float) jfloor((double)(s[b])); s[b+1] = (float) jfloor((double)(s[b+1]));
            s[b+2] = (float) jfloor((double)(s[b+2])); s[b+3] = (float) jfloor((double)(s[b+3]));
            return sp;
        case OP_CEIL:
            s[b] = (float) jceil((double)(s[b])); s[b+1] = (float) jceil((double)(s[b+1]));
            s[b+2] = (float) jceil((double)(s[b+2])); s[b+3] = (float) jceil((double)(s[b+3]));
            return sp;
        case OP_ROUND:
            s[b] = javaRound(s[b]); s[b+1] = javaRound(s[b+1]);
            s[b+2] = javaRound(s[b+2]); s[b+3] = javaRound(s[b+3]);
            return sp;
        case OP_CHANGE_SIGN:
            s[b] = -s[b]; s[b+1] = -s[b+1]; s[b+2] = -s[b+2]; s[b+3] = -s[b+3];
            return sp;
        case OP_INV:
            s[b] = 1.f / softDenom(s[b]); s[b+1] = 1.f / softDenom(s[b+1]);
            s[b+2] = 1.f / softDenom(s[b+2]); s[b+3] = 1.f / softDenom(s[b+3]);
            return sp;
        case OP_VBUILD2: return build(sp, 2);
        case OP_VBUILD3: return build(sp, 3);
        case OP_VBUILD4: return build(sp, 4);
        case OP_VDOT: {
            // Zero-padded high lanes contribute 0, so summing all four is correct for any dim.
            float dot = s[a]*s[b] + s[a+1]*s[b+1] + s[a+2]*s[b+2] + s[a+3]*s[b+3];
            s[a] = dot; s[a+1] = dot; s[a+2] = dot; s[a+3] = dot;
            d[sp-1] = 1; return sp - 1;
        }
        case OP_VCROSS: {
            float ax = s[a], ay = s[a+1], az = s[a+2];
            float bx = s[b], by = s[b+1], bz = s[b+2];
            s[a] = ay*bz - az*by; s[a+1] = az*bx - ax*bz; s[a+2] = ax*by - ay*bx; s[a+3] = 0.f;
            d[sp-1] = 3; return sp - 1;
        }
        case OP_VLEN:
        case OP_VLENSQ: {
            float sq = s[b]*s[b] + s[b+1]*s[b+1] + s[b+2]*s[b+2] + s[b+3]*s[b+3];
            float r = (id == OP_VLEN) ? (float) jsqrt((double)(sq)) : sq;
            s[b] = r; s[b+1] = r; s[b+2] = r; s[b+3] = r;
            d[sp] = 1; return sp;
        }
        case OP_VNORM: {
            float sq = s[b]*s[b] + s[b+1]*s[b+1] + s[b+2]*s[b+2] + s[b+3]*s[b+3];
            float inv = 1.f / softDenom((float) jsqrt((double)(sq)));
            s[b] *= inv; s[b+1] *= inv; s[b+2] *= inv; s[b+3] *= inv;
            return sp;
        }
        case OP_NOP: return sp;   // produced by two-body first()/second() substitution
        default:
            throw std::runtime_error("VectorRpn op not implemented: "
                                     + std::to_string(id - VEC_OFFSET));
    }
}

} // namespace rccore::d3
