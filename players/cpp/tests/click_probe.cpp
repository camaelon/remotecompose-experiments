// Diagnostic: map click points to the named variables they change.
//
//   click_probe <doc.rc> [x y]
//
// With no point it sweeps a grid over the document and prints, for each row, which named
// variable a click at that point alters — a picture of where the hit regions actually are.
// With a point it reports just that click. Either way it names every variable that moved,
// so a single click that changes two of them is visible as such.

#include "rccore/WireBuffer.h"
#include "rccore/CoreDocument.h"
#include "rccore/RemoteContext.h"
#include "rccore/TimeVariables.h"
#include "rccore/operations/DrawOperations.h"
#include "rcskia/SkiaPaintContext.h"

#include "include/core/SkSurface.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkPixmap.h"

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <map>
#include <string>
#include <vector>
#include <thread>
#include <chrono>

static std::vector<uint8_t> readFile(const std::string& p) {
    std::ifstream f(p, std::ios::binary);
    return {std::istreambuf_iterator<char>(f), std::istreambuf_iterator<char>()};
}

static void collectNamed(const std::vector<std::unique_ptr<rccore::Operation>>& ops,
                         std::map<std::string, int>& out) {
    for (const auto& op : ops) {
        if (auto* nv = dynamic_cast<rccore::NamedVariable*>(op.get())) {
            if (nv->varType != 2) out[nv->varName] = nv->varId;   // floats, not colours
        }
        if (!op->mChildren.empty()) collectNamed(op->mChildren, out);
    }
}

