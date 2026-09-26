#include "rcplayer/VideoExport.h"

#include "rcplayer/CpuRenderBackend.h"
#include "rcplayer/MediaTypes.h"
#include "rcplayer/Player.h"
#include "rcplayer/TextFont.h"

#include "rccore/CoreDocument.h"
#include "rccore/RemoteContext.h"

#include "include/core/SkImageInfo.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkFont.h"
#include "include/core/SkPaint.h"
#include "include/core/SkSurface.h"

#include <chrono>
#include <cmath>
#include <cstdio>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

namespace rcplayer {

namespace {

std::string quoted(const std::string& s) {
    std::string out = "'";
    for (char c : s) { if (c == '\'') out += "'\\''"; else out += c; }
    return out + "'";
}

}  // namespace

namespace {

// The caption band under a frame: black, with the cue for `t` centred in it. Text that
// would not fit is set smaller rather than cut, since a caption that ends mid-word is worse
// than a small one.
void paintCaptionBand(SkCanvas* canvas, int width, const VideoCaptionBand& band,
                      const std::vector<VideoCue>& cues, double t) {
    canvas->clear(SK_ColorBLACK);
    const VideoCue* cue = nullptr;
    for (const auto& c : cues) {
        if (t >= c.start && t < c.end) { cue = &c; break; }
    }
    if (!cue) return;
    // The line as words, so the one being spoken can be lit: the last word to have started.
    std::vector<VideoCueWord> words = cue->words;
    if (words.empty() && !cue->text.empty()) words.push_back({cue->start, cue->end, cue->text});
    if (words.empty()) return;
    int current = -1;
    for (size_t i = 0; i < words.size(); i++) if (t >= words[i].start) current = static_cast<int>(i);

    float size = band.textSize > 0.0f ? band.textSize : band.height * 0.42f;
    SkFont font = systemTextFont(size);
    const float maxWidth = width * 0.92f;
    auto lineWidth = [&](const SkFont& f, float* space) {
        *space = f.measureText(" ", 1, SkTextEncoding::kUTF8);
        float total = 0.0f;
        for (size_t i = 0; i < words.size(); i++) {
            total += f.measureText(words[i].text.data(), words[i].text.size(), SkTextEncoding::kUTF8);
            if (i + 1 < words.size()) total += *space;
        }
        return total;
    };
    float space = 0.0f;
    float textWidth = lineWidth(font, &space);
    if (textWidth > maxWidth && textWidth > 0.0f) {
        size *= maxWidth / textWidth;
        font = systemTextFont(size);
        textWidth = lineWidth(font, &space);
    }
    SkPaint paint;
    paint.setAntiAlias(true);
    float x = (width - textWidth) * 0.5f;
    const float y = band.height * 0.5f + size * 0.35f;
    for (size_t i = 0; i < words.size(); i++) {
        const std::string& w = words[i].text;
        const float ww = font.measureText(w.data(), w.size(), SkTextEncoding::kUTF8);
        if (static_cast<int>(i) == current) {
            // Lit the way the presenter lights it: the accent, on a soft box.
            SkPaint box;
            box.setAntiAlias(true);
            box.setColor(0x2E6EA8FF);
            canvas->drawRoundRect(SkRect::MakeXYWH(x - size * 0.12f, y - size * 0.92f, ww + size * 0.24f, size * 1.22f),
                                  size * 0.15f, size * 0.15f, box);
            paint.setColor(0xFF6EA8FF);
        } else {
            paint.setColor(SK_ColorWHITE);
        }
        canvas->drawSimpleText(w.data(), w.size(), SkTextEncoding::kUTF8, x, y, font, paint);
        x += ww + space;
    }
}

// A progress line for whoever is watching (the terminal, and a host reading stderr).
void sayProgress(long done, long total, const std::string& what) {
    std::cerr << "progress: " << done << "/" << total << " " << what << "\n" << std::flush;
}

}  // namespace

VideoExportResult exportDeckToVideo(const std::vector<VideoSlide>& slides,
                                    const std::string& audio, const std::string& output,
                                    int width, int height, double fps,
                                    const std::string& ffmpeg, const VideoCaptionBand& band) {
    VideoExportResult result;
    if (slides.empty() || width <= 0 || height <= 0 || fps <= 0.0) return result;

    // CPU raster: there is no window, and the frames are read back anyway.
    g.backend = std::make_unique<CpuRenderBackend>();
    ensureSurface(width, height);

    // The band is its own little surface, read back under the slide's pixels each frame;
    // an even height keeps yuv420p happy.
    const int bandHeight = band.height > 0 ? band.height + (band.height & 1) : 0;
    sk_sp<SkSurface> bandSurface;
    if (bandHeight > 0) {
        bandSurface = SkSurfaces::Raster(SkImageInfo::Make(width, bandHeight, kRGBA_8888_SkColorType,
                                                           kUnpremul_SkAlphaType));
        if (!bandSurface) {
            std::cerr << "video: cannot make the caption band\n";
            return result;
        }
    }
    const int outHeight = height + bandHeight;

    char size[64];
    std::snprintf(size, sizeof(size), "%dx%d", width, outHeight);
    char rate[32];
    std::snprintf(rate, sizeof(rate), "%.3f", fps);
    std::string cmd = ffmpeg + " -y -loglevel error -f rawvideo -pix_fmt rgba -s " + size
                      + " -r " + rate + " -i -";
    if (!audio.empty()) cmd += " -i " + quoted(audio);
    cmd += " -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -movflags +faststart";
    if (!audio.empty()) cmd += " -c:a aac -b:a 192k -shortest";
    cmd += " " + quoted(output);

    FILE* pipe = ::popen(cmd.c_str(), "w");
    if (!pipe) {
        std::cerr << "video: cannot start " << ffmpeg << "\n";
        return result;
    }

    const double dt = 1.0 / fps;
    const SkImageInfo info = SkImageInfo::Make(width, height, kRGBA_8888_SkColorType,
                                               kUnpremul_SkAlphaType);
    const SkImageInfo bandInfo = SkImageInfo::Make(width, bandHeight, kRGBA_8888_SkColorType,
                                                   kUnpremul_SkAlphaType);
    std::vector<uint8_t> pixels(static_cast<size_t>(width) * outHeight * 4);
    const size_t slideBytes = static_cast<size_t>(width) * height * 4;
    bool failed = false;
    long totalFrames = 0;
    for (const VideoSlide& slide : slides) totalFrames += std::lround(slide.duration * fps);
    const long sayEvery = std::max(1L, std::lround(fps / 2.0));   // twice a second of movie

    for (size_t k = 0; k < slides.size() && !failed; k++) {
        const VideoSlide& slide = slides[k];
        if (!loadFile(slide.entry)) {
            std::cerr << "video: cannot load " << slide.entry << "\n";
            failed = true;
            break;
        }
        // The document's clocks are measured from the moment it loaded, so the wall time it
        // is shown follows the frames from that moment: an export can run faster or slower
        // than real time and the picture must not know.
        const int64_t wallBase = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::system_clock::now().time_since_epoch()).count();
        const long frames = std::lround(slide.duration * fps);
        std::cout << "[" << (k + 1) << "/" << slides.size() << "] " << baseName(slide.entry)
                  << "  " << frames << " frames\n";
        const std::string what = "slide " + std::to_string(k + 1) + "/" + std::to_string(slides.size())
                                 + " " + baseName(slide.entry);
        for (long f = 0; f < frames; f++) {
            if (f % sayEvery == 0) sayProgress(result.frames, totalFrames, what);
            const double t = f * dt;
            g.animTime = t;
            if (g.doc) g.doc->setFixedTimeMs(wallBase + static_cast<int64_t>(t * 1000.0));
            renderFrame(dt);
            SkSurface* surface = g.backend ? g.backend->surface() : nullptr;
            if (!surface || !surface->readPixels(info, pixels.data(), width * 4, 0, 0)) {
                std::cerr << "video: frame readback failed\n";
                failed = true;
                break;
            }
            if (bandSurface) {
                paintCaptionBand(bandSurface->getCanvas(), width, band, slide.cues, t);
                if (!bandSurface->readPixels(bandInfo, pixels.data() + slideBytes, width * 4, 0, 0)) {
                    std::cerr << "video: caption band readback failed\n";
                    failed = true;
                    break;
                }
            }
            if (std::fwrite(pixels.data(), 1, pixels.size(), pipe) != pixels.size()) {
                std::cerr << "video: " << ffmpeg << " stopped taking frames\n";
                failed = true;
                break;
            }
            result.frames++;
        }
        result.slides++;
    }

    if (!failed) sayProgress(totalFrames, totalFrames, "finishing the file");
    const int rc = ::pclose(pipe);
    g.zip.reset();
    result.ok = !failed && rc == 0;
    if (result.ok) sayProgress(totalFrames, totalFrames, "done");
    if (result.ok) {
        std::cerr << "Done: " << result.frames << " frames, " << result.slides
                  << " slides, written to " << output << "\n";
    } else {
        std::cerr << "video export failed (" << ffmpeg << " exit " << rc << ")\n";
    }
    return result;
}

}  // namespace rcplayer
