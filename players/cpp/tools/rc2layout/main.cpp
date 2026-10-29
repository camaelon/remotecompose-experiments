// rc2layout — dump the computed layout of a document as `id -> x,y,w,h`.
//
//   rc2layout input.rc [width height] [--density D] [--anim] [STEP]...
//
// STEPs (layout-specs' interactive cases), applied in order after the first layout, on a
// manual clock that only moves when a step moves it (16 ms per painted frame when settling):
//   --click X Y          click at document coordinates, then settle
//   --click-frame X Y    click, then paint a single frame (leaves an animation in flight)
//   --advance MS         move the clock MS milliseconds and paint one frame
//   --settle             paint every 16 ms until nothing asks for a repaint (200 frames max)
//   --resize W H         re-lay out at a new size, then settle
// --anim enables layout animations (off by default, as the spec harness does). With any of
// these the first layout settles too, rather than painting twice.
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
#include "rccore/operations/LayoutOperations.h"
#include "rcskia/SkiaPaintContext.h"

#include "include/core/SkSurface.h"
#include "include/core/SkCanvas.h"

#include <algorithm>
#include <cmath>
#include <string>
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
    float density = 1.0f;
    bool anim = false;
    struct Step { std::string kind; float a = 0, b = 0; };
    std::vector<Step> steps;
    std::vector<const char*> pos;
    for (int i = 2; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--density" && i + 1 < argc) density = std::atof(argv[++i]);
        else if (a == "--anim") anim = true;
        else if ((a == "--click" || a == "--click-frame" || a == "--resize") && i + 2 < argc) {
            steps.push_back({a, (float)std::atof(argv[i + 1]), (float)std::atof(argv[i + 2])});
            i += 2;
        } else if (a == "--advance" && i + 1 < argc) {
            steps.push_back({a, (float)std::atof(argv[++i]), 0});
        } else if (a == "--settle") steps.push_back({a, 0, 0});
        else pos.push_back(argv[i]);
    }
    const bool scripted = anim || !steps.empty();
    if (!(density > 0.0f)) density = 1.0f;
    int overrideWidth = pos.size() >= 2 ? std::atoi(pos[0]) : 0;
    int overrideHeight = pos.size() >= 2 ? std::atoi(pos[1]) : 0;

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
    if (doc.getDensityBehavior() == 2) {   // RemoteContext.header: the size is in dp
        if (overrideWidth <= 0) width = (int)std::lround(width * density);
        if (overrideHeight <= 0) height = (int)std::lround(height * density);
    }
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
    context.mDensity = density;

    doc.registerListeners(context);
    rccore::setLayoutAnimationEnabled(anim);
    double clockMs = 0;   // the manual clock: animationTime is clockMs / 1000
    auto paint = [&]() {
        context.overrideFloat(rccore::RemoteContext::ID_ANIMATION_TIME, (float)(clockMs / 1000.0));
        doc.paint(context, -2);
        return paintCtx.doesNeedsRepaint();
    };
    auto settle = [&]() {
        bool again = paint();
        for (int n = 0; again && n < 200; n++) { clockMs += 16; again = paint(); }
    };
    if (scripted) context.overrideFloat(rccore::RemoteContext::ID_ANIMATION_TIME, 0.0f);
    doc.applyDataOperations(context, -2);
    // Two passes: a document whose size depends on a measured child is not settled until
    // the pass after the one that measured it.
    if (!scripted) {
        doc.paint(context, -2);
        doc.paint(context, -2);
    } else {
        paint();
        settle();
        for (const auto& st : steps) {
            if (st.kind == "--click" || st.kind == "--click-frame") {
                doc.onClick(context, st.a, st.b);
                if (st.kind == "--click") settle(); else paint();
            } else if (st.kind == "--advance") {
                clockMs += st.a;
                paint();
            } else if (st.kind == "--settle") {
                settle();
            } else if (st.kind == "--resize") {
                width = (int)st.a; height = (int)st.b;
                surface = SkSurfaces::Raster(SkImageInfo::MakeN32Premul(width, height));
                canvas = surface->getCanvas();
                paintCtx.setCanvas(canvas);
                context.mWidth = (float)width;
                context.mHeight = (float)height;
                doc.applyDataOperations(context, -2);
                settle();
            }
        }
    }

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
