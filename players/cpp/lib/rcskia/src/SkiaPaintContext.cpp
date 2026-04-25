#include "rcskia/SkiaPaintContext.h"
#include "rccore/RemoteContext.h"
#include "rccore/Utils.h"

#include "include/core/SkRect.h"
#include "include/core/SkRRect.h"
#include "include/core/SkPathBuilder.h"
#include "include/core/SkBitmap.h"
#include "include/core/SkFontMgr.h"
#include "include/core/SkFontMetrics.h"
#include "include/core/SkColorFilter.h"
#include "include/core/SkPathEffect.h"
#include "include/core/SkPathMeasure.h"
#include "include/core/SkRSXform.h"
#include "include/effects/SkGradientShader.h"
#include "include/effects/SkRuntimeEffect.h"
#include "include/effects/SkDashPathEffect.h"
#include "include/pathops/SkPathOps.h"
#include "rccore/operations/DrawOperations.h"
#include "include/codec/SkCodec.h"
#include "include/core/SkStream.h"
#include "include/core/SkTextBlob.h"
#include "include/ports/SkFontMgr_mac_ct.h"

#include <algorithm>
#include <cmath>
#include <cstring>

using namespace rccore;

namespace rcskia {

// Path command constants (NaN-encoded in the float array)
static constexpr int PATH_MOVE      = 10;
static constexpr int PATH_LINE      = 11;
static constexpr int PATH_QUADRATIC = 12;
static constexpr int PATH_CONIC     = 13;
static constexpr int PATH_CUBIC     = 14;
static constexpr int PATH_CLOSE     = 15;
static constexpr int PATH_DONE      = 16;

static int nanId(float v) {
    int32_t bits;
    memcpy(&bits, &v, sizeof(bits));
    return bits & 0x3FFFFF;
}

static bool isPathCommand(float v) {
    if (!std::isnan(v)) return false;
    int id = nanId(v);
    return id >= PATH_MOVE && id <= PATH_DONE;
}

// Decode the next UTF-8 codepoint starting at *p (advances *p past the
// codepoint).  Returns the codepoint, or -1 if we're past `end`.  Invalid
// sequences yield U+FFFD and consume one byte.
static int32_t nextUtf8Cp(const char** p, const char* end) {
    if (*p >= end) return -1;
    unsigned char c = static_cast<unsigned char>(**p);
    int32_t cp;
    int n;
    if (c < 0x80)        { cp = c;        n = 1; }
    else if ((c & 0xE0) == 0xC0) { cp = c & 0x1F; n = 2; }
    else if ((c & 0xF0) == 0xE0) { cp = c & 0x0F; n = 3; }
    else if ((c & 0xF8) == 0xF0) { cp = c & 0x07; n = 4; }
    else { *p += 1; return 0xFFFD; }
    if (*p + n > end) { *p = end; return 0xFFFD; }
    for (int i = 1; i < n; i++) {
        cp = (cp << 6) | (static_cast<unsigned char>((*p)[i]) & 0x3F);
    }
    *p += n;
    return cp;
}

// Encode a single codepoint into *out (must have at least 4 bytes).
// Returns the number of bytes written.
static int encodeUtf8Cp(int32_t cp, char* out) {
    if (cp < 0x80) { out[0] = static_cast<char>(cp); return 1; }
    if (cp < 0x800) {
        out[0] = static_cast<char>(0xC0 | (cp >> 6));
        out[1] = static_cast<char>(0x80 | (cp & 0x3F));
        return 2;
    }
    if (cp < 0x10000) {
        out[0] = static_cast<char>(0xE0 | (cp >> 12));
        out[1] = static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
        out[2] = static_cast<char>(0x80 | (cp & 0x3F));
        return 3;
    }
    out[0] = static_cast<char>(0xF0 | (cp >> 18));
    out[1] = static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
    out[2] = static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
    out[3] = static_cast<char>(0x80 | (cp & 0x3F));
    return 4;
}

SkiaPaintContext::SkiaPaintContext(RemoteContext& context, SkCanvas* canvas)
    : PaintContext(context), mCanvas(canvas) {
    mPaint.setAntiAlias(true);
    mPaint.setColor(SK_ColorBLACK);

    // Build the font manager once and reuse it for every typeface lookup.
    // CoreText font catalog scans are expensive — doing this per draw op
    // tanks frame rate on text-heavy slides (e.g. syntax-highlighted code).
    mFontMgr = SkFontMgr_New_CoreText(nullptr);

    // Initialize font with a valid typeface (required on macOS/Skia m143+)
    auto defaultTf = mFontMgr->matchFamilyStyle(nullptr, SkFontStyle());
    if (defaultTf) {
        mFont = SkFont(sk_sp<SkTypeface>(defaultTf), 14);
    } else {
        mFont.setSize(14);
    }
}

SkiaPaintContext::~SkiaPaintContext() = default;

float SkiaPaintContext::drawOrMeasureWithFallback(const std::string& utf8,
                                                   float x, float y,
                                                   bool draw,
                                                   SkRect* outBounds) {
    if (utf8.empty()) {
        if (outBounds) outBounds->setEmpty();
        return 0.0f;
    }

    SkTypeface* primary = mFont.getTypeface();
    SkFontStyle style = primary ? primary->fontStyle() : SkFontStyle();

    SkRect totalBounds = SkRect::MakeEmpty();
    bool boundsInit = false;
    float cursorX = x;

    // Accumulate a contiguous run of codepoints sharing one typeface,
    // flushing whenever the active typeface changes.  This gives one
    // SkTextBlob::MakeFromString call per typeface segment, which is far
    // cheaper than per-codepoint draws and lets each segment shape with
    // its own glyph metrics.
    sk_sp<SkTypeface> runTypeface;
    std::string runUtf8;
    auto flushRun = [&]() {
        if (runUtf8.empty()) return;
        SkFont runFont = mFont;
        if (runTypeface) runFont.setTypeface(runTypeface);
        SkRect runBounds;
        float adv = runFont.measureText(runUtf8.data(), runUtf8.size(),
                                         SkTextEncoding::kUTF8, &runBounds);
        if (draw) {
            auto blob = SkTextBlob::MakeFromString(runUtf8.c_str(), runFont);
            if (blob) {
                mCanvas->drawTextBlob(blob, cursorX, y, mPaint);
            }
        }
        runBounds.offset(cursorX, y);
        if (!boundsInit) { totalBounds = runBounds; boundsInit = true; }
        else             { totalBounds.join(runBounds); }
        cursorX += adv;
        runUtf8.clear();
    };

    const char* p = utf8.data();
    const char* end = p + utf8.size();
    while (p < end) {
        int32_t cp = nextUtf8Cp(&p, end);
        if (cp < 0) break;

        // Pick the typeface that actually has a glyph for this cp.
        sk_sp<SkTypeface> tf;
        SkGlyphID glyph = primary ? primary->unicharToGlyph(cp) : 0;
        if (glyph != 0) {
            tf = sk_ref_sp(primary);
        } else {
            auto cached = mFallbackCache.find(cp);
            if (cached != mFallbackCache.end()) {
                tf = cached->second;
            } else {
                tf = sk_sp<SkTypeface>(mFontMgr->matchFamilyStyleCharacter(
                    nullptr, style, nullptr, 0, cp));
                mFallbackCache[cp] = tf;
            }
            if (!tf) tf = sk_ref_sp(primary);
        }

        if (!runTypeface) {
            runTypeface = tf;
        } else if (tf.get() != runTypeface.get()) {
            flushRun();
            runTypeface = tf;
        }

        char buf[4];
        int n = encodeUtf8Cp(cp, buf);
        runUtf8.append(buf, n);
    }
    flushRun();

    if (outBounds) {
        if (boundsInit) *outBounds = totalBounds;
        else            outBounds->setEmpty();
    }
    return cursorX - x;
}

// ── Helper: trim path to [start, end] fraction ──────────────────────
static SkPath trimPath(const SkPath& path, float start, float end) {
    if (start <= 0.0f && end >= 1.0f) return path;
    SkPathMeasure pm(path, false);
    float totalLen = pm.getLength();
    if (totalLen <= 0) return path;
    SkPath trimmed;
    float startD = start * totalLen;
    float endD = end * totalLen;
    if (startD < endD) {
        pm.getSegment(startD, endD, &trimmed, true);
    }
    return trimmed;
}

// ── Drawing ───────────────────────────────────────────────────────────

void SkiaPaintContext::drawRect(float left, float top, float right, float bottom) {
    mCanvas->drawRect(SkRect::MakeLTRB(left, top, right, bottom), mPaint);
}

void SkiaPaintContext::drawCircle(float cx, float cy, float radius) {
    mCanvas->drawCircle(cx, cy, radius, mPaint);
}

void SkiaPaintContext::drawLine(float x1, float y1, float x2, float y2) {
    mCanvas->drawLine(x1, y1, x2, y2, mPaint);
}

void SkiaPaintContext::drawOval(float left, float top, float right, float bottom) {
    mCanvas->drawOval(SkRect::MakeLTRB(left, top, right, bottom), mPaint);
}

void SkiaPaintContext::drawArc(float left, float top, float right, float bottom,
                               float startAngle, float sweepAngle) {
    mCanvas->drawArc(SkRect::MakeLTRB(left, top, right, bottom),
                     startAngle, sweepAngle, false, mPaint);
}

void SkiaPaintContext::drawRoundRect(float left, float top, float right, float bottom,
                                     float rx, float ry) {
    SkRect rect = SkRect::MakeLTRB(left, top, right, bottom);
    mCanvas->drawRoundRect(rect, rx, ry, mPaint);
}

void SkiaPaintContext::drawSector(float left, float top, float right, float bottom,
                                  float startAngle, float sweepAngle) {
    // Sector = arc with useCenter=true
    mCanvas->drawArc(SkRect::MakeLTRB(left, top, right, bottom),
                     startAngle, sweepAngle, true, mPaint);
}

void SkiaPaintContext::drawPath(int pathId, float start, float end) {
    // Rebuild path from stored float data to resolve NaN variable refs
    auto fit = mPathFloatData.find(pathId);
    if (fit != mPathFloatData.end()) {
        SkPath resolved;
        buildPathFromFloats(resolved, fit->second.floats, fit->second.winding);
        if (start > 0.0f || end < 1.0f) {
            resolved = trimPath(resolved, start, end);
        }
        mCanvas->drawPath(resolved, mPaint);
        return;
    }
    auto it = mPaths.find(pathId);
    if (it == mPaths.end()) return;
    if (start > 0.0f || end < 1.0f) {
        SkPath trimmed = trimPath(it->second, start, end);
        mCanvas->drawPath(trimmed, mPaint);
    } else {
        mCanvas->drawPath(it->second, mPaint);
    }
}

void SkiaPaintContext::drawTweenPath(int path1Id, int path2Id, float tween,
                                     float start, float end) {
    // Get path data for both paths
    SkPath path1, path2;
    bool has1 = false, has2 = false;

    auto fit1 = mPathFloatData.find(path1Id);
    if (fit1 != mPathFloatData.end()) {
        buildPathFromFloats(path1, fit1->second.floats, fit1->second.winding);
        has1 = true;
    } else {
        auto it1 = mPaths.find(path1Id);
        if (it1 != mPaths.end()) { path1 = it1->second; has1 = true; }
    }

    auto fit2 = mPathFloatData.find(path2Id);
    if (fit2 != mPathFloatData.end()) {
        buildPathFromFloats(path2, fit2->second.floats, fit2->second.winding);
        has2 = true;
    } else {
        auto it2 = mPaths.find(path2Id);
        if (it2 != mPaths.end()) { path2 = it2->second; has2 = true; }
    }

    if (!has1 && !has2) return;

    // If only one path exists, draw it trimmed
    SkPath* drawPath = has1 ? &path1 : &path2;

    // If both paths exist, interpolate between them
    SkPath tweened;
    if (has1 && has2 && tween > 0.0f && tween < 1.0f) {
        if (path1.interpolate(path2, tween, &tweened)) {
            drawPath = &tweened;
        }
    } else if (has1 && has2 && tween >= 1.0f) {
        drawPath = &path2;
    }

    // Apply trimming
    if (start > 0.0f || end < 1.0f) {
        SkPath trimmed = trimPath(*drawPath, start, end);
        mCanvas->drawPath(trimmed, mPaint);
    } else {
        mCanvas->drawPath(*drawPath, mPaint);
    }
}

void SkiaPaintContext::tweenPath(int outId, int pathId1, int pathId2, float tween) {
    // Get both source paths
    SkPath path1, path2;
    bool has1 = false, has2 = false;

    auto fit1 = mPathFloatData.find(pathId1);
    if (fit1 != mPathFloatData.end()) {
        buildPathFromFloats(path1, fit1->second.floats, fit1->second.winding);
        has1 = true;
    } else {
        auto it1 = mPaths.find(pathId1);
        if (it1 != mPaths.end()) { path1 = it1->second; has1 = true; }
    }

    auto fit2 = mPathFloatData.find(pathId2);
    if (fit2 != mPathFloatData.end()) {
        buildPathFromFloats(path2, fit2->second.floats, fit2->second.winding);
        has2 = true;
    } else {
        auto it2 = mPaths.find(pathId2);
        if (it2 != mPaths.end()) { path2 = it2->second; has2 = true; }
    }

    if (!has1 || !has2) return;

    float t = std::max(0.0f, std::min(1.0f, tween));
    SkPath result;
    if (t <= 0.0f) {
        result = path1;
    } else if (t >= 1.0f) {
        result = path2;
    } else if (!path1.interpolate(path2, t, &result)) {
        result = path1; // fallback if paths are incompatible
    }
    mPaths[outId] = std::move(result);
}

void SkiaPaintContext::drawBitmap(int imageId, float left, float top,
                                  float right, float bottom) {
    auto it = mImages.find(imageId);
    if (it == mImages.end()) return;
    SkRect dst = SkRect::MakeLTRB(left, top, right, bottom);
    mCanvas->drawImageRect(it->second, dst, SkSamplingOptions(SkFilterMode::kLinear),
                           &mPaint);
}

void SkiaPaintContext::drawBitmapInt(int imageId,
                                     int srcL, int srcT, int srcR, int srcB,
                                     int dstL, int dstT, int dstR, int dstB,
                                     int cdId) {
    auto it = mImages.find(imageId);
    if (it == mImages.end()) return;
    SkRect src = SkRect::MakeLTRB(srcL, srcT, srcR, srcB);
    SkRect dst = SkRect::MakeLTRB(dstL, dstT, dstR, dstB);
    mCanvas->drawImageRect(it->second, src, dst,
                           SkSamplingOptions(SkFilterMode::kLinear),
                           &mPaint, SkCanvas::kStrict_SrcRectConstraint);
}

// Convert Java char index (UTF-16 code unit offset) to UTF-8 byte offset
static size_t utf16IndexToUtf8Offset(const std::string& utf8, int charIndex) {
    size_t byteOff = 0;
    int charCount = 0;
    while (byteOff < utf8.size() && charCount < charIndex) {
        unsigned char c = static_cast<unsigned char>(utf8[byteOff]);
        int charBytes;
        uint32_t codepoint;
        if (c < 0x80)       { charBytes = 1; codepoint = c; }
        else if (c < 0xE0)  { charBytes = 2; codepoint = c & 0x1F; }
        else if (c < 0xF0)  { charBytes = 3; codepoint = c & 0x0F; }
        else                { charBytes = 4; codepoint = c & 0x07; }
        for (int i = 1; i < charBytes && byteOff + i < utf8.size(); i++)
            codepoint = (codepoint << 6) | (static_cast<unsigned char>(utf8[byteOff + i]) & 0x3F);
        byteOff += charBytes;
        // Surrogate pair in UTF-16: codepoints >= 0x10000 use 2 UTF-16 code units
        charCount += (codepoint >= 0x10000) ? 2 : 1;
    }
    return byteOff;
}

void SkiaPaintContext::drawTextRun(int textId, int start, int end,
                                   int contextStart, int contextEnd,
                                   float x, float y, bool rtl) {
    auto it = mTexts.find(textId);
    if (it == mTexts.end()) return;

    const std::string& fullText = it->second;
    if (start < 0 || start >= end) return;

    // Convert Java char indices (UTF-16) to UTF-8 byte offsets
    size_t byteStart = utf16IndexToUtf8Offset(fullText, start);
    size_t byteEnd = utf16IndexToUtf8Offset(fullText, end);
    if (byteStart >= fullText.size() || byteEnd > fullText.size() || byteStart >= byteEnd) return;

    float fontSize = mFont.getSize();
    if (std::isnan(fontSize) || std::isinf(fontSize) || fontSize <= 0 || fontSize > 10000) return;
    if (std::isnan(x) || std::isnan(y) || std::isinf(x) || std::isinf(y)) return;
    std::string substr = fullText.substr(byteStart, byteEnd - byteStart);
    if (substr.empty()) return;
    // Check canvas total matrix for degenerate state
    SkMatrix m = mCanvas->getTotalMatrix();
    if (!m.isFinite()) return;
    drawOrMeasureWithFallback(substr, x, y, /*draw=*/true, nullptr);
}

void SkiaPaintContext::drawTextAnchored(int textId, float x, float y,
                                        float panX, float panY, int flags) {
    auto it = mTexts.find(textId);
    if (it == mTexts.end()) return;

    const std::string& text = it->second;

    float fontSize = mFont.getSize();
    if (std::isnan(fontSize) || std::isinf(fontSize) || fontSize <= 0 || fontSize > 10000) return;

    // Measure with fallback so CJK / emoji segments contribute their
    // real advance + glyph bounds.  Bounds returned by the helper are
    // anchored at (0, 0) when measuring (draw=false), so they line up
    // with the legacy TS convention of bounds[0]=0.
    SkRect glyphBounds;
    float advanceWidth = drawOrMeasureWithFallback(
        text, /*x=*/0, /*y=*/0, /*draw=*/false, &glyphBounds);

    float boundsLeft = 0.0f;
    float boundsTop = glyphBounds.fTop;     // negative ascent
    float boundsRight = advanceWidth;
    float boundsBottom = glyphBounds.fBottom; // descent

    float textWidth = boundsRight - boundsLeft;   // = advanceWidth
    float textHeight = boundsBottom - boundsTop;   // = ascent + descent

    // Horizontal offset: TS formula with bounds[0]=0
    float hOffset = (-textWidth) * (1.0f + panX) / 2.0f - boundsLeft;

    // Vertical offset
    float vOffset = 0;
    if (!std::isnan(panY)) {
        bool baseline = (flags & 8) != 0; // BASELINE_RELATIVE
        vOffset = (-textHeight) * (1.0f - panY) / 2.0f
                  + (baseline ? textHeight / 2.0f : (-boundsTop));
    }

    drawOrMeasureWithFallback(text, x + hOffset, y + vOffset,
                               /*draw=*/true, nullptr);
}

void SkiaPaintContext::drawTextOnPath(int textId, int pathId,
                                      float hOffset, float vOffset) {
    auto textIt = mTexts.find(textId);
    auto pathIt = mPaths.find(pathId);
    if (textIt == mTexts.end() || pathIt == mPaths.end()) return;

    const std::string& text = textIt->second;
    const SkPath& path = pathIt->second;
    if (text.empty()) return;

    // Convert text to glyphs and measure widths
    size_t glyphCount = mFont.countText(text.c_str(), text.size(), SkTextEncoding::kUTF8);
    if (glyphCount == 0) return;

    std::vector<SkGlyphID> glyphs(glyphCount);
    mFont.textToGlyphs(text.c_str(), text.size(), SkTextEncoding::kUTF8,
                        SkSpan<SkGlyphID>(glyphs.data(), glyphCount));

    std::vector<SkScalar> widths(glyphCount);
    mFont.getWidths(SkSpan<const SkGlyphID>(glyphs.data(), glyphCount),
                    SkSpan<SkScalar>(widths.data(), glyphCount));

    // Measure the path
    SkPathMeasure measure(path, false);
    SkScalar pathLength = measure.getLength();
    if (pathLength <= 0) return;

    // Place each glyph along the path
    std::vector<SkRSXform> xforms(glyphCount);
    SkScalar distance = hOffset;

    for (size_t i = 0; i < glyphCount; i++) {
        // Center each glyph at its midpoint
        SkScalar halfWidth = widths[i] * 0.5f;
        SkScalar mid = distance + halfWidth;

        SkPoint pos;
        SkVector tan;
        if (!measure.getPosTan(mid, &pos, &tan)) {
            // Past end of path — place at end
            (void)measure.getPosTan(pathLength, &pos, &tan);
        }

        // Apply vOffset perpendicular to tangent (normal = (-tan.y, tan.x))
        pos.fX += -tan.fY * vOffset;
        pos.fY +=  tan.fX * vOffset;

        // RSXform: scos=tan.x, ssin=tan.y, with anchor at (halfWidth, 0)
        xforms[i] = SkRSXform::Make(
            tan.fX, tan.fY,
            pos.fX - tan.fX * halfWidth,
            pos.fY - tan.fY * halfWidth
        );

        distance += widths[i];
    }

    auto blob = SkTextBlob::MakeFromRSXformGlyphs(
        SkSpan<const SkGlyphID>(glyphs.data(), glyphCount),
        SkSpan<const SkRSXform>(xforms.data(), glyphCount),
        mFont);
    if (blob) {
        mCanvas->drawTextBlob(blob, 0, 0, mPaint);
    }
}

// ── Paint ─────────────────────────────────────────────────────────────

void SkiaPaintContext::applyPaint(const PaintBundle& bundle) {
    applyPaintBundle(bundle);
}

void SkiaPaintContext::savePaint() {
    mPaintStack.push(mPaint);
    mFontStack.push(mFont);
}

void SkiaPaintContext::restorePaint() {
    if (!mPaintStack.empty()) {
        mPaint = mPaintStack.top();
        mPaintStack.pop();
    }
    if (!mFontStack.empty()) {
        mFont = mFontStack.top();
        mFontStack.pop();
    }
}

// ── Transform ─────────────────────────────────────────────────────────

void SkiaPaintContext::matrixSave() {
    mCanvas->save();
}

void SkiaPaintContext::matrixRestore() {
    mCanvas->restore();
}

void SkiaPaintContext::matrixScale(float sx, float sy, float cx, float cy) {
    if (std::isnan(sx) || std::isnan(sy) || std::isinf(sx) || std::isinf(sy)) return;
    mCanvas->translate(cx, cy);
    mCanvas->scale(sx, sy);
    mCanvas->translate(-cx, -cy);
}

void SkiaPaintContext::matrixTranslate(float dx, float dy) {
    mCanvas->translate(dx, dy);
}

void SkiaPaintContext::matrixRotate(float degrees, float cx, float cy) {
    mCanvas->rotate(degrees, cx, cy);
}

void SkiaPaintContext::matrixSkew(float sx, float sy) {
    mCanvas->skew(sx, sy);
}

// ── Clipping ──────────────────────────────────────────────────────────

void SkiaPaintContext::clipRect(float left, float top, float right, float bottom) {
    mCanvas->clipRect(SkRect::MakeLTRB(left, top, right, bottom));
}

void SkiaPaintContext::clipPath(int pathId, int regionOp) {
    auto it = mPaths.find(pathId);
    if (it != mPaths.end()) {
        mCanvas->clipPath(it->second);
    }
}

void SkiaPaintContext::roundedClipRect(float w, float h, float topStart, float topEnd,
                                        float bottomStart, float bottomEnd) {
    SkPath path;
    // Create rounded rect path with per-corner radii
    // SkRRect uses: top-left, top-right, bottom-right, bottom-left
    SkVector radii[4] = {
        {topStart, topStart},       // top-left
        {topEnd, topEnd},           // top-right
        {bottomEnd, bottomEnd},     // bottom-right
        {bottomStart, bottomStart}  // bottom-left
    };
    SkRRect rrect;
    rrect.setRectRadii(SkRect::MakeWH(w, h), radii);
    mCanvas->clipRRect(rrect);
}

// ── Data ──────────────────────────────────────────────────────────────

void SkiaPaintContext::loadText(int id, const std::string& text) {
    mTexts[id] = text;
}

std::string SkiaPaintContext::getText(int id) {
    auto it = mTexts.find(id);
    return it != mTexts.end() ? it->second : "";
}

void SkiaPaintContext::loadBitmap(int imageId, int widthAndType,
                                  int heightAndEncoding,
                                  const std::vector<uint8_t>& data) {
    // Java unpacking logic: if value <= 0xFFFF, upper field defaults
    int width, type;
    if (widthAndType > 0xFFFF) {
        type = (widthAndType >> 16) & 0xFFFF;
        width = widthAndType & 0xFFFF;
    } else {
        width = widthAndType;
        type = TYPE_PNG_8888; // default
    }

    int height, encoding;
    if (heightAndEncoding > 0xFFFF) {
        encoding = (heightAndEncoding >> 16) & 0xFFFF;
        height = heightAndEncoding & 0xFFFF;
    } else {
        height = heightAndEncoding;
        encoding = ENCODING_INLINE; // default
    }

    if (encoding == ENCODING_EMPTY) {
        // Allocate empty transparent bitmap only if not already present
        // (re-allocating would destroy content written by draw_to_bitmap)
        if (mImages.find(imageId) == mImages.end()) {
            SkImageInfo info = SkImageInfo::MakeN32Premul(width, height);
            SkBitmap bmp;
            bmp.allocPixels(info);
            bmp.eraseColor(SK_ColorTRANSPARENT);
            mImages[imageId] = bmp.asImage();
        }
        return;
    }

    if (encoding != ENCODING_INLINE) {
        // URL/file encodings not supported in CLI tool
        return;
    }

    // type determines pixel format
    switch (type) {
        case TYPE_PNG_8888:
        case TYPE_PNG:
        case TYPE_PNG_ALPHA_8: {
            // PNG-compressed - decode with Skia codec
            auto skData = SkData::MakeWithCopy(data.data(), data.size());
            auto codec = SkCodec::MakeFromData(skData);
            if (codec) {
                auto colorType = (type == TYPE_PNG_ALPHA_8)
                    ? kAlpha_8_SkColorType : kN32_SkColorType;
                SkImageInfo info = codec->getInfo()
                    .makeColorType(colorType)
                    .makeAlphaType(kPremul_SkAlphaType);
                SkBitmap bmp;
                bmp.allocPixels(info);
                codec->getPixels(info, bmp.getPixels(), bmp.rowBytes());
                mImages[imageId] = bmp.asImage();
            }
            break;
        }
        case TYPE_RAW8888: {
            // Raw ARGB 8888 - 4 bytes per pixel, big-endian ARGB
            SkImageInfo info = SkImageInfo::MakeN32Premul(width, height);
            SkBitmap bmp;
            bmp.allocPixels(info);
            size_t pixelCount = (size_t)width * height;
            if (data.size() >= pixelCount * 4) {
                uint32_t* dst = (uint32_t*)bmp.getPixels();
                for (size_t i = 0; i < pixelCount; i++) {
                    size_t p = i * 4;
                    uint8_t a = data[p];
                    uint8_t r = data[p + 1];
                    uint8_t g = data[p + 2];
                    uint8_t b = data[p + 3];
                    // SkPreMultiplyARGB returns SkPMColor in native N32 byte order
                    dst[i] = SkPreMultiplyARGB(a, r, g, b);
                }
            }
            mImages[imageId] = bmp.asImage();
            break;
        }
        case TYPE_RAW8: {
            // Raw 8-bit grayscale - expand to ARGB
            SkImageInfo info = SkImageInfo::MakeN32Premul(width, height);
            SkBitmap bmp;
            bmp.allocPixels(info);
            size_t pixelCount = (size_t)width * height;
            if (data.size() >= pixelCount) {
                uint32_t* dst = (uint32_t*)bmp.getPixels();
                for (size_t i = 0; i < pixelCount; i++) {
                    uint8_t v = data[i];
                    dst[i] = SkPreMultiplyARGB(v, v, v, v);
                }
            }
            mImages[imageId] = bmp.asImage();
            break;
        }
        default:
            break;
    }
}

void SkiaPaintContext::loadPathData(int instanceId, int winding,
                                    const std::vector<float>& data) {
    // Store raw float data for potential appending later
    mPathFloatData[instanceId] = {data, winding};
    // Build the SkPath
    SkPath path;
    buildPathFromFloats(path, data, winding);
    mPaths[instanceId] = std::move(path);
}

void SkiaPaintContext::appendPathData(int instanceId,
                                       const std::vector<float>& data) {
    auto it = mPathFloatData.find(instanceId);
    if (it != mPathFloatData.end()) {
        // Append the new data to the accumulated float data
        it->second.floats.insert(it->second.floats.end(), data.begin(), data.end());
        // Rebuild the complete path from accumulated data
        SkPath path;
        buildPathFromFloats(path, it->second.floats, it->second.winding);
        mPaths[instanceId] = std::move(path);
    } else {
        // No existing path data, create new
        mPathFloatData[instanceId] = {data, 0};
        SkPath path;
        buildPathFromFloats(path, data, 0);
        mPaths[instanceId] = std::move(path);
    }
}

// ── Reset ─────────────────────────────────────────────────────────────

void SkiaPaintContext::reset() {
    mPaint.reset();
    mPaint.setAntiAlias(true);
    mPaint.setColor(SK_ColorBLACK);
    mFont.setSize(14);
    while (!mPaintStack.empty()) mPaintStack.pop();
    while (!mFontStack.empty()) mFontStack.pop();
}

// ── Text measurement ──────────────────────────────────────────────────

float SkiaPaintContext::measureTextWidth(const std::string& text, float fontSize) {
    SkFont tmpFont(mFont);  // Copy member font (has valid typeface)
    tmpFont.setSize(fontSize);
    return tmpFont.measureText(text.c_str(), text.size(), SkTextEncoding::kUTF8);
}

float SkiaPaintContext::measureTextHeight(const std::string& text, float fontSize) {
    SkFont tmpFont(mFont);  // Copy member font (has valid typeface)
    tmpFont.setSize(fontSize);
    SkFontMetrics metrics;
    tmpFont.getMetrics(&metrics);
    return metrics.fDescent - metrics.fAscent;
}

float SkiaPaintContext::measureTextAscent(const std::string& text, float fontSize) {
    SkFont tmpFont(mFont);
    tmpFont.setSize(fontSize);
    SkFontMetrics metrics;
    tmpFont.getMetrics(&metrics);
    return -metrics.fAscent;  // positive distance from top to baseline
}

void SkiaPaintContext::getTextBounds(int textId, int start, int end, int flags, float bounds[4]) {
    auto it = mTexts.find(textId);
    if (it == mTexts.end()) { bounds[0]=bounds[1]=bounds[2]=bounds[3]=0; return; }
    const std::string& text = it->second;
    int s = start >= 0 ? start : 0;
    int e = end >= 0 ? std::min(end, (int)text.size()) : (int)text.size();
    std::string sub = text.substr(s, e - s);

    // Use the current font (already has typeface and size set from paint)
    SkRect skBounds;
    float width = mFont.measureText(sub.c_str(), sub.size(), SkTextEncoding::kUTF8, &skBounds);

    SkFontMetrics metrics;
    mFont.getMetrics(&metrics);

    bounds[0] = 0;
    bounds[1] = metrics.fAscent;   // negative (above baseline)
    bounds[2] = width;
    bounds[3] = metrics.fDescent;  // positive (below baseline)
}

// ── Path boolean operations ───────────────────────────────────────────

void SkiaPaintContext::combinePath(int outId, int pathId1, int pathId2, int operation) {
    auto it1 = mPaths.find(pathId1);
    auto it2 = mPaths.find(pathId2);
    if (it1 == mPaths.end() || it2 == mPaths.end()) return;

    // Map RemoteCompose operation byte to SkPathOp enum.
    // Java: 0=DIFFERENCE, 1=INTERSECT, 2=REVERSE_DIFFERENCE, 3=UNION, 4=XOR
    // Skia: 0=kDifference, 1=kIntersect, 2=kUnion, 3=kXOR, 4=kReverseDifference
    static constexpr SkPathOp kOpMap[] = {
        kDifference_SkPathOp,        // 0 → DIFFERENCE
        kIntersect_SkPathOp,         // 1 → INTERSECT
        kReverseDifference_SkPathOp, // 2 → REVERSE_DIFFERENCE
        kUnion_SkPathOp,             // 3 → UNION
        kXOR_SkPathOp,               // 4 → XOR
    };
    if (operation < 0 || operation > 4) return;

    auto result = Op(it1->second, it2->second, kOpMap[operation]);
    if (result) {
        mPaths[outId] = *result;
    }
}

// ── Offscreen bitmap rendering ────────────────────────────────────────

struct SkiaPaintContext::OffscreenBitmap {
    SkBitmap bitmap;
};

void SkiaPaintContext::beginDrawToBitmap(int bitmapId, int mode, int color) {
    if (bitmapId == 0) return;

    // Get the existing image to determine dimensions
    auto it = mImages.find(bitmapId);
    if (it == mImages.end()) return;

    int w = it->second->width();
    int h = it->second->height();

    // Save main canvas
    if (!mMainCanvas) {
        mMainCanvas = mCanvas;
    }
    mActiveBitmapId = bitmapId;

    // Create offscreen bitmap
    mOffscreenBitmap = std::make_unique<OffscreenBitmap>();
    SkImageInfo info = SkImageInfo::MakeN32Premul(w, h);
    mOffscreenBitmap->bitmap.allocPixels(info);

    if ((mode & 1) == 0) {
        // Initialize with color (Java format: ARGB int)
        mOffscreenBitmap->bitmap.eraseColor(static_cast<SkColor>(static_cast<uint32_t>(color)));
    } else {
        // MODE_NO_INITIALIZE: preserve previous bitmap content
        // Copy existing image pixels into the offscreen bitmap
        SkPixmap srcPixmap;
        if (it->second->peekPixels(&srcPixmap)) {
            mOffscreenBitmap->bitmap.writePixels(srcPixmap);
        } else {
            // If we can't peek pixels directly, draw the image onto the bitmap
            SkCanvas tmpCanvas(mOffscreenBitmap->bitmap);
            tmpCanvas.clear(SK_ColorTRANSPARENT);
            tmpCanvas.drawImage(it->second, 0, 0);
        }
    }

    // Create canvas for the bitmap
    mOffscreenCanvas = std::make_unique<SkCanvas>(mOffscreenBitmap->bitmap);
    mCanvas = mOffscreenCanvas.get();
}

void SkiaPaintContext::endDrawToBitmap() {
    if (!mMainCanvas || !mOffscreenBitmap || mActiveBitmapId == 0) return;

    // Store the rendered bitmap as an image
    mImages[mActiveBitmapId] = mOffscreenBitmap->bitmap.asImage();

    // Restore main canvas
    mCanvas = mMainCanvas;
    mMainCanvas = nullptr;
    mActiveBitmapId = 0;
    mOffscreenCanvas.reset();
    mOffscreenBitmap.reset();
}

// ── PaintBundle interpreter ───────────────────────────────────────────

void SkiaPaintContext::applyPaintBundle(const PaintBundle& bundle) {
    const auto& arr = bundle.getData();
    int i = 0;
    int len = bundle.size();

    // Reset shader and color filter at start of new paint application
    mPaint.setShader(nullptr);

    while (i < len) {
        int32_t cmd = arr[i++];
        int tag = cmd & 0xFFFF;
        int upper = (cmd >> 16) & 0xFFFF;

        switch (tag) {
            case PaintBundle::TEXT_SIZE: {
                float sz = PaintBundle::intBitsToFloat(arr[i++]);
                if (std::isnan(sz)) {
                    int id = Utils::idFromNan(sz);
                    sz = mContext.getFloat(id);
                }
                mFont.setSize(sz);
                break;
            }
            case PaintBundle::COLOR:
            case PaintBundle::COLOR_ID: {
                // COLOR: value is literal ARGB
                // COLOR_ID: value already resolved to ARGB by PaintBundle::updateVariables()
                int32_t color = arr[i++];
                int a = (color >> 24) & 0xFF;
                int r = (color >> 16) & 0xFF;
                int g = (color >> 8) & 0xFF;
                int b = color & 0xFF;
                mPaint.setARGB(a, r, g, b);
                break;
            }
            case PaintBundle::STROKE_WIDTH: {
                float w = PaintBundle::intBitsToFloat(arr[i++]);
                if (std::isnan(w)) {
                    int id = Utils::idFromNan(w);
                    w = mContext.getFloat(id);
                }
                mPaint.setStrokeWidth(w);
                break;
            }
            case PaintBundle::STROKE_MITER: {
                float m = PaintBundle::intBitsToFloat(arr[i++]);
                if (std::isnan(m)) {
                    int id = Utils::idFromNan(m);
                    m = mContext.getFloat(id);
                }
                mPaint.setStrokeMiter(m);
                break;
            }
            case PaintBundle::STROKE_CAP: {
                SkPaint::Cap cap = SkPaint::kButt_Cap;
                if (upper == 1) cap = SkPaint::kRound_Cap;
                else if (upper == 2) cap = SkPaint::kSquare_Cap;
                mPaint.setStrokeCap(cap);
                break;
            }
            case PaintBundle::STYLE: {
                if (upper == PaintBundle::STYLE_FILL) {
                    mPaint.setStyle(SkPaint::kFill_Style);
                } else if (upper == PaintBundle::STYLE_STROKE) {
                    mPaint.setStyle(SkPaint::kStroke_Style);
                } else if (upper == PaintBundle::STYLE_FILL_AND_STROKE) {
                    mPaint.setStyle(SkPaint::kStrokeAndFill_Style);
                }
                break;
            }
            case PaintBundle::GRADIENT: {
                // Gradient type in upper bits
                int gradType = upper;
                int32_t control = arr[i++];
                int numColors = control & 0xFF;
                // Read colors
                std::vector<SkColor> colors(numColors);
                for (int j = 0; j < numColors; j++) {
                    colors[j] = static_cast<SkColor>(arr[i++]);
                }
                // Read stops
                int numStops = arr[i++];
                std::vector<SkScalar> stops(numStops);
                for (int j = 0; j < numStops; j++) {
                    stops[j] = PaintBundle::intBitsToFloat(arr[i++]);
                }

                SkScalar* stopsPtr = numStops > 0 ? stops.data() : nullptr;
                SkTileMode tileMode = SkTileMode::kClamp;

                if (gradType == PaintBundle::LINEAR_GRADIENT) {
                    float sx = PaintBundle::intBitsToFloat(arr[i++]);
                    float sy = PaintBundle::intBitsToFloat(arr[i++]);
                    float ex = PaintBundle::intBitsToFloat(arr[i++]);
                    float ey = PaintBundle::intBitsToFloat(arr[i++]);
                    int tm = arr[i++];
                    if (tm == 1) tileMode = SkTileMode::kRepeat;
                    else if (tm == 2) tileMode = SkTileMode::kMirror;

                    SkPoint pts[2] = {{sx, sy}, {ex, ey}};
                    auto shader = SkGradientShader::MakeLinear(
                        pts, colors.data(), stopsPtr, numColors, tileMode);
                    mPaint.setShader(shader);
                } else if (gradType == PaintBundle::RADIAL_GRADIENT) {
                    float cx = PaintBundle::intBitsToFloat(arr[i++]);
                    float cy = PaintBundle::intBitsToFloat(arr[i++]);
                    float radius = PaintBundle::intBitsToFloat(arr[i++]);
                    int tm = arr[i++];
                    if (tm == 1) tileMode = SkTileMode::kRepeat;
                    else if (tm == 2) tileMode = SkTileMode::kMirror;

                    auto shader = SkGradientShader::MakeRadial(
                        {cx, cy}, radius, colors.data(), stopsPtr,
                        numColors, tileMode);
                    mPaint.setShader(shader);
                } else if (gradType == PaintBundle::SWEEP_GRADIENT) {
                    float cx = PaintBundle::intBitsToFloat(arr[i++]);
                    float cy = PaintBundle::intBitsToFloat(arr[i++]);

                    auto shader = SkGradientShader::MakeSweep(
                        cx, cy, colors.data(), stopsPtr, numColors);
                    mPaint.setShader(shader);
                }
                break;
            }
            case PaintBundle::ALPHA: {
                float alpha = PaintBundle::intBitsToFloat(arr[i++]);
                if (std::isnan(alpha)) {
                    int id = Utils::idFromNan(alpha);
                    alpha = mContext.getFloat(id);
                }
                mPaint.setAlphaf(alpha);
                break;
            }
            case PaintBundle::COLOR_FILTER: {
                int mode = upper;
                int32_t color = arr[i++];
                SkColor skColor = static_cast<SkColor>(color);
                mPaint.setColorFilter(
                    SkColorFilters::Blend(skColor, toSkBlendMode(mode)));
                break;
            }
            case PaintBundle::COLOR_FILTER_ID: {
                // Value already resolved to ARGB by PaintBundle::updateVariables()
                int mode = upper;
                int32_t color = arr[i++];
                mPaint.setColorFilter(
                    SkColorFilters::Blend(static_cast<SkColor>(color),
                                          toSkBlendMode(mode)));
                break;
            }
            case PaintBundle::CLEAR_COLOR_FILTER: {
                mPaint.setColorFilter(nullptr);
                break;
            }
            case PaintBundle::ANTI_ALIAS: {
                mPaint.setAntiAlias(upper != 0);
                break;
            }
            case PaintBundle::STROKE_JOIN: {
                SkPaint::Join join = SkPaint::kMiter_Join;
                if (upper == 1) join = SkPaint::kRound_Join;
                else if (upper == 2) join = SkPaint::kBevel_Join;
                mPaint.setStrokeJoin(join);
                break;
            }
            case PaintBundle::BLEND_MODE: {
                mPaint.setBlendMode(toSkBlendMode(upper));
                break;
            }
            case PaintBundle::TYPEFACE: {
                int weight = upper & 0x3FF;
                bool italic = (upper >> 10) > 0;
                int fontType = arr[i++];

                int effectiveWeight = weight > 0 ? weight : 400;
                // Cache key: fontType (8 bits) | weight (16 bits) | italic (1 bit)
                uint64_t key = (static_cast<uint64_t>(fontType) << 24)
                             | (static_cast<uint64_t>(effectiveWeight) << 8)
                             | (italic ? 1ULL : 0ULL);

                sk_sp<SkTypeface> tf;
                auto it = mTypefaceCache.find(key);
                if (it != mTypefaceCache.end()) {
                    tf = it->second;
                } else {
                    SkFontStyle style(effectiveWeight,
                                      SkFontStyle::kNormal_Width,
                                      italic ? SkFontStyle::kItalic_Slant
                                             : SkFontStyle::kUpright_Slant);

                    // CoreText does not recognise the CSS-style generic family
                    // names "sans-serif" / "serif" / "monospace" — those are
                    // fontconfig conventions. We have to ask CoreText for real
                    // family names that ship with macOS, and fall through a
                    // candidate list so the same code path also works on Linux
                    // (fontconfig) and Windows (DirectWrite). The CSS generic
                    // names stay at the end of each list as a last resort.
                    static const char* const kSansFamilies[] = {
                        "Helvetica Neue", "Helvetica", "Arial",
                        "DejaVu Sans", "Liberation Sans",
                        "sans-serif", nullptr,
                    };
                    static const char* const kSerifFamilies[] = {
                        "Times New Roman", "Times", "Georgia",
                        "DejaVu Serif", "Liberation Serif",
                        "serif", nullptr,
                    };
                    static const char* const kMonoFamilies[] = {
                        "Menlo", "SF Mono", "Courier New", "Courier",
                        "Consolas", "DejaVu Sans Mono", "Liberation Mono",
                        "monospace", nullptr,
                    };

                    const char* const* candidates = nullptr;
                    switch (fontType) {
                        case PaintBundle::FONT_TYPE_SANS_SERIF:
                            candidates = kSansFamilies; break;
                        case PaintBundle::FONT_TYPE_SERIF:
                            candidates = kSerifFamilies; break;
                        case PaintBundle::FONT_TYPE_MONOSPACE:
                            candidates = kMonoFamilies; break;
                        default: break; // FONT_TYPE_DEFAULT — keep nullptr
                    }

                    if (candidates) {
                        for (int k = 0; candidates[k] && !tf; ++k) {
                            tf = mFontMgr->matchFamilyStyle(candidates[k], style);
                        }
                    }
                    if (!tf) {
                        // FONT_TYPE_DEFAULT (or all candidates missed) → ask
                        // for the system default family + the requested style.
                        tf = mFontMgr->matchFamilyStyle(nullptr, style);
                    }
                    mTypefaceCache[key] = tf;  // cache even nullptr to avoid retrying
                }
                if (tf) mFont.setTypeface(tf);
                break;
            }
            case PaintBundle::FALLBACK_TYPEFACE: {
                // Skip for now
                i++; // fontType
                break;
            }
            case PaintBundle::SHADER: {
                int shaderId = arr[i++];
                if (shaderId == 0) {
                    mPaint.setShader(nullptr);
                    break;
                }
                auto* shaderData = mContext.getShader(shaderId);
                if (!shaderData) break;

                // Look up or compile the shader effect (cached by text ID)
                int textId = shaderData->shaderTextId;
                sk_sp<SkRuntimeEffect> effect;
                auto cacheIt = mShaderEffectCache.find(textId);
                if (cacheIt != mShaderEffectCache.end()) {
                    effect = cacheIt->second;
                } else {
                    auto textIt = mTexts.find(textId);
                    if (textIt == mTexts.end()) break;
                    auto [compiled, err] = SkRuntimeEffect::MakeForShader(
                        SkString(textIt->second));
                    if (!compiled) break;
                    effect = compiled;
                    mShaderEffectCache[textId] = effect;
                }

                // Build uniform data buffer
                auto uniforms = SkData::MakeZeroInitialized(effect->uniformSize());

                // Set float uniforms
                for (auto& fu : shaderData->floatUniforms) {
                    const auto* uniform = effect->findUniform(fu.name);
                    if (!uniform) continue;
                    float* dst = reinterpret_cast<float*>(
                        static_cast<uint8_t*>(uniforms->writable_data()) + uniform->offset);
                    for (size_t j = 0; j < fu.values.size(); j++) {
                        float val = fu.values[j];
                        if (std::isnan(val)) {
                            val = mContext.getFloat(Utils::idFromNan(val));
                        }
                        dst[j] = val;
                    }
                }

                // Set int uniforms
                for (auto& iu : shaderData->intUniforms) {
                    const auto* uniform = effect->findUniform(iu.name);
                    if (!uniform) continue;
                    int* dst = reinterpret_cast<int*>(
                        static_cast<uint8_t*>(uniforms->writable_data()) + uniform->offset);
                    for (size_t j = 0; j < iu.values.size(); j++) {
                        dst[j] = iu.values[j];
                    }
                }

                // Build child shaders (for bitmap uniforms)
                std::vector<SkRuntimeEffect::ChildPtr> children(
                    effect->children().size());
                for (auto& bu : shaderData->bitmapUniforms) {
                    const auto* child = effect->findChild(bu.name);
                    if (!child) continue;
                    auto imgIt = mImages.find(bu.bitmapId);
                    if (imgIt != mImages.end() && imgIt->second) {
                        children[child->index] = imgIt->second->makeShader(
                            SkTileMode::kClamp, SkTileMode::kClamp,
                            SkSamplingOptions(SkFilterMode::kLinear));
                    }
                }

                auto shader = effect->makeShader(
                    std::move(uniforms),
                    SkSpan<const SkRuntimeEffect::ChildPtr>(
                        children.data(), children.size()));
                if (shader) mPaint.setShader(std::move(shader));
                break;
            }
            case PaintBundle::SHADER_MATRIX: {
                int matrixIdBits = arr[i++];
                float matrixIdFloat = PaintBundle::intBitsToFloat(matrixIdBits);
                int matrixId = std::isnan(matrixIdFloat)
                    ? Utils::idFromNan(matrixIdFloat)
                    : matrixIdBits;
                if (matrixId == 0) break;
                const auto* matValues = mContext.getObjectMatrix(matrixId);
                if (matValues && matValues->size() >= 9) {
                    SkMatrix m;
                    m.setAll((*matValues)[0], (*matValues)[1], (*matValues)[2],
                             (*matValues)[3], (*matValues)[4], (*matValues)[5],
                             (*matValues)[6], (*matValues)[7], (*matValues)[8]);
                    auto existingShader = mPaint.refShader();
                    if (existingShader) {
                        mPaint.setShader(existingShader->makeWithLocalMatrix(m));
                    }
                }
                break;
            }
            case PaintBundle::IMAGE_FILTER_QUALITY: {
                // Handled by sampling options at draw time
                break;
            }
            case PaintBundle::FILTER_BITMAP: {
                // Skip - handled at draw time
                break;
            }
            case PaintBundle::FONT_AXIS: {
                int count = upper;
                for (int j = 0; j < count; j++) {
                    i++; // tag text id
                    i++; // value float
                }
                break;
            }
            case PaintBundle::TEXTURE: {
                int bitmapId = arr[i++];
                int tileModes = arr[i++];
                int filter = arr[i++];

                // Unpack tile modes (wire values match SkTileMode ordinals)
                SkTileMode tileX = static_cast<SkTileMode>(tileModes & 0xF);
                SkTileMode tileY = static_cast<SkTileMode>((tileModes >> 16) & 0xF);

                // Look up the decoded bitmap image and create a shader
                auto it = mImages.find(bitmapId);
                if (it != mImages.end() && it->second) {
                    SkSamplingOptions sampling(SkFilterMode::kLinear);
                    int filterMode = filter & 0xF;
                    if (filterMode == 1) {
                        sampling = SkSamplingOptions(SkFilterMode::kNearest);
                    }
                    auto shader = it->second->makeShader(tileX, tileY, sampling);
                    if (shader) {
                        mPaint.setShader(shader);
                    }
                }
                break;
            }
            case PaintBundle::PATH_EFFECT: {
                int count = upper;
                if (count == 0) {
                    // Empty payload = explicit "clear path effect".  Without
                    // this branch a previously-set dash effect would leak
                    // into every subsequent stroke draw because mPaint is
                    // a persistent state object.
                    mPaint.setPathEffect(nullptr);
                } else if (count > 0 && count <= 2028) {
                    std::vector<float> intervals(count);
                    for (int j = 0; j < count; j++) {
                        intervals[j] = PaintBundle::intBitsToFloat(arr[i++]);
                    }
                    if (count >= 2) {
                        auto effect = SkDashPathEffect::Make(
                            SkSpan<const SkScalar>(intervals.data(), count), 0.0f);
                        mPaint.setPathEffect(effect);
                    }
                }
                break;
            }
            default:
                // Unknown tag - can't safely skip, break
                break;
        }
    }
}

SkBlendMode SkiaPaintContext::toSkBlendMode(int mode) {
    switch (mode) {
        case PaintBundle::BLEND_MODE_CLEAR:      return SkBlendMode::kClear;
        case PaintBundle::BLEND_MODE_SRC:         return SkBlendMode::kSrc;
        case PaintBundle::BLEND_MODE_DST:         return SkBlendMode::kDst;
        case PaintBundle::BLEND_MODE_SRC_OVER:    return SkBlendMode::kSrcOver;
        case PaintBundle::BLEND_MODE_DST_OVER:    return SkBlendMode::kDstOver;
        case PaintBundle::BLEND_MODE_SRC_IN:      return SkBlendMode::kSrcIn;
        case PaintBundle::BLEND_MODE_DST_IN:      return SkBlendMode::kDstIn;
        case PaintBundle::BLEND_MODE_SRC_OUT:     return SkBlendMode::kSrcOut;
        case PaintBundle::BLEND_MODE_DST_OUT:     return SkBlendMode::kDstOut;
        case PaintBundle::BLEND_MODE_SRC_ATOP:    return SkBlendMode::kSrcATop;
        case PaintBundle::BLEND_MODE_DST_ATOP:    return SkBlendMode::kDstATop;
        case PaintBundle::BLEND_MODE_XOR:         return SkBlendMode::kXor;
        case PaintBundle::BLEND_MODE_PLUS:
        case PaintBundle::PORTER_MODE_ADD:        return SkBlendMode::kPlus;
        case PaintBundle::BLEND_MODE_MODULATE:    return SkBlendMode::kModulate;
        case PaintBundle::BLEND_MODE_SCREEN:      return SkBlendMode::kScreen;
        case PaintBundle::BLEND_MODE_OVERLAY:     return SkBlendMode::kOverlay;
        case PaintBundle::BLEND_MODE_DARKEN:      return SkBlendMode::kDarken;
        case PaintBundle::BLEND_MODE_LIGHTEN:     return SkBlendMode::kLighten;
        case PaintBundle::BLEND_MODE_COLOR_DODGE: return SkBlendMode::kColorDodge;
        case PaintBundle::BLEND_MODE_COLOR_BURN:  return SkBlendMode::kColorBurn;
        case PaintBundle::BLEND_MODE_HARD_LIGHT:  return SkBlendMode::kHardLight;
        case PaintBundle::BLEND_MODE_SOFT_LIGHT:  return SkBlendMode::kSoftLight;
        case PaintBundle::BLEND_MODE_DIFFERENCE:  return SkBlendMode::kDifference;
        case PaintBundle::BLEND_MODE_EXCLUSION:   return SkBlendMode::kExclusion;
        case PaintBundle::BLEND_MODE_MULTIPLY:    return SkBlendMode::kMultiply;
        case PaintBundle::BLEND_MODE_HUE:         return SkBlendMode::kHue;
        case PaintBundle::BLEND_MODE_SATURATION:  return SkBlendMode::kSaturation;
        case PaintBundle::BLEND_MODE_COLOR:       return SkBlendMode::kColor;
        case PaintBundle::BLEND_MODE_LUMINOSITY:  return SkBlendMode::kLuminosity;
        default: return SkBlendMode::kSrcOver;
    }
}

// ── Path builder ──────────────────────────────────────────────────────

// Resolve a float value: if NaN-encoded variable ref, look up from context
static float resolvePathFloat(float v, rccore::RemoteContext& ctx) {
    if (std::isnan(v)) {
        int32_t bits;
        memcpy(&bits, &v, sizeof(bits));
        int id = bits & 0x3FFFFF;
        // Don't resolve path commands (they are in the path command NaN range)
        if (id >= PATH_MOVE && id <= PATH_DONE) return v;
        return ctx.getFloat(id);
    }
    return v;
}

void SkiaPaintContext::buildPathFromFloats(SkPath& path,
                                           const std::vector<float>& data,
                                           int winding) {
    SkPathBuilder builder;
    switch (winding) {
        case 1: builder.setFillType(SkPathFillType::kEvenOdd); break;
        case 2: builder.setFillType(SkPathFillType::kInverseEvenOdd); break;
        case 3: builder.setFillType(SkPathFillType::kInverseWinding); break;
        default: break; // 0 = kWinding (Skia default)
    }

    int i = 0;
    int n = static_cast<int>(data.size());

    while (i < n) {
        if (!isPathCommand(data[i])) {
            i++;
            continue;
        }
        int cmd = nanId(data[i]);
        switch (cmd) {
            case PATH_MOVE:
                i++; // command
                if (i + 1 < n) {
                    float x = resolvePathFloat(data[i], mContext);
                    float y = resolvePathFloat(data[i + 1], mContext);
                    builder.moveTo(x, y);
                    i += 2;
                }
                break;
            case PATH_LINE:
                i += 3; // command + 2 padding
                if (i + 1 < n) {
                    float x = resolvePathFloat(data[i], mContext);
                    float y = resolvePathFloat(data[i + 1], mContext);
                    builder.lineTo(x, y);
                    i += 2;
                }
                break;
            case PATH_QUADRATIC:
                i += 3; // command + 2 padding
                if (i + 3 < n) {
                    float x1 = resolvePathFloat(data[i], mContext);
                    float y1 = resolvePathFloat(data[i + 1], mContext);
                    float x2 = resolvePathFloat(data[i + 2], mContext);
                    float y2 = resolvePathFloat(data[i + 3], mContext);
                    builder.quadTo(x1, y1, x2, y2);
                    i += 4;
                }
                break;
            case PATH_CONIC:
                i += 3; // command + 2 padding
                if (i + 4 < n) {
                    float x1 = resolvePathFloat(data[i], mContext);
                    float y1 = resolvePathFloat(data[i + 1], mContext);
                    float x2 = resolvePathFloat(data[i + 2], mContext);
                    float y2 = resolvePathFloat(data[i + 3], mContext);
                    float w = resolvePathFloat(data[i + 4], mContext);
                    builder.conicTo(x1, y1, x2, y2, w);
                    i += 5;
                }
                break;
            case PATH_CUBIC:
                i += 3; // command + 2 padding
                if (i + 5 < n) {
                    float x1 = resolvePathFloat(data[i], mContext);
                    float y1 = resolvePathFloat(data[i + 1], mContext);
                    float x2 = resolvePathFloat(data[i + 2], mContext);
                    float y2 = resolvePathFloat(data[i + 3], mContext);
                    float x3 = resolvePathFloat(data[i + 4], mContext);
                    float y3 = resolvePathFloat(data[i + 5], mContext);
                    builder.cubicTo(x1, y1, x2, y2, x3, y3);
                    i += 6;
                }
                break;
            case PATH_CLOSE:
                i++;
                builder.close();
                break;
            case PATH_DONE:
                i = n; // end
                break;
            default:
                i++;
                break;
        }
    }

    path = builder.detach();
}

} // namespace rcskia
