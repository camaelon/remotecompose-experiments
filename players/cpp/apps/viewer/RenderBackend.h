#pragma once

#include "include/core/SkSurface.h"
#include "include/core/SkCanvas.h"

// Abstract rendering backend — hides whether we use CPU raster or GPU Metal.
// The viewer creates one at startup based on --cpu / --metal flags.
class RenderBackend {
public:
    virtual ~RenderBackend() = default;

    // (Re)create the rendering surface at the given size.
    // Returns false if creation failed.
    virtual bool resize(int w, int h) = 0;

    // Get the current SkCanvas to draw into.
    virtual SkCanvas* canvas() = 0;

    // Get the current SkSurface (for screenshots, etc.)
    virtual SkSurface* surface() = 0;

    // Present the rendered frame to the screen.
    // For CPU: uploads texture via OpenGL and swaps.
    // For Metal: flushes GPU work and presents the drawable.
    virtual void present() = 0;

    // Called on framebuffer resize (e.g., Retina scale change).
    virtual void onFramebufferResize(int fbW, int fbH) = 0;

    // Name for display purposes
    virtual const char* name() const = 0;
};
