# Air quality widget — eval run 22-run1

Request: "An air quality widget: AQI value with a coloured scale, the main pollutant, and a recommendation."

Deliverables in this folder: `widget.json` (the document, with the inline `AqiScale` component), `widget.rc` (9098 B),
`aqiscale.json` (the component on its own), `out/aqi-widget.html` (published playground), renders under `out/`.
Tool outputs saved as `kit.txt`, `ref-components.txt`, `ref-format.txt`, `exp07.txt`, `textchoice.txt`, `gauge.txt`,
`check1.txt`, `conv1..4.txt`, `rv1..3.txt`, `r1.txt`, `r2.txt`, `rv_*.txt`, `a11y.txt`, `audit1..2.txt`, `rm1..2.txt`, `pub.txt`.

Decisions made without asking: equal-width bands (each band a sixth of the bar) rather than a 0–500 proportional bar, so
Good/Moderate are not squeezed into the first 20%; the marker moves linearly inside each band. Sample data: AQI 55,
pollutant "PM2.5". Three layouts switched by the window size (compact row for heights under 120 dp, full column for
wide, a square column for 2x2). Recommendation sentences are my own short wording of the EPA guidance.

## 1. Tool calls in order (28 wrapper calls, 27 to the remotecompose server)

1. `list` — see the servers and tools. Took the 5-step workflow (build_kit → check_component → assemble → convert/render/audit → publish). Decided to follow it literally.
2. `build_kit` (goal verbatim) — resolved "aqi" and "coloured scale" to the **Gauge** component (a 240° dial), examples EXP-07 (an AQI card drawn on one canvas, with hard-coded colours), TIM-08 (a countdown, as "layout model") and TIM-13 (tides, 15 KB). `unmatched_terms`: main, pollutant, recommendation. **No `needs_component`** entry although nothing in the library is a six-band horizontal scale. Took: the design rules (TextChoice for a word from an index, theme colours, stateLayout from windowWidth/Height, render variants), EXP-07's marker expression idea. Decided to write an inline `AqiScale` component and ignore Gauge, TIM-08 and TIM-13.
3. `reference components` — the authoring guide. Took: params/locals/$if theme.mono syntax, "draw state by shape in mono", paint alpha 0/1 as the colour switch, canvas `variable` for componentWidth(), lints. Essential.
4. `reference format` — JSON essentials. Took: host string as a root-level `variable` command with `vtype: string, export: true`; numbers in `resources.variables` with `export`; widget sizes (4x2 320×160, 4x1 320×80, 2x2 160×160, hosts 250×110 up); textMerge/textFromFloat flags; fitBox and collapsibleColumn; stateLayout.
5. `get EXP-07 (json, meta)` — confirmed `step`/`clamp` marker maths and the `aqi` exported variable. Its band thresholds (50/100/150/200 only, four bands) and literal colours were not reusable.
6. `get TextChoice` — confirmed the call shape (`items`, `index`, fontSize, color, fontWeight, maxLines, overflow) and that the index is rounded and clamped. Used it for the category word and the recommendation.
7. `get Gauge (definition)` — copied the canvas `variable` + paint `{"alpha": expr}` pattern and the `$if theme.mono` branch structure.
8. `check_component AqiScale` with `sweep value [0,12,50,51,55,100,151,301,480,500]` — passed first time, no warnings; the contact sheet showed the marker exactly on the edges at 50/100 and just past at 51/151/301; mono showed the filled Moderate band and the dot marker. 1999 B, 1209 B per extra instance, always expanded (its canvas `variable`).
9. `convert check:true` (v1, fitBox full/compact) — ok but `fitbox_no_fit`: the column "needs 356x128" because a wrapping text's minimum is its unwrapped width. Image solid.
10. `render variants:true` (v1) — every variant blank for the same reason. Decided to drop fitBox for a stateLayout driven by `step(windowHeight(), 104)`.
11. `convert check` (v2, stateLayout 2 states) — clean, 6880 B, host variables listed.
12. `render variants` (v2) — all variants fine except "tiny 160×96" (zero-size weighted box, pollutant clipped) and, on looking, the square 2x2 was poor (header wrapped, "300500" labels collided, recommendation cut to 2 lines). Decided on a third, square state and a 120 dp threshold so a 250×110 4x2 host gets the compact row.
13. `convert check` (v3, 3 states) — clean, 9365 B.
14. `render variants` (v3) — all fine except the unsupported 160×96.
15. `render 250×110 light` — compact row, fine (recommendation one line, ellipsised).
16. `render 160×160 light aqi 151` — fine; the Unhealthy sentence ellipsised at 3 lines → shortened sentences 3 and 4.
17. `audit` (v3) — warning `dead_code` ×3: the component's `band` local only used in mono, computed in every look. Fixed with `$if theme.mono` on the local. Info: longest expression 26/32 entries.
18. `convert check` (v4, final) — clean, 9098 B.
19–23. `render` 4x2 at AQI 12, 50, 51, 301 (dark), 480 — all correct: Good/Good/Moderate/Hazardous/Hazardous, marker at 0.04, on the 50 edge, just past it, just past 300, near the end. No findings.
24. `inspect accessibility aqi 480` — has semantics, document description, every text is a node (pollutant, category "Hazardous", recommendation), the scale canvas labelled "Air quality scale". The number node reported "55" (see §3).
25. `audit` (v4) — 0 errors, 0 warnings, 1 info (26/32 entries).
26. `render 160×160 componentTheme mono aqi 480` — Hazardous band filled, black dot marker inside it, category word; reads without colour.
27. `render 320×80 componentTheme mono-inverted aqi 151 pollutant O3` — outlined bands, Unhealthy band black, ring marker; the host string shows "O3".
28. `publish` — `out/aqi-widget.html`, 636 KB page, rc 9098 B, variables aqi (float) and pollutant (string).

