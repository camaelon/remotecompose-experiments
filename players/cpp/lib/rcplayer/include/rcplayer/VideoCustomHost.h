// A CustomComponentHost that renders embedded video custom components ("video:<file>")
// using AvfVideoPlayer. Registered on the RemoteContext so LAYOUT_CUSTOM (op 93)
// components with a "video" config draw a live, looping video in-page.
#pragma once

#include "rccore/CustomComponentHost.h"

#include <map>
#include <memory>
#include <string>

class AvfVideoPlayer;

class VideoCustomHost : public rccore::CustomComponentHost {
public:
    // Directory the slide was loaded from; relative video paths resolve against it.
    void setBaseDir(const std::string& dir) { mBaseDir = dir; }
    // Drop all players (call when leaving a slide).
    void reset();
    // Pause / resume every video.
    void setPaused(bool paused);

    bool drawCustom(int componentId, const std::string& config,
                    rccore::PaintContext* pc, float w, float h, double timeSec) override;

private:
    std::string mBaseDir;
    std::map<int, std::unique_ptr<AvfVideoPlayer>> mPlayers;
    std::map<int, bool> mFailed;      // ids that failed to open (don't retry every frame)
    bool mPaused = false;
};
