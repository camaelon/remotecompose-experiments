#pragma once

#include <string>

namespace rccore {

class PaintContext;

// Host hook for native "custom components" (RemoteCompose LAYOUT_CUSTOM, op 93).
//
// A custom component is a leaf whose rendering is delegated to the platform: the
// document positions/sizes it like any component, then hands drawing to a host keyed
// by the component's `config` string (e.g. "video:clip.mp4"). This is the C++ analog
// of androidx's CustomContext — the player core stays platform-agnostic while the app
// (e.g. the viewer) supplies renderers for things Skia alone can't do, like video.
class CustomComponentHost {
public:
    virtual ~CustomComponentHost() = default;

    // Draw the custom component `componentId` (with its resolved `config` string) into
    // the current canvas. The canvas is already transformed so (0,0)..(w,h) is the
    // component's content box. `timeSec` is the document animation time (seconds).
    // Return true if handled; false lets the core fall back (draw nothing).
    virtual bool drawCustom(int componentId, const std::string& config,
                            PaintContext* pc, float w, float h, double timeSec) = 0;
};

} // namespace rccore
