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

#include <algorithm>
#include "rccore/ExpressionEvaluator.h"
#include <ctime>
#include <cstdio>
#include <fstream>
#include <iostream>
#include <vector>
#include <cstring>
#include <cstdlib>
#include <algorithm>
#include "rccore/ExpressionEvaluator.h"
#include <ctime>
#include <cstdio>

// Parse a --clock spec into epoch milliseconds, local time. Returns false if it is not a
// spec this understands, so a bad string is reported rather than silently treated as "now".
static bool parseClockSpec(const char* spec, int64_t& outMs) {
    if (spec == nullptr || *spec == '\0') return false;
    if (spec[0] == '@') {                       // raw epoch millis
        char* end = nullptr;
        long long v = std::strtoll(spec + 1, &end, 10);
        if (end == spec + 1 || *end != '\0') return false;
        outMs = static_cast<int64_t>(v);
        return true;
    }
    int Y = 0, M = 0, D = 0, h = 0, m = 0, sec = 0;
    bool haveDate = false, haveTime = false;
    if (std::sscanf(spec, "%d-%d-%dT%d:%d:%d", &Y, &M, &D, &h, &m, &sec) == 6) {
        haveDate = haveTime = true;
    } else if (std::sscanf(spec, "%d-%d-%dT%d:%d", &Y, &M, &D, &h, &m) == 5) {
        haveDate = haveTime = true; sec = 0;
    } else if (std::sscanf(spec, "%d-%d-%d", &Y, &M, &D) == 3) {
        haveDate = true; h = m = sec = 0;
    } else if (std::sscanf(spec, "%d:%d:%d", &h, &m, &sec) == 3) {
        haveTime = true;
    } else if (std::sscanf(spec, "%d:%d", &h, &m) == 2) {
        haveTime = true; sec = 0;
    } else {
        return false;
    }
    std::time_t nowT = std::time(nullptr);
    std::tm tmv{};
#if defined(_WIN32)
    localtime_s(&tmv, &nowT);
#else
    localtime_r(&nowT, &tmv);
#endif
    if (haveDate) { tmv.tm_year = Y - 1900; tmv.tm_mon = M - 1; tmv.tm_mday = D; }
    if (haveTime || haveDate) { tmv.tm_hour = h; tmv.tm_min = m; tmv.tm_sec = sec; }
    tmv.tm_isdst = -1;
    std::time_t t = std::mktime(&tmv);
    if (t == static_cast<std::time_t>(-1)) return false;
    outMs = static_cast<int64_t>(t) * 1000;
    return true;
}

