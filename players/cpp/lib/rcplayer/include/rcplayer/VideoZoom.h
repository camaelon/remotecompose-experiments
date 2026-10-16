// Zoom keyframes on an embedded video: "zooms=T@x,y,z;T@x,y,z…" (T in seconds of the clip, x,y
// the centre as fractions of the — cropped — frame, z the zoom factor). Before the first key
// the whole frame shows; at each key the view eases from wherever it is to the new centre and
// zoom over `dur` seconds, a snappy ease-out, zoom interpolated in log space so it doesn't
// lurch. z = 1 zooms back out. The view never leaves the frame.
//
// Shared by the live video host and the still hosts, so a still and the clip it stands for
// frame the same way at the same time. Mirrored in the web player (CustomHosts.ts).
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <string>
#include <vector>

namespace rcplayer {

struct ZoomKey { double t, x, y, z; };

inline std::vector<ZoomKey> parseZooms(const std::string& s) {
    std::vector<ZoomKey> keys;
    size_t p0 = 0;
    while (p0 < s.size()) {
        size_t semi = s.find(';', p0);
        std::string k = s.substr(p0, semi == std::string::npos ? std::string::npos : semi - p0);
        auto at = k.find('@');
        if (at != std::string::npos) {
            ZoomKey z{std::strtod(k.c_str(), nullptr), 0.5, 0.5, 1.0};
            const char* c = k.c_str() + at + 1;
            char* e = nullptr;
            z.x = std::strtod(c, &e); if (e && *e == ',') c = e + 1;
            z.y = std::strtod(c, &e); if (e && *e == ',') c = e + 1;
            z.z = std::max(1.0, std::strtod(c, &e));
            keys.push_back(z);
        }
        if (semi == std::string::npos) break;
        p0 = semi + 1;
    }
    std::sort(keys.begin(), keys.end(), [](const ZoomKey& a, const ZoomKey& b) { return a.t < b.t; });
    return keys;
}

// The source crop at clip time `t`: the base crop (l,t,r,b fractions) narrowed to the zoomed view.
inline void zoomCrop(const std::vector<ZoomKey>& keys, double t, const float base[4], float out[4],
                     double dur = 0.55) {
    for (int i = 0; i < 4; i++) out[i] = base[i];
    if (keys.empty()) return;
    struct V { double x, y, lz; };
    auto ease = [](double u) { u = std::clamp(u, 0.0, 1.0); return 1.0 - std::pow(1.0 - u, 4.0); };  // quart out
    auto mix = [](const V& a, const V& b, double e) {
        return V{a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e, a.lz + (b.lz - a.lz) * e};
    };
    V from{0.5, 0.5, 0.0}, to = from;
    double t0 = -1e9;
    for (const auto& k : keys) {
        if (k.t > t) break;
        V now = mix(from, to, ease((k.t - t0) / dur));      // where the view is when this key fires
        from = now; to = V{k.x, k.y, std::log(k.z)}; t0 = k.t;
    }
    V v = mix(from, to, ease((t - t0) / dur));
    const double z = std::exp(v.lz), half = 0.5 / z;
    const double cx = std::clamp(v.x, half, 1.0 - half), cy = std::clamp(v.y, half, 1.0 - half);
    const double bw = base[2] - base[0], bh = base[3] - base[1];
    out[0] = (float)(base[0] + (cx - half) * bw); out[2] = (float)(base[0] + (cx + half) * bw);
    out[1] = (float)(base[1] + (cy - half) * bh); out[3] = (float)(base[1] + (cy + half) * bh);
}

}  // namespace rcplayer
