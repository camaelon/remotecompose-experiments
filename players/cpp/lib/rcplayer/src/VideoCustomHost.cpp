#include "rcplayer/VideoCustomHost.h"

#include "rcplayer/AvfVideoPlayer.h"
#include "rcskia/SkiaPaintContext.h"

#include <cstdio>
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

// Parse a "#k=v&k=v" option suffix on a media config for a "crop=l,t,r,b" (source fractions
// 0–1). Fills crop[4] (default full frame 0,0,1,1) and returns the bare path before '#'.
static std::string parsePathAndCrop(const std::string& s, float crop[4]) {
    crop[0] = 0.0f; crop[1] = 0.0f; crop[2] = 1.0f; crop[3] = 1.0f;
    auto hash = s.find('#');
    if (hash == std::string::npos) return s;
    std::string path = s.substr(0, hash);
    std::string opts = s.substr(hash + 1);
    auto pos = opts.find("crop=");
    if (pos != std::string::npos) {
        std::string v = opts.substr(pos + 5);
        auto amp = v.find('&');
        if (amp != std::string::npos) v = v.substr(0, amp);
        float t[4];
        if (std::sscanf(v.c_str(), "%f,%f,%f,%f", &t[0], &t[1], &t[2], &t[3]) == 4)
            for (int i = 0; i < 4; i++) crop[i] = t[i];
    }
    return path;
}

bool VideoCustomHost::drawCustom(int componentId, const std::string& config,
                                 rccore::PaintContext* pc, float w, float h, double /*t*/) {
    if (w <= 0 || h <= 0) return false;

    // config is "video:<path>" (or just "<path>"), with an optional "#crop=l,t,r,b" suffix.
    std::string rest = config;
    auto colon = config.find(':');
    if (colon != std::string::npos && config.compare(0, colon, "video") == 0) {
        rest = config.substr(colon + 1);
    }
    float crop[4];
    std::string path = parsePathAndCrop(rest, crop);
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
    it->second->paint(skpc->canvas(), static_cast<int>(w), static_cast<int>(h),
                       crop[0], crop[1], crop[2], crop[3]);
    return true;
}
