# Recurring screen structures and how well selection finds them

Snapshot: `mcp/lib/catalog.mjs` sha256 `9a6a4047…` (your working copy, uncommitted edits included), catalog built 2026-11-01T17:10, 146 examples, `buildKit({goal, max_examples: 4})`. The live module gave identical output to the instrumented copy for all 66 prompts. You are editing `mcp/`, so later numbers may differ.

## What I looked at, and what I did not

- **eval/prompt.md has 66 prompts, not about 57.** `examples/generated/` holds documents for 1-57 only. **Labels for 58-66 come from the prompt text alone**, not from a built document.
- Looked at: `render.png` of all 57 generated documents and of the CMP, TIM, MAP, DOC, LAY, HST, STR, EXP, INT, VAR, ANM and TXT families (contact sheets `gen-*.png`, `cur-*.png`); a few size variants (`cur-adapt.png`); layout skeletons of every document, to five levels, printed by `skeleton.py` (`skeletons.txt`).
- Not looked at: DRW and A11Y renders (skeletons only), generated notes.md beyond one, tablet or wide variants of generated documents. Whole doc.json files were not read line by line. Adaptation claims about generated documents come from their skeletons and the presence of stateLayout, fitBox or collapsible, not from rendering them at other sizes.
- **Subjective:** the choice of structures, the one label per prompt, and every good/partial/bad rating. Measured: counts, routes, hit words, byte sizes. All per-prompt judgements are in `judge.py` so you can overrule one and regenerate.

## Headline findings

1. **12 structures cover 63 of 66 prompts. Top 5: 35 (53 %). Top 8: 49 (74 %).** On the 57 prompts with built documents: top 5 cover 33 (58 %), top 8 cover 45 (79 %).
2. **A uniform "dashboard grid of tiles" is not what the prompts need.** Of the 7 prompts routed by the word dashboard or overview, the built ones are a hero and chart (36, 37), rows (25, 38), panels (40, 47) and a map (55). Tiles do recur, but as the *wide or small variant of a row list*: inline pairs like CityRow/CityTile (2), ServiceRow/ServiceCell (25), NotifRow/NotifTile (45), CategoryRow/CategoryMini (38). A row template should produce them.
3. **"Timer" alone is 2 prompts.** It shares a skeleton (header, big centred visual, readout, action row) with the music player and the water tracker, so I merged them.
4. **layout_model is the weak part of selection: good for 11 of 66, bad for 41.** The returned examples do better: a right-structure example in 24, partial in 21, none in 21. In 12 prompts the model is bad while an example in the same kit is right, and next_steps tells the agent to follow the model.
5. **Hand-written adaptation is a real part of the cost.** 41 of the 57 generated documents contain stateLayout, fitBox or a collapsible layout, including all 8 data-rows, 7 hero-chart and 4 meter-breakdown documents, and these often repeat a row or tile component in two forms. A template gets the most value from owning this.

## Structures

Median KB is doc.json of the generated documents in that structure (a rough proxy for writing effort; n in brackets). "Fit" is my rating of the best curated example.

| # | Structure | Prompts | n | Median KB | Best curated | Fit |
|---|---|---|---|---|---|---|
| 1 | data-rows | 2 9 13 14 24 25 38 45 | 8 | 27.0 (8) | CMP-15; CMP-05, CMP-07 | partial to well |
| 2 | hero-chart | 3 5 11 18 36 37 41 | 7 | 19.3 (7) | TIM-13, TIM-12 | well on a phone, none at widget size |
| 3 | step-explainer | 50 57 60 61 63 64 65 | 7 | 56.6 (2) | INT-06, CMP-06 (navigation only) | partial |
| 4 | glance-card | 1 4 10 22 43 44 46 | 7 | 13.1 (7) | TIM-08, HST-07, EXP-07, LAY-09 | well |
| 5 | map-overlay | 51 52 53 54 55 56 | 6 | 22.1 (6) | MAP-01 to MAP-05 | well |
| 6 | panel-stack | 16 26 40 47 49 | 5 | 18.2 (5) | CMP-14, CMP-12 | well for settings, partial otherwise |
| 7 | param-explorer | 35 58 59 62 66 | 5 | 18.9 (1) | CMP-03 (sliders only) | none |
| 8 | focal-actions | 6 15 34 42 | 4 | 18.9 (4) | TIM-14; INT-08 | well for timers, partial otherwise |
| 9 | meter-breakdown | 12 21 23 39 | 4 | 25.0 (4) | STR-10 | partial |
| 10 | form-result | 27 29 30 32 | 4 | 13.0 (4) | CMP-12; EXP-15 for 32 | partial |
| 11 | journey-card | 17 19 48 (53, 54 secondary) | 3 | 33.1 (3) | none (Steps and LabelValue library demos) | none |
| 12 | control-rows | 20 28 31 | 3 | 15.6 (3) | CMP-14, CMP-05, CMP-03 | partial |
| - | fit none | 7 8 33 | 3 | | TIM-02; TIM-10; CMP-06, INT-07 | |

