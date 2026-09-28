// The camera embed's config string, read: "camera:<device>#fit=…&crop=…&mirror=1".
//
// Pure CPU. Returns 0 on success, 1 on any failed assertion.

#include "rcplayer/CameraCustomHost.h"

#include <cstdio>
#include <string>

static int failures = 0;
#define CHECK(cond, msg) do { \
    if (!(cond)) { std::fprintf(stderr, "FAIL: %s\n", msg); ++failures; } \
    else         { std::fprintf(stderr, "ok:   %s\n", msg); } \
} while (0)

int main() {
    CameraCustomHost::Config c;
    CHECK(CameraCustomHost::parseConfig("camera:default", &c) && c.device == "default" && c.fit == "fill"
          && !c.mirror && c.crop[2] == 1.0f, "the bare form: the default camera, filling its box");
    CHECK(CameraCustomHost::parseConfig("camera:FaceTime#fit=fit&crop=0.1,0.0,0.9,1.0&mirror=1", &c)
          && c.device == "FaceTime" && c.fit == "fit" && c.mirror
          && c.crop[0] == 0.1f && c.crop[2] == 0.9f, "a named camera, fitted, cropped and mirrored");
    CHECK(CameraCustomHost::parseConfig("camera:1#mirror", &c) && c.device == "1" && c.mirror,
          "an index, and a bare mirror flag");
    CHECK(CameraCustomHost::parseConfig("camera:#mirror=0", &c) && c.device == "default" && !c.mirror,
          "an empty device is the default; mirror=0 is off");
    CHECK(CameraCustomHost::parseConfig("camera:x#crop=0.9,0,0.1,1", &c) && c.crop[0] == 0.0f && c.crop[2] == 1.0f,
          "an inside-out crop is ignored");
    CHECK(!CameraCustomHost::parseConfig("video:clip.mp4", &c), "not a camera");
    if (failures) { std::fprintf(stderr, "%d failure(s)\n", failures); return 1; }
    std::printf("camera_config: all passed\n");
    return 0;
}
