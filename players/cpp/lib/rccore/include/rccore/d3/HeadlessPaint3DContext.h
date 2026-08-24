#pragma once
/*
 * A PaintContext that implements only the 3D surface; every 2D call is a no-op.
 *
 * Operations reach the renderer through RemoteContext -> PaintContext -> asPaint3D(), so any
 * headless harness that wants to drive real 3D operations needs a PaintContext even though it
 * has no 2D surface to speak of. Both tools/rc3d (whole documents) and tools/d3scene (scene
 * scripts, for the parity harness) need the same thing, so it lives here rather than being
 * copied into each of them.
 *
 * This is a harness facility, not a player: the 2D calls are inert on purpose.
 */
#include "rccore/PaintBundle.h"
#include "rccore/PaintContext.h"
#include "rccore/RemoteContext.h"
#include "rccore/d3/SoftwarePaint3DContext.h"

#include <cstdint>
#include <string>
#include <vector>

namespace rccore {
namespace d3 {

class HeadlessPaint3DContext : public PaintContext, public Paint3D {
public:
    HeadlessPaint3DContext(RemoteContext& ctx, int w, int h) : PaintContext(ctx) {
        m3d.setSize(w, h);
    }

    Paint3D* asPaint3D() override { return this; }
    SoftwarePaint3DContext& engine() { return m3d; }

    // ---- Paint3D ----
    void defineMesh3D(int id, const std::vector<int32_t>& i, const std::vector<float>& v,
                      const std::vector<float>& n, const std::vector<float>& uv) override {
        m3d.defineMesh3D(id, i, v, n, uv);
    }
    void setCamera3D(int p, const std::vector<float>& pp,
                     const std::vector<float>& vp) override { m3d.setCamera3D(p, pp, vp); }
    void matrix3Op(int sub, const std::vector<float>& a) override { m3d.matrix3Op(sub, a); }
    void drawMesh3D(int meshId, int mode) override {
        m3d.setBaseColorArgb(mColorArgb);
        m3d.drawMesh3D(meshId, mode);
    }
    void clearDepth3D() override { m3d.clearDepth3D(); }
    void setLights3D(const std::vector<int>& t, const std::vector<int32_t>& c,
                     const std::vector<float>& p) override { m3d.setLights3D(t, c, p); }
    void setTexture3D(int) override {}
    void setMaterial3D(float s, float sh) override { m3d.setMaterial3D(s, sh); }
    void setDepthBias3D(float c, float s) override { m3d.setDepthBias3D(c, s); }

    // ---- PaintContext: 2D surface, deliberately inert ----
    void drawRect(float, float, float, float) override {}
    void drawCircle(float, float, float) override {}
    void drawLine(float, float, float, float) override {}
    void drawOval(float, float, float, float) override {}
    void drawArc(float, float, float, float, float, float) override {}
    void drawRoundRect(float, float, float, float, float, float) override {}
    void drawSector(float, float, float, float, float, float) override {}
    void drawPath(int, float, float) override {}
    void drawTweenPath(int, int, float, float, float) override {}
    void tweenPath(int, int, int, float) override {}
    void drawBitmap(int, float, float, float, float) override {}
    void drawBitmapInt(int, int, int, int, int, int, int, int, int, int) override {}
    void drawTextRun(int, int, int, int, int, float, float, bool) override {}
    void drawTextAnchored(int, float, float, float, float, int) override {}
    void drawTextOnPath(int, int, float, float) override {}
    void savePaint() override {}
    void restorePaint() override {}
    void matrixSave() override {}
    void matrixRestore() override {}
    void matrixScale(float, float, float, float) override {}
    void matrixTranslate(float, float) override {}
    void matrixRotate(float, float, float) override {}
    void matrixSkew(float, float) override {}
    void clipRect(float, float, float, float) override {}
    void clipPath(int, int) override {}
    void roundedClipRect(float, float, float, float, float, float) override {}
    void loadText(int, const std::string&) override {}
    std::string getText(int) override { return {}; }
    void loadBitmap(int, int, int, const std::vector<uint8_t>&) override {}
    void loadPathData(int, int, const std::vector<float>&) override {}
    void appendPathData(int, const std::vector<float>&) override {}
    void reset() override {}

    /**
     * The only 2D state this harness needs: drawMesh3D shades with the current paint colour.
     *
     * PaintBundle is a delta list whose entries have per-tag argument counts, so it cannot be
     * walked without decoding every tag. This reads the colour when it is the leading command —
     * which is how the converter emits `{"paint": {"ops": [{"color": ...}]}}` — and otherwise
     * leaves the previous colour standing. That is enough for a 3D parity harness and it does
     * not pretend to be a paint implementation; the real one lives in rcskia.
     */
    void applyPaint(const PaintBundle& bundle) override {
        const std::vector<int32_t>& a = bundle.getData();
        if (a.empty()) return;
        int tag = a[0] & 0xFFFF;
        if ((tag == PaintBundle::COLOR || tag == PaintBundle::COLOR_ID) && a.size() >= 2) {
            mColorArgb = a[1];
        }
    }

    int32_t mColorArgb = (int32_t) 0xFFFFFFFF;

private:
    SoftwarePaint3DContext m3d;
};

} // namespace d3
} // namespace rccore
