// RemoteCompose Interactive Viewer
// Renders .rc files with animation, mouse interaction, and file cycling.
//
// Controls:
//   Left/Right  - Previous/Next file in directory
//   Space       - Pause/Resume animation
//   R           - Reload current file
//   D           - Toggle visual debug
//   Q/Escape    - Quit
//
// Flags:
//   --metal         - Use Metal GPU backend (default)
//   --cpu           - Use CPU software backend
//   --widget [x,y]  - Desktop widget mode (borderless, on desktop layer)
//   --interactive   - Enable mouse interaction in widget mode
//   --auto <sec>    - Auto-advance to next file every N seconds

#define GL_SILENCE_DEPRECATION
#include <GLFW/glfw3.h>

#include "RenderBackend.h"
#include "CpuRenderBackend.h"
#include "MetalRenderBackend.h"
#include "WidgetHelper.h"

#include "rccore/WireBuffer.h"
#include "rccore/CoreDocument.h"
#include "rccore/RemoteContext.h"
#include "rccore/TimeVariables.h"
#include "rcskia/SkiaPaintContext.h"
#include "AvfVideoPlayer.h"
#include "ZipArchive.h"

#include "include/core/SkSurface.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkData.h"
#include "include/core/SkPixmap.h"
#include "include/core/SkBitmap.h"
#include "include/core/SkImage.h"
#include "include/core/SkSamplingOptions.h"
#include "include/codec/SkCodec.h"
#include "include/encode/SkPngEncoder.h"
#include "include/core/SkStream.h"
#include "include/core/SkDocument.h"
#include "include/docs/SkPDFDocument.h"
#include "include/docs/SkPDFJpegHelpers.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <csignal>
#include <sys/wait.h>
#include <unistd.h>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

namespace fs = std::filesystem;

// Extensions the viewer treats as RC documents.
static bool isRcExt(const std::string& ext) {
    return ext == ".rc" || ext == ".rcd";
}

// Animated image loops decoded by SkCodec (WebpPlayer).
static bool isCodecVideoExt(const std::string& ext) {
    return ext == ".webp" || ext == ".gif" || ext == ".apng";
}

// Real video files decoded by AVFoundation (AvfVideoPlayer).
static bool isAvfVideoExt(const std::string& ext) {
    return ext == ".mp4" || ext == ".mov" || ext == ".m4v";
}

static bool isPlayableExt(const std::string& ext) {
    return isRcExt(ext) || isCodecVideoExt(ext) || isAvfVideoExt(ext);
}

static bool isZipFile(const std::string& ext) {
    return ext == ".zip";
}

// Get lowercase extension from a path or zip entry name.
static std::string getExt(const std::string& name) {
    auto dot = name.rfind('.');
    if (dot == std::string::npos) return "";
    std::string ext = name.substr(dot);
    for (auto& c : ext) c = std::tolower(c);
    return ext;
}

// Get the filename portion of a path or zip entry name.
static std::string baseName(const std::string& name) {
    auto slash = name.rfind('/');
    if (slash == std::string::npos) return name;
    return name.substr(slash + 1);
}

// ── Animated image player ────────────────────────────────────────────
// Decodes an animated WebP / GIF / APNG via SkCodec, caches every frame as an
// immutable SkImage, and paints the frame matching the elapsed time, looping
// forever. Used for slideshow video clips alongside .rc documents.
//
// Memory cost ≈ frameCount * width * height * 4 bytes. For typical slide
// loops (e.g. 1280x720, 4 sec @ 24 fps ≈ 350 MB) this is fine; for longer or
// higher-resolution clips, downscale during encode (`-vf scale=...`).
class WebpPlayer {
public:
    // Load from in-memory data (for zip archive support).
    static std::unique_ptr<WebpPlayer> LoadFromData(const std::vector<uint8_t>& bytes) {
        auto data = SkData::MakeWithCopy(bytes.data(), bytes.size());
        if (!data) return nullptr;
        return decodeFrames(data);
    }

