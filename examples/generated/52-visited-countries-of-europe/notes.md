# Eval 52, run 2: "A map of Europe highlighting the countries I have visited, with a count in the corner."

Final document: **europe-visited.json** (identical to europe-v7.json; built by build.py from gen.py).
44,336 B .rc (inspect bytes on v7). Renders: out/v7-*-sheet.png, out/v6-mono-*-sheet.png, out/v5-light-sheet.png, out/v7-variants-sheet.png.

## Decisions
- **Data form:** the app sends `visited`, an exported float array of 44 values (0/1), one per country in a fixed
  alphabetical order (ALB, AND, AUT, ... GBR, VAT; the order is in gen.py). Why: WorldMap's `values` takes exactly
  this form, `arraySum` gives the count in the document, and one array update recolours the map with no rebuild.
  A list of ISO codes cannot be turned into per-country fills inside the document. Plus `visitedNames`, an exported
  host string ("Map of Europe. Visited: Czechia, France, ...") used as the map's accessibility label, because the
  document cannot build a list of names from the array. The app must keep the two consistent (a weak spot).
- **"Europe" = 44 sovereign states** (the UN list: the 37 countries MAP-04 uses, which include Russia, plus
  Andorra, Liechtenstein, Luxembourg, Malta, Monaco, San Marino, Vatican). Not counted: Turkey, Cyprus, Georgia,
  Kosovo, dependencies (Faroe, Isle of Man, Jersey...).
- **Micro-states:** WorldMap draws nothing for these 7 at any of the detail levels I'd use (map_info: "tooSmallAt low").
  An inline component, MicroStates, draws a dot for each one with the same fit as WorldMap. The dot is filled when
  the country is visited, and when it isn't it shows as a land-coloured disc with a ring.
- **Sample:** 9 visited (CZE, FRA, DEU, GRC, ITA, NLD, PRT, ESP, GBR).
- **Layout:** a stateLayout picks by window shape (`step(windowWidth(), windowHeight() * 1.6)`):
  - Phone card: the map fills the card, with a "9 of 44 countries" pill in the top-LEFT corner. That corner is
    Atlantic/Svalbard, so the pill covers almost no land. The top-right corner covered Finland and Russia.
  - 4x2 widget and wide sizes: a row with a big "9", then "of 44 countries / visited", and the map beside it.
    Europe is nearly square (1000x885), so an overlay at 320x160 left the map tiny under the pill.
- Theme colours only; borders on (+9.5 KB vs no borders, but without them adjacent visited countries merge into one blob).

## 1. Tool calls (in order)
0. (wrapper) list: server instructions + tool list. Took the workflow; noticed map_info exists.
1. build_kit (verbatim goal): WorldMap with `values`/`valueCountries`, and MAP-04, which is this exact prompt.
   Pitfall text says "Europe's 44 at low ~25 KB" while MAP-04 uses 37. Decided to start from MAP-04.
2. map_info Europe: 54 countries in the box, including Syria, Turkey, Georgia, N. Cyprus and Åland, and NOT Russia
   (listed under partlyIn). 7 micro-states are flagged too small. Decided on the UN 44.
3. get MAP-04 (meta, json, notes): the full doc, count via `textFromFloat(arraySum(@visited))`. Copied the structure.
4. reference query (a11y label from a variable, arrays, visibility): host string variables, arrayGet, visibility rules.
   Decided to use a host string for the label.
5. convert v1 (44 valueCountries, overlay pill), check: ok, 39.7 KB. **No word that 7 of my 44 valueCountries draw nothing.**
6. render v1 variants: looked fine. Micro-states invisible; the pill at top-right covered land.
7. convert expanded v1: learned WorldMap's transform (s = min(w/1000, h/885), centred) and saw that the
   micro-state paths are `[]`. Decided on an overlay canvas with the same transform.
