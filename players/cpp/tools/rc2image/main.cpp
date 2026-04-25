#include "rccore/WireBuffer.h"
#include "rccore/CoreDocument.h"
#include "rccore/RemoteContext.h"
#include "rcskia/SkiaPaintContext.h"

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
        std::cerr << "Usage: rc2image input.rcd output.png [width height] [--time epoch_ms]\n";
        return 1;
    }

    const char* inputPath = argv[1];
    const char* outputPath = argv[2];
    int overrideWidth = 0, overrideHeight = 0;
    int64_t fixedTimeMs = 0;

    // Parse remaining args
    int i = 3;
    while (i < argc) {
        if (std::strcmp(argv[i], "--time") == 0 && i + 1 < argc) {
            fixedTimeMs = std::atoll(argv[i + 1]);
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

    // Set canvas dimensions before data pass
    context.mWidth = static_cast<float>(width);
    context.mHeight = static_cast<float>(height);

    // Register variable listeners
    doc.registerListeners(context);

    // Execute data operations (loads text, expressions, etc.)
    doc.applyDataOperations(context, -2);  // THEME_DARK

    // Paint (includes DATA re-eval + PAINT)
    doc.paint(context, -2);  // THEME_DARK

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
