#pragma once

#include "rccore/PaintContext.h"
#include "rccore/PaintBundle.h"
#include "rccore/d3/SoftwarePaint3DContext.h"

#include <CoreGraphics/CoreGraphics.h>

#include <stack>
#include <string>
#include <unordered_map>
#include <vector>

namespace rcnative {

/**
 * A RemoteCompose paint backend on Core Graphics / Core Text, with no Skia.
 *
 * Implements the same `rccore::PaintContext` as `rcskia`, so this is a sibling backend and
 * the engine is shared untouched. Swapping between them is a link-time choice.
 *
 * Why: in a Release arm64 build, Skia is 4.52 MB of a 5.61 MB binary. Core Graphics, Core
 * Text and ImageIO ship with the OS.
 *
 * Coordinate convention: RemoteCompose is y-down, Core Graphics is y-up. The context is
 * flipped once at construction (translate to height, scale 1,-1) so every draw below can be
 * written in document coordinates. Text is the exception — see drawTextAnchored.
 *
 * State model: `PaintContext` keeps paint and matrix stacks *separately* — `savePaint` and
 * `matrixSave` are different calls. CGContext has only one combined gsave/grestore, so paint
 * is tracked here in `mPaint` with its own stack and only the matrix uses CGContextSaveGState.
 */
class CoreGraphicsPaintContext : public rccore::PaintContext {
public:
    /**
     * @param yDown pass true when the context is already y-down — which a UIView's
     *        drawRect context is, because UIKit flips it for you. Pass false for a bare
     *        CGBitmapContext, which is y-up and needs flipping here. Getting this wrong
     *        renders the document mirrored vertically, with text the only part that looks
     *        right (it compensates locally either way).
     */
    CoreGraphicsPaintContext(rccore::RemoteContext& context, CGContextRef cg,
                             float widthPx, float heightPx, bool yDown = false);
    ~CoreGraphicsPaintContext() override;

    /**
     * 3D goes through the shared software rasterizer, which is already Skia-free — the same
     * arrangement the Skia backend uses. Returning non-null here is the whole reason a 3D
     * document draws anything: every 3D op begins with this downcast and silently no-ops on
     * null.
     */
    rccore::Paint3D* asPaint3D() override { return &m3D; }

    // ── drawing ──────────────────────────────────────────────────────────
    void drawRect(float l, float t, float r, float b) override;
    void drawCircle(float cx, float cy, float radius) override;
    void drawLine(float x1, float y1, float x2, float y2) override;
    void drawOval(float l, float t, float r, float b) override;
    void drawArc(float l, float t, float r, float b, float startAngle, float sweep) override;
    void drawRoundRect(float l, float t, float r, float b, float rx, float ry) override;
    void drawSector(float l, float t, float r, float b, float startAngle, float sweep) override;
    void drawPath(int pathId, float start, float end) override;
    void drawTweenPath(int p1, int p2, float tween, float start, float end) override;
    void tweenPath(int outId, int p1, int p2, float tween) override;
    void drawBitmap(int imageId, float l, float t, float r, float b) override;
    void drawBitmapInt(int imageId, int sl, int st, int sr, int sb,
                       int dl, int dt, int dr, int db, int cdId) override;
    void drawTextRun(int textId, int start, int end, int ctxStart, int ctxEnd,
                     float x, float y, bool rtl) override;
    void drawTextAnchored(int textId, float x, float y,
                          float panX, float panY, int flags) override;
    void drawTextOnPath(int textId, int pathId, float hOffset, float vOffset) override;

    // ── paint ────────────────────────────────────────────────────────────
    void applyPaint(const rccore::PaintBundle& bundle) override;
    void savePaint() override;
    void restorePaint() override;

    // ── transform ────────────────────────────────────────────────────────
    void matrixSave() override;
    void matrixRestore() override;
    void matrixScale(float sx, float sy, float cx, float cy) override;
    void matrixTranslate(float dx, float dy) override;
    void matrixRotate(float degrees, float cx, float cy) override;
    void matrixSkew(float sx, float sy) override;

    // ── clipping ─────────────────────────────────────────────────────────
    void clipRect(float l, float t, float r, float b) override;
    void clipPath(int pathId, int regionOp) override;
    void roundedClipRect(float w, float h, float topStart, float topEnd,
                         float bottomStart, float bottomEnd) override;