## 2. Dead ends and wasted calls

- **fitBox (calls 9–10, 2 calls + the rewrite).** The design rule and the format reference push fitBox for "adapt to the size" and say "fill and wrap count 0" for the minimum. In practice a wrapping text's minimum is its full one-line width, so a column holding a recommendation sentence "needs 356 dp" and nothing fits; the widget rendered blank in every variant. The same reference does say "a text's minimum is its own width", but the two statements sit in one paragraph and the first reads as the rule for a fillMaxWidth column. A one-line warning "fitBox cannot host wrapping sentences: use stateLayout or collapsibleColumn" would have saved the detour. The stateLayout route worked at the first try.
- **build_kit's examples (call 2).** TIM-08 as "layout model" (a countdown: three centred lines, nothing like this widget) and TIM-13 (15 KB of tide forecast) were noise; I read neither beyond the kit summary. EXP-07 is "the goal's subject" but is a canvas-only card with literal colours, i.e. an anti-pattern for the same design rules the kit lists. Gauge was matched on the synonym "coloured scale"/"aqi" although it is a dial. Of ~27 KB of kit output I used perhaps 2 KB (the design rules, the TextChoice/stateLayout pointers).
- **The audit's `dead_code` (call 17)** was my own doing (a local used only in one look), but the component checker (call 8) did not mention that the `band` local is unused in the light/dark expansion; it only checks "params never used". One extra convert+audit round.
- Not a dead end but near one: `list` is 29 KB and repeats the same tool descriptions across four servers (remotecompose, rc-examples, rc-render, rc-inspect); the task said use only `remotecompose`, so three quarters of it was irrelevant.

## 3. Wrong, misleading, noisy or missing in the tools' output

