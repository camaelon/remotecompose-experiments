// AvfVideoPlayer — hardware-accelerated MP4/MOV playback via AVFoundation.
//
// Pure C++ interface so main.cpp does not need to import Objective-C headers.
// Internally backed by an AVQueuePlayer + AVPlayerLooper for seam-free looping
// and an AVPlayerItemVideoOutput per loop item to grab CVPixelBuffers each
// frame and blit them onto the Skia canvas.
//
// Apple platforms only (macOS, iOS).
#pragma once

#include <memory>
#include <string>

#include "include/core/SkRefCnt.h"

class SkCanvas;
class SkImage;

class AvfVideoPlayer {
public:
    // `startSec` > 0 starts playback there, and the loop comes back to it rather than to 0.
    // `loop` false plays once, from the start, and holds on the last frame. `untilSec` > start
    // plays once from the start to that time and holds there (a guided walk through a clip
    // pauses on each slide's last frame until the next slide).
    static std::unique_ptr<AvfVideoPlayer> Open(const std::string& path, double startSec = 0.0,
                                                bool loop = true, double untilSec = -1.0);
    ~AvfVideoPlayer();

    // Extract the first video frame synchronously as an SkImage.
    // Uses AVAssetImageGenerator — does not spin up a player. Returns null on
    // failure. Used by the PDF export path.
    static sk_sp<SkImage> ExtractFirstFrame(const std::string& path);
    // The frame at `sec` (exact, not the nearest keyframe), as ExtractFirstFrame does for 0.
    static sk_sp<SkImage> ExtractFrameAt(const std::string& path, double sec);

    int width()  const;
    int height() const;
    double durationSec() const;

    // Pull the most recent decoded frame and draw it aspect-fit-centred into a (dstW x dstH)
    // destination. An optional source crop (fractions 0–1, default = full frame) trims the
    // frame before fitting — e.g. to remove black bars around a portrait recording.
    void paint(SkCanvas* canvas, int dstW, int dstH,
               float cropL = 0.0f, float cropT = 0.0f, float cropR = 1.0f, float cropB = 1.0f);

    // True once a decoded frame has been drawn: until then paint() draws nothing, and a host
    // can show a poster in its place.
    bool hasFrame() const;
    // The clip time of the frame last drawn (seconds), for anything that follows the picture.
    double frameTimeSec() const;

    // Pause / resume playback. AVPlayer drives its own clock so we have to
    // call this explicitly when the host viewer toggles its pause flag.
    void setPaused(bool paused);

private:
    AvfVideoPlayer();
    struct Impl;
    std::unique_ptr<Impl> mImpl;
};