    static std::unique_ptr<WebpPlayer> Load(const std::string& path) {
        auto data = SkData::MakeFromFileName(path.c_str());
        if (!data) return nullptr;
        return decodeFrames(data);
    }

private:
    static std::unique_ptr<WebpPlayer> decodeFrames(sk_sp<SkData> data) {
        auto codec = SkCodec::MakeFromData(data);
        if (!codec) return nullptr;

        const SkImageInfo info = codec->getInfo()
            .makeColorType(kN32_SkColorType)
            .makeAlphaType(kPremul_SkAlphaType);

        const int frameCount = codec->getFrameCount();
        if (frameCount <= 0) return nullptr;

        auto frameInfos = codec->getFrameInfo();
        auto player = std::unique_ptr<WebpPlayer>(new WebpPlayer());
        player->mWidth  = info.width();
        player->mHeight = info.height();

        // Persistent working buffer the codec decodes deltas into. Each
        // frame snapshot is then copied out into its own SkBitmap so the
        // resulting SkImages don't alias the working pixels.
        SkBitmap workBuf;
        if (!workBuf.tryAllocPixels(info)) return nullptr;

        int prior = SkCodec::kNoFrame;
        double cursorSec = 0.0;
        for (int i = 0; i < frameCount; ++i) {
            SkCodec::Options opts;
            opts.fFrameIndex = i;
            opts.fPriorFrame = prior;

            auto result = codec->getPixels(info, workBuf.getPixels(),
                                           workBuf.rowBytes(), &opts);
            if (result != SkCodec::kSuccess) {
                // Retry without a prior — forces a fresh decode of all
                // dependency frames into the working buffer.
                opts.fPriorFrame = SkCodec::kNoFrame;
                result = codec->getPixels(info, workBuf.getPixels(),
                                          workBuf.rowBytes(), &opts);
                if (result != SkCodec::kSuccess) {
                    std::cerr << "WebpPlayer: frame " << i << " decode failed ("
                              << (int)result << ")\n";
                    continue;
                }
            }
            prior = i;

            // Snapshot the working buffer into an immutable SkImage.
            SkBitmap snap;
            if (!snap.tryAllocPixels(info)) continue;
            if (!workBuf.readPixels(snap.pixmap(), 0, 0)) continue;
            snap.setImmutable();

            Frame f;
            f.image = snap.asImage();
            int durMs = (i < (int)frameInfos.size()) ? frameInfos[i].fDuration : 100;
            if (durMs <= 0) durMs = 100;
            f.startSec    = cursorSec;
            f.durationSec = durMs / 1000.0;
            cursorSec += f.durationSec;
            player->mFrames.push_back(std::move(f));
        }

        if (player->mFrames.empty()) return nullptr;
        player->mTotalSec = cursorSec;
        std::cerr << "WebpPlayer: " << player->mFrames.size() << " frames, "
                  << player->mTotalSec << "s, " << player->mWidth << "x"
                  << player->mHeight << "\n";
        return player;
    }

public:
    int width()  const { return mWidth;  }
    int height() const { return mHeight; }
    double totalSec() const { return mTotalSec; }
    int frameCount() const { return (int)mFrames.size(); }

    // Pick the frame matching elapsedSec (modulo total duration) and draw it
    // aspect-fit-centered into a (dstW x dstH) destination.
    void paint(SkCanvas* canvas, double elapsedSec, int dstW, int dstH) const {
        if (mFrames.empty() || mTotalSec <= 0) return;
        double t = std::fmod(elapsedSec, mTotalSec);
        if (t < 0) t += mTotalSec;

        // Linear scan is fine — frame counts are small (typically < a few hundred).
        const Frame* current = &mFrames.back();
        for (const auto& f : mFrames) {
            if (t >= f.startSec && t < f.startSec + f.durationSec) {
                current = &f;
                break;
            }
        }
        if (!current->image) return;

        const float sx = (float)dstW / (float)mWidth;
        const float sy = (float)dstH / (float)mHeight;
        const float s  = std::min(sx, sy);
        const float drawW = mWidth  * s;
        const float drawH = mHeight * s;
        const float ox = (dstW - drawW) * 0.5f;
        const float oy = (dstH - drawH) * 0.5f;

        SkRect dst = SkRect::MakeXYWH(ox, oy, drawW, drawH);
        SkSamplingOptions sampling(SkFilterMode::kLinear, SkMipmapMode::kNone);
        canvas->drawImageRect(current->image, dst, sampling);
    }

private:
    WebpPlayer() = default;
    struct Frame {
        sk_sp<SkImage> image;
        double startSec    = 0.0;
        double durationSec = 0.0;
    };
    int mWidth  = 0;
    int mHeight = 0;
    double mTotalSec = 0.0;
    std::vector<Frame> mFrames;
};

// ── Global state ─────────────────────────────────────────────────────

struct ViewerState {
    // File management
    std::vector<std::string> files;  // entry names when zip, file paths otherwise
    int currentIndex = 0;

    // Zip archive (null when loading from filesystem)
    std::unique_ptr<ZipArchive> zip;
    std::string zipTempFile;  // temp file for AVF video extraction

    // Document + persistent context
    std::unique_ptr<rccore::CoreDocument> doc;
    std::unique_ptr<rccore::RemoteContext> context;
    std::unique_ptr<rcskia::SkiaPaintContext> paintCtx;
    rccore::TimeVariables timeVars;
    std::vector<uint8_t> fileData;

    pid_t audioPid = 0;

