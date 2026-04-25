#import "RCMetalRenderer.h"

#import <Metal/Metal.h>

#include "rccore/WireBuffer.h"
#include "rccore/CoreDocument.h"
#include "rccore/RemoteContext.h"
#include "rccore/TimeVariables.h"
#include "rcskia/SkiaPaintContext.h"

#include "include/core/SkCanvas.h"
#include "include/core/SkColorSpace.h"
#include "include/core/SkSurface.h"
#include "include/gpu/ganesh/GrBackendSurface.h"
#include "include/gpu/ganesh/GrDirectContext.h"
#include "include/gpu/ganesh/SkSurfaceGanesh.h"
#include "include/gpu/ganesh/mtl/GrMtlBackendContext.h"
#include "include/gpu/ganesh/mtl/GrMtlBackendSurface.h"
#include "include/gpu/ganesh/mtl/GrMtlDirectContext.h"
#include "include/gpu/ganesh/mtl/GrMtlTypes.h"

@implementation RCMetalRenderer {
    id<MTLDevice> _device;
    id<MTLCommandQueue> _queue;
    sk_sp<GrDirectContext> _grContext;

    std::unique_ptr<rccore::CoreDocument> _doc;
    std::unique_ptr<rccore::RemoteContext> _context;
    std::unique_ptr<rcskia::SkiaPaintContext> _paintCtx;
    rccore::TimeVariables _timeVars;
    std::vector<uint8_t> _fileData;

    CGSize _lastSurfaceSize;  // tracks when RemoteContext needs re-sizing
}

- (instancetype)initWithDevice:(id<MTLDevice>)device
                  commandQueue:(id<MTLCommandQueue>)queue {
    self = [super init];
    if (!self) return nil;
    _device = device;
    _queue = queue;

    GrMtlBackendContext backendCtx;
    backendCtx.fDevice.retain((__bridge GrMTLHandle)_device);
    backendCtx.fQueue.retain((__bridge GrMTLHandle)_queue);
    _grContext = GrDirectContexts::MakeMetal(backendCtx);
    if (!_grContext) {
        NSLog(@"[RCMetalRenderer] Failed to create GrDirectContext");
        return nil;
    }
    return self;
}

- (void)dealloc {
    if (_grContext) _grContext->abandonContext();
}

- (BOOL)loadFileData:(NSData *)data {
    _fileData.assign((const uint8_t *)data.bytes,
                     (const uint8_t *)data.bytes + data.length);
    rccore::WireBuffer buffer(_fileData.data(), _fileData.size());
    _doc = std::make_unique<rccore::CoreDocument>();
    _context = nullptr;
    _paintCtx = nullptr;
    _lastSurfaceSize = CGSizeZero;
    try {
        return _doc->initFromBuffer(buffer);
    } catch (const std::exception &e) {
        NSLog(@"[RCMetalRenderer] Failed to parse .rc data (%lu bytes): %s",
              (unsigned long)data.length, e.what());
        _doc = nullptr;
        return NO;
    }
}

- (CGSize)documentSize {
    if (!_doc) return CGSizeZero;
    return CGSizeMake(_doc->getWidth(), _doc->getHeight());
}

- (void)setupContextForSize:(CGSize)size {
    if (!_doc) return;
    float dw = _doc->getWidth();
    float dh = _doc->getHeight();
    if (dw <= 0 || dh <= 0) { dw = (float)size.width; dh = (float)size.height; }

    _context = std::make_unique<rccore::RemoteContext>();
    _paintCtx = std::make_unique<rcskia::SkiaPaintContext>(*_context, nullptr);
    _context->setPaintContext(_paintCtx.get());
    _context->setDocument(_doc.get());
    // Document coordinate space — a canvas transform in drawInView handles
    // scaling to the drawable. Keeping these consistent across setup and
    // paint is what the particle engine (and other WINDOW_WIDTH listeners)
    // relies on.
    _context->mWidth = dw;
    _context->mHeight = dh;

    _doc->registerListeners(*_context);
    _doc->applyDataOperations(*_context);
    _timeVars = rccore::TimeVariables();
    _lastSurfaceSize = size;
}

- (void)drawInView:(MTKView *)view
          animTime:(double)animTime
         deltaTime:(double)deltaTime {
    if (!_doc || !_grContext) return;

    id<CAMetalDrawable> drawable = view.currentDrawable;
    if (!drawable) return;
    id<MTLTexture> texture = drawable.texture;
    if (!texture) return;

    CGSize drawableSize = CGSizeMake(texture.width, texture.height);

    if (!_context || !CGSizeEqualToSize(drawableSize, _lastSurfaceSize)) {
        [self setupContextForSize:drawableSize];
    }

    float dw = _doc->getWidth();
    float dh = _doc->getHeight();
    if (dw <= 0 || dh <= 0) { dw = (float)drawableSize.width; dh = (float)drawableSize.height; }
    float scale = std::min((float)drawableSize.width / dw,
                           (float)drawableSize.height / dh);
    float fitW = dw * scale;
    float fitH = dh * scale;
    float ox = ((float)drawableSize.width  - fitW) * 0.5f;
    float oy = ((float)drawableSize.height - fitH) * 0.5f;

    try {
        // Wrap the drawable's texture as a Skia render target so we can draw
        // straight into it, then present via our own command buffer below.
        GrMtlTextureInfo textureInfo;
        textureInfo.fTexture.retain((__bridge GrMTLHandle)texture);

        GrBackendRenderTarget backendRT = GrBackendRenderTargets::MakeMtl(
            (int)texture.width, (int)texture.height, textureInfo);

        sk_sp<SkSurface> surface = SkSurfaces::WrapBackendRenderTarget(
            _grContext.get(),
            backendRT,
            kTopLeft_GrSurfaceOrigin,
            kBGRA_8888_SkColorType,
            /*colorSpace=*/nullptr,
            /*surfaceProps=*/nullptr);

        if (!surface) {
            NSLog(@"[RCMetalRenderer] WrapBackendRenderTarget returned null");
            return;
        }

        SkCanvas *canvas = surface->getCanvas();
        canvas->clear(SK_ColorBLACK);
        canvas->save();
        canvas->translate(ox, oy);
        canvas->scale(scale, scale);

        _paintCtx->setCanvas(canvas);
        // mWidth/mHeight stay as the document's native dims (set in
        // setupContextForSize). The SkCanvas scale above handles the mapping
        // to drawable pixels.
        _timeVars.updateTime(*_context, animTime, deltaTime);
        _doc->paint(*_context);

        canvas->restore();

        // Flush Skia work into the command queue, then present the drawable.
        _grContext->flushAndSubmit(GrSyncCpu::kNo);

        id<MTLCommandBuffer> cmd = [_queue commandBuffer];
        [cmd presentDrawable:drawable];
        [cmd commit];
    } catch (const std::exception &e) {
        NSLog(@"[RCMetalRenderer] Render error: %s", e.what());
    }
}

- (BOOL)needsAnimation {
    if (!_context) return NO;
    return _context->getRepaintDelay() > 0;
}

- (void)sendTouchDownX:(float)x y:(float)y {
    if (!_doc || !_context) return;
    _doc->touchDown(*_context, x, y);
}

- (void)sendTouchDragX:(float)x y:(float)y {
    if (!_doc || !_context) return;
    _doc->touchDrag(*_context, x, y);
}

- (void)sendTouchUpX:(float)x y:(float)y velX:(float)dx velY:(float)dy {
    if (!_doc || !_context) return;
    _doc->touchUp(*_context, x, y, dx, dy);
}

@end
