#include "rcskia/RcDocumentHost.h"

#include "rcskia/SkiaPaintContext.h"
#include "rccore/CoreDocument.h"
#include "rccore/RemoteContext.h"
#include "rccore/WireBuffer.h"

#include "include/core/SkCanvas.h"
#include "include/core/SkMatrix.h"
#include "include/core/SkRect.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iterator>

namespace fs = std::filesystem;

namespace rcskia {

// A loaded nested document: its bytes, the document, its own context, and a paint context
// wrapping the host's canvas. Cached per component so we parse + build the font manager once.
struct RcDocumentHost::Nested {
    std::vector<uint8_t> data;
    std::unique_ptr<rccore::CoreDocument> doc;
    std::unique_ptr<rccore::RemoteContext> ctx;
    std::unique_ptr<SkiaPaintContext> paint;
    bool ok = false;
    // Updated each frame in drawCustom, for pointer hit-testing / coordinate mapping:
    SkRect boxScreen = SkRect::MakeEmpty();   // the component's box in window points
    SkMatrix winToNested;                     // window points → nested-doc coordinates
    bool painted = false;                     // laid out at least once this session
};

RcDocumentHost::RcDocumentHost() = default;
RcDocumentHost::~RcDocumentHost() = default;

void RcDocumentHost::reset() { mCaptured = nullptr; mDocs.clear(); }

// Match the normal render path (rc2image / viewer both paint with THEME_DARK).
static constexpr int THEME_DARK = -2;

bool RcDocumentHost::drawCustom(int componentId, const std::string& config,
                                rccore::PaintContext* pc, float w, float h, double timeSec) {
    if (w <= 0 || h <= 0) return false;

    // config is "rc:<path>" (or a bare path), with an optional "#<fit>" suffix
    // (fit | fill | native) overriding the host default.
    std::string path = config;
    auto colon = config.find(':');
    if (colon != std::string::npos && config.compare(0, colon, "rc") == 0) {
        path = config.substr(colon + 1);
    }
    std::string fit = mFit;
    auto hash = path.find('#');
    if (hash != std::string::npos) {
        fit = path.substr(hash + 1);
        path = path.substr(0, hash);
    }
    if (path.empty()) return false;

    auto* skpc = static_cast<SkiaPaintContext*>(pc);
    if (!skpc || !skpc->canvas()) return false;
    SkCanvas* canvas = skpc->canvas();

    auto it = mDocs.find(componentId);
    if (it == mDocs.end()) {
        auto nested = std::make_unique<Nested>();
        fs::path p(path);
        if (p.is_relative() && !mBaseDir.empty()) p = fs::path(mBaseDir) / p;
        std::ifstream f(p.string(), std::ios::binary);
        if (f) {
            nested->data.assign(std::istreambuf_iterator<char>(f),
                                std::istreambuf_iterator<char>());
        }
        if (!nested->data.empty()) {
            rccore::WireBuffer buffer(nested->data.data(), nested->data.size());
            nested->doc = std::make_unique<rccore::CoreDocument>();
            if (nested->doc->initFromBuffer(buffer)) {
                nested->ctx = std::make_unique<rccore::RemoteContext>();
                nested->paint = std::make_unique<SkiaPaintContext>(*nested->ctx, canvas);
                nested->ctx->setPaintContext(nested->paint.get());
                nested->ctx->setDocument(nested->doc.get());
                nested->ctx->mWidth = static_cast<float>(nested->doc->getWidth());
                nested->ctx->mHeight = static_cast<float>(nested->doc->getHeight());
                nested->doc->registerListeners(*nested->ctx);
                nested->doc->applyDataOperations(*nested->ctx, THEME_DARK);  // load text/bitmaps once
                nested->ok = true;
            }
        }
        it = mDocs.emplace(componentId, std::move(nested)).first;
    }

    Nested* n = it->second.get();
    if (!n->ok) return false;

    float docW = static_cast<float>(n->doc->getWidth());
    float docH = static_cast<float>(n->doc->getHeight());
    if (docW <= 0) docW = w;
    if (docH <= 0) docH = h;

    float s;
    if (fit == "fill")        s = std::max(w / docW, h / docH);
    else if (fit == "native") s = 1.0f;
    else                      s = std::min(w / docW, h / docH);   // fit (default)
    const float dw = docW * s, dh = docH * s;
    const float ox = (w - dw) * 0.5f, oy = (h - dh) * 0.5f;

    // Point the nested paint context at the current canvas (it may change across frames /
    // resizes) and frame-lock the sub-document to the host clock so animations stay in sync.
    n->paint->setCanvas(canvas);
    n->ctx->mWidth = docW;
    n->ctx->mHeight = docH;
    n->ctx->overrideFloat(rccore::RemoteContext::ID_ANIMATION_TIME,
                          static_cast<float>(timeSec));

    // The core has already translated the canvas so (0,0)..(w,h) is the component box; clip
    // to it and place the fitted document inside, then paint it in its own coordinate space.
    canvas->save();
    // Box in window points (for pointer hit-testing), captured before the fit transform.
    n->boxScreen = canvas->getTotalMatrix().mapRect(SkRect::MakeWH(w, h));
    canvas->clipRect(SkRect::MakeWH(w, h));
    canvas->translate(ox, oy);
    canvas->scale(s, s);
    // Full nested-coords → window-points matrix; invert for window → nested pointer mapping.
    if (!canvas->getTotalMatrix().invert(&n->winToNested)) n->winToNested.setIdentity();
    n->painted = true;
    n->doc->paint(*n->ctx, THEME_DARK);
    canvas->restore();
    return true;
}

// ── Pointer routing ─────────────────────────────────────────────────────
RcDocumentHost::Nested* RcDocumentHost::hit(float winX, float winY) {
    for (auto& [id, np] : mDocs) {
        if (np->ok && np->painted && np->boxScreen.contains(winX, winY)) return np.get();
    }
    return nullptr;
}

bool RcDocumentHost::pointerDown(float winX, float winY) {
    Nested* n = hit(winX, winY);
    if (getenv("RC_DEBUG_POINTER")) {
        fprintf(stderr, "[rcdoc] pointerDown win=(%.1f,%.1f) docs=%zu hit=%s\n",
                winX, winY, mDocs.size(), n ? "YES" : "no");
        for (auto& [id, np] : mDocs)
            fprintf(stderr, "        comp %d ok=%d painted=%d box=[%.1f,%.1f %.1f,%.1f]\n",
                    id, np->ok, np->painted, np->boxScreen.fLeft, np->boxScreen.fTop,
                    np->boxScreen.fRight, np->boxScreen.fBottom);
    }
    if (!n) { mCaptured = nullptr; return false; }
    SkPoint p = n->winToNested.mapPoint({winX, winY});
    n->doc->touchDown(*n->ctx, p.x(), p.y());
    mCaptured = n;                            // capture by pointer (id may be -1)
    return true;
}

void RcDocumentHost::pointerMove(float winX, float winY) {
    if (!mCaptured || !mCaptured->ok) return;
    SkPoint p = mCaptured->winToNested.mapPoint({winX, winY});
    if (getenv("RC_DEBUG_POINTER"))
        fprintf(stderr, "[rcdoc] pointerMove win=(%.1f,%.1f) -> nested=(%.1f,%.1f)\n",
                winX, winY, p.x(), p.y());
    mCaptured->doc->touchDrag(*mCaptured->ctx, p.x(), p.y());
}

void RcDocumentHost::pointerUp(float winX, float winY, float velX, float velY) {
    Nested* n = mCaptured;
    mCaptured = nullptr;
    if (!n || !n->ok) return;
    SkPoint p = n->winToNested.mapPoint({winX, winY});
    // Velocity is in window points/sec; scale into nested-doc units for a consistent fling.
    n->doc->touchUp(*n->ctx, p.x(), p.y(),
                    velX * n->winToNested.getScaleX(), velY * n->winToNested.getScaleY());
}

} // namespace rcskia
