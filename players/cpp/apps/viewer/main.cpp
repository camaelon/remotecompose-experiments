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
//   --metal         - Use Metal GPU backend (default on macOS)
//   --cpu           - Use CPU software backend
//   --widget [x,y]  - Desktop widget mode (borderless, on desktop layer)
//   --interactive   - Enable mouse interaction in widget mode
//   --auto <sec>    - Auto-advance to next file every N seconds

#define GL_SILENCE_DEPRECATION
#include <GLFW/glfw3.h>

#include "rcplayer/Callbacks.h"
#include "rcplayer/CpuRenderBackend.h"
#include "rcplayer/MediaTypes.h"
#if defined(__APPLE__)
#include "rcplayer/MetalRenderBackend.h"
#endif
#include "rcplayer/PdfExport.h"
#include "rcplayer/Player.h"
#include "rcplayer/WidgetHelper.h"
#include "rcplayer/ZipArchive.h"

#include "rccore/CoreDocument.h"

#include "include/core/SkStream.h"
#include "include/docs/SkPDFDocument.h"
#include "include/docs/SkPDFJpegHelpers.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <iostream>
#include <string>
#include <sys/wait.h>
#include <vector>

namespace fs = std::filesystem;

// The player runtime (state `g`, load/render, default input handling) lives in
// lib/rcplayer; this file is only the command line and the event loop around it.
using namespace rcplayer;

// ── Main ─────────────────────────────────────────────────────────────

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cerr << "Usage: rcviewer [--cpu|--metal] <file.rc|.webp|.gif|.apng|.mp4|.mov|.m4v | directory | bundle.zip> [width height]\n"
                  << "       rcviewer [--cpu|--metal] --widget [x,y] [--interactive] <file.rc> [width height]\n"
                  << "       rcviewer --screenshot <file.rc> <output.png> [width height] [delay_sec]\n"
                  << "       rcviewer --screenshot-dir <dir_of_rc> <output_dir> [width height] [delay_sec]\n"
                  << "       rcviewer --pdf <input.zip|dir|file.rc> <output.pdf> [page_w page_h] [delay_sec]\n"
                  << "\nBackend options:\n"
                  << "  --metal        Use Metal GPU backend (default on macOS)\n"
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
    bool useMetal =
#if defined(__APPLE__)
        true;
#else
        false;
#endif
    int argOffset = 1;

    // Scan for flags
    while (argOffset < argc && argv[argOffset][0] == '-') {
        std::string arg = argv[argOffset];
        if (arg == "--cpu") {
            useMetal = false;
            argOffset++;
        } else if (arg == "--metal") {
#if defined(__APPLE__)
            useMetal = true;
#else
            std::cerr << "--metal is only available on macOS; using CPU backend\n";
            useMetal = false;
#endif
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
    attachWindow(window);             // also gives the web host its content view

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
#if defined(__APPLE__)
        g.backend = MetalRenderBackend::Create(window);
        if (!g.backend) {
            std::cerr << "Metal backend failed, falling back to CPU\n";
            g.backend = std::make_unique<CpuRenderBackend>();
            useMetal = false;
        }
#else
        g.backend = std::make_unique<CpuRenderBackend>();
        useMetal = false;
#endif
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
            int64_t nowMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::system_clock::now().time_since_epoch()).count();
            int delay = g.context->getRepaintDelay(nowMs);
            if (delay > 0) {
                g.needsRedraw = true;
            }
            // A document can also ask for the next frame itself, and that request is the only
            // thing driving an animation the schedule knows nothing about. TouchExpression's
            // fling is the case that matters: on touch-up it configures an easing curve and
            // then calls needsRepaint() on every frame until the curve runs out. Ignore it and
            // the fling dies the instant the finger lifts — the value simply stops where it
            // was, with no error and no visible cause.
            //
            // This went unnoticed while getRepaintDelay() treated ID_ANIMATION_TIME as
            // continuous: everything repainted every frame regardless, so nothing needed the
            // request to be honoured. Matching the reference's schedule removed that cover.
            if (rccore::PaintContext* pc = g.context->getPaintContext()) {
                if (pc->doesNeedsRepaint()) {
                    g.needsRedraw = true;
                }
            }
        }

        if (g.needsRedraw) {
            glfwGetWindowSize(window, &winW, &winH);
            ensureSurface(winW, winH);

            renderFrame(dt);
            g.backend->present();

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
