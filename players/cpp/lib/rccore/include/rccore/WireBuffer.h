#pragma once
#include <cstdint>
#include <cstddef>
#include <cstring>
#include <string>
#include <vector>

namespace rccore {

}  // namespace rccore
#include "rccore/RemapContext.h"
namespace rccore {

class WireBuffer {
public:
    WireBuffer(const uint8_t* data, size_t size);

    int readByte();
    int readShort();
    int32_t readInt();
    int64_t readLong();
    float readFloat();
    double readDouble();
    bool readBoolean();
    std::vector<uint8_t> readBuffer();
    std::string readUTF8();
    int32_t peekInt() const;

    bool available() const { return mIndex < mSize; }
    int getIndex() const { return mIndex; }
    void setIndex(int index) { mIndex = index; }
    int getSize() const { return mSize; }

    const uint8_t* data() const { return mData; }

    // ── Id-typed reads (Loom) ──────────────────────────────────────────────
    // What the reference's WireBuffer.declareId / readId / readNanId / readLongNanId do: a
    // plain read, unless the buffer carries a RemapContext (it is re-reading a pattern body
    // for one call site), in which case the id is declared or resolved through it. Every
    // reader uses these for exactly the fields its Java counterpart does.
    int32_t declareId();
    int32_t readId();
    float readNanId();          // a float that may be a NaN-boxed id
    int32_t readNanIdBits();    // the same, as raw bits
    int64_t readLongNanId();    // an id + 2^32 long encoding

    // For readers that read a word first and learn from context whether it is an id (packed
    // fields, mode-dependent parameters, expression tokens), as the reference's manual
    // `getRemapContext().resolveId(...)` calls. No-ops outside a pattern.
    int32_t remapId(int32_t id) const;
    /** An id the op defines, carried in a parameter block: RemapContext.declareId(value). */
    int32_t declareIdValue(int32_t id);
    int32_t remapNanBits(int32_t bits) const;
    float remapNan(float v) const;
    static bool isRemappableExpressionWord(float v, bool matrix = false);

    void setRemapContext(RemapContext* ctx) { mRemap = ctx; }
    RemapContext* remapContext() const { return mRemap; }
    /** When set, declareId/readId append what they read (CoreDocument's VariableProvider ids). */
    std::vector<int32_t>* mIdTrace = nullptr;

private:
    RemapContext* mRemap = nullptr;
    void checkBounds(int need) const;
    const uint8_t* mData;
    int mSize;
    int mIndex = 0;
};

} // namespace rccore
