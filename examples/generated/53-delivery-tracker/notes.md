# 53 run 2: delivery tracker (London), notes

Final document: `tracker.json` (built by `gen.py`), binary `tracker.rc` (12,446 B). Key images: `samples-sheet.png` (7 host samples, dark), `v2-sheet.png` (variants), `w-sheet.png` (light phone + 4x2 widget), `m2-sheet.png` (mono-dark, off-line + delivered, phone + widget), `mono-sheet.png` (mono-light, before the courier/frame fix).

## 1. Tool calls, in order (28)
1. `list`: listed tools. Got the workflow (build_kit, then convert/render/audit). Decided to start with build_kit.
2. `build_kit` (the verbatim goal): got Steps + WorldMap, MAP-03 as the example, and the design rule "the data suits a continent or a country, not a city". Decided on my own canvas with `$mapPoint` on host lon/lat, not WorldMap (its route ends are static, `routeFrom`/`routeTo`).
3. `get MAP-03 json`: canvas pattern (one uniform scale, clipRect, `$mapPoint`). Reused the projection idea.
4. `map_info` London box, detail high: "outlines are accurate to about 8 km ... for a city or a neighbourhood draw a schematic instead of a map". Decided on a schematic: a hand-plotted Thames polyline and park blocks in the same box coordinates.
5. `reference` "animate a host variable change with easing": irrelevant paragraphs. Wasted.
6. `get ANM-01 json,pitfalls,teaches`: `{"value": expr, "anim": s}` canvas variable. Used for the eased courier.
7. `reference` "anim easing curve spec": only standard cubic, duration only; 1.0 packs to nothing. Used 1.2 s.
8. `reference` host string: root-level `variable` with `vtype: string, export`. Used for depot/address labels.
9. `reference` stateLayout: the `step(windowWidth(), ...)` window switch and `ifElse` / step semantics. Used `step(windowWidth(), windowHeight()*1.2)` for phone vs widget.
10. `reference` inline components: `components` top-level, keys summary/params/body/call. Wrote two param-less components (DeliveryMap, EtaBlock).
11. `reference` TextChoice / visibility: TextChoice syntax and textFromFloat flags (used flags 5). Visibility modifier syntax was not shown; guessed `{"visibility": "@x"}` and it worked.
12. `convert` check: failed, "float expression has 37 entries; Android accepts at most 32". Split into vx/vy/len2.
13. `convert` check: OK 12,232 B, but zero_size: map box 0 wide, Steps and legend 0 tall.
14. `render`: confirmed the empty screen below the ETA.
15. `render` after moving `{"weight":1}` before `"fillMaxWidth"`: map appeared (modifier order matters), but Steps/legend still 0 tall.
16. `render` with `{"height": "componentHeight() - 236"}` on the map box: map now 0 tall (reference says componentHeight() in a height modifier reads the parent). Dead end. Legend `spacedBy` + weight overflow reported.
17. `render` with `windowHeight() - 268` and spacer boxes: clean, no findings.
18. `describe render`: samples / variants / sizes / sheet options.
19. `render` samples sheet (at depot, just left, halfway, off the line, nearby 3 min, Arriving, Delivered): all correct.
20. `render` variants + sizes 320x150, 360x180: light/mono parks too heavy (track fill), widget address clipped.
21. `render` variants after parks -> surfaceHigh, ellipsis: one ellipsis missed (my sed), widget text still clipped.
22. `render` light phone + 320x160 widget: fine.
23. `render` componentTheme mono-light + samples, and 24. `audit` (same command line): mono map frame vanished, courier and address markers looked alike, widget "Delivered" clipped. Audit: 0 errors/warnings, info `repaint_continuous` "Repaints every frame".
25. `render` mono-dark after: courier is a solid disc, 1 dp outline frame on the map, ETA 28 sp, widget map weight 1: all clean.
26. `inspect accessibility`: map canvas reads "Map: courier 50% of the way from Battersea depot to 12 Curtain Rd, Shoreditch"; Steps "Step 2 of 4"; only the visible ETA text is exposed.
27. `inspect runtime` 120 frames: verdict "idle", 37 flagged frames (the 1.2 s ease after load), then nothing.
28. `convert` final: 12,446 B.

