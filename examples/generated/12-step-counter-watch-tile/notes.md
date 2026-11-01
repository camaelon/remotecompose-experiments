# Step counter watch tile — eval notes (prompt 12, run 1)

Request: "A step counter watch tile: today's steps against a 10,000 goal as a ring, and the last 7 days as bars."

Final document: `steps-tile.json` (= `steps3.json`), binary `steps-tile.rc` (3881 bytes), playground `steps-tile.html`.
Renders in `out/` (v1_*, v2_*, v3_*). Raw tool outputs in `c*.txt`, `kit.txt`, `get_*.txt`, `ref_format.txt`.

26 tool calls (plus the `list` of the CLI, not a tool). 1 dead end (call 6).

## 1. Tool calls in order

| # | tool | for | took / decided |
|---|------|-----|----------------|
| 1 | build_kit (goal verbatim) | starting point | Components ProgressRing + BarChart; STR-10 (a steps widget with an exported `steps` variable) is the one relevant example. "watch" and "tile" are unmatched terms, so no watch/round-form-factor guidance. INT-01 (tap counter), TIM-08 (countdown, picked as "layout model") and TIM-03 (date card) are noise matched on "counter"/"today"/"day". Decided: ring = ProgressRing (showLabel off, my own texts in the centre), bars = BarChart with fill, host floats via `export: true`. |
| 2 | get ProgressRing (definition) | how it scales, mono | Scales to min(w,h) of its box, has a mono branch, animated local `pa` with a 0.3 s ease. Progress is not clamped: I clamp it myself. |
| 3 | get BarChart (definition) | array syntax, mono | `values` is "@name" of `resources.floatArrays`; `fill: true` needs a sized parent; mono draws outlines; labels are static strings (so no computed weekday labels). |
| 4 | reference format | JSON essentials | visibility needs a declared 0/1 variable; `width`/`height` accept "@variable"; semantics modifier syntax; textFromFloat flags. Did not say how to declare an exported float array. |
| 5 | get STR-10 (json, pitfalls) | host variable syntax | `resources.variables.steps = {"value": 7420, "export": true}`; flags 21 gives "7,420". |
| 6 | convert check v1 | validate | FAILED: `{"size": ["@barW","@barH"]}` "expected a number ... this field takes no expression". Dead end. |
| 7 | convert check v1 (width/height modifiers) | validate | OK, 2789 bytes; host variables goal, steps, week (float_array) reported. My guessed `floatArrays.week = {"value": [...], "export": true}` worked. |
| 8 | render variants v1 | all themes/sizes | 9 PNGs, no findings. Dark/light/mono/mono-inverted, narrow, wide, short, small, tiny all readable. Wide wastes its width (ring + bars stacked in the middle). |
| 9 | render 192, steps=0 | sample value | Text "0" and "10,000 to go" right, but the RING STILL SHOWED 74%. |
| 10 | render 160, steps=12345, week with a 0 and a 15000 | sample value | "Goal reached" shown, bars right (zero bar, tall bar), ring still 74%. |
| 11 | render 220 light, steps=9990 | watch size | Fits; ring still 74%. |
| 12 | render 360×180 | widget size | Fits, but ring+bars stacked narrow in a wide box. |
| 13 | render 192 steps=0 duration 1 | settle the ring | Correct: empty track. Diagnosis: ProgressRing's 0.3 s ease starts from the document's sample value and the render captures frame 0 of the override. |
| 14 | render 160 exceeded duration 1 | settle | Correct: full ring, Goal reached, zero + tall bars. |
| 15 | convert check v2 (stateLayout on aspect ratio, RingBlock inline component) | validate | OK, 3763 bytes. `stateLayout` driven by `wide = clamp(0,1,floor(windowWidth()/(windowHeight()*1.5)))` converts. |
| 16 | render variants v2 | all looks | No findings; wide 307×144 now uses the row layout. |
| 17 | render 360×180 light v2 | widget | Row layout: ring left, bars right. Good. |
| 18 | audit v2 192 | problems | 0 findings. |
| 19 | inspect accessibility v2 | a11y | Document description, ring box label, two texts, bar chart label; hidden "Goal reached" correctly absent. |
| 20 | convert check v3 (caption "Last 7 days" in the wide layout) | validate | OK, 3881 bytes. |
| 21 | render variants v3 | all looks | No findings. |
| 22 | render 192 mono, exceeded, duration 1 | mono + state | Full white ring, outlined bars, zero first bar. Good. |
| 23 | inspect summary v3 | bytes, repaint | 3881 bytes, repaint "idle", audit clean, "dead_orphans: 2" (unexplained). |
| 24 | inspect variables only_unused | what the orphans are | Lists 4 theme colours (background, outline, primary, track) as `unused: true` while each has `consumed_by_ops` with 3-5 ops. False positive / contradictory. |
| 25 | render 220 light steps=9990 duration 1 | watch size settled | Ring at 99.9%, "10 to go". Good. |
| 26 | publish v3 | playground | `steps-tile.html` (565 KB). Its `variables` lists only goal and steps: the `week` float array is not editable in the playground. |