int main(int argc, char** argv) {
    if (argc < 2) { std::fprintf(stderr, "usage: click_probe <doc.rc> [x y]\n"); return 2; }
    auto data = readFile(argv[1]);
    if (data.empty()) { std::fprintf(stderr, "cannot read %s\n", argv[1]); return 1; }

    rccore::WireBuffer buffer(data.data(), data.size());
    rccore::CoreDocument doc;
    if (!doc.initFromBuffer(buffer)) { std::fprintf(stderr, "parse failed\n"); return 1; }

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
    frame();

    std::map<std::string, int> named;
    collectNamed(doc.getOperations(), named);
    std::fprintf(stderr, "document %dx%d, %zu named floats:", W, H, named.size());
    for (auto& [n, id] : named) std::fprintf(stderr, " %s=%d", n.c_str(), id);
    std::fprintf(stderr, "\n\n");

    auto snapshot = [&] {
        std::map<std::string, float> s;
        for (auto& [n, id] : named) s[n] = ctx.getFloat(id);
        return s;
    };

    // Reports every variable that moved, so a click that changes two is visible.
    auto clickAt = [&](float x, float y) {
        auto before = snapshot();
        bool hit = doc.onClick(ctx, x, y);
        frame();
        auto after = snapshot();
        std::string changed;
        for (auto& [n, v] : after) {
            if (v != before[n]) {
                char buf[96];
                std::snprintf(buf, sizeof buf, "%s%s:%g->%g",
                              changed.empty() ? "" : " ", n.c_str(), before[n], v);
                changed += buf;
            }
        }
        return std::pair<bool, std::string>{hit, changed};
    };

    // "tap" replays what the GLFW loop actually does on a press-and-release (Callbacks.cpp):
    // touchDown on press, then touchUp *and* onClick on release. A plain onClick misses any
    // reaction coming from the touch half of that sequence.
    if (argc >= 5 && std::string(argv[2]) == "tap") {
        float x = std::atof(argv[3]), y = std::atof(argv[4]);
        auto before = snapshot();

        doc.updateTimeVariables(ctx);
        doc.touchDown(ctx, x, y);
        frame();
        doc.touchUp(ctx, x, y, 0.0f, 0.0f);     // a clean tap: zero velocity
        bool hit = doc.onClick(ctx, x, y);
        frame();

        std::printf("tap at (%g,%g) hit=%d\n", x, y, hit ? 1 : 0);
        for (auto& [n, id] : named) {
            float v = ctx.getFloat(id);
            if (v != before[n]) std::printf("  changed: %s %g -> %g\n", n.c_str(), before[n], v);
        }
        // A fling settles over time, so watch the scroll for a while after the release.
        auto it = named.find("scroll");
        if (it != named.end()) {
            std::printf("  scroll over the next 30 frames:");
            for (int i = 0; i < 30; ++i) {
                doc.updateTimeVariables(ctx);
                frame();
                if (i % 5 == 0) std::printf(" %g", ctx.getFloat(it->second));
            }
            std::printf("\n");
        }
        return 0;
    }

    // "shot" answers a different question from the others: not "did the variable change"
    // but "did the screen change". A filter whose value flips while the pixels stay put
    // looks exactly like a button that does nothing.
    if (argc >= 5 && std::string(argv[2]) == "shot") {
        float x = std::atof(argv[3]), y = std::atof(argv[4]);

        auto grab = [&] {
            SkPixmap pm;
            std::vector<uint32_t> px(static_cast<size_t>(W) * H, 0);
            SkImageInfo info = SkImageInfo::MakeN32Premul(W, H);
            surface->readPixels(info, px.data(), W * 4, 0, 0);
            return px;
        };
        auto before = grab();
        auto beforeVars = snapshot();

        bool hit = doc.onClick(ctx, x, y);
        frame();
        auto after = grab();

        // A visibility change is animated: the exiting component is held VISIBLE with a
        // fading alpha until the fade completes. That fade is driven by the animation
        // clock, so a harness that never advances time sees the component frozen on
        // screen. Advance it the way the viewer's frame loop does.
        // animationTime comes from the real clock, so real time has to pass: 24 frames
        // at 25ms is 600ms, comfortably past the ~300ms enter/exit fade.
        rccore::TimeVariables tv;
        for (int i = 0; i < 24; ++i) {
            std::this_thread::sleep_for(std::chrono::milliseconds(25));
            doc.updateTimeVariables(ctx);
            tv.updateTime(ctx, i * 0.025, 0.025);
            frame();
        }
        auto settled = grab();
        size_t sdiff = 0;
        for (size_t i = 0; i < before.size(); ++i) if (before[i] != settled[i]) ++sdiff;
        std::printf("  after advancing the clock 1.2s: %zu pixels differ from before\n", sdiff);

        size_t diff = 0;
        for (size_t i = 0; i < before.size(); ++i) if (before[i] != after[i]) ++diff;

        std::printf("shot at (%g,%g) hit=%d\n", x, y, hit ? 1 : 0);
        for (auto& [n, id] : named) {
            float v = ctx.getFloat(id);
            if (v != beforeVars[n]) std::printf("  var changed: %s %g -> %g\n", n.c_str(), beforeVars[n], v);
        }
        // The layout reads visibility with getInteger(); these values are written as
        // floats. Print both stores for a few ids to show whether they agree.
        for (const char* n : {"d1", "v0", "v1", "scroll"}) {
            auto it = named.find(n);
            if (it == named.end()) continue;
            std::printf("  %-7s float=%g  integer=%d\n", n,
                        ctx.getFloat(it->second), ctx.getInteger(it->second));
        }
        // Raw dumps, so the caller can see *what* is on screen, not just that it changed.
        auto dump = [&](const char* path, const std::vector<uint32_t>& px) {
            FILE* f = std::fopen(path, "wb");
            if (!f) return;
            std::fprintf(f, "P6\n%d %d\n255\n", W, H);
            for (uint32_t c : px) {   // N32 premul, BGRA on this platform
                unsigned char rgb[3] = {
                    static_cast<unsigned char>((c >> 16) & 0xFF),
                    static_cast<unsigned char>((c >> 8) & 0xFF),
                    static_cast<unsigned char>(c & 0xFF)};
                std::fwrite(rgb, 1, 3, f);
            }
            std::fclose(f);
        };
        dump("/tmp/rc_before.ppm", before);
        dump("/tmp/rc_after.ppm", after);
        std::printf("  pixels changed: %zu of %d (%.2f%%)\n",
                    diff, W * H, 100.0 * diff / (W * H));
        return 0;
    }

    if (argc >= 4) {
        float x = std::atof(argv[2]), y = std::atof(argv[3]);
        auto [hit, changed] = clickAt(x, y);
        std::printf("(%g,%g) hit=%d changed=[%s]\n", x, y, hit ? 1 : 0, changed.c_str());
        return 0;
    }

    const int step = 10;
    for (int y = step / 2; y < H; y += step) {
        std::string row;
        bool any = false;
        for (int x = step / 2; x < W; x += step) {
            auto [hit, changed] = clickAt(static_cast<float>(x), static_cast<float>(y));
            if (!changed.empty()) {
                any = true;
                // First token only, so the row stays one line wide.
                std::string first = changed.substr(0, changed.find(':'));
                int extra = 0;
                for (char c : changed) if (c == ' ') ++extra;
                char buf[64];
                std::snprintf(buf, sizeof buf, " x=%d:%s%s", x, first.c_str(),
                              extra ? "(+MULTI!)" : "");
                row += buf;
            }
        }
        if (any) std::printf("y=%3d%s\n", y, row.c_str());
    }
    return 0;
}