int main(int argc, char* argv[]) {
    if (argc < 3) {
        std::cerr << "Usage: rc2image input.rcd output.png [width height]"
                     " [--fit W H] [--clock SPEC] [--time epoch_ms] [--anim seconds]\n"
                     "  --fit W H  render onto a W x H surface with the document kept in its\n"
                     "             own coordinate space and scaled to fit, which is what every\n"
                     "             real player does. Without it the document is painted at its\n"
                     "             native size and the fit transform is never exercised.\n"
                     "  --clock    LOCK THE CLOCK. Without it every date and time variable\n"
                     "             reads the wall clock, so a document using continuousSec(),\n"
                     "             timeInSec(), the hour, the weekday or the month renders\n"
                     "             differently on every run and cannot be pixel-compared.\n"
                     "             SPEC is one of:\n"
                     "               HH:MM[:SS]            today at that local time\n"
                     "               YYYY-MM-DD            that date at midnight\n"
                     "               YYYY-MM-DDTHH:MM[:SS] that date and time\n"
                     "               @MILLIS               raw epoch milliseconds\n"
                     "             It pins the whole set together - continuousSec, seconds,\n"
                     "             minutes, hours, month, weekday, day of year and year all\n"
                     "             derive from the one instant, so they stay consistent.\n"
                     "  --time     the same thing in raw epoch milliseconds. --time 0 now\n"
                     "             pins to the epoch instead of silently not pinning.\n"
                     "  --anim     pins animationTime only, which is a different clock.\n"
                     "  --seed N   pin the random stream. rand() is seeded arbitrarily by\n"
                     "             default (matching the reference's lazy `new Random()`),\n"
                     "             so a document whose particles use rand() in their initial\n"
                     "             values renders differently on every run even with the\n"
                     "             clock pinned. A document that seeds itself still wins.\n";
        return 1;
    }

    const char* inputPath = argv[1];
    const char* outputPath = argv[2];
    int overrideWidth = 0, overrideHeight = 0;
    int fitWidth = 0, fitHeight = 0;   // --fit: surface size, document keeps its own space
    int64_t fixedTimeMs = 0;
    int32_t randSeed = 0;
    bool pinSeed = false;
    bool pinClock = false;   // whether a clock flag was GIVEN, not whether it
                             // was nonzero: --time 0 is a legitimate request
                             // to pin to the epoch, and treating it as 'unset'
                             // silently left the wall clock running.
    float animTimeSec = -1.0f;   // >=0 pins animationTime (seconds since first frame)

    // Parse remaining args
    int i = 3;
    while (i < argc) {
        if (std::strcmp(argv[i], "--fit") == 0 && i + 2 < argc) {
            fitWidth = std::atoi(argv[i + 1]);
            fitHeight = std::atoi(argv[i + 2]);
            i += 3;
        } else if (std::strcmp(argv[i], "--time") == 0 && i + 1 < argc) {
            fixedTimeMs = std::atoll(argv[i + 1]);
            pinClock = true;
            i += 2;
        } else if (std::strcmp(argv[i], "--clock") == 0 && i + 1 < argc) {
            if (!parseClockSpec(argv[i + 1], fixedTimeMs)) {
                std::cerr << "Error: --clock does not understand \"" << argv[i + 1]
                          << "\". Use HH:MM[:SS], YYYY-MM-DD, YYYY-MM-DDTHH:MM[:SS] "
                             "or @EPOCHMILLIS.\n";
                return 1;
            }
            pinClock = true;
            i += 2;
        } else if (std::strcmp(argv[i], "--seed") == 0 && i + 1 < argc) {
            randSeed = static_cast<int32_t>(std::atoll(argv[i + 1]));
            pinSeed = true;
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
    ifs.seekg(0, std::ios::end);
    std::vector<uint8_t> data(static_cast<size_t>(std::max<std::streamoff>(ifs.tellg(), 0)));
    ifs.seekg(0);
    if (!data.empty()) ifs.read(reinterpret_cast<char*>(data.data()), data.size());
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
    if (pinClock) {
        doc.setFixedTimeMs(fixedTimeMs);
    }
    // Seed before the first paint: particle initial values are drawn once, when the system
    // is created, so seeding after that would change nothing.
    if (pinSeed) {
        rccore::JavaRandom::seedFromBits(randSeed);
    }

    int width = overrideWidth > 0 ? overrideWidth : doc.getWidth();
    int height = overrideHeight > 0 ? overrideHeight : doc.getHeight();
    if (width <= 0) width = 600;
    if (height <= 0) height = 600;

    // --fit renders onto a surface of a different size than the document, with the document
    // left in its own coordinate space and a translate+scale mapping it in. That is what the
    // iOS/desktop players do, and it is a genuinely different code path for anything that
    // composites a buffer (3D blits at the origin of the DOCUMENT space, under the live CTM).
    int surfW = fitWidth  > 0 ? fitWidth  : width;
    int surfH = fitHeight > 0 ? fitHeight : height;
    float fitScale = 1.0f, fitOx = 0.0f, fitOy = 0.0f;
    if (fitWidth > 0 && fitHeight > 0) {
        fitScale = std::min((float) surfW / (float) width, (float) surfH / (float) height);
        fitOx = ((float) surfW - (float) width  * fitScale) * 0.5f;
        fitOy = ((float) surfH - (float) height * fitScale) * 0.5f;
    }

    // Create Skia surface
    SkImageInfo info = SkImageInfo::MakeN32Premul(surfW, surfH);
    auto surface = SkSurfaces::Raster(info);
    if (!surface) {
        std::cerr << "Error: failed to create Skia surface\n";
        return 1;
    }

    SkCanvas* canvas = surface->getCanvas();
    // White background (matches TS renderer)
    // RC_BG=transparent (or any 0xAARRGGBB hex) picks the clear colour; default stays white.
    {
        SkColor bg = SK_ColorWHITE;
        if (const char* e = std::getenv("RC_BG")) {
            if (std::strcmp(e, "transparent") == 0) bg = SK_ColorTRANSPARENT;
            else bg = static_cast<SkColor>(std::strtoul(e, nullptr, 16));
        }
        canvas->clear(bg);
    }
    if (fitWidth > 0 && fitHeight > 0) {
        canvas->translate(fitOx, fitOy);
        canvas->scale(fitScale, fitScale);
    }

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
