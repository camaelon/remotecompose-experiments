# avd2rc — Android animated vector drawables → RemoteCompose JSON

`avd2rc.py` converts `<animated-vector>` drawables (and plain `<vector>`s, and the AVD transitions
of `<animated-selector>`s) into **RemoteCompose JSON**, the format `json2rc` and androidx's Java
`RemoteComposeJsonParser` read. Python 3 standard library only. Every document it writes for the
corpus converts to **byte-identical** `.rc` with json2rc and with the Java parser.

```sh
python3 avd/avd2rc.py in.xml -o out.json                     # JSON
python3 avd/avd2rc.py in.xml -o out.json --rc out.rc         # ... and .rc through json2rc
python3 avd/avd2rc.py some/res/dir -o out/ --rc out/         # every AVD / selector in a tree
python3 avd/avd2rc.py in.xml --loop                          # loop the whole animation
python3 avd/avd2rc.py in.xml --trigger play                  # replay on click / when a host sets `play`
python3 avd/avd2rc.py --list-gaps
```

| option | effect |
| :--- | :--- |
| `-o OUT` | the JSON file (one input) or a directory (default: next to the input) |
| `--rc OUT` | also write `.rc` via json2rc (`players/typescript/build-json2rc`) |
| `--res-root DIR` | the source tree `@drawable/`, `@anim/`, ... resolve in (default: the nearest ancestor with a LICENSE / NOTICE / .git) |
| `--values FILE.xml` | a `res/values` file supplying `@string/`, `@integer/`, `@dimen/` values (repeatable) |
| `--once` (default) / `--loop` | play once from the document start and hold the end / loop the whole animation |
| `--trigger VAR` | the clock starts at the value of variable `VAR` (a named, exported variable, -1000 = already played); a click on the canvas sets it to `animationTime()`, so the animation replays — a host can set it too (state transitions such as a checkbox) |
| `--size W H` | header size (default: the vector's width / height in dp) |
| `--max-tokens N` | longest expression (32, Android's FloatExpression limit; longer ones are split into variables) |
| `--no-theme` | theme colours as plain (dark) colours instead of themed resources |
| `--profile mainline` | the only profile: everything is Java-checked (no json2rc-only features are needed so far) |
| `--vectors` | in directory mode, convert plain `<vector>` files too |
| `--tint COLOR` | one colour for every paint, replacing the vector's `android:tint` (applied as src_in, so alphas are kept): a theme colour name (`onSurface`, `primary`, ...) or `#AARRGGBB`. Icons use it to become single-colour and themable |
| `--strip-degenerate` | filled-only paths: drop segments that do not move, the line back to the start before a close, and contours left without area (icon exports end each path with a zero-size contour) |
| `--pretty`, `-v` | indented JSON; print warnings |

## Code layout

`avd2rc.py` is a thin entry point over the `avdrc` package:

| module | contents |
| :--- | :--- |
| `xmlutil` | namespaced attributes, `aapt:attr` inline resources, `ConvertError` |
| `resources`, `values` | reference resolution in a source tree (same res dir first, then the nearest one, `-vNN` qualifiers preferred, `@android:` from the corpus' `core/res` or built in), framework values and Material 3 motion tokens |
| `colors` | `#RGB`…`#AARRGGBB`, `@color/` (colour state lists: the default item), theme attributes → library theme colours |
| `pathdata` | Android's PathParser grammar (nodes, as `pathType` morphs them), absolute moveTo / lineTo / quadTo / cubicTo / close ops, arcs → cubics (aligned across morph keyframes), even-odd → non-zero re-orientation |
| `interpolators` | framework interpolators, the XML interpolator tags, `pathInterpolator` (control points or path, with Android's validity checks) |
| `animators` | `<set>` / `<objectAnimator>` / `<propertyValuesHolder>` / `<keyframe>` parsing (AnimatorInflater's keyframe completion), `schedule()` into absolute start times |
| `vector` | the `<vector>` tree: groups, paths, clip-paths, gradients |
| `avd` | inputs: animated-vector (file or inline drawable / animations), vector, animated-selector transitions |
| `expr` | expression AST with folding, infix for the JSON, RPN size, a pool of shared named variables split to the 32-token limit, a Python evaluator |
| `emit` | the document |
| `convert` | `convert_file`, the CLI |
| `gaps` | what is not converted |

Around it: `oracle.py` (the reference renderer), `validate.py` (the corpus run), `run_tests.py` +
`tests/` (the regression suite), `tsrender.mjs` (batch rendering with the TypeScript player),
`convert_corpus.py` (regenerates `assets/avds/converted/` and its galleries), `convert_icons.py`
(converts the Material Symbols set into `assets/icons/converted/`, with its catalog and gallery;
the gallery page template is `icons_gallery.html`).

### Icons (`convert_icons.py`)

`python3 avd/convert_icons.py` converts the 24,942 Material Symbols drawables
(`assets/icons/source/material-symbols/`, see `assets/icons/SOURCES.md`) with `--tint onSurface
--strip-degenerate` on every core, then json2rc in parallel node processes (~10 s from scratch,
~4 s when nothing changed: a file is redone when its JSON is older than its XML, or everything
when the converter's sources or options change, `material-symbols/.stamp`). It writes
`material-symbols/catalog.json` (one entry per icon: styles, fills, categories, tags,
popularity, `autoMirrored`, and per variant the file stem and `.rc` size) and the gallery
(`index.html`, `gallery/index.js` and the documents as base64 in 256-icon chunks per
style / fill, loaded on demand). Every drawable has `android:tint="?attr/colorControlNormal"`
over `@android:color/white` fills, so each document is one path filled with `@colors.onSurface`.
`autoMirrored` (1,542 files) is not converted (no layout direction); the catalog flags it.

## How it maps

| AVD | RemoteCompose JSON |
| :--- | :--- |
| `<vector>` width / height, viewport | header width / height (dp); a `canvas` with `fillMaxSize` whose commands start with `scale(componentWidth() / viewportWidth, componentHeight() / viewportHeight)`, so the drawable stretches to its component like a Drawable to its bounds |
| `<group>` rotation, pivot, scale, translate | `save` [ `translate(tx, ty)`, `rotate(angle, pivot)`, `scale(sx, sy, pivot)` ] — VectorDrawable's matrix `T(t + p) R S T(-p)`; values are numbers or expressions |
| `<path>` pathData | `resources.paths` in the **op-list form** (`[{"type": "moveTo", ...}, {"type": "cubicTo", ...}, {"type": "close"}]`), drawn with `drawPath: "$paths.pN"`. Never an SVG string: Java writes an empty path for one in `resources.paths` |
| fill / stroke colour, fillAlpha / strokeAlpha, vector alpha | `paint` deltas (only what changed since the last paint): colour (literal with alpha folded in, or `@colors.<theme>` plus an `alpha`), style, strokeWidth, cap, join; a gradient clears with `"shader": 0` before the next solid paint |
| gradients (`aapt:attr` `<gradient>`) | paint `ops` form: `linearGradient` / `radialGradient` / `sweepGradient` with stops and tile mode, in path coordinates |
| `fillType="evenOdd"` | the JSON has no fill type: contours nested at odd depth are reversed so a non-zero fill gives the even-odd result |
| `<clip-path>` | `clipPath` inside the group's `save` (applies to the rest of the group, as in VectorDrawable) |
| `android:tint` | applied to every paint colour (src_in: the tint's colour, the paint's alpha × the tint's; exact for any overlap) |
| trimPathStart / End / Offset | `drawTweenPath(p, p, 0, start, stop)`; an offset makes the windows `fract(start + offset)` … with the wrap drawn as a second window `[0, end]`, and the untrimmed case (start 0, end 1) kept whole, as VectorDrawable does |
| `pathType` morph | the keyframe paths normalised to identical op structures (H/V → lines, S/T → reflected controls, arcs → the same number of cubics in every keyframe); one transition → `drawTweenPath(a, b, w)`, several → a chain of `pathTween`s, the last drawn / clipped |
| `propertyXName` / `propertyYName` + `pathData` | the path sampled by arc length into Android's own point count (`min(100, length / precision + 1)`, precision half a device pixel at 420 dpi), read with `lerp(arrayGet(...), arrayGet(...), frac)` — the same piecewise-linear keyframes AnimatorInflater makes |
| colour animation | two layers per transition: colour A at alpha `α(1 − w) / (1 − α w)` then colour B at `α w` composite to exactly `α · lerp(A, B, w)`; `w` is warped by a table so the sRGB mix approaches Android's linear-light interpolation |
| theme attributes (`?attr/colorControlNormal`, `?android:attr/colorControlActivated`, `?attr/colorPrimary`, `?attr/colorOnSurface`, ...) | the component library's themed colours (`examples/components/theme/default.json`) in `resources.colors` as `{"light", "dark"}`: colorControlNormal / colorOnSurfaceVariant → muted, colorControlActivated / colorAccent / colorPrimary → primary, colorOnSurface → onSurface, colorSurface → surface, ...; unknown → onSurface with a warning |
| `<animated-selector>` | one document per `<transition>` whose drawable is an AVD |

### Time

Every animated value is a closed-form float expression of the clock `t` (`animationTime()`,
`animationTime() % total` with `--loop`, `animationTime() - @VAR` with `--trigger`):

- **Animator fraction**: `f = clamp((t − start) / duration, 0, 1)`; with repeats
  `p = clamp((t − start) / duration, 0, n + 1)` and `f = (p − ceil(p) + 1) · step(p, 0)` (restart) or
  `ping_pong(p, 1)` (reverse); infinite repeats `fract(max(...))` / `ping_pong(max(...), 1)`. Start
  times come from flattening the `<set>` tree (together / sequentially, startOffset, repeats).
- **Interpolator**: closed forms for linear, accelerate / decelerate (any factor),
  accelerate-decelerate, anticipate, overshoot, cycle; everything else (path interpolators,
  bounce, anticipate-overshoot, Material easing) is a table of 9–129 samples read with
  `spline(@table, f)` (RemoteCompose's monotone spline), sized to stay within 0.002 of the curve.
  The default interpolator is accelerate-decelerate, as ValueAnimator's.
- **Keyframes** (and plain from/to): a chain of states Q0..Qn with a weight per interval,
  `w_i = J_i((e − φ_i−1) / (φ_i − φ_i−1))` clamped to the interval (the first interval may extrapolate
  below, the last above — overshoot); a scalar is `Q0 + Σ (Q_i − Q_i−1) · w_i`, so no interval search is
  needed. A jump between consecutive animators (a `valueFrom` different from where the previous one
  ended, or a delayed animator whose start differs from the drawable's value) is a `step` at its
  start; an animator that is still running when a later one on the same property starts is cut
  off there (the most recently started animator drives the property, as on Android). Keyframes
  without a value take the property's value when the animator starts.
- Shared pieces (each animator's fraction and eased fraction) are named variables; every
  expression stays within Android's 32-token limit (longer ones are split into variables).

## Validation

`validate.py` converts the corpus (`assets/avds/source/{aosp,material-components,androidx}`), runs
json2rc and the Java parser on every JSON (bytes must match), renders each document with both
players at 0, 25, 50, 75 and 100 % of its animation (one period of the infinite ones), and scores each
frame against an **independent reference**: `oracle.py` evaluates the drawable at that time the
way Android does — its own animator timing (ValueAnimator / AnimatorSet, "most recently started
wins"), its own interpolators (PathInterpolator as a polyline lookup), KeyframeSet evaluation,
hwui's linear-light colour evaluator, PathParser node interpolation for morphs, VectorDrawable's
first-contour trim, isotropic stroke scaling, layer alpha and an SVG filter for the tint — writes
an SVG and rasterises it with `rsvg-convert`. Only XML parsing is shared with the converter.
Score: SSIM of the two images composited on grey; a frame passes above 0.95. Failing frames are
written side by side (player | oracle | difference) to `work/diff/<player>/`.

```sh
python3 -m venv $S/venv && $S/venv/bin/pip install pillow numpy      # once (pip --user is blocked)
$S/venv/bin/python avd/validate.py --work $S/avd/val                  # ~40 s; --selectors adds selector transitions
$S/venv/bin/python avd/run_tests.py                                   # the regression suite (--update after an intended change)
python3 avd/convert_corpus.py                                         # regenerate assets/avds/converted/
```

The TypeScript player is the primary renderer; `tsrender.mjs --android-trim` trims paths in the
harness, because the TS player ignores DRAW_TWEEN_PATH's start / stop (docs/EXAMPLES_FINDINGS.md T34).
The C++ player interpolates morphs the wrong way round mid-flight (C52), which is why its column is
lower: every frame it fails is a morph frame.

Results on 2026-10-30 (animated-vector files; XML counts the AVD and every file it references):

| source | files | converted | Java-identical | frames pass (TS) | frames pass (C++) | XML B (deflated) | JSON B (deflated) | .rc B (deflated) |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| aosp | 112 | 110 | 110 | 549/550 (99.8 %) | 454/550 | 1,105,939 (160,652) | 622,877 (145,882) | 294,280 (112,652) |
| material-components | 24 | 6 | 6 | 30/30 (100 %) | 30/30 | 44,587 (8,124) | 20,029 (5,799) | 10,213 (4,547) |
| androidx | 88 | 82 | 82 | 385/390 (98.7 %) | 355/390 | 459,600 (90,736) | 275,411 (85,491) | 130,804 (64,281) |
| **total** | 224 | 198 | **198** | **964/970 (99.4 %)** | 839/970 | 1,610,126 (259,512) | 918,317 (237,172) | 435,297 (181,480) |

With `--selectors` (41 animated-selectors, one document per AVD transition) the run has 289 inputs,
252 documents, all Java-identical, TS 1234/1240 frames.

The `.rc` is 27 % of the XML it replaces (70 % deflated against deflated); the JSON 57 % (91 %).

Not converted (26): 2 AOSP files use the private framework interpolator
`@*android:interpolator/transient_interpolator`, which is not in the corpus; 18 Material files need
`@string/` path data or `@dimen/` sizes from `values/` files the corpus does not contain (checkbox,
switch thumb, password eye); 6 androidx files are *meant* to fail — vectordrawable's exception tests
(invalid path interpolators, incompatible morphs), where Android throws too.

Remaining frame misses (TS): colour transitions between distant hues (`target_duplicated`, red →
blue, and `avd_complex`, red → cyan: the two-layer mix stays darker mid-way than linear-light
interpolation), and anti-aliasing seams of the two layers on a low-contrast black → white fade
(`qs_extra_dim_icon_off`).

## Not converted

The list lives in `avdrc/gaps.py` (`avd2rc.py --list-gaps`):

- **paint** — `fillType="evenOdd"`: contours are re-oriented so a non-zero fill matches (exact unless contours cross); `strokeMiterLimit` other than 4: player default; tint modes other than src_in / src_atop / multiply: src_in; non-uniform scale on strokes: the stroke scales with the canvas (VectorDrawable uses one isotropic factor); the vector's alpha is applied per paint, not as one layer.
- **colour** — colour animation is a two-layer mix approaching linear-light interpolation (distant hues stay darker mid-way); animated gradients are drawn static; theme attributes and `@color/`s the corpus lacks map to the nearest library colour (unknown: onSurface).
- **path** — morphs between arcs interpolate the cubics, not the arc parameters.
- **animation** — reverse repeats with an odd count followed by another animator on the same property; overshoot in the middle intervals of multi-keyframe animators is clamped; animators on properties a node lacks (group alpha) are ignored, as on Android.
- **selector** — the state machine of `<animated-selector>`: each transition is its own document.
- **resources** — values not in the corpus: the file is reported unconverted (`--values FILE.xml` supplies them).
- **drawable** — `autoMirrored` (no layout direction).

## Findings recorded in docs/EXAMPLES_FINDINGS.md

- **C52** (C++ player): DRAW_TWEEN_PATH / PATH_TWEEN interpolate with the weights swapped.
- **T34** (TS player): DRAW_TWEEN_PATH's trim start / stop are ignored.
- **J40** (json2rc): `wakeIn` converts at apiLevel 7 where Java refuses it — avd2rc does not use it.
- **J41**, **J42** (json2rc): `variable` with `vtype: floatArrays`, and an exported float `variable`, are refused where Java accepts them — avd2rc uses `resources.floatArrays` / `resources.variables` instead.
