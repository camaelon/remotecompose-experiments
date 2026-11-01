# Weather widget — eval run 11-run1

Request: "A weather widget: current temperature, condition icon, high and low, and the next 6 hours as a small chart."

Deliverables: `weather.json` (source), `weather.rc` (8,707 B), `weather.html` (published playground), renders in `out/` (v4-* are the final ones; A–E are the sample-value checks).

Total tool calls: 28 (CLI invocations of `list`/`call`; file reads of saved output don't count).

## 1. Tool calls in order

1. `list` — see the servers/tools. Took: the five-step workflow (build_kit → check_component → assemble → convert/render/audit → publish). Only `remotecompose` is allowed, so I ignored rc-examples/rc-render/rc-inspect/json2rc/guide (they duplicate it).
2. `build_kit` (goal verbatim) — resolved to components Icon, LineChart, WeatherIcon; examples LAY-14 (layout model), VAR-04, CMP-11, TIM-13; design rules. Took: WeatherIcon's condition is static → put five icons behind visibility driven by a host integer; LineChart takes `values: "@name"` of an exported floatArray; TextChoice for the condition word; `@colors.*` theme colours; `needs_component` was empty so no inline component needed. Decided: no check_component step needed.
3. `reference topic=format` — JSON skeleton, modifiers, visibility semantics (declared 0/1 variable), textMerge/textFromFloat flags, collapsibleColumn and fitBox rules, semantics modifier. Took almost everything used later.
4. `get id=LAY-14 parts=json` — the "layout model". Took the widget structure idea (padded box → column, icon/temp/H-L row). Did NOT copy it: it is hard-coded (hex colours, "22°", "H25° L14°" literals).
5. `get name=StateLayout` — ERROR: "stateLayout is a layout node of the format, not a library component". Dead end (see §2). Decided to use visibility instead, no further lookup.
6. `get name=TextChoice` — call shape `{"TextChoice": {"items": [...], "index": "@v"}}`, index rounded+clamped, hidden items GONE. Took it for the condition name.
7. `get id=TIM-13 parts=json` — the one real document with exported floatArrays (`{"value": [...], "export": true}`), a LineChart call (`fill`, `marks`, `label`), textMerge+textFromFloat for a number with a unit, visibility variables, `componentTheme: "auto"`. Essential.
8. `reference topic=expressions` — functions (floor, step, ifElse(whenFalse, whenTrue, cond), arrayMin/arrayMax), clock values (timeInHr()). Took: `h0 = ifElse(timeInHr() + 1, @startHour, step(@startHour, -0.5))` so the host can pin the first hour or let the clock supply it.
9. `convert check:true` — ok, 6,973 B. xLabels accepted text objects (textFromFloat) — not documented but works.
10. `render variants:true` — 10 pictures. Found: 160×96 clips "21°" (H/L column squeezes it). Decided: hide H/L below 200 dp (`wide = step(windowWidth(), 199)`), zero-pad hours (flags 13).
11–14. `render` ×4 with variables: cold/flat (-12°, snow, flat series), hot/steep (38°, sun), tiny 160×96 cold storm, narrow 230×160 cloudy with `startHour: 22`. Took: negatives and flat series render right; host startHour works ("22 23 00 01 02 03"); "Thunderstorm" clips at 160 wide → renamed "Storm".
15. `audit` (default size) — clean (0/0/0).
16. `inspect task=accessibility` — every text is a node, icon reads "Rain", chart reads its label. "H"/"L" read as bare letters → changed to "High"/"Low".
17. `convert check:true` — 7,018 B, ok.
18. `render variants:true` — all clean. Noted: 512×120 drops the chart entirely though ~40 dp are free.
19. `audit width=160 height=96` — clean.
20. `render` 230×160 cold with "High/Low" — fits.
21. `publish` — html written (605 KB page, 7,018 B rc). Fine, but superseded.
22. `convert check:true` after restructuring to column + weighted fitBox (full chart 72 dp / compact 38 dp) — 8,680 B.
23. `render variants:true` — wide now shows the compact chart; `fitbox_no_fit` warnings at 96 dp tall (expected: nothing fits in 16 dp).
24. `audit width=512 height=120` — info only: fitBox shows child 2 of 2. Confirms the design.
25. `publish` — republished (superseded).
26. `convert check:true` after adding an empty third fitBox child — 8,707 B, ok.
27. `render variants:true` — findings: none on all 10 variants.
28. `publish` — final `weather.html` (629,959 B page, rc 8,707 B).

## 2. Dead ends and wasted calls

- Call 5 (`get StateLayout`): the kit's WeatherIcon pitfall says "put the five icons in a stateLayout" and the design rules say "a whole layout per state is a StateLayout (LAY-15)" with a capital S, like a component; `get` by name then says it is a format node. One wasted call. Avoidable if the kit said "`{"stateLayout": ...}` (a layout node, see LAY-15)" and spelled it consistently.
- Calls 21 and 25 (two early publishes): I bundled publish with checks that then revealed changes. My own impatience; publish last.
- Calls 17/22/26 (convert check after every edit): render already converts, and convert's `check` found nothing render didn't. The only thing I wanted from it was the byte count, which render does not report. 2 calls could have been saved if render printed the .rc size.
- Call 4 (LAY-14 JSON, 11 KB): the structure idea was worth a glance, but four near-identical copies of the same card and hard-coded everything made it mostly noise. The kit's "layout_model" pointer oversold it.

## 3. Wrong, misleading, noisy or missing in the tools' output

- **Layout model contradicts the design rules.** build_kit: "Structure the screen like this ... get it for the full JSON" pointing at LAY-14, whose JSON uses `"background":"#FF0B1220"`, `"color":"#FF8A99AD"`, literal `"22°"`, `"H25° L14°"`, `"Sunny"` and a hand-drawn sun canvas — exactly what the same response's design rules forbid ("literal hex colours lock one look", "Show meaning with drawing, not characters"). A new user copying the model would fail the audit.
- **StateLayout vs stateLayout.** Quoted: "a whole layout per state is a StateLayout (LAY-15)" and "put the five icons in a stateLayout (or behind visibility)". `get name=StateLayout` → error. The error message is good; the inconsistency upstream is the problem.
- **Row alignment key inconsistency.** The format reference says row takes `horizontalArrangement`; LAY-14's JSON uses `"horizontalAlignment": "spaceBetween"` on rows. One of the two is wrong or both are accepted silently; the reference should say.
- **convert's `host_variables` finding lists theme colours as host-settable:** "Host-settable variables: condition ..., muted (color) = "#FF8A94A6", onSurface (color) ..., primary ..., surface ..., warning ...". Only my five exported floats (and the float array, which this line omits!) are the host's. The array `hourly` appears only further down in `namedVariables`. Misleading in both directions.
- **render saves every image twice:** `[image saved: out/render-1793443729369-0.png]` and `out/v1-dark.png`. 20 files for 10 pictures; the generic copies are noise when an output_path is given.
- **xLabels accepting text objects is undocumented.** LineChart's doc says "Texts under the plot ... [\"00\", \"06\", ...]" (strings). Passing `{"type":"textFromFloat", ...}` items worked and is the only way to get clock-driven hour labels, which the design rules demand ("compute what depends on now"). Say so in the param doc.
- **`fitbox_no_fit` warning text pushes the wrong fix.** "Make the last child fit the smallest size you support" — for a widget at 96 dp tall the right answer is to show nothing below the header row; an explicit empty child silences it, but the warning does not mention that as an option.
- **build_kit's `examples` are long and mostly irrelevant.** VAR-04 (a canvas badge, flagged "take the technique, not the structure") and CMP-11 (battery + banners) contributed nothing I used; TIM-13 was essential but only its JSON (a separate `get`) had the array/LineChart syntax — the kit's snippet for it was just `"timeInMin()"`. The 40 KB kit could be a quarter of the size with the floatArray declaration and one LineChart call inline.
- **No size figure for components in the kit** beyond "about 1.1 KB for a function chart": my doc went 7.0 → 8.7 KB when I added the second (compact) LineChart; fine for a widget, but a per-call cost in `components[].demo.bytes` is the demo's, not the call's.
- **`variants` sizes are fixed** (230×160, 512×120, 320×96, 230×96, 160×96). Useful, but there is no way to say "my widget's real sizes are 4x2 / 2x2 / 4x1" nor to combine variants with `variables`, so the sample-value checks needed four more calls.
- **render's text_overflow finding is accurate and actionable** (it caught "21°" and "Thunderstorm"). Good. Likewise `audit`'s `layout_fitbox_shows` info.
- **windowWidth() in a resources.variables expression** worked for the visibility of the H/L column, but nothing in the docs says it is legal there (the format reference mentions it only "in a modifier"), and nothing says whether the Android player evaluates it at the widget's size. I used it; unverified on a device.

## 4. What I would have liked

- One short "document skeleton for a host-driven widget" in build_kit: header, `resources.variables` with `export`, `resources.floatArrays` with `export`, one text with textMerge/textFromFloat, one visibility variable, one component call. That is 20 lines and would have replaced calls 3, 4 and 7.
- The .rc byte count in render's output (and in publish — it is there).
- `variants` to accept a list of sizes and a `variables` set, so sample values and sizes can be swept in one call (a contact sheet like check_component's sweep, but for a document).
- A `get` that returns a component's *call in context* (one example JSON fragment that declares the data it reads), not the component's demo folder name.
- A one-line answer to "how do I pick one of N drawings by a host integer" — visibility vs stateLayout, with the costs. I guessed visibility.
- The audit or a11y inspect to flag single-letter labels ("H", "L") as poor screen-reader text; I only noticed by reading the node list.

## 5. Honest assessment of the final widget

- **Correctness:** current temperature (`temp`), condition icon and word (`condition` 0 sun, 1 cloud, 2 rain, 3 snow, 4 storm), high/low (`high`, `low`), and the next six hours as a LineChart over the exported array `hourly` (6 values, y range = min-1..max+1 so a flat series sits mid-plot, a dot on each hour, light area wash). Hour labels are computed: `startHour` (host, -1 = "next full hour from the clock") then +1 each, mod 24, zero-padded. Verified at -12°/flat/snow, 38°/steep/sun, storm, cloudy with startHour 22.
- **Host variables:** temp, high, low, condition, startHour (floats) and hourly (float array), all exported with sample values; nothing is baked in. The theme colours also show up as "host-settable" but that is the theme, not data.
- **Small sizes:** 320×160 full; 230×160 full; 512×120 and 230×96/320×96 use the header row plus a compact (label-less) chart when ≥38 dp remain, otherwise header only; 160×96 hides the H/L column (width < 200) so the temperature keeps its room. Nothing clips in any variant. A 4x1 at 96 dp tall gets no chart (there is no room for one) — acceptable.
- **Themes:** every colour is `@colors.*` (surface, onSurface, muted, primary; WeatherIcon brings warning/amber and its blue drops). Light and dark checked.
- **Mono / mono-inverted:** rendered correctly: outlined cloud, line in onSurface, no area wash. In mono the card has no visible border against the background (TIM-13's Panel adds an outline ring in mono; I did not replicate it to keep bytes down) — minor.
- **Accessibility:** header contentDescription; the visible WeatherIcon reads "Rain"/"Snow"/...; temperature, "High 25°", "Low 14°" and the hour labels are text nodes; the chart canvas carries "Temperature for the next six hours". Weak spot: the six hourly values are not read out (only the labels), and "21°" has no "degrees Celsius" wording.
- **Byte size:** 8,707 B (.rc). Two LineCharts (full + compact, ~1.1–1.6 KB each) and five WeatherIcon drawings account for most of it. Fine for a widget, but could drop to ~7 KB without the compact alternative.
- **Known weak spots:** (1) hour labels computed from the clock drift from the data if the host does not refresh the array hourly and does not set `startHour`; (2) `windowWidth()` inside a resources variable is unverified on Android; (3) chart y-range padding of ±1 ° is arbitrary (a steep 24→41 series uses the full height, a flat one is a straight line mid-plot); (4) no unit symbol beyond "°"; (5) the icon at 48 dp is large for 160 dp wide widgets; (6) no "now" marker since the chart starts at the next full hour.
