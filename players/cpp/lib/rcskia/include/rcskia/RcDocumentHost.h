// A CustomComponentHost that embeds a prebuilt RemoteCompose document ("rc:<file>") as a
// nested, live sub-document. It loads the referenced .rc into its own CoreDocument +
// RemoteContext and paints it — fit into the component's box — reusing the host's SkCanvas.
//
// Because each nested document runs in its OWN RemoteContext there are no id collisions
// with the host, and because it is pure Skia (no native deps) it works in both rc2image and
// the interactive viewer. Registered on the RemoteContext so LAYOUT_CUSTOM (op 93) draws
// whose config starts with "rc:" are routed here (see the viewer's CustomHostRouter).
#pragma once

#include "rccore/CustomComponentHost.h"

#include <memory>
#include <string>
#include <unordered_map>

namespace rccore { class CoreDocument; class RemoteContext; class PaintContext; }

namespace rcskia {

class RcDocumentHost : public rccore::CustomComponentHost {
public:
    RcDocumentHost();
    ~RcDocumentHost() override;

    // Base directory for resolving relative "rc:<file>" paths (the slide directory).
    void setBaseDir(const std::string& dir) { mBaseDir = dir; }
    // How the nested document is scaled into its box: "fit" (default, aspect-preserved,
    // centred), "fill" (cover), or "native" (1:1, top-left).
    void setFit(const std::string& fit) { mFit = fit; }
    // Drop cached nested documents — call on host-document switch.
    void reset();

    bool drawCustom(int componentId, const std::string& config,
                    rccore::PaintContext* pc, float w, float h, double timeSec) override;

    // Pointer routing so an embedded doc is interactive (e.g. drag to rotate a 3D plot).
    // Coordinates are in window points, the same space the viewer's mouse callbacks use.
    // pointerDown returns true if the point landed on an embedded doc (which then captures
    // the drag until pointerUp), so the caller can skip forwarding it to the host document.
    bool pointerDown(float winX, float winY);
    void pointerMove(float winX, float winY);
    void pointerUp(float winX, float winY, float velX, float velY);
    bool isCapturing() const { return mCaptured != nullptr; }

private:
    struct Nested;
    Nested* hit(float winX, float winY);   // embedded doc under a window point, or null
    // Keyed by the config string (unique per file+options), NOT componentId — refract's
    // custom components all carry id -1, so keying by id makes every embed on a slide alias
    // to one nested document.
    std::unordered_map<std::string, std::unique_ptr<Nested>> mDocs;
    std::string mBaseDir;
    std::string mFit = "fit";
    // The embedded doc currently receiving a drag (captured on press). Tracked by pointer,
    // not component id — refract's custom components carry id -1, which a >=0 sentinel would
    // mistake for "not capturing". The Nested is heap-owned by mDocs, so the pointer stays
    // valid across map rehashes; it's cleared on release and on reset().
    Nested* mCaptured = nullptr;
};

} // namespace rcskia