## 2. Dead ends / wasted calls (5)
- #5: a query that returned unrelated paragraphs. Searching "anim" first would have saved it.
- #12: 37-entry expression. Cheap, and the error message said exactly what to do. A rule in build_kit/format ("split long expressions into named variables") would have avoided it.
- #13/#14: `["fillMaxWidth", {"weight":1}]` gave a box 0 wide (and siblings 0 tall). The zero_size text blames "nothing left to share, or combined with widthIn/heightIn"; it never says modifier ORDER matters.
- #15/#16: a weighted map box in a column took the whole height, leaving the Steps and legend rows 0 tall. Then `componentHeight()` in a height modifier gave 0, against the reference ("componentWidth()/componentHeight() in a width/height modifier read the PARENT's box"). Ended up with `windowHeight() - 268`, which is fragile.
- #21: my own sed slip (missed one maxLines).

## 3. Wrong, misleading, noisy or missing in the tools' output
- build_kit matched "delivery tracker" to `Steps` and "region map" to WorldMap. It also returned `TIM-08 Launch countdown` for "ETA" (a clock countdown, while the ETA here is host minutes) and `CMP-05` as the layout model. "courier, position, moving, depot, address" were unmatched, so there was no route-between-two-host-points example.
- WorldMap `routeFrom`/`routeTo` are `static` (city name or "lon,lat" string), so a route between host-supplied points cannot use the component. The kit does not say so for this goal.
- map_info for a 35 km London box lists `"partlyIn": ["USA United States of America", "GBR United Kingdom", "RUS Russia", "NLD Netherlands"]`: USA, Russia and the Netherlands are wrong (probably a bounding-box test).
- map_info's honesty is good ("draw a schematic instead of a map"), but nothing helps draw that schematic: no rivers/roads layer at city scale. I hand-plotted the Thames.
- zero_size message: "(a weight: nothing left to share, or combined with widthIn/heightIn)". The real cause was `fillMaxWidth` placed before `weight`, and a weighted canvas child taking the whole column.
- The reference claim "componentWidth()/componentHeight() in a width/height modifier read the PARENT's box" did not hold here: the map was 0 tall.
- audit says `repaint_continuous` "Repaints every frame" for the anim variables. inspect runtime says verdict "idle" (only the 37 easing frames). The two contradict each other, and the audit is the noisy one.
- Steps: "Pass the last index for an all-done run", but at index 3 "Delivered" shows as current (halo), not ticked.
- `get` with parts ["pitfalls","teaches"] for ANM-01 returned only the JSON, silently.
- The visibility modifier syntax was never shown in any output I read; I guessed it.

## 4. What I'd have liked
- A map building block for host points: a route `$mapRoute` / `drawLine` from `@lon/@lat` variables, and a "fit the view to these points" helper.
- A city-scale schematic layer (major rivers/water) or an explicit recipe for one.
- A render option to change a host variable mid-run (from A to B at t=0, capture at 0.3 s) to see the eased motion. I could not verify the ease visually; I only saw the settled ends and the runtime frame count.
- zero_size that names modifier order, and a layout snippet for "one flexible element + fixed rows below" in a column.

## 5. Assessment
- Correctness: depot (square), address (ring with dot), route (muted line), done part (primary, the courier's projection onto the route, clamped 0..1), and courier (solid disc) are all placed from host lon/lat through `$mapPoint` on a fixed London box [-0.35, 51.40, 0.15, 51.62]. The view auto-fits the depot and address (one uniform scale, 70-unit margin), so any London pair frames well. Points outside the box still project correctly, but the schematic Thames/parks only cover that box. Off-route courier: drawn at its true spot, with the done line at its projection (sample 4).
- ETA: "N min" (max 1, rounded), "Arriving" when eta <= 1, "Delivered" when status = 3. Status word from TextChoice, plus a Steps tracker with "Step N of 4".
- Host variables: depotLon/Lat, addrLon/Lat, courierLon/Lat, eta, status (floats, exported), depotLabel/addrLabel (exported strings).
- Sizes: phone 360x720 plus narrow/short/small/tall/tablet are clean. A stateLayout switches to a row widget when the width is over 1.2 x the height (320x160 and 360x180 clean). The map height is `windowHeight() - 268`: fragile for odd heights (the short 360x432 variant was fine).
- Themes: dark, light, mono-dark and mono-light all checked; in mono the courier is distinct from the address after the fix. Parks are now faint (surfaceHigh), and invisible in mono.
- Repaint: idle after the 1.2 s ease (runtime), despite the audit's info.
- Accessibility: header description, live map description with % and labels, Steps "Step N of 4", visible texts only. No taps, so no touch targets.
- Bytes: 12.4 KB.
- Weak spots: the schematic is hand-drawn and coarse (the Thames zigzag at Westminster) and has no place names. The route is a straight line, not streets. The eased motion was not visually verified. When delivered, the courier covers the address marker. The map legend has no courier entry.
