// Deck → a video, frames piped to ffmpeg.
//
// Drives the player the way the image exporter does — load a slide, step its clock, paint —
// but every frame, at a fixed rate, for as long as each slide is to stay up. The frames go
// straight down a pipe into ffmpeg, which encodes them and muxes in an audio track the
// caller prepared (one wav laid out to the same timeline), so nothing lands on disk but the
// finished file. Persistent embeds carry across slides exactly as they do on screen.
#pragma once

#include <string>
#include <vector>

namespace rcplayer {

struct VideoSlide {
    std::string entry;      // a playlist entry, as collectDeckEntries returns them
    double duration = 0.0;  // how long it stays up, seconds (snapped to the frame grid)
};

struct VideoExportResult {
    int slides = 0;
    int frames = 0;
    bool ok = false;
};

// Encode `slides` back to back into `output` (an .mp4; the container comes from the name)
// at `width`×`height` and `fps`. `audio` is an audio file to mux underneath, already the
// length of the whole sequence, or empty for a silent video. `ffmpeg` names the encoder
// binary. The caller does not need a window: a CPU backend is installed.
VideoExportResult exportDeckToVideo(const std::vector<VideoSlide>& slides,
                                    const std::string& audio, const std::string& output,
                                    int width, int height, double fps,
                                    const std::string& ffmpeg = "ffmpeg");

}  // namespace rcplayer