Ranks 8 to 10 tie at 4 and ranks 2 to 4 tie at 7; the top-5 and top-8 sums do not depend on how the ties break.

**Fit none.** 7, the analog face: a drawing, not a skeleton, and already served by TIM-02 and AnalogClock. 8, the week strip: a one-row calendar cell strip, nearest is a canvas-only month grid. 33, the segmented control: a tab frame, exactly CMP-06 and INT-07, with a single prompt, so not worth a structure. **Weak fits I forced:** 32 (rating card, one input and a derived word, in form-result), 44 (time, date, battery as glance-card), 40 (EV dashboard in panel-stack).

**Sensitivity.** glance-card is the loosest group, and its documents are the smallest. data-rows and control-rows are one skeleton with a different trailing cell; merged they make 11 prompts, the largest group by far, and the top-5 sum becomes 38. Prompts 53, 54 and 56 could equally count under journey-card and param-explorer.

### 1. data-rows
- **Skeleton:** optional summary line or bar, then N uniform rows: leading mark, title and subtitle, one or more values, optional inline bar or sparkline.
- **Across sizes:** rows while tall; drop subtitles and the header when short; rows become a tile grid when wide (seen in 2, 13, 25, 38, 45); cap at the rows that fit.
- **Curated:** CMP-15 is a true fit for transit rows and has small, tall and wide variants, but it is 15 KB of transit logic with no tiles. CMP-05 has phone rows with a static ListItem. EXP-06, EXP-04 have the look but are canvas-only.
- **Parameters:** rows (data arrays or one per row), row fields (lead icon/badge, title, subtitle, value, delta, bar, sparkline), summary, header, max rows, wide mode.

### 2. hero-chart
- **Skeleton:** header, one big value with a caption or delta, a chart filling the rest, then 2 to 3 stats or a short list.
- **Across sizes:** stacked when tall; hero beside the chart when wide; secondary parts drop when short (37 has three fitBox layouts).
- **Curated:** TIM-13, TIM-12 have this skeleton at phone size but carry 19 to 22 KB of tide and sun logic. **None exists at widget size**, while 5, 11, 18 and 41 were built at widget size.
- **Parameters:** hero value and format, unit, delta, chart type (line, bar, step, custom slot), data, now marker, axis labels, stats or list slot.

### 3. step-explainer
- **Skeleton:** title, big visual slot driven by the step, step dots, caption, back/play/next. Onboarding (50) is the same frame.
- **Across sizes:** visual beside the caption when wide; caption shortens when short.
- **Curated:** no catalog example. INT-06 (canvas-only pager) and CMP-06 show navigation only. **The library Walkthrough component is already this frame**, and its demo is a Pythagoras walkthrough, but it is only a component demo, not in the catalog's examples, and no example calls it.
- **Parameters:** titles, texts, count, step variable, autoplay, interval; the drawing is the caller's. Only 2 built documents (50, 57), so the size figure is thin.

### 4. glance-card
- **Skeleton:** one primary value or drawing and 1 to 3 supporting lines, side by side or stacked.
- **Across sizes:** drop lines by priority; stack when narrow or square.
- **Curated:** TIM-08 (text only), HST-07, LAY-09 (fitBox), EXP-07 (canvas-only), LAY-14 (a demo strip, 42 KB).
- **Parameters:** primary, optional visual slot, lines with priorities.

