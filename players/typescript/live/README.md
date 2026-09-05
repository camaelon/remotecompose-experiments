# live — browse a directory of documents, then edit one and watch it redraw

```sh
node live/live.mjs ../../../rcJson/iot-panels/src --open   # a directory: browse
node live/live.mjs live/demo.json --open                   # one file: straight in
```

Point it at a directory and it compiles every `.json` under it, then opens a browser: a file
list on the left, and on the right the selected document **running**, with what it cost.
Press **view** and the layout switches to the source with the document playing in an inset —
edit the file and both update.

Pointed at a single file, there is nothing to browse, so it opens straight into the view.

## The demo it is built for

1. Browse the list, click a document. It starts playing, with its stats.
2. **The name goes on the clipboard as you click it** — so you can paste it straight into a
   prompt: *edit `24_smart_kettle.json` and make the accent red*.
3. Hit **view** to watch the source and the document side by side while the edit lands.

The clipboard write needs a user activation, which both a click and a real keypress provide.
It still fails if the window is not focused, and that failure is shown next to the filename
rather than swallowed — silently not copying would be discovered at exactly the wrong
moment.

### Keys

| | |
| :--- | :--- |
| `↑` `↓` | move through the list — including while the filter box has focus |
| `Home` `End` | first / last |
| `Enter` | open the selected document in the view |
| `Esc` | back to the list |

Arrows walk the *filtered* rows, and clamp rather than wrap so holding a key comes to a stop.
The highlight moves on every keypress, but loading the document — and rewriting the
clipboard — waits 180 ms for you to settle: landing on a file selects it, passing over it
does not. A click has no such delay.

## How the page finds out

It doesn't. A browser cannot watch a file, so nothing in the page ever touches the disk.

```
*.json ──fs.watch──▶ live.mjs ──json2rc──▶ .rc bytes ──SSE──▶ page ──▶ canvas
```

`live.mjs` watches the **directory**, recursively, not individual files. An editor that saves
by writing a temporary file and renaming it over the original replaces the inode, and a watch
on the file follows the old one into the void — the first save works and nothing after it
does.

On a change it recompiles that one file and writes a line — the source and the compiled bytes
as base64 — down a Server-Sent Events connection the page opened once with
`EventSource('/events')`. Every client updates its list row; whoever is showing that document
also redraws it. No polling, no reload. The animation clock is `continuousSec()`, which is
wall-clock, so motion does not restart.

This is a Node server, not Python; the whole pipeline is TypeScript. The one thing it cannot
be is a `file://` page with no process behind it. If that is what you want, the File System
Access API can do it — `showOpenFilePicker` hands back a handle you can re-read on a timer,
with `json2rc` bundled into the browser — at the cost of picking files by hand, and Chrome
only.

## Stats

Per document: dimensions, JSON bytes, `.rc` bytes, gzipped bytes, the JSON→`.rc` ratio, and
how long the conversion took. Along the bottom, the same totalled over the directory —
pointed at the 80 IoT panels it reads `80/80 compiled · 937 KB json → 169 KB rc → 69 KB
gzip`, which is the useful number: what the whole set costs on the wire.

Files that do not compile stay in the list as red rows with their error, rather than being
dropped. A list that quietly omits what it cannot build lies about the size of the set.

## The source view

Folding, highlighting and change tracking live in `view.mjs`, which is plain text-in text-out
so it can be tested outside a browser:

```sh
node live/test-view.mjs
```

* **Folding.** Every bracket pair spanning more than one line gets a chevron; collapsing one
  pulls the closing bracket up onto the opening line so the JSON still reads as JSON. The
  scanner tracks string state rather than counting brackets, because a document that *draws*
  a `]` would otherwise close its array early and throw every fold below it out of alignment
  — while still looking like a plausible outline. Folds are keyed by line text and
  occurrence, not line number, so inserting a line above a folded block does not collapse
  something else instead.

* **A change inside a folded block reveals it.** Editing something you cannot see and
  watching nothing happen would be the worst thing this view could do.

* **Highlighting** separates keys, strings, numbers and literals, and — the useful part —
  marks strings the engine will *evaluate* apart from strings it will draw. Hex colours get a
  swatch of the actual colour, since changing one is the most likely live edit. The hyphen is
  the whole difficulty there: treating `-` as arithmetic makes `"living-room-hub"` an
  expression, so a hyphen counts only with space on both sides.

* **Changed lines flash** and the view scrolls to the first one. Line-for-line, not a real
  diff, so an insert lights up everything below it — which is honest.

## What it does when you break a file

Both of these will happen while editing live, and neither should look like a crash:

* **A document that does not compile does not blank the panel.** The last version that
  compiled keeps playing while the broken source stays on screen with the error beneath it.
  When the file is fixed, it snaps back.
* **A save caught mid-write is retried once** before being called an error. Editors write in
  two steps and `fs.watch` fires happily in between; without the retry you get JSON syntax
  errors that fix themselves, indistinguishable from real mistakes.

The terminal gets a line per compile — size, change in size, and conversion time — so a
change that alters nothing is visible as `·` rather than silence.

## Checking it renders

An animating canvas never goes idle, so `--virtual-time-budget` never elapses and headless
Chrome hangs — `--screenshot` and `--dump-dom` both sit there until killed. Drive a real
browser over the DevTools protocol instead (node 22 has a `WebSocket` client built in):

```sh
open -a "Google Chrome" --args --remote-debugging-port=9222 \
     --user-data-dir=/tmp/chrome-live --app=http://localhost:7654/
curl -s localhost:9222/json/list | grep -o '"title":"[^"]*"'
#   24_smart_kettle.json 360x360 bytes=2655 ink=116678 mode=view folds=0 files=80
```

The page writes its state into `document.title`, which the HTTP endpoint hands over without a
websocket. `ink` counts pixels differing from the corner: a canvas that drew nothing and one
that drew correctly are identical to every other check — same byte count, no errors — and
`ink=0` is the difference.

One caveat when driving it this way: the window is on screen and a human can click in it
between two evaluations. If the selection is not what you set, that is the likely reason —
check the server log for recompiles before hunting for a bug.
