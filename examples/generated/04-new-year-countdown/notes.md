# Eval notes: "A countdown widget to New Year's Day with days, hours, minutes and seconds"

Working directory: eval/04-run2. Final document: widget.json. Page: page.html (local, nothing uploaded).
22 MCP calls through mcp-cli (plus one shell batch that failed on my side, a zsh quoting slip, no tool involved).

## 1. Every tool call, in order

1. `list remotecompose` — the server's instructions already carry the whole 5-step workflow. Decided to follow it: build_kit first.
2. `build_kit {goal}` — resolved time.countdown / time.clock / time.date / expr.format, no library component, no needs_component. Returned TIM-01 (clock fields), TIM-08 (launch countdown: the split days/seconds formula, the 24-bit float pitfall, "formula only works within one calendar year"), TIM-13 as the "layout model" (15 KB tide example, irrelevant here) and EXP-11 (flags). The design rules (theme colours, collapsibleColumn/fitBox for small sizes, "repeat by definition") shaped the plan. Decided: an inline tile component, remaining time computed from dayOfYear()/timeInMin()/timeInSec() with days and seconds kept separate.
3. `get TIM-08 (json, meta, pitfalls)` — the full JSON confirmed the structure (resources.variables for the remaining seconds, textFromFloat whole 2 flags 12) and that a local-midnight target needs no offsetToUtc(). Decided to not need UTC at all.
4. `describe reference` — learned the topics: workflow, format, expressions, components, tools.
5. `reference workflow` — identical to the server instructions from call 1. Wasted.
6. `reference expressions` — the key call: year(), dayOfYear() is 1..366, timeInSec() is seconds within the HOUR, no comparison operators (a == b is 1 - min(1, abs(a - b))), 32-entry limit. Decided the leap-year test and the "exactly midnight" correction with that idiom.
7. `reference components` — inline components under top-level `components`, static params fold, `$if` on a static param, locals. Decided on Unit (number + label) and later Fields.
8. `find components "number with a label tile stat kpi"` — StatTile exists but prints with flags 5 (no zero padding) and a label above; not the look I wanted. Decided to write my own 2-text tile.
9. `reference format` — fitBox rule ("only a child with an explicit size can fail to fit"), weighted children ignore spacedBy, weight does not combine with widthIn. Decided: weighted boxes without spacedBy.
10. `describe render` — learned `variants: true` and `clocks: [...]`. Decided to use both instead of one render per state.
11. `describe check_component` — sweep syntax.
12. `check_component Unit, sweep value [0,5,59,99,365]` — lint clean; 365 printed "65" with the default 2 digits (expected, so days get digits 3). The demo frame clipped "DAYS" vertically at 120x80 (its own padding 16 + spacedBy 12 eat 44 dp), a false alarm from the harness, not the component.
13. `convert check:true` — 2339 bytes, parses, info only (host-settable theme colours).
14. `render variants (r1)` — the values were right (61 d 09:54:51 at 2026-10-31 14:05:09); short dropped the title correctly; narrow and small clipped "061"/"SECONDS". Decided a fitBox with a compact tier.
15. `render variants (r2)` — fitBox tier 1 built with fillMaxWidth + widthIn min 290: the row got 0x56 and NOTHING rendered in any variant (zero_size + 8 clipped texts). Dead end.
16. `render clocks (c, 6 dates)` — fired together with 15 before seeing its result; all six images blank for the same reason. Wasted.
17. `render variants (r3)` — tiers with fixed widths 480 / 290 / wrap-content (`$if: "width"` in the component). Everything laid out; only "SECONDS" at 11sp clipped in the compact tier.
18. `render variants (r4)` — labelSize param, 9sp in the compact tier. All nine variants clean, no findings.
19. `render clocks (c2)` — 2026-12-31T23:59:59 → 000 00:00:01; 2027-01-01T00:00:00 → 365 00:00:00 + "Happy New Year!"; 2027-01-01T12:34:56 → 364 11:25:04; 2028-02-29T10:00 → 306 14:00:00 (leap); 2028-12-31T00:00 → 001 00:00:00; 2100-06-15T08:00 → 199 16:00:00 (not leap), title "2101". All correct by hand.
20. `audit` — 0 errors, 0 warnings, 0 info.
21. `publish output_path page.html` — 568 KB page, rc 3701 B, no upload.
22. `inspect runtime` — repaint "scheduled every ~1002 ms" (the second boundary), 87 ops per frame, constant. Good for a widget.

## 2. Dead ends and wasted calls

- Call 5 (`reference workflow`): duplicates what `list` already prints. The describe text for `reference` says "workflow (default)" which invited the call.
- Calls 15 + 16 (fitBox with `widthIn min`): the format reference says a fitBox child needs "an explicit size (height, or width)" to be able to not fit; I tried `widthIn` as the "explicit size" that would still fill wide layouts. The row collapsed to zero width, and because I batched the clocks render with it, that one was lost too. The render finding did point at "a weight does not combine with widthIn/heightIn", which is a different rule (the weights were inside the row, not on it), so the real reason (fillMaxWidth + widthIn on a fitBox child) was only a guess that I confirmed by abandoning widthIn.
- My own zsh slip (a `$CLI` variable with spaces) cost one bash round, no tool call.

