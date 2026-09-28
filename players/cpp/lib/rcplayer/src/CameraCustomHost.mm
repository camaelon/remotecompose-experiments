// The camera on the slide, through AVFoundation.
//
// A take is written by an AVAssetWriter from the very frames the feed delivers, each stamped
// with its time since the take was asked for (the host clock, which is the capture clock):
// the picture is in step with the wav from the first frame, whatever the camera's start-up
// latency, and a pause in the talk is a gap the frames skip over, as the wav's is.
//
// A capture session delivers BGRA frames on its own queue; the newest is kept, retained,
// under a lock, and the draw on the main thread copies it into an SkImage the first time it
// paints that frame (the same copy AvfVideoPlayer makes: the buffer is released at once and
// the image is immutable, which is what Skia wants). Every draw stamps the feed with the
// time, and the capture callback watches that stamp: a feed nobody has drawn for a while
// stops its session from a control queue — never from the delivery queue, where stopRunning
// would wait for itself.
#import <AVFoundation/AVFoundation.h>
#import <Foundation/Foundation.h>

#include "rcplayer/CameraCustomHost.h"
#include "rcplayer/AvfFrameReader.h"
#include "rcplayer/CameraConfig.h"
#include "rcplayer/CameraStandIn.h"
#include "rcskia/SkiaPaintContext.h"

#include "include/core/SkBitmap.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkImage.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkPaint.h"
#include "include/core/SkPixmap.h"
#include "include/core/SkRect.h"
#include "include/core/SkSamplingOptions.h"

#include <algorithm>
#include <atomic>
#include <cctype>
#include <cstdio>
#include <map>
#include <mutex>

namespace {

constexpr double kIdleStopSec = 8.0;    // undrawn this long, a feed stops its session

double nowSec() { return CACurrentMediaTime(); }

// One camera, running or not, and its newest frame.
struct Feed {
    std::string query;
    std::mutex lock;
    CVPixelBufferRef latest = nullptr;      // retained; swapped under the lock
    uint64_t seq = 0;                       // frames delivered
    uint64_t painted = 0;                   // the seq the image was made from
    sk_sp<SkImage> image;
    std::atomic<double> lastDraw{0.0};
    std::atomic<bool> running{false};
    std::atomic<bool> starting{false};
    std::atomic<bool> failed{false};
    bool saidFailed = false;
    AVCaptureSession* session = nil;
    id delegate = nil;
    dispatch_queue_t frames = nullptr;
    // A take being recorded from this feed, and what to do with the file when it lands.
    // The writer is made on the frames queue from the first frame (that is where the size is
    // known) and only ever touched there.
    std::atomic<bool> takeRunning{false};
    std::string takePath, takeMoveTo;
    bool takeDiscard = false;
    double takeStart = 0.0;              // host seconds: the wav started then, near enough
    std::atomic<double> pausedAt{-1.0};  // host seconds, or -1 while running
    std::atomic<double> pausedTotal{0.0};
    AVAssetWriter* writer = nil;
    AVAssetWriterInput* writerInput = nil;
    AVAssetWriterInputPixelBufferAdaptor* adaptor = nil;
    bool writerFailed = false;
    long framesWritten = 0;

    ~Feed() {
        if (latest) CVPixelBufferRelease(latest);
    }
};

}  // namespace

// The delivery end: keeps the newest frame and notices an idle feed.
@interface RcCameraDelegate : NSObject <AVCaptureVideoDataOutputSampleBufferDelegate> {
  @public
    Feed* feed;
    dispatch_queue_t control;
}
@end

