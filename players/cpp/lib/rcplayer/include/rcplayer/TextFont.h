// The one typeface the exporters write with: the platform's default sans, through Skia's
// own font manager. Presenter notes under a PDF page and a caption line under a movie frame
// are the player's text, not the document's, and they should look like the system's.
#pragma once

#include "include/core/SkFont.h"

namespace rcplayer {

// A font of the platform's default typeface at `size`, anti-aliased and subpixel positioned.
// The typeface is found once and shared.
SkFont systemTextFont(float size);

}  // namespace rcplayer