    // Override voice-over directory. When empty, resolveVoicePath() falls
    // back to "<slide-parent>/voice". Set when the user passes a directory
    // on the command line — the voice dir sits alongside that directory.
    fs::path voiceDirOverride;

    // Animated image / video player. Non-null when the current file is a
    // .webp / .gif / .apng instead of a .rc document.
    std::unique_ptr<WebpPlayer> webpPlayer;
    double webpStartSec = 0.0;

    // Real video player for .mp4 / .mov / .m4v via AVFoundation.
    std::unique_ptr<AvfVideoPlayer> avfPlayer;

    // Rendering backend
    std::unique_ptr<RenderBackend> backend;
    int width = 800;
    int height = 800;

    // Animation
    bool paused = false;
    double animTime = 0.0;
    double lastFrameTime = 0.0;

    // Mouse / Touch
    float mouseX = 0, mouseY = 0;
    bool mouseDown = false;
    float lastMouseX = 0, lastMouseY = 0;
    double lastMouseTime = 0.0;

    // Debug
    int debug = 0;

    // Dirty flag
    bool needsRedraw = true;

    // Widget mode
    bool widgetMode = false;
    int widgetX = 100;
    int widgetY = 100;
    bool widgetInteractive = false;

    // Auto-advance
    double autoAdvanceSec = 0.0;  // 0 = disabled
    double timeSinceSwitch = 0.0;
    bool autoAdvanceOnVoice = false;  // advance when the voice-over wav finishes
};

static ViewerState g;

// ── File management ──────────────────────────────────────────────────