@implementation RcCameraDelegate
- (void)captureOutput:(AVCaptureOutput*)output
    didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
           fromConnection:(AVCaptureConnection*)connection {
    (void)output; (void)connection;
    Feed* f = feed;
    if (!f) return;
    CVPixelBufferRef pb = CMSampleBufferGetImageBuffer(sampleBuffer);
    if (pb) {
        CVPixelBufferRetain(pb);
        std::lock_guard<std::mutex> guard(f->lock);
        if (f->latest) CVPixelBufferRelease(f->latest);
        f->latest = pb;
        f->seq++;
    }
    // A take: this frame, at its time since the take began, less the pauses.
    if (pb && f->takeRunning && !f->writerFailed) {
        const double pts = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sampleBuffer));
        const double rel = pts - f->takeStart - f->pausedTotal.load();
        if (f->pausedAt.load() < 0.0 && rel >= 0.0) {
            if (!f->writer) {
                NSError* error = nil;
                NSURL* url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:f->takePath.c_str()]];
                [[NSFileManager defaultManager] removeItemAtURL:url error:nil];
                AVAssetWriter* writer = [AVAssetWriter assetWriterWithURL:url fileType:AVFileTypeQuickTimeMovie error:&error];
                const int w = (int)CVPixelBufferGetWidth(pb), h = (int)CVPixelBufferGetHeight(pb);
                NSDictionary* settings = @{
                    AVVideoCodecKey : AVVideoCodecTypeH264,
                    AVVideoWidthKey : @(w),
                    AVVideoHeightKey : @(h),
                    AVVideoCompressionPropertiesKey : @{AVVideoAverageBitRateKey : @(w * h * 4)},
                };
                AVAssetWriterInput* input = [AVAssetWriterInput assetWriterInputWithMediaType:AVMediaTypeVideo
                                                                               outputSettings:settings];
                input.expectsMediaDataInRealTime = YES;
                AVAssetWriterInputPixelBufferAdaptor* adaptor = [AVAssetWriterInputPixelBufferAdaptor
                    assetWriterInputPixelBufferAdaptorWithAssetWriterInput:input
                                               sourcePixelBufferAttributes:@{(id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA)}];
                if (!writer || ![writer canAddInput:input]) {
                    std::fprintf(stderr, "camera: cannot write the take: %s\n", error.localizedDescription.UTF8String ?: "?");
                    f->writerFailed = true;
                    return;
                }
                [writer addInput:input];
                if (![writer startWriting]) {
                    std::fprintf(stderr, "camera: cannot start the take: %s\n", writer.error.localizedDescription.UTF8String ?: "?");
                    f->writerFailed = true;
                    return;
                }
                [writer startSessionAtSourceTime:kCMTimeZero];
                f->writer = writer;
                f->writerInput = input;
                f->adaptor = adaptor;
                std::fprintf(stderr, "camera: take -> %s (%dx%d, first frame at %.2fs)\n", f->takePath.c_str(), w, h, rel);
            }
            if (f->writerInput.readyForMoreMediaData) {
                if ([f->adaptor appendPixelBuffer:pb withPresentationTime:CMTimeMakeWithSeconds(rel, 600)]) {
                    f->framesWritten++;
                }
            }
        }
    }
    // Nobody has drawn this feed for a while: the deck has moved on. Stop from the control
    // queue, so this callback is not the one waiting for the session to drain. Not while a
    // take is being recorded from it.
    if (f->running && !f->takeRunning && nowSec() - f->lastDraw.load() > kIdleStopSec) {
        AVCaptureSession* session = f->session;
        f->running = false;
        dispatch_async(control, ^{
            if (session.isRunning) [session stopRunning];
        });
    }
}
@end

struct CameraCustomHost::Impl {
    bool live = true;
    std::map<std::string, std::unique_ptr<Feed>> feeds;   // by device query
    Feed* recording = nullptr;               // the feed with a take running, or null
    // A take played back in place of the live feed.
    std::string takePath;
    std::unique_ptr<AvfFrameReader> takeReader;
    bool takeOpenFailed = false;
    double takeTime = 0.0;

    Feed* feedFor(const std::string& device) {
        auto it = feeds.find(device);
        if (it == feeds.end()) {
            auto feed = std::make_unique<Feed>();
            feed->query = device;
            it = feeds.emplace(device, std::move(feed)).first;
        }
        return it->second.get();
    }
    dispatch_queue_t control = dispatch_queue_create("rcplayer.camera.control", DISPATCH_QUEUE_SERIAL);

