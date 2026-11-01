# Sleep summary card — build notes (eval 18, run 1)

Request: "A sleep summary: hours slept, a hypnogram-like chart of sleep stages, and a quality score."
Deliverables in this folder: `doc.json` (the card), `hypnogram.json` (the inline component), `sleep.rc` (11 919 B),
`sleep-playground.html` (published playground), renders `var-*.png`, `smp-sample*.png`, `s-4x1.png`, `s-250x110.png`,
contact sheets `sheet-*.png`, every tool output as `*.txt`, probe documents `probe*.json`, `tA/tB/tC.json`.

## 1. Tool calls, in order (38 CLI invocations that reached a tool)

1. `list` — tool catalogue. Took the workflow (build_kit → check_component → convert/render/audit → publish).
2. `build_kit` (goal verbatim) — resolved "hour"→time.clock, "score"→use-case *game*, "chart"→LineChart; unmatched: sleep, hypnogram, stage. Gave LineChart + Icon, examples TIM-12/TIM-13 (sun path, tides) and a needs_component recipe for "hypnogram". Decided: LineChart is a smooth spline, wrong for a step chart → write my own Hypnogram component; ProgressRing for the score (not in the kit; I knew the name from the server description).
3. `reference expressions` — step(x, edge) argument order, arrayGet/arrayLength/arraySum, "log (base 10)", the 32-entry limit, no comparison operators. Decided the stage encoding (below).
4. `reference components` — component definition syntax, locals, `$if theme.mono`, mono rules, the canvas unit-box advice.
5. `reference format` — stateLayout/fitBox/visibility rules, textFromFloat flags, semantics modifier syntax, widget sizes (4x2 = 320×160, 4x1 = 320×80, 2x2 = 160×160), "weights ignore spacedBy".
6. `get ProgressRing` — params (progress 0..1, size, thickness, showLabel). Used as is.
7. `get DRW-06 (json)` — exact `pathExpression` + `drawPath {path: id}` syntax.
8. `get LAY-15 (json)` — `stateLayout {indexId, children}` syntax (the example binds an integer resource; I bound a float expression, which worked).
9. `check_component` Hypnogram v1 (4 fill pathExpressions + 1 mono stroke path, 2 samples per slot) — lint clean, but the render showed bulging "vase" shapes instead of steps and a wrong mono line.
10. `check_component` v2 (6 samples per slot, log(c)/log(100)) — looked identical at thumbnail size.
11. `convert expanded:true` — confirmed the component expanded as intended (count 578, start −1), so the problem was the player, not the expansion.
12. `check_component` with 62 samples — same picture.
13. **stray call** `check_component @cc4.txt` — a typo in my shell line (file did not exist); wasted.
14. `check_component` with 122 samples — same picture. Conclusion: sample count is irrelevant.
15. `render` probe (sawtooth + square wave with literal a[0]) — dense sampling IS honoured; square wave sharp.
16. `render` probe2 (arrayGet-indexed steps / masked product / eq-form) — showed the real cause: the player draws a Catmull-Rom-like spline through the samples and the bow is proportional to the vertical jump between neighbours, so any one-sample step becomes a slanted edge. Decided: abandon pathExpression; draw with a canvas `loop` of drawRects (colour) and drawLines (mono).
17. `check_component` v3 (loop) — crisp bars in light/dark; mono-inverted correct except the level was one unit too low; the "mono" render was white-on-white (demo has no background). Lint warned `@i is neither a param nor a local` for the loop index (false positive).
18. `describe render` — learned `samples` (up to 12 variable sets in one call) and `variants`.
19. `convert check:true` on the full card — converted (8 789 B), one overflow warning: legend pushed out by 12 px = the two spacedBy gaps the weighted chart ignores. Fixed with padding on the chart box.
20. `render variants:true` — all states rendered, "findings: none" — but every formatted number except the minutes read **0** ("0h 00m", "0:00 – 0:00", "Awake 0%").
21. `render samples` (4 host-data sets) — same zeros; the ring, chart and minutes right.
22. `audit` — nothing.
23. `inspect accessibility` — the TS inspector computed everything correctly ("7h 00m", "23:10 – 6:40", "Deep 27%"), so the renderer and the inspector disagreed.
24. `render` probe3 (13 textFromFloat forms over floor/%/arraySum chains) — all correct in isolation.
25–27. `render` tA (no semantics) / tB (no stateLayout) / tC (no Hypnogram) — tA correct, tB and tC still zero → the semantics contentDescription's textFromFloat ops were the cause: the one number that survived was the only one whose visible format (whole 2, flags 13) differed from the description's (whole 2, flags 5), so identical textFromFloat ops are deduplicated into one id and the renderer freezes it at 0 when it is first evaluated for the description. Fixed by giving the description its own `a11y_*` variables (`@x + 0`).
28–32. `render variants` / `render samples` / `audit` / `inspect accessibility` / `inspect bytes` — all numbers now right in every theme and sample; audit clean; a11y text correct; 9 190 B, 43% variables/expressions.
33–37. After the layout fixes (third "narrow" layout, chart hidden in the short layout below 200 dp, mono values on the stage colours): `convert check` (11 919 B, no findings), `render variants`, `render 320×80`, `render 250×110`, `inspect runtime` (idle, never repaints by itself, 2 844 ops/frame when it does paint).
38. `publish` — `sleep-playground.html` (681 KB).

