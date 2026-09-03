# rcplayer

The desktop playback runtime. `rcviewer` is one app built on it; so is refract's
presenter player. If you are writing a third, link this — do not fork the viewer.

## What it gives you

| Header                   | What it covers                                                     |
|--------------------------|--------------------------------------------------------------------|
| `rcplayer/Player.h`      | The player: playlist, document load, surface sizing, `renderFrame`, voice-over, touch mapping |
| `rcplayer/Callbacks.h`   | The viewer's default GLFW input handling, installable wholesale or one callback at a time |
| `rcplayer/RenderBackend.h` + `CpuRenderBackend.h` / `MetalRenderBackend.h` | Skia surface behind a window: CPU raster or Metal GPU, both presented through an OpenGL texture |
| `rcplayer/MediaTypes.h`  | Which extensions are playable, and how a path splits                |
| `rcplayer/ZipArchive.h`  | Read a whole deck out of one `.zip`                                 |
| `rcplayer/PdfExport.h`   | One PDF page per slide (vector), and the `.notes` sidecar reader     |
| `rcplayer/WebpPlayer.h`, `AvfVideoPlayer.h` | Animated images and macOS video as whole slides    |
| `rcplayer/VideoCustomHost.h`, `WebCustomHost.h` | `LAYOUT_CUSTOM` hosts for video and web embeds inside a document |
| `rcplayer/WidgetHelper.h`| Put a borderless window on the macOS desktop layer                   |

State is process-wide — `rcplayer::g` — because a player is a single window playing
a single document at a time. The host app owns the window and the loop.

## Minimal player

```cpp
#include "rcplayer/Callbacks.h"
#include "rcplayer/CpuRenderBackend.h"
#include "rcplayer/Player.h"

using namespace rcplayer;

g.files   = collectRcFiles("deck/out");
g.backend = std::make_unique<CpuRenderBackend>();
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

## Build

```cmake
add_subdirectory(path/to/players/cpp rcx)   # -DRCX_BUILD_APPS=OFF for libs only
target_link_libraries(myplayer PRIVATE rcplayer)
```
