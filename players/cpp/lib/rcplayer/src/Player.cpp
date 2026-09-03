#include "rcplayer/Player.h"

#include "rcplayer/MediaTypes.h"

#include "rccore/WireBuffer.h"

#include "include/core/SkImageInfo.h"
#include "include/core/SkStream.h"
#include "include/core/SkSurface.h"
#include "include/encode/SkPngEncoder.h"

#include <csignal>
#include <sys/wait.h>
#include <unistd.h>

#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <iostream>

namespace fs = std::filesystem;

namespace rcplayer {

ViewerState g;

void attachWindow(GLFWwindow* window) {
    g.window = window;
    g.webHost.setWindow(window);
}

// ── File management ──────────────────────────────────────────────────

std::vector<std::string> collectRcFiles(const std::string& path) {
    std::vector<std::string> result;
    fs::path p(path);

    if (fs::is_regular_file(p)) {
        fs::path dir = p.parent_path();
        if (dir.empty()) dir = fs::current_path();
        for (auto& entry : fs::directory_iterator(dir)) {
            auto ext = entry.path().extension().string();
            if (isPlayableExt(ext)) {
                result.push_back(entry.path().string());
            }
        }
        std::sort(result.begin(), result.end());

        auto it = std::find(result.begin(), result.end(), fs::canonical(p).string());
        if (it == result.end()) {
            for (size_t i = 0; i < result.size(); i++) {
                if (fs::path(result[i]).filename() == p.filename()) {
                    g.currentIndex = static_cast<int>(i);
                    break;
                }
            }
        } else {
            g.currentIndex = static_cast<int>(it - result.begin());
        }
    } else if (fs::is_directory(p)) {
        for (auto& entry : fs::directory_iterator(p)) {
            auto ext = entry.path().extension().string();
            if (isPlayableExt(ext)) {
                result.push_back(entry.path().string());
            }
        }
        std::sort(result.begin(), result.end());
    }
    return result;
}

// Collect playable entries from a zip archive.
std::vector<std::string> collectZipFiles(ZipArchive& zip) {
    std::vector<std::string> result;
    for (const auto& entry : zip.entries()) {
        auto ext = getExt(entry);
        if (isPlayableExt(ext)) {
            result.push_back(entry);
        }
    }
    // Already sorted by ZipArchive.
    return result;
}

// Remove any temp file left by the previous load (used for AVF video extraction).
void cleanupTempFile() {
    if (!g.zipTempFile.empty()) {
        std::remove(g.zipTempFile.c_str());
        g.zipTempFile.clear();
    }
}

void initDocument() {
    if (!g.doc || !g.backend) return;

    // Create a small temporary raster canvas for the init/data pass.
    // The real backend canvas is set before each paint frame via setCanvas().
    static sk_sp<SkSurface> initSurface;
    if (!initSurface) {
        initSurface = SkSurfaces::Raster(SkImageInfo::MakeN32Premul(1, 1));
    }
    SkCanvas* canvas = initSurface->getCanvas();

    g.context = std::make_unique<rccore::RemoteContext>();
    g.paintCtx = std::make_unique<rcskia::SkiaPaintContext>(*g.context, canvas);
    g.context->setPaintContext(g.paintCtx.get());
    g.context->setDocument(g.doc.get());
    g.customRouter.video = &g.videoHost;
    g.customRouter.web = &g.webHost;
    g.customRouter.rcdoc = &g.rcDocHost;
    g.context->setCustomHost(&g.customRouter);   // video + embedded-web + embedded-rc custom components
    g.context->mDebug = g.debug;

    g.context->mWidth = static_cast<float>(g.width);
    g.context->mHeight = static_cast<float>(g.height);

    g.doc->registerListeners(*g.context);
    g.doc->applyDataOperations(*g.context);

    g.timeVars = rccore::TimeVariables();
    g.animTime = 0.0;
    g.needsRedraw = true;
}

// Read bytes for a file — from zip archive or filesystem.
bool readFileBytes(const std::string& name, std::vector<uint8_t>& out) {
    if (g.zip) {
        return g.zip->read(name, out);
    }
    std::ifstream ifs(name, std::ios::binary);
    if (!ifs) {
        std::cerr << "Cannot open: " << name << "\n";
        return false;
    }
    out.assign((std::istreambuf_iterator<char>(ifs)),
                std::istreambuf_iterator<char>());
    return !out.empty();
}

bool loadFile(const std::string& path) {
    // Drop any state left over from the previous file so we start clean. Embedded web
    // views persist across slides (hidden when off-slide via the frame bracket); only
    // the per-slide videos are released here.
    g.videoHost.reset();
    g.rcDocHost.reset();
    if (!g.zip) {
        g.videoHost.setBaseDir(fs::path(path).parent_path().string());
        g.rcDocHost.setBaseDir(fs::path(path).parent_path().string());
    }
    g.webpPlayer.reset();
    g.avfPlayer.reset();
    g.doc.reset();
    g.context.reset();
    g.paintCtx.reset();
    cleanupTempFile();

    auto ext = getExt(path);

    if (isCodecVideoExt(ext)) {
        if (g.zip) {
            // Load animated image from zip data in memory.
            std::vector<uint8_t> data;
            if (!g.zip->read(path, data)) {
                std::cerr << "Zip extract failed: " << path << "\n";
                return false;
            }
            auto player = WebpPlayer::LoadFromData(data);
            if (!player) {
                std::cerr << "WebP/GIF/APNG decode failed (zip): " << path << "\n";
                return false;
            }
            g.webpPlayer = std::move(player);
        } else {
            auto player = WebpPlayer::Load(path);
            if (!player) {
                std::cerr << "WebP/GIF/APNG decode failed: " << path << "\n";
                return false;
            }
            g.webpPlayer = std::move(player);
        }
        g.webpStartSec = g.animTime;
        g.needsRedraw = true;
        return true;
    }

    if (isAvfVideoExt(ext)) {
        std::string filePath = path;
        if (g.zip) {
            // AVFoundation needs a real file — extract to temp.
            std::string tmpPath = "/tmp/rcviewer_avf_" + baseName(path);
            if (!g.zip->extractToFile(path, tmpPath)) {
                std::cerr << "Zip extract to temp failed: " << path << "\n";
                return false;
            }
            g.zipTempFile = tmpPath;
            filePath = tmpPath;
        }
        auto player = AvfVideoPlayer::Open(filePath);
        if (!player) {
            std::cerr << "MP4 open failed: " << path << "\n";
            return false;
        }
        if (g.paused) player->setPaused(true);
        g.avfPlayer = std::move(player);
        g.needsRedraw = true;
        return true;
    }

    // RC document — load bytes from zip or filesystem.
    if (!readFileBytes(path, g.fileData)) return false;
    if (g.fileData.empty()) return false;

    g.doc = std::make_unique<rccore::CoreDocument>();
    rccore::WireBuffer buffer(g.fileData.data(), g.fileData.size());
    if (!g.doc->initFromBuffer(buffer)) {
        std::cerr << "Parse failed: " << path << "\n";
        g.doc.reset();
        return false;
    }

    initDocument();
    return true;
}

void stopVoiceOver() {
    if (g.audioPid > 0) {
        ::kill(g.audioPid, SIGTERM);
        int status = 0;
        ::waitpid(g.audioPid, &status, 0);
        g.audioPid = 0;
    }
}

fs::path resolveVoicePath(const std::string& slidePath) {
    fs::path p(slidePath);
    fs::path voiceDir = !g.voiceDirOverride.empty()
                            ? g.voiceDirOverride
                            : p.parent_path() / "voice";
    if (!fs::is_directory(voiceDir)) {
        std::cerr << "voice: dir not found: " << voiceDir.string() << "\n";
        return {};
    }
    std::string fname = p.filename().string();
    std::string stem;
    for (char c : fname) {
        if (std::isdigit(static_cast<unsigned char>(c))) stem += c;
        else break;
    }
    if (stem.empty()) {
        std::cerr << "voice: no leading digits in " << fname << "\n";
        return {};
    }
    fs::path wav = voiceDir / (stem + ".wav");
    if (fs::exists(wav)) {
        std::cerr << "voice: " << wav.string() << "\n";
        return wav;
    }
    std::cerr << "voice: missing " << wav.string() << "\n";
    return {};
}

void playVoiceOver(const fs::path& wav) {
    stopVoiceOver();
    if (wav.empty()) return;
    pid_t pid = ::fork();
    if (pid < 0) return;
    if (pid == 0) {
        ::setpgid(0, 0);
        ::execlp("afplay", "afplay", wav.c_str(), (char*)nullptr);
        ::_exit(127);
    }
    g.audioPid = pid;
}

void loadCurrentFile() {
    if (g.files.empty()) return;
    g.currentIndex = ((g.currentIndex % (int)g.files.size()) + (int)g.files.size()) % (int)g.files.size();
    const auto& path = g.files[g.currentIndex];
    std::string name = g.zip ? baseName(path) : fs::path(path).filename().string();

    if (loadFile(path)) {
        std::cerr << "[" << (g.currentIndex + 1) << "/" << g.files.size()
                  << "] " << name << "\n";
        playVoiceOver(resolveVoicePath(path));
    } else {
        std::cerr << "[" << (g.currentIndex + 1) << "/" << g.files.size()
                  << "] FAILED: " << name << "\n";
        stopVoiceOver();
    }
}

FitTransform docFit() {
    FitTransform t{1.0f, 0.0f, 0.0f, static_cast<float>(g.width), static_cast<float>(g.height)};
    if (!g.doc) return t;
    float dw = static_cast<float>(g.doc->getWidth());
    float dh = static_cast<float>(g.doc->getHeight());
    if (dw <= 0.0f || dh <= 0.0f) return t;                 // no design size → 1:1
    t.docW = dw;
    t.docH = dh;
    t.scale = std::min(static_cast<float>(g.width) / dw, static_cast<float>(g.height) / dh);
    t.ox = (static_cast<float>(g.width) - dw * t.scale) * 0.5f;
    t.oy = (static_cast<float>(g.height) - dh * t.scale) * 0.5f;
    return t;
}

// ── Touch coordinate mapping ─────────────────────────────────────────
// Convert window (screen) coordinates to document coordinates, undoing the fit.
float touchX(float windowX) {
    FitTransform t = docFit();
    return (windowX - t.ox) / t.scale;
}
float touchY(float windowY) {
    FitTransform t = docFit();
    return (windowY - t.oy) / t.scale;
}

// ── Rendering ────────────────────────────────────────────────────────

void ensureSurface(int w, int h) {
    if (g.width == w && g.height == h && g.backend->surface()) return;
    g.width = w;
    g.height = h;
    g.backend->resize(w, h);

    if (g.paintCtx && g.backend->canvas()) {
        g.paintCtx->setCanvas(g.backend->canvas());
    }
    if (g.context) {
        g.context->mWidth = static_cast<float>(w);
        g.context->mHeight = static_cast<float>(h);
    }
}

void renderFrame(double deltaTime) {
    if (!g.backend) return;
    SkCanvas* canvas = g.backend->canvas();
    if (!canvas) return;
    canvas->clear(g.widgetMode ? SK_ColorTRANSPARENT : SK_ColorBLACK);

    if (g.webpPlayer) {
        // Animated image / video loop. Animation time advances regardless of
        // pause state via g.animTime; offset by webpStartSec so each clip
        // begins at frame 0 when first loaded.
        double t = g.animTime - g.webpStartSec;
        if (t < 0) t = 0;
        g.webpPlayer->paint(canvas, t, g.width, g.height);
        return;
    }

    if (g.avfPlayer) {
        // AVPlayer drives its own clock; we just pull whatever frame is due.
        g.avfPlayer->paint(canvas, g.width, g.height);
        return;
    }

    if (!g.doc || !g.context || !g.paintCtx) return;

    g.paintCtx->setCanvas(canvas);
    g.context->mDebug = g.debug;

    // Lay out at the document's design size and scale-to-fit the window.
    FitTransform t = docFit();
    g.context->mWidth = t.docW;
    g.context->mHeight = t.docH;
    g.context->loadFloat(rccore::RemoteContext::ID_TOUCH_POS_X, touchX(g.mouseX));
    g.context->loadFloat(rccore::RemoteContext::ID_TOUCH_POS_Y, touchY(g.mouseY));

    g.timeVars.updateTime(*g.context, g.animTime, deltaTime);
    canvas->save();
    canvas->translate(t.ox, t.oy);
    canvas->scale(t.scale, t.scale);
    // Bracket the paint so the web host can place/hide its native views by whether the
    // corresponding custom component was drawn this frame.
    g.webHost.beginFrame();
    g.doc->paint(*g.context);
    g.webHost.endFrame();
    canvas->restore();
}

// ── Screenshot helper ────────────────────────────────────────────────

bool saveScreenshot(const std::string& outPath) {
    SkSurface* surf = g.backend ? g.backend->surface() : nullptr;
    if (!surf) return false;
    auto image = surf->makeImageSnapshot();
    if (!image) return false;
    auto data = SkPngEncoder::Encode(nullptr, image.get(), {});
    if (!data) return false;
    SkFILEWStream stream(outPath.c_str());
    if (!stream.isValid()) return false;
    stream.write(data->data(), data->size());
    return true;
}

}  // namespace rcplayer
