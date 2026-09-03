// rcplayer — the runtime behind rcviewer, factored out so other players can embed it.
//
// A player is a single document at a time plus the machinery around it: the playlist it
// came from (a directory, a zip bundle, or one file), the Skia/Metal surface it paints
// into, the custom-component hosts for embedded video / web / sub-documents, the touch
// mapping, and the voice-over process. All of that lives in one process-wide `g` — the
// viewer is a single-window app and so is every player built on this.
//
// A host app owns the window and the event loop; it drives the player by calling
// loadCurrentFile() / renderFrame() and (optionally) installing the default GLFW
// callbacks from Callbacks.h.
#pragma once

#include "rcplayer/AvfVideoPlayer.h"
#include "rcplayer/RenderBackend.h"
#include "rcplayer/VideoCustomHost.h"
#include "rcplayer/WebCustomHost.h"
#include "rcplayer/WebpPlayer.h"
#include "rcplayer/ZipArchive.h"

#include "rccore/CoreDocument.h"
#include "rccore/CustomComponentHost.h"
#include "rccore/RemoteContext.h"
#include "rccore/TimeVariables.h"
#include "rcskia/RcDocumentHost.h"
#include "rcskia/SkiaPaintContext.h"

#include <sys/types.h>

#include <cstdint>
#include <filesystem>
#include <memory>
#include <string>
#include <vector>

struct GLFWwindow;

namespace rcplayer {

// Routes LAYOUT_CUSTOM draws to the right host by the config prefix: "web:" → the web
// host, "rc:" → the embedded-document host, "video:" (default) → the video host.
struct CustomHostRouter : rccore::CustomComponentHost {
    rccore::CustomComponentHost* video = nullptr;   // live VideoCustomHost, or a still-frame stand-in
    rccore::CustomComponentHost* web = nullptr;     // live WebCustomHost, or a placeholder for stills
    rcskia::RcDocumentHost* rcdoc = nullptr;
    bool drawCustom(int id, const std::string& config, rccore::PaintContext* pc,
                    float w, float h, double t) override {
        if (config.rfind("web:", 0) == 0)
            return web ? web->drawCustom(id, config, pc, w, h, t) : false;
        if (config.rfind("rc:", 0) == 0)
            return rcdoc ? rcdoc->drawCustom(id, config, pc, w, h, t) : false;
        return video ? video->drawCustom(id, config, pc, w, h, t) : false;
    }
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

    // GLFW window handle.
    GLFWwindow* window = nullptr;
    // Hosts for native custom components (LAYOUT_CUSTOM): video + embedded web pages,
    // behind a router registered on the context.
    VideoCustomHost videoHost;
    WebCustomHost webHost;
    rcskia::RcDocumentHost rcDocHost;
    CustomHostRouter customRouter;

    // Set false to stop loadCurrentFile() starting a slide's voice-over. A player that is
    // *recording* narration has to turn this off, or the previous take plays out of the
    // speakers and straight back into the new one.
    bool voiceOverEnabled = true;

    // Override voice-over directory. When empty, resolveVoicePath() falls
    // back to "<slide-parent>/voice". Set when the user passes a directory
    // on the command line — the voice dir sits alongside that directory.
    std::filesystem::path voiceDirOverride;

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
    // A second sample, kept deliberately behind the newest one. Release velocity has to be
    // measured over a window; measuring against the newest sample gives zero, because the
    // pointer does not move between the final move event and the button coming up.
    float prevMouseX = 0, prevMouseY = 0;
    double prevMouseTime = 0.0;

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

// Process-wide player state. Defined in Player.cpp.
extern ViewerState g;

// ── Window ───────────────────────────────────────────────────────────

// Give the player the window it draws into, and hand that window to the hosts that place
// native views over the slide. Call once, after creating the window and before the first
// paint. Setting g.window by hand is not enough: an embedded web page is a real WKWebView
// added to the window's content view, so a host that was never given the window silently
// draws nothing and the slide simply comes up without its embed.
void attachWindow(GLFWwindow* window);

// ── File management ──────────────────────────────────────────────────

// Every playable file in `path`'s directory (or, for a file, its siblings), sorted.
// Sets g.currentIndex to the passed file when `path` names one.
std::vector<std::string> collectRcFiles(const std::string& path);

// Every playable entry in an open zip archive, sorted.
std::vector<std::string> collectZipFiles(ZipArchive& zip);

// The entries an export should walk, from whichever of the three things it was pointed at:
// a directory of slides, a zip bundle (opened into g.zip), or a single file. Empty when
// there is nothing playable there.
std::vector<std::string> collectDeckEntries(const std::string& input);

// Remove the temp file left by the previous zip video extraction, if any.
void cleanupTempFile();

// Build the RemoteContext / paint context for g.doc and run its data pass.
void initDocument();

// Read a file's bytes — from the open zip archive when there is one, else from disk.
bool readFileBytes(const std::string& name, std::vector<uint8_t>& out);

// Load one playlist entry (.rc/.rcd document, animated image, or video), replacing
// whatever was playing. Returns false and leaves nothing loaded on failure.
bool loadFile(const std::string& path);

// Load g.files[g.currentIndex] (wrapping the index) and start its voice-over.
void loadCurrentFile();

// ── Voice-over ───────────────────────────────────────────────────────

void stopVoiceOver();

// Where a slide's voice-over lives — "<voice dir>/<leading digits of the slide name>.wav",
// with the voice dir being g.voiceDirOverride or "<slide dir>/voice". Computed, not checked:
// the file and even the directory need not exist. Empty only when the slide's name has no
// leading digits to key it by.
//
// Recording a voice-over and playing one back must agree on this path, so both go through
// here rather than each spelling out the rule.
std::filesystem::path voicePathFor(const std::string& slidePath);

// The wav for a slide, or empty when there isn't one. voicePathFor() plus the existence
// checks, with a line on stderr saying which way it went.
std::filesystem::path resolveVoicePath(const std::string& slidePath);

// Play `wav` in a forked `afplay`, replacing any voice-over already playing.
void playVoiceOver(const std::filesystem::path& wav);

// ── Document fit transform ───────────────────────────────────────────
// Slides are authored at a fixed design size (the document header width/height).
// Rather than laying them out at the raw window size — which leaves absolutely-sized
// content (padding, fonts, pane widths) stranded at authored scale in a corner when
// the window grows — we lay out at the design size and scale-to-fit (aspect-fit,
// centred with letterbox bars). This makes a slide fill fullscreen, scaled uniformly.
struct FitTransform { float scale; float ox; float oy; float docW; float docH; };

FitTransform docFit();

// ── Touch coordinate mapping ─────────────────────────────────────────
// Window (screen) coordinates to document coordinates, undoing the fit.
float touchX(float windowX);
float touchY(float windowY);

// ── Rendering ────────────────────────────────────────────────────────

// Resize the backend surface and the document's viewport to (w, h). Cheap when unchanged.
void ensureSurface(int w, int h);

// Paint one frame of whatever is loaded into the backend's canvas. `deltaTime` is the
// wall-clock delta since the previous frame, in seconds.
void renderFrame(double deltaTime);

// Write the backend's current surface to `outPath` as a PNG.
bool saveScreenshot(const std::string& outPath);

}  // namespace rcplayer