### 5. map-overlay
- **Skeleton:** title and count, map filling the space, markers or a route, overlay or side block with details.
- **Across sizes:** map beside details when wide; details below when tall (51, 52, 53).
- **Curated:** MAP-01 to MAP-05 fit well for the map itself; 53, 54 and 56 add a details block they lack.
- **Parameters:** region, highlights, points, route and progress, night side, details slot.

### 6. panel-stack
- **Skeleton:** title, then a scrolling stack of different cards (rows of switches, a gauge, a status).
- **Across sizes:** one column; flows into columns when wide (40 and 47 are landscape from the start).
- **Curated:** CMP-14, CMP-12 fit phone settings. They have narrow and wide renders but no reflow. Nothing for 40 or 47. In 26 the sections hold toggles, a slider and radios.
- **Parameters:** title, panels (title and content slot), column rule.

### 7. param-explorer
- **Skeleton:** a visual, labelled sliders, a derived readout or sentence.
- **Across sizes:** visual beside the sliders when wide. Only prompt 35 is built, and it does not adapt.
- **Curated:** none; CMP-03 and ANM-01 show controls without a visual.
- **Parameters:** visual slot or chart with a formula, sliders (name, range, unit), readout template. **Four of its five prompts are unbuilt, so this structure is the least verified.**

### 8. focal-actions
- **Skeleton:** header, centred ring, art or drawing, readout, a row of action buttons (plus scrub slider or lap list).
- **Across sizes:** visual and readout in a row with the actions beside them when wide (6); ring dropped when short.
- **Curated:** TIM-14 fits 6 and 34; INT-08 gives a transport row; STR-03 a water count.
- **Parameters:** visual kind, readout, actions (icon or label, action, primary), optional scrub, optional list.

### 9. meter-breakdown
- **Skeleton:** ring, gauge or donut with the number inside, beside a breakdown (macro bars, legend, 7 bars, facts).
- **Across sizes:** side by side when wide; stacked on a watch or square; breakdown compresses to mini cells (23, MacroRow and MacroMini).
- **Curated:** STR-10 is ring and text, the right frame; CMP-07, CMP-08, CMP-09 are galleries of the parts.
- **Parameters:** meter kind, value, max, centre text, breakdown (bars, legend, chart, facts), tone.

### 10. form-result
- **Skeleton:** title, labelled inputs (field display, chips, stepper, adjuster), a result or submit.
- **Across sizes:** one column, centred with a max width when wide; rarely adapts in the built documents (1 of 4).
- **Curated:** CMP-12 has the rows and stepper. The format has no text entry, so login (27) has no curated form. EXP-15 fits 32 but has glyph stars.
- **Parameters:** fields (kind, label, variable, options), result rows with formulas, submit.

### 11. journey-card
- **Skeleton:** status line, from/to endpoints or steps joined by a progress line, key values (gate, seat, ETA).
- **Across sizes:** one line when wide (19), stacked when tall, key values hidden when short.
- **Curated:** none. The Steps and LabelValue library demos have the parts. The largest median size among the single-screen structures.
- **Parameters:** from, to, or steps; current or progress; status; key values; optional QR or countdown slot.

### 12. control-rows
- **Skeleton:** like data-rows with a live control per row: checkbox, slider and mute, or a week of checks.
- **Across sizes:** mostly one column; 20 collapses.
- **Curated:** CMP-14 (switches), CMP-03 (sliders), CMP-05. Nothing for a row with many cells (20).
- **Parameters:** as data-rows, with a trailing control and its variable array.

## Selection score

Judged against labels on the real skeleton of each returned document. `selection.json` has every prompt.

| layout_model | count | | any returned example has the right structure | count |
|---|---|---|---|---|
| good | 11 | | yes | 24 |
| partial | 14 | | partial | 21 |
| bad | 41 | | no | 21 |

21 prompts get a bad model and no right example: 2 8 9 11 13 14 17 21 29 38 39 45 47 48 57 58 60 61 63 65 66.