## 3. Wrong, misleading, noisy or missing

- **Noisy**: build_kit returned TIM-13 (tide chart, 15 KB of forecast arrays and 8 snippets) as "the layout model" for a four-number countdown. About 60% of the 26 KB kit was that one example. EXP-11 was also mostly unrelated (grouping, parentheses).
- **Noisy**: check_component's demo frame (padding 16, spacedBy 12) at the width/height I passed (120x80) produced a text_overflow warning for the label that was an artefact of the demo, repeated four times (one per theme). The sweep sheet's captions overlap the tile's own label.
- **Misleading**: the zero_size finding's explanation lists three generic causes ("a weight shares what the others leave... a weight does not combine with widthIn... a collapsible layout drops...") none of which was the actual one (a fitBox child with fillMaxWidth + widthIn). It names the component ids (LAYOUT_ROW#-11 in FitBoxLayout#-9) which are not something I can relate to my JSON without an inspect layout call.
- **Missing**: the fitBox section says only an explicitly sized child can fail to fit, but does not say what that does to a child that should also fill the width when it is chosen (I ended with fixed 480/290 tiers, which is a hack: at 400 wide the 290 tier is centred with margins). A "fit this layout if at least N wide, otherwise the next one" pattern is the obvious need for a resizable widget and has no documented idiom.
- **Missing**: no statement about whether `timeInSec()`/the clock functions return integers (matters for `1 - min(1, @sod)` at exactly midnight) and about whether `%` is exact on floats; I relied on the pinned renders instead.
- **Missing**: the reference lists `year()` but nothing says dayOfYear() is in local time (it is, from the renders), nor how to pin the time zone for a local-midnight target; TIM-08's pitfalls are all about UTC targets, which steered towards offsetToUtc() that this task must not use.
- **Misleading** (minor): TIM-08's pitfall "the formula only works within one calendar year" reads as a warning against this exact task (a countdown that crosses the year boundary at the instant it ends), when in fact the formula is fine with a target of day 366/367 of the current year.
- `publish` reported `"variables": {}` and `"controls": true` but did not say what the controls are (light/dark/mono buttons? a clock scrubber?). Not harmful, but I could not verify the page without opening it.

## 4. What I would have liked

- A build_kit that, for a goal with no needs_component and a direct example match (TIM-08), skips the "layout model" example or returns it only as an id + one-line why.
- A short, authoritative "resizable widget" recipe in `reference format`: the one combination of fitBox / collapsibleColumn / weights that works for "big layout if wide enough, else compact", instead of three separate traps to assemble.
- `check_component` demo frame sized to the component (or no padding when width/height are given), and the sweep captions outside the cell.
- Findings that name the JSON path (`/root/box/children/0/collapsibleColumn/children/1/fitBox/children/0`) of the offending component, not a player-internal id.
- A `clocks` + `variants` combination, or at least a note on `variants` that "seven hours later" is the only date variant; I had to do the date edges in a separate call (fine, but I only found `clocks` by reading describe render).
- The expressions reference to state the integer-ness of the clock functions and the sign behaviour of `%` next to the time functions (it is stated at the very end in "Limits").

## 5. Honest assessment of the final widget

- **Correctness**: remaining time to the next local Jan 1 00:00:00 is `days = 365 + leap - dayOfYear() + 1 - min(1, sod)`, `secs = (86400 - sod) % 86400`, sod = seconds of the day. Days and seconds are kept apart so nothing exceeds 86400 in a float. Leap year is the full Gregorian rule (div4 and not div100, or div400), so 2028 gives 366 and 2100 gives 365 (both verified). At 23:59:59 on Dec 31 it reads 000 00:00:01; at exactly midnight on Jan 1 it flips to 365 (or 366) 00:00:00 for the following year and shows "Happy New Year!" for the whole of Jan 1; at Dec 31 00:00:00 it reads 001 00:00:00 (not 000 24:00:00). Verified at six pinned clocks. The title year is `year() + 1`, so it is never stale. The document repaints on the second boundary. The one thing I could not verify is behaviour across a DST change day (a 23- or 25-hour day): `timeInMin()` is local, so on that day the hours field counts a wall-clock day, which is what a user expects for a local-midnight target.
- **Small sizes**: three tiers in a fitBox (40sp at ≥480 wide, 36sp at ≥290, 24sp wrap-content with 9sp labels), the title dropped first by collapsiblePriority. All of dark/light/mono/mono-inverted/narrow 230x160/wide 512x120/short 320x96/small 230x96 render without findings. Weak point: between 290 and 480 wide the 290-wide tier is centred with empty margins instead of filling; at a width below about 206 the compact tier would clip (not among the variants, not checked).
- **Light/dark**: only theme colours (@colors.background/onSurface/muted/secondary/primary); both looked right.
- **Mono / mono-inverted**: pure text, so it is white on black and black on white with the one grey for labels; the accent title becomes white/black. Mono keeps the seconds ticking, which the component guide says to avoid on e-ink ("drop anything that ticks faster than once a minute"); a mono variant without the seconds tile would be the next improvement.
- **Size**: 3701 bytes .rc with the three tiers expanded (the tiles cannot be patterns because of the text trap U7); 2339 before the fitBox.
