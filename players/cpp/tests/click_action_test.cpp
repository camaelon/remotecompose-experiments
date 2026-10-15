// Regression test for click actions (MODIFIER_CLICK -> ValueFloatExpressionChange).
//
// fixtures/clicktest.rc has three buttons laid out in a row:
//   COUNT +1   n := n + 1      a counter, so a repeated action is visible as n == 2
//   TOGGLE     t := 1 - t      the shape the DroidKaigi filter chips use
//   RESET n    n := 0
//
// A counter is the point of the fixture. A toggle run twice lands back where it started,
// which looks like "the button does nothing" rather than "the action ran twice" — the
// DroidKaigi timetable's chips hid the bug that way.
//
// What the counter can and cannot see. ValueFloatExpressionChange writes
// `getFloat(exprId)`, and that is a cached map lookup — the expression `n + 1` is only
// recomputed when its op runs in the data/paint pass. So two runAction calls *inside one
// dispatch* both read the same cached value and write the same result: harmless, and
// invisible here. What this fixture does catch is a click delivered as two dispatches with
// a frame between them (press and release both firing, say), which is the shape that
// actually reaches the screen.
//
// Pure CPU (no GPU/GLFW). Returns 0 on success, 1 on any failed assertion.

#include "rccore/WireBuffer.h"
#include "rccore/CoreDocument.h"
#include "rccore/RemoteContext.h"
#include "rccore/operations/DrawOperations.h"
#include "rcskia/SkiaPaintContext.h"

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

// `export: true` emits a NAMED_VARIABLE op carrying the name and the float id, which is how
// the test reaches @n and @t without hardcoding ids that shift whenever the fixture changes.
static int findNamedId(const std::vector<std::unique_ptr<rccore::Operation>>& ops,
                       const std::string& want) {
    for (const auto& op : ops) {
        if (auto* nv = dynamic_cast<rccore::NamedVariable*>(op.get())) {
            if (nv->varName == want) return nv->varId;
        }
        if (!op->mChildren.empty()) {
            int id = findNamedId(op->mChildren, want);
            if (id >= 0) return id;
        }
    }
    return -1;
}

int main(int argc, char** argv) {
    std::string dir = (argc > 1) ? argv[1] : "tests/fixtures";
    auto data = readFile(dir + "/clicktest.rc");
    if (data.empty()) {
        std::fprintf(stderr, "FAIL: cannot read %s/clicktest.rc\n", dir.c_str());
        return 1;
    }

    rccore::WireBuffer buffer(data.data(), data.size());
    rccore::CoreDocument doc;
    CHECK(doc.initFromBuffer(buffer), "clicktest document parses");

    // Paint at the document's own size so document coordinates and surface coordinates
    // coincide and the button centres below are just the JSON's layout arithmetic.
    const int W = doc.getWidth(), H = doc.getHeight();
    CHECK(W == 400 && H == 340, "document is 400x340");

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
    frame();   // lays the tree out, so the buttons have bounds to hit-test against

    const int nId = findNamedId(doc.getOperations(), "n");
    const int tId = findNamedId(doc.getOperations(), "t");
    CHECK(nId >= 0, "@n is an exported named variable");
    CHECK(tId >= 0, "@t is an exported named variable");
    if (nId < 0 || tId < 0) return 1;

    // Button centres. The row is three 118-wide columns inside a 16-padded 400-wide
    // column, so it starts at (400 - 354) / 2 = 23 and each button centre is 59 further.
    // Vertically: 16 padding + title + 14 spacer puts the 44-high chips near y = 75.
    const float countX = 23 + 59, toggleX = 23 + 118 + 59, resetX = 23 + 236 + 59;
    const float btnY = 75;

    CHECK(ctx.getFloat(nId) == 0.0f, "n starts at 0");
    CHECK(ctx.getFloat(tId) == 0.0f, "t starts at 0");

    // ── One click on COUNT must add exactly one ──────────────────────────
    bool hit = doc.onClick(ctx, countX, btnY);
    CHECK(hit, "a click on COUNT hits a component");
    frame();
    float afterOne = ctx.getFloat(nId);
    std::fprintf(stderr, "      n after one click = %g\n", afterOne);
    CHECK(afterOne == 1.0f, "one click on COUNT leaves n == 1");

    // ── And repeated clicks keep adding one each ─────────────────────────
    doc.onClick(ctx, countX, btnY);
    frame();
    doc.onClick(ctx, countX, btnY);
    frame();
    float afterThree = ctx.getFloat(nId);
    std::fprintf(stderr, "      n after three clicks = %g\n", afterThree);
    CHECK(afterThree == 3.0f, "three clicks on COUNT leave n == 3");

    // ── Painting alone must not run the action ───────────────────────────
    // The action op has both apply() and runAction(); if the paint pass reaches the ones
    // parked inside a click modifier, the counter climbs with no input at all.
    for (int i = 0; i < 5; ++i) frame();
    float afterIdle = ctx.getFloat(nId);
    std::fprintf(stderr, "      n after 5 idle frames = %g\n", afterIdle);
    CHECK(afterIdle == afterThree, "five frames with no click leave n unchanged");

    // ── The toggle shape, the one the timetable chips use ────────────────
    doc.onClick(ctx, toggleX, btnY);
    frame();
    CHECK(ctx.getFloat(tId) == 1.0f, "one click on TOGGLE leaves t == 1");
    doc.onClick(ctx, toggleX, btnY);
    frame();
    CHECK(ctx.getFloat(tId) == 0.0f, "a second click on TOGGLE leaves t == 0");

    // ── RESET, and a miss ────────────────────────────────────────────────
    doc.onClick(ctx, resetX, btnY);
    frame();
    CHECK(ctx.getFloat(nId) == 0.0f, "RESET sets n back to 0");

    doc.onClick(ctx, countX, static_cast<float>(H) - 4);   // below every button
    frame();
    CHECK(ctx.getFloat(nId) == 0.0f, "a click away from the buttons changes nothing");

    std::fprintf(stderr, failures ? "\n%d FAILURE(S)\n" : "\nALL PASSED\n", failures);
    return failures ? 1 : 0;
}
