#include "rcplayer/PdfExport.h"

#include "rcplayer/AvfVideoPlayer.h"
#include "rcplayer/MediaTypes.h"
#include "rcplayer/Player.h"
#include "rcplayer/StillHosts.h"

#include "rccore/CoreDocument.h"
#include "rccore/CustomComponentHost.h"
#include "rccore/RemoteContext.h"
#include "rccore/TimeVariables.h"
#include "rccore/WireBuffer.h"
#include "rcskia/SkiaPaintContext.h"

#include "include/codec/SkCodec.h"
#include "include/core/SkBitmap.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkData.h"
#include "include/core/SkDocument.h"
#include "include/core/SkFont.h"
#include "include/core/SkFontMgr.h"
#include "include/core/SkImage.h"
#include "include/core/SkPaint.h"
#include "include/core/SkSamplingOptions.h"
#include "include/core/SkSurface.h"
#include "include/core/SkTypeface.h"
#if defined(__APPLE__)
#include "include/ports/SkFontMgr_mac_ct.h"
#else
#include "include/ports/SkFontMgr_fontconfig.h"
#include "include/ports/SkFontScanner_FreeType.h"
#endif

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

namespace fs = std::filesystem;

namespace rcplayer {

// ── Speaker notes (PDF) ──────────────────────────────────────────────
// Presenter notes for a slide live in a sidecar "<slide>.rc.notes" file (written by refract).
// In the PDF they are laid out BELOW the slide — the page grows taller so the notes never
// overlap the slide content.

SkFont notesFont(float size) {
    static sk_sp<SkFontMgr> mgr =
#if defined(__APPLE__)
        SkFontMgr_New_CoreText(nullptr);
#else
        SkFontMgr_New_FontConfig(nullptr, SkFontScanner_Make_FreeType());
#endif
    static sk_sp<SkTypeface> tf = mgr ? mgr->matchFamilyStyle(nullptr, SkFontStyle())
                                      : nullptr;
    SkFont f(tf, size);
    f.setEdging(SkFont::Edging::kAntiAlias);
    f.setSubpixel(true);
    return f;
}

// Greedy word-wrap `text` (honouring its own newlines) into lines that fit `maxWidth`.
std::vector<std::string> wrapNotes(const std::string& text, const SkFont& font,
                                          float maxWidth) {
    auto measure = [&](const std::string& s) {
        return font.measureText(s.c_str(), s.size(), SkTextEncoding::kUTF8);
    };
    std::vector<std::string> lines;
    std::string paragraph;
    std::stringstream in(text);
    while (std::getline(in, paragraph)) {
        // Trim a trailing '\r' (CRLF files).
        if (!paragraph.empty() && paragraph.back() == '\r') paragraph.pop_back();
        if (paragraph.empty()) { lines.push_back(""); continue; }
        std::stringstream words(paragraph);
        std::string word, line;
        while (words >> word) {
            std::string candidate = line.empty() ? word : line + " " + word;
            if (!line.empty() && measure(candidate) > maxWidth) {
                lines.push_back(line);
                line = word;
            } else {
                line = candidate;
            }
        }
        lines.push_back(line);
    }
    return lines;
}

// Read the sidecar notes for a slide entry ("<entry>.notes"), or "" if none.
std::string readSlideNotes(const std::string& entry) {
    std::ifstream nf(entry + ".notes", std::ios::binary);
    if (!nf) return "";
    std::string s((std::istreambuf_iterator<char>(nf)), std::istreambuf_iterator<char>());
    // Trim trailing whitespace.
    while (!s.empty() && (s.back() == '\n' || s.back() == '\r' || s.back() == ' '))
        s.pop_back();
    return s;
}

// ── PDF export ───────────────────────────────────────────────────────
// Render one "slide" to a PDF page. The file may be an .rc/.rcd document
// (rendered vector via Skia's PDF backend — text, paths, images preserved),
// a video (first frame only), or an animated image (first frame only).
// If a sidecar "<file>.notes" exists, the page grows taller and the notes
// are drawn in a panel below the slide (never overlapping it).
//
// For .rc files: builds a fresh CoreDocument + RemoteContext + SkiaPaintContext
// pointed at the PDF page canvas, runs the data pass up to `delaySec`, then
// paints once. Everything that has a native PDF representation stays vector;
// anything that doesn't (e.g. AGSL shaders) is rasterized by Skia at the
// metadata's fRasterDPI.
bool renderSlideToPdfPage(SkDocument* pdf,
                                 const std::string& entry,
                                 int pageW, int pageH,
                                 double delaySec) {
    auto ext = getExt(entry);

    // ── Animated images: take frame 0 ────────────────────────────────
    if (isCodecVideoExt(ext)) {
        std::vector<uint8_t> bytes;
        if (!readFileBytes(entry, bytes)) return false;
        auto skData = SkData::MakeWithCopy(bytes.data(), bytes.size());
        auto codec = SkCodec::MakeFromData(skData);
        if (!codec) return false;
        SkImageInfo info = codec->getInfo()
            .makeColorType(kN32_SkColorType)
            .makeAlphaType(kPremul_SkAlphaType);
        SkBitmap bmp;
        if (!bmp.tryAllocPixels(info)) return false;
        SkCodec::Options opts;
        opts.fFrameIndex = 0;
        if (codec->getPixels(info, bmp.getPixels(), bmp.rowBytes(), &opts)
                != SkCodec::kSuccess) {
            return false;
        }
        bmp.setImmutable();
        auto img = bmp.asImage();

        SkCanvas* canvas = pdf->beginPage((SkScalar)pageW, (SkScalar)pageH);
        canvas->clear(SK_ColorBLACK);
        // Aspect-fit-centre.
        float sx = (float)pageW / info.width();
        float sy = (float)pageH / info.height();
        float s  = std::min(sx, sy);
        float dw = info.width()  * s;
        float dh = info.height() * s;
        float ox = (pageW - dw) * 0.5f;
        float oy = (pageH - dh) * 0.5f;
        SkRect dst = SkRect::MakeXYWH(ox, oy, dw, dh);
        SkSamplingOptions sampling(SkFilterMode::kLinear, SkMipmapMode::kNone);
        canvas->drawImageRect(img, dst, sampling);
        pdf->endPage();
        return true;
    }

    // ── Real videos: take first frame via AVAssetImageGenerator ──────
    if (isAvfVideoExt(ext)) {
        // AVFoundation needs a real file path; extract from zip if needed.
        std::string filePath = entry;
        std::string tmpPath;
        if (g.zip) {
            tmpPath = "/tmp/rcviewer_pdf_" + baseName(entry);
            if (!g.zip->extractToFile(entry, tmpPath)) return false;
            filePath = tmpPath;
        }
        auto img = AvfVideoPlayer::ExtractFirstFrame(filePath);
        if (!tmpPath.empty()) std::remove(tmpPath.c_str());
        if (!img) return false;

        SkCanvas* canvas = pdf->beginPage((SkScalar)pageW, (SkScalar)pageH);
        canvas->clear(SK_ColorBLACK);
        float sx = (float)pageW / img->width();
        float sy = (float)pageH / img->height();
        float s  = std::min(sx, sy);
        float dw = img->width()  * s;
        float dh = img->height() * s;
        float ox = (pageW - dw) * 0.5f;
        float oy = (pageH - dh) * 0.5f;
        SkRect dst = SkRect::MakeXYWH(ox, oy, dw, dh);
        SkSamplingOptions sampling(SkFilterMode::kLinear, SkMipmapMode::kNone);
        canvas->drawImageRect(img, dst, sampling);
        pdf->endPage();
        return true;
    }

    // ── .rc/.rcd: vector render via Skia PDF backend ─────────────────
    std::vector<uint8_t> bytes;
    if (!readFileBytes(entry, bytes)) return false;
    if (bytes.empty()) return false;

    auto doc = std::make_unique<rccore::CoreDocument>();
    rccore::WireBuffer buffer(bytes.data(), bytes.size());
    if (!doc->initFromBuffer(buffer)) {
        std::cerr << "Parse failed: " << entry << "\n";
        return false;
    }

    // Use the document's natural width/height if available, otherwise the
    // requested page size. Fall back to the requested size for zero-sized docs.
    int docW = doc->getWidth()  > 0 ? doc->getWidth()  : pageW;
    int docH = doc->getHeight() > 0 ? doc->getHeight() : pageH;

    // Presenter notes (sidecar) are laid out in a panel BELOW the slide — measure them first
    // so the page can grow to fit, keeping them off the slide content.
    std::string notes = readSlideNotes(entry);
    const float noteSize   = docH * 0.026f;             // scales with the slide
    const float noteMargin = docW * 0.04f;
    const float noteLineH  = noteSize * 1.42f;
    const float notePad    = noteSize * 1.4f;           // top/bottom padding of the panel
    std::vector<std::string> noteLines;
    float notesH = 0.0f;
    if (!notes.empty()) {
        noteLines = wrapNotes(notes, notesFont(noteSize), (float)docW - 2 * noteMargin);
        notesH = 2 * notePad + noteLines.size() * noteLineH;
    }

    SkCanvas* canvas = pdf->beginPage((SkScalar)docW, (SkScalar)(docH + (int)notesH));
    if (!canvas) return false;

    rccore::RemoteContext ctx;
    rcskia::SkiaPaintContext paintCtx(ctx, canvas);   // paint straight to the PDF page
    ctx.setPaintContext(&paintCtx);
    ctx.setDocument(doc.get());
    ctx.mWidth  = (float)docW;
    ctx.mHeight = (float)docH;
    ctx.loadFloat(rccore::RemoteContext::ID_TOUCH_POS_X, 0.0f);
    ctx.loadFloat(rccore::RemoteContext::ID_TOUCH_POS_Y, 0.0f);

    // Embedded content: rc: sub-documents render for real (pure Skia, so they vectorise into
    // the PDF like the host document) and video: embeds contribute a poster frame. Without
    // this those regions come out blank, as they did before. Shared with the players'
    // off-screen previews — see StillHosts.
    StillHosts stillHosts(fs::path(entry).parent_path().string());
    stillHosts.installOn(ctx);

    doc->registerListeners(ctx);
    doc->applyDataOperations(ctx);

    // Pin the clocks to the resting state and paint the page ONCE.
    //
    // A slide's load animations (transitions, staggered reveals, scroll) are declarative
    // functions of animationTime, so the settled still is fully determined by the final time —
    // no need to rasterise intermediate frames. The old code painted the whole document to a
    // throwaway raster surface every 60fps step up to delaySec (~120 paints/slide); with
    // animated background shaders on a CPU raster surface that was the entire cost of export.
    //
    // We must *override* ANIMATION_TIME, not merely advance a clock: with no paint before the
    // final one, CoreDocument::updateTimeVariables latches its animation-start marker on that
    // single paint and computes animationTime = 0 — freezing every animation (scroll pages
    // wouldn't scroll, transitions wouldn't settle). overrideFloat makes that recompute a
    // no-op, exactly as rc2image pins the clock for deterministic captures.
    int64_t fixedMs = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count()
        + static_cast<int64_t>(delaySec * 1000.0);
    doc->setFixedTimeMs(fixedMs);                                    // deterministic wall clock
    ctx.overrideFloat(rccore::RemoteContext::ID_ANIMATION_TIME,
                      static_cast<float>(delaySec));                 // pin the animation clock at rest

    // Paint the slide into the top region only, clipped so nothing bleeds into the notes.
    canvas->save();
    canvas->clipRect(SkRect::MakeWH((SkScalar)docW, (SkScalar)docH));
    doc->paint(ctx);
    canvas->restore();

    // Notes panel below the slide: a light card with dark, wrapped text.
    if (notesH > 0.0f) {
        SkPaint bg;
        bg.setColor(SkColorSetRGB(0xF6, 0xF6, 0xF4));
        canvas->drawRect(SkRect::MakeXYWH(0, (SkScalar)docH, (SkScalar)docW, notesH), bg);
        // A thin rule separating the slide from its notes.
        SkPaint rule;
        rule.setColor(SkColorSetRGB(0xCF, 0xCF, 0xCF));
        canvas->drawRect(SkRect::MakeXYWH(0, (SkScalar)docH, (SkScalar)docW, 2), rule);

        SkFont f = notesFont(noteSize);
        SkPaint tp;
        tp.setColor(SkColorSetRGB(0x22, 0x22, 0x22));
        tp.setAntiAlias(true);
        float y = (float)docH + notePad + noteSize;     // baseline of the first line
        for (const auto& ln : noteLines) {
            if (!ln.empty())
                canvas->drawString(ln.c_str(), noteMargin, y, f, tp);
            y += noteLineH;
        }
    }

    pdf->endPage();
    return true;
}

}  // namespace rcplayer
