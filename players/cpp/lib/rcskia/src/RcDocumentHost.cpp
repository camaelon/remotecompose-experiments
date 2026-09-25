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
#include <chrono>
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
    // `persist` embeds: kept across host-document switches and clocked from their own
    // start, so a film embedded on consecutive slides neither reloads nor rewinds.
    bool persist = false;
    std::chrono::steady_clock::time_point started{};
    // The document's own clock, stitched from the host clocks of the slides it lived on: the
    // host's time restarts with every slide, and the sum of the pieces is continuous. Kept
    // in host time rather than wall time so an export that runs off the clock still agrees.
    double hostLast = 0.0;
    double hostBase = 0.0;
    // The file a persistent document came from and its stamp when read: a deck rebuild
    // rewrites the file while the player is open, and the retire() on the next slide change
    // has to notice or the player keeps showing the old document indefinitely.
    std::filesystem::path file;
    std::filesystem::file_time_type fileTime{};
    std::uintmax_t fileSize = 0;

    bool fileChanged() const {
        if (file.empty()) return false;
        std::error_code ec;
        auto t = std::filesystem::last_write_time(file, ec);
        if (ec) return true;
        auto sz = std::filesystem::file_size(file, ec);
        if (ec) return true;
        return t != fileTime || sz != fileSize;
    }
};

RcDocumentHost::RcDocumentHost() = default;
RcDocumentHost::~RcDocumentHost() = default;

void RcDocumentHost::reset() { mCaptured = nullptr; mDocs.clear(); }

void RcDocumentHost::retire() {
    mCaptured = nullptr;
    for (auto it = mDocs.begin(); it != mDocs.end(); ) {
        if (it->second->persist && !it->second->fileChanged()) ++it; else it = mDocs.erase(it);
    }
}

// Match the normal render path (rc2image / viewer both paint with THEME_DARK).
static constexpr int THEME_DARK = -2;