8. reference query (maps, $mapPoint, own canvas): $mapPoint with lon/lat expressions plus `wrap`.
9. reference query (inline component, $if theme.mono, $each): fragments only, not the definition skeleton. Partly wasted.
10. reference topic components (28 KB): definition skeleton, $if theme.mono, mono rules.
11. check_component MicroStates (with whole doc): ok. Warns that @microLon/@microLat/@microIdx are "neither a param
    nor a local" (they are document resources; fine). Mono bytes 49.9 KB vs auto 40.5 KB. Saw that dots inside a
    visited country vanish in mono, so added a base disc.
12. (wrapper) describe render: samples × sizes × sheet combine. Planned one call per look.
13. render v3 light: samples 0/1/9/30/micro7 × 360x340 & 320x160 sheet. Widget map tiny, pill covers it, dots too big.
14. render v4 dark: dots scaled with the map, pill moved to top-left. Widget still poor.
15. reference query stateLayout/step: step(x, edge) = 1 when x > edge; stateLayout on window size suggested.
16. render v5 light: stateLayout works; "visited in Europe" wrapped, so shortened it.
17. render v6 mono-dark sheet: good; visited are solid, unvisited are outlines. Dots invisible at widget size in the sheet.
18. render v6 mono-light sheet: same.
19. render zoom (mono-dark widget micro7, output 960x480): dots ARE there; the contact sheet's downscale hid them.
    Bumped the minimum radius to 2.5 dp. (Arguably a dead end; see 2.)
20. inspect accessibility v7: map canvas announces the visitedNames string, then "9 of 44 countries".
    The hidden stateLayout branch is not announced. Prefixed the label with "Map of Europe."
21. (wrapper) describe inspect: the shape of `actions` for interact.
22. inspect interact: set visited to the 30 sample. Count goes 9 to 30, 56 variables changed, layout changes only in
    the pill width, repaint idle. So the runtime update works without rebuilding.
23. audit 360x340: 0 errors, 0 warnings, 2 infos (size dominated by PathData 19.5 KB, the borders layer).
24. audit 320x160: same.
25. inspect bytes v7: 44,336 B; paths 35.8 KB (81%), expressions 5.1 KB.
26. convert v7 without borders: 34,858 B. Kept borders.
27. render v7 dark sheet (5 samples × 2 sizes): all correct.
28. render v7 variants sheet: all 9 variants fine; short 360x204 switches to the row layout.
29. convert final: CRASHED. `SyntaxError: Unexpected identifier 'epoch'` at mcp/lib/catalog.mjs:715, so the server
    doesn't load. The repo was being edited concurrently; not caused by my input.
30. convert final retry: same crash.
31. convert final retry after 20 s (32-convert-final.txt): same crash. Stopped. europe-visited.rc was not written; europe-v7's bytes come from call 25.

Total: 31 server calls (3 wrapper list/describe calls are not counted), 3 of them crashes.

## 2. Dead ends and wasted calls
- Call 9 (reference query for the component syntax): the fragments lacked the definition skeleton, so I needed
  call 10 anyway. A query result that always includes the minimal definition example would have avoided it.
- Call 7 (expanded convert) was only needed because nothing said micro-states draw nothing and nothing gave
  WorldMap's transform. If WorldMap's pitfalls stated the transform (or offered a `points`/`dots` option for too-small
  countries), I'd have saved it.
- Call 19 (zoom render): the contact sheet's downscale made 2 dp dots look missing. A note in the sheet caption
  ("scaled to 50%") would have avoided it.
- Calls 29-31: server crash, environmental.
- v1's top-right pill and v3's overlay widget were design iterations, not tool faults.
Dead ends: 5 (calls 9, 19, 29, 30, 31).

## 3. Wrong, misleading, noisy or missing
- **Silent empty countries:** WorldMap accepts "AND", "LIE", "LUX", "MLT", "MCO", "SMR", "VAT" in valueCountries and
  writes empty paths (`[]`). convert check, render and audit say nothing, so a visited Vatican is counted but never
  shown. map_info does flag them ("tooSmallAt": "low", "shownAt": "none: draw a dot ($mapPoint)"), but WorldMap's
  pitfalls and MAP-04 don't mention it.
