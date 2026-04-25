// AvfVideoPlayer.mm — AVFoundation backend for AvfVideoPlayer.h
//
// Strategy:
//   * AVQueuePlayer is the player. AVPlayerLooper sits on top of it,
//     creates duplicate AVPlayerItems internally and keeps queueing them so
//     playback wraps around with no visible seam.
//   * AVPlayerItemVideoOutput must be attached to whichever AVPlayerItem
//     is currently playing. Because AVPlayerLooper swaps items at every loop,
//     we KVO `currentItem` on the queue player and re-attach a fresh video
//     output to each new current item.
//   * Each `paint()` call asks the current output for the pixel buffer at
//     the host clock's "now" time. If a new buffer is ready, we copy it into
//     a Skia bitmap and snapshot it as an immutable SkImage. The previous
//     image is reused otherwise so the canvas stays painted between buffer
//     refreshes.
//
// Audio plays automatically because AVQueuePlayer mixes the asset's audio
// track itself.

#import <AVFoundation/AVFoundation.h>
#import <CoreVideo/CoreVideo.h>
#import <CoreMedia/CoreMedia.h>
#import <QuartzCore/QuartzCore.h>

#include "AvfVideoPlayer.h"

#include "include/core/SkBitmap.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkImage.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkPixmap.h"
#include "include/core/SkRect.h"
#include "include/core/SkRefCnt.h"
#include "include/core/SkSamplingOptions.h"

#include <algorithm>
#include <iostream>

// ── Objective-C helper that owns the AVFoundation graph ─────────────────
@interface AvfPlayerObjc : NSObject
@property (nonatomic, strong) AVQueuePlayer*           player;
@property (nonatomic, strong) AVPlayerLooper*          looper;
@property (nonatomic, strong) AVPlayerItemVideoOutput* currentOutput;
@property (nonatomic, assign) int  width;
@property (nonatomic, assign) int  height;
@property (nonatomic, assign) double durationSec;

- (instancetype)initWithPath:(NSString*)path;
- (void)attachOutputTo:(AVPlayerItem*)item;
- (CVPixelBufferRef)copyCurrentPixelBufferCF; // caller owns
@end

@implementation AvfPlayerObjc

- (instancetype)initWithPath:(NSString*)path {
    self = [super init];
    if (!self) return nil;

    NSURL* url = [NSURL fileURLWithPath:path];
    AVURLAsset* asset = [AVURLAsset assetWithURL:url];

    NSArray<AVAssetTrack*>* videoTracks =
        [asset tracksWithMediaType:AVMediaTypeVideo];
    if (videoTracks.count == 0) {
        std::cerr << "AvfVideoPlayer: no video track in "
                  << path.UTF8String << "\n";
        return nil;
    }
    AVAssetTrack* vt = videoTracks.firstObject;
    CGSize naturalSize = vt.naturalSize;
    CGAffineTransform xform = vt.preferredTransform;
    // The asset may declare a transform (e.g. portrait video shot on iPhone).
    // Apply it so width/height reflect display orientation.
    CGRect r = CGRectMake(0, 0, naturalSize.width, naturalSize.height);
    r = CGRectApplyAffineTransform(r, xform);
    self.width  = (int)std::abs(r.size.width);
    self.height = (int)std::abs(r.size.height);

    CMTime d = asset.duration;
    self.durationSec = CMTIME_IS_NUMERIC(d) ? CMTimeGetSeconds(d) : 0.0;

    // Build the looping graph: queue player + template item + looper.
    AVPlayerItem* templateItem = [AVPlayerItem playerItemWithAsset:asset];
    self.player = [AVQueuePlayer queuePlayerWithItems:@[ templateItem ]];
    self.player.actionAtItemEnd = AVPlayerActionAtItemEndAdvance;
    self.looper = [AVPlayerLooper playerLooperWithPlayer:self.player
                                           templateItem:templateItem];

    // KVO so we can swap the video output across the loop seam.
    [self.player addObserver:self
                  forKeyPath:@"currentItem"
                     options:NSKeyValueObservingOptionInitial
                           | NSKeyValueObservingOptionNew
                     context:nullptr];

    // Begin playback immediately. The viewer's pause toggle will gate this.
    [self.player play];
    return self;
}

