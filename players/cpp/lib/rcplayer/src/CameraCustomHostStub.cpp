// The camera host where there is no AVFoundation: the config still parses (so a still-frame
// stand-in can label the box), and the live draw does nothing.
#include "rcplayer/CameraCustomHost.h"

#include "rcplayer/CameraConfig.h"
#include "rcplayer/CameraStandIn.h"
#include "rcskia/SkiaPaintContext.h"

struct CameraCustomHost::Impl { bool live = true; };

CameraCustomHost::CameraCustomHost() : mImpl(std::make_unique<Impl>()) {}
CameraCustomHost::~CameraCustomHost() = default;
void CameraCustomHost::setLive(bool live) { mImpl->live = live; }
bool CameraCustomHost::live() const { return mImpl->live; }
void CameraCustomHost::reset() {}
void CameraCustomHost::stop() {}
bool CameraCustomHost::active() const { return false; }
bool CameraCustomHost::drawCustom(int, const std::string& config, rccore::PaintContext* pc, float w, float h, double) {
    // No camera here: the marked box, so the slide still reads.
    Config cfg;
    if (!parseConfig(config, &cfg)) return false;
    auto* skpc = static_cast<rcskia::SkiaPaintContext*>(pc);
    if (!skpc || !skpc->canvas()) return false;
    rcplayer::drawCameraStandIn(skpc->canvas(), cfg, w, h);
    return true;
}
bool CameraCustomHost::startTake(const std::string&, const std::string&) { return false; }
void CameraCustomHost::finishTake(const std::string&) {}
void CameraCustomHost::discardTake() {}
void CameraCustomHost::pauseTake(bool) {}
bool CameraCustomHost::takeRunning() const { return false; }
void CameraCustomHost::setTake(const std::string&) {}
void CameraCustomHost::setTakeTime(double) {}
bool CameraCustomHost::takePlaying() const { return false; }
bool CameraCustomHost::parseConfig(const std::string& config, Config* out) {
    return rcplayer::parseCameraConfig(config, out);
}
