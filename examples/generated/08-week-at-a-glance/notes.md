# Week at a glance — eval notes (run 3)

Request: "A "week at a glance" widget: the seven days of this week with today highlighted and the week number."
Clock during the run: 2026-10-31 (Saturday). Decisions I made without asking: ISO weeks (Monday first,
ISO week number — the only week numbering the tools document); English short day/month names; a
month + year label in the header so the user knows which month the highlighted day is in.

## 1. Tool calls, in order (27)

1. `list` — servers and tools. Took the workflow (build_kit → check_component → convert check → render → audit → publish). Decided to follow it literally.
2. `build_kit` (goal verbatim) — resolved to `time.date` + `widget`; one component (Icon), three examples (TXT-10, TIM-03, TIM-13 as the "layout model"), `not_covered: calendar arithmetic (see reference expressions, Calendar)`, no `needs_component`. Took: textLookup is json2rc-only (so avoid it), TIM-13's structure, pointer to `reference expressions`. Decided to build cells as an inline component and the week number from the reference formula.
3. `reference expressions` — the ISO week formula, days-in-month / leap formulas, "Monday of this week: dayOfMonth() - weekDay() + 1", the 32-entry limit, `ifElse(whenFalse, whenTrue, cond)`. Decided the whole variable set from this.
4. `reference format` — document skeleton, fitBox rules (exact heights as thresholds, minimum widths), weights ignore spacedBy, `textFromFloat`/`textMerge` exist (no syntax), visibility takes integer 0/1 expressions.
5. `reference components` — inline `components` block, params/locals/body, `$if theme.mono`, `semantics`? (not mentioned), mono rules (few lit pixels, ring instead of fill). Decided: Panel with a mono ring, DayCell with locals.
6. `get TextChoice` — layout-text choice by index, ~90 B/item. Kept in reserve.
7. `get DateLabel` — a canvas date; a11y label is static ("Date"). Used it in rounds 1–2, replaced in round 3.
8. `find` "textMerge join …" — DEAD END: `textmerge`, `join`, `fixed` are unmatched terms; results were LAY-14 etc. Nothing usable.
9. `get TIM-13 parts json` — found `{"type":"textMerge","id1":…,"id2":…}` and `textFromFloat` as a layout-text `value`, the Panel mono-ring modifiers, a full document skeleton. Decided to copy those patterns.
10. `check_component` DayCell with `sweep` over i 0..6 and `variables {mon, dimPrev, dimCur}` — lint clean, bytes 1277 / 496 per extra instance, but `ok: false`, `error: json2rc failed: Unknown token in expression: @mon` although `mon` is in the expanded `resources.variables` it printed, and no sweep image. Decided to trust the lint and move on to the real document.
11. `convert` with `output_path` in my folder — DEAD END: "output_path … is outside the workspace".
12. `convert check: true` (no output_path) — ok, 7138 B, parse ok; `@mon` works fine here, so call 10's failure was the harness. No image path returned despite "renders it unless render: false".
13. `render variants: true` — 10 renders; text_overflow at 320×72, 230×72, 160×72. Images at `out/…` on the server; copied to `img/var-*.png`.
14. `render clocks` [2026-12-31, 2027-01-01, 2024-12-30, 2028-02-29, 2026-02-27, 2021-01-03] — all week numbers and dates correct vs my JS check (`expected.txt`). Found from the pictures: the number sits top-left in its disc (`contentAlignment: "center"` on a box is silently ignored).
15. `convert check` round 2 (centring via a column with `verticalArrangement: center`; fitBox with full/compact/minimal) — ok, 11974 B.
16. `render variants` round 2 — no findings at any size; full at 120 tall sits at the top with empty space below.
17. `audit` (json + clock) — CRASH: "Cannot read properties of undefined (reading 'replace')".
18. `inspect accessibility` — the "Today" `contentDescription` I put on a text node was dropped (null); DateLabel's canvas exposes "MonTueWedThuFriSatSun" as its text and only its static label.
19. `inspect bytes` — expressions 36% (89 FloatExpression), icon path 621 B. Decided to hoist per-cell values into shared document variables.
20. `audit` (json, no clock) — CRASH, same message.
21. `audit` (rc_path) — CRASH, same message. Gave up on audit.
22. `get DateLabel definition: true` — learned the modifier `{"semantics": {"contentDescription": …}}`. Decided: put it on the today disc box; replace DateLabel with TextChoice month + year text.
23. `convert check` round 3 — ok, 12018 B.
24. `render variants` round 3 — no findings; vertical centring via `height: "@fullH"` (= max(70, windowHeight() - 24)) works, fitBox still picks the right child.
25. `render clocks` round 3 (+ 2026-11-01T00:30, "45 days later" in variants) — all correct.
26. `inspect accessibility` round 3 — "Week 44", "Oct", " 2026", then per day "Mon" "26" …, "Sat", BoxLayout cd="Today", "31", "Sun" "1". Good.
27. `publish` — `out/page-1793441504773-4hfu55.html`, 654 KB page, rc 12018 B. Copied to `week-at-a-glance.html`.

