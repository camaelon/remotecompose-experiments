// A CustomComponentHost that renders interactive web pages ("web:<url>") as native
// WKWebViews positioned over the slide at each component's on-screen bounds (macOS).
// Because it hooks the same LAYOUT_CUSTOM mechanism as video, a web page is embedded in
// the page layout — sized, placed, and following transitions — and is fully interactive.
#pragma once

#include "rccore/CustomComponentHost.h"

#include "include/core/SkRefCnt.h"

#include <cstdint>
#include <string>

class SkImage;

struct GLFWwindow;

class WebCustomHost : public rccore::CustomComponentHost {
public:
    // Window whose content view hosts the web views.
    void setWindow(GLFWwindow* window);

    // Frame bracketing: call beginFrame() before painting the document and endFrame()
    // after. Web views not drawn between them (i.e. not on the current slide) are hidden.
    void beginFrame();
    void endFrame();

    // Destroy every web view (e.g. on shutdown).
    void reset();

    bool drawCustom(int componentId, const std::string& config,
                    rccore::PaintContext* pc, float w, float h, double timeSec) override;

    // The last picture taken of a page, or null where this player has never shown it. A
    // native view is not in the window's pixels and cannot be painted into an off-screen
    // surface at all, so anything drawing a slide somewhere else — the deck view's stills,
    // the presenter's next-slide pane — asks for this instead of drawing a hole. Safe to
    // call from any thread: the picture is immutable, and the lookup is locked.
    static sk_sp<SkImage> pageSnapshot(const std::string& url);

    // Counts news about pages: the first few pictures of each one. A still drawn before its
    // page had been seen shows the marked frame and is then cached, so a host that keeps
    // stills watches this and throws them away when it changes. Not every snapshot — a page
    // settles within a second or two and the stills are then left alone.
    static uint64_t pagesPictured();
};
