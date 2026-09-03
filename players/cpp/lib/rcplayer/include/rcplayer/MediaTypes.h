// Media-type predicates and small path helpers shared by every rcplayer host.
#pragma once

#include <cctype>
#include <string>

namespace rcplayer {

// Extensions the viewer treats as RC documents.
inline bool isRcExt(const std::string& ext) {
    return ext == ".rc" || ext == ".rcd";
}

// Animated image loops decoded by SkCodec (WebpPlayer).
inline bool isCodecVideoExt(const std::string& ext) {
    return ext == ".webp" || ext == ".gif" || ext == ".apng";
}

// Real video files decoded by AVFoundation (AvfVideoPlayer).
inline bool isAvfVideoExt(const std::string& ext) {
#if defined(__APPLE__)
    return ext == ".mp4" || ext == ".mov" || ext == ".m4v";
#else
    (void)ext;
    return false;
#endif
}

inline bool isPlayableExt(const std::string& ext) {
    return isRcExt(ext) || isCodecVideoExt(ext) || isAvfVideoExt(ext);
}

inline bool isZipFile(const std::string& ext) {
    return ext == ".zip";
}

// Get lowercase extension from a path or zip entry name.
inline std::string getExt(const std::string& name) {
    auto dot = name.rfind('.');
    if (dot == std::string::npos) return "";
    std::string ext = name.substr(dot);
    for (auto& c : ext) c = std::tolower(c);
    return ext;
}

// Get the filename portion of a path or zip entry name.
inline std::string baseName(const std::string& name) {
    auto slash = name.rfind('/');
    if (slash == std::string::npos) return name;
    return name.substr(slash + 1);
}

}  // namespace rcplayer
