// A CustomComponentHost that renders interactive web pages ("web:<url>") as native
// WKWebViews positioned over the slide at each component's on-screen bounds (macOS).
// Because it hooks the same LAYOUT_CUSTOM mechanism as video, a web page is embedded in
// the page layout — sized, placed, and following transitions — and is fully interactive.
#pragma once

#include "rccore/CustomComponentHost.h"

#include <string>

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
};