static std::vector<std::string> collectRcFiles(const std::string& path) {
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
static std::vector<std::string> collectZipFiles(ZipArchive& zip) {
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
static void cleanupTempFile() {
    if (!g.zipTempFile.empty()) {
        std::remove(g.zipTempFile.c_str());
        g.zipTempFile.clear();
    }
}

static void initDocument() {
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
static bool readFileBytes(const std::string& name, std::vector<uint8_t>& out) {
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

static bool loadFile(const std::string& path) {
    // Drop any state left over from the previous file so we start clean.
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

static void stopVoiceOver() {
    if (g.audioPid > 0) {
        ::kill(g.audioPid, SIGTERM);
        int status = 0;
        ::waitpid(g.audioPid, &status, 0);
        g.audioPid = 0;
    }
}

static fs::path resolveVoicePath(const std::string& slidePath) {
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

static void playVoiceOver(const fs::path& wav) {
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

static void loadCurrentFile() {
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

// ── Touch coordinate mapping ─────────────────────────────────────────
// Convert window (screen) coordinates to document coordinates.
// The document may be scaled to fit the window via content scaling.
static float touchX(float windowX) {
    if (!g.doc || g.width == 0) return windowX;
    return windowX * static_cast<float>(g.doc->getWidth()) / static_cast<float>(g.width);
}
static float touchY(float windowY) {
    if (!g.doc || g.height == 0) return windowY;
    return windowY * static_cast<float>(g.doc->getHeight()) / static_cast<float>(g.height);
}

// ── Rendering ────────────────────────────────────────────────────────

static void ensureSurface(int w, int h) {
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

static void renderFrame(double deltaTime) {
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

    g.context->mWidth = static_cast<float>(g.width);
    g.context->mHeight = static_cast<float>(g.height);
    g.context->loadFloat(rccore::RemoteContext::ID_TOUCH_POS_X, touchX(g.mouseX));
    g.context->loadFloat(rccore::RemoteContext::ID_TOUCH_POS_Y, touchY(g.mouseY));

    g.timeVars.updateTime(*g.context, g.animTime, deltaTime);
    g.doc->paint(*g.context);
}

// ── Callbacks ────────────────────────────────────────────────────────

static void keyCallback(GLFWwindow* window, int key, int /*scancode*/, int action, int /*mods*/) {
    if (action != GLFW_PRESS) return;

    switch (key) {
        case GLFW_KEY_ESCAPE:
        case GLFW_KEY_Q:
            glfwSetWindowShouldClose(window, GLFW_TRUE);
            break;
        case GLFW_KEY_RIGHT:
            g.currentIndex++;
            g.timeSinceSwitch = 0.0;
            loadCurrentFile();
            break;
        case GLFW_KEY_LEFT:
            g.currentIndex--;
            g.timeSinceSwitch = 0.0;
            loadCurrentFile();
            break;
        case GLFW_KEY_SPACE:
            g.paused = !g.paused;
            if (g.avfPlayer) g.avfPlayer->setPaused(g.paused);
            std::cerr << (g.paused ? "Paused" : "Playing") << "\n";
            break;
        case GLFW_KEY_R:
            loadCurrentFile();
            break;
        case GLFW_KEY_D:
            g.debug = (g.debug + 1) % 3;
            g.needsRedraw = true;
            std::cerr << "Debug: " << g.debug << "\n";
            break;
        case GLFW_KEY_S: {
            SkSurface* surf = g.backend ? g.backend->surface() : nullptr;
            if (surf) {
                auto image = surf->makeImageSnapshot();
                if (image) {
                    auto data = SkPngEncoder::Encode(nullptr, image.get(), {});
                    if (data) {
                        SkFILEWStream stream("/tmp/viewer_screenshot.png");
                        if (stream.isValid()) {
                            stream.write(data->data(), data->size());
                            std::cerr << "Saved /tmp/viewer_screenshot.png ("
                                      << g.width << "x" << g.height << ")\n";
                        }
                    }
                }
            }
            break;
        }
    }
}

static void cursorCallback(GLFWwindow* /*window*/, double x, double y) {
    g.mouseX = static_cast<float>(x);
    g.mouseY = static_cast<float>(y);

    if (g.mouseDown && g.doc && g.context) {
        float tx = touchX(g.mouseX), ty = touchY(g.mouseY);
        g.context->loadFloat(rccore::RemoteContext::ID_TOUCH_POS_X, tx);
        g.context->loadFloat(rccore::RemoteContext::ID_TOUCH_POS_Y, ty);
        g.doc->touchDrag(*g.context, tx, ty);

        g.lastMouseX = g.mouseX;
        g.lastMouseY = g.mouseY;
        g.lastMouseTime = glfwGetTime();
    }

    g.needsRedraw = true;
}

static void mouseButtonCallback(GLFWwindow* /*window*/, int button, int action, int /*mods*/) {
    if (button == GLFW_MOUSE_BUTTON_LEFT) {
        if (action == GLFW_PRESS) {
            g.mouseDown = true;
            g.lastMouseX = g.mouseX;
            g.lastMouseY = g.mouseY;
            g.lastMouseTime = glfwGetTime();

            if (g.doc && g.context) {
                g.doc->touchDown(*g.context, touchX(g.mouseX), touchY(g.mouseY));
            }
        } else if (action == GLFW_RELEASE) {
            g.mouseDown = false;

            if (g.doc && g.context) {
                double now = glfwGetTime();
                double dt = now - g.lastMouseTime;
                float dx = 0, dy = 0;
                if (dt > 0.0001) {
                    dx = static_cast<float>((g.mouseX - g.lastMouseX) / dt);
                    dy = static_cast<float>((g.mouseY - g.lastMouseY) / dt);
                }
                g.doc->touchUp(*g.context, touchX(g.mouseX), touchY(g.mouseY), dx, dy);
            }
        }
        g.needsRedraw = true;
    }
}

static void framebufferSizeCallback(GLFWwindow* /*window*/, int w, int h) {
    if (g.backend) g.backend->onFramebufferResize(w, h);
}

static void windowSizeCallback(GLFWwindow* /*window*/, int w, int h) {
    ensureSurface(w, h);
    g.needsRedraw = true;
}

// ── Screenshot helper ────────────────────────────────────────────────

static bool saveScreenshot(const std::string& outPath) {
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

// ── PDF export ───────────────────────────────────────────────────────
// Render one "slide" to a PDF page. The file may be an .rc/.rcd document
// (rendered vector via Skia's PDF backend — text, paths, images preserved),
// a video (first frame only), or an animated image (first frame only).
//
// For .rc files: builds a fresh CoreDocument + RemoteContext + SkiaPaintContext
// pointed at the PDF page canvas, runs the data pass up to `delaySec`, then
// paints once. Everything that has a native PDF representation stays vector;
// anything that doesn't (e.g. AGSL shaders) is rasterized by Skia at the
// metadata's fRasterDPI.
static bool renderSlideToPdfPage(SkDocument* pdf,
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

    SkCanvas* canvas = pdf->beginPage((SkScalar)docW, (SkScalar)docH);
    if (!canvas) return false;

    // Warm-up uses a throwaway raster canvas at the document's real size so
    // draw paths that depend on canvas dimensions (clipping, layout measure,
    // bounds checks) behave the same as a live playback. A 1x1 surface causes
    // some operations to short-circuit, leaving animations stuck at t≈0.
    sk_sp<SkSurface> initSurface = SkSurfaces::Raster(
        SkImageInfo::MakeN32Premul(docW, docH));

    rccore::RemoteContext ctx;
    rcskia::SkiaPaintContext paintCtx(ctx, initSurface->getCanvas());
    ctx.setPaintContext(&paintCtx);
    ctx.setDocument(doc.get());
    ctx.mWidth  = (float)docW;
    ctx.mHeight = (float)docH;
    ctx.loadFloat(rccore::RemoteContext::ID_TOUCH_POS_X, 0.0f);
    ctx.loadFloat(rccore::RemoteContext::ID_TOUCH_POS_Y, 0.0f);

    doc->registerListeners(ctx);
    doc->applyDataOperations(ctx);

    // Advance time so animated ops settle into a sensible state for a still.
    // Pin the wall clock via setFixedTimeMs so variables like CONTINUOUS_SEC
    // and EPOCH_SECOND advance in lockstep with ANIMATION_TIME rather than
    // ticking at real wall-clock rate (which would barely move during this
    // tight loop).
    int64_t baseWallMs = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count();
    rccore::TimeVariables tv;
    double t = 0.0, step = 1.0 / 60.0;
    while (t < delaySec) {
        doc->setFixedTimeMs(baseWallMs + static_cast<int64_t>(t * 1000.0));
        tv.updateTime(ctx, t, step);
        initSurface->getCanvas()->clear(SK_ColorTRANSPARENT);
        doc->paint(ctx);
        t += step;
    }
    doc->setFixedTimeMs(baseWallMs + static_cast<int64_t>(delaySec * 1000.0));
    tv.updateTime(ctx, delaySec, step);

    // Now paint onto the real PDF page canvas.
    paintCtx.setCanvas(canvas);
    doc->paint(ctx);

    pdf->endPage();
    return true;
}

// ── Main ─────────────────────────────────────────────────────────────

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cerr << "Usage: rcviewer [--cpu|--metal] <file.rc|.webp|.gif|.apng|.mp4|.mov|.m4v | directory | bundle.zip> [width height]\n"
                  << "       rcviewer [--cpu|--metal] --widget [x,y] [--interactive] <file.rc> [width height]\n"
                  << "       rcviewer --screenshot <file.rc> <output.png> [width height] [delay_sec]\n"
                  << "       rcviewer --screenshot-dir <dir_of_rc> <output_dir> [width height] [delay_sec]\n"
                  << "       rcviewer --pdf <input.zip|dir|file.rc> <output.pdf> [page_w page_h] [delay_sec]\n"
                  << "\nBackend options:\n"
                  << "  --metal        Use Metal GPU backend (default)\n"
                  << "  --cpu          Use CPU software backend\n"
                  << "\nWidget mode:\n"
                  << "  --widget [x,y] Desktop widget (borderless, always on desktop)\n"
                  << "  --interactive  Enable mouse interaction in widget mode\n"
                  << "\nSlideshow:\n"
                  << "  --auto <sec>   Auto-advance to next file every N seconds (default 5)\n"
                  << "  --auto-voice   Auto-advance to next file when the voice-over wav finishes\n"
                  << "\nZip bundle:\n"
                  << "  Pass a .zip file to load all .rc/.webp/.gif/.mp4/etc. from the archive.\n"
                  << "  This lets you distribute an entire presentation as a single file.\n";
        return 1;
    }

    // Parse flags (order-independent before the positional file arg)
    bool useMetal = true;
    int argOffset = 1;

    // Scan for flags
    while (argOffset < argc && argv[argOffset][0] == '-') {
        std::string arg = argv[argOffset];
        if (arg == "--cpu") {
            useMetal = false;
            argOffset++;
        } else if (arg == "--metal") {
            useMetal = true;
            argOffset++;
        } else if (arg == "--widget") {
            g.widgetMode = true;
            argOffset++;
            // Check for optional x,y position
            if (argOffset < argc && std::strchr(argv[argOffset], ',') != nullptr) {
                if (std::sscanf(argv[argOffset], "%d,%d", &g.widgetX, &g.widgetY) == 2) {
                    argOffset++;
                }
            }
        } else if (arg == "--interactive") {
            g.widgetInteractive = true;
            argOffset++;
        } else if (arg == "--auto") {
            argOffset++;
            if (argOffset < argc) {
                g.autoAdvanceSec = std::atof(argv[argOffset]);
                if (g.autoAdvanceSec <= 0) g.autoAdvanceSec = 5.0;
                argOffset++;
            } else {
                g.autoAdvanceSec = 5.0;
            }
        } else if (arg == "--auto-voice") {
            g.autoAdvanceOnVoice = true;
            argOffset++;
        } else {
            break;  // not a known flag — must be --screenshot etc. or the file
        }
    }

    if (argOffset >= argc) {
        std::cerr << "Error: no input file specified\n";
        return 1;
    }

    // Tolerate mode flags appearing AFTER the input file.
    // e.g. `rcviewer talk.zip --pdf talk.pdf` is rewritten to
    //      `rcviewer --pdf talk.zip talk.pdf`.
    // We do this by finding the mode flag in argv[argOffset..] and, if it's
    // not already at position argOffset, swapping it with whatever is there.
    for (int i = argOffset + 1; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--pdf" || a == "--screenshot" || a == "--screenshot-dir") {
            std::swap(argv[argOffset], argv[i]);
            break;
        }
    }

    // ── Screenshot mode ──────────────────────────────────────────────
    std::string screenshotMode;
    if (std::string(argv[argOffset]) == "--screenshot" || std::string(argv[argOffset]) == "--screenshot-dir") {
        screenshotMode = argv[argOffset];
    }

    if (screenshotMode == "--screenshot") {
        if (argOffset + 2 >= argc) {
            std::cerr << "Usage: rcviewer [--cpu|--metal] --screenshot <file.rc> <output.png> [width height] [delay_sec]\n";
            return 1;
        }
        std::string inputPath = argv[argOffset + 1];
        std::string outputPath = argv[argOffset + 2];
        int w = 400, h = 400;
        double delay = 0.2;
        if (argOffset + 4 < argc) { w = std::atoi(argv[argOffset + 3]); h = std::atoi(argv[argOffset + 4]); }
        if (argOffset + 5 < argc) { delay = std::atof(argv[argOffset + 5]); }

        // Screenshot mode: use CPU backend (no window needed)
        g.backend = std::make_unique<CpuRenderBackend>();
        ensureSurface(w, h);
        if (!loadFile(inputPath)) {
            std::cerr << "Failed to load: " << inputPath << "\n";
            return 1;
        }

        double t = 0.0, step = 1.0 / 60.0;
        while (t < delay) {
            g.animTime = t;
            g.timeVars.updateTime(*g.context, t, step);
            g.doc->paint(*g.context);
            t += step;
        }
        g.animTime = delay;
        renderFrame(step);

        if (saveScreenshot(outputPath)) {
            std::cout << outputPath << "\n";
        } else {
            std::cerr << "Failed to write: " << outputPath << "\n";
            return 1;
        }
        return 0;
    }

    if (screenshotMode == "--screenshot-dir") {
        if (argOffset + 2 >= argc) {
            std::cerr << "Usage: rcviewer [--cpu|--metal] --screenshot-dir <dir_of_rc> <output_dir> [width height] [delay_sec]\n";
            return 1;
        }
        std::string rcDir = argv[argOffset + 1];
        std::string outDir = argv[argOffset + 2];
        int w = 400, h = 400;
        double delay = 0.2;
        if (argOffset + 4 < argc) { w = std::atoi(argv[argOffset + 3]); h = std::atoi(argv[argOffset + 4]); }
        if (argOffset + 5 < argc) { delay = std::atof(argv[argOffset + 5]); }

        fs::create_directories(outDir);

        std::vector<std::string> rcFiles;
        for (auto& entry : fs::directory_iterator(rcDir)) {
            auto ext = entry.path().extension().string();
            if (ext == ".rc" || ext == ".rcd") {
                rcFiles.push_back(entry.path().string());
            }
        }
        std::sort(rcFiles.begin(), rcFiles.end());

        if (rcFiles.empty()) {
            std::cerr << "No .rc files found in " << rcDir << "\n";
            return 1;
        }

        g.backend = std::make_unique<CpuRenderBackend>();

        int ok = 0, fail = 0;
        for (const auto& rcPath : rcFiles) {
            std::string stem = fs::path(rcPath).stem().string();
            std::string outPath = (fs::path(outDir) / (stem + ".png")).string();

            ensureSurface(w, h);
            if (!loadFile(rcPath)) {
                std::cerr << "FAIL: " << stem << "\n";
                fail++;
                continue;
            }

            double t = 0.0, step = 1.0 / 60.0;
            while (t < delay) {
                g.animTime = t;
                g.timeVars.updateTime(*g.context, t, step);
                g.doc->paint(*g.context);
                t += step;
            }
            g.animTime = delay;
            renderFrame(step);

            if (saveScreenshot(outPath)) {
                std::cout << outPath << "\n";
                ok++;
            } else {
                std::cerr << "FAIL write: " << outPath << "\n";
                fail++;
            }
        }
        std::cerr << "Done: " << ok << " screenshots, " << fail << " failures\n";
        return fail > 0 ? 1 : 0;
    }

    // ── PDF export mode ──────────────────────────────────────────────
    // rcviewer --pdf <input.zip|dir|file.rc> <output.pdf> [page_w page_h] [delay_sec]
    //
    // Emits one PDF page per slide. .rc/.rcd files are rendered vector via
    // Skia's PDF backend so text, paths, and shapes stay selectable and
    // scalable. Videos contribute only their first frame; animated images
    // contribute frame 0.
    if (std::string(argv[argOffset]) == "--pdf") {
        if (argOffset + 2 >= argc) {
            std::cerr << "Usage: rcviewer --pdf <input.zip|dir|file.rc> <output.pdf> [page_w page_h] [delay_sec]\n";
            return 1;
        }
        std::string inputPath  = argv[argOffset + 1];
        std::string outputPath = argv[argOffset + 2];
        int pageW = 800, pageH = 800;
        double delay = 2.0;
        if (argOffset + 4 < argc) {
            pageW = std::atoi(argv[argOffset + 3]);
            pageH = std::atoi(argv[argOffset + 4]);
        }
        if (argOffset + 5 < argc) delay = std::atof(argv[argOffset + 5]);

        // Collect entries (zip, directory, or single file).
        std::vector<std::string> entries;
        if (isZipFile(getExt(inputPath))) {
            g.zip = std::make_unique<ZipArchive>();
            if (!g.zip->open(inputPath)) {
                std::cerr << "Failed to open zip: " << inputPath << "\n";
                return 1;
            }
            entries = collectZipFiles(*g.zip);
        } else if (fs::is_directory(fs::path(inputPath))) {
            for (auto& e : fs::directory_iterator(inputPath)) {
                auto ext = e.path().extension().string();
                if (isPlayableExt(ext)) entries.push_back(e.path().string());
            }
            std::sort(entries.begin(), entries.end());
        } else {
            entries.push_back(inputPath);
        }

        if (entries.empty()) {
            std::cerr << "No playable files found in " << inputPath << "\n";
            return 1;
        }

        SkFILEWStream out(outputPath.c_str());
        if (!out.isValid()) {
            std::cerr << "Cannot open output: " << outputPath << "\n";
            return 1;
        }

        // Use MetadataWithCallbacks so Skia can encode embedded images as JPEG
        // when appropriate (required by this Skia build).
        SkPDF::Metadata meta = SkPDF::JPEG::MetadataWithCallbacks();
        meta.fTitle    = SkString("RemoteCompose Presentation");
        meta.fCreator  = SkString("rcviewer");
        meta.fRasterDPI = 300;
        auto pdf = SkPDF::MakeDocument(&out, meta);
        if (!pdf) {
            std::cerr << "Failed to create PDF document\n";
            return 1;
        }

        int ok = 0, fail = 0;
        for (const auto& entry : entries) {
            std::string name = g.zip ? baseName(entry)
                                     : fs::path(entry).filename().string();
            if (renderSlideToPdfPage(pdf.get(), entry, pageW, pageH, delay)) {
                std::cout << "[" << (ok + fail + 1) << "/" << entries.size() << "] "
                          << name << "\n";
                ok++;
            } else {
                std::cerr << "FAIL: " << name << "\n";
                fail++;
            }
        }

        pdf->close();
        g.zip.reset();
        std::cerr << "Done: " << ok << " pages written to " << outputPath
                  << " (" << fail << " failures)\n";
        return fail > 0 && ok == 0 ? 1 : 0;
    }

    // ── Interactive mode ─────────────────────────────────────────────
    int initW = 800, initH = 800;
    if (argOffset + 2 < argc) {
        initW = std::atoi(argv[argOffset + 1]);
        initH = std::atoi(argv[argOffset + 2]);
    }

    // Collect files — from zip archive or filesystem
    std::string inputArg = argv[argOffset];
    if (isZipFile(getExt(inputArg))) {
        g.zip = std::make_unique<ZipArchive>();
        if (!g.zip->open(inputArg)) {
            std::cerr << "Failed to open zip: " << inputArg << "\n";
            return 1;
        }
        g.files = collectZipFiles(*g.zip);
        std::cerr << "Zip: " << inputArg << "\n";
    } else {
        fs::path inputPath(inputArg);
        if (fs::is_directory(inputPath)) {
            fs::path parent = inputPath.parent_path();
            if (parent.empty()) parent = fs::current_path();
            g.voiceDirOverride = parent / "voice";
        }
        g.files = collectRcFiles(inputArg);
    }
    if (g.files.empty()) {
        std::cerr << "No .rc/.rcd/.webp/.gif/.apng/.mp4/.mov/.m4v files found\n";
        return 1;
    }
    std::cerr << "Found " << g.files.size() << " files\n";

    // Init GLFW
    if (!glfwInit()) {
        std::cerr << "GLFW init failed\n";
        return 1;
    }

    // Both backends use OpenGL for display (Metal backend uses GPU for rendering,
    // reads back pixels, then uploads via OpenGL — same display path)
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 2);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 1);

    if (g.widgetMode) {
        glfwWindowHint(GLFW_DECORATED, GLFW_FALSE);
        glfwWindowHint(GLFW_TRANSPARENT_FRAMEBUFFER, GLFW_TRUE);
        glfwWindowHint(GLFW_FLOATING, GLFW_FALSE);
        glfwWindowHint(GLFW_FOCUSED, GLFW_FALSE);
        glfwWindowHint(GLFW_FOCUS_ON_SHOW, GLFW_FALSE);
    }

    GLFWwindow* window = glfwCreateWindow(initW, initH, "RemoteCompose Viewer", nullptr, nullptr);
    if (!window) {
        std::cerr << "Window creation failed\n";
        glfwTerminate();
        return 1;
    }

    if (g.widgetMode) {
        if (!g.widgetInteractive) {
            glfwSetWindowAttrib(window, GLFW_MOUSE_PASSTHROUGH, GLFW_TRUE);
        }
        configureDesktopWidget(window, g.widgetX, g.widgetY);
    }

    glfwMakeContextCurrent(window);
    glfwSwapInterval(1); // vsync

    if (g.widgetMode) {
        glClearColor(0.0f, 0.0f, 0.0f, 0.0f);
    }

    // Create rendering backend
    if (useMetal) {
        g.backend = MetalRenderBackend::Create(window);
        if (!g.backend) {
            std::cerr << "Metal backend failed, falling back to CPU\n";
            g.backend = std::make_unique<CpuRenderBackend>();
            useMetal = false;
        }
    } else {
        g.backend = std::make_unique<CpuRenderBackend>();
    }

    std::cerr << "Backend: " << g.backend->name() << "\n";

    // Callbacks
    glfwSetKeyCallback(window, keyCallback);
    glfwSetCursorPosCallback(window, cursorCallback);
    glfwSetMouseButtonCallback(window, mouseButtonCallback);
    glfwSetFramebufferSizeCallback(window, framebufferSizeCallback);
    glfwSetWindowSizeCallback(window, windowSizeCallback);

    // Get actual framebuffer size
    int fbW, fbH;
    glfwGetFramebufferSize(window, &fbW, &fbH);
    g.backend->onFramebufferResize(fbW, fbH);

    // Use window size for render dimensions
    int winW, winH;
    glfwGetWindowSize(window, &winW, &winH);
    ensureSurface(winW, winH);

    // Load first file
    loadCurrentFile();

    auto startTime = std::chrono::steady_clock::now();
    g.lastFrameTime = 0.0;

    // Main loop
    while (!glfwWindowShouldClose(window)) {
        glfwPollEvents();

        auto now = std::chrono::steady_clock::now();
        double elapsed = std::chrono::duration<double>(now - startTime).count();
        double dt = elapsed - g.lastFrameTime;

        if (!g.paused) {
            g.animTime += dt;
            g.needsRedraw = true;

            // Auto-advance to next file
            if (g.autoAdvanceSec > 0) {
                g.timeSinceSwitch += dt;
                if (g.timeSinceSwitch >= g.autoAdvanceSec) {
                    g.timeSinceSwitch = 0.0;
                    g.currentIndex++;
                    loadCurrentFile();
                }
            }

            // Auto-advance when the voice-over finishes
            if (g.autoAdvanceOnVoice && g.audioPid > 0) {
                int status = 0;
                pid_t r = ::waitpid(g.audioPid, &status, WNOHANG);
                if (r == g.audioPid) {
                    g.audioPid = 0;
                    std::cerr << "voice: finished, advancing\n";
                    g.currentIndex++;
                    g.timeSinceSwitch = 0.0;
                    loadCurrentFile();
                }
            }
        }
        g.lastFrameTime = elapsed;

        if (g.context) {
            int delay = g.context->getRepaintDelay();
            if (delay > 0) {
                g.needsRedraw = true;
            }
        }

        if (g.needsRedraw) {
            glfwGetWindowSize(window, &winW, &winH);
            ensureSurface(winW, winH);

            renderFrame(dt);
            g.backend->present();

            // Title bar info (skip in widget mode — no title bar)
            if (!g.widgetMode) {
                std::string name = g.files.empty() ? "---"
                    : (g.zip ? baseName(g.files[g.currentIndex])
                             : fs::path(g.files[g.currentIndex]).filename().string());
                char title[256];
                snprintf(title, sizeof(title), "RC Viewer [%d/%d] %s  t=%.1fs%s  [%s]",
                         g.currentIndex + 1, (int)g.files.size(),
                         name.c_str(), g.animTime,
                         g.paused ? " PAUSED" : "",
                         g.backend->name());
                glfwSetWindowTitle(window, title);
            }

            glfwSwapBuffers(window);

            g.needsRedraw = false;
        }
    }

    // Cleanup
    stopVoiceOver();
    cleanupTempFile();
    g.avfPlayer.reset();
    g.webpPlayer.reset();
    g.paintCtx.reset();
    g.context.reset();
    g.doc.reset();
    g.zip.reset();
    g.backend.reset();
    glfwDestroyWindow(window);
    glfwTerminate();
    return 0;
}