    // The camera a query names, or nil.
    static AVCaptureDevice* find(const std::string& query) {
        if (query.empty() || query == "default") {
            return [AVCaptureDevice defaultDeviceWithMediaType:AVMediaTypeVideo];
        }
        NSMutableArray<AVCaptureDeviceType>* types = [NSMutableArray array];
        [types addObject:AVCaptureDeviceTypeBuiltInWideAngleCamera];
        if (@available(macOS 14.0, *)) {
            [types addObject:AVCaptureDeviceTypeExternal];
            [types addObject:AVCaptureDeviceTypeContinuityCamera];
        }
        AVCaptureDeviceDiscoverySession* discovery =
            [AVCaptureDeviceDiscoverySession discoverySessionWithDeviceTypes:types
                                                                   mediaType:AVMediaTypeVideo
                                                                    position:AVCaptureDevicePositionUnspecified];
        NSArray<AVCaptureDevice*>* devices = discovery.devices;
        const bool numeric = !query.empty()
            && std::all_of(query.begin(), query.end(), [](unsigned char c) { return std::isdigit(c); });
        if (numeric) {
            const NSUInteger index = static_cast<NSUInteger>(std::stoul(query));
            return index < devices.count ? devices[index] : nil;
        }
        std::string want = query;
        std::transform(want.begin(), want.end(), want.begin(), [](unsigned char c) { return std::tolower(c); });
        for (AVCaptureDevice* d in devices) {
            std::string name = d.localizedName.UTF8String ?: "";
            std::transform(name.begin(), name.end(), name.begin(), [](unsigned char c) { return std::tolower(c); });
            if (name.find(want) != std::string::npos) return d;
        }
        return nil;
    }

    // Build and start the session on the control queue. Called once access is granted.
    void startSession(Feed* f) {
        dispatch_async(control, ^{
            @autoreleasepool {
                if (f->running) { f->starting = false; return; }
                if (!f->session) {
                    AVCaptureDevice* device = find(f->query);
                    if (!device) {
                        std::fprintf(stderr, "camera: no camera matches \"%s\"\n", f->query.c_str());
                        f->failed = true;
                        f->starting = false;
                        return;
                    }
                    NSError* error = nil;
                    AVCaptureDeviceInput* input = [AVCaptureDeviceInput deviceInputWithDevice:device error:&error];
                    if (!input) {
                        std::fprintf(stderr, "camera: cannot open %s: %s\n", device.localizedName.UTF8String,
                                     error.localizedDescription.UTF8String ?: "?");
                        f->failed = true;
                        f->starting = false;
                        return;
                    }
                    AVCaptureSession* session = [[AVCaptureSession alloc] init];
                    [session beginConfiguration];
                    // The best the camera does: a take is authoring material, and a box on a
                    // slide may be most of the slide (a phone on a desk, say).
                    if ([session canSetSessionPreset:AVCaptureSessionPresetHigh]) {
                        session.sessionPreset = AVCaptureSessionPresetHigh;
                    }
                    if ([session canAddInput:input]) [session addInput:input];
                    AVCaptureVideoDataOutput* output = [[AVCaptureVideoDataOutput alloc] init];
                    output.videoSettings = @{(id)kCVPixelBufferPixelFormatTypeKey : @(kCVPixelFormatType_32BGRA)};
                    output.alwaysDiscardsLateVideoFrames = YES;
                    RcCameraDelegate* delegate = [[RcCameraDelegate alloc] init];
                    delegate->feed = f;
                    delegate->control = control;
                    f->frames = dispatch_queue_create("rcplayer.camera.frames", DISPATCH_QUEUE_SERIAL);
                    [output setSampleBufferDelegate:delegate queue:f->frames];
                    if ([session canAddOutput:output]) [session addOutput:output];
                    [session commitConfiguration];
                    f->session = session;
                    f->delegate = delegate;
                    std::fprintf(stderr, "camera: %s\n", device.localizedName.UTF8String);
                }
                f->lastDraw = nowSec();
                [f->session startRunning];
                f->running = true;
                f->starting = false;
            }
        });
    }

