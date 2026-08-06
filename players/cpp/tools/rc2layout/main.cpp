// rc2layout — dump the computed layout of a document as `id -> x,y,w,h`.
//
//   rc2layout input.rc [width height]
//
// Emits the same line format as the TypeScript `layout.mjs` and the Java `RcLayoutTest`
// so the three engines diff line by line:
//
//   LAYOUT id=<n> x=<f> y=<f> w=<f> h=<f>
//
// Layout is compared as numbers rather than pixels on purpose. A rendered diff shows that
// something moved but not which component owns it, and antialiasing hides small offsets
// while shouting about irrelevant ones.

#include "rccore/WireBuffer.h"
#include "rccore/CoreDocument.h"
#include "rccore/RemoteContext.h"
#include "rcskia/SkiaPaintContext.h"

#include "include/core/SkSurface.h"
#include "include/core/SkCanvas.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <vector>

int main(int argc, char* argv[]) {
    if (argc < 2) {
        std::cerr << "Usage: rc2layout input.rc [width height]\n";
        return 1;
    }
    const char* inputPath = argv[1];
    int overrideWidth = argc > 3 ? std::atoi(argv[2]) : 0;
    int overrideHeight = argc > 3 ? std::atoi(argv[3]) : 0;

    std::ifstream ifs(inputPath, std::ios::binary);
    if (!ifs) { std::cerr << "Error: cannot open " << inputPath << "\n"; return 1; }
    std::vector<uint8_t> data((std::istreambuf_iterator<char>(ifs)),
                               std::istreambuf_iterator<char>());
    ifs.close();
    if (data.empty()) { std::cerr << "Error: empty file\n"; return 1; }

    rccore::WireBuffer buffer(data.data(), data.size());
    rccore::CoreDocument doc;
    if (!doc.initFromBuffer(buffer)) {
        std::cerr << "Error: failed to parse " << inputPath << "\n";
        return 1;
    }

    int width = overrideWidth > 0 ? overrideWidth : doc.getWidth();
    int height = overrideHeight > 0 ? overrideHeight : doc.getHeight();
    if (width <= 0) width = 400;
    if (height <= 0) height = 400;

    SkImageInfo info = SkImageInfo::MakeN32Premul(width, height);
    auto surface = SkSurfaces::Raster(info);
    if (!surface) { std::cerr << "Error: failed to create Skia surface\n"; return 1; }
    SkCanvas* canvas = surface->getCanvas();
    canvas->clear(SK_ColorWHITE);

    rccore::RemoteContext context;
    rcskia::SkiaPaintContext paintCtx(context, canvas);
    context.setPaintContext(&paintCtx);
    context.setDocument(&doc);
    context.mWidth = static_cast<float>(width);
    context.mHeight = static_cast<float>(height);

    doc.registerListeners(context);
    doc.applyDataOperations(context, -2);
    // Two passes: a document whose size depends on a measured child is not settled until
    // the pass after the one that measured it.
    doc.paint(context, -2);
    doc.paint(context, -2);

    const auto& dims = context.getComponentDimensions();
    std::vector<int> ids;
    ids.reserve(dims.size());
    for (const auto& kv : dims) ids.push_back(kv.first);
    std::sort(ids.begin(), ids.end());

    for (int id : ids) {
        const auto& d = dims.at(id);
        std::printf("LAYOUT id=%d x=%.2f y=%.2f w=%.2f h=%.2f\n", id, d.x, d.y, d.w, d.h);
    }
    std::fprintf(stderr, "%zu components  %dx%d\n", ids.size(), width, height);
    return 0;
}
