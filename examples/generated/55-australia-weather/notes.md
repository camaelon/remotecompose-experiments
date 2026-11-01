# Australia weather map: eval notes (55, run 2)

Final document: `aus-weather.json` (made by `gen.py`), converted to `aus-weather.rc` (60,697 B, the light/dark look). Final renders: `r5-variants-sheet.png` (every look and size), `r4-samples-sheet.png` (heatwave, all rain, long labels), `r6-sizes-mono-sheet.png` (widget and narrow sizes in mono-light, after the stray-dot fix).

## 1. Tool calls in order (25)

1. `list`: read the workflow (build_kit, components, convert/render/audit). Decided to follow it. (01)
2. `build_kit` with the request word for word: it returned WorldMap (now with `states: ["AUS"]`), WeatherIcon (static `condition`, so a run-time code needs a stateLayout of 5) and Icon. MAP-05 shows Australia with its state borders. "capital" was unmatched. (02)
3. `map_info` AUS: box 110.47..156.06, height 924.1. It lists only 5 cities (Sydney, Melbourne, Canberra, Dili, Port Moresby), so Brisbane, Perth, Adelaide, Hobart and Darwin are not available as `cities`. Decided to use lon/lat. (03)
4. `describe reference`: its schema, to learn about `query`. Could have been skipped. (04)
5. `reference` query on placing things at map coordinates: there is no offset modifier. The recipe is spacer boxes of `y*s` and `x*s`. The `$map` layers include `"states"`. (05)
6. `find` examples with include_generated: found **GEN-55, the previous run of this same prompt**. (06)
7. `get GEN-55` (meta, json, notes): run 1's document and notes. I reused its pattern (a spacer-placed chip, a CondIcon stateLayout, mapW from the window size, a compact grid) and its findings (Tasmania lost with `countries`, no semantics merge). This saved many calls. (07)
8. `map_info` for the box [110,-50,165,-9], with sea to the east and south for the chips: height 856.5. (08)
9. `reference` query on the states layer and semantics merge: it confirmed `layer: "states"` but said nothing about hiding or merging semantics. (09)
10. `convert` check: ok, 58.7 KB, 2 paths (land and states). (10)
11. `render` variants of the `.rc`: the state borders draw, and the chips don't overlap at the phone size. The narrow 259×640 size fell to the widget grid with a lot of empty space. **No mono variants appeared** (the .rc input was already expanded for light/dark). (11)
12. `describe render`: to learn about samples, sheet and componentTheme. (12)
13. `render` variants of the JSON, after adding a third pane (grid plus a map with dots for narrow, tall screens): every variant failed with `unsupported $if condition "@leader"`, repeated 11 times. Fixed it to a bare `leader`. **Dead end.** (13)
14. `render` variants with sheet: all good, but in mono the 1 dp ring made "Melbou…" ellipsize. Decided to widen the chips to 70 and move the Perth and Adelaide chips. (14)
15. `render` samples (heatwave 36–46°, all rain with -2° Hobart and a storm in Darwin, long names with -11° Canberra): all clean. Long names ellipsize as "Sydney…" and "Canberra…". (15)
16. `inspect accessibility`: each city is announced as "Darwin, 33 degrees, thunderstorm" (the WeatherIcon label is a textMerge of live values), but the "33°" and "Darwin" texts are separate nodes too. (16)
17. `audit`: 2 info findings, deep nesting ×40 and repeated_panes (it suggests `componentMode: "pattern"`). (17)
18. `reference` query on semantics hiding and componentMode: it gave only the componentMode sentence and a dump of the convert schema. **Wasted.** (18)
19. `convert` with mode pattern: 78,537 B, the same as auto. The audit's advice did not help. **Dead end.** (19)
20. `convert` auto: 78.5 KB. The third pane cost 20 KB, so I merged the compact and narrow panes (one pane: grid plus a weighted mini map whose width is 0 below 300 high). (20)
21. `render` variants: 60.7 KB. Everything is good except a stray dot in the 4x2 widget, from PinDot's circle on a 0-size map. Fixed it with `radius * step(componentWidth(), 40)`. (21)
22. `render` sizes 320×160, 259×640 and 300×500 in mono-light: the dot is gone, and the grid plus map is clean. (22)
23. `convert` final check: 60,697 B. (23)
24. `inspect runtime`: idle. (24)
25. `inspect bytes`: the 2 map paths are 14.4 KB, 505 FloatExpressions are 12.6 KB, and 272 DrawCircles come mostly from 5 WeatherIcons × 16 stateLayouts. (25)

