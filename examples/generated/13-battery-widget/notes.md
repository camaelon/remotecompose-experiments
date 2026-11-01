# Battery widget (phone, watch, earbuds) — eval notes, run 1

Workspace: this folder. Files: `component.json` (the inline DeviceBattery definition), `widget.json` (the document), `widget.rc` (16 415 B), `widget.html` (published playground), `out/*.png` (renders), `*.txt` (saved tool output), `*.json` call arguments.

## 1. Tool calls in order (27 calls to the server, plus `list`)

1. `list` — see the servers and tools. Took: the 5-step workflow (build_kit → check_component → assemble → convert/render/audit → publish). Decided to use only `remotecompose`.
2. `build_kit` (goal verbatim) — resolved "battery widget" and "charging" to the library component `BatteryIndicator`, "phone" to a form factor; `watch` and `earbud` unmatched (but icon suggestions `watch`, `earbuds` given). Examples: HST-03 (canvas battery gauge) and TIM-08 (a countdown, as "layout model"). `needs_component` was empty. Took: BatteryIndicator's params (no charging param!), the design rules (fitBox for sizes, theme colours, Icon for symbols). Decided: write my own inline component since BatteryIndicator cannot show charging.
3. `get BatteryIndicator definition:true` — copied its canvas geometry (scaled body, tip, fill, "!" when low) as the base of my component.
4. `reference topic:components` — learnt body syntax (`$if`, locals, static params), that a body calling another component (Icon) forces expand mode, the mono rules, and the fillMaxWidth/weight/spacedBy traps.
5. `reference topic:format` — learnt visibility takes a declared 0/1 variable, `semantics.contentDescription` modifier for a11y, fitBox fit rules, textMerge/textFromFloat flags.
6. `find kind:icons query:"charging bolt smartphone"` — got `bolt`, `battery_charging_*`, `electric_bolt`; nothing for "smartphone" (query words appear ANDed/ranked by one word). Decided: use `bolt` (filled) for charging and guess `smartphone`, `watch`, `earbuds` for the devices (an unknown name would fail loudly).
7. `check_component` (DeviceBattery, charging=1, level sweep 0..100, showName) — no lint errors; render finding: the percent text overflowed the row by 18 px (the weighted name text in a wrap row). Sweep image: bolt + halo readable over green/amber/red fills. Decided: add fillMaxWidth to the row.
8. `check_component` (charging=0, level 12, same sweep) — "!" appears below 20 and is hidden when charging; mono render correct (white "!" on black). Still overflow by exactly 18 px = 3 × spacedBy 6: weights ignore spacedBy. Decided: replace spacedBy with 6-dp spacer boxes.
9. `render variants:true` (first document: fitBox with tall-with-names, tall-without-names, compact row) — light/dark/mono/mono-inverted/narrow/wide/short fine; `fitbox_no_fit` at 216×88 and 150×88. Decided: add a last compact column that fits small boxes.
10–13. `render` 2x2 all charging, 4x1 low, 4x2 full, 150×88 — 4x1 reported "100%" clipped at 12 sp in weighted thirds (92 dp each). Others fine. rc_bytes 20 235.
14. `audit` — only an info line (which fitBox child shows and each child's minimum). Useful numbers.
15. `inspect task:accessibility` — confirmed the dynamic contentDescription ("Phone, 76%") works, the texts are readable nodes, and the bolt Icon's "charging" label is present only while visible.
16–18. `render variants` + 2x2 + 4x1 after reworking the fitBox to three layouts (names / compact row with spaceBetween / spaceEvenly column) — `zero_size` on two compact cells: my component's row is fillMaxWidth, so the first cell took the whole spaceBetween row. Wasted.
19. `inspect task:bytes` — 16.3 KB: expressions 22 %, 4 icon paths 21 % (3.4 KB), draw/paint 21 %. Decided the per-instance cost is inherent to 9 instances; kept the design.
20–22. `render variants` + 2x2 + 4x1 with the compact cells back in weighted boxes — all clean, every variant without findings.
23–25. `render` 4x2 all full (one charging), 2x2 mono (5 % not charging), 4x1 light all charging — all clean, images checked by eye.
26. `convert check:true render:false` → widget.rc, 16 415 B, lists the six host variables.
27. `publish` → widget.html (727 KB page, playground with the six variables).

## 2. Dead ends and wasted calls

- Calls 7→8: weighted text in a wrap row, then spacedBy under weights. The check output diagnosed both precisely (overflow 18 px), but I had to read the "weights ignore spacedBy" trap in the guide to connect them. One extra call; a lint on "weight inside a wrap row" or "spacedBy with weighted children" would have avoided it.
- Calls 16–18 (3 calls): I gave the compact row `horizontalArrangement: spaceBetween` while my component's root row is `fillMaxWidth`; the first cell filled everything. Self-inflicted; the `zero_size` finding named the cells but blamed weights ("A weight shares what the other children leave"), which were not involved: it was fillMaxWidth inside a wrap arrangement.
- Calls 10–13: rendering four sample states before the layout was final; two of them (4x2 full, 150×88) had to be redone. Avoided by rendering states only after `variants` is clean.
- Call 6: the icon search with three words returned 125 "bolt" hits and no "smartphone"; I had to guess the device icon names (they existed).

Total: 3 dead ends, about 6 wasted calls.

## 3. Wrong, misleading, noisy or missing in the tools' output

- **build_kit mapped "charging" to BatteryIndicator** ("term": "charging", "ids": ["component:BatteryIndicator"]) but the component has no charging state at all (params: level, size, showPercent, fontSize, warnAt, lowAt, label). `needs_component` was empty, although the goal needed a charging indicator the library has no component for. A new user would call BatteryIndicator and discover the gap later.
- **"watch" and "earbud" were `unmatched_terms`** even though the icon section then suggests `watch` and `earbuds`; and "watch" being a form factor word, the kit still picked `form_factor: phone` only.
- **The "layout model" was TIM-08, a launch countdown** ("Structure the screen like this") — nothing in it resembles a three-device list; it only adds 3 KB of noise about UTC offsets and float precision.
- **HST-03's snippets use literal colours** (`"color": "#FFEF5350"`) while the design rules say "Theme colours … literal hex colours lock one look". The example contradicts the rules it is shipped with.
- **check_component dumps the whole expanded document, including every icon path** (hundreds of lines of moveTo/quadTo) — 15 KB per call, of which the useful part (errors, warnings, findings, bytes, image paths) is under 2 KB. Also its output is not valid JSON: the image lines are appended after the JSON ("light theme\n[image saved: …]"), so `JSON.parse` on the saved file fails.
- **zero_size finding text blames weights** when the cause was `fillMaxWidth` children inside a `spaceBetween` row.
- **`render variants`'s size list does not include a 2x2** (it renders 216×146, 480×110, 300×88, 216×88, 150×88). For "a widget", 2x2 (≈146×146) is the most common size and I had to render it separately. The "size warning" line at the top of call 16 ("at 300×88 the content no longer fits") was printed above the per-variant output, out of order with the variant it belongs to.
- **Icon search**: a multi-word query ("charging bolt smartphone") returned only bolt-tagged icons; the count said 125 but nothing told me "smartphone" was ignored or unmatched.
- **Semantics with a dynamic contentDescription** (a textMerge object) is not documented anywhere I read (format reference says only "a plain string"); it works, and `inspect accessibility` confirmed it, but I found it by trying. The components guide also does not say whether `$if` can sit inside a `modifiers` list, so I used weighted boxes instead.
- **convert check output lists 185 font families** ("fonts": {"families": 185}) — meaningless for the document.
- build_kit's design rule mentions `collapsibleColumn` at length for a widget, but the real sizes problem here (narrow vs short) needs a fitBox; the rule says both, with no guidance on which fits a 3-row list.

## 4. What I would have liked

- build_kit to say plainly: "BatteryIndicator has no charging state → needs_component: a battery with a charging mark", with a recipe (e.g. an Icon `bolt` over the fill with a visibility bound to the host variable, and the mono caveat).
- A `--brief` form of check_component (lint, findings, bytes, image paths) without the expanded document and icon paths; valid JSON with the image paths inside it.
- `render variants` to include the real launcher sizes (2x2, 4x2, 4x1 in dp) when the goal says "widget", and to accept a list of named variable sets so that "all full / one at 5 % / all charging" is one call.
- The format reference to document `semantics.contentDescription` as a text object (textMerge/textFromFloat), since that is the only way to read a dynamic value to a screen reader, and to say what the screen reader does with children of a node that carries a contentDescription.
- Lint for "weight in a wrap-content row" and "spacedBy together with weights".
- The icon search to report which query words matched nothing.

## 5. Honest assessment of the final widget

- **Correctness**: three rows (phone, watch, earbuds), each an Icon, a battery drawing filled to the level (green ≥ 50, amber ≥ 20, red below with a "!" in the empty part when not charging), a filled bolt with a surface-coloured halo over the body while charging, and the percentage. Checked at all full, one at 5 % not charging, all charging, and a mono low case; renders match what I expected in every cell of the sweep.
- **Host variables**: `phoneLevel/phoneCharging/watchLevel/watchCharging/budsLevel/budsCharging`, exported floats (samples 76/0, 54/1, 18/0); levels clamped 0..100; charging is read as 0/1 (visibility) and `< 0.5` in the canvas.
- **Sizes**: fitBox with three layouts: 4x2 (names, batteries right-aligned), 4x1 (three compact cells in weighted thirds), 2x2 and anything smaller down to 150×88 (a spaceEvenly column of 36-dp batteries). All of the tool's variants plus 146×146 and 300×70 render without findings. Below ~64 dp inner height nothing fits (fitBox shows nothing): a known weak spot.
- **Themes / mono**: only theme colours are used; light, dark, mono and mono-inverted all render; in mono the state survives by shape (bolt with halo, "!"). Checked by eye at 2x2 mono.
- **Accessibility**: header description; each row has a contentDescription "Phone, 76%" built from the live value; the device name (4x2) and the percentage are readable texts; "charging" is a labelled node only while the bolt is visible. Weak spot: "low" is not spoken as a word, only the number; and whether a screen reader reads both the row description and its children depends on the host.
- **Bytes**: 16 415 B. Large for a widget: 9 component instances (3 layouts × 3 devices) at ~1.25 KB each plus 3.4 KB of icon paths. Pattern mode is impossible (named variables and text in the body). Could be cut by dropping the halo icon (−~100 B/instance) or the scale-to-box transform (the layouts guarantee the size), or by two layouts instead of three.
- **Other weak spots**: the device icon names (`smartphone`, `watch`, `earbuds`) were guessed, not searched (they resolved); compact 4x1 cells are left-aligned within their thirds; the widget has no tap action (none was asked for).
