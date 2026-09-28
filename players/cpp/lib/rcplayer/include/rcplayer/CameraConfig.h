// "camera:<device>#fit=fill|fit&crop=l,t,r,b&mirror=1", read. Shared by the live host and
// its stub, and by the still-frame stand-in that labels the box in exports.
#pragma once

#include "rcplayer/CameraCustomHost.h"

#include <cstdio>
#include <string>

namespace rcplayer {

inline bool parseCameraConfig(const std::string& config, CameraCustomHost::Config* out) {
    *out = CameraCustomHost::Config();
    std::string rest = config;
    const auto colon = config.find(':');
    if (colon == std::string::npos || config.compare(0, colon, "camera") != 0) return false;
    rest = config.substr(colon + 1);
    std::string opts;
    const auto hash = rest.find('#');
    if (hash != std::string::npos) {
        opts = rest.substr(hash + 1);
        rest = rest.substr(0, hash);
    }
    if (!rest.empty()) out->device = rest;
    size_t pos = 0;
    while (pos <= opts.size()) {
        auto amp = opts.find('&', pos);
        if (amp == std::string::npos) amp = opts.size();
        const std::string tok = opts.substr(pos, amp - pos);
        pos = amp + 1;
        const auto eq = tok.find('=');
        const std::string k = eq == std::string::npos ? tok : tok.substr(0, eq);
        const std::string v = eq == std::string::npos ? std::string() : tok.substr(eq + 1);
        if (k == "fit" && !v.empty()) out->fit = v;
        else if (k == "mirror") out->mirror = v.empty() || (v != "0" && v != "false" && v != "off");
        else if (k == "crop") {
            float t[4];
            if (std::sscanf(v.c_str(), "%f,%f,%f,%f", &t[0], &t[1], &t[2], &t[3]) == 4
                && t[2] > t[0] && t[3] > t[1]) {
                for (int i = 0; i < 4; i++) out->crop[i] = t[i];
            }
        }
        if (amp == opts.size()) break;
    }
    return true;
}

}  // namespace rcplayer
