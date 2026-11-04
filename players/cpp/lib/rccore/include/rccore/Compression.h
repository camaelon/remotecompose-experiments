#pragma once
// Compressed documents (Header.COMPRESS, androidx remote-core Header.decompressDocument).
//
// A document whose header carries COMPRESS (key 31, INT) = 1 (DEFLATE) has every byte after the
// header as ONE zlib stream (RFC 1950) inflating to its operations. Decompressing gives back the
// uncompressed original byte for byte: the header without COMPRESS, then the operations. Other
// values are unsupported; a truncated or corrupt stream, bytes after it, or more than 32 MB
// inflated is an error, as upstream. Self-contained (no zlib): every target builds these sources.
//
// The TypeScript player's src/core/Compression.ts is the same code.

#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <vector>

namespace rccore {

constexpr int COMPRESS = 31;
constexpr int COMPRESSION_NONE = 0;
constexpr int COMPRESSION_DEFLATE = 1;
/** Limits.MAX_DECOMPRESSED_SIZE. */
constexpr size_t MAX_DECOMPRESSED_SIZE = 32u * 1024u * 1024u;

/** Thrown for an unsupported compression or a damaged stream; what() is upstream's message. */
struct CompressionError : std::runtime_error { using std::runtime_error::runtime_error; };

/** Whether these document bytes are compressed (COMPRESS present and not NONE). */
bool isCompressed(const uint8_t* data, size_t size);

/** The document uncompressed into `out` (header without COMPRESS, then the operations). Throws CompressionError. */
void decompressDocument(const uint8_t* data, size_t size, std::vector<uint8_t>& out);

/**
 * In place: a compressed document's bytes become the uncompressed original; others are left
 * as they are. Returns whether it was compressed. Throws CompressionError.
 */
bool decompressInPlace(std::vector<uint8_t>& bytes);

/** One complete zlib stream, which must end exactly at data + size. Throws CompressionError. */
std::vector<uint8_t> inflateZlib(const uint8_t* data, size_t size, size_t maxOut = MAX_DECOMPRESSED_SIZE);

}  // namespace rccore