Four other shell lines failed before reaching any tool (a zsh quoting mistake on my side, re-run immediately); not counted.

## 2. Dead ends and wasted calls

- **pathExpression for a step chart (calls 9–16, 7 calls + 1 stray).** Nothing in build_kit, the format reference or the component guide says that `pathExpression` is drawn as a smoothing spline through its samples. The recipe says "Prefer circles, arcs, clips and pathExpression over SVG path strings", the sun/tide examples use it for smooth curves, and LineChart's doc says "monotone spline" only about itself. One sentence ("pathExpression is a Catmull-Rom spline through the samples; for straight segments or steps use drawLine/drawRect in a loop") would have saved all of it. The loop solution is also better (no 32-entry gymnastics, no edge masks).
- **Thumbnail misreading (calls 10, 12, 14).** I judged the first two renders at the tool's native 320×120 and could not see that the sampling had changed; upscaling the PNG locally showed the real shape. check_component's contact sheet at 2× would have made it one call.
- **Stray call 13** — my own typo.
- **Zeros in formatted text (calls 24–27, 4 calls).** The render reported "findings: none" on a card whose main number read "0h 00m" while the inspector's accessibility pass read "7h 00m" from the same JSON. A consistency check between the render's texts and the inspector's would have flagged this; tB and tC were unnecessary once tA was planned, but I ran the three in parallel to save a round-trip.

## 3. Wrong, misleading, noisy or missing in the tools' output

1. **Renderer vs inspector disagree on textFromFloat** (the most serious). The render tool (C++ player, presumably) shows 0 for a number formatted by a textFromFloat whose (value, whole, decimal, flags) also appears inside a `semantics.contentDescription`; the TS inspector shows the right value. No finding is raised ("findings: none"). The format reference even recommends the pattern that triggers it: "the description may be a text object ({"type": "textMerge", "id1": "Phone, ", "id2": {"type": "textFromFloat", "value": "@level", ...}}) so a screen reader hears live values". Whether Android behaves like the C++ player or like TS, I cannot know; I worked around it with separate variables, which costs ~11 expressions.
2. **`pathExpression` smoothing is undocumented** (see dead ends). The expressions reference, the format reference and DRW-06 give the syntax but not the interpolation; the needs_component recipe pushes you to it: "Prefer circles, arcs, clips and pathExpression over SVG path strings."
3. **`log` base.** The expressions reference says "log (base 10)". My first mono render only fits natural log (REM at 1 + ln(100)/2 = 3.3 units, awake off the top). I did not isolate it further (the ratio log(c)/log(100) is base-independent and worked), but either the reference or the player is wrong.
4. **check_component renders mono on a white background.** The mono demo has no surface, so a white (onSurface) stroke is invisible; I only saw the shape in mono-inverted. The demo host should paint `@colors.background`.
5. **Lint false positive:** "@i is neither a param nor a local: it must be a variable every calling document declares; make it a `variable` param instead" — `i` is the canvas loop's `index`. The guide never says how a loop index is declared or scoped inside a component.
6. **build_kit noise.** "score" resolved to use-case *game*, "hour" to *time.clock*, and the two examples offered (sunrise astronomy, tide forecast, 16 KB each) are far from a sleep card; their teaches/pitfalls are mostly about the clock and UTC. `resolved.use_cases: ["chart", "game"]`. Nothing about the Card or ProgressRing/Gauge components that the score obviously needs (needs_component mentions ProgressRing only under "learn_from"). The `design` block is generic boilerplate repeated per call (seven rules, ~6 KB).
7. **LAY-15, the example given for stateLayout, violates the kit's own rules:** a text glyph "✓" as an icon and hard-coded colours (`#FF0B1220`, `#FF2E7D32`), the very things the audit flags.
8. **Array host variables are second-class in the tools' summaries.** `convert check` lists `stages (float_array) = [30 values]` (good), but `publish` lists the host variables as score/sleepEnd/sleepStart/slotMin plus the four *stage colours* (resources.colors entries, not meant as host inputs) and omits `stages` entirely, so the playground cannot edit the one input that matters. `describe render` says arrays are accepted for `variables` and they were.
9. **Missing:** any array reduction beyond sum/min/max/length (no count-equal, no map), which forced the odd stage encoding below. The expressions reference should say plainly "there is no per-element operation; encode what you need to count into the values".
10. **Render "findings: none" is weak**: it did not notice "0h 00m" / "0:00 – 0:00" (all numbers zero), nor that a chart canvas was 3 px wide at 160×96. Both are detectable (a text that formats to 0 from a non-zero variable; a canvas narrower than 8 dp).
11. **Minor:** the kit's `icons.suggestions` offered only "sleep"; I used `bedtime` blind and it existed. The format reference's `padding: [12, 6]` form (horizontal, vertical) is only shown in passing in the component guide's PriceTag example.

