#include "VideoCustomHost.h"

#include "AvfVideoPlayer.h"
#include "rcskia/SkiaPaintContext.h"

#include <filesystem>

namespace fs = std::filesystem;

void VideoCustomHost::reset() {
    mPlayers.clear();
    mFailed.clear();
}

void VideoCustomHost::setPaused(bool paused) {
    mPaused = paused;
    for (auto& [id, player] : mPlayers) {
        if (player) player->setPaused(paused);
    }
}

bool VideoCustomHost::drawCustom(int componentId, const std::string& config,
                                 rccore::PaintContext* pc, float w, float h, double /*t*/) {
    if (w <= 0 || h <= 0) return false;

    // config is "video:<path>" (or just "<path>"); the path is the video file.
    std::string path = config;
    auto colon = config.find(':');
    if (colon != std::string::npos && config.compare(0, colon, "video") == 0) {
        path = config.substr(colon + 1);
    }
    if (path.empty()) return false;

    auto it = mPlayers.find(componentId);
    if (it == mPlayers.end()) {
        auto f = mFailed.find(componentId);
        if (f != mFailed.end() && f->second) return false;   // known-bad, don't retry
        fs::path p(path);
        if (p.is_relative() && !mBaseDir.empty()) p = fs::path(mBaseDir) / p;
        auto player = AvfVideoPlayer::Open(p.string());
        if (!player) { mFailed[componentId] = true; return false; }
        if (mPaused) player->setPaused(true);
        it = mPlayers.emplace(componentId, std::move(player)).first;
    }

    // The core has already translated the canvas to this component's content box, so
    // draw the frame at (0,0)..(w,h). Cast is safe: the viewer uses SkiaPaintContext.
    auto* skpc = static_cast<rcskia::SkiaPaintContext*>(pc);
    if (!skpc || !skpc->canvas()) return false;
    it->second->paint(skpc->canvas(), static_cast<int>(w), static_cast<int>(h));
    return true;
}
