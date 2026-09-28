# lottie2rc — Lottie → RemoteCompose

`lottie2rc.py` converts Lottie (bodymovin) JSON animations into RemoteCompose `.rc`
documents. Standard library only; it writes the binary directly.

```sh
python3 lottie2rc.py examples/Science.json            # -> examples/Science.rc
python3 lottie2rc.py examples/*.json -d out/           # several files into a directory
python3 lottie2rc.py in.json -o out.rc -v              # op counts + warnings
```

| option | effect |
| :--- | :--- |
| `--fps N` | sampling rate (default: the Lottie frame rate) |
| `--no-loop` | hold the last frame instead of looping |
| `--no-fit` | do not scale the composition to the player window |
| `--no-interp` | hold sampled values rather than interpolating between samples |
| `--profile mainline` / `--profile rcx` | option preset. `mainline` (default) is read by every RemoteCompose player; `rcx` turns on the experimental encodings and operations of the players in this repository (`--compact-delta --keyframe-op --blur-op --focal-op --quantize 0.0625 --rcz`). Individual flags add to the preset |
| `--sampled` | one float per frame per animated value instead of keyframe expressions |
| `--bezier-op` | EXPERIMENTAL: ease with the `BEZIER_EASE_X` expression operator (rcX players only) instead of 17-float `A_SPLINE` tables |
| `--keyframe-op` | EXPERIMENTAL: one `KEYFRAMES_X` expression per property (rcX players only) instead of per-segment arithmetic and spatial-path tables |
| `--quantize Q` | EXPERIMENTAL: store keyframe lists and sampled tables as 16-bit integers on a grid of Q units (`FLOAT_LIST_COMPACT_X`, players in this repository only): Q in px / degrees / percent, Q/256 for colours and other unit values, keyframe times exact for whole frames, never coarser than the list's range needs, and only where it is smaller |
| `--blur-op` | EXPERIMENTAL: soften drop shadows and apply Gaussian-blur effects through the `BLUR_X` paint attribute (rcX players only); without it a shadow is hard and a blur effect is skipped |
| `--max-tokens N` | longest expression to emit (default 32, the Android evaluator's limit; 0 = unlimited); longer RPN is split into a chain of expressions |
| `--bg #RRGGBB` | paint a background first (Lottie compositions are transparent) |
| `--compact-paths` | EXPERIMENTAL: paths as `PATH_DATA_COMPACT_X` (byte verbs, int16 fixed point at `--quantum`, default 1/16 px) |
| `--compact-delta` | EXPERIMENTAL: the delta form of that op — int8 point-to-point differences, `0x80` escaping to int16; implies `--compact-paths` |
| `--rcz` | EXPERIMENTAL: wrap the document in the `RCZ1` zlib container |

Play the result with any player in this repository:

```sh
../players/cpp/build/tools/rc2image/rc2image examples/Science.rc out.png 512 512 --anim 1.0
../players/cpp/build/apps/viewer/rcviewer examples/Science.rc
cd ../players/typescript && node render.mjs ../../lottie/examples/Science.rc out.png
```

## How it maps

RemoteCompose has no keyframes, so each animated value becomes one `FloatExpression` of the
composition frame. One expression derives that frame from the player's animation clock:

```
f = mod(animationTime * fps, frameCount)
```

A keyframed property is written as its first value plus, per segment, the segment's delta
times its eased progress, `clamp((f - t0) / (t1 - t0), 0, 1)` pushed through a 17-entry table
of the cubic-bezier easing via `A_SPLINE` (a hold is a `STEP`, a linear segment needs no table).
Segments already passed contribute their whole delta and later ones nothing, so no segment
search is needed; the raw progress of each `(t0, t1)` pair is one shared sub-expression, so a
wing whose rotation and scale both flap on 49 keyframes costs little. Android evaluates at
most 32 tokens per expression, so anything longer is cut wherever the partial sum is a
complete value and the remainder references that piece by id (`--max-tokens`). Spatial position
keyframes use a 17-entry table of the arc-length-parametrised path per axis (with
`--keyframe-op` the player walks the path itself). Trim windows are the same arithmetic on the keyframed start / end / offset (`fract`,
`min`, `max`, `clamp`), including the wrap into a second segment and the per-path share of an
"individually" trim. Auto-orient is a finite difference of the position expression a
hundredth of a frame either side (`ATAN2`) when `--keyframe-op` evaluates the exact motion
path; in the default mode the position is a 17-point spline fit, too coarse to differentiate,
so the angle is sampled per frame into a `FLOAT_LIST` there. `--sampled` forces sampling for
everything (the first version's mechanism).

| Lottie | RemoteCompose |
| :--- | :--- |
| bezier shape, rectangle, ellipse, polystar | `PATH_DATA` (cubics only) |
| shape morphing (`ks` keyframes) | one path per keyframe, `DRAW_TWEEN_PATH` per segment inside `CONDITIONAL_OPERATIONS` |
| trim paths | `DRAW_TWEEN_PATH` start/stop (wrapping trims emit a second draw) |
| layer / group transform, parenting | `MATRIX_TRANSLATE / ROTATE / SKEW / SCALE` inside `MATRIX_SAVE/RESTORE` |
| layer in/out points | sampled visibility flag + `CONDITIONAL_OPERATIONS` |
| fill, stroke, dashes, opacity | `PAINT_VALUES` (colour, alpha, style, width, cap, join, path effect) |
| gradient fill / stroke | `PAINT_VALUES` linear / radial gradient |
| precomps, time offset, stretch, time remap | recursion with remapped sample times |
| alpha matte / inverted alpha matte, layer masks | `CLIP_PATH`, baked statically (inverted / subtract: even-odd path with a huge rectangle) |
| animated colours, gradient stops | `ColorExpression` (ARGB mode) fed by sampled channel tracks, referenced by colour id |
| image layers | embedded PNG as `BITMAP_DATA` + `DRAW_BITMAP` |
| blend modes, auto-orient, round corners, pucker/bloat, zig-zag | paint blend mode; rotation track; vertices rewritten before encoding |
| offset path | the paint does it: an outward offset of a fill is the same path drawn fill-and-stroke with a stroke twice the amount wide and the modifier's join; an open path's offset is that stroke alone, with round caps for a round join. Inward offsets and offsets under a stroke are drawn unoffset with a warning |
| text layers | every character is a glyph path (from the document's `chars` when bodymovin exported glyphs, else from an installed font through fontTools, matched by PostScript name or family and style, Helvetica / Arial as fallbacks) under its own matrix; lines, justification, tracking, line height and baseline shift follow lottie-web's layout; text animators (position, anchor, scale, rotation, opacity, fill colour, tracking) become per-character expressions with the range selector's start / end / offset, all six shapes, units in percent or index, based on characters / words / lines, and word or line anchor grouping; several text documents switch under time conditionals |
| layer effects: fill, tint, drop shadow, Gaussian blur | fill is a `SRC_ATOP` colour filter on every paint of the layer (the fill colour at the effect's opacity, an exact blend); tint rewrites solid paint colours (`black + (white - black) · luma`, by amount); a drop shadow draws the layer twice, first offset with a `SRC_IN` colour filter in the shadow colour (and `BLUR_X` for softness with `--blur-op`); blur needs `--blur-op`. Other effects warn |
| masks | clips in layer space: keyframed mask paths tween every frame (`PATH_TWEEN`), several add masks are one compound path or a `PATH_COMBINE` union, inverted masks subtract from a huge rectangle, intersect and subtract clip one by one |
| mattes | the matte's transform chain as matrix ops, its shapes as path tracks (static group transforms folded into the points), a clip, then the inverse matrix ops — so an animated matte transform or a morphing matte shape costs nothing; precomp mattes and animated group transforms still bake at the first visible frame |
| merge paths | `PATH_COMBINE` per input, folded from the topmost shape down (add = union, subtract = difference, intersect, exclude = xor; skottie's order); a morphing input goes through `PATH_TWEEN` first. Mode 1 (merge) just draws the shapes together |
| radial gradient highlight | with `--focal-op` (in the `rcx` profile): EXPERIMENTAL gradient type 3 (`FOCAL_RADIAL_GRADIENT_X`, players in this repository): the focal point sits at start + highlight length × radius along the end-point angle plus the highlight angle, as lottie-web places it; radials without a highlight are unchanged |
| repeaters | one `LoopOperation` per repeater: the loop index drives the copy's translate / rotate / scale and opacity through expressions (`--sampled` unrolls the copies instead) |
| composition size vs. window | `LAYOUT_ROOT` > full-size `LAYOUT_CANVAS`, a fit transform driven by the canvas' `COMPONENT_VALUE` size, and a `CLIP_RECT` to the composition bounds |

## Not converted (a warning is printed)

The list lives in `lottierc/gaps.py` (`lottie2rc.py --list-gaps` prints it); each item names
what the output shows instead.

- **text**: text on a path (drawn on a straight baseline); box text wrapping (the box position is applied, lines are not wrapped); selector ease high / low and smoothness (ignored); animator skew and per-character stroke colour / width (ignored); a font that is not installed (the family's regular face, then Helvetica, then Arial)
- **effects**: effects other than Fill, Tint, Drop Shadow and Gaussian Blur (not applied); tint over a gradient fill (the gradient is drawn untinted); an animated drop-shadow direction or distance (the first keyframe is used); drop-shadow softness without --blur-op (a hard shadow); Gaussian blur without --blur-op (not applied)
- **gradients**: a radial gradient highlight without --focal-op (drawn concentric)
- **shapes**: inward offset paths (drawn unoffset (the band would have to exist as a path)); an offset path under a stroke style (the stroke is drawn unoffset); twist (not applied); merge paths over a nested group (the group's shapes are not folded into the merge); a morphing shape whose keyframes have different vertex counts (the first keyframe is drawn); an "individually" trim over a morphing shape (the first keyframe's length sets the shares)
- **strokes**: animated dashes (the first keyframe is used)
- **masks**: mask expansion (ignored); mask opacity and feather (treated as 100 %, not feathered); lighten / darken / difference mask modes (treated as add); inverted and non-inverted add masks on one layer (all treated like the first)
- **mattes**: luma mattes (treated as alpha mattes); a precomp matte, or a matte group whose transform animates (baked at the first visible frame)
- **layers**: audio, camera and other non-drawing layer types (skipped); blend modes RemoteCompose has no equivalent for (normal blending); expressions (`x` fields) (ignored; bodymovin bakes most of them); a repeater with an animated count in --sampled mode (the count is fixed at its maximum)
- **assets**: image formats other than PNG (passed through for the player to decode)

## Code layout

`lottie2rc.py` is the entry point; the code is the `lottierc` package:

| module | contents |
| :--- | :--- |
| `wire` | opcodes, paint-bundle constants, float / NaN-id encoding, the op writer (`RcWriter`) |
| `props` | keyframe evaluation (`Prop`), easing, bezier motion paths, `Transform`, 2-D matrices |
| `shapes` | parametric shapes, modifiers (round corners, pucker, zig-zag), path encoding, gradient stops, the Lottie item-type sets |
| `tracks` | `Clock`, `Track` (a value as a Python function and an RPN expression), `Sampler` (tracks to bytes: keyframe expressions, key lists, splitting) |
| `profile` | `Profile`: every option, with the `mainline` and `rcx` presets |
| `paints` | `PaintMixin`: colour and gradient bundles, layer effects, offset-path paints, `PaintState` |
| `paths` | `PathMixin`: shapes and modifiers as path tracks, morph tweens, trims, `PATH_COMBINE` folds |
| `mattes` | `MaskMatteMixin`: masks and mattes as clips, the baked fallbacks |
| `text` | glyph sources (`chars`, fontTools), `TextMixin`: layout, per-character animators, drawing |
| `groups` | `GroupMixin`: shape groups (`_Group`), merge paths, repeaters as loops |
| `convert` | `Converter` (the layer walk), `convert_document`, the CLI |
| `gaps` | what is not converted |

Behaviour is pinned by `run_tests.py` (below) and `validate.py`; the refactor that produced
this layout kept every sample and test byte-identical.

## Size

A dotLottie is deflate-compressed JSON, so compare like with like. Bytes for the three examples:

| file | JSON | deflated JSON (≈ dotLottie) | `--sampled` | `.rc` (keyframes) | `--compact-paths` | `--rcz` | both |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Bird pair | 186,896 | 29,045 | 43,521 | 44,877 | 27,565 | 20,922 | 11,831 |
| Employee content | 123,592 | 14,733 | 58,433 | 41,638 | 26,540 | 17,084 | 10,674 |
| Science | 39,822 | 2,369 | 40,018 | 22,347 | 20,850 | 4,141 | 4,022 |

The 19 sample animations that ship with lottie-ios (`./fetch-samples.sh` downloads them) are
a more typical mix — logos drawn with trim paths, icon transitions, loaders — and give a
broader size picture (bytes; "both" = `--compact-paths --rcz`):

| file | JSON | deflated JSON | `.rc` | both |
| :--- | ---: | ---: | ---: | ---: |
| 9squares_AlBoardman | 62,308 | 2,692 | 19,040 | 4,506 |
| Boat_Loader | 106,477 | 6,780 | 74,639 | 18,912 |
| HamburgerArrow | 6,209 | 957 | 2,684 | 1,238 |
| IconTransitions | 71,306 | 6,795 | 35,961 | 7,905 |
| LottieLogo1 | 56,651 | 4,455 | 31,566 | 7,389 |
| LottieLogo1_masked | 63,540 | 4,745 | 31,939 | 7,671 |
| LottieLogo2 | 88,590 | 7,608 | 55,171 | 14,333 |
| MotionCorpse_Jrcanest | 38,034 | 4,496 | 26,845 | 8,416 |
| PinJump | 36,815 | 2,910 | 9,710 | 3,050 |
| Switch | 8,369 | 1,501 | 5,246 | 2,211 |
| Switch_States | 16,503 | 1,362 | 4,116 | 1,139 |
| TwitterHeart | 27,151 | 1,554 | 7,190 | 1,943 |
| TwitterHeartButton | 36,039 | 2,258 | 7,550 | 2,056 |
| Watermelon | 27,246 | 4,708 | 21,439 | 5,104 |
| setValueTest | 3,013 | 786 | 1,804 | 840 |
| success | 15,928 | 2,621 | 11,897 | 5,201 |
| timeremap | 3,146 | 759 | 2,268 | 674 |
| vcTransition1 | 15,279 | 1,518 | 5,604 | 1,715 |
| vcTransition2 | 2,940 | 626 | 1,672 | 758 |
| **total** | 685,544 | 59,131 | 356,341 | 95,061 |

All 19 convert and play in both players (LottieLogo1 and LottieLogo2 checked frame by frame
against lottie-web). Uncompressed, the default `.rc` is 6.0× the deflated JSON on this set and 1.6×
with the two size options; the remaining bytes are keyframe expressions (nine bytes of header
per expression plus four per token; a 45-layer file has 300–700 of them) and one path per
morph keyframe.

Path encodings over the same 22 files (19 samples plus the three examples), raw and deflated:

| paths as | path bytes | deflated | whole files deflated | ÷ deflated JSON |
| :--- | ---: | ---: | ---: | ---: |
| `PATH_DATA` (float32) | 119,175 | 52,716 | 147,947 | 1.41× |
| `--compact-paths` (int16) | 51,744 | 26,164 | 121,105 | 1.15× |
| `--compact-delta` (int8 deltas) | 42,896 | 21,160 | 115,831 | 1.10× |

Both compact forms render pixel-identically to the float32 paths in both players and keep the
corpus scores; the delta form loses on files with large jumps between points (9squares grows
by 56 bytes from escapes) and wins on dense outlines (Bird −14 %).

With the experimental `KEYFRAMES_X` operator (`--keyframe-op`, players in this repository
only), over the same 22 files:

| mode | raw | deflated | ÷ deflated JSON |
| :--- | ---: | ---: | ---: |
| default (per-segment arithmetic) | 437,664 | 147,639 | 1.40× |
| `--keyframe-op` | 318,727 | 104,359 | 0.99× |
| default + `--compact-delta --rcz` | 115,627 | | 1.10× |
| `--keyframe-op --compact-delta --rcz` | 72,391 | | 0.69× |
| `--keyframe-op --compact-delta --rcz --quantize 0.0625` | 70,347 | | 0.67× |

Renders differ from the default by a few edge pixels in both players (the operator walks the
exact easing and motion-path curves where the default reads 17-point tables) and the corpus
scores are unchanged. Spatial position paths ride in the same list (each key row carries the
segment's two tangents and the player evaluates the arc-length-parametrised cubic), so no
sample table is left: Bird's 42 spatial tables and Science's 40 are gone, and every animated
property is one list and one five-token expression per component. Auto-orient joins them in
this mode: Boat_Loader's seven auto-oriented fish were seven 889-entry angle tables, 25 KB
of its 45 KB raw; as expressions the file goes from 12,583 to 5,965 bytes with the container,
smaller than its deflated JSON.

With the experimental `BEZIER_EASE_X` operator (`--bezier-op`, players in this repository only):

| file | keyframes (tables) | `--bezier-op` | tables + compact + rcz | operator + compact + rcz |
| :--- | ---: | ---: | ---: | ---: |
| Bird pair | 44,877 | 44,409 | 11,831 | 11,337 |
| Employee content | 41,638 | 41,378 | 10,674 | 10,401 |
| Science | 22,347 | 22,295 | 4,022 | 3,969 |

With keyframe expressions the animation data is a few dozen bytes per property, and what
remains is the geometry: a cubic costs 36 bytes in `PATH_DATA` (`--compact-paths` brings that
to 13) and a morphing shape stores one path per keyframe. Science, mostly animation, drops
from 40 KB to 22 KB; Bird, mostly paths, moves little (its 42 spatial-position tables cost
about as much as the arrays they replace). Compact paths quantise to 1/16 px (renders differ
by a few edge pixels); the container is lossless. Both are read by the C++ player, the
TypeScript player, `rc2image`, `rc2json`, `frames.mjs` and `render.mjs`; the C++ player also
accepts the delta form of the compact op, which the converter does not emit because the
TypeScript player lacks it.

## Regression tests

`tests/` holds the synthetic files written while adding features the corpus does not cover —
repeaters, merge paths, effects, masks and mattes, text, the focal gradient — and
`run_tests.py` is their runner:

```
python3 run_tests.py                 # convert, render on both players, compare with tests/*/ref
python3 run_tests.py --update        # regenerate the references after an intended change
python3 run_tests.py --only text     # a subset; --player cpp|ts for one player
```

Every test is converted twice, with the experimental profile (`--keyframe-op --compact-delta
--blur-op --quantize 0.0625`) and with the default output. The C++ render of the experimental
profile is the checked-in reference; the TypeScript render and both default-profile renders
must stay within 5 % of the drawn pixels of it (anti-aliasing), the C++ experimental render
within 60 pixels. `tests/tests.json` lists the sample times and which tests need an
experimental op. `tests/text/placements.json` pins the per-character placements of the text
tests (glyph origin, rotation, scale, opacity at several frames), which were checked against
lottie-web's own layout on 2026-09-20; the converter must reproduce them to 0.05. Needs
Pillow and numpy (the validation venv works). 297 checks at the time of writing.

## Validation against lottie-test-files

`validate.py` converts the 80-file corpus in `~/Documents/GitHub/lottie-test-files` into
`test-files/data/` (same layout), renders every reference frame with the C++ and/or the
TypeScript player and scores the renders with the corpus' own `tools/report`. The method,
the findings and the remaining gaps are written up in `CONVERT.md`; the per-frame table is
`test-files/RESULTS.md`. Last run: C++ 137/143 frames pass, TypeScript 131/143.

## Player notes

- Repeaters use `LoopOperation` (215). Both players run it in paint mode and refresh the
  variable-driven children on every pass, which is what lets one body of ops draw every copy;
  `FUNCTION_DEFINE` / `FUNCTION_CALL` are only stubs in these players, so the converter
  does not use them. Expressions inside the loop body are written into the draw stream (as
  children of the loop) instead of the data section, so they are re-evaluated per copy.
- Merge paths need `PATH_COMBINE` (175) and, for morphing inputs, `PATH_TWEEN` (158). The C++
  player has both (Skia path ops); the TypeScript player used to parse both as stubs and now
  runs them, computing the boolean itself on flattened rings (`src/web/PathBoolean.ts`, a
  Martinez–Rueda sweep) with the result stored as an even-odd path. Checked against the C++
  player on the thirteen files in `tests/merge-paths/`: every mode, a stroke on the merged
  outline, an animated subtract, shared edges, nested holes, identical, tangent and disjoint
  inputs — within edge anti-aliasing on all of them.
- Trims, even-odd fill rules and dashes are honoured by both players. The TypeScript player
  measures the path over all its contours and splits the segments at the trim ends (the
  Skia player uses `SkPathMeasure`, which measures the first contour); its headless
  harness decodes `BITMAP_DATA` through node-canvas.
- `frames.mjs` in the TypeScript player used to stub `Path2D` with no-ops and drew no paths
  at all; it now records and replays them, so `node frames.mjs doc.rc out.png 0 1 2` works.
  `frames.mjs`, `render.mjs`, `rc2image` and `rc2json` all unwrap the RCZ1 container.
- The TypeScript player used to paint a conditional's children from inside its measure pass
  when the condition had just changed, which shifted everything drawn after a layer that
  switches on; fixed in `LayoutComponent.refreshDirtyOperations` (node and web bundles rebuilt).
- Verified by rendering the three examples at frames 0 / 30 / 60 in both players and
  comparing against lottie-web.