## 2. Dead ends and wasted calls

- Call 6: `{"size": ["@w","@h"]}` with variables. The BarChart definition itself uses `{"size": ["@width","@height"]}` (params, folded to literals at expansion), and the format reference says "width/height accept a "@variable"" without saying `size` does not. One sentence in the reference ("`size` takes numbers only; use width/height for variables") would have avoided it.
- Calls 9-12 (four renders) gave a misleading ring and had to be repeated with `duration: 1` (13, 14, 25). Not entirely wasted (texts, bars and layouts were verified), but the ring check was. The render tool should either settle animated locals when `variables` are overridden or say in its findings that an animated value is mid-ease.
- Call 24 was spent chasing "dead_orphans: 2" from the summary, which turned out to be noise.

## 3. Wrong, misleading, noisy or missing in the tools' output

1. **Render with host `variables` shows the ring's eased starting value.** No finding, no warning. The three value checks (0, exceeded, near goal) all showed a 74% ring with "0" / "12,345" in the middle: a contradictory image that a new user would take as a bug in their document. The ProgressRing pitfall does say "a change eases over 0.3 s", but nothing links that to `render ... variables`. Fix: render should advance past animated locals when variables are set (or document `duration` next to `variables`: "to see the settled value of an animated component, pass duration").
2. **`size` modifier rejects variables, format reference implies otherwise.** Quoted: "width/height accept a "@variable"". Error text: `expected a number, got "@barW" (this field takes no expression)` — the error is clear, but the reference should list which modifiers take variables.
3. **Exported float array syntax is nowhere.** BarChart says "export it to let the host replace the data" and the kit said "host.variables" for STR-10, but no example or reference shows `floatArrays: {"name": {"value": [...], "export": true}}`. I guessed; it worked. The format reference does not mention floatArrays at all.
4. **build_kit example noise.** "counter" matched INT-01 Tap counter (a +1 button), "today"/"day" matched TIM-03 Date card and TIM-08 Launch countdown, which was then named the `layout_model` ("Structure the screen like this") although a countdown's three centred text lines have nothing to do with a ring and bars. Only STR-10 was useful. `unmatched_terms: ["watch", "tile"]` is honest, but the kit then gives no form-factor advice (round safe area, always-on) for exactly the words that mattered.
5. **Design rule contradicts what works.** "a StateLayout switches on a host value, not on the size (LAY-15)". A stateLayout whose index is `clamp(0,1,floor(windowWidth()/(windowHeight()*1.5)))` converts, renders and switches by aspect ratio in every tool, which is what a widget/watch tile needs (fitBox thresholds are heights only, which cannot tell 360×180 from 192×192). The rule should say this is possible.
6. **inspect variables `only_unused` reports consumed theme colours as unused.** `background`, `outline`, `primary`, `track` listed `unused: true` while each has `consumed_by_ops: [...]`. The summary's `dead_orphans: 2` does not say which variables and the count (2) does not match the 4 listed.
7. **inspect lists theme colours as `host_variables`.** `background`, `muted`, `onSurface`... appear next to `goal` and `steps` under `host_variables`, and `week` has `"value": null` there while convert reports its 7 values. The convert `host_variables` finding is the clean one.
8. **publish's `variables` omits the float array.** `{"goal": "float", "steps": "float"}` only; the playground cannot edit `week`, and the result does not say so.
9. **inspect accessibility shows `"text": "i"` for the BarChart's CanvasContent** (the loop index name leaking as a text). Harmless but confusing.
10. **No round-watch preview.** `render variants` covers narrow/wide/short/small/tiny but not a circular mask or a safe-area check; I verified the inscribed circle by hand from the accessibility bounds (bars box corner at 92 dp from centre on a 96 dp radius: inside, barely).
11. **Format reference spells the node `statelayout`** in the component list and the design rule spells it `stateLayout`; the camelCase one worked. Minor.
12. **`list` text says `rc-examples`, `rc-render`, `rc-inspect`, `json2rc` servers exist** with overlapping tools; told to use only `remotecompose` I ignored them, but a new user would not know which to pick.