- (void)dealloc {
    @try {
        [self.player removeObserver:self forKeyPath:@"currentItem"];
    } @catch (NSException*) { /* never registered or already removed */ }
    [self.player pause];
    self.looper = nil;
    self.player = nil;
    self.currentOutput = nil;
}

// Attach a brand-new AVPlayerItemVideoOutput to *item*. The previous output
// is dropped — its underlying item is being removed from the queue by the
// looper, so its pixel buffers are no longer needed.
- (void)attachOutputTo:(AVPlayerItem*)item {
    if (!item) return;
    NSDictionary* attrs = @{
        (id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA),
    };
    AVPlayerItemVideoOutput* output =
        [[AVPlayerItemVideoOutput alloc] initWithPixelBufferAttributes:attrs];
    [item addOutput:output];
    self.currentOutput = output;
}

- (void)observeValueForKeyPath:(NSString*)keyPath
                      ofObject:(id)object
                        change:(NSDictionary<NSKeyValueChangeKey,id>*)change
                       context:(void*)context {
    if ([keyPath isEqualToString:@"currentItem"]) {
        AVPlayerItem* newItem = self.player.currentItem;
        if (newItem) {
            [self attachOutputTo:newItem];
        }
    } else {
        [super observeValueForKeyPath:keyPath ofObject:object
                               change:change context:context];
    }
}

- (CVPixelBufferRef)copyCurrentPixelBufferCF {
    AVPlayerItemVideoOutput* out = self.currentOutput;
    if (!out) return nullptr;
    CMTime hostTime = [out itemTimeForHostTime:CACurrentMediaTime()];
    if (![out hasNewPixelBufferForItemTime:hostTime]) return nullptr;
    return [out copyPixelBufferForItemTime:hostTime
                        itemTimeForDisplay:nullptr];
}

@end

// ── C++ side ────────────────────────────────────────────────────────────
struct AvfVideoPlayer::Impl {
    AvfPlayerObjc* objc = nil;        // strong (ARC manages it)
    sk_sp<SkImage> lastImage;
};

AvfVideoPlayer::AvfVideoPlayer() : mImpl(std::make_unique<Impl>()) {}
AvfVideoPlayer::~AvfVideoPlayer() { /* ARC releases mImpl->objc */ }

std::unique_ptr<AvfVideoPlayer> AvfVideoPlayer::Open(const std::string& path) {
    @autoreleasepool {
        NSString* nsPath = [NSString stringWithUTF8String:path.c_str()];
        AvfPlayerObjc* objc = [[AvfPlayerObjc alloc] initWithPath:nsPath];
        if (!objc || !objc.player) return nullptr;

        auto p = std::unique_ptr<AvfVideoPlayer>(new AvfVideoPlayer());
        p->mImpl->objc = objc;
        std::cerr << "AvfVideoPlayer: " << objc.width << "x" << objc.height
                  << ", " << objc.durationSec << "s, looping\n";
        return p;
    }
}

