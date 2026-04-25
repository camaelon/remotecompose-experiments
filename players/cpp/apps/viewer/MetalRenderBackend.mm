#import <Metal/Metal.h>

#define GL_SILENCE_DEPRECATION
#include <OpenGL/gl.h>

#include "MetalRenderBackend.h"

#include "include/core/SkCanvas.h"
#include "include/core/SkColorSpace.h"
#include "include/core/SkSurface.h"
#include "include/core/SkPixmap.h"
#include "include/gpu/ganesh/GrDirectContext.h"
#include "include/gpu/ganesh/SkSurfaceGanesh.h"
#include "include/gpu/ganesh/mtl/GrMtlBackendContext.h"
#include "include/gpu/ganesh/mtl/GrMtlDirectContext.h"

#include <iostream>

// Metal GPU backend: renders via Skia's Ganesh Metal pipeline (shaders run on GPU),
// then reads back pixels and displays via OpenGL texture upload.
// This avoids CAMetalLayer presentation complexity with GLFW while still getting
// GPU-accelerated AGSL shader execution.

struct MetalRenderBackend::Impl {
    id<MTLDevice> device = nil;
    id<MTLCommandQueue> queue = nil;
    sk_sp<GrDirectContext> grContext;
    GLuint textureId = 0;

    // CPU-side pixel buffer for readback
    std::vector<uint8_t> pixels;
};

std::unique_ptr<MetalRenderBackend> MetalRenderBackend::Create(GLFWwindow* window) {
    (void)window;  // Not needed for offscreen GPU approach

    auto backend = std::unique_ptr<MetalRenderBackend>(new MetalRenderBackend());
    backend->mImpl = std::make_unique<Impl>();
    auto& impl = *backend->mImpl;

    // Create Metal device and command queue
    impl.device = MTLCreateSystemDefaultDevice();
    if (!impl.device) {
        std::cerr << "Metal: Failed to create device\n";
        return nullptr;
    }
    impl.queue = [impl.device newCommandQueue];
    if (!impl.queue) {
        std::cerr << "Metal: Failed to create command queue\n";
        return nullptr;
    }

    // Create Skia GrDirectContext with Metal backend
    GrMtlBackendContext backendContext;
    backendContext.fDevice.retain((__bridge GrMTLHandle)impl.device);
    backendContext.fQueue.retain((__bridge GrMTLHandle)impl.queue);

    impl.grContext = GrDirectContexts::MakeMetal(backendContext);
    if (!impl.grContext) {
        std::cerr << "Metal: Failed to create GrDirectContext\n";
        return nullptr;
    }

    std::cerr << "Metal GPU backend initialized: "
              << [[impl.device name] UTF8String] << "\n";

    return backend;
}

MetalRenderBackend::~MetalRenderBackend() {
    mSurface.reset();
    if (mImpl) {
        if (mImpl->textureId) glDeleteTextures(1, &mImpl->textureId);
        if (mImpl->grContext) {
            mImpl->grContext->abandonContext();
        }
    }
}

bool MetalRenderBackend::resize(int w, int h) {
    if (mWidth == w && mHeight == h && mSurface) return true;
    mWidth = w;
    mHeight = h;

    // Create a GPU-backed offscreen surface
    SkImageInfo info = SkImageInfo::MakeN32Premul(w, h);
    mSurface = SkSurfaces::RenderTarget(
        mImpl->grContext.get(),
        skgpu::Budgeted::kYes,
        info);

    if (!mSurface) {
        std::cerr << "Metal: Failed to create GPU render target "
                  << w << "x" << h << "\n";
        return false;
    }

    mImpl->pixels.resize(w * h * 4);
    return true;
}

SkCanvas* MetalRenderBackend::canvas() {
    return mSurface ? mSurface->getCanvas() : nullptr;
}

SkSurface* MetalRenderBackend::surface() {
    return mSurface.get();
}

void MetalRenderBackend::present() {
    if (!mSurface) return;

    // Flush GPU work
    mImpl->grContext->flushAndSubmit(GrSyncCpu::kYes);

    // Read back pixels from GPU surface
    SkPixmap pm;
    SkImageInfo info = SkImageInfo::MakeN32Premul(mWidth, mHeight);
    pm.reset(info, mImpl->pixels.data(), mWidth * 4);
    if (!mSurface->readPixels(pm, 0, 0)) {
        std::cerr << "Metal: readPixels failed\n";
        return;
    }

    // Upload to OpenGL texture and draw fullscreen quad
    if (mImpl->textureId == 0) glGenTextures(1, &mImpl->textureId);

    glBindTexture(GL_TEXTURE_2D, mImpl->textureId);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, mWidth, mHeight, 0,
                 GL_RGBA, GL_UNSIGNED_BYTE, mImpl->pixels.data());

    glClear(GL_COLOR_BUFFER_BIT);
    glEnable(GL_TEXTURE_2D);
    glBindTexture(GL_TEXTURE_2D, mImpl->textureId);
    glBegin(GL_QUADS);
    glTexCoord2f(0, 0); glVertex2f(-1,  1);
    glTexCoord2f(1, 0); glVertex2f( 1,  1);
    glTexCoord2f(1, 1); glVertex2f( 1, -1);
    glTexCoord2f(0, 1); glVertex2f(-1, -1);
    glEnd();
    glDisable(GL_TEXTURE_2D);
}

void MetalRenderBackend::onFramebufferResize(int fbW, int fbH) {
    glViewport(0, 0, fbW, fbH);
}
