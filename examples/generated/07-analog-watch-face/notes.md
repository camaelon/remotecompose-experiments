# Eval 07 run 1 — "An analog clock watch face with a date window and a second hand."

Result: `face.json` (inline `WatchFace` component, 2116 B as .rc), `face.rc`, `page.html` (local playground, 552 KB).
15 CLI invocations: 1 `list`, 1 `describe`, 13 `call`s. No failed calls, no retries of the document.

## 1. Every call, in order

| # | call | what I learned / decided |
|---|------|--------------------------|
| 0 | `list remotecompose` | Six servers exposed; the `remotecompose` one has the whole workflow (build_kit → check_component → convert/render/audit → publish). Decided to stay on that server only. |
| 1 | `build_kit {goal}` | Resolved to use case `watch-face`, components `AnalogClock` + `DateLabel`, examples TIM-02 (analog clock), TIM-01 (digital clock), TIM-12 (sunrise, as "layout model"). `needs_component` was empty and `not_covered` empty, although nothing in the kit puts a date *window on the dial*: AnalogClock has no date param or slot, DateLabel is a full-width text line. Decided to write an inline `WatchFace` component from AnalogClock's definition rather than compose the two. Took the clock formulas (`timeInMin() % 720 * 0.5`, `% 60 * 6`, `timeInSec() % 60 * 6`), the fit-to-box transform and the loop-rotate tick idiom. |
| 2 | `get {name: AnalogClock, definition: true}` | Full body: the `s = min(componentWidth(), componentHeight())` + translate + scale prologue, `$if theme.mono` ring instead of fill, no second hand in mono, minute hand without the seconds fraction in mono, the paint/strokeCap syntax. Copied the structure wholesale. |
| 3 | `get {name: DateLabel, definition: true}` | How to put a number on a canvas: a `variable` with `vtype: string`, `commit: true`, value `{type: textFromFloat, value: "dayOfMonth()", whole: 2, decimal: 0, flags: 4}` (flags 4 = no zero padding), then `paint {textSize}` + `drawTextAnchored {text, x, y, panX, panY}`. Decided on `flags: 4` so the window reads "5", not "05". |
| 4 | `reference {topic: components}` | The authoring guide: `$if` syntax (`then` may be an array), `static` params fold to literals, mono rules (ring not fill, no motion, thin strokes, theme colours only), `clamp` argument order, pattern-mode traps. Confirmed a canvas component with its own `variable` will always expand (fine, one call). |
| 5 | `reference {topic: format}` | `drawTextAnchored` pan semantics (panX 0 / panY 0 = centred on the point), paint is sticky, `drawRect` exists (I guessed its keys `left/top/right/bottom`; they worked). Learned `system_variables {"10": 0}` pins the UTC offset. |
| 6 | `check_component {definition, name, width, height}` | No lint errors or warnings; 2075 B auto, 1101 B mono; four renders (light, dark, mono, mono-inverted) all with `findings: none`. Looked at all four PNGs: dial, 60+12 ticks, window with "31", hands and red second hand all right; mono has a ring, no second hand, thinner hands. No change needed. |
| 7 | `describe remotecompose render` | Needed the exact names of the multi-render options: `variants: true` and `clocks: [...]`, `clock` accepts `"YYYY-MM-DDTHH:MM:SS"`. |
| 8 | `render {json_path, variants: true, clock: 10:10:30, output_path: out/v.png}` | Ten images: dark, light, mono, mono-inverted, narrow 230×320, wide 512×240, short 320×192, small 230×192, tiny 160×192, seven hours later. No findings text at all. The face scales to the shorter side and stays centred in every box; "seven hours later" showed 17:10:30 correctly. |
| 9 | `render {clocks: [10:10:30, 03-05 15:45:00, 12-25 00:00:00, 07-04 18:30:15], theme: light}` | Four captioned images. Hour hand at 10.17 h, 3.75 h, 0 h, 6.5 h; minute at 10, 45, 0, 30; second at 30, 0, 0, 15; dates 31, 5, 25, 4. All correct. |
| 10 | `audit {json_path, clock}` | 0 errors, 0 warnings, 0 info. Nothing to fix. |
| 11 | `convert {json_path, output_path: face.rc, check: true, render: false}` | ok, 2116 B, parses; 138 ops; the only host variables are the seven theme colours. |
| 12 | `inspect {task: runtime}` | Repaint verdict `scheduled`, every ~1002 ms driven by two `timeInSec` expressions (second hand + minute-hand fraction), the minute hand at 60 s; 337 ops/frame, 60 of them the minute-tick loop. Confirms the second hand ticks and nothing repaints continuously. |
| 13 | `publish {json_path, output_path: page.html, title, publish: false}` | Wrote `page.html` (552 300 B) locally, playground with controls, seven theme colours exposed. Nothing uploaded. |

## 2. Dead ends and wasted calls

None of the 13 calls failed or had to be repeated; the component passed check_component on the first try. What was wasted was *within* responses, not calls:

- `build_kit` (28 KB) spent ~40% of its payload on TIM-12 (sunrise/sunset, 16 KB, 565 ops) as the "layout model" and on four widget-resize design rules (collapsibleColumn, fitBox, verticalScroll, StateLayout). None of it applies to a single-canvas round watch face. TIM-01 (digital clock) was also irrelevant beyond the `% 60` reminder already given in the AnalogClock pitfalls.
- `describe render` (call 7) was only needed because the tool's one-line summary in `list` does not mention `variants` / `clocks` by name; it is listed in the parameter list but with no hint of what they take.
- `check_component` wrote each render twice to `out/` (`render-<ts>-*.png` and `check_component-<ts>-*.png`), 8 files for 4 pictures.
- I had to tile PNGs myself (PIL) to look at 10 variant renders without 10 Read calls; `variants` promised "one call" but returns ten separate files, no contact sheet, unlike `sweep` in check_component.