    void ensureRunning(Feed* f) {
        if (f->running || f->starting || f->failed) return;
        f->starting = true;
        f->lastDraw = nowSec();
        const AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeVideo];
        if (status == AVAuthorizationStatusAuthorized) {
            startSession(f);
        } else if (status == AVAuthorizationStatusNotDetermined) {
            [AVCaptureDevice requestAccessForMediaType:AVMediaTypeVideo completionHandler:^(BOOL granted) {
                if (granted) { startSession(f); }
                else { f->failed = true; f->starting = false; }
            }];
        } else {
            std::fprintf(stderr, "camera: no access to the camera — allow it in System Settings › Privacy\n");
            f->failed = true;
            f->starting = false;
        }
    }

    // Close the take: on the frames queue, after the last frame, then move or drop the file.
    void endTake(Feed* f) {
        f->takeRunning = false;
        if (recording == f) recording = nullptr;
        if (!f->frames) return;
        dispatch_async(f->frames, ^{
            AVAssetWriter* writer = f->writer;
            f->writer = nil;
            f->writerInput = nil;
            f->adaptor = nil;
            const std::string path = f->takePath, moveTo = f->takeMoveTo;
            const bool discard = f->takeDiscard;
            const long frames = f->framesWritten;
            f->framesWritten = 0;
            f->writerFailed = false;
            if (!writer) {
                if (!discard) std::fprintf(stderr, "camera: the take got no frames (was the camera allowed?)\n");
                return;
            }
            [writer finishWritingWithCompletionHandler:^{
                NSFileManager* fm = [NSFileManager defaultManager];
                NSURL* url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path.c_str()]];
                if (writer.status != AVAssetWriterStatusCompleted) {
                    std::fprintf(stderr, "camera: the take failed: %s\n",
                                 writer.error.localizedDescription.UTF8String ?: "?");
                    [fm removeItemAtURL:url error:nil];
                    return;
                }
                if (discard) {
                    [fm removeItemAtURL:url error:nil];
                    std::fprintf(stderr, "camera: take dropped\n");
                    return;
                }
                NSURL* final = url;
                if (!moveTo.empty()) {
                    final = [NSURL fileURLWithPath:[NSString stringWithUTF8String:moveTo.c_str()]];
                    [fm removeItemAtURL:final error:nil];
                    NSError* moveError = nil;
                    if (![fm moveItemAtURL:url toURL:final error:&moveError]) {
                        std::fprintf(stderr, "camera: cannot move the take to %s: %s\n", moveTo.c_str(),
                                     moveError.localizedDescription.UTF8String ?: "?");
                        return;
                    }
                }
                NSDictionary* attrs = [fm attributesOfItemAtPath:final.path error:nil];
                const double mb = attrs ? [attrs[NSFileSize] doubleValue] / 1e6 : 0.0;
                std::fprintf(stderr, "camera: take saved: %s (%ld frames, %.1f MB)\n", final.path.UTF8String, frames, mb);
            }];
        });
    }

    void stopAll() {
        for (auto& [query, f] : feeds) {
            AVCaptureSession* session = f->session;
            if (!session) continue;
            f->running = false;
            dispatch_sync(control, ^{
                if (session.isRunning) [session stopRunning];
            });
        }
    }
};

CameraCustomHost::CameraCustomHost() : mImpl(std::make_unique<Impl>()) {}

CameraCustomHost::~CameraCustomHost() {
    stop();
    // The delivery queues may still hold a frame in flight for a delegate that points here.
    for (auto& [query, f] : mImpl->feeds) {
        if (f->delegate) static_cast<RcCameraDelegate*>(f->delegate)->feed = nullptr;
        if (f->frames) dispatch_sync(f->frames, ^{});
    }
}

void CameraCustomHost::setLive(bool live) {
    mImpl->live = live;
    if (!live) stop();
}

