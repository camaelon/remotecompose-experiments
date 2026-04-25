#pragma once

#include "RenderBackend.h"
#include "include/core/SkSurface.h"
struct GLFWwindow;

// Metal GPU-accelerated backend using Skia's Ganesh Metal integration.
// SkRuntimeEffect shaders (AGSL) run on the GPU automatically.
class MetalRenderBackend : public RenderBackend {
public:
    // Creates the Metal backend for the given GLFW window.
    // The window MUST have been created with GLFW_CLIENT_API = GLFW_NO_API.
    static std::unique_ptr<MetalRenderBackend> Create(GLFWwindow* window);

    ~MetalRenderBackend() override;

    bool resize(int w, int h) override;
    SkCanvas* canvas() override;
    SkSurface* surface() override;
    void present() override;
    void onFramebufferResize(int fbW, int fbH) override;
    const char* name() const override { return "Metal (GPU)"; }

private:
    MetalRenderBackend() = default;

    struct Impl;
    std::unique_ptr<Impl> mImpl;
    sk_sp<SkSurface> mSurface;
    int mWidth = 0;
    int mHeight = 0;
};
