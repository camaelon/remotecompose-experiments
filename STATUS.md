# Status — read this first

Written for someone (or some agent) picking this repository up cold. It records what is
working, what is known broken, what is *verified* versus merely *believed*, and which
traps have already cost days. `players/typescript/GAPS.md` has the per-opcode detail;
`players/typescript/DEBUGGING.md` has the tooling plan.

## What changed most recently — layout & text conformance

A three-engine layout conformance harness now exists, and using it found and fixed **eight
defects**. The harness compares the *computed bounds of every component* between the
TypeScript player, the C++ player and the Java reference; the corpus and findings live in
`rcJson/layout/` (`PLAN.md`, `FINDINGS.md`, `run.py`, 117 documents across categories A–K).

New tools here:

| tool | what it answers |
| :--- | :--- |
| `players/typescript/layout.mjs` | the computed layout tree, `LAYOUT id=… x= y= w= h=` |
| `players/typescript/render.mjs` | render a document to PNG headlessly |
| `players/typescript/pvars.mjs` | which id belongs to which particle variable |
| `players/cpp/tools/rc2layout` | the same layout dump from the C++ player |
| `trace.mjs --tap f:x:y` | simulate discrete taps, with a deterministic clock |

Fixed in **both** players: fractional `fillMaxWidth/Height` was ignored; modifier order was
ignored for padding versus an explicit size (`.width(200).padding(30)` must be 200 wide
with 140 of content, not 260); the visibility modifier did not affect layout.

Fixed in **TypeScript**: oversized children were not clamped to the parent; a weight leaked
the full width where no distribution pass ran; children were measured against the space
offered rather than the parent's resolved size; `IntegerExpression` evaluated with the
unresolved mask, so "copy variable X" returned 0; `ID_DENSITY` and `ID_FONT_SIZE` were
seeded in `paint()` although the expressions consuming them evaluate in the **data** pass.
`TimeAttribute` (op 172) is now implemented rather than a parse-only stub.

Fixed in **C++**: `maxLines` was ignored; the visibility modifier was parsed and never
consulted; a bare fill's `NaN` was resolved as a variable id, destroying the fraction.

**Three of these share one shape** — the player relies on dirty propagation where the
reference recomputes unconditionally, and the failure is always *to zero*, silently. That
pattern is worth checking first when a value is mysteriously 0.

**Two things the harness cannot do.** The headless Java reference measures every text
component as `0x0` (its paint context returns no metrics and its text store does not
populate), so **text must be arbitrated on a device**, not headlessly. And a device
screenshot measures the *painted background*, which equals the component bounds only when
`background` is the last modifier.

`rcJson/docs/TEXT_SPEC.md` documents all 21 text operations and `CoreText` in detail —
worth reading before touching text layout.

## The one-paragraph version

Three implementations of the RemoteCompose format live here: a TypeScript player, a C++
player, and (new) a TypeScript **creation** engine that compiles JSON to the binary
format. The reference is `remote-core` in androidx — that is what Android runs and what
arbitrates every disagreement. The TypeScript player agrees with the reference on
**159 of 180** corpus documents, frame by frame. The creation engine is **113/113
byte-identical** to the reference converter. Both have known gaps, listed below.

## What is verified, and how

Verified means measured, not inspected.

| Claim | Evidence |
| :--- | :--- |
| Creation engine emits correct bytes | 113/113 documents byte-identical vs `rcj`, itself byte-verified against the androidx parser (`creation/typescript/verify.mjs`) |
| TS player matches the reference on state | 159/180 corpus documents agree frame-by-frame (`players/typescript/sweep.mjs` + `RcTraceTest`) |
| run-actions, setValue, conditionals, loops, arrays, particle pairs | ten single-feature fixtures, each traced on both engines (`RcFixtureTest` in remote-core) |
| Flappy Droid plays correctly in a browser | played by hand; the score advances |

**Not** verified: anything about sustained rendering in a browser. See the traps.

## Known issues — TypeScript player

Full detail in `GAPS.md`. Summary:

- **11 opcodes the reference registers and this player does not.** These are the
  dangerous ones: an unregistered opcode has no known length, so the byte stream
  desynchronises and everything after it is garbage. Notably `LAYOUT_TEXT` (208), the
  fallback text op for documents that declare no `profiles` — such documents cannot
  render text here at all.
- **13 opcodes that parse their bytes and then do nothing** (`TimeAttribute` is now
  implemented; the rest remain). Safe for the stream, but the
  feature silently does nothing — the hardest failure to notice. Includes the entire
  macro/Loom system (244–249), `PathTween`, `TimeAttribute`, and `WakeIn`.
- **21 corpus documents still diverge**, led by `upstream/cube_3d` (73 ids) and
  `upstream/demo_json_kt_3` (45). Both are matrix/3D-heavy; no fixture covers that area.
- `npx tsc --noEmit` reports **pre-existing** errors in `ColorAttribute.ts` and
  `BoxLayout.ts`. They predate this work. The bundle is built by esbuild, which does not
  typecheck, so they do not block anything — but do not mistake them for new breakage.

## Known issues — C++ player

- **Loom macros parse but do not expand.** All seven opcodes read correctly, so a macro
  document renders everything *outside* its macros (corpus 143/143 render). Macro content
  is absent — verified against the TS player, the degradation is "missing", not "wrong".
  Expansion needs id indirection in `WireBuffer` (~100 call sites), byte-span capture
  during inflate, then the expansion pass. Reference implementation:
  `players/typescript/src/core/operations/loom/`.
- `textFromFloat` renders `0.0` where the probe expects `42.5`.
- `maxLines` / `overflow` ignored — `maxLines: 1` with `overflow: ellipsis` renders four
  unclipped lines.
