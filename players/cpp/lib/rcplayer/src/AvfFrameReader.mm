#import <AVFoundation/AVFoundation.h>
#import <CoreMedia/CoreMedia.h>
#import <CoreVideo/CoreVideo.h>

#include "rcplayer/AvfFrameReader.h"

#include "include/core/SkBitmap.h"
#include "include/core/SkImage.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkPixmap.h"

#include <cmath>
#include <iostream>

struct AvfFrameReader::Impl {
    AVURLAsset* asset = nil;
    AVAssetTrack* track = nil;
    AVAssetReader* reader = nil;
    AVAssetReaderTrackOutput* output = nil;
    CMSampleBufferRef pending = nullptr;   // decoded, not yet due
    double pendingTime = 0.0;
    sk_sp<SkImage> image;                  // the frame last handed out
    double imageTime = -1.0;
    double openedAt = 0.0;
    bool exhausted = false;
    int width = 0, height = 0;
    double duration = 0.0;

    ~Impl() {
        if (pending) CFRelease(pending);
        if (reader) [reader cancelReading];
    }

    bool open(double at) {
        if (pending) { CFRelease(pending); pending = nullptr; }
        if (reader) [reader cancelReading];
        NSError* error = nil;
        reader = [AVAssetReader assetReaderWithAsset:asset error:&error];
        if (!reader) {
            std::cerr << "AvfFrameReader: " << (error.localizedDescription.UTF8String ?: "cannot read") << "\n";
            return false;
        }
        output = [AVAssetReaderTrackOutput
            assetReaderTrackOutputWithTrack:track
                             outputSettings:@{(id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA)}];
        output.alwaysCopiesSampleData = NO;
        if (![reader canAddOutput:output]) return false;
        [reader addOutput:output];
        const double start = std::max(0.0, at);
        reader.timeRange = CMTimeRangeMake(CMTimeMakeWithSeconds(start, 600), kCMTimePositiveInfinity);
        if (![reader startReading]) {
            std::cerr << "AvfFrameReader: cannot start reading: "
                      << (reader.error.localizedDescription.UTF8String ?: "?") << "\n";
            return false;
        }
        openedAt = start;
        exhausted = false;
        imageTime = -1.0;
        return true;
    }

    // The next decoded frame into `pending`; false at the end of the file.
    bool fetch() {
        if (pending) return true;
        if (exhausted || !output) return false;
        CMSampleBufferRef sample = [output copyNextSampleBuffer];
        if (!sample) { exhausted = true; return false; }
        pending = sample;
        pendingTime = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sample));
        return true;
    }

    void take() {
        CVPixelBufferRef pb = CMSampleBufferGetImageBuffer(pending);
        if (pb) {
            CVPixelBufferLockBaseAddress(pb, kCVPixelBufferLock_ReadOnly);
            const size_t w = CVPixelBufferGetWidth(pb), h = CVPixelBufferGetHeight(pb);
            const size_t rb = CVPixelBufferGetBytesPerRow(pb);
            void* base = CVPixelBufferGetBaseAddress(pb);
            SkImageInfo info = SkImageInfo::Make(static_cast<int>(w), static_cast<int>(h),
                                                 kBGRA_8888_SkColorType, kPremul_SkAlphaType);
            SkPixmap src(info, base, rb);
            SkBitmap bm;
            if (base && bm.tryAllocPixels(info)) {
                bm.writePixels(src, 0, 0);
                bm.setImmutable();
                image = bm.asImage();
            }
            CVPixelBufferUnlockBaseAddress(pb, kCVPixelBufferLock_ReadOnly);
        }
        imageTime = pendingTime;
        CFRelease(pending);
        pending = nullptr;
    }
};

AvfFrameReader::AvfFrameReader() : mImpl(std::make_unique<Impl>()) {}
AvfFrameReader::~AvfFrameReader() = default;

std::unique_ptr<AvfFrameReader> AvfFrameReader::Open(const std::string& path) {
    @autoreleasepool {
        NSURL* url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path.c_str()]];
        AVURLAsset* asset = [AVURLAsset assetWithURL:url];
        NSArray<AVAssetTrack*>* tracks = [asset tracksWithMediaType:AVMediaTypeVideo];
        if (tracks.count == 0) {
            std::cerr << "AvfFrameReader: no video track in " << path << "\n";
            return nullptr;
        }
        auto r = std::unique_ptr<AvfFrameReader>(new AvfFrameReader());
        r->mImpl->asset = asset;
        r->mImpl->track = tracks.firstObject;
        const CGSize size = r->mImpl->track.naturalSize;
        r->mImpl->width = static_cast<int>(size.width);
        r->mImpl->height = static_cast<int>(size.height);
        const CMTime d = asset.duration;
        r->mImpl->duration = CMTIME_IS_NUMERIC(d) ? CMTimeGetSeconds(d) : 0.0;
        if (!r->mImpl->open(0.0)) return nullptr;
        return r;
    }
}

int AvfFrameReader::width() const { return mImpl->width; }
int AvfFrameReader::height() const { return mImpl->height; }
double AvfFrameReader::durationSec() const { return mImpl->duration; }

sk_sp<SkImage> AvfFrameReader::frameAt(double sec) {
    @autoreleasepool {
        Impl& im = *mImpl;
        // Backwards (past a frame's worth): start again from there. Forwards: decode up to it.
        if (sec + 0.001 < im.imageTime || (im.imageTime < 0 && sec + 0.001 < im.openedAt)) {
            if (!im.open(sec)) return nullptr;
        }
        while (im.fetch()) {
            if (im.pendingTime <= sec + 1e-4) im.take();
            else break;
        }
        return im.image;
    }
}
