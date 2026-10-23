// A CustomComponentHost that renders embedded video custom components ("video:<file>")
// using AvfVideoPlayer. Registered on the RemoteContext so LAYOUT_CUSTOM (op 93)
// components with a "video" config draw a live, looping video in-page.
#pragma once

#include "rccore/CustomComponentHost.h"

#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "include/core/SkRefCnt.h"

class AvfVideoPlayer;
class SkImage;

class VideoCustomHost : public rccore::CustomComponentHost {
public:
    // Directory the slide was loaded from; relative video paths resolve against it.
    void setBaseDir(const std::string& dir) { mBaseDir = dir; }
    // Drop all players (call when leaving a slide).
    void reset();
    // Pause / resume every video.
    void setPaused(bool paused);
    // Open movies and decode poster/still frames on a background thread instead of inside
    // the first draw, which otherwise stalls the frame a slide's video first appears in by
    // the 40–110 ms that opening takes. Off by default: an export paints on a simulated
    // clock and needs the frame there and then; the live player turns it on.
    void setAsync(bool async) { mAsync = async; }

    bool drawCustom(int componentId, const std::string& config,
                    rccore::PaintContext* pc, float w, float h, double timeSec) override;

private:
    std::string mBaseDir;
    std::map<int, std::unique_ptr<AvfVideoPlayer>> mPlayers;
    std::map<int, bool> mFailed;      // ids that failed to open (don't retry every frame)
    std::map<std::string, sk_sp<SkImage>> mStills;   // `still=T` frames, by path and time

    // Background work (setAsync): a result filled in by a detached thread. Abandoned jobs —
    // the slide changed before they finished — just finish and are dropped; nothing waits.
    template <class T> struct Job { std::mutex m; bool done = false; T value; };
    std::map<int, std::shared_ptr<Job<std::unique_ptr<AvfVideoPlayer>>>> mOpening;
    std::map<std::string, std::shared_ptr<Job<sk_sp<SkImage>>>> mDecoding;
    bool mAsync = false;
    bool mPaused = false;
};
