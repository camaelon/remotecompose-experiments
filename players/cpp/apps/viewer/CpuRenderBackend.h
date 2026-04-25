#pragma once

#define GL_SILENCE_DEPRECATION
#include <OpenGL/gl.h>

#include "RenderBackend.h"
#include "include/core/SkSurface.h"
#include "include/core/SkPixmap.h"

// CPU software rasterizer with OpenGL texture upload for display.
class CpuRenderBackend : public RenderBackend {
public:
    CpuRenderBackend() = default;

    ~CpuRenderBackend() override {
        if (mTextureId) glDeleteTextures(1, &mTextureId);
    }

    bool resize(int w, int h) override {
        if (mSurface && mWidth == w && mHeight == h) return true;
        mWidth = w;
        mHeight = h;
        SkImageInfo info = SkImageInfo::MakeN32Premul(w, h);
        mSurface = SkSurfaces::Raster(info);
        return mSurface != nullptr;
    }

    SkCanvas* canvas() override {
        return mSurface ? mSurface->getCanvas() : nullptr;
    }

    SkSurface* surface() override {
        return mSurface.get();
    }

    void present() override {
        if (!mSurface) return;

        SkPixmap pm;
        if (!mSurface->peekPixels(&pm)) return;

        if (mTextureId == 0) glGenTextures(1, &mTextureId);

        glBindTexture(GL_TEXTURE_2D, mTextureId);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, mWidth, mHeight, 0,
                     GL_RGBA, GL_UNSIGNED_BYTE, pm.addr());

        glClear(GL_COLOR_BUFFER_BIT);
        glEnable(GL_TEXTURE_2D);
        glBindTexture(GL_TEXTURE_2D, mTextureId);
        glBegin(GL_QUADS);
        glTexCoord2f(0, 0); glVertex2f(-1,  1);
        glTexCoord2f(1, 0); glVertex2f( 1,  1);
        glTexCoord2f(1, 1); glVertex2f( 1, -1);
        glTexCoord2f(0, 1); glVertex2f(-1, -1);
        glEnd();
        glDisable(GL_TEXTURE_2D);
    }

    void onFramebufferResize(int fbW, int fbH) override {
        glViewport(0, 0, fbW, fbH);
    }

    const char* name() const override { return "CPU (Software)"; }

private:
    sk_sp<SkSurface> mSurface;
    GLuint mTextureId = 0;
    int mWidth = 0;
    int mHeight = 0;
};
