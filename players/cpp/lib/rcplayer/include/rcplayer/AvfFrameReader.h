// Frames from a movie file, one at a time, by their time — for a recording that has to
// follow another clock (a narration's) rather than run on its own: a camera take played
// under the wav it was recorded with, on screen or into a video export.
//
// Decoding is sequential (AVAssetReader), which is what makes it cheap: asking for
// times that move forward costs one decode per frame; asking for an earlier time reopens
// the reader there. Apple platforms only.
#pragma once

#include <memory>
#include <string>

#include "include/core/SkRefCnt.h"

class SkImage;

class AvfFrameReader {
public:
    // Null when the file has no video track.
    static std::unique_ptr<AvfFrameReader> Open(const std::string& path);
    ~AvfFrameReader();

    int width() const;
    int height() const;
    double durationSec() const;

    // The frame showing at `sec` — the last one whose time is at or before it — or null
    // before the first frame has been decoded. The same image comes back while `sec` stays
    // within one frame, so a caller can compare pointers to know whether anything changed.
    sk_sp<SkImage> frameAt(double sec);

private:
    AvfFrameReader();
    struct Impl;
    std::unique_ptr<Impl> mImpl;
};
