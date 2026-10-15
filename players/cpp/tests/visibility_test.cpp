// Regression test for MODIFIER_VISIBILITY actually reaching the screen.
//
// Two fixtures, same document with one difference — the initial value of @t:
//   clicktest_vis.rc   t = 0  the box starts hidden; a click must make it APPEAR  (entering)
//   clicktest_vis1.rc  t = 1  the box starts shown;  a click must make it VANISH  (exiting)
//
// Entering used to pass and exiting used to fail, which is the asymmetry worth pinning
// down. An exiting component is deliberately held VISIBLE at its old bounds while its
// alpha fades, but the measure pass goes on reporting GONE underneath; comparing the fresh
// measurement against that held frame restarted the animation on every frame, so the fade
// never finished and the component stayed on screen for good. The visible symptom was a
// filter chip that highlighted while the list it filtered never changed.
//
// The assertion is on PIXELS, not on the variable. The variable was always correct — it
// was the screen that did not follow, so a test that only checked @t would have passed
// throughout the bug.
//
// Real time has to pass: animationTime comes from the system clock, so the fade cannot
// complete in a loop that runs in microseconds.

#include "rccore/WireBuffer.h"
#include "rccore/CoreDocument.h"
#include "rccore/RemoteContext.h"
#include "rccore/TimeVariables.h"
#include "rcskia/SkiaPaintContext.h"

#include "include/core/SkSurface.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkImageInfo.h"

#include <chrono>
#include <cstdio>
#include <fstream>
#include <string>
#include <thread>
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

// Clicks the TOGGLE button, lets the fade run, and returns how many pixels ended up
// different from before the click.
static size_t pixelsChangedByClick(const std::string& path, const char* label) {
    auto data = readFile(path);
    if (data.empty()) {
        std::fprintf(stderr, "FAIL: cannot read %s\n", path.c_str());
        ++failures;
        return 0;
    }

    rccore::WireBuffer buffer(data.data(), data.size());
    rccore::CoreDocument doc;
    if (!doc.initFromBuffer(buffer)) {
        std::fprintf(stderr, "FAIL: %s does not parse\n", label);
        ++failures;
        return 0;
    }

    const int W = doc.getWidth(), H = doc.getHeight();
    auto surface = SkSurfaces::Raster(SkImageInfo::MakeN32Premul(W, H));
    SkCanvas* canvas = surface->getCanvas();

    rccore::RemoteContext ctx;
    rcskia::SkiaPaintContext paint(ctx, canvas);
    ctx.setPaintContext(&paint);
    ctx.setDocument(&doc);
    ctx.mWidth = static_cast<float>(W);
    ctx.mHeight = static_cast<float>(H);
    doc.registerListeners(ctx);

    auto frame = [&] {
        canvas->clear(SK_ColorBLACK);
        doc.applyDataOperations(ctx, -2);
        doc.paint(ctx, -2);
    };
    auto grab = [&] {
        std::vector<uint32_t> px(static_cast<size_t>(W) * H, 0);
        surface->readPixels(SkImageInfo::MakeN32Premul(W, H), px.data(), W * 4, 0, 0);
        return px;
    };

    frame();
    auto before = grab();

    doc.onClick(ctx, 150, 35);          // centre of the TOGGLE button

    // 24 frames at 25ms is 600ms, comfortably past the ~300ms enter/exit fade.
    rccore::TimeVariables tv;
    for (int i = 0; i < 24; ++i) {
        std::this_thread::sleep_for(std::chrono::milliseconds(25));
        doc.updateTimeVariables(ctx);
        tv.updateTime(ctx, i * 0.025, 0.025);
        frame();
    }
    auto after = grab();

    size_t diff = 0;
    for (size_t i = 0; i < before.size(); ++i) if (before[i] != after[i]) ++diff;
    std::fprintf(stderr, "      %-9s %zu of %d pixels changed\n", label, diff, W * H);
    return diff;
}

int main(int argc, char** argv) {
    std::string dir = (argc > 1) ? argv[1] : "tests/fixtures";

    // The box is 200x160, so a working toggle moves ~32000 pixels. The threshold is set
    // well below that and well above the few hundred a button's own repaint accounts for,
    // so neither a stray antialiasing difference nor the button alone can satisfy it.
    const size_t kBox = 20000;

    size_t entering = pixelsChangedByClick(dir + "/clicktest_vis.rc", "entering");
    CHECK(entering > kBox, "a click makes a hidden component appear");

    size_t exiting = pixelsChangedByClick(dir + "/clicktest_vis1.rc", "exiting");
    CHECK(exiting > kBox, "a click makes a visible component disappear");

    std::fprintf(stderr, failures ? "\n%d FAILURE(S)\n" : "\nALL PASSED\n", failures);
    return failures ? 1 : 0;
}