sk_sp<SkImage> AvfVideoPlayer::ExtractFirstFrame(const std::string& path) {
    @autoreleasepool {
        NSURL* url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path.c_str()]];
        AVURLAsset* asset = [AVURLAsset assetWithURL:url];
        AVAssetImageGenerator* gen =
            [[AVAssetImageGenerator alloc] initWithAsset:asset];
        // Honour any rotation metadata (e.g. portrait iPhone video).
        gen.appliesPreferredTrackTransform = YES;
        // A zero-tolerance request forces the generator to decode exactly the
        // first frame rather than the nearest keyframe.
        gen.requestedTimeToleranceBefore = kCMTimeZero;
        gen.requestedTimeToleranceAfter  = kCMTimeZero;

        NSError* err = nil;
        CMTime actual;
        CGImageRef cg = [gen copyCGImageAtTime:kCMTimeZero
                                    actualTime:&actual
                                         error:&err];
        if (!cg) {
            std::cerr << "AvfVideoPlayer::ExtractFirstFrame: "
                      << (err ? err.localizedDescription.UTF8String : "failed")
                      << "\n";
            return nullptr;
        }

        const size_t w = CGImageGetWidth(cg);
        const size_t h = CGImageGetHeight(cg);
        // Use an unambiguous byte-order pixel format: RGBA premultiplied
        // (R,G,B,A in memory regardless of platform endianness). Earlier
        // attempts with kCGBitmapByteOrder32Host|PremultipliedFirst worked
        // for most videos but swapped R/B channels on some source formats,
        // because CoreGraphics sometimes took a same-format fast path that
        // bypassed byte-order conversion. Forcing RGBA avoids that entirely.
        SkImageInfo info = SkImageInfo::Make((int)w, (int)h,
                                             kRGBA_8888_SkColorType,
                                             kPremul_SkAlphaType);
        SkBitmap bm;
        if (!bm.tryAllocPixels(info)) {
            CGImageRelease(cg);
            return nullptr;
        }

        CGColorSpaceRef cs = CGColorSpaceCreateDeviceRGB();
        CGContextRef ctx = CGBitmapContextCreate(
            bm.getPixels(), w, h, 8, bm.rowBytes(), cs,
            kCGImageAlphaPremultipliedLast | kCGBitmapByteOrderDefault);
        CGColorSpaceRelease(cs);
        if (!ctx) {
            CGImageRelease(cg);
            return nullptr;
        }
        CGContextDrawImage(ctx, CGRectMake(0, 0, w, h), cg);
        CGContextRelease(ctx);
        CGImageRelease(cg);

        bm.setImmutable();
        return bm.asImage();
    }
}

int    AvfVideoPlayer::width()       const { return mImpl->objc ? mImpl->objc.width  : 0; }
int    AvfVideoPlayer::height()      const { return mImpl->objc ? mImpl->objc.height : 0; }
double AvfVideoPlayer::durationSec() const { return mImpl->objc ? mImpl->objc.durationSec : 0.0; }

void AvfVideoPlayer::setPaused(bool paused) {
    if (!mImpl->objc) return;
    if (paused) [mImpl->objc.player pause];
    else        [mImpl->objc.player play];
}

void AvfVideoPlayer::paint(SkCanvas* canvas, int dstW, int dstH) {
    if (!mImpl->objc) return;

    @autoreleasepool {
        CVPixelBufferRef pb = [mImpl->objc copyCurrentPixelBufferCF];
        if (pb) {
            CVPixelBufferLockBaseAddress(pb, kCVPixelBufferLock_ReadOnly);
            const size_t w  = CVPixelBufferGetWidth(pb);
            const size_t h  = CVPixelBufferGetHeight(pb);
            const size_t rb = CVPixelBufferGetBytesPerRow(pb);
            void* base = CVPixelBufferGetBaseAddress(pb);

            // CVPixelBuffer is BGRA on Apple. Skia's kBGRA_8888 matches it
            // exactly so no channel swap is needed.
            SkImageInfo info = SkImageInfo::Make((int)w, (int)h,
                                                 kBGRA_8888_SkColorType,
                                                 kPremul_SkAlphaType);
            SkPixmap src(info, base, rb);

            SkBitmap bm;
            if (bm.tryAllocPixels(info)) {
                // Copy out so we can release the CVPixelBuffer immediately.
                bm.writePixels(src, 0, 0);
                bm.setImmutable();
                mImpl->lastImage = bm.asImage();
            }
            CVPixelBufferUnlockBaseAddress(pb, kCVPixelBufferLock_ReadOnly);
            CVPixelBufferRelease(pb);
        }
    }

    if (!mImpl->lastImage) return;

    // Aspect-fit-centre into the destination rect.
    const float imgW = (float)mImpl->lastImage->width();
    const float imgH = (float)mImpl->lastImage->height();
    const float sx = (float)dstW / imgW;
    const float sy = (float)dstH / imgH;
    const float s  = std::min(sx, sy);
    const float dw = imgW * s;
    const float dh = imgH * s;
    const float ox = (dstW - dw) * 0.5f;
    const float oy = (dstH - dh) * 0.5f;

    SkRect dst = SkRect::MakeXYWH(ox, oy, dw, dh);
    SkSamplingOptions sampling(SkFilterMode::kLinear, SkMipmapMode::kNone);
    canvas->drawImageRect(mImpl->lastImage, dst, sampling);
}