- `pathEffect` ignored — dashes render solid.
- `flow`'s `maxItemsInEachRow` is read but the layout ignores it.
- `rc2json` reports `Unknown opcode 243`: the schema table is separate from the reader
  table and lags it.

These five share a shape worth internalising: **a pass/fail render check cannot catch any
of them**, because the engine draws *something*. Only comparing the image finds them.

## Known issues — creation engine

Refuses rather than approximates. Not implemented: inline AGSL shader sources, macros and
patterns, particles, bitmaps, themed colours, path resources and SVG path strings,
`drawTextRun`, and the `TextLayout` text op. Each throws `NotImplementedComponent`.

This is deliberate. An inline shader would coerce to `NaN`, and `writeInt(NaN)` is `0` — a
document that compiles cleanly and quietly draws with no shader at all.

## Traps that have already cost days

Read these before trusting any measurement.

**1. Four bugs were empty stubs in androidx's own test harness, not in any player.** All
in `MacroTest.MockRemoteContext`, which every headless `remote-core` test uses:

| method | was | should be |
| :--- | :--- | :--- |
| `overrideFloat` | `{}` | `mRemoteComposeState.overrideFloat(...)` |
| `putObject` | `updateData(...)` | `updateObject(...)` — a *different* store from what `getObject` reads |
| `listensTo` | `{}` | `mRemoteComposeState.listenToVar(...)` |
| `addCollection` | `{}` | `mRemoteComposeState.addCollection(...)` |

Each makes the reference silently wrong in a way that reads as a bug in whatever you are
comparing against it. `listensTo` alone accounted for 15 corpus documents. **These are
fixed in the local androidx working copy, not upstream** — a fresh checkout of androidx
will reintroduce them.

**2. Pixels are the worst available instrument.** A frame that looks alive can be driven
entirely by `continuousSeconds()` while every action in the document is inert.
Colour-variety checks, frame hashes and sprite trackers all returned confident wrong
answers here; one "droid tracker" was measuring a cloud.

**3. Headless Chrome does not run the document.** Under `--virtual-time-budget` it paints
roughly once, so every before/after pixel comparison in it compares a frame with itself.
That is why the Node tracer exists.

**4. A malformed fixture is indistinguishable from an engine bug.** Three fixtures in a
row were wrong before one was right: an array id from the wrong id space, a single
particle where the algorithm needs pairs, and a bare variable reference where the pair
encoding needs `CMD1`. A wrong document does not error — it quietly evaluates to something
else. **Always write the negative control** (`cond_false` next to `cond_true`); without
it, "it works" and "it always fires" look identical.

**5. A differential says *that* two engines differ, never *which* is right.** The arbiter
is the DSL source of a document known to work. Reading `DslGameFlappyDroid.kt` — seeing
`drawCircle` inside the `particlesComparison` body — settled in one minute a question
fixtures had left ambiguous for hours.

**6. Go to structure early.** State tracing localises a problem to a *variable*; only
structure localises it to an *operation*. The bug that ended the last hunt (an `impulse`
that was a no-op, so a one-time `setValue` ran every frame) was found by asking the
document which operation wrote a particular id. `players/typescript/whowrites.mjs` does
exactly that and should be the first tool reached for.

## Tooling

```bash
cd players/typescript
npx esbuild src/node-entry.ts --bundle --outfile=build-node/node-entry.js \
    --format=esm --platform=node --external:canvas

node trace.mjs DOC.rc --frames 30 --dump --ops   # state per frame, ops that ran
node trace.mjs DOC.rc --frames 30 --hold         # with touch held
node sweep.mjs DIR 8                             # a whole corpus
node whowrites.mjs DOC.rc                        # which op writes which variable
node layout.mjs DOC.rc --width 400 --height 400  # computed layout tree
node render.mjs DOC.rc out.png --width 400       # headless PNG
node pvars.mjs DOC.rc --names a,b,c              # id -> particle variable
node trace.mjs DOC.rc --tap 30:120:200           # simulate a discrete tap
```

The C++ side has `build/tools/rc2layout/rc2layout DOC.rc W H`, emitting the same
`LAYOUT id=…` format so the three engines diff line by line.

The reference side lives in the androidx tree (`remote-core/src/test`): `RcTraceTest`
emits the same `frame N id=value` format, `RcFixtureTest` generates the fixtures, and
`NoOpPaintContext` lets the reference run headless. `RcTraceTest` is configured through
`/tmp/rc-trace.properties` because Gradle does not forward `-D` to the test JVM.

Caveat on the reference tracer: `MockRemoteContext` extends `RemoteContext(RemoteClock.SYSTEM)`,
so it reads wall-clock time. Hundreds of trace iterations complete in milliseconds and
document time barely advances — fine for state comparison, useless for anything
time-driven.

## Generated versus source

Not checked in, rebuild as needed:

| path | rebuild with |
| :--- | :--- |
| `players/typescript/web-player/bundle.js` | `npm run bundle` |
| `players/typescript/build-node/` | the esbuild line above |
| `creation/typescript/web/{bundle,player}.js` | `npm run bundle` |
| `creation/typescript/web/flappy{,-debug}.html` | `node creation/typescript/make-flappy.mjs` |

`creation/typescript/web/flappy.rc` **is** checked in — 4 KB, and it cannot be rebuilt on
a desktop. The creation DSL needs a real Android runtime (`RcPlatformProfiles` lives in
`androidMain` and depends on `AndroidxRcPlatformServices`), so that document was built on
a device by `DslDumpActivity` and pulled off.