**By route** (from an instrumented copy of catalog.mjs in `snap/`, your repo untouched):

| Route to the model | Prompts | Good | Partial | Bad |
|---|---|---|---|---|
| text score over LAYOUT_MODELS | 26 | 9 | 3 | 14 |
| regex fallback | 26 | 2 | 8 | 16 |
| models[0] (fallback not in the pool) | 7 | 0 | 2 | 5 |
| dashboard rule | 7 | 0 | 1 | 6 |

| Model | Times chosen | Good | Partial | Bad |
|---|---|---|---|---|
| TIM-08 | 17 | 2 | 3 | 12 |
| CMP-12 | 11 | 2 | 4 | 5 |
| CMP-05 | 9 | 1 | 2 | 6 |
| CMP-08 | 7 | 0 | 1 | 6 |

### Why the model goes wrong (causes, largest first)

1. **Map examples cannot be models.** MAP-* are not in `LAYOUT_MODELS`, so all 6 map prompts get a bad model (tide screen, contacts list, departures), although a right MAP example is in every kit.
2. **The widget filter leaves 3 candidates.** `/widget|tile|glance/` narrows the pool to TIM-08, LAY-14 and CMP-15. Then the fallback for a widget with a drawing is TIM-12, a phone example the filter just removed, so `models.find` fails and `models[0]`, TIM-08, wins by accident. This hits 1 5 12 21 39 41. The code comment says "a widget or tile the sunrise widget", which cannot happen. That is why TIM-08, a text countdown, is chosen 17 times, including for row lists (2 13 14 45) and meters.
3. **The dashboard rule overrides everything** with CMP-08, whose comment says "tiles, a chart, a list". Its document is a gauge row and a tile row, a gallery. It also beats a right TIM-13 (36, 37) and a right MAP-05 (55, by the word overview).
4. **One word, by prefix, can pick the model.** `textScore` uses `includes(" " + w)`, so words match as prefixes, and the model needs score >= 3 with no two-hit rule (byText has one). The rank bonus then favours earlier models.
   - 57, 61: "how ... **works**" matches TIM-14's "work period", giving a stopwatch.
   - 60, 64: "**step**" matches CMP-12's stepper, giving a booking form.
   - 65: "a **short** explanation" matches LAY-14's "drop rows when short", giving a 42 KB weather strip that is not inlined.
   - 29: "**people**" matches CMP-05's "people list", giving contacts for a tip calculator.
   - 31 gets CMP-05 by one word as well, and it happens to be right.
5. **No candidate exists.** No explainer, explorer, journey or meter model is in the list, so those 19 prompts could not get a good model.

### Why examples go wrong

- Subject words outrank structure. 9 gets a month calendar and a date card (TIM-10, TIM-03) on "day, week, month" when it asks for four bars. 42 gets a tide screen on "water, today". 13 gets one battery. 58 gets a moon calendar, right subject and wrong structure.
- Noise: 23 gets A11Y-04 on "target, fat" (its keyword "fat finger"). 13 gets MAP-05 because "charging state" hits the map.region synonym "states". 66 gets MAP-03 on "circle" (keyword "great circle"). 17 gets MAP-03 on "delivery tracker", reasonable for 53, not 17.
- Components do better than examples: Walkthrough, Steps, WorldMap, RankedList, BigNumber, LineChart, Rating, Tabs, Legend usually come back when wanted (I did not score this). Misses and false hits: 63 gets no Walkthrough despite "step mode" (it gets Tabs, on "mode"); 15 gets Walkthrough for a music player; 59 gets Rating. The kit then says "Assemble one document structured like layout_model", so Walkthrough next to a TIM-14 model gives contradictory advice.

### Good examples that exist and were not picked

| Example | Prompts where it fits and was missed |
|---|---|
| CMP-15 (rows) | 2 9 13 14 25 45 |
| CMP-05 (rows) | 2 25 45 |
| CMP-03 (labelled sliders) | 28 30 35 56 58 59 62 66 (controls only) |
| STR-10 (ring and text) | 10 21 23 39 |
| TIM-13 (hero and chart) | 11; also unreachable as a model for widgets 5 and 41 |
| CMP-07 (bar rows) | 9 38 |
| CMP-12 | 29 49 |
| CMP-14 | 16 26 (switch rows) |
| CMP-06 | 33 50 60 |
| TIM-14, INT-08 | 15 42 |
| EXP-15 | 32. Blocked on purpose: expect_findings has glyph_icon, excluded from subject picks; Rating is the better answer, but no example shows it |
| TIM-10, STR-01 | 8 (canvas-only) |

