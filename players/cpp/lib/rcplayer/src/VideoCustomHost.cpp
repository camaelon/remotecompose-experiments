#include "rcplayer/VideoCustomHost.h"

#include "rcplayer/AvfVideoPlayer.h"
#include "rcskia/MediaZoom.h"
#include "rcskia/SkiaPaintContext.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <thread>
#include <vector>

#include "include/core/SkCanvas.h"
#include "include/core/SkImage.h"
#include "include/core/SkSamplingOptions.h"

namespace fs = std::filesystem;

void VideoCustomHost::reset() {
    mPlayers.clear();
    mFailed.clear();
    mOpening.clear();      // the threads keep their own reference; nothing here waits for them
    // Decoded frames outlive the slide: they are keyed by file and time, and a `cue` still
    // slide is followed by its playing slide, which stands in that very frame until playback
    // delivers one. Dropping it here left the video box empty for the redecode, a visible gap.
    // In-flight decodes are kept for the same reason. Bounded, so a long deck doesn't hoard.
    if (mStills.size() > 16) mStills.clear();
    if (mDecoding.size() > 16) mDecoding.clear();
}

void VideoCustomHost::setPaused(bool paused) {
    mPaused = paused;
    for (auto& [id, player] : mPlayers) {
        if (player) player->setPaused(paused);
    }
}

// Parse a "#k=v&k=v" option suffix on a media config: "crop=l,t,r,b" (source fractions 0–1,
// default full frame), "start=S" (seconds: playback begins there and loops back to it) and
// "still=T" (seconds: show that frame, frozen, instead of playing). Returns the bare path.
struct VideoOpts {
    float crop[4] = {0.0f, 0.0f, 1.0f, 1.0f};
    double start = 0.0, still = -1.0, until = -1.0;   // "until=U": play [start, U] and hold
    bool loop = true;                         // "loop=0" / "once": play through once and hold
    std::vector<rczoom::ZoomKey> zooms;     // "zooms=T@x,y,z;…", see rcskia/MediaZoom.h
};
static std::string parseVideoConfig(const std::string& s, VideoOpts& o) {
    auto hash = s.find('#');
    if (hash == std::string::npos) return s;
    std::string opts = s.substr(hash + 1);
    for (size_t p0 = 0; p0 <= opts.size(); ) {
        size_t amp = opts.find('&', p0);
        std::string tok = opts.substr(p0, amp == std::string::npos ? std::string::npos : amp - p0);
        auto eq = tok.find('=');
        if (tok == "once") o.loop = false;
        if (eq != std::string::npos) {
            std::string k = tok.substr(0, eq), v = tok.substr(eq + 1);
            if (k == "crop") {
                float t[4];
                if (std::sscanf(v.c_str(), "%f,%f,%f,%f", &t[0], &t[1], &t[2], &t[3]) == 4)
                    for (int i = 0; i < 4; i++) o.crop[i] = t[i];
            } else if (k == "start") {
                o.start = std::strtod(v.c_str(), nullptr);
            } else if (k == "still") {
                o.still = std::strtod(v.c_str(), nullptr);
            } else if (k == "until") {
                o.until = std::strtod(v.c_str(), nullptr);
            } else if (k == "loop") {
                o.loop = !(v == "0" || v == "false" || v == "off" || v == "no" || v == "once");
            } else if (k == "zooms") {
                o.zooms = rczoom::parseZooms(v);
            }
        }
        if (amp == std::string::npos) break;
        p0 = amp + 1;
    }
    return s.substr(0, hash);
}