bool CameraCustomHost::live() const { return mImpl->live; }

void CameraCustomHost::reset() {}

void CameraCustomHost::stop() { mImpl->stopAll(); }

bool CameraCustomHost::active() const {
    for (const auto& [query, f] : mImpl->feeds) {
        if (f->running || f->starting) return true;
    }
    return false;
}

bool CameraCustomHost::parseConfig(const std::string& config, Config* out) {
    return rcplayer::parseCameraConfig(config, out);
}

// ── Takes ────────────────────────────────────────────────────────────

bool CameraCustomHost::startTake(const std::string& device, const std::string& path) {
    if (!mImpl->live || path.empty()) return false;
    if (mImpl->recording) finishTake();
    Feed* f = mImpl->feedFor(device.empty() ? "default" : device);
    mImpl->ensureRunning(f);
    if (f->failed) return false;
    f->takePath = path;
    f->takeMoveTo.clear();
    f->takeDiscard = false;
    f->pausedAt = -1.0;
    f->pausedTotal = 0.0;
    f->takeStart = CMTimeGetSeconds(CMClockGetTime(CMClockGetHostTimeClock()));   // the wav's start, near enough
    f->lastDraw = nowSec();
    f->takeRunning = true;          // the frames queue writes from the next frame on
    mImpl->recording = f;
    return true;
}

void CameraCustomHost::finishTake(const std::string& moveTo) {
    Feed* f = mImpl->recording;
    if (!f) return;
    f->takeMoveTo = moveTo;
    f->takeDiscard = false;
    mImpl->endTake(f);
}

void CameraCustomHost::discardTake() {
    Feed* f = mImpl->recording;
    if (!f) return;
    f->takeDiscard = true;
    mImpl->endTake(f);
}

void CameraCustomHost::pauseTake(bool paused) {
    Feed* f = mImpl->recording;
    if (!f) return;
    const double now = CMTimeGetSeconds(CMClockGetTime(CMClockGetHostTimeClock()));
    if (paused && f->pausedAt.load() < 0.0) {
        f->pausedAt = now;
    } else if (!paused && f->pausedAt.load() >= 0.0) {
        f->pausedTotal = f->pausedTotal.load() + (now - f->pausedAt.load());
        f->pausedAt = -1.0;
    }
}

bool CameraCustomHost::takeRunning() const { return mImpl->recording != nullptr; }

void CameraCustomHost::setTake(const std::string& path) {
    if (path == mImpl->takePath) return;
    if (!path.empty()) std::fprintf(stderr, "camera: playing the take %s\n", path.c_str());
    mImpl->takePath = path;
    mImpl->takeReader.reset();
    mImpl->takeOpenFailed = false;
    mImpl->takeTime = 0.0;
}

void CameraCustomHost::setTakeTime(double sec) { mImpl->takeTime = std::max(0.0, sec); }

bool CameraCustomHost::takePlaying() const { return !mImpl->takePath.empty(); }

// ── Drawing ──────────────────────────────────────────────────────────

namespace {

// A frame into the box: cropped, fitted (fill by default), mirrored when asked.
void drawFrame(SkCanvas* canvas, const sk_sp<SkImage>& image, const CameraCustomHost::Config& cfg,
               float w, float h) {
    const float imgW = static_cast<float>(image->width());
    const float imgH = static_cast<float>(image->height());
    SkRect src = SkRect::MakeLTRB(cfg.crop[0] * imgW, cfg.crop[1] * imgH, cfg.crop[2] * imgW, cfg.crop[3] * imgH);
    if (src.width() <= 0 || src.height() <= 0) src = SkRect::MakeWH(imgW, imgH);
    const float s = (cfg.fit == "fit") ? std::min(w / src.width(), h / src.height())
                  : (cfg.fit == "native") ? 1.0f
                  : std::max(w / src.width(), h / src.height());      // fill: cover the box
    const float dw = src.width() * s, dh = src.height() * s;
    SkRect dst = SkRect::MakeXYWH((w - dw) * 0.5f, (h - dh) * 0.5f, dw, dh);
    canvas->save();
    canvas->clipRect(SkRect::MakeWH(w, h));
    if (cfg.mirror) {
        canvas->translate(w, 0);
        canvas->scale(-1, 1);
    }
    SkSamplingOptions sampling(SkFilterMode::kLinear, SkMipmapMode::kNone);
    canvas->drawImageRect(image, src, dst, sampling, nullptr, SkCanvas::kStrict_SrcRectConstraint);
    canvas->restore();
}

// A dark plate where the picture will be, so the box reads as a box and not a hole.
void drawPlate(SkCanvas* canvas, float w, float h) {
    SkPaint plate;
    plate.setColor(0xFF101318);
    canvas->drawRect(SkRect::MakeWH(w, h), plate);
}

}  // namespace

