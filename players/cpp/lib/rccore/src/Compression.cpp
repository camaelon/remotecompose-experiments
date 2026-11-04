// See rccore/Compression.h. A port of the TypeScript player's src/core/Compression.ts.

#include "rccore/Compression.h"

#include <algorithm>
#include <array>
#include <string>

namespace rccore {

namespace {

constexpr int32_t MAGIC = 0x048C0000;
constexpr size_t PROPERTY_COUNT_OFFSET = 1 + 3 * 4;
constexpr size_t PROPERTIES_OFFSET = PROPERTY_COUNT_OFFSET + 4;

int32_t int32At(const uint8_t* b, size_t i) {
    return static_cast<int32_t>((uint32_t(b[i]) << 24) | (uint32_t(b[i + 1]) << 16) | (uint32_t(b[i + 2]) << 8) | uint32_t(b[i + 3]));
}
int uint16At(const uint8_t* b, size_t i) { return (b[i] << 8) | b[i + 1]; }

struct HeaderInfo { bool modern = false; size_t end = 0; bool hasCompression = false; int32_t compression = 0; int32_t count = 0; };

HeaderInfo headerInfo(const uint8_t* b, size_t n) {
    HeaderInfo h;
    if (n < PROPERTIES_OFFSET || b[0] != 0) return h;
    if ((int32At(b, 1) & static_cast<int32_t>(0xFFFF0000)) != MAGIC) return h;
    h.modern = true;
    h.count = int32At(b, PROPERTY_COUNT_OFFSET);
    size_t at = PROPERTIES_OFFSET;
    for (int32_t i = 0; i < h.count; i++) {
        if (at + 4 > n) throw CompressionError("Malformed header properties");
        int tag = uint16At(b, at), len = uint16At(b, at + 2);
        size_t end = at + 4 + size_t(len);
        if (end > n) throw CompressionError("Malformed header properties");
        if ((tag & 0x3F) == COMPRESS && (tag >> 10) == 0 && len == 4) { h.hasCompression = true; h.compression = int32At(b, at + 4); }
        at = end;
    }
    h.end = at;
    return h;
}

const std::array<int, 29> LEN_BASE = {3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258};
const std::array<int, 29> LEN_EXTRA = {0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0};
const std::array<int, 30> DIST_BASE = {1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577};
const std::array<int, 30> DIST_EXTRA = {0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13};
const std::array<int, 19> CL_ORDER = {16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15};

[[noreturn]] void corrupt() { throw CompressionError("Corrupted compressed document"); }
[[noreturn]] void truncated() { throw CompressionError("Truncated compressed document"); }

// A canonical Huffman code: how many codes of each length, and the symbols in code order.
struct Huffman {
    std::array<uint16_t, 16> counts{};
    std::vector<uint16_t> symbols;
    Huffman(const uint8_t* lengths, int n) : symbols(size_t(n)) {
        for (int i = 0; i < n; i++) counts[lengths[i]]++;
        counts[0] = 0;
        // Over-subscribed is corrupt; incomplete is allowed (a single distance code).
        int left = 1;
        for (int len = 1; len < 16; len++) { left = (left << 1) - counts[len]; if (left < 0) corrupt(); }
        std::array<uint16_t, 16> offs{};
        for (int len = 1; len < 15; len++) offs[len + 1] = uint16_t(offs[len] + counts[len]);
        for (int i = 0; i < n; i++) if (lengths[i]) symbols[offs[lengths[i]]++] = uint16_t(i);
    }
};

class Inflater {
public:
    Inflater(const uint8_t* src, size_t size, size_t start, size_t max) : mSrc(src), mSize(size), mPos(start), mMax(max) {
        mOut.reserve(std::min(max, std::max<size_t>(1024, size * 4)));
    }
    void run() {
        int last = 0;
        while (!last) {
            last = bits(1);
            int type = bits(2);
            if (type == 0) stored();
            else if (type == 1) fixed();
            else if (type == 2) dynamic();
            else corrupt();
        }
    }
    // Where the DEFLATE data ended: the next whole byte.
    size_t byteEnd() const { return mPos - size_t(mBitCnt >> 3); }
    std::vector<uint8_t> take() { return std::move(mOut); }

private:
    int bits(int need) {
        while (mBitCnt < need) {
            if (mPos >= mSize) truncated();
            mBitBuf |= uint32_t(mSrc[mPos++]) << mBitCnt;
            mBitCnt += 8;
        }
        int v = int(mBitBuf & ((1u << need) - 1));
        mBitBuf >>= need;
        mBitCnt -= need;
        return v;
    }
    int decode(const Huffman& h) {
        int code = 0, first = 0, index = 0;
        for (int len = 1; len < 16; len++) {
            code |= bits(1);
            int count = h.counts[len];
            if (code - count < first) return h.symbols[size_t(index + (code - first))];
            index += count;
            first = (first + count) << 1;
            code <<= 1;
        }
        corrupt();
    }
    void put(uint8_t b) {
        if (mOut.size() >= mMax) throw CompressionError("Decompressed document exceeds " + std::to_string(mMax) + " bytes");
        mOut.push_back(b);
    }
    void stored() {
        mBitBuf = 0; mBitCnt = 0;   // to a byte boundary
        if (mPos + 4 > mSize) truncated();
        int len = mSrc[mPos] | (mSrc[mPos + 1] << 8);
        int nlen = mSrc[mPos + 2] | (mSrc[mPos + 3] << 8);
        mPos += 4;
        if (len != (~nlen & 0xFFFF)) corrupt();
        if (mPos + size_t(len) > mSize) truncated();
        for (int i = 0; i < len; i++) put(mSrc[mPos++]);
    }
    void fixed() {
        static const Huffman* lit = nullptr;
        static const Huffman* dist = nullptr;
        if (!lit) {
            static uint8_t l[288], d[30];
            std::fill(l, l + 144, 8); std::fill(l + 144, l + 256, 9); std::fill(l + 256, l + 280, 7); std::fill(l + 280, l + 288, 8);
            std::fill(d, d + 30, 5);
            static Huffman L(l, 288), D(d, 30);
            lit = &L; dist = &D;
        }
        codes(*lit, *dist);
    }
    void dynamic() {
        int nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
        if (nlen > 286 || ndist > 30) corrupt();
        uint8_t lengths[320] = {};
        for (int i = 0; i < ncode; i++) lengths[CL_ORDER[size_t(i)]] = uint8_t(bits(3));
        Huffman cl(lengths, 19);
        std::fill(lengths, lengths + 320, 0);
        for (int i = 0; i < nlen + ndist;) {
            int sym = decode(cl);
            if (sym < 16) { lengths[i++] = uint8_t(sym); continue; }
            int len = 0, rep;
            if (sym == 16) { if (i == 0) corrupt(); len = lengths[i - 1]; rep = 3 + bits(2); }
            else if (sym == 17) rep = 3 + bits(3);
            else rep = 11 + bits(7);
            if (i + rep > nlen + ndist) corrupt();
            while (rep--) lengths[i++] = uint8_t(len);
        }
        if (!lengths[256]) corrupt();
        Huffman lit(lengths, nlen), dist(lengths + nlen, ndist);
        codes(lit, dist);
    }
    void codes(const Huffman& lit, const Huffman& dist) {
        for (;;) {
            int sym = decode(lit);
            if (sym < 256) { put(uint8_t(sym)); continue; }
            if (sym == 256) return;
            sym -= 257;
            if (sym >= 29) corrupt();
            int len = LEN_BASE[size_t(sym)] + bits(LEN_EXTRA[size_t(sym)]);
            int ds = decode(dist);
            if (ds >= 30) corrupt();
            size_t d = size_t(DIST_BASE[size_t(ds)] + bits(DIST_EXTRA[size_t(ds)]));
            if (d > mOut.size()) corrupt();
            for (int i = 0; i < len; i++) put(mOut[mOut.size() - d]);
        }
    }

