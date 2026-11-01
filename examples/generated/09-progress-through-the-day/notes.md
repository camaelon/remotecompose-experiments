# Eval 09, run 1: "A widget showing how far through the day, the week, the month and the year we are, as progress bars."

Result: `widget.json` (source), `eval09-widget.rc` (6060 B), `eval09-widget.html` (playground page), `img/` (every render looked at). 21 tool calls, all through `node eval/mcp-cli.mjs`.

## 1. Tool calls in order

1. `list` – see the servers and tools. Took: the remotecompose workflow (build_kit → check_component → convert/render/audit → publish). Decided to follow it literally. Output is 29 KB and covers five servers although only `remotecompose` was in scope.
2. `build_kit {goal}` (verbatim) – resolved to capability time.date, use case widget, component ProgressBar. Took: ProgressBar's call and pitfalls (fills its parent's width; 0 % is a dot; clamp arg order), TIM-10's leap/days-in-month formulas, TIM-08 as the layout model (column/row/text, variables in resources), the design rules (theme colours, repeat by definition, compute from the clock, adapt to smaller sizes), `not_covered: calendar arithmetic → reference expressions`. Decided: one inline row component, four calls, fractions as named variables.
3. `reference expressions` – clock functions and calendar arithmetic. Took: timeInMin() 0..1439, weekDay() 1 = Monday, dayOfYear(), the `eq(x) = 1 - min(1, abs(x))` trick, the leap rule, the 32-entry limit. Decided: dayFrac = timeInMin()/1440 (minute resolution, so the document repaints once a minute rather than every second); week starts on Monday (ISO) since that is what weekDay() gives.
4. `reference format` – JSON essentials. Took: text/textMerge/textFromFloat syntax (flags 5 = no padding), modifiers, weights ignore spacedBy, semantics modifier form, fitBox paragraph, clocks/system_variables for date checks.
5. `get TIM-08` – the layout model's full JSON. Took: header fields, `resources.variables`, `{"text": {...}}` node form, textFromFloat in a layout text. Nothing surprising; could have skipped it given the format reference.
6. `reference components` – component authoring guide. Took: definition shape (params/body/call), `@theme.text_sm` is substituted in a body, string params splice as written, text in a component forces expand mode (U7), semantics with a param string works.
7. `check_component PeriodRow` with sweep progress [0, .01, .25, .5, .75, .99, 1] – no lint errors; 403 B per extra instance; light/dark/mono/mono-inverted renders and the contact sheet all right. Decided: keep it.
8. `convert check:true` (v1) – ok, 3042 B, parses, renders.
9. `render variants:true` (v1) – light/dark/mono/mono-inverted/narrow fine; wide 512×128, short 320×102, small, tiny all overflow (four stacked rows need ~132 dp). Decided: a fitBox with full / compact / bars-only alternatives.
10. `render clocks:[six pinned dates]` (v1) – checked the percentages by eye against hand calculations: 2026-10-31 12:00 Sat → 50/78/98/83; 2028-02-29 23:59 (leap Feb, last day, Tue) → 99/28/99/16; 2026-12-31 23:59 Thu → 99/57/99/99; 2027-02-28 06:00 Sun (common Feb, last day) → 25/89/97/15; 2026-11-01 00:00 Sun → 0/85/0/83; 2026-01-01 00:00 Thu → 0/42/0/0. All correct.
11. `audit` (v1) – 0 errors, 0 warnings; longest expression `leap` 24/32 entries.
12. `get LAY-09` – fitBox syntax (`{"type": "fitBox", "children": [...]}`), since the format reference describes fitBox without showing a node. Took the syntax; ignored its fixed widths (the format reference says to threshold on heights) and its hex colours.
13. `convert check:true` (v2, fitBox, three inline components) – ok, 6060 B.
14. `render variants:true` (v2) – every size and look clean, no findings.
15. `audit` (v2) – 0/0, info: fitBox shows child 1 of 3 at 320×170 (needs 132 / 72 / 50 dp); longest expression 24.
16. `inspect accessibility` (v2, 320×170) – eight text nodes (Day 50%, Week 78%, ...), `has_semantics: false` (no explicit semantics in the shown layout). Decided: acceptable, the texts carry the information.
17. `inspect runtime` (v2) – repaint "scheduled" every ~59 s from timeInMin(); 131 ops per frame; no continuous repaint. Live updating confirmed.
18. `render 320×80 light` – the bars-only fallback shows four bars, no findings.
19. `inspect accessibility` (320×80) – the four fallback bars expose "Day progress" … "Year progress".
20. `inspect bytes` – 27 % variables/expressions, 21 % layout, 20 % draw; 38 FloatExpressions (12 ProgressBar instances across the three alternatives). Decided: 6 KB is fine for a widget; not worth dropping an alternative.
21. `publish` – `out/eval09-widget.html` (583 KB playground), rc 6060 B. Copied to this folder.

## 2. Dead ends and wasted calls

- None that cost a rerun. Call 5 (get TIM-08) added little beyond the format reference. Call 12 (get LAY-09) was needed only because the format reference names fitBox without showing its JSON; one line of syntax there would have saved it.
- The v1 → v2 round (calls 8–11 then 13–15) was the expected iteration, not a dead end: the design rule warned that widgets get resized smaller and the variants render confirmed it.

## 3. Wrong, misleading, noisy or missing

