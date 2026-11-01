// A drag on one Slider must move that slider only, with and without a scrolling parent, and at
// its displayed position once the parent has scrolled (TouchExpression.touchDown hit-tests the
// component the expression belongs to; the expected values come from the Java reference).
//
//   slider_touch_test <fixtures>                 run the regression
//   slider_touch_test --dump DOC.rc W H EV...    EV = down|move|up X Y; prints each expression
#include "rccore/WireBuffer.h"
#include "rccore/CoreDocument.h"
#include "rccore/RemoteContext.h"
#include "rccore/operations/AdvancedOperations.h"
#include "rcskia/SkiaPaintContext.h"

#include "include/core/SkSurface.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkImageInfo.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <string>
#include <vector>

using Ops = std::vector<std::unique_ptr<rccore::Operation>>;

static void collect(const Ops& ops, std::vector<int>& out) {
    for (const auto& op : ops) {
        if (auto* t = dynamic_cast<rccore::TouchExpressionOp*>(op.get())) out.push_back(t->id);
        if (!op->mChildren.empty()) collect(op->mChildren, out);
    }
}

struct Ev { std::string type; float x, y; };

// The value of each touch expression, in document order, after the events.
static std::vector<std::pair<int, float>> run(const std::string& path, int W, int H, const std::vector<Ev>& events) {
    std::ifstream f(path, std::ios::binary);
    std::vector<uint8_t> data{std::istreambuf_iterator<char>(f), std::istreambuf_iterator<char>()};
    if (data.empty()) { std::fprintf(stderr, "cannot read %s\n", path.c_str()); std::exit(1); }
    rccore::WireBuffer buffer(data.data(), data.size());
    rccore::CoreDocument doc;
    if (!doc.initFromBuffer(buffer)) { std::fprintf(stderr, "parse failed\n"); std::exit(1); }
    auto surface = SkSurfaces::Raster(SkImageInfo::MakeN32Premul(W, H));
    SkCanvas* canvas = surface->getCanvas();
    rccore::RemoteContext ctx;
    rcskia::SkiaPaintContext paint(ctx, canvas);
    ctx.setPaintContext(&paint);
    ctx.setDocument(&doc);
    ctx.mWidth = (float)W;
    ctx.mHeight = (float)H;
    doc.registerListeners(ctx);
    float now = 0;
    auto frame = [&] {
        now += 0.016f;
        ctx.loadFloat(rccore::RemoteContext::ID_ANIMATION_TIME, now);
        canvas->clear(SK_ColorBLACK);
        doc.applyDataOperations(ctx, -2);
        doc.paint(ctx, -2);
    };
    for (int i = 0; i < 5; i++) frame();
    for (const auto& e : events) {
        if (e.type == "down") doc.touchDown(ctx, e.x, e.y);
        else if (e.type == "move") doc.touchDrag(ctx, e.x, e.y);
        else doc.touchUp(ctx, e.x, e.y, 0, 0);
        frame();
    }
    for (int i = 0; i < 200; i++) frame();   // the release's easing ends
    std::vector<int> ids;
    collect(doc.getOperations(), ids);
    std::vector<std::pair<int, float>> r;
    for (int id : ids) r.push_back({id, ctx.getFloat(id)});
    return r;
}

static std::vector<Ev> drag(float x0, float y0, float x1, float y1) {
    return {{"down", x0, y0}, {"move", x1, y1}, {"up", x1, y1}};
}

static int failures = 0;
// `want`: expected values of the sliders (the expressions after the scroll's, if any).
static void check(const char* name, const std::string& path, int H, const std::vector<Ev>& ev, const std::vector<float>& want) {
    auto got = run(path, 300, H, ev);
    size_t skip = got.size() - want.size();
    bool ok = true;
    for (size_t i = 0; i < want.size(); i++) ok = ok && std::fabs(got[i + skip].second - want[i]) < 0.01f;
    std::printf("%s %s:", ok ? "ok  " : "FAIL", name);
    for (size_t i = skip; i < got.size(); i++) std::printf(" %.3f", got[i].second);
    std::printf("\n");
    if (!ok) failures++;
}

int main(int argc, char** argv) {
    if (argc >= 5 && !std::strcmp(argv[1], "--dump")) {
        std::vector<Ev> ev;
        for (int i = 5; i + 2 < argc; i += 3) ev.push_back({argv[i], (float)atof(argv[i + 1]), (float)atof(argv[i + 2])});
        for (auto& [id, v] : run(argv[2], atoi(argv[3]), atoi(argv[4]), ev)) std::printf("TE id=%d v=%.3f\n", id, v);
        return 0;
    }
    if (argc < 2) { std::fprintf(stderr, "usage: slider_touch_test <fixtures>\n"); return 2; }
    const std::string plain = std::string(argv[1]) + "/slider_rows.rc";    // 8 sliders, 40 high
    const std::string scroll = std::string(argv[1]) + "/slider_rows_scroll.rc";   // verticalScroll
    const std::vector<float> rest = {70, 40, 20, 10, 30, 50, 60, 80};
    const std::vector<float> row2 = {70, 21.053f, 20, 10, 30, 50, 60, 80};
    check("drag on row 2", plain, 200, drag(180, 60, 60, 60), row2);
    check("press below every row", plain, 400, drag(180, 380, 60, 380), rest);
    check("drag on row 2, in a scroll", scroll, 200, drag(180, 60, 60, 60), row2);
    // Scrolled by 60: the row displayed at y=60 is row 4 (index 3), whose first drag took it to 100.
    std::vector<Ev> scrolled = {{"down", 285, 150}, {"move", 285, 120}, {"move", 285, 90}, {"up", 285, 90}};
    for (const auto& e : drag(180, 60, 60, 60)) scrolled.push_back(e);
    check("drag at its displayed position, scrolled by 60", scroll, 200, scrolled,
          {70, 40, 20, 21.053f, 30, 50, 60, 80});
    return failures ? 1 : 0;
}