## 4. What I would have liked

- A one-line interpolation note on `pathExpression`, and a documented "step/bar chart from an array" idiom (loop + drawRect), or a `BarChart`/`StepChart` component that accepts an array and a per-bucket colour list.
- A check that the render's visible texts match the inspector's (or at least a finding when a textFromFloat shows 0 while its variable is not).
- check_component: render mono on the mono background; a 2× contact sheet; a `sweep` that accepts array values (my only varying input was an array, so sweep was unusable).
- build_kit: when the goal names a quantity with a range ("score"), list ProgressRing/Gauge in `components`; skip the astronomy examples when the goal has no clock dependency.
- publish: list exported float arrays as editable host variables; don't list named colour resources as host variables.
- An honest statement of which engine each tool runs (render = C++? inspect = TS) and the known divergences between them and Android.

## 5. Assessment of the final card

**What it shows.** A rounded surface card: moon icon + "Sleep", the hours actually asleep ("7h 00m", awake slots excluded), the in-bed span ("23:10 – 06:40"), a ProgressRing with the score, the hypnogram (one bar per slot, awake = top level orange, REM purple, light blue, deep indigo, all lowest-to-highest by level), and a legend with the four shares. Three layouts chosen by window size: normal (4x2, phone), short (height < 100: a single row hours | chart | ring, chart hidden below 200 dp wide), narrow (width < 200 and height ≥ 100: no title, 20 px hours, 44 dp ring). The legend shows only when the window is ≥ 240×140.

**Host variables** (all exported, sample values set): `stages` float array — one code per slot: **0 = deep, 1 = light, 100 = REM, 10000 = awake** (powers of 100, up to 99 slots, so one `arraySum` yields every count: awake = floor(S/10000), REM = floor(S/100) % 100, light = S % 100, deep = n − others); `slotMin` = 15 (minutes per slot); `sleepStart` = 1390 and `sleepEnd` = 400 (minutes since midnight, shown as H:MM); `score` = 82 (0..100, clamped). Hours slept = (slots − awake slots) × slotMin, computed. The encoding is unnatural for a host and exists only because the expression language has no per-element count; a natural 0..3 coding would need the host to also send the four totals.

**Correctness.** Verified in the renderer at: default night (7h 00m, 27/40/27/7%), a 3 h night with score 20 (2h 30m, 17% awake), a 10.5 h night with score 95 (42 slots), an awake-heavy night (3h 45m, 50% awake, score 41), score 100; percentages round individually so they can sum to 99–101. Arrays longer than 96 slots are clamped by the chart (extra slots are not drawn) but still counted; arrays over 99 slots break the count decoding.

**Sizes.** Rendered at 320×160, 512×120, 230×160, 320×96, 230×96, 160×96, 160×160, 320×80, 250×110 — no overflow findings, nothing clipped. Weak spots: at 250×110 the chart is ~22 dp tall (still readable); at 250×40 (the smallest 4x1 host) nothing was rendered — the short row would be 24 dp high and the ring label unreadable.

**Themes / mono.** Light and dark use themed stage colours defined in `resources.colors` (light/dark pairs; the audit did not flag them). Mono and mono-inverted: the Hypnogram switches to a 2 dp onSurface step line over four 1 dp grey level guides (readable by level alone), the ring is the library's mono variant, legend dots become white/black. No animation, no alpha washes.

**Accessibility.** Header contentDescription; the root box carries a live description "Slept 7 hours 0 minutes, in bed from 23:10 to 6:40. Sleep quality score 82 of 100. Deep 27%, light 40%, REM 27%, awake 7%." (verified by inspect accessibility); the chart canvas has its own label; every visible number is a layout text. Caveat: the description's correctness in the C++ player is untested (its texts are not exposed), and the collision workaround relies on duplicate variables.

**Bytes / runtime.** 11 919 B (.rc); 43% is expressions (the loop body evaluates 4 rects × 96 slots; 2 844 ops per paint). Repaint verdict idle: it paints only when the host changes data. The third layout cost ~2.7 KB; dropping it would wrap "7h 00m" at 2x2.

**Known weak spots.** The stage encoding; duplicated a11y variables; the hypnogram's 1 px anti-aliased seams between same-stage bars (mitigated with a 0.5 dp overlap); `log()` semantics on Android unverified (ratio form used); no time axis labels under the chart (bedtime/wake time are in the text instead).
