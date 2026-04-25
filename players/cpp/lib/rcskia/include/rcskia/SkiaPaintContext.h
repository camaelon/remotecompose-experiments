#pragma once
#include "rccore/PaintContext.h"
#include "rccore/PaintBundle.h"

#include "include/core/SkCanvas.h"
#include "include/core/SkPaint.h"
#include "include/core/SkPath.h"
#include "include/core/SkImage.h"
#include "include/core/SkFont.h"
#include "include/core/SkTypeface.h"
#include "include/core/SkData.h"
#include "include/effects/SkRuntimeEffect.h"

#include <stack>
#include <memory>
#include <unordered_map>

namespace rcskia {

class SkiaPaintContext : public rccore::PaintContext {
public:
    // Bitmap type constants (from BitmapData.java)
    static constexpr int TYPE_PNG_8888    = 0; // PNG-compressed RGBA 8888 (default)
    static constexpr int TYPE_PNG         = 1; // Standard PNG
    static constexpr int TYPE_RAW8        = 2; // Raw 8-bit grayscale
    static constexpr int TYPE_RAW8888     = 3; // Raw ARGB 8888
    static constexpr int TYPE_PNG_ALPHA_8 = 4; // PNG-compressed alpha-only

    // Bitmap encoding constants
    static constexpr int ENCODING_INLINE  = 0; // Data inline in file
    static constexpr int ENCODING_URL     = 1; // Data is URL string
    static constexpr int ENCODING_FILE    = 2; // Data is file path
    static constexpr int ENCODING_EMPTY   = 3; // Allocate empty bitmap

    SkiaPaintContext(rccore::RemoteContext& context, SkCanvas* canvas);
    ~SkiaPaintContext() override;

    // Update the canvas pointer (e.g. after surface resize)
    void setCanvas(SkCanvas* canvas) { mCanvas = canvas; }

    // Drawing
    void drawRect(float left, float top, float right, float bottom) override;
    void drawCircle(float cx, float cy, float radius) override;
    void drawLine(float x1, float y1, float x2, float y2) override;
    void drawOval(float left, float top, float right, float bottom) override;
    void drawArc(float left, float top, float right, float bottom,
                 float startAngle, float sweepAngle) override;
    void drawRoundRect(float left, float top, float right, float bottom,
                       float rx, float ry) override;
    void drawSector(float left, float top, float right, float bottom,
                    float startAngle, float sweepAngle) override;
    void drawPath(int pathId, float start, float end) override;
    void drawTweenPath(int path1Id, int path2Id, float tween,
                       float start, float end) override;
    void tweenPath(int outId, int pathId1, int pathId2, float tween) override;
    void drawBitmap(int imageId, float left, float top,
                    float right, float bottom) override;
    void drawBitmapInt(int imageId,
                       int srcL, int srcT, int srcR, int srcB,
                       int dstL, int dstT, int dstR, int dstB,
                       int cdId) override;
    void drawTextRun(int textId, int start, int end,
                     int contextStart, int contextEnd,
                     float x, float y, bool rtl) override;
    void drawTextAnchored(int textId, float x, float y,
                          float panX, float panY, int flags) override;
    void drawTextOnPath(int textId, int pathId,
                        float hOffset, float vOffset) override;

    // Paint
    void applyPaint(const rccore::PaintBundle& bundle) override;
    void savePaint() override;
    void restorePaint() override;

    // Transform
    void matrixSave() override;
    void matrixRestore() override;
    void matrixScale(float sx, float sy, float cx, float cy) override;
    void matrixTranslate(float dx, float dy) override;
    void matrixRotate(float degrees, float cx, float cy) override;
    void matrixSkew(float sx, float sy) override;

    // Clipping
    void clipRect(float left, float top, float right, float bottom) override;
    void clipPath(int pathId, int regionOp) override;
    void roundedClipRect(float w, float h, float topStart, float topEnd,
                          float bottomStart, float bottomEnd) override;

    // Data
    void loadText(int id, const std::string& text) override;
    std::string getText(int id) override;
    void loadBitmap(int imageId, int widthAndType,
                    int heightAndEncoding,
                    const std::vector<uint8_t>& data) override;
    void loadPathData(int instanceId, int winding,
                      const std::vector<float>& path) override;
    void appendPathData(int instanceId,
                        const std::vector<float>& path) override;

    // Offscreen bitmap rendering
    void beginDrawToBitmap(int bitmapId, int mode, int color) override;
    void endDrawToBitmap() override;

    // Text measurement
    float measureTextWidth(const std::string& text, float fontSize) override;
    float measureTextHeight(const std::string& text, float fontSize) override;
    float measureTextAscent(const std::string& text, float fontSize) override;
    void getTextBounds(int textId, int start, int end, int flags, float bounds[4]) override;
    void combinePath(int outId, int pathId1, int pathId2, int operation) override;

    // Reset
    void reset() override;

private:
    void applyPaintBundle(const rccore::PaintBundle& bundle);
    SkBlendMode toSkBlendMode(int mode);
    void buildPathFromFloats(SkPath& path, const std::vector<float>& data, int winding);
    // Draw or measure UTF-8 text with per-codepoint typeface fallback.
    // *draw* — when true, paints into mCanvas at (x, y); when false,
    // returns the natural advance + bounds without drawing.  Returns
    // total horizontal advance in pixels; *outBounds* (if non-null)
    // gets the union of every glyph's bounds, anchored at (x, y) when
    // drawing, or at (0, 0) when measuring.
    float drawOrMeasureWithFallback(const std::string& utf8,
                                     float x, float y,
                                     bool draw,
                                     SkRect* outBounds);

    SkCanvas* mCanvas;
    SkPaint mPaint;
    SkFont mFont;
    std::stack<SkPaint> mPaintStack;
    std::stack<SkFont> mFontStack;

    // Cached font manager + typeface lookups. Reused across all draw calls
    // so that paint changes carrying a TYPEFACE tag don't trigger a fresh
    // CoreText font catalog scan every span. Key encodes family + weight +
    // italic into a single 32-bit value.
    sk_sp<SkFontMgr> mFontMgr;
    std::unordered_map<uint64_t, sk_sp<SkTypeface>> mTypefaceCache;
    // Per-codepoint fallback typeface cache.  When mFont's primary
    // typeface lacks a glyph for a codepoint (CJK, emoji, …), the
    // text helpers ask CoreText for the best system family that
    // covers it via SkFontMgr::matchFamilyStyleCharacter and remember
    // the result here so we don't pay the lookup cost per draw.
    std::unordered_map<int32_t, sk_sp<SkTypeface>> mFallbackCache;

    std::unordered_map<int, std::string> mTexts;
    std::unordered_map<int, sk_sp<SkImage>> mImages;
    std::unordered_map<int, SkPath> mPaths;

    // Cache compiled SkRuntimeEffect objects keyed by shader text ID
    // to avoid recompiling AGSL source every frame
    std::unordered_map<int, sk_sp<SkRuntimeEffect>> mShaderEffectCache;

    // Raw float data for path append support
    struct PathFloatData {
        std::vector<float> floats;
        int winding = 0;
    };
    std::unordered_map<int, PathFloatData> mPathFloatData;

    // Offscreen bitmap rendering (DrawToBitmap)
    SkCanvas* mMainCanvas = nullptr;
    int mActiveBitmapId = 0;
    std::unique_ptr<SkCanvas> mOffscreenCanvas;
    struct OffscreenBitmap;
    std::unique_ptr<OffscreenBitmap> mOffscreenBitmap;
};

} // namespace rcskia
