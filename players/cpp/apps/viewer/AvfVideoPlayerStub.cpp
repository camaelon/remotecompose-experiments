#include "AvfVideoPlayer.h"

#include "include/core/SkImage.h"

class SkCanvas;

struct AvfVideoPlayer::Impl {};

AvfVideoPlayer::AvfVideoPlayer() : mImpl(std::make_unique<Impl>()) {}
AvfVideoPlayer::~AvfVideoPlayer() = default;

std::unique_ptr<AvfVideoPlayer> AvfVideoPlayer::Open(const std::string& /*path*/) {
    return nullptr;
}

sk_sp<SkImage> AvfVideoPlayer::ExtractFirstFrame(const std::string& /*path*/) {
    return nullptr;
}

int AvfVideoPlayer::width() const {
    return 0;
}

int AvfVideoPlayer::height() const {
    return 0;
}

double AvfVideoPlayer::durationSec() const {
    return 0.0;
}

void AvfVideoPlayer::paint(SkCanvas* /*canvas*/, int /*dstW*/, int /*dstH*/) {}

void AvfVideoPlayer::setPaused(bool /*paused*/) {}
