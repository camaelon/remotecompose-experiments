#import <UIKit/UIKit.h>
#import <MetalKit/MetalKit.h>

/// GPU-backed RemoteCompose renderer. Draws directly into an MTKView's
/// current drawable via Skia's Metal Ganesh backend — no CPU pixel readback.
///
/// Usage:
///   1. Init once with a shared MTLDevice + MTLCommandQueue.
///   2. `loadFileData:` with the .rc bytes.
///   3. Call `drawInView:animTime:deltaTime:` from MTKView's delegate each draw.
@interface RCMetalRenderer : NSObject

- (instancetype)initWithDevice:(id<MTLDevice>)device
                  commandQueue:(id<MTLCommandQueue>)queue;

- (BOOL)loadFileData:(NSData *)data;
- (CGSize)documentSize;

/// Paint one frame into the MTKView's current drawable. The renderer takes
/// care of wrapping the drawable as an SkSurface, flushing, and presenting.
- (void)drawInView:(nonnull MTKView *)view
          animTime:(double)animTime
         deltaTime:(double)deltaTime;

/// Whether the document has dynamic content (expressions, animations, time
/// variables) requiring continuous redraw.
- (BOOL)needsAnimation;

- (void)sendTouchDownX:(float)x y:(float)y;
- (void)sendTouchDragX:(float)x y:(float)y;
- (void)sendTouchUpX:(float)x y:(float)y velX:(float)dx velY:(float)dy;

@end
