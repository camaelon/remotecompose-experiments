// PDF export — one page per slide, rendered through Skia's PDF backend so .rc content
// stays vector. Also exposes the speaker-notes sidecar reader, which presenter UIs want
// for the same reason the PDF does.
#pragma once

#include <string>

class SkDocument;

namespace rcplayer {

// The presenter notes for a slide, from its "<entry>.notes" sidecar. "" when there is none.
std::string readSlideNotes(const std::string& entry);

// Append one page for `entry` to `pdf`. .rc/.rcd documents animate for `delaySec` and are
// then painted vector onto the page; videos and animated images contribute a first frame.
// When the slide has notes, the page grows taller and they are drawn in a panel below it.
bool renderSlideToPdfPage(SkDocument* pdf, const std::string& entry,
                          int pageW, int pageH, double delaySec);

struct PdfExportResult {
    int pages = 0;
    int failures = 0;
    bool ok() const { return pages > 0 && failures == 0; }
};

// Export a whole deck to a multi-page PDF, one page per slide. `input` is a directory of
// slides, a zip bundle, or a single file — the same three things a player will play.
// `delaySec` is how long each slide animates before it is captured, so a slide that
// animates in is not caught blank.
//
// Progress is reported on stdout, failures on stderr; a page that cannot be rendered is
// skipped rather than abandoning the export.
PdfExportResult exportDeckToPdf(const std::string& input, const std::string& output,
                                int pageW, int pageH, double delaySec);

}  // namespace rcplayer
