#pragma once
#include <cstdint>
#include <string>
#include <vector>
#include <unordered_map>

namespace rccore {

class RemoteContext;
class PaintBundle;

class PaintContext {
public:
    explicit PaintContext(RemoteContext& context) : mContext(context) {}
    virtual ~PaintContext() = default;

    RemoteContext& getContext() { return mContext; }

    // Drawing
    virtual void drawRect(float left, float top, float right, float bottom) = 0;
    virtual void drawCircle(float cx, float cy, float radius) = 0;
    virtual void drawLine(float x1, float y1, float x2, float y2) = 0;
    virtual void drawOval(float left, float top, float right, float bottom) = 0;
    virtual void drawArc(float left, float top, float right, float bottom,
                         float startAngle, float sweepAngle) = 0;
    virtual void drawRoundRect(float left, float top, float right, float bottom,
                               float rx, float ry) = 0;
    virtual void drawSector(float left, float top, float right, float bottom,
                            float startAngle, float sweepAngle) = 0;
    virtual void drawPath(int pathId, float start, float end) = 0;
    virtual void drawTweenPath(int path1Id, int path2Id, float tween,
                               float start, float end) = 0;
    virtual void tweenPath(int outId, int pathId1, int pathId2, float tween) = 0;
    virtual void drawBitmap(int imageId, float left, float top,
                            float right, float bottom) = 0;
    virtual void drawBitmapInt(int imageId,
                               int srcL, int srcT, int srcR, int srcB,
                               int dstL, int dstT, int dstR, int dstB,
                               int cdId) = 0;
    virtual void drawTextRun(int textId, int start, int end,
                             int contextStart, int contextEnd,
                             float x, float y, bool rtl) = 0;
    virtual void drawTextAnchored(int textId, float x, float y,
                                  float panX, float panY, int flags) = 0;
    virtual void drawTextOnPath(int textId, int pathId,
                                float hOffset, float vOffset) = 0;

    // Paint
    virtual void applyPaint(const PaintBundle& bundle) = 0;
    virtual void savePaint() = 0;
    virtual void restorePaint() = 0;

    // Transform
    virtual void matrixSave() = 0;
    virtual void matrixRestore() = 0;
    virtual void matrixScale(float sx, float sy, float cx, float cy) = 0;
    virtual void matrixTranslate(float dx, float dy) = 0;
    virtual void matrixRotate(float degrees, float cx, float cy) = 0;
    virtual void matrixSkew(float sx, float sy) = 0;

    // Clipping
    virtual void clipRect(float left, float top, float right, float bottom) = 0;
    virtual void clipPath(int pathId, int regionOp) = 0;
    virtual void roundedClipRect(float w, float h, float topStart, float topEnd,
                                  float bottomStart, float bottomEnd) = 0;

    // Data
    virtual void loadText(int id, const std::string& text) = 0;
    virtual std::string getText(int id) = 0;
    virtual void loadBitmap(int imageId, int widthAndType,
                            int heightAndEncoding,
                            const std::vector<uint8_t>& data) = 0;
    virtual void loadPathData(int instanceId, int winding,
                              const std::vector<float>& path) = 0;
    virtual void appendPathData(int instanceId,
                                const std::vector<float>& path) = 0;

    // Graphics layers
    virtual void startGraphicsLayer(int w, int h) {}
    virtual void endGraphicsLayer() {}

    // Offscreen bitmap rendering (DrawToBitmap support)
    virtual void beginDrawToBitmap(int bitmapId, int mode, int color) {}
    virtual void endDrawToBitmap() {}

    // Text measurement (for layout system)
    // Returns approximate width and height for a text string at a given font size.
    // Subclasses should override with actual font metrics.
    virtual float measureTextWidth(const std::string& text, float fontSize) {
        return fontSize * 0.6f * text.size();
    }
    virtual float measureTextHeight(const std::string& text, float fontSize) {
        return fontSize * 1.2f;
    }
    virtual float measureTextAscent(const std::string& text, float fontSize) {
        return fontSize;  // approximate: ascent ≈ fontSize
    }

    // Text bounds measurement (for TextMeasure/TextAttribute ops).
    // bounds[0]=left, bounds[1]=top, bounds[2]=right, bounds[3]=bottom.
    virtual void getTextBounds(int textId, int start, int end, int flags, float bounds[4]) {
        std::string text = getText(textId);
        if (text.empty()) { bounds[0]=bounds[1]=bounds[2]=bounds[3]=0; return; }
        int s = start >= 0 ? start : 0;
        int e = end >= 0 ? std::min(end, (int)text.size()) : (int)text.size();
        std::string sub = text.substr(s, e - s);
        float fontSize = 14.0f; // default
        bounds[0] = 0;
        bounds[1] = -measureTextAscent(sub, fontSize);
        bounds[2] = measureTextWidth(sub, fontSize);
        bounds[3] = measureTextHeight(sub, fontSize) + bounds[1];
    }

    // Path boolean operations
    virtual void combinePath(int outId, int pathId1, int pathId2, int operation) {}

    // Reset
    virtual void reset() = 0;

    // Repaint tracking
    void needsRepaint() { mNeedsRepaint = true; }
    bool doesNeedsRepaint() const { return mNeedsRepaint; }
    void clearNeedsRepaint() { mNeedsRepaint = false; }

protected:
    RemoteContext& mContext;
    bool mNeedsRepaint = false;
};

} // namespace rccore