    // ── data ─────────────────────────────────────────────────────────────
    void loadText(int id, const std::string& text) override;
    std::string getText(int id) override;
    void loadBitmap(int imageId, int widthAndType, int heightAndEncoding,
                    const std::vector<uint8_t>& data) override;
    void loadPathData(int instanceId, int winding, const std::vector<float>& path) override;
    void appendPathData(int instanceId, const std::vector<float>& path) override;

    // ── text metrics (overriding the interface's rough defaults) ─────────
    float measureTextWidth(const std::string& text, float fontSize) override;
    float measureTextHeight(const std::string& text, float fontSize) override;
    float measureTextAscent(const std::string& text, float fontSize) override;

    void reset() override;

private:
    /** The paint state CG cannot hold for us. Mirrors the fields PaintBundle carries. */
    struct Paint {
        uint32_t color = 0xFF000000;
        float strokeWidth = 1.0f;
        float miter = 4.0f;
        int cap = 0;                 // 0 butt, 1 round, 2 square
        int join = 0;
        bool fill = true;            // style: fill vs stroke
        float textSize = 14.0f;
        std::string fontFamily;
        // Gradient, when the paint carries one. CG has no shader object, so a gradient is
        // applied by clipping to the shape and drawing the gradient through it.
        bool hasGradient = false;
        int gradientType = 0;        // 0 linear, 1 radial, 2 sweep
        std::vector<uint32_t> gradColors;
        std::vector<float> gradStops;
        float gradPts[4] = {0, 0, 0, 0};
    };

    /**
     * Adapter from the Paint3D op surface onto SoftwarePaint3DContext, mirroring rcskia's
     * Skia3D. The software buffer is sized lazily to the document's own coordinate space and
     * blit after each drawMesh3D, so 2D and 3D draws keep their interleaved order instead of
     * the whole 3D pass landing on top.
     */
    class Native3D : public rccore::Paint3D {
    public:
        explicit Native3D(CoreGraphicsPaintContext& owner) : mOwner(owner) {}
        void defineMesh3D(int id, const std::vector<int32_t>& indices,
                          const std::vector<float>& verts,
                          const std::vector<float>& normals,
                          const std::vector<float>& uv) override;
        void setCamera3D(int projection, const std::vector<float>& projParams,
                         const std::vector<float>& viewParams) override;
        void matrix3Op(int sub, const std::vector<float>& args) override;
        void drawMesh3D(int meshId, int mode) override;
        void clearDepth3D() override;
        void setLights3D(const std::vector<int>& types,
                         const std::vector<int32_t>& colors,
                         const std::vector<float>& params) override;
        void setTexture3D(int bitmapId) override;
        void setMaterial3D(float specStrength, float shininess) override;
        void setDepthBias3D(float constant, float slope) override;

    private:
        /** Size the software buffer to the document. Null when it has no area yet. */
        rccore::d3::SoftwarePaint3DContext* ensure();
        void blit();
        /**
         * MODE_BACKEND_CANVAS: CG fills the projected triangles itself rather than going
         * through the software buffer. Flat shading only — one colour per triangle is a fill
         * CG can do, Gouraud interpolation is not, so smooth mode stays on the software path.
         */
        void drawMesh3DCanvas(int meshId);

        CoreGraphicsPaintContext& mOwner;
        rccore::d3::SoftwarePaint3DContext mCtx;
        bool mSized = false;
        /** Reused across frames so a per-frame rebuild does not reallocate. */
        rccore::d3::SoftwarePaint3DContext::CanvasMesh mCanvasMesh;
    };

    Native3D m3D{*this};

    void setStroke();
    void setFillColor();
    /** Fill or stroke the current CG path according to the paint's style. */
    void paintCurrentPath();
    CGPathRef pathFor(int id) const;

    CGContextRef mCG = nullptr;
    float mWidth = 0, mHeight = 0;

    Paint mPaint;
    std::stack<Paint> mPaintStack;

    std::unordered_map<int, std::string> mTexts;
    std::unordered_map<int, CGMutablePathRef> mPaths;
    std::unordered_map<int, CGImageRef> mImages;
};

} // namespace rcnative
