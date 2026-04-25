#pragma once
#include <cstdint>
#include <cstddef>
#include <cstring>
#include <string>
#include <vector>

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

private:
    void checkBounds(int need) const;
    const uint8_t* mData;
    int mSize;
    int mIndex = 0;
};

} // namespace rccore