### Worst misses

| Prompt | Got | Should be | Why |
|---|---|---|---|
| 57, 61 explainers | TIM-14 stopwatch | Walkthrough frame | prefix "work" in "works" |
| 65 nutrition label guide | LAY-14 | Walkthrough frame | "short" |
| 60 Pythagoras | CMP-12 booking form | Walkthrough demo, literally the same subject | "step" in Stepper; the demo is not an example |
| 63 heart | TIM-12, TIM-04, ANM-09 | Walkthrough | fallback; "mode" gives Tabs instead |
| 29 tip calculator | CMP-05 contacts | CMP-12 | "people" |
| 2, 13, 14, 45 row lists | TIM-08 countdown | CMP-15, CMP-05 | widget filter; fallback picks TIM-08 |
| 11 weather + chart | LAY-14, no chart example | TIM-13 structure | "weather, icon, temperature" hits, chart ignored |
| 38 budget bars | CMP-08 gauge gallery, nothing else | CMP-07 rows | "overview" rule |
| 47 e-ink | CMP-08 only | none exists | dashboard rule |
| 48 boarding pass | TIM-08 only | none exists | "time, countdown" |
| 58, 66 explorers | moon calendar; DRW-01, MAP-03, CMP-12 | none exists | subject words |

### Cheap selection fixes, if you want them (not simulated, except where stated)

1. Let the first subject example that is not canvas-only be the model. By reading the kits this turns the 12 bad-model, right-example prompts (5 12 33 36 37 41 51-56) right. Risks: 26 (INT-02) and 43 (TIM-12) would get worse. Filter by a structure tag rather than by word hits to avoid that.
2. Add MAP-01, MAP-03, CMP-06 to `LAYOUT_MODELS`. Fix the fallback so it can only name a member of the current pool.
3. Replace the dashboard rule, or point it at a real dashboard once one exists.
4. Use whole-word matching for the model, or require two hits as byText does.
5. Tag each example with a structure, and classify goals into structures. labels.json is a usable first test set for that.

## Gaps to fill first

Ordered by prompts, where the best curated example is partial or none:

1. **step-explainer (7).** The component exists; make a catalog example (or promote the Walkthrough demo) so it can be selected, and pick it as the model.
2. **hero-chart at widget size (7 in the structure; 5 11 18 41 built at widget size).** Phone examples are good, nothing small exists.
3. **param-explorer (5).** Nothing. Build one before trusting this structure.
4. **panel-stack beyond settings (5, of which 40 47 49 uncovered).** A landscape or e-ink panel layout.
5. **meter-breakdown (4).** STR-10 is the frame without a breakdown, and no example shows a ring with bars.
6. **form-result (4).** Input rows and a live result; a login frame given no text entry.
7. **journey-card (3, plus 53 54).** Nothing, though parts exist.
8. **control-rows (3).** A row with several cells.
9. **data-rows in a neutral form (8).** CMP-15 fits, but is transit-specific and has no tile mode.

## Recommended first templates

