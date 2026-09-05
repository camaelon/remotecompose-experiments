#include "rcplayer/StillHosts.h"

#include "rcplayer/AvfVideoPlayer.h"
#include "rcplayer/Player.h"

#include "rccore/CustomComponentHost.h"
#include "rccore/RemoteContext.h"
#include "rcskia/RcDocumentHost.h"
#include "rcskia/SkiaPaintContext.h"

#include "include/core/SkCanvas.h"
#include "include/core/SkFont.h"
#include "include/core/SkFontMgr.h"
#include "include/core/SkImage.h"
#include "include/core/SkPaint.h"
#include "include/core/SkRRect.h"
#include "include/core/SkRect.h"
#include "include/core/SkSamplingOptions.h"
#include "include/core/SkTypeface.h"
#include "include/effects/SkDashPathEffect.h"
#if defined(__APPLE__)
#include "include/ports/SkFontMgr_mac_ct.h"
#else
#include "include/ports/SkFontMgr_fontconfig.h"
#include "include/ports/SkFontScanner_FreeType.h"
#endif

#include <algorithm>
#include <cstdio>
#include <filesystem>
#include <map>

namespace fs = std::filesystem;

namespace rcplayer {

namespace {

// Draws an embedded video (config "video:media/<clip>.mp4") as its first frame. The live
// VideoCustomHost drives an AVFoundation player (async playback), which produces nothing in
// a one-shot paint; here the first frame is extracted synchronously so an embedded clip
// shows a poster frame instead of a blank box. Frames are cached by path, so a clip reused
// across slides is decoded once.
struct VideoFrameHost : rccore::CustomComponentHost {
    std::string baseDir;
    std::map<std::string, sk_sp<SkImage>> frames;

    bool drawCustom(int, const std::string& config, rccore::PaintContext* pc,
                    float w, float h, double) override {
        if (w <= 0 || h <= 0) return false;
        std::string rest = config;
        auto colon = config.find(':');
        if (colon != std::string::npos && config.compare(0, colon, "video") == 0)
            rest = config.substr(colon + 1);
        // Split "<path>#crop=l,t,r,b".
        float crop[4] = {0.0f, 0.0f, 1.0f, 1.0f};
        std::string path = rest;
        auto hash = rest.find('#');
        if (hash != std::string::npos) {
            path = rest.substr(0, hash);
            auto cpos = rest.find("crop=", hash);
            if (cpos != std::string::npos) {
                float t[4];
                if (std::sscanf(rest.c_str() + cpos + 5, "%f,%f,%f,%f",
                                &t[0], &t[1], &t[2], &t[3]) == 4)
                    for (int i = 0; i < 4; i++) crop[i] = t[i];
            }
        }
        if (path.empty()) return false;
        fs::path p(path);
        if (p.is_relative() && !baseDir.empty()) p = fs::path(baseDir) / p;

        auto key = p.string();
        auto it = frames.find(key);
        if (it == frames.end())
            it = frames.emplace(key, AvfVideoPlayer::ExtractFirstFrame(key)).first;
        sk_sp<SkImage> img = it->second;
        if (!img) return false;

        auto* skpc = static_cast<rcskia::SkiaPaintContext*>(pc);
        if (!skpc || !skpc->canvas()) return false;
        SkCanvas* canvas = skpc->canvas();

        // Cropped source rect, aspect-fit into the component box (0,0)..(w,h) — matching how
        // the live video host frames it.
        float iw = (float)img->width(), ih = (float)img->height();
        SkRect src = SkRect::MakeLTRB(crop[0] * iw, crop[1] * ih, crop[2] * iw, crop[3] * ih);
        float sw = src.width(), sh = src.height();
        if (sw <= 0 || sh <= 0) { src = SkRect::MakeWH(iw, ih); sw = iw; sh = ih; }
        float s = std::min(w / sw, h / sh);
        float dw = sw * s, dh = sh * s;
        SkRect dst = SkRect::MakeXYWH((w - dw) * 0.5f, (h - dh) * 0.5f, dw, dh);
        SkSamplingOptions sampling(SkFilterMode::kLinear, SkMipmapMode::kNone);
        canvas->drawImageRect(img, src, dst, sampling, nullptr,
                              SkCanvas::kFast_SrcRectConstraint);
        return true;
    }
};

// Draws a marked-out frame where an embedded web page will be.
//
// A web embed is a native WKWebView placed over the window, and nothing can paint one into
// an off-screen surface — so without this a still shows an empty hole exactly where the
// live demo goes. That is the one preview a presenter most needs to be able to read: "the
// next slide is the spec browser" is useful, a blank rectangle is not. So the region is
// drawn as a dashed frame labelled with where the page comes from.
struct WebPlaceholderHost : rccore::CustomComponentHost {
    // The system UI face, for the label. The typeface is resolved once and shared (SkTypeface
    // is immutable and atomically refcounted); the font is returned *by value*, because it
    // carries the size and the previous version of this handed out a reference to a static it
    // then reassigned on the next call.
    static SkFont labelFont(float size) {
        static sk_sp<SkFontMgr> mgr =
#if defined(__APPLE__)
            SkFontMgr_New_CoreText(nullptr);
#else
            SkFontMgr_New_FontConfig(nullptr, SkFontScanner_Make_FreeType());
#endif
        static sk_sp<SkTypeface> face =
            mgr ? mgr->matchFamilyStyle(nullptr, SkFontStyle()) : nullptr;
        SkFont font(face, size);
        font.setEdging(SkFont::Edging::kAntiAlias);
        font.setSubpixel(true);
        return font;
    }