- Tool names from other servers leak into remotecompose guidance. build_kit `next_steps`: "rc-render.validate and render_rc it, look at the image, and rc-inspect.audit it" – in this server those are `convert`/`render`/`audit`. The design rule "Look before answering": "Render the document (render_rc)". The component guide: "`get_component {"name": "Stepper", "definition": true}`", "`find_components` to check it doesn't exist yet", "json2rc, render_rc, validate, audit and package_web all accept documents that call them" – `package_web` does not exist anywhere in the list; here it is `publish`, `get`, `find kind components`.
- textFromFloat `flags` is never explained. The format reference says "flags 5: no padding zeros", TIM-03 says "flags 4 (PAD_PRE_NONE)", TIM-08 uses "flags 12" for zero padded. 5 worked, but I cannot tell what bit 1 does or whether 4 would have been the same.
- The format reference's fitBox paragraph is long on rules ("Use exact HEIGHTS as the thresholds (fillMaxWidth + height N on each alternative)") but shows no node; LAY-09's example then contradicts it by giving each alternative a fixed width AND height, and uses literal hex colours against the theme rule. A new user does not know which to trust; I followed the reference and it worked.
- `render variants` output for the overflowing sizes repeats each warning verbatim three times (short, small, tiny) and adds "png_path: ... (on the server)" / "Success: <input> -> ..." lines that duplicate the "[image saved: ...]" line. Clean variants print one line; failing ones print ten.
- check_component dumps the whole `expanded` document (150 lines) before the numbers I wanted (`bytes`, `modes`, `render_findings`, `sweep`). The expansion is useful once; a `parts` option would cut the noise.
- Images are saved under the repository's `out/` with generated names; `render` has one `output_path` but with `variants`/`clocks` it produces up to ten images, so they cannot be directed to my folder. I copied them by hand after every call.
- `inspect accessibility` reports `has_semantics: false` for the full layout with no hint whether that matters when every value is already a text node, and the ProgressBar component exposes nothing (a canvas): there is no way to attach a dynamic value ("50 %") as a contentDescription, only a static string. The audit did not flag accessibility at all, so the two tools disagree on whether anything is missing.
- The expression reference says timeInSec() is "seconds within the HOUR, not of the day" and continuousSec() "wraps at the hour". Documented, but surprising enough that it deserves to be in build_kit's pitfalls for any time goal.
- `build_kit` pulled TIM-03 (date card) whose pitfalls are about addDataList and the Java parser; nothing in it was needed for this goal. TIM-10 was the useful one (its days-in-month formula is shorter than the reference's eq-sum form, which would have exceeded 32 entries: four eq() terms are ~35 entries).
- build_kit says `needs_component` appears "when present"; it was absent even though the design rule "Repeat by definition" implied I should write a row component. A hint like "four repeated rows → an inline component" would have matched the audit's repeated_subtree check.
- `publish` has a `publish` parameter and a `reason`; the description says a public page is "always the playground" but not what `publish: true` does (a URL? the deploy?). I left it unset and got a local HTML file only.
- The default theme of a single `render` is dark (the "narrow", "wide" and clock renders came out dark); nothing says so until you see the image.

## 4. What I would have liked

- One `widget` form-factor preset in build_kit: the sizes a launcher gives (2×1, 2×2, 4×1, 4×2 in dp) with the rule "design for 4×2, degrade to 2×1", so the fitBox heights can be chosen from numbers instead of guessed.
- The fitBox node example in the format reference, and a note that fitBox centres its alternatives.
- A documented `flags` table for textFromFloat.
- An `output_dir` for render/check_component so multi-image calls land where I work.
- `render clocks` to print, next to each image, the clock's weekday/day-of-year and the values of the named variables, so numeric correctness can be checked without reading pixels.
- A ProgressBar (and the other value components) with an optional `label` param that emits semantics with the value, or a note in the accessibility inspect on what a screen reader will actually read for a canvas bar.
- Consistent tool names in every piece of guidance served by this server.

## 5. Honest assessment of the widget

- Correctness: dayFrac = timeInMin()/1440; weekFrac = (weekDay() − 1 + dayFrac)/7 (ISO week, Monday start; a Sunday-start locale would differ, a deliberate choice); monthFrac = (dayOfMonth() − 1 + dayFrac)/daysInMonth with the Gregorian leap rule (100/400); yearFrac = (dayOfYear() − 1 + dayFrac)/(365 + leap). Verified at six pinned clocks including 2028-02-29 23:59, 2027-02-28, 2026-12-31 23:59, two Sundays and Jan 1 00:00. Percentages are floored so "100 %" never shows while a period is still running; the bar reaches 99.9 %.
- Live updating: repaint scheduled once a minute from timeInMin(); nothing repaints continuously. The ProgressBar eases 0.3 s on each minute step (mono snaps).
- Sizes: fitBox with three alternatives — full (label above bar, 132 dp), compact (label | bar | % in one row, 72 dp), bars only (50 dp). Checked at 320×170, 230×170, 512×128, 320×102, 230×102, 160×102, 320×80: no overflow findings. Below ~74 dp of height nothing is shown (fitBox shows nothing when no child fits); there is no verticalScroll fallback.
- Themes and mono: only @colors.* used (surface, onSurface, muted, primary, track); light, dark, mono and mono-inverted all rendered clean.
- Accessibility: header contentDescription; in the full and compact layouts each row is two text nodes ("Day", "50%"); in the bars-only layout each bar carries a static "Day progress" label, so the value is not spoken there. The bars themselves are canvas drawings with no role or value.
- Bytes: 6060 B (.rc). Three layouts triple the ProgressBar instances; a single layout was 3042 B. Pattern mode cannot help because the components contain text (U7).
- Weak spots: the 0 % state shows a dot rather than an empty track (ProgressBar's documented behaviour); the hidden fitBox alternatives still evaluate their expressions each frame; the bars-only fallback has no numbers; week start is not localised.