## 3. Wrong, misleading, noisy or missing

- **Missing: `needs_component` for the date window.** The kit resolved "date" to `DateLabel` and "analog clock" to `AnalogClock` and reported nothing unmatched, but there is no way to put the one inside the other (AnalogClock has no slot/date param, DateLabel is a layout-width text line). A date *window* at 3 o'clock is exactly the "library has no component for this" case the tool describes; the honest answer was "copy AnalogClock's definition and add the window", which I had to work out myself.
- **Misleading: `render ... output_path` with `variants` / `clocks`.** The schema says "With output_path, the files are `<stem>-dark.png`, `-light` …" and "`<stem>-<clock>.png`". The files were actually `out/render-<timestamp>-N.png`; `v.png` / `c.png` stems were ignored. I had to sort by index and map them to the captions by hand.
- **Missing: per-image findings in `variants`.** The schema says "Each render's findings follow its image"; nothing followed (presumably "findings: none" is dropped). A one-word "ok" per image would have told me the sanity checks ran at all.
- **Noisy: `build_kit.design`** is generic (icons, TextChoice, collapsibleColumn, fitBox) and not "rules for THIS goal" as advertised. For a watch face the relevant rules would be: round safe area, mono = no seconds, ring not fill, repaint cadence.
- **Noisy: TIM-12 as `layout_model`** for a watch face. The TIM-02 note already said "take the technique, not the structure" and the right structure here is one canvas in a box.
- **Mildly misleading: `convert … check: true` lists the seven theme colours as "Host-settable variables"**, which reads like the document exposes seven inputs. They are theme colours, not watch-face parameters.
- **Not documented anywhere I read: the keys of `drawRect`** (`left/top/right/bottom`) and `drawRoundRect`. I guessed drawRect and it worked; I did not dare drawRoundRect, so the date window has square corners.
- **check_component has no `clock`**, so its four renders are at wall-clock time and `sweep` cannot sweep the time. For a clock component the thing to sweep *is* the time; I had to fall back to `render clocks` after assembling the document.
- `publish`'s `publish: false` was accepted without comment; the result does not say whether anything was uploaded. (Per the task I passed `output_path` and nothing was uploaded, but the result should say so.)

## 4. What I would have liked

1. `build_kit` to detect the compositional gap: "AnalogClock has no date window → `needs_component`: copy its definition (get … definition: true) and draw the window before the hands". It should also name the authoring facts a canvas date needs (string variable + textFromFloat + drawTextAnchored), which were only discoverable by reading DateLabel's definition.
2. `check_component` to accept `clock` (and `clocks`) and to let `sweep` run over the clock for time-driven components; one contact sheet of 10:10:30 / 15:45 / 00:00 / 18:30 would have replaced two calls.
3. `render variants` to return one captioned contact sheet (as `sweep` does) and to honour `output_path` stems as documented; a "watch-round" variant (a circle mask or at least a square) would be more relevant to this goal than "wide 512×240".
4. A `drawing` section in `reference format`: every canvas draw op with its keys (drawRect, drawRoundRect, drawArc, drawOval, drawTextAnchored, textSize/typeface paint ops, strokeCap values).
5. A smaller, goal-specific `build_kit` for a watch face: the AnalogClock definition inline (it is 2 KB), TIM-02, and the mono rules for clocks; drop TIM-12 and the widget-resize rules when the goal has no text layout.
6. `audit`/`inspect summary` to say in one line "repaints every second because of the second hand; mono every minute", which I had to get from `inspect runtime`.

## 5. Assessment of the final watch face

- **Correctness.** Verified at four pinned times plus "seven hours later": hour hand = (minutes since midnight mod 720) × 0.5°, minute hand with a seconds fraction (sweeps 0.1°/s), second hand at (s mod 60) × 6°; the classic 10:10 V, 15:45, midnight and 18:30:15 all land on the right ticks. The date window reads `dayOfMonth()` unpadded (31, 5, 25, 4) and so changes at midnight on its own; the second hand ticks once a second (runtime verdict: scheduled every ~1002 ms, nothing continuous). The second hand has a counterweight tail and the hands are drawn over the window, as on a real watch, so the hour hand covers the date at ~3:00 for a few minutes.
- **Round watch and sizes.** Everything is drawn in a 200-unit box, fitted with one translate+scale to `min(componentWidth(), componentHeight())`, so the face is a circle inscribed in any box and centred; the outer bezel ring is at radius 0.5 so a round display crops nothing that matters. Verified at 320², 230×320, 512×240, 320×192, 230×192 and 160×192; the digits in the window are still legible at 160 px. Weakness: the window is square-cornered (no drawRoundRect documentation) and the digit size does not follow the system font scale (it is canvas text).
- **Light / dark.** All colours are theme colours (surface, onSurface, outline, muted, surfaceHigh, error): white dial with near-black hands in light, dark slate dial with white hands in dark, red second hand in both; audit reports no hard-coded colours.
- **Mono (always-on).** The `$if theme.mono` branches draw a 2 dp outline ring instead of the filled dial, thinner hands, no second hand and no seconds fraction on the minute hand (repaint once a minute), the date window as an outline only, a white centre cap; mono-inverted comes free from the palette swap. Verified in both check_component and render variants. Mono is 1101 B vs 2116 B themed.
- **Caveats.** No hour numerals (ticks only); no tap interactions (none asked); the component only ever expands (its own `variable` keeps it out of pattern mode), which is fine for one call.