## 2. Dead ends and wasted calls (6 calls, 4 distinct)

- Call 8, `find` for textMerge syntax: the vocabulary has no entry for `textMerge`/`join`, so free-text search cannot find a JSON construct. Avoided by: `reference format` giving the one-line syntax of textMerge/textFromFloat when it names them, or `find` falling back to a grep over example JSON.
- Call 10, `check_component` with a sweep over a call that references document variables: "Unknown token in expression: @mon" even though the harness itself declared `mon` in the expanded document it printed. Lost the sweep contact sheet entirely. Avoided by: the sweep declaring `variables` the same way the plain demo does, or the description warning that a sweep cannot reference outside variables.
- Call 11, `convert output_path` outside the workspace: the task's folder is outside the server workspace; the description says "Paths are relative to the server's workspace" but nothing says absolute paths outside are refused. Avoided by: accepting any writable absolute path, or saying up front that outputs always land in `out/`.
- Calls 17, 20, 21, `audit`: crashes with every input form. The server workflow and build_kit `next_steps` both tell the new user to audit; it cannot be done. Two of the three were spent proving it wasn't my arguments.

## 3. Wrong, misleading, noisy or missing in the tools' output

- **audit is broken**: "Error: Cannot read properties of undefined (reading 'replace')" for inline JSON (with and without clock) and for `rc_path`. The whole design-rule safety net (glyph icons, repeated subtrees, hardcoded dates/colours, expression_too_long) was unavailable; I had to count expression entries by hand.
- **check_component sweep fails on document variables**: `"ok": false, "error": "json2rc failed: Error: Unknown token in expression: @mon"` while the same result's `expanded.resources.variables` contains `"mon": 26`; `render_findings` says "findings: none" for all four looks as if they had rendered, and no image path is given. Contradictory and silent about the sweep.
- **`contentAlignment` on a box is silently ignored** (neither convert check nor render reported an unknown key): the number sat top-left in its disc. The format reference never says how to centre a child inside a box; I found `verticalArrangement: "center"` on a column by guessing from `verticalAlignment` on rows in TIM-13.
- **`contentDescription` on a text node is silently dropped** (inspect accessibility showed `content_description: null`). The format reference shows `contentDescription` only in the header; the `semantics` modifier appears nowhere in the three references I read — I only found it by fetching DateLabel's definition. The "a11y.labels" capability is listed but its JSON is not shown anywhere a new user would look.
- **DateLabel's accessibility**: its canvas carries only the static label ("Date" / what you pass), and inspect lists its lookup string "MonTueWedThuFriSatSun" as the node's text. A screen reader never hears the date. The component's pitfalls don't say so; the `label` doc says "Accessibility label (the date is drawn, not a text node)", which reads as reassurance.
- **`convert check: true` says it "renders it unless render: false"** but returns only pixel statistics (`changedFraction`, `distinctColors`), never an image path; I had to call render separately.
- **Images are reported as `out/render-…png` relative to the server workspace** with no absolute path; the wrapper's user has to know where the workspace is. `output_path` outside the workspace is refused.
- **build_kit noise**: TIM-13 (15.5 KB tide forecast, 656 ops) is the "layout model" for a seven-day widget and the result spends ~10 KB on its tide arrays, spline and turning-point logic; TXT-10 and TIM-03 are canvas demos whose main technique (textLookup) is flagged as json2rc-only in their own pitfalls. The useful parts for this goal were two lines (textMerge syntax, Panel's mono ring) buried in TIM-13's JSON. `icons.suggestions` offered `view_week` / `next_week` for "this week" — decorative at best.
- **build_kit `not_covered`: "calendar arithmetic (no example: see reference expressions, Calendar)"** is honest, and the formulas there were correct at every date I tried — but the ISO-week expression `ifElse(ifElse(wk, 1, step(wk, weeks(y))), weeks(y - 1), step(1, wk))` is dense enough that a worked example (one small widget) would have saved reasoning time.
- **`reference format` names `textMerge` and `textFromFloat` without their syntax** ("numbers go through textFromFloat, joins through textMerge"); `find` cannot find them because the vocabulary doesn't know the words (`unmatched_terms: ["textmerge", "join", "fixed"]`).
- The `fitBox` rules say "an exact width is CENTRED at that width" but nothing about an exact height (it is top-aligned; I worked around it with a `height: "@fullH"` expression — which the reference does say is allowed, and it worked).
- Minor: `build_kit` capability resolution matched "glance" to `use_case:widget` and nothing to "week number" — `unmatched_terms: []` although "week number" is the one thing the catalog has no example for.

## 4. What I would have liked

- A working `audit` (or at least an error that says what failed), and `convert check` returning an image path as its description promises.
- A sweep that works when the call reads document variables, and that reports `ok: false` before four "findings: none" lines.
- One-line syntax for every text construct in `reference format` (`textMerge {id1, id2}`, `textFromFloat {value, whole, decimal, flags}`, what the flags mean), and for `semantics`/`contentDescription` (modifier form), `verticalArrangement`/`horizontalAlignment` values, and how to centre inside a box.
- An "unknown key" warning from convert for `contentAlignment` and for `contentDescription` on a text.
- A small calendar example (a month grid or this very widget) so `build_kit` can serve the week/ISO logic as a snippet instead of pointing at a prose formula; and build_kit preferring a 1–2 KB layout example as the layout model over a 15 KB one.
- Absolute paths in render output, or an `output_dir` that may be outside the workspace.

## 5. Assessment of the final widget (`doc.json`, `week.rc` 12018 B, `week-at-a-glance.html`)

- **Correctness**: all seven days are computed from the clock (Monday = dayOfMonth() - weekDay() + 1, wrapped with days-in-month of the previous/current month including leap years); verified by render at 2026-10-31 (26…31, 1; week 44), 2026-12-31 (week 53), 2027-01-01 (week 53), 2024-12-30 (week 1), 2028-02-29 (leap; 28, 29, 1…), 2026-02-27 (23…28, 1; week 9), 2021-01-03 (week 53 of 2020), 2026-11-01 00:30 (Sunday highlighted, week 44), 2026-12-15 (week 51). Matches a JS ISO-week check (`expected.txt`). Not checked: a device in a non-local time zone (renders used the server's local time; I didn't pin `system_variables {"10": 0}`), December of a year whose previous December had 53 weeks AND wk = 0 on Jan 1–3 was covered by 2021-01-03 only.
- **Small sizes**: fitBox with three layouts: full (header + 28 dp discs, needs ≥ ~220 dp wide and 94 dp tall, vertically centred in taller boxes), compact (one row with 22 dp discs, 64 dp tall, ≥ ~245 dp wide), minimal ("Week 44" + "Sat 31"). Rendered without findings at 320×120, 230×120, 512×90, 320×72, 230×72, 160×72. Weak spot: 230×72 falls to the minimal layout (compact's minimum width is a few dp too wide), so a 3×1 widget shows no day row.
- **Themes**: only `@colors.*`; light and dark both rendered correctly. The whole document carries 5 themed colours.
- **Mono / mono-inverted**: Panel draws a 1 dp outline ring instead of a filled surface; today's disc becomes a small filled face (white with black number / black with white number), which the guide allows. Rendered and checked both.
- **Accessibility**: document description set; every visible string is a layout text (week number, month, year, day names, day numbers); the today disc has a `semantics` contentDescription "Today" read between "Sat" and "31". Hidden alternatives are GONE so they are not read. The calendar icon has no label (decorative). Weak spot: the header reads "Week 44", "Oct", " 2026" as three nodes rather than one phrase (a TextChoice cannot be merged into a textMerge).
- **Byte size**: 12018 B (.rc). Expressions ~4 KB (26 calendar/week variables + 28 per-cell variables), two copies of seven DayCells (full and compact) ~7 KB, the icon path 621 B. Could drop to ~8 KB by removing the compact layout or the icon. The page is 654 KB (the playground's engine).
- **Known weak spots**: no month boundary marker inside the row (Sunday "1" shows no "Nov"); font-scale behaviour unchecked (the tools have no font-scale render option that I found); no tap action (none requested); English only.