## 4. What I would have liked

- A `form_factor: "watch"` (round) hint in build_kit: safe inset for a circle, always-on/mono as the default, a round-mask render variant.
- Render: a "settled" option or automatic settling when `variables` is passed, and a finding when an animated value is mid-transition.
- The format reference: a one-line table of which modifiers accept `@variables` (padding, width, height yes; size no) and the `floatArrays` export syntax.
- build_kit: fewer, better-ranked examples (STR-10 alone would have done), and a layout_model that resembles the goal.
- publish: list the float arrays among the editable variables, or say they are not editable.
- An explicit statement in BarChart's doc that labels cannot be computed (so "last 7 days" cannot carry weekday letters).

## 5. Assessment of the final tile

- **Correctness.** Ring = `clamp(0,1,@steps/@goal)` via ProgressRing (scaled to its box); centre shows `steps` (thousands separator) and "N to go", replaced by "Goal reached" (success colour) when `floor(@steps/@goal) >= 1`. Bars = BarChart over the exported `week` array (0..max scale, zero day draws nothing, tallest day sets the scale). Verified at 7,420 / 0 / 9,990 / 12,345 and with a week containing 0 and 15,000.
- **Host variables.** `steps` (float), `goal` (float, default 10000), `week` (float array of 7), all `export: true`; convert reports all three.
- **Watch sizes.** 160, 192, 220 square checked; layout is proportional to min(window) (padding 11%, bars 56%×18%, font 13%/6.5%) so every size is the same picture. Everything stays inside the inscribed circle (bars corner at ~92 of 96 dp radius at 192: tight; a 1-2 dp shave of `barH` would add margin). Rectangular 360×180 and 307×144 switch to ring-left / bars-right with a "Last 7 days" caption via a stateLayout on aspect ratio ≥ 1.5.
- **Themes and mono.** Only `@colors.*`; light, dark, mono (white ring on black, outlined bars) and mono-inverted all rendered. Mono ring jumps instead of easing (component pitfall, fine for always-on).
- **Accessibility.** Document description, ring box labelled, bar canvas labelled, step count and status are readable text nodes; hidden alternative absent from the tree. The ring's value is not in its label (the text next to it carries it).
- **Bytes.** 3881 bytes (.rc); repaint idle (no continuous animation). 44% is expressions, mostly from the two layouts each carrying their own component instances.
- **Weak spots.** (a) When the host sets `steps`, the ring eases from the sample 7,420 for 0.3 s on first draw. (b) No weekday labels under the bars (component labels are static strings). (c) Bars scale 0..max only, so a goal line is not drawn; "very high day" dwarfs the others by design. (d) The two layouts duplicate the ring and chart instances (~1.1 KB). (e) Round safe area verified by arithmetic, not by a round render. (f) Playground cannot edit `week`.
