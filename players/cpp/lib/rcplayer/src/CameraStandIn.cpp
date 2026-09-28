#include "rcplayer/CameraStandIn.h"

#include "include/core/SkCanvas.h"
#include "include/core/SkFont.h"
#include "include/core/SkFontMgr.h"
#include "include/core/SkPaint.h"
#include "include/core/SkRect.h"
#include "include/core/SkTypeface.h"
#include "include/effects/SkDashPathEffect.h"
#if defined(__APPLE__)
#include "include/ports/SkFontMgr_mac_ct.h"
#else
#include "include/ports/SkFontMgr_fontconfig.h"
#include "include/ports/SkFontScanner_FreeType.h"
#endif

#include <algorithm>
#include <string>

namespace rcplayer {

namespace {

// The system UI face, by value: the size travels with it.
SkFont labelFont(float size) {
    static sk_sp<SkFontMgr> mgr =
#if defined(__APPLE__)
        SkFontMgr_New_CoreText(nullptr);
#else
        SkFontMgr_New_FontConfig(nullptr, SkFontScanner_Make_FreeType());
#endif
    static sk_sp<SkTypeface> face = mgr ? mgr->matchFamilyStyle(nullptr, SkFontStyle()) : nullptr;
    SkFont font(face, size);
    font.setEdging(SkFont::Edging::kAntiAlias);
    font.setSubpixel(true);
    return font;
}

void drawCentred(SkCanvas* canvas, const std::string& text, float cx, float baseline,
                 const SkFont& font, SkColor color) {
    const float w = font.measureText(text.c_str(), text.size(), SkTextEncoding::kUTF8);
    SkPaint paint;
    paint.setColor(color);
    paint.setAntiAlias(true);
    canvas->drawSimpleText(text.c_str(), text.size(), SkTextEncoding::kUTF8, cx - w * 0.5f, baseline, font, paint);
}

}  // namespace

void drawCameraStandIn(SkCanvas* canvas, const CameraCustomHost::Config& cfg, float w, float h) {
    if (!canvas || w <= 2 || h <= 2) return;
    const SkRect box = SkRect::MakeWH(w, h);
    SkPaint fill;
    fill.setColor(0xFF101318);
    canvas->drawRect(box, fill);

    // The frame follows the box; a clipped (round) box shows the part of it that is inside,
    // which is what a frame on a round picture looks like anyway.
    SkPaint frame;
    frame.setColor(0x99909AA8);
    frame.setAntiAlias(true);
    frame.setStyle(SkPaint::kStroke_Style);
    frame.setStrokeWidth(std::max(1.0f, std::min(w, h) * 0.006f));
    const SkScalar dash[2] = {std::max(4.0f, w * 0.012f), std::max(3.0f, w * 0.008f)};
    frame.setPathEffect(SkDashPathEffect::Make(SkSpan<const SkScalar>(dash, 2), 0));
    const float inset = std::max(2.0f, std::min(w, h) * 0.03f);
    canvas->drawRect(box.makeInset(inset, inset), frame);

    const float titleSize = std::min(h * 0.13f, w * 0.055f);
    if (titleSize < 7.0f) return;
    drawCentred(canvas, "camera", w * 0.5f, h * 0.5f - titleSize * 0.25f, labelFont(titleSize), 0xCC9AA4B2);
    if (cfg.device != "default") {
        drawCentred(canvas, cfg.device, w * 0.5f, h * 0.5f + titleSize * 1.05f,
                    labelFont(titleSize * 0.78f), 0x99909AA8);
    }
}

}  // namespace rcplayer
