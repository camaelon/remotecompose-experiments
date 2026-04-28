# packaging/ — TypeScript player deliverables

Two tools that wrap the bundled TypeScript player into shippable
artefacts. Both expect the player bundle to have been built first:

```sh
cd ../        # the typescript player root (sibling of this dir)
npm install
npm run bundle    # → web-player/bundle.js
```

## `build-standalone.sh` — single-file HTML

Embeds the player and **one** `.rc` document (base64) into a
self-contained HTML file. Open the HTML in any browser; no server
needed. Useful for sharing a single demo as one file.

```sh
./build-standalone.sh                                # uses samples/canvas.rc
./build-standalone.sh path/to/some.rc                # custom input
./build-standalone.sh path/to/some.rc out.html       # custom output path
```

Output defaults to `<typescript-root>/rc-player.html`.

The bundle is freshly minified each run via `esbuild` so the result is
always self-consistent.

## `make_deck_site.py` — directory → static site

Bundles a *directory of slides* (mixed `.rc` + `.mp4`/`.mov`/`.webp`)
into a small static website with keyboard navigation, slide list, and
optional fullscreen presentation mode. Drop the result on any HTTP
server (or open `index.html` from a `python3 -m http.server`).

```sh
./make_deck_site.py <deck-dir>                  # output → <deck-dir>/web/
./make_deck_site.py <deck-dir> <out-dir>        # custom output location
```

The deck directory's filenames determine slide order — files are sorted
alphabetically. Common convention: `01_intro.rc`, `02_demo.mp4`,
`03_outro.rc`.

The output looks like:

```
<out-dir>/
├── bundle.js          (copy of ../../web-player/bundle.js)
├── index.html         (deck UI, navigation, presentation mode)
├── 01_intro.rc
├── 02_demo.mp4
└── 03_outro.rc
```

To test:

```sh
cd <out-dir> && python3 -m http.server 8000
# open http://localhost:8000
```
