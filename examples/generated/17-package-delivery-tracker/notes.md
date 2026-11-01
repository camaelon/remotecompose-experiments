# Eval 17 run 1 — package delivery tracker widget

Request: "A package delivery tracker: the steps (ordered, shipped, out for delivery, delivered) with the current one highlighted and the ETA."

Deliverables in this folder: `tracker.json` (source), `tracker.rc` (15,133 B), `tracker.html` (published playground, 716 KB), `tracker-long.json` (same document with "Out for delivery" replaced by "Awaiting customs clearance", for the long-label check), `out/*.png` (renders), `*.txt` (every tool output).

Tool calls counted = `call` invocations (the CLI `list` and `describe` are not counted; 3 used: list, describe get, describe render).

## 1. Tool calls in order (25)

1. `build_kit` (goal verbatim) → resolved "delivery tracker"/"steps" to the library `Steps` component (exactly the thing asked for: dots, connectors, done ticks, current halo, `current` bound to a host float), plus `Icon`, examples CMP-05 (layout model), TIM-08 (countdown, for "eta" → `time.countdown`), design rules. Decided: use `Steps` for the dots; ignore TIM-08's countdown (an ETA is a date/time, not a countdown); ETA representation = `etaDay` (day of year) + `etaMin` (minutes of day), since the kit/expression docs say `epochSecond()` is unknown to the Android parser and floats lose seconds.
2. `reference format` → document skeleton, host strings as a root-level `variable` command, visibility must be a declared 0/1 variable, textMerge/textFromFloat flags, `stateLayout`, `collapsibleColumn` priorities, the weight+spacedBy trap, `system_variables {"10": 0}`.
3. `reference expressions` → no comparisons (step/ifElse with condition LAST), the calendar recipe (leap, month from day-of-year via two step() sums, `before`, day), 32-entry limit. Took the recipe wholesale.
4. `get Steps` (no parts) → params/pitfalls again (same as the kit), no JSON. Wasted (see §2).
5. `get Steps parts:[demo_json]` → a full demo document: header, `resources.variables {"stage": {"value": 2, "export": true}}`, the Steps call. Copied the shape.
6. `get TIM-08 parts:[json]` → a widget-sized header (360x180) and textFromFloat usage with flags 12 (zero-padded). Used for HH:MM.
7. `get TextChoice` → items/index/fontSize/fontWeight/maxLines/overflow; a11y reads only the visible item; the padded-string + textSubtext trick for long lists. Used TextChoice for the current step name and the "Expected/Arriving/Delivered" prefix.
8. `reference components` → inline `components` object syntax, params (float/color), `@param` splicing. Used for the inline `EtaText` component.
9. `get TIM-11 parts:[json,meta]` → the exact `global` block syntax: `{"textSubtext": {"text", "start", "len", "varName"}}` in a `{"size": 0}` canvas; a layout text can then use `"@varName"`. Used to cut the month name from "JanFeb...Dec". 34 KB of output for 300 bytes I needed.
10. `convert check:true` (v1) → ok, 11,294 B, one warning `component_overflow`: the ETA box past the header row's right edge by 32 px (weighted spacer + spacedBy). Fixed by removing the weight.
11. `render variants:true` (v1, clock 2026-10-31T10:00) → 11 captioned images (dark, light, mono, mono-inverted, narrow 259x180, wide 576x135, short 360x108, small 259x108, tiny 180x108, square 180x180, 45 days later), "findings: none" everywhere. Looked at the files: 4x2 top-heavy (empty bottom third), 259x108 ETA text ellipsized against the status.
12. `render samples` (stage 0..3 with ETA +3 days / tomorrow / today / today) → all four states right: "Expected 3 Nov, 17:00", "Expected tomorrow, 09:00", "Arriving today, 14:30", "Delivered today, 10:55".
13. `convert check` (v2) → ok, 11,349 B, no overflow.
14. `audit` (v2) → clean, longest expression 23/32 entries.
15. `inspect accessibility` (v2) → nodes: "Out for delivery", "Arriving", "2 Nov, 14:30", "Step 3 of 4" (Steps' own description), the four labels, the tracking number. Current step and ETA are announced.
16. `render variants` (v2) → 4x2 now vertically centred; 259 wide still ellipsizes the status ("Out for d…").
17. `render variants` (tracker-long v2) → at 360x108 the whole Steps row was DROPPED by the collapsibleColumn (only the header line remained) and the tool said "findings: none". Decided to add a dedicated wide-short layout.
18. `convert check` (v3, three layouts via `stateLayout` index `@wide * (1 + @short)`) → ok, 15,133 B.
19. `render variants` (v3) → all sizes keep status + dots + ETA; 259x108 still ellipsizes the status (not a standard widget size; accepted).
20. `render variants` (tracker-long v3) → 4x1 keeps dots + status + ETA; 2x2 status wraps to two lines, second line ellipsized "custo…".
21. `audit` (v3) → clean (info only, 23/32 entries).
22. `publish` → `tracker.html` (716 KB playground, variables etaDay/etaMin/stage/tracking editable).
23. `render samples` clock 2028-03-01 (leap year): etaDay 60 → "29 Feb, 01:00", 61 → "today, 23:59", 366 → "31 Dec, 00:00". Correct.
24. `render samples` clock 2026-03-01, 180x180: etaDay 60 → "today" (1 Mar in a common year). Correct.
25. `inspect bytes` → 15,133 B: 40 % variables/expressions (131 float expressions: three Steps instances each carry their per-dot alpha expressions), 19 % draw, 16 % text, 785 B icon path.

## 2. Dead ends and wasted calls

- Call 4 (`get Steps` without `parts`): returned the same params/pitfalls as `build_kit`, with `"renders": [...]` names but no JSON and no demo. The tool description says a component get gives "its call, params and pitfalls" — true, but I expected the demo document. I had to CLI-describe `get` to discover `parts: ["demo_json"]`. Avoidable if `build_kit`'s component entry said "demo JSON: get {name, parts: [\"demo_json\"]}" the way example entries say "the full JSON: get CMP-05".
- Call 9 (TIM-11, 34 KB) to learn a 1-line syntax (`textSubtext` in a `global` block with `varName`). The TextChoice pitfall describes the trick in prose ("a 0-size canvas whose `global` section holds textSubtext (start ..., len 9, varName dayName9)") but not the JSON; `reference format` lists `global {commands}` and the op names without their keys. One JSON line in either place would have saved the call.
- Calls 10→13 (overflow): the format reference does warn "weighted children ignore spacedBy", but I read it as a spacing issue, not as "the weighted spacer pushes the last child out of the row". A first-time reader needs the consequence spelled out.
- Calls 16/17→18–20 (the collapsibleColumn silently dropping the Steps): the design rule says a child without priority is "dropped last, only when they don't fit on their own", which is exactly what happened; I just didn't anticipate 3-line labels at 4x1. Not a tool fault, but the render reporting "findings: none" when the document's main component was collapsed away is (see §3).
- `build_kit` pointed me at TIM-08 (countdown) for "eta". A countdown is not what an ETA display needs; its only useful part was a widget header and a textFromFloat. Harmless, but 2 KB of kit was off-target.

## 3. Wrong, misleading, noisy or missing in the tools' output

- **Render variants / samples report "findings: none" when content is dropped.** For tracker-long v2 at 360x108, the collapsibleColumn removed the Steps row and the tracking number; the widget showed only "Awaiting customs cle… Arriving 2 Nov, 14:30". The render description promises findings for "a component past its box" and the design rule says "Check with render variants (it includes a short size and reports overflow)" — but a collapse is not overflow, and nothing flags "N children of a collapsibleColumn were dropped at this size". The same silence for ellipsized text: `maxLines: 1, overflow: ellipsis` cut "Out for delivery" to "Out for d…" in several variants with "findings: none", although the description says it reports "text cut off or losing lines to maxLines". Either the ellipsis case is not counted as cut off, or it is and the finding is not surfaced for variants.
- **`get` of a component returns no JSON by default** and the output lists `"renders": ["default","light","dark","mono","mono-inverted"]` (names only, nothing attached) — noise that suggests images were returned. The `parts` option for components (`demo_json`, `render`) is documented only in the schema.
- **build_kit's `resolved.use_cases: ["fitness"]`** for the word "steps" (step count) — harmless mis-resolution but it shows in the output and could pull fitness examples in on another goal.
- **build_kit's example list for this goal** was CMP-05 (a contacts list) and TIM-08 (a countdown). Neither is a widget with host-driven status, neither shows a host string, neither shows `stateLayout`/`collapsibleColumn`, which the design text says to use. The design rules reference LAY-09/13/14/15 and HST-01 by id but do not include them; a goal with "tracker"/"ETA" would have been better served by a host-variables widget example than by a contacts list.
- **`"a11y.labels"` under Steps**: the component's default description is "Step N of M" and its `label` param is a static string, so there is no supported way to announce the step's NAME from the component; the pitfall says why (Java parser U4). It should say what to do instead (a visible TextChoice beside it, which is what I did).
- **Format reference, visibility**: "An expression written inline is an INTEGER expression ... 'step(@days, 0.5)' is not one, becomes a text id and hides the component" — good trap text, but then it does not say whether `1 - min(1, abs(@dayDelta))` as a declared float variable is "exactly 1 or 0" enough. It worked; the TextChoice pitfall ("the player stores a float as its truncated int") explains why, in a different place.
- **Noise**: `reference format` and `expressions` are returned with an `Exit code 1` wrapper from the CLI when output contains certain characters (my `echo =====` separators in the same shell line triggered zsh glob errors, not the tool; noted only so the `*.txt` files are not misread). `convert check:true` dumps the full `namedVariables` list including every theme colour (muted, onPrimary, ...) under host variables — those are not host-settable in the sense a new user expects; the `host_variables` info line above it is the right summary.
- **`render` description**: "a single render is DARK unless theme: 'light'" — true, and the samples came out dark; fine, but the captions on `samples` images do not say which theme they are.
- **Nothing tells me what 4x2 / 4x1 / 2x2 are in dp.** The variants picked 360x180, 360x108, 180x180 (and the caption "square 180x180 (a 2x2 cell)"), which is the only hint. A one-line table of widget cell sizes in `build_kit`'s design section would remove guesswork.

## 4. What I would have liked

- A `widget_sizes` table (4x1, 4x2, 2x2 in dp, min/max) in `build_kit` for any "widget" goal, and a `render` option `widget: ["4x2","4x1","2x2"]`.
- A finding in render/variants: "collapsibleColumn dropped children [Steps, tracking] at 360x108" and "text ellipsized: 'Out for delivery' → 'Out for d…'".
- `build_kit` to attach the demo JSON of the top component (or at least the `get ... parts: ["demo_json"]` hint), and one snippet per design-rule reference (HST-01 host string, LAY-15 stateLayout) instead of ids.
- A ready "date from a host value" recipe as JSON (the expression reference has it in prose; I transcribed 13 variables by hand). A `DateText`/`EtaText`-style library component taking a day-of-year + minutes (or epoch) would make this a two-line widget.
- An a11y option on Steps to announce the current step's name (even as a list of static strings switched by visibility inside the semantics node).

## 5. Honest assessment of the final widget

- **Correctness**: four steps drawn by `Steps` (done = filled tick, current = halo, to-do = outline; mono uses shapes), the current one highlighted; status word, "Expected / Arriving / Delivered" prefix, ETA as "today, 14:30", "tomorrow, 09:00" or "2 Nov, 14:30" (24 h, zero-padded). Verified at all four stages, ETA today/tomorrow/+3 days, leap day (29 Feb 2028), 31 Dec, 1 Mar in a common year.
- **Host variables**: `stage` (float, 0–3, sample 2), `etaDay` (float, day of year 1–366, sample 306 = 2 Nov 2026), `etaMin` (float, minutes of day 0–1439, sample 870 = 14:30), `tracking` (string, sample "1Z 999 AA1 0123 4567"). Documented in the header description and visible in `convert`'s host_variables line and the playground.
- **Sizes**: 4x2 (360x180) full layout: icon + bold status, labelled steps, ETA line, tracking. 4x1 (360x108, any height < 120 with width ≥ 240): status + ETA in the header, dots only, tracking. 2x2 (< 240 wide): icon + status (2 lines), dots only, ETA line, tracking, spaced over the height. 576x135 and 180x108 also fine. 259x108 ellipsizes the status to "Out for d…" (acceptable, nonstandard size).
- **Themes / mono**: only `@colors.*`; light, dark, mono (white dots on black, state by shape) and mono-inverted all render cleanly.
- **Accessibility**: header description; readable nodes for the current step name (TextChoice, only the visible item), "Arriving", the ETA text (one node per form), "Step 3 of 4" from Steps, the labels and the tracking number. Weak spot: the step name and "Step N of M" are separate nodes; the ETA is two nodes ("Arriving" + "2 Nov, 14:30").
- **Byte size**: 15,133 B (.rc). Three `Steps` instances (one per layout) are the main cost (~40 % is expressions); a host that only needs 4x2 could keep one layout at ~11 KB. Longest expression 23/32 entries. No hard-coded colours, dates or glyphs (audit clean).
- **Known weak spots**: (1) `etaDay` is a day of THIS year; an ETA in January while today is December shows the right "2 Jan" text but "today/tomorrow" checks fail across the year boundary (no `etaYear`). (2) Month name is a 3-letter English abbreviation, time is 24 h; no locale. (3) A very long step label at 2x2 shows "Awaiting / custo…"; at 4x2 it wraps to three lines under the dot, which pushes the ETA line down but still fits. (4) The 259x108 status ellipsis. (5) The ETA past its time (late package) shows the same text; no "late" state was asked for.
