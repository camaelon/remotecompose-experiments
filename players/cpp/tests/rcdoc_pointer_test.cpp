// Regression test for RcDocumentHost pointer routing (embedded ".rc" sub-document drags).
//
// Loads a host document (fixtures/host.rc) that embeds fixtures/media/nested.rc, paints it
// on a raster surface so the host captures the embed's on-screen box, then exercises the
// pointer API. The key regression: refract's custom components carry componentId == -1, so a
// press that hit-tests the embed must still make isCapturing() true (it was mistakenly gated
// on `id >= 0`, which dropped every drag).
//
// Pure CPU (no GPU/GLFW). Returns 0 on success, 1 on any failed assertion.

#include "rccore/WireBuffer.h"
#include "rccore/CoreDocument.h"
#include "rccore/RemoteContext.h"
#include "rcskia/SkiaPaintContext.h"
#include "rcskia/RcDocumentHost.h"

#include "include/core/SkSurface.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkImageInfo.h"

#include <cstdio>
#include <fstream>
#include <string>
#include <vector>

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { std::fprintf(stderr, "FAIL: %s\n", msg); ++failures; } \
    else         { std::fprintf(stderr, "ok:   %s\n", msg); } \
} while (0)

static std::vector<uint8_t> readFile(const std::string& p) {
    std::ifstream f(p, std::ios::binary);
    return {std::istreambuf_iterator<char>(f), std::istreambuf_iterator<char>()};
}

int main(int argc, char** argv) {
    // The fixtures directory is passed by CTest (WORKING_DIRECTORY) or as argv[1].
    std::string dir = (argc > 1) ? argv[1] : "tests/fixtures";
    auto data = readFile(dir + "/host.rc");
    if (data.empty()) { std::fprintf(stderr, "FAIL: cannot read %s/host.rc\n", dir.c_str()); return 1; }

    const int W = 1600, H = 900;
    rccore::WireBuffer buffer(data.data(), data.size());
    rccore::CoreDocument doc;
    CHECK(doc.initFromBuffer(buffer), "host document parses");

    auto surface = SkSurfaces::Raster(SkImageInfo::MakeN32Premul(W, H));
    SkCanvas* canvas = surface->getCanvas();
    canvas->clear(SK_ColorBLACK);

    rccore::RemoteContext ctx;
    rcskia::SkiaPaintContext paint(ctx, canvas);
    ctx.setPaintContext(&paint);
    ctx.setDocument(&doc);
    ctx.mWidth = static_cast<float>(W);
    ctx.mHeight = static_cast<float>(H);

    rcskia::RcDocumentHost host;
    host.setBaseDir(dir);          // resolves "rc:media/nested.rc" → dir/media/nested.rc
    ctx.setCustomHost(&host);

    doc.registerListeners(ctx);
    doc.applyDataOperations(ctx, -2);
    doc.paint(ctx, -2);            // paints → drawCustom captures the embed's box

    // 1. A press on the embed (centre of the slide, below the title) captures the drag —
    //    even though the component id is -1. This is the core regression.
    bool captured = host.pointerDown(W * 0.5f, H * 0.6f);
    CHECK(captured, "pointerDown on the embed captures");
    CHECK(host.isCapturing(), "isCapturing() is true after a capturing press (id == -1)");

    // 2. Drag + release route without crashing and end the capture.
    host.pointerMove(W * 0.5f + 30, H * 0.6f + 10);
    host.pointerUp(W * 0.5f + 30, H * 0.6f + 10, 0, 0);
    CHECK(!host.isCapturing(), "isCapturing() is false after release");

    // 3. A press well outside any embed does not capture.
    bool outside = host.pointerDown(-100.0f, -100.0f);
    CHECK(!outside, "pointerDown outside every embed does not capture");
    CHECK(!host.isCapturing(), "isCapturing() stays false for a miss");

    std::fprintf(stderr, failures ? "\n%d FAILURE(S)\n" : "\nALL PASSED\n", failures);
    return failures ? 1 : 0;
}