bool CameraCustomHost::drawCustom(int /*componentId*/, const std::string& config,
                                  rccore::PaintContext* pc, float w, float h, double /*t*/) {
    if (w <= 0 || h <= 0) return false;
    Config cfg;
    if (!parseConfig(config, &cfg)) return false;
    auto* skpc = static_cast<rcskia::SkiaPaintContext*>(pc);
    if (!skpc || !skpc->canvas()) return false;
    SkCanvas* canvas = skpc->canvas();

    // A take being played: the recording, at the narration's time, in every camera box.
    if (!mImpl->takePath.empty()) {
        if (!mImpl->takeReader && !mImpl->takeOpenFailed) {
            mImpl->takeReader = AvfFrameReader::Open(mImpl->takePath);
            if (!mImpl->takeReader) mImpl->takeOpenFailed = true;
        }
        sk_sp<SkImage> frame = mImpl->takeReader ? mImpl->takeReader->frameAt(mImpl->takeTime) : nullptr;
        if (frame) drawFrame(canvas, frame, cfg, w, h);
        else drawPlate(canvas, w, h);
        pc->needsRepaint();
        return true;
    }

    if (!mImpl->live) {
        // Told not to: the marked box, and no session.
        rcplayer::drawCameraStandIn(canvas, cfg, w, h);
        return true;
    }

    Feed* f = mImpl->feedFor(cfg.device);
    f->lastDraw = nowSec();
    mImpl->ensureRunning(f);

    // The newest frame, as an image, when there is one newer than the last painted.
    {
        CVPixelBufferRef pb = nullptr;
        uint64_t seq = 0;
        {
            std::lock_guard<std::mutex> guard(f->lock);
            if (f->latest && f->seq != f->painted) {
                pb = f->latest;
                CVPixelBufferRetain(pb);
                seq = f->seq;
            }
        }
        if (pb) {
            CVPixelBufferLockBaseAddress(pb, kCVPixelBufferLock_ReadOnly);
            const size_t pw = CVPixelBufferGetWidth(pb);
            const size_t ph = CVPixelBufferGetHeight(pb);
            const size_t rb = CVPixelBufferGetBytesPerRow(pb);
            void* base = CVPixelBufferGetBaseAddress(pb);
            SkImageInfo info = SkImageInfo::Make(static_cast<int>(pw), static_cast<int>(ph),
                                                 kBGRA_8888_SkColorType, kPremul_SkAlphaType);
            SkPixmap src(info, base, rb);
            SkBitmap bm;
            if (base && bm.tryAllocPixels(info)) {
                bm.writePixels(src, 0, 0);
                bm.setImmutable();
                f->image = bm.asImage();
                f->painted = seq;
            }
            CVPixelBufferUnlockBaseAddress(pb, kCVPixelBufferLock_ReadOnly);
            CVPixelBufferRelease(pb);
        }
    }

    if (!f->image) {
        // Starting, or nothing to show.
        drawPlate(canvas, w, h);
        if (!f->failed) pc->needsRepaint();
        return true;
    }
    drawFrame(canvas, f->image, cfg, w, h);
    pc->needsRepaint();      // a live feed is a new frame every frame
    return true;
}