Ranked by prompts covered, the median cost of writing them by hand, and the size of the gap. A template is a library component with an adaptive body, so the existing `slots`, `$each`, `$if` and expansion apply. The calls are sketches, not an implemented API. Map-overlay and step-explainer are left out on purpose: their examples or components already exist, and their cost is presumably in the drawing (I did not measure how much of GEN-57's 89 KB is the engine drawing), so the selection fixes pay more.

Under all of them, I would build one internal piece: **an adaptive split** (tall: stacked; wide: side by side; short: drop by priority). The generated documents rewrite this switch again and again (12, 21, 23, 36, 41, 46), and I expect it to be the bulk of what is saved.

**1. RowList: data-rows and control-rows, 11 prompts, 27 KB median.**
```json
{"RowList":{"title":"Services","summary":"@upCount of 6 up",
 "rows":{"count":6,"title":"@names","subtitle":"@hosts","value":{"of":"@latency","unit":"ms"},
  "lead":{"status":"@state"},"bar":"@uptime"},
 "wide":"tiles","short":"hideSubtitle"}}
```
With `"trail":{"Switch":{"checked":"@on"}}`, or a slider or checkbox, this also serves 28 and 31.

**2. HeroChart: 7 prompts, 19 KB median, plus a gap at widget size.**
```json
{"HeroChart":{"caption":"Today's revenue","value":"@revenue","prefix":"$","delta":"@change",
 "chart":{"BarChart":{"values":"@byHour"}},
 "aside":{"RankedList":{"names":"@top","values":"@sales"}},"keep":["value","chart"]}}
```

**3. FocalControls: focal-actions and param-explorer, 9 prompts, 19 KB median.** Run 58, 59, 62 and 66 first, to verify the explorer half.
```json
{"FocalControls":{"title":"Pomodoro","slots":{"visual":[{"ProgressRing":{"value":"@left"}}]},
 "readout":"@timeText","caption":"@phase",
 "actions":[{"label":"@startWord","primary":true,"onClick":"toggle"},{"label":"Reset","onClick":"reset"}]}}
```
For an explorer, replace `actions` with `"sliders":[{"name":"rate","min":0,"max":12,"unit":"%"}]`.

**4. MeterBreakdown: 4 prompts, 25 KB median.** Could be RowList plus a meter on the split.
```json
{"MeterBreakdown":{"meter":{"kind":"ring","value":"@eaten","max":"@target","center":"@left","unit":"left"},
 "bars":{"labels":["Protein","Carbs","Fat"],"values":"@macros","limits":"@macroGoals","unit":"g"}}}
```

**5. JourneyCard: 3 prompts and 2 secondary, 33 KB median, no example today.**
```json
{"JourneyCard":{"title":"@flight","status":"@status","from":{"code":"SFO","time":"@dep"},
 "to":{"code":"JFK","time":"@arr"},"progress":"@p","icon":"flight",
 "facts":[["Gate","@gate"],["Seat","@seat"]]}}
```
For 17, `"steps":["Ordered","Shipped","Out for delivery","Delivered"],"current":"@step"` replaces from, to and progress.

Together: 34 of 66 prompts. With Walkthrough (7) and map examples (6), once selection finds them: 47 of 66.

### What must stay customisable so results do not look alike

The generated renders already converge: a pale ground, white cards, one blue accent, small grey captions. My impression, not a measurement. Templates would harden that, unless these remain free:

- **Slots for every drawing and the row's cells.** Lead, trail, visual and aside take any component or canvas, never just an enum. The subject should show there: a bottle, a hypnogram, a stock line.
- **Surface treatment:** card, divided, inset, none, full-bleed colour or background, as a parameter, not fixed to cards. 47 needs rules and no fills; 44 needs black.
- **Theme through the document:** colours, a hero font weight and size, numeric style, corner radius, density.
- **Hero treatment:** size, position (top, side, overlay on the chart), with or without caption or delta.
- **Priority and order:** which part drops first and in what order parts sit. These are what the subject decides.
- **Escape hatch:** expanding a template to plain JSON and editing it, which `expand_components` already allows, so a template is a start, not a wall.
- **Selection:** the kit should say "start from this template" only when the goal is a clear fit, and should never replace the drawing the prompt asks for.

## Also seen, not investigated

- GEN-41's render shows an empty chart area with axis labels; GEN-33's chart is almost empty; GEN-40's text is very small in its render. These may be pinned-clock or host-data effects.
- CMP-08's comment in catalog.mjs does not describe its document (above).

## Files

`labels.json`, `selection.json`, `judge.py` (judgements, rerun to regenerate both), `run-debug.mjs` and `raw-selection.json` (buildKit output with routes), `skeleton.py` and `skeletons.txt`, `sheets.py` and the contact sheets, `snap/` (copy of mcp/lib with one debug line; other folders symlinked to the repo, read-only use).
