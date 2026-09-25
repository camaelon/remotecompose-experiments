#include "rcplayer/VideoExport.h"

#include "rcplayer/CpuRenderBackend.h"
#include "rcplayer/MediaTypes.h"
#include "rcplayer/Player.h"

#include "rccore/CoreDocument.h"
#include "rccore/RemoteContext.h"

#include "include/core/SkImageInfo.h"
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

VideoExportResult exportDeckToVideo(const std::vector<VideoSlide>& slides,
                                    const std::string& audio, const std::string& output,
                                    int width, int height, double fps,
                                    const std::string& ffmpeg) {
    VideoExportResult result;
    if (slides.empty() || width <= 0 || height <= 0 || fps <= 0.0) return result;

    // CPU raster: there is no window, and the frames are read back anyway.
    g.backend = std::make_unique<CpuRenderBackend>();
    ensureSurface(width, height);

    char size[64];
    std::snprintf(size, sizeof(size), "%dx%d", width, height);
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
    std::vector<uint8_t> pixels(static_cast<size_t>(width) * height * 4);
    bool failed = false;

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
        for (long f = 0; f < frames; f++) {
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
            if (std::fwrite(pixels.data(), 1, pixels.size(), pipe) != pixels.size()) {
                std::cerr << "video: " << ffmpeg << " stopped taking frames\n";
                failed = true;
                break;
            }
            result.frames++;
        }
        result.slides++;
    }

    const int rc = ::pclose(pipe);
    g.zip.reset();
    result.ok = !failed && rc == 0;
    if (result.ok) {
        std::cerr << "Done: " << result.frames << " frames, " << result.slides
                  << " slides, written to " << output << "\n";
    } else {
        std::cerr << "video export failed (" << ffmpeg << " exit " << rc << ")\n";
    }
    return result;
}

}  // namespace rcplayer
