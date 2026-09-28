// The marked box drawn where the camera would be, when the camera cannot be: a still, an
// export, a player told not to open it. A dark plate with a dashed frame and the word
// "camera" (and the device asked for, when one was), so a preview reads "the speaker goes
// here" rather than showing a hole. Pure Skia; shared by the still-frame stand-in host and
// the live host in its off state.
#pragma once

#include "rcplayer/CameraCustomHost.h"

class SkCanvas;

namespace rcplayer {

void drawCameraStandIn(SkCanvas* canvas, const CameraCustomHost::Config& cfg, float w, float h);

}  // namespace rcplayer
