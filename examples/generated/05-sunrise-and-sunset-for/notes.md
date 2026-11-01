# Notes: "A sunrise and sunset widget for Lisbon with the sun's position over the day" (run 2)

Final document: `widget.json` (15,352 B as .rc), page: `page.html` (published locally, no design warnings).
48 MCP tool calls (plus one `list`). Transcripts of every call are in `callNN-*.txt`.

## 1. Every tool call, in order

| # | call | what I learned / decided |
|---|------|--------------------------|
| 0 | `list remotecompose` | Workflow is spelled out in the server description (build_kit → check_component → assemble → convert/render/audit → publish). Four other servers duplicate the same tools under other names (rc-examples, rc-render, rc-inspect, json2rc); I used only `remotecompose`. |
| 1 | `build_kit` (goal verbatim) | Jackpot: TIM-12 "Sunrise, sunset and the sun's path" is the layout_model, with the whole solar algorithm in `teaches`, the pitfalls (32-entry limit, longitude sign, offsetToUtc, weights ignore spacedBy) and a verified block with NOAA-checked numbers. `unmatched_terms: ["lisbon"]` (fine, it is a place). EXP-14 and TIM-03 were padding. Decided: adapt TIM-12 to Lisbon rather than write from scratch. |
| 2 | `get TIM-12` (json, meta, pitfalls) | Full JSON: 10 chained solar variables, TimeTile/Panel inline components, the canvas drawn from componentWidth/Height. Noted its `check.render` pins system variable 10 (UTC offset). Decided to compute Lisbon's own UTC offset (EU DST rule) instead of using the device's offsetToUtc(), since a "Lisbon" widget viewed from elsewhere should still show Lisbon times. |
| 3 | `reference expressions` | Function list, no comparison operators (step/ifElse), 32-entry limit, `weekDay() (1 = Sunday .. 7)`. That last claim contradicts TIM-03's teaches ("1 = Monday … 7 = Sunday"). Flagged for a test. |
| 4 | `reference format` | collapsibleColumn recipe, fitBox rule ("only a child with an explicit size can fail to fit"), the trap "weight does not combine with widthIn/heightIn", "weights ignore spacedBy". Decided to try collapsibleColumn first. |
| 5 | `reference tools render` | Found `variants: true` (dark/light/mono/mono-inverted/narrow/wide/short/small/tiny/seven hours) and `clocks: [...]`. Both saved many calls later. |
| 6 | `get DateLabel` | Also says weekDay() is Monday-based; the date is drawn on a canvas, so in a row it needs a weighted box (used that later in the Footer). |
| 7 | `inspect layout` probe.json | A `{"height": "windowHeight() * 0.4"}` modifier evaluates (box was 80 in a 200 box): expressions are accepted in size modifiers. |
| 8 | `render` probe.json, clock 2026-10-31 | PNG shows `weekDay 6` on a Saturday → Monday = 1. The expressions reference is wrong. Built the DST rule on sun0 = weekDay() % 7. |
| 9 | `convert` check v1 | OK, 9,593 B, only the host_variables info. |
| 10 | `render variants` v1 | All 10 states in one call. One warning everywhere: the altitude text 24 px past the header row = 3 × spacedBy 8 with a weighted child (the documented trap, I had walked into it). Short/small/tiny: the sunrise/sunset tiles vanished while blank space remained (collapsibleColumn dropped the tallest no-priority child). Wide variant printed no findings line at all. |
| 11 | `convert` check v2 (spacers, date moved to footer, canvas height `clamp(32, 400, windowHeight()*0.55-46)`) | OK, 9,478 B. |
| 12 | `render variants` v2 | No findings at all; the C++ short render showed the intended 33 px chart with tiles. |
| 13 | `inspect layout` 360×144 v2 | TS player: canvas 86 px, i.e. windowHeight() = 240 (the header), not the 144 box; everything below the chart hidden. The two players disagree on windowHeight(). |
| 14 | `inspect layout` 180×144 v2 | Same; also confirmed the tile label ellipsizes before the time is cut. |
| 15 | `audit` v2 | 0 errors/warnings, 3 infos: `repaint_continuous` ("an operation requested an immediate repaint", `ops: []`), deep_expressions 19, longest expression 22/32. |
| 16 | `inspect layout` probe2 (fitBox + heightIn min) 300 | My probe combined fillMaxSize with heightIn min: child got 0 height (the documented trap) and still "fitted". Inconclusive for fitBox, conclusive that heightIn min is not a fitBox threshold. Wasted. |
| 17 | `inspect layout` probe2 at 144 | Same result. Wasted (should have been one call). |
| 18 | `render` probe2 at 100 | Findings correctly named zero_size with the trap explanation. Wasted. |
| 19 | `inspect runtime` v2 | "continuous", winning cause "immediate repaint" with an empty ops list, plus "Layout bounds animation in progress: root (animating: false)". No actionable pointer. |
| 20 | `render clocks` (6 dates, device at UTC) | Jun 21: 6:12/21:05; Dec 21: 7:51/17:18; 29 Mar 00:30 UTC → WET 6:26/18:57, 01:30 UTC → WEST 7:26/19:57; 25 Oct 00:30 → 7:56/18:45, 01:30 → 6:56/17:45. All match my NOAA script to the minute; the DST switch happens at 01:00 UTC as it should. |
| 21 | `render` device in PDT, 2026-06-21T02:00 | Shows Lisbon's 6:12/21:05 and altitude 42° (NOAA 41.6° at 10:00 WEST): the time-zone logic is independent of the device zone. |
| 22 | `inspect runtime` probe3 (constant canvas height) | Still "continuous": the expression height is not the cause. |
| 23 | `reference components` | Authoring guide: params/locals/$if, mono rules (few lit pixels, no alpha washes), component calling a component → expand mode, canvas inside a component. Decided to split the layout into Header/SunPath/TimeTile/Tiles/Axis/Footer components and use a fitBox of whole layouts. |
| 24 | `check_component SunPath` with sweep over `now` | Lint clean; expansion shows canvas variables and path ids prefixed per instance (`sunpath1_W`), so several instances don't collide. The sweep sheet itself was not written to a file I could open (the result only has the expanded JSON and an inline image reference). |
| 25 | `convert` check v3 | OK, 15,410 B (three layouts expanded). |
| 26 | `render variants` v3 | No findings. |
| 27–29 | `inspect layout` 144 / 200 / 320 v3 | At 200 the TS player showed the minimal child (the middle child's `max(150, windowHeight()-20)` is 220 in TS); at 320 the first child, 220 tall by its modifier, was laid out at 300: a fitBox stretches the fitting child. Decided: middle child fixed 150. |
| 30 | `audit` v3 | Same 3 infos. No repeated_subtree (the components did their job). |
| 31 | `inspect runtime` v3 | Still "continuous" with fitBox, so collapsibleColumn was not the cause either. |
| 32 | `convert` check v3b | OK, 15,381 B. |
| 33 | `render variants` v4 | No findings; stitched and viewed: all ten states right. |
| 34–36 | `inspect runtime` probe-a (constant heights), probe-b (plain column), TIM-12 itself | All three "continuous / immediate repaint / ops: []", including the catalog's verified TIM-12 whose meta says `repaint: scheduled`. Conclusion: the verdict is a false alarm of the tool, not of my document. |
| 37 | `publish` → page.html | 689 KB playground, no design warnings. |
| 38–39 | `audit` at 180×144 and 576×180 | Both calls got invalid JSON from my shell loop (zsh word-splitting), errors. Wasted, my fault. |
| 40 | `inspect layout` 360×200 (after the fixed 150) | Middle child shown and stretched to 180: confirms the fitBox stretch; the expression height on child 1 is unnecessary. |
| 41 | `inspect accessibility` | Document description, the canvas's contentDescription and the Icon labels are exposed; texts are text nodes. |
| 42 | `convert` check final (child 1 height 220 constant) | OK, 15,352 B. |
| 43 | `render` 360×320 | Chart grows to the box in C++ too; no findings. |
| 44 | `render` 576×180 | Middle layout fills the box; no findings. |
| 45–46 | `audit` 180×144 and 576×180 | 0 errors, 0 warnings, the same 3 infos. |
| 47 | `render variants` final | No findings. |
| 48 | `publish` final → page.html | Clean. |

## 2. Dead ends and wasted calls

- **windowHeight() in a size modifier (calls 7, 11–14, 22, 27–29, 40).** It evaluates to the layout box in the C++ renderer and to the header height in the TS inspector/playground. I built a whole design on it (v2), found the disagreement only through `inspect layout`, and then kept it in v3 as a hedge until call 40 showed it was redundant. Nothing in the references mentions windowHeight()'s semantics or that the two players differ.
- **fitBox + heightIn probe (16–18).** Three calls to learn that a wrap/heightIn child always "fits"; the format reference had already said it in one line ("Only a child with an explicit size (height, or width) can fail to fit"). I should have trusted it. The probe was also badly built (fillMaxSize + heightIn, a documented trap).
- **Repaint bisecting (19, 22, 31, 34–36).** Six calls chasing `repaint_continuous`, which the tool reports for the catalog's own TIM-12 too. An empty `ops` list and "PaintContext records only a flag" should have told me sooner that the tool could not localise it.
- **Two audit calls lost to my shell quoting (38–39).** Not the tool's fault.
- **collapsibleColumn (v1).** The design rule recommends it for widgets, but with my content (a tall tile row with no priority, a chart that must not be dropped) it dropped the essential tiles first. It took the v1 variants render to see it; the format reference's rule "none = dropped last, only if it does not fit on its own" is accurate but the consequence (the biggest thing goes) is not obvious.

## 3. Wrong, misleading, noisy or missing

1. **`reference expressions` says `weekDay() (1 = Sunday .. 7)`. It is 1 = Monday (verified: 6 on Saturday 2026-10-31).** TIM-03's teaches and the DateLabel pitfalls say Monday. Anyone computing a last-Sunday rule from the reference would be off by one day.
2. **windowHeight() is not defined anywhere** (the expressions reference only lists `windowWidth() windowHeight()` under "component and host values") and its value differs between the C++ renderer (the box) and the TS player (the header). `render` and `inspect layout` silently disagree on the same document at the same size.
3. **`audit` / `inspect runtime` report `repaint_continuous` with `ops: []` for every document, including TIM-12,** whose own meta says `scheduled`. The "winning" cause is unverifiable and contradicts the `timeInMin` cause in the same list. Noise that cost me six calls.
4. **"Layout bounds animation in progress" names `root` with `animating: false`**: a cause that says it is not happening.
5. **The design rule for small sizes says "give [a weighted chart] a fixed height or heightIn min", while the format reference says "a weight does not combine with widthIn/heightIn (the child gets 0 and vanishes)".** Contradictory, and neither path works for a chart that should grow *and* yield to essential rows.
6. **fitBox is under-documented:** the reference does not say that the fitting child is stretched to the fitBox's size (so a `height` is only a threshold and a weighted child inside it still grows). That fact made the whole design work and I found it by accident in a layout dump. Also not said: whether an expression in `height` counts as "explicit".
7. **`render variants` printed no findings line for the wide variant in run 1** (every other variant had one). Probably a missing "findings: none".
8. **`check_component` with `sweep` returned the expanded JSON (long) but I could not find the sweep sheet as a file**; the result's inline image was not accessible through the CLI wrapper. `output_path` is not a parameter of check_component.
9. **build_kit padding:** EXP-14 and TIM-03 contributed nothing once TIM-12 was in the kit (TIM-03's one capability, time.date, TIM-12 already had). The `design` block is the same generic text every time; fine, but it is 1/3 of the payload.
10. **TIM-12's teaches say `weekDay()`… nothing; but its `verified` string is cut off mid-sentence ("june (2") in build_kit.** The full text is in `get`.
11. **Five server listings for the same tools** (`remotecompose`, `rc-examples`, `rc-render`, `rc-inspect`, `json2rc`, `guide`): the `list` output is long and the duplicates (find_examples vs find, render_rc vs render) invite picking the wrong name.
12. **No tool tells you the time zone of a place.** TIM-12 uses the device's `offsetToUtc()`, so a "Lisbon" document on a phone in New York would show Lisbon's sun events in New York time, and the example's pitfalls do not say so. I had to write the EU DST rule by hand (14 variables).

## 4. What I would have liked

- A `reference` entry (or a line in `format`) for **fitBox semantics**: threshold-then-stretch, what counts as explicit, how it interacts with weights. And an honest line on **windowHeight()**: what it is in each player and on Android.
- **A consistent `weekDay()` base** across the reference and the examples (the reference is the one that is wrong).
- **A repaint verdict that is either localised or silent.** "immediate repaint, ops: []" on every document is worse than no verdict.
- **A `size-sweep` variant for layouts**, like `check_component`'s sweep: render the document at 6–8 heights in one sheet. `variants` covers short/small/tiny but not the band between (150–239) where fitBox/collapsible decisions happen; I used three `inspect layout` calls instead.
- **A "what will be dropped" explanation from `inspect layout`** for collapsibleColumn/fitBox: which child was hidden and why ("did not fit: needed 58, had 30").
- **A note in TIM-12 about the time zone** and, ideally, a library snippet for "UTC offset of a place with EU/US DST rules", since any place-specific time widget needs it.
- **`check_component` sweep sheet written to `output_path`**, like render.
- The `verified` block of an example not truncated in build_kit, or a pointer that it is.

## 5. Honest assessment of the final widget

**Correctness.** Sunrise/sunset for Lisbon are computed from the clock with the Almanac low-precision sun and the -0.833° hour angle; against my independent NOAA implementation they agree to the minute on 31 Oct 2026 (7:02 / 17:38 WET), 21 Jun (6:12 / 21:05 WEST), 21 Dec (7:51 / 17:18) and on both DST switch days at 00:30 and 01:30 UTC. The Lisbon offset is derived from the EU rule (last Sunday of March/October at 01:00 UTC) from year(), dayOfYear() and weekDay(), so the widget shows Lisbon time wherever the device is (verified with a PDT device). The sun's position now (dot on the curve, altitude in the header) matched NOAA within 0.5° in every test; the dot dims below the horizon. Caveats: leap years use only the %4 rule (wrong in 2100); the DateLabel shows the device's date, not Lisbon's (differs only within a few hours of midnight for far-away devices); day length is the difference of the two rounded times, so it can differ by a minute from the exact value. The longest expression is 22 of Android's 32 entries.

**Small sizes.** A fitBox picks the full layout (header, chart, axis, tiles, date + day length) when the box is at least 240 tall, a medium one (header, chart, tiles) from 170, and a minimal one (header, 32 px chart, tiles) below; the chart takes whatever height is left in all three, so it grows with the widget (checked at 360×320 and 576×180). At 180×144 the tile labels ellipsize ("Sunr…") but the times stay intact. Below about 130 px tall the minimal layout would be clipped. Price: three expanded layouts, 15.4 KB instead of about 6 KB.

**Light/dark.** Theme colours only (warning for the sun, outline for the night curve, primary for the pin); both render correctly and the audit finds no hard-coded colours.

**Mono / mono-inverted.** The components switch on `theme.mono`: outlined tiles, thinner strokes, no alpha wash under the daylight curve, a solid white dot above the horizon and a hollow ring below it. Both looks were checked in the variants sheet.

Not done: there is no interaction (none was asked for); the place is fixed to Lisbon rather than exported, because the DST rule is Lisbon-specific and exporting latitude/longitude would silently give wrong times elsewhere.