// An image aspect-fit-centred into (0,0)..(w,h) through a source crop: how a playing frame is
// framed too, so a still and the clip it stands for line up exactly.
static void drawFitted(SkCanvas* canvas, const sk_sp<SkImage>& img, float w, float h, const float crop[4]) {
    float iw = (float)img->width(), ih = (float)img->height();
    SkRect src = SkRect::MakeLTRB(crop[0] * iw, crop[1] * ih, crop[2] * iw, crop[3] * ih);
    if (src.width() <= 0 || src.height() <= 0) src = SkRect::MakeWH(iw, ih);
    float sc = std::min(w / src.width(), h / src.height());
    float dw = src.width() * sc, dh = src.height() * sc;
    SkRect dst = SkRect::MakeXYWH((w - dw) * 0.5f, (h - dh) * 0.5f, dw, dh);
    canvas->drawImageRect(img, src, dst, SkSamplingOptions(SkFilterMode::kLinear, SkMipmapMode::kNone),
                          nullptr, SkCanvas::kFast_SrcRectConstraint);
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
    VideoOpts o;
    std::string path = parseVideoConfig(rest, o);
    if (path.empty()) return false;
    fs::path full(path);
    if (full.is_relative() && !mBaseDir.empty()) full = fs::path(mBaseDir) / full;

    auto* skpc = static_cast<rcskia::SkiaPaintContext*>(pc);
    if (!skpc || !skpc->canvas()) return false;

    // The clip's frame at `t`, decoded once and kept. Async, it is null until the background
    // decode lands; the frame asks for the next one meanwhile so the result is picked up.
    auto frameAt = [&](double t) -> sk_sp<SkImage> {
        std::string key = full.string() + "@" + std::to_string(t);
        auto si = mStills.find(key);
        if (si != mStills.end()) return si->second;
        if (!mAsync) return mStills.emplace(key, AvfVideoPlayer::ExtractFrameAt(full.string(), t)).first->second;
        auto& job = mDecoding[key];
        if (!job) {
            job = std::make_shared<Job<sk_sp<SkImage>>>();
            std::thread([job, file = full.string(), t] {
                sk_sp<SkImage> img = AvfVideoPlayer::ExtractFrameAt(file, t);
                std::lock_guard<std::mutex> lock(job->m);
                job->value = std::move(img);
                job->done = true;
            }).detach();
        }
        {
            std::lock_guard<std::mutex> lock(job->m);
            if (job->done) {
                sk_sp<SkImage> img = job->value;
                mDecoding.erase(key);
                return mStills.emplace(key, img).first->second;
            }
        }
        pc->needsRepaint();
        return nullptr;
    };

    // A still: the clip's frame at `still`, frozen. No player is opened, so nothing plays and
    // nothing is heard until the next slide shows the same clip live.
    if (o.still >= 0.0) {
        sk_sp<SkImage> img = frameAt(o.still);
        if (!img) return false;
        float zc[4]; rczoom::zoomCrop(o.zooms, o.still, o.crop, zc);
        drawFitted(skpc->canvas(), img, w, h, zc);
        return true;
    }

    auto it = mPlayers.find(componentId);
    if (it == mPlayers.end()) {
        auto f = mFailed.find(componentId);
        if (f != mFailed.end() && f->second) return false;   // known-bad, don't retry
        std::unique_ptr<AvfVideoPlayer> player;
        if (!mAsync) {
            player = AvfVideoPlayer::Open(full.string(), o.start, o.loop, o.until);
            if (!player) { mFailed[componentId] = true; return false; }
        } else {
            // Opened on a background thread; until it is, the frame playback starts on stands in.
            auto& job = mOpening[componentId];
            if (!job) {
                job = std::make_shared<Job<std::unique_ptr<AvfVideoPlayer>>>();
                std::thread([job, file = full.string(), start = o.start, loop = o.loop, until = o.until] {
                    auto opened = AvfVideoPlayer::Open(file, start, loop, until);
                    std::lock_guard<std::mutex> lock(job->m);
                    job->value = std::move(opened);
                    job->done = true;
                }).detach();
            }
            bool done = false;
            {
                std::lock_guard<std::mutex> lock(job->m);
                if (job->done) { player = std::move(job->value); done = true; }
            }
            if (!done) {
                float zc[4];
                rczoom::zoomCrop(o.zooms, o.start, o.crop, zc);
                if (sk_sp<SkImage> img = frameAt(o.start)) drawFitted(skpc->canvas(), img, w, h, zc);
                pc->needsRepaint();
                return true;
            }
            mOpening.erase(componentId);
            if (!player) { mFailed[componentId] = true; return false; }
        }
        if (mPaused) player->setPaused(true);
        it = mPlayers.emplace(componentId, std::move(player)).first;
    }

    // The core has already translated the canvas to this component's content box, so
    // draw the frame at (0,0)..(w,h). Cast is safe: the viewer uses SkiaPaintContext.
    // The zoom follows the picture: the view at the clip time of the frame being drawn (the one
    // pulled last frame — a frame's lag, invisible at the speed a zoom moves).
    float zc[4];
    rczoom::zoomCrop(o.zooms, it->second->hasFrame() ? it->second->frameTimeSec() : o.start, o.crop, zc);
    it->second->paint(skpc->canvas(), static_cast<int>(w), static_cast<int>(h),
                       zc[0], zc[1], zc[2], zc[3]);
    // Until AVFoundation hands over its first frame (a moment after the slide opens, or never
    // in an export that paints on a simulated clock), show the frame playback starts on: no
    // black box, and a still slide followed by its playing slide reads as one picture
    // starting to move.
    if (!it->second->hasFrame()) {
        if (sk_sp<SkImage> img = frameAt(o.start)) drawFitted(skpc->canvas(), img, w, h, zc);
    }
    return true;
}
