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
    static std::unique_ptr<AvfVideoPlayer> Open(const std::string& path);
    ~AvfVideoPlayer();

    // Extract the first video frame synchronously as an SkImage.
    // Uses AVAssetImageGenerator — does not spin up a player. Returns null on
    // failure. Used by the PDF export path.
    static sk_sp<SkImage> ExtractFirstFrame(const std::string& path);

    int width()  const;
    int height() const;
    double durationSec() const;

    // Pull the most recent decoded frame and draw it aspect-fit-centred into
    // a (dstW x dstH) destination on the given canvas.
    void paint(SkCanvas* canvas, int dstW, int dstH);

    // Pause / resume playback. AVPlayer drives its own clock so we have to
    // call this explicitly when the host viewer toggles its pause flag.
    void setPaused(bool paused);

private:
    AvfVideoPlayer();
    struct Impl;
    std::unique_ptr<Impl> mImpl;
};