bool RcDocumentHost::drawCustom(int componentId, const std::string& config,
                                rccore::PaintContext* pc, float w, float h, double timeSec) {
    if (w <= 0 || h <= 0) return false;

    // config is "rc:<path>" (or a bare path), with an optional "#k=v&k=v" suffix carrying a
    // `fit` (fit | fill | native) and/or a source `crop` (fractions l,t,r,b). A bare "#value"
    // is still read as the fit, for back-compat.
    std::string rest = config;
    auto colon = config.find(':');
    if (colon != std::string::npos && config.compare(0, colon, "rc") == 0) {
        rest = config.substr(colon + 1);
    }
    std::string fit = mFit;
    float crop[4] = {0.0f, 0.0f, 1.0f, 1.0f};
    float gate = 0.0f;   // skip painting until animTime >= gate (a "frozen" transition intro)
    // Slide-driven documents. `persist` keeps the document across slides on its own clock;
    // `step=N` is the slide's number for it, written each frame into the float variable
    // `stepid`; `timeid` names the float that receives the host's time (seconds since the
    // slide started). Ids are the document's own DATA_FLOAT ids — a plain-number variable
    // declared in its source; refract passes them through from the include options.
    bool persist = false;
    bool hasStep = false; float step = 0.0f; int stepId = -1, timeId = -1;
    std::string path = rest;
    auto hash = rest.find('#');
    if (hash != std::string::npos) {
        path = rest.substr(0, hash);
        std::string opts = rest.substr(hash + 1);
        for (size_t s0 = 0; s0 < opts.size(); ) {
            size_t amp = opts.find('&', s0);
            std::string tok = opts.substr(s0, amp == std::string::npos ? std::string::npos : amp - s0);
            auto eq = tok.find('=');
            if (eq == std::string::npos) {
                if (tok == "persist") persist = true;
                else if (!tok.empty()) fit = tok;                              // legacy bare fit
            } else {
                std::string k = tok.substr(0, eq), v = tok.substr(eq + 1);
                if (k == "fit") fit = v;
                else if (k == "persist") persist = (v != "0" && v != "false" && v != "off");
                else if (k == "step") { hasStep = true; step = std::strtof(v.c_str(), nullptr); persist = true; }
                else if (k == "stepid") stepId = std::atoi(v.c_str());
                else if (k == "timeid") timeId = std::atoi(v.c_str());
                else if (k == "gate") gate = std::strtof(v.c_str(), nullptr);
                else if (k == "crop") {
                    float t[4];
                    if (std::sscanf(v.c_str(), "%f,%f,%f,%f", &t[0], &t[1], &t[2], &t[3]) == 4)
                        for (int i = 0; i < 4; i++) crop[i] = t[i];
                }
            }
            if (amp == std::string::npos) break;
            s0 = amp + 1;
        }
    }
    if (path.empty()) return false;

    // Gated embed: during a slide's opening transition its expensive live content is skipped
    // (a static snapshot is shown over it instead — see refract's `freeze`), so the push stays
    // smooth. Once animTime passes the gate the real document paints and the snapshot fades.
    if (gate > 0.0f && timeSec < static_cast<double>(gate)) return true;

    auto* skpc = static_cast<SkiaPaintContext*>(pc);
    if (!skpc || !skpc->canvas()) return false;
    SkCanvas* canvas = skpc->canvas();

    const std::string key = persist ? ("persist:" + path) : config;
    auto it = mDocs.find(key);
    if (it == mDocs.end()) {
        auto nested = std::make_unique<Nested>();
        nested->persist = persist;
        nested->started = std::chrono::steady_clock::now();
        fs::path p(path);
        if (p.is_relative() && !mBaseDir.empty()) p = fs::path(mBaseDir) / p;
        if (persist) {
            std::error_code ec;
            nested->file = p;
            nested->fileTime = fs::last_write_time(p, ec);
            nested->fileSize = ec ? 0 : fs::file_size(p, ec);
        }
        std::ifstream f(p.string(), std::ios::binary);
        if (f) {
            f.seekg(0, std::ios::end);
            nested->data.resize(static_cast<size_t>(std::max<std::streamoff>(f.tellg(), 0)));
            f.seekg(0);
            if (!nested->data.empty())
                f.read(reinterpret_cast<char*>(nested->data.data()), nested->data.size());
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
        it = mDocs.emplace(key, std::move(nested)).first;
    }

    Nested* n = it->second.get();
    if (!n->ok) return false;

    float docW = static_cast<float>(n->doc->getWidth());
    float docH = static_cast<float>(n->doc->getHeight());
    if (docW <= 0) docW = w;
    if (docH <= 0) docH = h;

    // Source crop (fractions → nested coords). Only this region is shown, fitted to the box.
    const float cropX = crop[0] * docW, cropY = crop[1] * docH;
    float cropW = (crop[2] - crop[0]) * docW, cropH = (crop[3] - crop[1]) * docH;
    if (cropW <= 0 || cropH <= 0) { cropW = docW; cropH = docH; }

    float s;
    if (fit == "fill")        s = std::max(w / cropW, h / cropH);
    else if (fit == "native") s = 1.0f;
    else                      s = std::min(w / cropW, h / cropH);   // fit (default)
    const float dw = cropW * s, dh = cropH * s;
    const float ox = (w - dw) * 0.5f, oy = (h - dh) * 0.5f;

    // Point the nested paint context at the current canvas (it may change across frames /
    // resizes) and frame-lock the sub-document to the host clock so animations stay in sync.
    n->paint->setCanvas(canvas);
    n->ctx->mWidth = docW;
    n->ctx->mHeight = docH;
    // A persistent document keeps its own clock (seconds since it first loaded) so a slide
    // change neither restarts nor rewinds it; the host's slide clock still reaches it through
    // `timeid`, and the slide's number through `stepid`.
    double docTime = timeSec;
    if (n->persist) {
        if (timeSec + 1e-6 < n->hostLast) n->hostBase += n->hostLast;   // a new slide: carry on
        n->hostLast = timeSec;
        docTime = n->hostBase + timeSec;
    }
    n->ctx->overrideFloat(rccore::RemoteContext::ID_ANIMATION_TIME,
                          static_cast<float>(docTime));
    if (hasStep && stepId >= 0) n->ctx->overrideFloat(stepId, step);
    if (timeId >= 0) n->ctx->overrideFloat(timeId, static_cast<float>(timeSec));
    if (std::getenv("RC_EMBED_TRACE")) {
        std::fprintf(stderr, "[rc-embed] %s persist=%d step=%g(id %d) time=%g(id %d) docTime=%g -> f42=%g f43=%g\n",
                     config.c_str(), (int)n->persist, step, stepId, timeSec, timeId, docTime,
                     n->ctx->getFloat(42), n->ctx->getFloat(43));
        if (const char* w = std::getenv("RC_EMBED_WATCH")) {      // comma-separated float ids to print
            std::string ws = w; size_t p0 = 0;
            while (p0 < ws.size()) {
                size_t c = ws.find(',', p0); std::string tok = ws.substr(p0, c == std::string::npos ? std::string::npos : c - p0);
                int id = std::atoi(tok.c_str()); std::fprintf(stderr, "   f%d=%g", id, n->ctx->getFloat(id));
                if (c == std::string::npos) break; p0 = c + 1;
            }
            std::fprintf(stderr, "\n");
        }
    }

    // The core has already translated the canvas so (0,0)..(w,h) is the component box; clip
    // to it and place the fitted document inside, then paint it in its own coordinate space.
    canvas->save();
    // Box in window points (for pointer hit-testing), captured before the fit transform.
    n->boxScreen = canvas->getTotalMatrix().mapRect(SkRect::MakeWH(w, h));
    canvas->clipRect(SkRect::MakeWH(w, h));
    canvas->translate(ox, oy);
    canvas->scale(s, s);
    canvas->translate(-cropX, -cropY);       // shift so the crop region lands in the box
    // Full nested-coords → window-points matrix; invert for window → nested pointer mapping.
    if (!canvas->getTotalMatrix().invert(&n->winToNested)) n->winToNested.setIdentity();
    // Clip to the document's own bounds so draw instructions that spill past its design size
    // (e.g. a background shape larger than the doc) don't leak outside the embed.
    canvas->clipRect(SkRect::MakeWH(docW, docH));
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
        for (auto& [cfg, np] : mDocs)
            fprintf(stderr, "        %s ok=%d painted=%d box=[%.1f,%.1f %.1f,%.1f]\n",
                    cfg.c_str(), np->ok, np->painted, np->boxScreen.fLeft, np->boxScreen.fTop,
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
