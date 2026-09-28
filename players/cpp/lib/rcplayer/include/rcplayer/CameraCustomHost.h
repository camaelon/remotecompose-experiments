// A CustomComponentHost that puts the machine's camera on the slide: LAYOUT_CUSTOM (op 93)
// components whose config is "camera:<device>#fit=fill|fit&crop=l,t,r,b&mirror=1" draw the
// live feed into their box. A speaker's own face beside their slides, in whatever frame the
// deck gives it — the box's clip (a circle, rounded corners) is the core's, applied before
// the host draws, so the feed takes the shape the layout drew.
//
// One capture session per device, shared by every component that asks for it and started
// the first time one draws. A session left undrawn — the deck moved on — stops itself after
// a few seconds, so the camera light does not stay on for a talk that used it once; the
// next slide that wants it starts it again. `<device>` is "default", a substring of a
// camera's name ("FaceTime", "iPhone"), or an index into the cameras the system lists.
//
// Apple platforms only: elsewhere the host draws nothing.
#pragma once

#include "rccore/CustomComponentHost.h"

#include <memory>
#include <string>

class CameraCustomHost : public rccore::CustomComponentHost {
public:
    CameraCustomHost();
    ~CameraCustomHost();

    // Off, the host never opens a camera and draws the marked box a still would show. For
    // an export, a headless run, a talk that must not show a face. On by default.
    void setLive(bool live);
    bool live() const;

    // Leaving a slide. Nothing is torn down: a feed idles itself when no slide draws it.
    void reset();
    // Every camera off, now. On quit, or for a run that must not show a face.
    void stop();
    // A feed is running or starting: the page should keep painting to show its frames.
    bool active() const;

    bool drawCustom(int componentId, const std::string& config,
                    rccore::PaintContext* pc, float w, float h, double timeSec) override;

    // The config's parts, for tests and for the still-frame stand-in: the device query
    // and the options. Fit is "fill" unless said otherwise.
    struct Config {
        std::string device = "default";
        std::string fit = "fill";
        float crop[4] = {0.0f, 0.0f, 1.0f, 1.0f};
        bool mirror = false;
    };
    static bool parseConfig(const std::string& config, Config* out);

private:
    struct Impl;
    std::unique_ptr<Impl> mImpl;
};
