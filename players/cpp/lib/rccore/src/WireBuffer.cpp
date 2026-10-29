#include "rccore/WireBuffer.h"
#include "rccore/RemapContext.h"
#include <cmath>
#include <stdexcept>

namespace rccore {

WireBuffer::WireBuffer(const uint8_t* data, size_t size)
    : mData(data), mSize(static_cast<int>(size)) {}

void WireBuffer::checkBounds(int need) const {
    if (mIndex + need > mSize) {
        throw std::runtime_error("buffer overrun at index " + std::to_string(mIndex)
            + " need " + std::to_string(need)
            + " size " + std::to_string(mSize));
    }
}

int WireBuffer::readByte() {
    checkBounds(1);
    return mData[mIndex++] & 0xFF;
}

int WireBuffer::readShort() {
    checkBounds(2);
    int v1 = (mData[mIndex++] & 0xFF) << 8;
    int v2 = (mData[mIndex++] & 0xFF);
    return v1 + v2;
}

int32_t WireBuffer::readInt() {
    checkBounds(4);
    int32_t v1 = (mData[mIndex++] & 0xFF) << 24;
    int32_t v2 = (mData[mIndex++] & 0xFF) << 16;
    int32_t v3 = (mData[mIndex++] & 0xFF) << 8;
    int32_t v4 = (mData[mIndex++] & 0xFF);
    return v1 + v2 + v3 + v4;
}

int64_t WireBuffer::readLong() {
    checkBounds(8);
    int64_t v1 = (int64_t)(mData[mIndex++] & 0xFF) << 56;
    int64_t v2 = (int64_t)(mData[mIndex++] & 0xFF) << 48;
    int64_t v3 = (int64_t)(mData[mIndex++] & 0xFF) << 40;
    int64_t v4 = (int64_t)(mData[mIndex++] & 0xFF) << 32;
    int64_t v5 = (int64_t)(mData[mIndex++] & 0xFF) << 24;
    int64_t v6 = (int64_t)(mData[mIndex++] & 0xFF) << 16;
    int64_t v7 = (int64_t)(mData[mIndex++] & 0xFF) << 8;
    int64_t v8 = (int64_t)(mData[mIndex++] & 0xFF);
    return v1 + v2 + v3 + v4 + v5 + v6 + v7 + v8;
}

float WireBuffer::readFloat() {
    int32_t bits = readInt();
    float f;
    memcpy(&f, &bits, sizeof(f));
    return f;
}

double WireBuffer::readDouble() {
    int64_t bits = readLong();
    double d;
    memcpy(&d, &bits, sizeof(d));
    return d;
}

bool WireBuffer::readBoolean() {
    checkBounds(1);
    return mData[mIndex++] == 1;
}

std::vector<uint8_t> WireBuffer::readBuffer() {
    int count = readInt();
    if (count < 0 || mIndex + count > mSize) {
        throw std::runtime_error("readBuffer: count " + std::to_string(count)
            + " exceeds buffer (index=" + std::to_string(mIndex)
            + ", size=" + std::to_string(mSize) + ")");
    }
    std::vector<uint8_t> buf(mData + mIndex, mData + mIndex + count);
    mIndex += count;
    return buf;
}

std::string WireBuffer::readUTF8() {
    auto buf = readBuffer();
    return std::string(buf.begin(), buf.end());
}

int32_t WireBuffer::peekInt() const {
    if (mIndex + 4 > mSize) {
        throw std::runtime_error("peekInt: past end of buffer");
    }
    int tmp = mIndex;
    int32_t v1 = (mData[tmp++] & 0xFF) << 24;
    int32_t v2 = (mData[tmp++] & 0xFF) << 16;
    int32_t v3 = (mData[tmp++] & 0xFF) << 8;
    int32_t v4 = (mData[tmp++] & 0xFF);
    return v1 + v2 + v3 + v4;
}

int32_t WireBuffer::declareId() {
    int32_t v = readInt();
    if (mRemap) v = mRemap->declareId(v);
    if (mIdTrace) mIdTrace->push_back(v);
    return v;
}

int32_t WireBuffer::readId() {
    int32_t v = readInt();
    if (mRemap) v = mRemap->resolveId(v);
    if (mIdTrace) mIdTrace->push_back(v);
    return v;
}

int32_t WireBuffer::readNanIdBits() {
    int32_t bits = readInt();
    return mRemap ? mRemap->resolveNanIdBits(bits) : bits;
}

float WireBuffer::readNanId() {
    int32_t bits = readNanIdBits();
    float f;
    memcpy(&f, &bits, sizeof(f));
    return f;
}

int64_t WireBuffer::readLongNanId() {
    int64_t v = readLong();
    return mRemap ? mRemap->resolveLongNanId(v) : v;
}

int32_t WireBuffer::remapId(int32_t id) const { return mRemap ? mRemap->resolveId(id) : id; }

int32_t WireBuffer::declareIdValue(int32_t id) { return mRemap ? mRemap->declareId(id) : id; }

int32_t WireBuffer::remapNanBits(int32_t bits) const { return mRemap ? mRemap->resolveNanIdBits(bits) : bits; }

float WireBuffer::remapNan(float v) const {
    if (!mRemap) return v;
    int32_t bits; memcpy(&bits, &v, sizeof(bits));
    bits = mRemap->resolveNanIdBits(bits);
    float f; memcpy(&f, &bits, sizeof(f));
    return f;
}

/** Whether an expression token is a variable to remap (not a math/matrix operator, not a data
 *  variable): AnimatedFloatExpression.isMathOperator / MatrixOperations.isOperator /
 *  NanMap.isDataVariable in the reference. */
bool WireBuffer::isRemappableExpressionWord(float v, bool matrix) {
    int32_t bits; memcpy(&bits, &v, sizeof(bits));
    if (!RemapContext::isNaNBits(bits)) return false;
    int id = bits & 0x3FFFFF;
    if ((id >> 20) == 2) return false;
    int lo = matrix ? 0x320000 : 0x310000, hi = matrix ? 0x320000 + 54 : 0x310000 + 79;
    return !(id > lo && id <= hi);
}

} // namespace rccore
