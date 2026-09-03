// Deck → one PNG per slide.
//
// Unlike the PDF exporter, which builds a private engine instance per page, this drives the
// *player* — load a slide, let it animate, snapshot the surface — so a slide renders exactly
// as it would on screen, embedded media and all.
#pragma once

#include <string>

namespace rcplayer {

struct ImageExportResult {
    int images = 0;
    int failures = 0;
    bool ok() const { return images > 0 && failures == 0; }
};

// Write `<outputDir>/<slide stem>.png` for every slide in `input` (a directory of slides,
// a zip bundle, or a single file). The directory is created if it does not exist.
//
// `delaySec` is how long each slide animates before it is captured, so a slide that
// animates in is not caught blank. The caller does not need a window: this installs a CPU
// backend, and replaces whatever was loaded in the player.
//
// Progress is reported on stdout, failures on stderr; a slide that cannot be rendered is
// skipped rather than abandoning the export.
ImageExportResult exportDeckToImages(const std::string& input, const std::string& outputDir,
                                     int width, int height, double delaySec);

}  // namespace rcplayer
