// The custom-component hosts to use when a document is painted *off screen* — a PDF page,
// a presenter preview, a thumbnail.
//
// The live hosts are no use there. The video host drives an AVFoundation player
// asynchronously and paints nothing in a one-shot render; the web host places a native view
// over a window, and an off-screen render has no window. Registering nothing at all is
// worse: every embed silently draws as an empty box, so a slide built around a demo comes
// out blank in exactly the place that mattered.
//
// This substitutes what *can* be drawn synchronously:
//   rc:     embedded documents render for real (pure Skia, so they stay vector in a PDF)
//   video:  embedded clips contribute their poster frame, decoded once and cached
//   web:    left blank — a WKWebView cannot paint into a raster surface
#pragma once

#include <memory>
#include <string>

namespace rccore { class RemoteContext; }

namespace rcplayer {

class StillHosts {
public:
    // `baseDir` is the directory the document's relative embed paths ("media/<name>.rc")
    // resolve against — normally the directory holding the slide.
    explicit StillHosts(const std::string& baseDir);
    ~StillHosts();

    StillHosts(const StillHosts&) = delete;
    StillHosts& operator=(const StillHosts&) = delete;

    // Register on a context, before its data pass. The StillHosts must outlive the context.
    void installOn(rccore::RemoteContext& ctx);

private:
    struct Impl;
    std::unique_ptr<Impl> mImpl;
};

}  // namespace rcplayer