    const uint8_t* mSrc;
    size_t mSize, mPos, mMax;
    uint32_t mBitBuf = 0;
    int mBitCnt = 0;
    std::vector<uint8_t> mOut;
};

uint32_t adler32(const std::vector<uint8_t>& b) {
    uint32_t a = 1, s = 0;
    for (size_t i = 0; i < b.size();) {
        size_t n = std::min(b.size(), i + 3800);
        for (; i < n; i++) { a += b[i]; s += a; }
        a %= 65521; s %= 65521;
    }
    return (s << 16) | a;
}

}  // namespace

std::vector<uint8_t> inflateZlib(const uint8_t* data, size_t size, size_t maxOut) {
    if (size < 6) truncated();
    int cmf = data[0], flg = data[1];
    if ((cmf & 0x0F) != 8 || (cmf >> 4) > 7 || ((cmf << 8) | flg) % 31 != 0) corrupt();
    if (flg & 0x20) corrupt();   // a preset dictionary
    Inflater inf(data, size, 2, maxOut);
    inf.run();
    size_t end = inf.byteEnd();
    if (end + 4 > size) truncated();
    std::vector<uint8_t> out = inf.take();
    if (uint32_t(int32At(data, end)) != adler32(out)) corrupt();
    if (end + 4 != size) throw CompressionError("Unexpected data after the compressed document");
    return out;
}

bool isCompressed(const uint8_t* data, size_t size) {
    try {
        HeaderInfo h = headerInfo(data, size);
        return h.modern && h.hasCompression && h.compression != COMPRESSION_NONE;
    } catch (const CompressionError&) { return false; }
}

void decompressDocument(const uint8_t* data, size_t size, std::vector<uint8_t>& out) {
    HeaderInfo h = headerInfo(data, size);
    if (!h.modern || !h.hasCompression || h.compression == COMPRESSION_NONE) { out.assign(data, data + size); return; }
    if (h.compression != COMPRESSION_DEFLATE) throw CompressionError("Unsupported document compression " + std::to_string(h.compression));
    std::vector<uint8_t> body = inflateZlib(data + h.end, size - h.end);
    out.clear();
    out.reserve(h.end + body.size());
    out.insert(out.end(), data, data + PROPERTY_COUNT_OFFSET);
    out.resize(PROPERTIES_OFFSET);   // the count, written below
    int32_t kept = 0;
    size_t at = PROPERTIES_OFFSET;
    for (int32_t i = 0; i < h.count; i++) {
        int tag = uint16At(data, at);
        size_t end = at + 4 + size_t(uint16At(data, at + 2));
        if ((tag & 0x3F) != COMPRESS) { out.insert(out.end(), data + at, data + end); kept++; }
        at = end;
    }
    out[PROPERTY_COUNT_OFFSET] = uint8_t(uint32_t(kept) >> 24);
    out[PROPERTY_COUNT_OFFSET + 1] = uint8_t(uint32_t(kept) >> 16);
    out[PROPERTY_COUNT_OFFSET + 2] = uint8_t(uint32_t(kept) >> 8);
    out[PROPERTY_COUNT_OFFSET + 3] = uint8_t(kept);
    out.insert(out.end(), body.begin(), body.end());
}

bool decompressInPlace(std::vector<uint8_t>& bytes) {
    if (!isCompressed(bytes.data(), bytes.size())) return false;
    std::vector<uint8_t> out;
    decompressDocument(bytes.data(), bytes.size(), out);
    bytes.swap(out);
    return true;
}

}  // namespace rccore
