# Transit departures board: notes (run 2)

Files: `gen.py` (generates `board.json`), `board.json` (final document), `board.rc` (11,824 B),
renders `final-*.png` (variants at 08:55), `r1_clocks-*`, `r4_midnight-*`, `r5_sizes-*`, `r6_live.png`, contact sheets `sheet_*.png`,
saved tool outputs `*.txt`. `rc.sh` is a wrapper around `mcp-cli.mjs call remotecompose`.

Host contract:
- `stop` (string), `line1..5`, `dest1..5` (strings), `line1Color..line5Color` (colours, the badge colour per slot).
- `dep1..5` (float): scheduled departure in **local minutes of the day, 0..1439** (08:55 = 535). **-1 = empty slot.**
- Minutes until = `(dep - timeInMin() + 2160) % 1440 - 720` (a ±12 h window, so a 00:05 departure seen at 23:55 is +10, and a 23:50 one seen at 00:05 is -15 = gone).
- Displayed: d >= 2 -> "d min"; d = 1 -> "1 min"; d = 0 (during the departure minute) -> "now"; d < 0 -> row hidden. "No more departures" when all five are hidden/empty.
  Decision: minute resolution (timeInMin) so the document repaints once a minute, not every second. "now" therefore means
  "in the scheduled minute" (0–59 s after hh:mm:00); "1 min" covers the last 60 s before it. Noted as a deliberate approximation.
- The app is expected to send departures sorted.

## 1. Tool calls (24)
1. `list` — server overview + workflow. Took: build_kit first, convert/render/audit loop, render `clocks`/`samples`/`variants`.
2. `build_kit` (verbatim request) — got Icon, TIM-12 (sunrise, as layout model), DOC-03 (fps dot), icon suggestions (`directions_bus`, `departure_board`), design rules. Took the bus icon, the "compute what depends on now" and "adapt to size / collapsibleColumn / stateLayout" rules. Nothing about lists, host strings or visibility.
3. `find` examples "transit departures list rows countdown host strings" — HST-05 (transit use case), HST-07, LAY-12, EXP-15, CMP-14. Picked HST-05 as the only transit hit.
4. `get HST-05` — canvas-only ambient-light demo with literal colours. Useless for this goal (dead end).
5. `reference format` — the core: host strings as root `variable` commands, exported floats, visibility needs a declared 0/1 variable, textFromFloat/textMerge flags, semantics, collapsibleColumn, stateLayout, widget sizes. Decided the whole structure from this.
6. `reference components` — inline components, params types, locals (expressions become resources variables), `$if theme.mono`. Decided a `Departure` inline component with locals isNow/later.
7. `reference expressions` — timeInMin() is whole minutes 0..1439, step(x, edge), % keeps sign. Decided the +2160 % 1440 - 720 wrap.
8. `convert` (check) v1 — OK, 7.2 KB, host variables listed.
9. `render` clocks 08:52/08:55/08:56/09:30 (light) — countdown, "now", gone, all-gone message correct.
10. `render` variants — dark onPrimary text on line colours unreadable; short heights overflow (zero_size + text_overflow warnings, good); 2x2 squeezes destinations to "Cen…". Decided: own `onLine` white colour, collapsibleColumn with priorities, stateLayout compact layout for narrow.
11. `convert` v2 — OK 10.8 KB.
12. `render` variants v2 — no findings; 4x1 showed only 1 row (tight padding). Reduced padding.
13. `render` clocks around midnight with variables (23:50, 23:58, 00:05, 00:15, empty 5th slot) at 23:49 / 23:55 / 00:05 / 00:16 — all correct, empty slot just absent.
14. `audit` — clean (0 findings).
15. `inspect accessibility` — row label + badge + destination read twice; "in 1 minutes". Decided per-text semantics instead of row semantics, and a 1-minute variant.
16. `reference query` "semantics merge descendants hide" — no merge/hide option exists in the docs (partial dead end).
17. `inspect accessibility` v2 — reads "Line 42", "to Central Station", "in 1 minute" / "departing now". Good.
18. `render sizes` 320x160, 320x80, 160x160, 380x230, 250x110 — 4x1 now 2 rows; 250x110 went compact (2 rows); lowered stateLayout threshold to 200.
19. `inspect runtime` — repaint "scheduled", every minute boundary, 5 timeInMin listeners. Live updating confirmed.
20. `render` clock 08:56:01 duration 3 — simulated across the minute: line 42 gone at 08:56. Live transition works.
21. `render` variants final at 08:55 with dep5 = -1 — all looks/sizes clean.
22. `convert` final — 11,824 B.
23. `audit` at 160x160 — clean.
24. `inspect bytes` — text 25%, expressions 19%, the bus Icon path alone 1.86 KB (16%).

