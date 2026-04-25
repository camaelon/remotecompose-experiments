# rcviewer

GLFW + Metal desktop viewer. Loads `.rc`/`.rcd` documents, animated images
(WebP / GIF / APNG), video (MP4 / MOV via AVFoundation), and zip archives
of any mix, then plays through them with keyboard navigation.

## Build

From the repo root:

```sh
cmake -B build
cmake --build build -j --target rcviewer
```

The executable lands at `build/apps/viewer/rcviewer`.

## Run

```sh
./build/apps/viewer/rcviewer <file or directory>
```

Examples:

```sh
./build/apps/viewer/rcviewer samples/canvas.rc
./build/apps/viewer/rcviewer samples/                # cycles through every supported file
./build/apps/viewer/rcviewer some-deck.zip           # zip archive of mixed slides
```

## Keyboard

| Key                    | Action                                         |
|------------------------|------------------------------------------------|
| `←` / `→`              | Previous / next slide                          |
| `Space`                | Pause / resume animation                       |
| `R`                    | Reload the current file                        |
| `D`                    | Cycle through 3 levels of debug overlay        |
| `S`                    | Save a screenshot to `/tmp/viewer_screenshot.png` |
| `Q` / `Esc`            | Quit                                           |

## Mouse

A left-click drag forwards as a touch event to the document — touch-aware
documents (interactive sliders, gesture-driven plots, …) react in real time.
Velocity is computed on release and forwarded as the touch-up velocity.

## Headless modes

```sh
# Render a single file to PNG.
rcviewer --screenshot input.rc out.png [width height] [delay_sec]

# Render every .rc in a directory.
rcviewer --screenshot-dir ./samples ./out [width height] [delay_sec]

# Render the contents of a zip / directory to a multi-page PDF.
rcviewer --pdf input.zip out.pdf
```

The optional `delay_sec` argument lets the viewer animate for that many
seconds before grabbing the frame, which is useful for documents whose
opening state is blank or in motion.

## Auto-advance and widget mode

```sh
# Advance to the next file every 5 seconds.
rcviewer --auto 5 ./samples

# Run as a borderless, always-on-top widget with a transparent background.
rcviewer --widget some-doc.rc
```