- **Inconsistent "Europe":** the WorldMap pitfall says "Europe's 44 at low ~25 KB", MAP-04 says "9 of 37 countries",
  and map_info lists 54 countries (with Syria, Turkey, Georgia, Åland, without Russia). Three different answers.
  map_info's "The countries list is the order to use for WorldMap's values" would put Syria in a Europe count.
- MAP-04's label "Map of Europe with the countries visited filled" is static: the example never says WHICH countries
  are visited. Its accessibility is weak, and build_kit's design rules say nothing about announcing data-driven state.
- check_component warns "@microLon is neither a param nor a local: ... make it a `variable` param instead", but these
  are constant document resources. A float-array param isn't offered, so the advice doesn't fit.
- check_component "themes": mono-dark 49,933 B vs auto 40,460 B. The mono version is ~23% LARGER, which contradicts the
  idea that mono is the smaller look, and nothing explains why.
- convert's info finding lists microIdx/microLat/microLon as "Host-settable variables", but they are not exported.
- interact's formulas are decompiled oddly: "max(array_42, min(0, op_32))" for what is max(0, min(1, arrayGet(@visited, 0))).
  It looks like the arguments are shown in the wrong order, which makes it misleading.
- The contact sheet downscales without saying so; small marks seem to vanish.
- Server crash: a syntax error in catalog.mjs takes down every tool, and the wrapper prints a raw Node stack.

## 4. What I would have liked
- WorldMap: `smallAsDots: true` (draw too-small valueCountries as dots), and a warning when a valueCountries
  entry has no outline at the chosen detail.
- map_info `set: "sovereign"` / a "Europe (UN, 44)" list, so the count's denominator comes from the tool.
- A way to build an accessibility string from an array plus a list of names in the document (e.g. a textJoin over
  values > 0), so the app doesn't have to send a second, redundant string.
- WorldMap `align` (start/centre/end) to put the map beside a count in wide boxes without a weighted wrapper.
- The sheet caption saying the scale.

## 5. Assessment
- **Correctness:** visited countries fill correctly for 0, 1, 9 and 30, and the 7 micro-states show as dots (sample
  micro7). The count reads "N of 44 countries" from arraySum, so it can't drift from the map. Russia counts as
  Europe and is clipped at the box edge.
- **Host variables:** `visited` (float array ×44, exported) and `visitedNames` (string, exported). The constant arrays
  microLon, microLat and microIdx aren't exported. The country order is a contract with the app (documented in gen.py).
- **Runtime update:** verified with interact: a new array recolours the map and updates the count with no rebuild,
  and repaint stays idle.
- **Sizes:** phone 360x340 shows an overlay pill. 4x2 (320x160), short (360x204) and wide (576x255) switch to the
  row layout. Narrow, small and tiny keep the overlay. No overflow findings. In the widget the map is small (~150 dp),
  since Europe is square, and there is a gap between the count and the centred map.
- **Themes:** light and dark use theme colours. Borders in dark are faint (library default).
- **Mono:** in mono-dark and mono-light, visited countries are solid fills and unvisited ones are outlines, so they
  differ by shape, not colour. Dots are filled vs hollow. The pill has no outline in mono. Fine, but it's only text in the corner.
- **Repaint:** idle.
- **Accessibility:** the map announces "Map of Europe. Visited: <names>", followed by the count text. It depends on
  the app sending the names string in sync with the array (weak spot). Unvisited countries are not announced.
- **Bytes:** 44.3 KB (81% outlines). No borders would save 9.5 KB. The stateLayout duplicates the draw ops, not the paths.
- **Weak spots:** the two host inputs can disagree. Micro-state positions are hand-typed capitals in my own
  canvas, which relies on WorldMap's internal transform (centred, min-fit), something the tools don't document.
  The widget's map is small. I couldn't write the final .rc (server crash); europe-visited.json converted fine as v7.
