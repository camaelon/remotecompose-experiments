# rcplayer

The desktop playback runtime. `rcviewer` is one app built on it; so is refract's
presenter player. If you are writing a third, link this — do not fork the viewer.

## What it gives you

| Header                   | What it covers                                                     |
|--------------------------|--------------------------------------------------------------------|
| `rcplayer/Player.h`      | The player: playlist, document load, surface sizing, `renderFrame`, voice-over, touch mapping, and `attachWindow` |
| `rcplayer/Callbacks.h`   | The viewer's default GLFW input handling, installable wholesale or one callback at a time |
| `rcplayer/RenderBackend.h` + `CpuRenderBackend.h` / `MetalRenderBackend.h` | Skia surface behind a window: CPU raster or Metal GPU, both presented through an OpenGL texture |
| `rcplayer/MediaTypes.h`  | Which extensions are playable, and how a path splits                |
| `rcplayer/ZipArchive.h`  | Read a whole deck out of one `.zip`                                 |
| `rcplayer/PdfExport.h`   | Whole-deck PDF export (`exportDeckToPdf`) and the single-page renderer behind it; also the `.notes` sidecar reader |
| `rcplayer/ImageExport.h` | Whole-deck PNG export (`exportDeckToImages`) — one file per slide |
| `rcplayer/StillHosts.h`  | The custom-component hosts for painting a document off-screen — used by PDF pages and by a player's previews |
| `rcplayer/WebpPlayer.h`, `AvfVideoPlayer.h` | Animated images and macOS video as whole slides    |
| `rcplayer/VideoCustomHost.h`, `WebCustomHost.h` | `LAYOUT_CUSTOM` hosts for video and web embeds inside a document |
| `rcplayer/WidgetHelper.h`| Put a borderless window on the macOS desktop layer                   |

State is process-wide — `rcplayer::g` — because a player is a single window playing
a single document at a time. The host app owns the window and the loop.

Two things are easy to miss when writing a player:

- **`attachWindow(window)`, not `g.window = window`.** An embedded web page is a real
  `WKWebView` added to the window's content view, so the web host needs the window too.
  Set the field by hand and web embeds silently draw nothing.
- **Off-screen renders need `StillHosts`.** The live hosts cannot serve one: the video host
  plays asynchronously and paints nothing in a one-shot render, and the web host needs a
  window. Register nothing and every embed comes out as an empty box.

## Minimal player

```cpp
#include "rcplayer/Callbacks.h"
#include "rcplayer/CpuRenderBackend.h"
#include "rcplayer/Player.h"

using namespace rcplayer;

g.files   = collectRcFiles("deck/out");
g.backend = std::make_unique<CpuRenderBackend>();
attachWindow(window);        // the player *and* the hosts that place native views
ensureSurface(1600, 900);
installDefaultCallbacks(window);
loadCurrentFile();

while (!glfwWindowShouldClose(window)) {
    glfwPollEvents();
    g.animTime += dt;
    renderFrame(dt);
    g.backend->present();
    glfwSwapBuffers(window);
}
```

## Exporting instead of playing

```cpp
#include "rcplayer/ImageExport.h"
#include "rcplayer/PdfExport.h"

rcplayer::exportDeckToPdf   ("deck/out", "deck.pdf", 1600, 900, /*delaySec=*/2.0);
rcplayer::exportDeckToImages("deck/out", "deck/png", 1600, 900, /*delaySec=*/2.0);
```

Both take a directory, a zip or a single file, and neither needs a window or an event loop.
The PDF path builds a private engine instance per page and goes through Skia's PDF backend,
so `.rc` slides stay vector; the image path drives the player and snapshots its surface, so
a slide comes out exactly as it looks on screen.

## Build

```cmake
add_subdirectory(path/to/players/cpp rcx)   # -DRCX_BUILD_APPS=OFF for libs only
target_link_libraries(myplayer PRIVATE rcplayer)
```