    // What to call the page: the host for an http(s) URL, the file name for a file:// one —
    // except that a local page is nearly always ".../<the interesting name>/index.html", so
    // an index page is named by its folder instead. "index.html" identifies nothing.
    static std::string label(const std::string& url) {
        auto scheme = url.find("://");
        if (scheme == std::string::npos) return url;
        std::string rest = url.substr(scheme + 3);
        if (url.compare(0, 4, "file") != 0) {
            auto slash = rest.find('/');
            return slash == std::string::npos ? rest : rest.substr(0, slash);
        }
        while (!rest.empty() && rest.back() == '/') rest.pop_back();
        auto slash = rest.rfind('/');
        std::string file = slash == std::string::npos ? rest : rest.substr(slash + 1);
        if (file.rfind("index.", 0) == 0 && slash != std::string::npos) {
            std::string parent = rest.substr(0, slash);
            auto up = parent.rfind('/');
            std::string dir = up == std::string::npos ? parent : parent.substr(up + 1);
            if (!dir.empty()) return dir;
        }
        return file;
    }

    static void drawCentred(SkCanvas* canvas, const std::string& text, float cx, float baseline,
                            const SkFont& font, SkColor color, float maxWidth) {
        std::string s = text;
        // Truncate with "..." rather than an ellipsis character: this draws through one
        // typeface with no fallback, and a glyph it lacks comes out as tofu.
        if (font.measureText(s.c_str(), s.size(), SkTextEncoding::kUTF8) > maxWidth) {
            while (!s.empty() &&
                   font.measureText((s + "...").c_str(), s.size() + 3,
                                    SkTextEncoding::kUTF8) > maxWidth) {
                do { s.pop_back(); } while (!s.empty() && (s.back() & 0xC0) == 0x80);
            }
            s += "...";
        }
        float w = font.measureText(s.c_str(), s.size(), SkTextEncoding::kUTF8);
        SkPaint paint;
        paint.setColor(color);
        paint.setAntiAlias(true);
        canvas->drawSimpleText(s.c_str(), s.size(), SkTextEncoding::kUTF8,
                               cx - w * 0.5f, baseline, font, paint);
    }

    bool drawCustom(int, const std::string& config, rccore::PaintContext* pc,
                    float w, float h, double) override {
        if (w <= 2 || h <= 2) return false;
        auto colon = config.find(':');
        if (colon == std::string::npos || config.compare(0, colon, "web") != 0) return false;
        const std::string url = config.substr(colon + 1);

        auto* skpc = static_cast<rcskia::SkiaPaintContext*>(pc);
        if (!skpc || !skpc->canvas()) return false;
        SkCanvas* canvas = skpc->canvas();

        const SkRect box = SkRect::MakeWH(w, h);
        const float radius = std::min(12.0f, std::min(w, h) * 0.06f);

        // A neutral grey reads on a dark slide and on a light one; the deck's own colours
        // are not knowable from here.
        SkPaint fill;
        fill.setColor(0x22808080);
        fill.setAntiAlias(true);
        canvas->drawRRect(SkRRect::MakeRectXY(box.makeInset(1, 1), radius, radius), fill);

        SkPaint frame;
        frame.setColor(0x99909AA8);
        frame.setAntiAlias(true);
        frame.setStyle(SkPaint::kStroke_Style);
        frame.setStrokeWidth(std::max(1.0f, std::min(w, h) * 0.006f));
        const SkScalar dash[2] = {std::max(4.0f, w * 0.012f), std::max(3.0f, w * 0.008f)};
        frame.setPathEffect(SkDashPathEffect::Make(SkSpan<const SkScalar>(dash, 2), 0));
        canvas->drawRRect(SkRRect::MakeRectXY(box.makeInset(1, 1), radius, radius), frame);

        // Caption, then the source. Skipped when the box is too small to hold them.
        const float titleSize = std::min(h * 0.13f, w * 0.055f);
        if (titleSize >= 7.0f) {
            const float maxWidth = w * 0.86f;
            SkFont title = labelFont(titleSize);
            drawCentred(canvas, "web page", w * 0.5f, h * 0.5f - titleSize * 0.25f,
                        title, 0xCC9AA4B2, maxWidth);
            SkFont sub = labelFont(titleSize * 0.78f);
            drawCentred(canvas, label(url), w * 0.5f, h * 0.5f + titleSize * 1.05f,
                        sub, 0x99909AA8, maxWidth);
        }
        return true;
    }
};

}  // namespace

struct StillHosts::Impl {
    rcskia::RcDocumentHost rcHost;
    VideoFrameHost videoHost;
    WebPlaceholderHost webHost;
    CustomHostRouter router;
};

StillHosts::StillHosts(const std::string& baseDir) : mImpl(std::make_unique<Impl>()) {
    mImpl->rcHost.setBaseDir(baseDir);
    mImpl->videoHost.baseDir = baseDir;
    mImpl->router.rcdoc = &mImpl->rcHost;
    mImpl->router.video = &mImpl->videoHost;
    mImpl->router.web = &mImpl->webHost;   // a marked frame; a real view needs a window
}

StillHosts::~StillHosts() = default;

void StillHosts::installOn(rccore::RemoteContext& ctx) {
    ctx.setCustomHost(&mImpl->router);
}

}  // namespace rcplayer