## 2. Dead ends and wasted calls (4)
- Call 13: `$if: "@leader"`. The components guide syntax (bare param name) was available, but I had not read it. The error is good, but it is printed 11 times, once per variant.
- Call 18: the reference query for semantics hiding returned the convert schema instead of a "not supported" answer.
- Call 19: `componentMode: "pattern"`, as audit recommended, changed nothing (78,537 B both ways). Either the advice does not apply here (a map or `$mapPoint` locals keep calls out of pattern mode, which the components topic does say) or it is broken. The audit should not recommend it when it cannot apply.
- Call 4 (`describe reference`) and call 12 (`describe render`) could have been avoided if `list` showed the parameter docs for samples, sheet and query.

## 3. Wrong, misleading, noisy or missing
- **Variants on an .rc silently drop mono-dark, mono-light and "tiny"**, although the variants doc says "dark, light, mono-dark and mono-light, narrow, wide, short, small … and tiny". Nothing says why (mono needs re-expansion from JSON). "tiny" never appeared in any run.
- **map_info "cities"** lists only 5 for Australia. Brisbane, Perth and Adelaide (millions of people) are not among "the 243 largest cities", so `cities: [...]` cannot mark the state capitals.
- **No overlap or ellipsis findings**: "findings: none" for every sample, including the long-name sample where "Sydney…", "Canberra…" and "Melbou…" (mono) were visibly ellipsized. There is no sibling-overlap check either, so chip collisions are only caught by looking.
- **The audit's repeated_panes advice** ("set componentMode: pattern") had no effect on bytes.
- **The contact-sheet captions** for samples overlap each other (long variable lists run into the next caption), so they are unreadable (r4-samples-sheet.png).
- **No semantics merge or hide**: each city is read once as a sentence, then again as "33°" and "Darwin". No tool says this is unavoidable.
- **WeatherIcon's `condition` is static**: a host-driven condition costs 5 drawings × 16 places. The bytes report shows the cost but does not say which component causes it.
- **`build_kit` examples**: LAY-14 and CMP-08 were of little use for a map. The key how-to (layout content at map points) is buried in a reference paragraph rather than in an example. A GEN document (a previous eval run) was the most useful result, which suggests the curated catalog lacks a "labelled data on a map" example.
- **WorldMap**: its height is static, and nothing documents where the map sits inside the box when the aspect differs. So I drew my own canvas with `$map` to know the scale exactly.
- **Positive**: state borders are now offered (`states: ["AUS"]`, `layer: "states"`) and drew correctly. In run 1 they did not exist.

## 4. What I would have liked
- A WorldMap `pins` slot (content at lon/lat, anchor, automatic leader lines and collision avoidance), or an `offset` modifier.
- A run-time `condition: "@code"` on WeatherIcon (one drawing, switched internally).
- An overlap check between siblings and text-ellipsized findings in samples renders.
- variants on an .rc either including mono (by re-expanding when JSON is known) or saying explicitly that mono was skipped.
- A semantics `hidden` or `merge` option.

## 5. Honest assessment
- **Correctness**: all 8 capitals are at their real lon/lat on a medium-detail Australia with **state and territory borders** (Natural Earth admin-1, via `$map layer states`). Each has a dot, a leader line and a chip (WeatherIcon from the host code + temperature + name). Sydney's chip sits to the right over the sea and Canberra's below-right, with no overlaps at 360×640, 360×800, 360×384, 576×480 or 792×896. Heatwave, all rain (including negative temperatures and a storm) and long names are clean, and long names ellipsize.
- **Host variables**: `t_<city>` (°C float), `c_<city>` (0 sunny, 1 partly cloudy, 2 cloudy, 3 rain, 4 storm), `n_<city>` (display name). Out-of-range codes are not guarded.
- **Sizes**: the full map at width > 330 and height > 300. Otherwise one pane holds a 4×2 grid (4x2 widget 320×160) plus, when the height is over 300, a mini map with dots (narrow 259×640, 300×500). Chips are fixed in dp, so on a tablet they look small on the large map. The map offsets are hand-tuned for this region.
- **Themes and mono**: theme colours only. Light and dark are good. Mono draws the outline coast, the borders, chips as 1 dp rings and the mono icons. The shipped `aus-weather.rc` is the auto light/dark expansion; a mono player needs the `theme: all` or mono conversion (not shipped as a separate file).
- **Repaint**: idle. **Accessibility**: a document description; each city is announced with live values ("Sydney, 24 degrees, partly cloudy"), with duplicated plain texts. **Bytes**: 60.7 KB, heavy: the map paths are 14 KB and most of the rest is the 5× WeatherIcons per place.
- **Weak spots**: there is no visual heat cue (a heatwave reads only as numbers). The phone has empty space above and below the map. The PNG and Indonesia slivers at the top of the box are kept. Each city is announced twice.
