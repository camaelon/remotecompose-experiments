// The camera on the slide, through AVFoundation.
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
    // Nobody has drawn this feed for a while: the deck has moved on. Stop from the control
    // queue, so this callback is not the one waiting for the session to drain.
    if (f->running && nowSec() - f->lastDraw.load() > kIdleStopSec) {
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
                    if ([session canSetSessionPreset:AVCaptureSessionPreset1280x720]) {
                        session.sessionPreset = AVCaptureSessionPreset1280x720;
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

bool CameraCustomHost::drawCustom(int /*componentId*/, const std::string& config,
                                  rccore::PaintContext* pc, float w, float h, double /*t*/) {
    if (w <= 0 || h <= 0) return false;
    Config cfg;
    if (!parseConfig(config, &cfg)) return false;

    if (!mImpl->live) {
        // Told not to: the marked box, and no session.
        auto* still = static_cast<rcskia::SkiaPaintContext*>(pc);
        if (!still || !still->canvas()) return false;
        rcplayer::drawCameraStandIn(still->canvas(), cfg, w, h);
        return true;
    }

    auto it = mImpl->feeds.find(cfg.device);
    if (it == mImpl->feeds.end()) {
        auto feed = std::make_unique<Feed>();
        feed->query = cfg.device;
        it = mImpl->feeds.emplace(cfg.device, std::move(feed)).first;
    }
    Feed* f = it->second.get();
    f->lastDraw = nowSec();
    mImpl->ensureRunning(f);

    auto* skpc = static_cast<rcskia::SkiaPaintContext*>(pc);
    if (!skpc || !skpc->canvas()) return false;
    SkCanvas* canvas = skpc->canvas();

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

    canvas->save();
    canvas->clipRect(SkRect::MakeWH(w, h));
    if (!f->image) {
        // Starting, or nothing to show: a dark plate where the picture will be, so the box
        // reads as a box and not a hole in the slide.
        SkPaint plate;
        plate.setColor(0xFF101318);
        canvas->drawRect(SkRect::MakeWH(w, h), plate);
        if (f->failed && !f->saidFailed) f->saidFailed = true;
        canvas->restore();
        if (!f->failed) pc->needsRepaint();
        return true;
    }

    const float imgW = static_cast<float>(f->image->width());
    const float imgH = static_cast<float>(f->image->height());
    SkRect src = SkRect::MakeLTRB(cfg.crop[0] * imgW, cfg.crop[1] * imgH, cfg.crop[2] * imgW, cfg.crop[3] * imgH);
    if (src.width() <= 0 || src.height() <= 0) src = SkRect::MakeWH(imgW, imgH);
    const float s = (cfg.fit == "fit") ? std::min(w / src.width(), h / src.height())
                  : (cfg.fit == "native") ? 1.0f
                  : std::max(w / src.width(), h / src.height());      // fill: cover the box
    const float dw = src.width() * s, dh = src.height() * s;
    SkRect dst = SkRect::MakeXYWH((w - dw) * 0.5f, (h - dh) * 0.5f, dw, dh);
    if (cfg.mirror) {
        canvas->translate(w, 0);
        canvas->scale(-1, 1);
    }
    SkSamplingOptions sampling(SkFilterMode::kLinear, SkMipmapMode::kNone);
    canvas->drawImageRect(f->image, src, dst, sampling, nullptr, SkCanvas::kStrict_SrcRectConstraint);
    canvas->restore();
    pc->needsRepaint();      // a live feed is a new frame every frame
    return true;
}