## 2. Dead ends / wasted calls
- Call 4 (get HST-05): find ranked it first purely on the "transit" use case tag; it is a canvas demo with literal colours whose own note says "take the technique, not the structure". A find that ranked by structure (list of rows, host strings) would have avoided it.
- Call 16 (reference query for semantics merge): no such feature documented; I had to invent the per-text labelling workaround. A sentence in the accessibility paragraph on "how to make a row read as one item" would have avoided it.
- (Not a tool call) first shell attempt failed because zsh doesn't word-split a `$C` command variable; fixed with a wrapper script.
- Calls 10 and 12 were not wasted but the first variants run would have been avoidable if build_kit had given a list-row example with collapsible priorities.

## 3. Wrong, misleading, noisy or missing
- build_kit for this goal is weak: "line" resolved to `capability:draw.shapes` and "minute" to `time.clock`; "destination" and "board" unmatched; the examples were TIM-12 (sun path astronomy) and DOC-03 ("A dot that slides across a track every 2 s") — neither shows a list of rows, host strings, a per-row visibility or a countdown. No `needs_component` for the line badge or departure row although the goal clearly needs one. The `layout_model` TIM-12 is a 16 KB astronomy document.
- find's top transit example HST-05 is canvas-only with "#FF..." literals — contrary to the kit's own design rules.
- The kit's rule "Sample values show the design: pick values that show the design populated" conflicts with absolute-time host data: at any wall clock other than ~09:00 the default document shows "No more departures". No guidance on this (e.g. relative sample data, or that previews need a pinned clock). The "seven hours later" variant just shows the empty state, silently.
- Theme `onPrimary` is dark in dark theme; using it on host line colours (mid-tone brand colours) gives unreadable badges in dark. Nothing in the docs or the audit warns about text on a host colour; I had to define a literal `onLine` white, which the audit did NOT flag as hardcoded (fine for me, but inconsistent with "hardcoded_colors").
- convert's `host_variables` finding lists every named colour, including my constant `onLine` and the line colours, as "Host-settable" — noisy; there's no way to mark a colour as not exported.
- The accessibility docs give no way to merge a row or hide a decorative child; a row label plus child texts is read twice (I only saw this through inspect accessibility).
- textFromFloat has no plural handling (expected), but nothing mentions the "1 minutes" trap; I needed a third visibility branch.
- `profiles: 513` in the header is never explained.
- convert output via the CLI is two JSON objects back to back (`{"rc_path":...}` then the report) — breaks a naive json.load.
- Minor: `reference format` says a visibility expression written inline is an integer expression, but does not say whether a component **local** counts as "declared"; it does (it worked), but I had to try it.

## 4. What I would have liked
- A list/board example (rows from host strings + host times, hidden when gone, compact/wide) in build_kit for "transit/departures/schedule"; a library `ListRow`/`Badge` that takes a host colour and picks a contrasting text colour.
- A documented recipe for "minutes until a host time-of-day", with midnight wrap and the second-vs-minute resolution trade-off.
- Accessibility: a `mergeDescendants`/`invisibleToUser` semantics option, or a stated recommended pattern for list rows.
- A way to say a named colour is not host-settable; a warning for text on host colours with a theme text colour.
- render variants that take the clocks list too (themes x clocks in one sheet), and a combined contact sheet image rather than N files.

## 5. Honest assessment
- Correctness: countdown, "now", gone-hiding, empty slots and the all-gone message verified at 08:52, 08:55, 08:56, 09:30, and around midnight (23:49, 23:55, 00:05, 00:16) with departures straddling 00:00. Window is ±12 h, so a departure more than 12 h away would be read as past (acceptable for a "next 5" board).
- Live updating: timeInMin-driven, repaint scheduled at each minute boundary (inspect runtime); a simulated run across 08:56:00 removed the departed bus.
- "now" semantics are minute-resolution (see contract above), not true "under 60 s".
- Host variables: 21 (stop, 5 lines, 5 destinations, 5 times, 5 badge colours). Sorting is the app's job; a gone departure frees its row and the rest move up.
- Sizes: 4x2 (5 rows), 4x1 (header + 2 rows, rest dropped by collapsible priority), 2x2 and anything < 200 dp wide uses a compact two-line row (4 rows at 160x160), phone card 380x230 shows all 5 with empty space below (top-aligned; could be nicer). No overflow findings at any variant size.
- Themes: light/dark via theme colours; badge colours are host colours with white text (fine on mid-tone colours, would fail on a pale colour the app sends). Mono-dark/mono-light: badges become filled primary with onPrimary text; "now" is only distinguished by the word (no colour) — acceptable.
- Accessibility: each departure reads "Line 42", "to Central Station", "in 3 minutes"/"in 1 minute"/"departing now"; three nodes per departure rather than one merged item. Header contentDescription set.
- Bytes: 11.8 KB; the stateLayout duplicates the 5 rows (two copies), and the bus icon path is 1.86 KB. Audit clean at 320x160 and 160x160.
- Weak spots: default/preview at an arbitrary wall clock shows the empty state; minute-resolution "now"; no merged row semantics; host colour contrast not guaranteed.
