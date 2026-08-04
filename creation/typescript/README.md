# rcjson-ts — JSON → RemoteCompose, in TypeScript

A compiler from RemoteCompose JSON (the current `androidx-main` syntax) to the binary
`.rc` wire format, plus a browser editor that plays what you type.

Everything runs locally. The editor has no server: it compiles in the page and hands
the bytes straight to the TypeScript player, so the loop from keystroke to pixels is a
function call.

```
src/engine/
  wire.ts      big-endian buffer + NaN-id encoding
  header.ts    the header op and its tag map
  expr.ts      infix -> RPN expression compiler
  writer.ts    op encoders, id allocation, modifier emitters
  parser.ts    the JSON side: components, modifiers, canvas commands, resources
src/web/main.ts   the editor
```

## Use it

```bash
npm install
npm run bundle          # -> web/bundle.js
open web/index.html     # the editor
node verify.mjs         # byte-compare against the reference corpus
```

The editor also needs the player bundle beside it as `web/player.js`:

```bash
cp ../../players/typescript/web-player/bundle.js web/player.js
```

As a library:

```ts
import { compile } from "./src/engine/index.js";
const bytes = compile(JSON.parse(text));   // Uint8Array
```

## Correctness

**113 of 113 documents compile byte-identically** to the reference, across
`examples`, `demos`, `demos2`, `demos_anim`, `library`, `generated`, `upstream`,
`probes` and `shaders`.

That bar matters more than it sounds. A document that merely *compiles* proves nothing:
the wire format has no checksums and the players are tolerant, so a wrong opcode or a
mis-sized field frequently produces something that renders, just not what was asked
for. Byte equality against a converter already verified against the official androidx
parser is the only check that catches that class.

`node verify.mjs` runs it. The reference is `rcj` in the sibling `rcJson` repo, which is
itself byte-verified against the official parser via a JVM oracle.

Three things this cost, kept here because they are easy to reintroduce:

- **Ids travel as bits, never as numbers.** RemoteCompose hides ids in NaN payloads.
  Reading one into a JS number and writing it back canonicalises the NaN and silently
  destroys the id, so `fbits`, the RPN array and every float field carry raw `int32`
  patterns instead.
- **`asNan` is `v | 0xFF800000`**, not the positive quiet-NaN mask. Both produce a NaN;
  only one round-trips through the reference decoder.
- **Library entries are wrapped.** A generation-library file puts the document under a
  `json` key next to its prose metadata. Compiling the wrapper succeeds and yields a
  valid, empty, 17-byte header — which looks like a working build until you play it.
  `unwrap()` handles it.

## Coverage

Implemented: the header; `column` / `row` / `box` / `flow` / `fitBox` /
`collapsibleColumn` / `collapsibleRow` / `spacer` / `text` / `canvas`; the dimension,
background, padding, border, clip and weight modifiers; the canvas draw, paint, path,
matrix, `loop` and `conditionalOperations` commands; expressions with variables,
system values and animation; and the `colors`, `floatArrays` and `variables` resource
sections.

Not implemented, and **refused loudly rather than approximated**: inline AGSL shader
sources (`createShader`), macros and patterns, particles, bitmaps, themed colours, path
resources and SVG path strings, `drawTextRun`, and the `TextLayout` text op used when a
document declares no `profiles`.

That last policy is deliberate. Emitting a plausible-but-wrong document is the failure
mode this format punishes hardest, because it surfaces as a rendering oddity a long way
from its cause. An inline shader, for example, would coerce to `NaN`, and `writeInt(NaN)`
is `0` — a document that compiles cleanly and quietly draws with no shader at all. The
engine throws `NotImplementedComponent` instead, and the editor shows it as "not
supported yet" rather than as a broken document.

## Playing a Kotlin DSL document: `web/flappy.html`

`web/flappy.html` runs `DslGameFlappyDroid.kt` from the androidx demos — the whole game,
in a browser tab, from a single self-contained file. Touch and hold for jetpack thrust.

The document is **built on a device, then played anywhere**, and that split is forced
rather than chosen: the creation DSL cannot run on a plain JVM. `RcPlatformProfiles`
lives in `androidMain` and pulls in `AndroidxRcPlatformServices` for text measurement
and path parsing, so `dslGameFlappyDroid2()` needs a real Android runtime to produce
its bytes. Once it has, the bytes are just a document and any player will take them.

`DslDumpActivity` in player-view-demos does the building:

```bash
adb shell "am start -n <pkg>/.DslDumpActivity --es DSL flappy"
adb pull /sdcard/Android/data/<pkg>/files/rcjson/flappy.rc
python3 make_flappy.py           # or inline the bytes into a page yourself
```

4086 bytes of document. The page inlines both it and the player, so it works from
`file://` with no server.

Interaction needed no wiring: the player already forwards `pointerdown`/`move`/`up`
into the document's touch handling, which is what the jetpack reads. Verified rather
than assumed — holding the pointer moves the droid 336 px up the canvas, and releasing
it drops him again.
