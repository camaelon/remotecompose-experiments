#pragma once

#include "include/codec/SkCodec.h"
#include "include/core/SkBitmap.h"
#include "include/core/SkCanvas.h"
#include "include/core/SkData.h"
#include "include/core/SkImage.h"
#include "include/core/SkImageInfo.h"
#include "include/core/SkRect.h"
#include "include/core/SkSamplingOptions.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <iostream>
#include <memory>
#include <string>
#include <vector>

namespace rcplayer {

// ── Animated image player ────────────────────────────────────────────
// Decodes an animated WebP / GIF / APNG via SkCodec, caches every frame as an
// immutable SkImage, and paints the frame matching the elapsed time, looping
// forever. Used for slideshow video clips alongside .rc documents.
//
// Memory cost ≈ frameCount * width * height * 4 bytes. For typical slide
// loops (e.g. 1280x720, 4 sec @ 24 fps ≈ 350 MB) this is fine; for longer or
// higher-resolution clips, downscale during encode (`-vf scale=...`).
class WebpPlayer {
public:
    // Load from in-memory data (for zip archive support).
    static std::unique_ptr<WebpPlayer> LoadFromData(const std::vector<uint8_t>& bytes) {
        auto data = SkData::MakeWithCopy(bytes.data(), bytes.size());
        if (!data) return nullptr;
        return decodeFrames(data);
    }

    static std::unique_ptr<WebpPlayer> Load(const std::string& path) {
        auto data = SkData::MakeFromFileName(path.c_str());
        if (!data) return nullptr;
        return decodeFrames(data);
    }

private:
    static std::unique_ptr<WebpPlayer> decodeFrames(sk_sp<SkData> data) {
        auto codec = SkCodec::MakeFromData(data);
        if (!codec) return nullptr;

        const SkImageInfo info = codec->getInfo()
            .makeColorType(kN32_SkColorType)
            .makeAlphaType(kPremul_SkAlphaType);

        const int frameCount = codec->getFrameCount();
        if (frameCount <= 0) return nullptr;

        auto frameInfos = codec->getFrameInfo();
        auto player = std::unique_ptr<WebpPlayer>(new WebpPlayer());
        player->mWidth  = info.width();
        player->mHeight = info.height();

        // Persistent working buffer the codec decodes deltas into. Each
        // frame snapshot is then copied out into its own SkBitmap so the
        // resulting SkImages don't alias the working pixels.
        SkBitmap workBuf;
        if (!workBuf.tryAllocPixels(info)) return nullptr;

        int prior = SkCodec::kNoFrame;
        double cursorSec = 0.0;
        for (int i = 0; i < frameCount; ++i) {
            SkCodec::Options opts;
            opts.fFrameIndex = i;
            opts.fPriorFrame = prior;

            auto result = codec->getPixels(info, workBuf.getPixels(),
                                           workBuf.rowBytes(), &opts);
            if (result != SkCodec::kSuccess) {
                // Retry without a prior — forces a fresh decode of all
                // dependency frames into the working buffer.
                opts.fPriorFrame = SkCodec::kNoFrame;
                result = codec->getPixels(info, workBuf.getPixels(),
                                          workBuf.rowBytes(), &opts);
                if (result != SkCodec::kSuccess) {
                    std::cerr << "WebpPlayer: frame " << i << " decode failed ("
                              << (int)result << ")\n";
                    continue;
                }
            }
            prior = i;

            // Snapshot the working buffer into an immutable SkImage.
            SkBitmap snap;
            if (!snap.tryAllocPixels(info)) continue;
            if (!workBuf.readPixels(snap.pixmap(), 0, 0)) continue;
            snap.setImmutable();

            Frame f;
            f.image = snap.asImage();
            int durMs = (i < (int)frameInfos.size()) ? frameInfos[i].fDuration : 100;
            if (durMs <= 0) durMs = 100;
            f.startSec    = cursorSec;
            f.durationSec = durMs / 1000.0;
            cursorSec += f.durationSec;
            player->mFrames.push_back(std::move(f));
        }

        if (player->mFrames.empty()) return nullptr;
        player->mTotalSec = cursorSec;
        std::cerr << "WebpPlayer: " << player->mFrames.size() << " frames, "
                  << player->mTotalSec << "s, " << player->mWidth << "x"
                  << player->mHeight << "\n";
        return player;
    }

public:
    int width()  const { return mWidth;  }
    int height() const { return mHeight; }
    double totalSec() const { return mTotalSec; }
    int frameCount() const { return (int)mFrames.size(); }

    // Pick the frame matching elapsedSec (modulo total duration) and draw it
    // aspect-fit-centered into a (dstW x dstH) destination.
    void paint(SkCanvas* canvas, double elapsedSec, int dstW, int dstH) const {
        if (mFrames.empty() || mTotalSec <= 0) return;
        double t = std::fmod(elapsedSec, mTotalSec);
        if (t < 0) t += mTotalSec;

        // Linear scan is fine — frame counts are small (typically < a few hundred).
        const Frame* current = &mFrames.back();
        for (const auto& f : mFrames) {
            if (t >= f.startSec && t < f.startSec + f.durationSec) {
                current = &f;
                break;
            }
        }
        if (!current->image) return;

        const float sx = (float)dstW / (float)mWidth;
        const float sy = (float)dstH / (float)mHeight;
        const float s  = std::min(sx, sy);
        const float drawW = mWidth  * s;
        const float drawH = mHeight * s;
        const float ox = (dstW - drawW) * 0.5f;
        const float oy = (dstH - drawH) * 0.5f;

        SkRect dst = SkRect::MakeXYWH(ox, oy, drawW, drawH);
        SkSamplingOptions sampling(SkFilterMode::kLinear, SkMipmapMode::kNone);
        canvas->drawImageRect(current->image, dst, sampling);
    }

private:
    WebpPlayer() = default;
    struct Frame {
        sk_sp<SkImage> image;
        double startSec    = 0.0;
        double durationSec = 0.0;
    };
    int mWidth  = 0;
    int mHeight = 0;
    double mTotalSec = 0.0;
    std::vector<Frame> mFrames;
};

}  // namespace rcplayer
