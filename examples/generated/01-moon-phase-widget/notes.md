# Eval run 5: moon phase widget

Request: "Make a widget showing the current moon phase, tonight's moonrise-style label
("waxing gibbous, 82% lit"), and how many days until the next full moon."

Result: `widget.json` (4,256 B as .rc), `page.html` (local playground). 37 server calls,
of which about 12 were dead ends or repeats. Renders in `r*.png`, `d-*.png`, sheets in `sheet*.png`.

## 1. Every tool call, in order

| # | Call | What I learned / decided |
|---|------|--------------------------|
| 1 | `list remotecompose` | Four servers plus a merged `remotecompose` facade. The facade's intro gives a 5-step workflow (build_kit, check_component, assemble, convert+render+audit, publish). Decided to follow it literally. |
| 2 | `build_kit(goal)` | 33 KB. Resolved `MoonPhase` and `DateLabel` components, `TIM-11` (moon phase calendar) as the layout model, and `EXP-09` (a seeded skyline) as a second example. `needs_component` said "disc, fraction" need a new component: wrong, MoonPhase covers them. Design rules were the most useful part: "a word joined to other text in one line ... compute the word in a canvas global block and textMerge it (TIM-11)", and the collapsibleColumn padding note (which I then missed). Decided: no new component; copy TIM-11's hero. |
| 3 | `describe get` | Needed to know `parts` values (meta/json/expanded_json/snippets/render). The list output's one-line description was cut off mid-sentence, hence this call. |
| 4 | `get TIM-11 parts:[json]` | 11 KB. Got the full ephemeris (d0, la/lb, Newton steps for toFull), the phase-name global block (textSubtext + textTransform 3), the `fullIn/fullTomorrow/fullToday` visibility trick and the `textFromFloat ... flags: 5` idiom. Decided to take the hero row and drop the calendar. |
| 5 | `get TextChoice` | Checked whether TextChoice was the better way to show the phase name. Its own pitfalls say to use textMerge over a canvas-cut name when joining to other text, so I kept TIM-11's approach. Not used in the end. |
| 6 | `convert check:true` | ok, 4,200 B. Warning: `component_overflow` CoreText 191 wide in a 176-wide CollapsibleColumn, past the right by 15 px. The suggested fixes (componentWidth, fitBox, collapsibleColumn, scroll) did not name the real cause. |
| 7 | `describe render` | Learned `variants: true`, `componentTheme: mono / mono-inverted`, `system_variables: {"10": 0}` to pin offsetToUtc (from TIM-11's pitfalls, not from the render doc), and `clock: "YYYY-MM-DDTHH:MM"`. |
| 8 | `render` dark 320x150 | Picture: "lit" clipped on the right. Confirms the overflow. |
| 9 | `render` after `fillMaxWidth` on the label | Still overflowing (192 wide now). Dead end. |
| 10 | `render` with a plain `column` instead of `collapsibleColumn` | No findings, label wraps to two lines. Told me the collapsibleColumn was the difference, not the text. |
| 11 | `inspect task:layout` | Outline: the CollapsibleColumn is 192 wide at x=112 with its padding, its child text 192 wide at x=128. So the column's own padding moves children but does not shrink their width. The kit's design rule had said "padding on the wrapping box (collapsibleColumn ignores its own)". My miss, but the overflow finding could have said it. |
| 12 | `render variants:true` (moon 88, box wrapper with padding) | 7 captioned images. All fine except narrow 230x150: label lost "76% lit" to maxLines, "Full moon in 25 days" clipped. Also learned the files are written as `<output_path stem>-<variant>.png` (not documented; I had to `ls`). |
| 13-15 | `render` narrow / wide / std with the moon in a `weight: 1` box + `widthIn max 112` | Moon gone in all three. "findings: none" on every one. |
| 16 | `inspect task:layout` | `zero_size` warning: the moon's box is 0x118, the canvas 0x88. `weight` + `widthIn` combined gave zero width silently. Dropped widthIn. |
| 17-19 | `render` narrow / wide / std with `weight: 1` / `weight: 2` | Narrow fixed, but wide left a 70 px hole after the moon and standard now wrapped "lit". Weights are the wrong tool for a hero that should stay a fixed size. |
| 20 | `render variants:true` with a fixed 76 dp moon and 14 dp padding | All 7 variants clean (narrow wraps to 3 lines, nothing cut). |
| 21-25 | `render` at 2026-11-24, 11-23, 11-09, 11-13, 12-04 (light) | "Full moon, 99% lit / Full moon tonight"; "Waxing gibbous, 99% lit / Full moon tomorrow"; "New moon, 0% lit / in 15 days"; waxing crescent lit on the right; waning crescent lit on the left. Matches TIM-11's verified text (full moon Nov 24, new Nov 9). |
| 26 | `audit` | 0 errors, 0 warnings, 1 info `deep_expressions` (chain depth 14, "flatten them"). Contradicts the 32-entry Java limit advice (see section 3). |
| 27 | `inspect task:accessibility` | Document description present, moon labelled "Tonight's moon", the three texts readable with their resolved values. Decided no more a11y work. |
| 28 | `render componentTheme: mono-inverted` | Lit part is black ink on white with a grey rim; the text label makes it unambiguous. OK. |
| 29 | `describe publish` | `output_path` writes the HTML locally; `publish: true` is the upload and is unavailable here. `layout` left out = playground that fills the window. |
| 30 | `publish output_path: page.html` | 559 KB page written. (Premature: a later fix made me publish again.) |
| 31 | `render` 230x90 | A state variants did not cover. Only the moon is left: the collapsibleColumn dropped every text, including the one without a priority. "findings: none". |
| 32-34 | `render` 230x150, 230x90, 320x150 with label maxLines 2 + ellipsis, font 15, moon 72 | Narrow: "Waning / gibbous, 76% lit" (two lines, intact). Tiny: moon + label, TONIGHT and days dropped. Standard: one line. |
| 35 | `render variants:true` | Final confirmation, all 7 clean. |
| 36 | `audit` | Same single info. |
| 37 | `publish output_path: page.html` | Final page, 559,588 B. |

Three extra CLI invocations failed before reaching the server because of my own shell quoting
(a `set --` loop produced invalid JSON); not counted above.

## 2. Dead ends and wasted calls

- **Call 9 (fillMaxWidth on the label).** I guessed the text was measuring itself unbounded. The real cause was the collapsibleColumn's padding. One wasted render; the overflow message pointed me at generic remedies instead of the specific one.
- **Calls 10-11 (plain column, inspect).** Diagnostic, not wasted as such, but the overflow finding could have named the component responsible ("padding on a CollapsibleColumnLayout is not subtracted from its children's width"), which would have saved both.
- **Calls 13-16 (weighted box + widthIn).** Four calls to discover that `weight` + `widthIn max` yields a 0-wide box. Nothing warned: convert said nothing, render said "findings: none" even though an accessible component (the moon) was 0 wide. Only `inspect layout` flagged `zero_size`.
- **Calls 17-19 (weights alone).** Worked at narrow but broke the wide and standard looks. A design note like "a hero drawing keeps a fixed dp size; let the text column take the weight" would have told me not to try.
- **Call 5 (TextChoice).** Fetched to compare approaches; the kit's design rule had already settled it. Half wasted.
- **Call 30 (first publish).** I published before trying the one size the variants sweep does not include (narrow and short together). The sweep's coverage gave me false confidence.
- **Calls 2 and 4 together are 44 KB of input** for a widget that is, in the end, 150 lines of JSON. TIM-11's `snippets` array was empty, so there was no smaller way to get its ephemeris block than the whole document.

## 3. Wrong, misleading, noisy or missing

1. **`needs_component` false positive.** build_kit said "disc" and "fraction" have no component and gave a five-step recipe for writing one. Both words described the MoonPhase it had just resolved. A model following the workflow literally would have spent several check_component calls building a second moon. The `icons.suggestions` (`disc_full`, `shield_moon`, `date_range`) were likewise irrelevant.
2. **EXP-09 in the examples.** A seeded random skyline was returned because its summary mentions "a pale moon". It is tagged as "canvas-only, take the technique", but nothing in it applies. Noise in an already long reply.
3. **Render findings missed a zero-size component twice.** The moon vanishing (calls 13-15) and all text vanishing at 230x90 (call 31) both came back "findings: none". inspect's layout diagnostics do catch `zero_size`; the render sanity pass should include it, and should flag a widget whose only visible component is one drawing when the document has text.
4. **Overflow remedy text is generic.** "Size drawings from their box (componentWidth()/componentHeight(), a fitBox with smaller children), or let the least important content collapse (collapsibleColumn) or scroll" was shown for a text overflowing because of its parent's padding. The suggestion to use collapsibleColumn, when the collapsibleColumn was the cause, was actively misleading.
5. **`weight` + `widthIn max` gives 0 width with no diagnostic** at convert time. Either refuse the combination or say what it does.
6. **Audit's `deep_expressions` info** says to flatten expression chains. The kit's pitfalls for TIM-11 say the opposite: split them because Java rejects expressions over 32 entries. The audit also did not report the maximum entries per expression, which is the number I actually needed to trust the document on Android.
7. **collapsibleColumn semantics.** The kit says "children without one [a priority] are kept". At 230x90 the label (no priority) was dropped because it did not fit on its own. "Kept" apparently means "dropped last", which is not what the sentence says.
8. **inspect layout shows dynamic texts without their text** (`CoreText#-17` with no quoted value) while inspect accessibility shows the resolved string. Inconsistent, and the layout view is where I was looking for the width problem.
9. **Variants sweep file naming is undocumented.** `output_path: r4-variants.png` produced `r4-variants-dark.png`, `-light`, `-mono`, `-narrow`, `-wide`, `-short`, `-seven`. The CLI also echoed `out/render-<timestamp>-N.png`, a second copy under a different name, which made it unclear which path was the real one.
10. **Variants sweep coverage.** No narrow-and-short cell (the one that broke), no square cell (a 2x2 widget), no mono-inverted, and for a date-driven document "seven hours later" is the least interesting other state; "another date" (next week, a full-moon day) would have been.
11. **Unknown keys are silently accepted.** I wrote `"contentAlignment": "center"` on a box, which may or may not be a real parameter; the converter said nothing. A lint for unrecognised keys would catch typos.
12. **`flags: 5` on textFromFloat** is copied from TIM-11 with no explanation anywhere in the kit output. I still do not know what it means.
13. **Pinning the time zone** (`system_variables: {"10": 0}`) is documented only inside TIM-11's pitfalls. The render tool's own description says nothing about which system variable ids exist.
14. **The `list` tool's descriptions are truncated** mid-sentence ("(def", "the format's t"), which cost a `describe` call for `get`.

## 4. What I would have liked

- build_kit to say "MoonPhase already shows a disc / lit fraction; nothing to write" instead of `needs_component`, and to drop examples whose only link to the goal is a word in the summary.
- TIM-11 with `snippets` for its two reusable blocks (the ephemeris variables, the phase-name global block) so a widget does not need the 11 KB calendar document.
- Overflow findings that name the responsible parent and the specific fix when the cause is structural (padding on a collapsibleColumn, weight + widthIn, a row child without a weight).
- Render sanity to flag zero-size and fully-dropped components, and a "content you wrote is not visible" finding.
- A variants sweep with a narrow-and-short cell, a square cell, mono-inverted, and a second date for clock-driven documents; and the output file names in the reply.
- The audit to print the largest expression's entry count against the 32 limit, and to not recommend flattening when the document is already split for that limit.
- One sentence in the kit for the widget use case on hero sizing: fixed dp for the drawing, weight for the text column, maxLines with ellipsis on the one line that must survive.

## 5. Assessment of the final widget

- **Correctness.** The ephemeris is TIM-11's verified five-term series with two Newton steps for the next full moon, counted from the start of today in UTC days (offsetToUtc subtracted). Checked on 2026-10-30 (waning gibbous, 76%, full moon in 25 days = Nov 24, matching the catalog's verified text), on Nov 23 ("Full moon tomorrow"), Nov 24 ("Full moon tonight"), Nov 9 (new moon, 0%), Nov 13 (waxing crescent lit on the right) and Dec 4 (waning crescent lit on the left). The lit percentage is live via timeInMin() (76% at noon, 73% seven hours later), so a full-moon day can read "99% lit" if the exact moment has passed; cosmetic. The phase name follows the day-based rule from TIM-11 (a day with a principal phase is named for it). No hard-coded dates or colours; 4,256 B.
- **Small sizes.** 320x90: moon shrinks to 58 dp, everything on one line. 230x150: label wraps to two lines with "lit" intact, days line wraps to two. 230x90: moon plus the label only; TONIGHT and the days line are dropped by priority. Below that the label would go too. Wide 512x113 is fine. A square 2x2 would still be a side-by-side row; I did not build a stacked layout for it.
- **Light / dark.** Both use theme colours only (background, onSurface, muted, primary; the moon's highlight/shadow/outline come from the component). Light: amber moon, slate shadow, blue days line; dark: pale amber on navy. Contrast is fine in both.
- **Mono.** Mono: white lit part on black inside a thin ring, white text. Mono-inverted: black lit part on white, the reverse of an almanac glyph, but the text label says the phase so it cannot be misread. Days line falls back to onSurface (no primary in mono).
- **Accessibility.** Document description set; the moon has a static label "Tonight's moon" (I did not confirm whether the `label` param accepts "@phaseName", so the phase itself is only in the text, which screen readers do reach).
- **What is not done.** The "moonrise-style" wording was interpreted as the one-line phase label the user quoted; there is no actual moonrise time (it needs a location). No tap action.
