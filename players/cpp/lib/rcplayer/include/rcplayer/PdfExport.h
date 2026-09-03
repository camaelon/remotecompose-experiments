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

}  // namespace rcplayer
