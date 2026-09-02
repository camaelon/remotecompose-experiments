#include "rccore/WireBuffer.h"
#include "rccore/CoreDocument.h"
#include "rccore/RemoteContext.h"
#include "rcskia/SkiaPaintContext.h"
#include "rcskia/RcDocumentHost.h"

#include "include/core/SkSurface.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkData.h"
#include "include/core/SkPixmap.h"
#include "include/encode/SkPngEncoder.h"
#include "include/core/SkStream.h"

#include <fstream>
#include <iostream>
#include <vector>
#include <cstring>
#include <cstdlib>

int main(int argc, char* argv[]) {
    if (argc < 3) {
        std::cerr << "Usage: rc2image input.rcd output.png [width height] [--time epoch_ms] [--anim seconds]\n";
        return 1;
    }

    const char* inputPath = argv[1];
    const char* outputPath = argv[2];
    int overrideWidth = 0, overrideHeight = 0;
    int64_t fixedTimeMs = 0;
    float animTimeSec = -1.0f;   // >=0 pins animationTime (seconds since first frame)

    // Parse remaining args
    int i = 3;
    while (i < argc) {
        if (std::strcmp(argv[i], "--time") == 0 && i + 1 < argc) {
            fixedTimeMs = std::atoll(argv[i + 1]);
            i += 2;
        } else if (std::strcmp(argv[i], "--anim") == 0 && i + 1 < argc) {
            animTimeSec = std::atof(argv[i + 1]);
            i += 2;
        } else if (overrideWidth == 0 && i + 1 < argc && std::atoi(argv[i]) > 0) {
            overrideWidth = std::atoi(argv[i]);
            overrideHeight = std::atoi(argv[i + 1]);
            i += 2;
        } else {
            i++;
        }
    }

    // Read input file
    std::ifstream ifs(inputPath, std::ios::binary);
    if (!ifs) {
        std::cerr << "Error: cannot open " << inputPath << "\n";
        return 1;
    }
    std::vector<uint8_t> data((std::istreambuf_iterator<char>(ifs)),
                               std::istreambuf_iterator<char>());
    ifs.close();

    if (data.empty()) {
        std::cerr << "Error: empty file\n";
        return 1;
    }

    // Parse document
    rccore::WireBuffer buffer(data.data(), data.size());
    rccore::CoreDocument doc;
    if (!doc.initFromBuffer(buffer)) {
        std::cerr << "Error: failed to parse " << inputPath << "\n";
        return 1;
    }
    if (fixedTimeMs > 0) {
        doc.setFixedTimeMs(fixedTimeMs);
    }

    int width = overrideWidth > 0 ? overrideWidth : doc.getWidth();
    int height = overrideHeight > 0 ? overrideHeight : doc.getHeight();
    if (width <= 0) width = 600;
    if (height <= 0) height = 600;

    // Create Skia surface
    SkImageInfo info = SkImageInfo::MakeN32Premul(width, height);
    auto surface = SkSurfaces::Raster(info);
    if (!surface) {
        std::cerr << "Error: failed to create Skia surface\n";
        return 1;
    }

    SkCanvas* canvas = surface->getCanvas();
    // White background (matches TS renderer)
    canvas->clear(SK_ColorWHITE);

    // Set up context and paint context
    rccore::RemoteContext context;
    rcskia::SkiaPaintContext paintCtx(context, canvas);
    context.setPaintContext(&paintCtx);
    context.setDocument(&doc);

    // Host for embedded "rc:<file>" sub-documents, resolved next to the input file.
    rcskia::RcDocumentHost rcHost;
    {
        std::string in(inputPath);
        auto slash = in.find_last_of("/\\");
        rcHost.setBaseDir(slash == std::string::npos ? "." : in.substr(0, slash));
    }
    context.setCustomHost(&rcHost);

    // Set canvas dimensions before data pass
    context.mWidth = static_cast<float>(width);
    context.mHeight = static_cast<float>(height);

    // Register variable listeners
    doc.registerListeners(context);

    // Pin animationTime for deterministic mid-animation captures. overrideFloat makes the
    // per-frame time load a no-op for this id, so the value stays put across paints.
    if (animTimeSec >= 0.0f) {
        context.overrideFloat(rccore::RemoteContext::ID_ANIMATION_TIME, animTimeSec);
    }

    // Execute data operations (loads text, expressions, etc.)
    doc.applyDataOperations(context, -2);  // THEME_DARK

    // Paint (includes DATA re-eval + PAINT).
    // RC_FRAMES paints repeatedly before capturing. One frame is not enough for anything
    // driven by an Impulse: its first pass runs only the initialisation block, and the
    // process block that does the per-frame work (particle loops, and the mesh draws
    // nested inside them) starts on the second. A single-frame capture of a particle
    // document is therefore legitimately empty rather than broken.
    int frames = 1;
    if (const char* f = std::getenv("RC_FRAMES")) {
        frames = std::atoi(f);
        if (frames < 1) frames = 1;
    }
    // RC_ANIM_SWEEP=N: paint N frames advancing animationTime linearly to animTimeSec, so a
    // layout that depends on time is exercised across frames (tests the layout cache doesn't
    // freeze it). The final frame is at animTimeSec, so it should match a single paint there.
    int sweep = 0;
    if (const char* s = std::getenv("RC_ANIM_SWEEP")) sweep = std::max(0, std::atoi(s));
    if (sweep > 1 && animTimeSec >= 0.0f) {
        for (int i = 0; i < sweep; i++) {
            float t = animTimeSec * (float)i / (float)(sweep - 1);
            context.overrideFloat(rccore::RemoteContext::ID_ANIMATION_TIME, t);
            doc.paint(context, -2);
        }
    } else {
        for (int i = 0; i < frames; i++) {
            doc.paint(context, -2);  // THEME_DARK
        }
    }

    // Encode to PNG
    SkPixmap pixmap;
    if (!surface->peekPixels(&pixmap)) {
        std::cerr << "Error: failed to read pixels\n";
        return 1;
    }

    SkFILEWStream stream(outputPath);
    if (!stream.isValid()) {
        std::cerr << "Error: cannot write " << outputPath << "\n";
        return 1;
    }

    SkPngEncoder::Options pngOpts;
    if (!SkPngEncoder::Encode(&stream, pixmap, pngOpts)) {
        std::cerr << "Error: PNG encoding failed\n";
        return 1;
    }

    std::cout << "Success: " << inputPath << " -> " << outputPath
              << " (" << width << "x" << height << ")\n";
    return 0;
}