- **build_kit: no `needs_component`.** The workflow text says "when present, `needs_component`: the things in the goal the library has no component for". For "a coloured scale" it returned Gauge (a dial) with no hint that a horizontal band scale is missing, and `not_covered: []`. A new user following the kit would call Gauge with max 500 and get a three-zone dial, not six AQI bands. The matching is by synonym ("coloured scale", "aqi" are listed as Gauge synonyms), not by what the goal needs.
- **build_kit resolved "value" to `capability:data.array`** ("AQI value" is one number, not an array), which is how TIM-13 (data.array) got pulled in as the only example "contributing" a capability.
- **fitBox guidance contradicts itself**: the format reference says "A child fits when its MINIMUM size fits the box: an exact width or height, and what its content cannot shrink below (… a text's minimum is its own width; fill and wrap count 0)". The finding then said "LAYOUT_COLUMN#-7 needs 356x128" for a fillMaxWidth column whose only wide child was a wrapping text. "Wrap counts 0" is not true for a text that would wrap, and nothing says that a column inherits its texts' one-line widths. The `fitbox_no_fit` message itself was good (it named the child and the size it needs).
- **inspect accessibility reports the initial value for a textFromFloat, not the live one.** With `variables: {aqi: 480}` the category node read "Hazardous" (computed from @aqi) but the number node read "55" (the declared initial value). The render at 480 shows "480", so the inspector's text for a `textFromFloat` node ignores the host override. A screen-reader audit that reports the wrong number is misleading. The scale canvas also lists a `CanvasContent` node with `text: "0"` (the first tick label), which is noise.
- **check_component's "warnings: []" misses an unused local** (the `band` local, unused outside mono), which the audit later flagged as `dead_code`. The two tools disagree on what "unused" covers.
- **convert's findings when the fitBox failed said `solid` / `blank`** correctly, but `check: true` also printed ~60 lines of op counts and 185 font families, which drowns the two lines that matter.
- **render variants includes "tiny 160×96 (half the width)"** and reports overflow there, but the format reference says the smallest 4x1 host is 250×40 and the smallest 2x2 is 110×110; 160×96 is neither. The size list should match the widget sizes the reference describes (it does include 320×80 and 160×160, which is good), or label tiny as "not a widget size".
- **The theme palette has no data colours.** The design rule says "literal hex colours lock one look" and the audit flags `hardcoded_colors`; the six AQI colours are standard data colours and have to be literals. The audit did not flag them (they sit inside a component's non-mono branch), which is right, but nothing in the guide says "data colours: put them in the `else` of `$if theme.mono`" — I inferred it from Gauge. A sentence in the authoring guide's colour rule would help.
- **`list` prints the remotecompose server's workflow and then three other servers with duplicate tools** (`render_rc`, `audit`, `check_component` appear under two or three servers). As the task was limited to one server this was 20 KB of noise; nothing says the four servers overlap.
- Minor: the `reference format` output is one paragraph per topic with 300-character lines; the wrapper truncated the middle of it ("… [2994 characters truncated] …") in my terminal and I had to re-read the file. Not the tool's fault, but a `topic` with sub-topics (sizes, text, fitBox) would be easier to consume.
- Minor: `get Gauge` + `get TextChoice` return `renders: ["default","light",...]` names with no way to see them in the same call without `parts`, and `demo.how` is a prose instruction rather than a ready argument.

## 4. What I would have liked

- A `needs_component` entry for "a six-band scale with a marker", or at least `not_covered: ["horizontal band scale"]` instead of a confident Gauge match. Better: build_kit distinguishing "component whose synonyms match" from "component that does what the goal says".
- One tool call that renders the same document at several host-variable values (like `clocks: [...]` for dates): a `values: [{"aqi": 12}, {"aqi": 55}, …]` option on render, or a `sweep` on `inspect accessibility`. I spent 7 calls on single-value renders.
- A contact sheet of the variants (render variants writes 11 PNGs; one captioned sheet like check_component's sweep would be faster to look at).
- The accessibility report evaluating text values with the given `variables`, and a "what a screen reader would say, in order" line, so I can check the announcement sentence in one glance.
- The format reference's fitBox paragraph to say plainly: "a text that wraps still counts its one-line width; use stateLayout or collapsibleColumn when the alternatives contain sentences".
- A short "widget recipe" (three sizes, the stateLayout index expression, the thresholds) in build_kit's design rules for `use_case:widget`, since every widget needs it; the rule gives the expression for round-vs-wide but not for short-vs-tall.
- A note in the authoring guide about data colours (bands, categories) that must stay literal in light/dark but be replaced in mono.

## 5. Honest assessment of the final widget

- **Correctness.** Category and recommendation are computed in the document from `@aqi` (`band = step(@aqi,50)+…+step(@aqi,300)`, TextChoice index), so 50 → Good, 51 → Moderate, 100 → Moderate, 151 → Unhealthy, 301 → Hazardous, 480 → Hazardous. Verified by render at 12, 50, 51, 55, 151, 301, 480 and in the component sweep (0…500). The marker is at the right edge position at 50/100/150/200/300/500 and moves linearly inside a band.
- **Scale.** Six equal-width bands in the standard AQI colours (#00E400, #FFFF00, #FF7E00, #FF0000, #8F3F97, #7E0023), a ring marker (onSurface ring, surface dot) that reads on every band in light and dark, tick labels 0/50/100/150/200/300/500 at 4x2 (dropped at 4x1 and 2x2 where they collide). Scaled from `componentWidth()`; the height is a static param. Equal widths are a design choice (a proportional 0–500 bar would make Good 10% wide); a reader who expects proportional spacing may be surprised, but the labels say where the edges are.
- **Host variables.** `aqi` (float, exported, 55) and `pollutant` (string, exported, "PM2.5"); the published playground exposes both; verified with `pollutant: "O3"`.
- **Sizes.** 4x2 (320×160 and the 250×110 host minimum), 4x1 (320×80), 2x2 (160×160) all render without overflow findings; narrow 230×160, wide 512×120, short/small variants fine. Three layouts picked by `mode = step(windowHeight(),120) * (1 + step(windowHeight()*1.3, windowWidth()))`. Weak spots: at 4x1 the recommendation is one line with an ellipsis (the sentence is cut; the category and scale carry the meaning); at 160×96 (not a widget size) the pollutant text clips. The thresholds are heuristics: a 4x2 host between 104 and 120 dp tall gets the compact row.
- **Themes.** Only theme colours in the layout (`surface`, `onSurface`, `muted`); light and dark verified. Mono and mono-inverted: the bands become outlined segments with the current band filled, the marker a ring/dot, plus the category word — verified at 55 (mono), 480 (mono 2x2) and 151 (mono-inverted 4x1). The band colours are literal in the colour looks, by necessity.
- **Accessibility.** Header contentDescription; every value is a layout text node (number, category, pollutant, recommendation) so it is announced; the scale canvas has `semantics.contentDescription` "Air quality scale". Weak spot: the canvas label is static (it does not say the value); the number is read from the separate text node. Nothing is clickable.
- **Bytes.** 9098 B for the .rc. About a third is the three AqiScale instances (≈1.2 KB each, one per layout state, always expanded because of the canvas `variable`), and six TextChoice calls (two per state, ~90 B per item plus strings). A single-layout widget would be ~4 KB. Acceptable for a widget; a host that only needs one size could drop two states.
- **Known weak spots.** 4x1 recommendation ellipsis; equal-width (non-proportional) bands; the mono marker on the filled band is a dot rather than a ring (reads, but is subtle); longest expression 26/32 entries (no margin problem, but the `posB` local would need splitting if a seventh band were added); no "no data" state (AQI 0 shows Good, as the sample value is always a reading).
