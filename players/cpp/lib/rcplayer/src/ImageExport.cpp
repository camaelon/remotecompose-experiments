#include "rcplayer/ImageExport.h"

#include "rcplayer/CpuRenderBackend.h"
#include "rcplayer/MediaTypes.h"
#include "rcplayer/Player.h"

#include "rccore/CoreDocument.h"
#include "rccore/RemoteContext.h"

#include <filesystem>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

namespace fs = std::filesystem;

namespace rcplayer {

ImageExportResult exportDeckToImages(const std::string& input, const std::string& outputDir,
                                     int width, int height, double delaySec) {
    ImageExportResult result;

    std::vector<std::string> entries = collectDeckEntries(input);
    if (entries.empty()) {
        std::cerr << "No playable files found in " << input << "\n";
        return result;
    }

    std::error_code ec;
    fs::create_directories(outputDir, ec);

    // CPU raster: there is no window to present into, and a still does not need the GPU.
    g.backend = std::make_unique<CpuRenderBackend>();

    for (const auto& entry : entries) {
        const std::string stem = fs::path(baseName(entry)).stem().string();
        const std::string outPath = (fs::path(outputDir) / (stem + ".png")).string();

        ensureSurface(width, height);
        if (!loadFile(entry)) {
            std::cerr << "FAIL: " << stem << "\n";
            result.failures++;
            continue;
        }

        // Walk the animation forward frame by frame rather than jumping to the end: a
        // slide's opening transition carries state between frames, and a single paint at
        // the end time lands mid-transition.
        const double step = 1.0 / 60.0;
        if (g.doc && g.context) {
            for (double t = 0.0; t < delaySec; t += step) {
                g.animTime = t;
                g.timeVars.updateTime(*g.context, t, step);
                g.doc->paint(*g.context);
            }
        }
        g.animTime = delaySec;
        renderFrame(step);

        if (saveScreenshot(outPath)) {
            std::cout << outPath << "\n";
            result.images++;
        } else {
            std::cerr << "FAIL write: " << outPath << "\n";
            result.failures++;
        }
    }

    g.zip.reset();
    std::cerr << "Done: " << result.images << " images written to " << outputDir
              << " (" << result.failures << " failures)\n";
    return result;
}

}  // namespace rcplayer
