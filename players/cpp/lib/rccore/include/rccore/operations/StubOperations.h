#pragma once

// Readers for operations this player does not implement.
//
// The wire format has no per-operation length: WireBuffer::start writes a single opcode byte
// and nothing else. So an unknown opcode cannot be skipped — the reader has no idea where the
// next one begins, loses alignment, and everything after it is garbage. In practice the
// document does not degrade, it fails outright: before these stubs existed, a document with a
// sound in it made rc2json report "Unknown opcode 169 at index 41" and rc2image refuse to
// parse at all, even though the sound had nothing to do with the pixels.
//
// A stub is the cheap half of support: it knows the payload's *shape*, consumes exactly that
// many bytes, and adds no operation. The stream stays aligned and the rest of the document
// renders. What it deliberately does not do is behave — a stubbed sound is silent, a stubbed
// bitmap-font run draws nothing. That is a real limitation and it is the point: silence in
// one place beats corruption everywhere after it.
//
// Every shape below mirrors the reference `read()` in remote-core. Where a field is
// conditional (the bitmap-font ops hide a flag in the top bit of their first int) the stub
// reproduces the condition, because getting it wrong reintroduces exactly the desync the
// stub exists to prevent.

#include "rccore/Operation.h"
#include "rccore/WireBuffer.h"

#include <memory>
#include <vector>

namespace rccore {

/** Payload readers that consume and discard. Each mirrors one reference `read()`. */
namespace Stub {

using Ops = std::vector<std::unique_ptr<Operation>>;

/** n consecutive 4-byte fields (int, id or NaN-boxed float — all the same width). */
inline void words(WireBuffer& buf, int n) {
    for (int i = 0; i < n; i++) buf.readInt();
}

// ── protocol / layout ──────────────────────────────────────────────────────────────

/** COMPONENT_START (2): type, componentId, width, height. */
inline void componentStart(WireBuffer& buf, Ops&) { words(buf, 4); }

/** LAYOUT_CUSTOM (93): componentId, animationId, configId, then one 8-byte property each. */
inline void layoutCustom(WireBuffer& buf, Ops&) {
    words(buf, 3);
    int propCount = buf.readInt();
    for (int i = 0; i < propCount; i++) {
        buf.readShort();          // property type
        buf.readShort();          // data type
        buf.readInt();            // value — float or int, 4 bytes either way
    }
}

// ── sound ──────────────────────────────────────────────────────────────────────────

/** PLAY_SOUND (141): the sound id. */
inline void playSound(WireBuffer& buf, Ops&) { words(buf, 1); }

/** DATA_SOUND (169): id, then the audio, length-prefixed. */
inline void soundData(WireBuffer& buf, Ops&) {
    buf.readInt();
    buf.readBuffer();
}

/** SOUND_EXPRESSION (206): id, left, right, rate, then a counted parameter array. */
inline void soundExpression(WireBuffer& buf, Ops&) {
    words(buf, 4);
    int len = buf.readInt();
    words(buf, len);
}

// ── text / fonts ───────────────────────────────────────────────────────────────────

/** DRAW_TEXT_ON_CIRCLE (57): id, five NaN-boxed floats, then two bytes. */
inline void drawTextOnCircle(WireBuffer& buf, Ops&) {
    words(buf, 6);
    buf.readByte();
    buf.readByte();
}

/**
 * TEXT_LOOKUP_INT (153): id, listId, indexId — three, not two.
 *
 * The reference `read()` opens with declareId(), which consumes four bytes just like
 * readId(). Counting only the `read*` calls misses it and loses a word.
 */
inline void textLookupInt(WireBuffer& buf, Ops&) { words(buf, 3); }

/** DATA_FONT (189): id, type, then the font, length-prefixed. */
inline void fontData(WireBuffer& buf, Ops&) {
    words(buf, 2);
    buf.readBuffer();
}

/**
 * The bitmap-font ops hide a flag in the top bit of their first int: when set, an extra
 * NaN-boxed glyph-spacing field follows. Reading it unconditionally — or never — shifts
 * everything after by four bytes.
 */
inline bool glyphSpacingPresent(WireBuffer& buf) {
    int first = buf.readInt();
    if ((first & 0x80000000) != 0) {
        buf.readInt();            // glyphSpacing
        return true;
    }
    return false;
}

/** BITMAP_TEXT_MEASURE (183): [flagged first int], textId, bitmapFontId, type. */
inline void bitmapTextMeasure(WireBuffer& buf, Ops&) {
    glyphSpacingPresent(buf);
    words(buf, 3);
}

/** DRAW_BITMAP_TEXT_ANCHORED (184): [flagged], font, start, end, x, y, panX, panY. */
inline void drawBitmapTextAnchored(WireBuffer& buf, Ops&) {
    glyphSpacingPresent(buf);
    words(buf, 7);
}

/** DRAW_BITMAP_FONT_TEXT_RUN_ON_PATH (49): [flagged], font, path, start, end, yAdj. */
inline void drawBitmapFontTextRunOnPath(WireBuffer& buf, Ops&) {
    glyphSpacingPresent(buf);
    words(buf, 5);
}

/**
 * REM (185): a remark carried in the document — a UTF-8 string, length-prefixed.
 *
 * The one comment mechanism that survives conversion: a `"//"` key in the JSON is dropped by
 * the converter, this is written to the wire and comes back out of a disassembler. It has no
 * visual effect, so consuming and discarding it is the whole of correct behaviour.
 */
inline void rem(WireBuffer& buf, Ops&) { buf.readBuffer(); }

// ── float functions ────────────────────────────────────────────────────────────────

/** FUNCTION_CALL (166): id, then a counted argument array. */
inline void functionCall(WireBuffer& buf, Ops&) {
    buf.readInt();
    int argLen = buf.readInt();
    words(buf, argLen);
}

/** FUNCTION_DEFINE (168): id, then a counted array of parameter ids. */
inline void functionDefine(WireBuffer& buf, Ops&) {
    buf.readInt();
    int varLen = buf.readInt();
    words(buf, varLen);
}

}  // namespace Stub
}  // namespace rccore
