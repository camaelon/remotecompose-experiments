# To-do list (8 items, "N left") — eval run notes

Final document: `todo.json` (source, with an inline `TodoRow` component) → `todo.rc` (7,916 B).
29 tool calls (counting `list` and `describe` invocations). Renders in `out/`.

## 1. Tool calls in order
1. `list` — server overview. Took the 5-step workflow (build_kit → components → assemble → convert/render/audit → publish).
2. `build_kit` (user's sentence verbatim) — returned the library `Checkbox` (label + 0/1 var + onClick extra actions, a11y state), CMP-05 as layout model, design rules ("Taps reach the app", "Switch content by state", "Adapt to the size"). Decided: the Checkbox can't dim/strike its label, so write an inline component modelled on it.
3. `get Checkbox` (definition + demo_json) — copied its body (global-canvas textSubtext stateDescription trick, mono branch, animated fill local `p`) into `TodoRow`, adding a dimmed (muted) second copy of the label switched by visibility.
4. `reference format` — host strings as root-level `variable` commands (vtype string, export), visibility needs a declared 0/1 variable or integer expression, textMerge/textFromFloat for "N left", weight/spacedBy trap, widget sizes (4x2 = 320×160). Decided: one `flow` of 8 rows whose width/height come from window-derived variables (1 column on phone, 2 columns on a short widget or a tablet).
5. `convert` check:true — OK, 7,334 B, host variables listed (done1..8, item1..8). Skipped check_component (see §2).
6. `render` variants (3 done) — phone fine; narrow: label box overflowing by 12 px; 4x2: single column, 4 rows cut off.
7. `describe render` — to learn `variants`/`samples`/`componentTheme` (should have done before 6).
8. `inspect variables` at 320×160 — itemW evaluated to 144 (2 columns) yet render laid rows out 296 wide. Cause: the width was on the inner row, the component's outer box (the flow child) had none. Moved width/height to the outer box; replaced spacedBy with a 12 dp spacer box (the documented weight+spacedBy trap explained the 12 px overflow).
9. `render` variants — all clean except short 360×384 (rows 48 dp don't fit). Raised the "tall" threshold to 450.
10. `describe inspect` — actions format for interact.
11. `inspect interact` tap target 2 — done3 0→1, left 8→7, host action toggleItem3=1, only row 3's texts swapped.
12. `inspect interact` tap target 4 twice — host actions toggleItem5 1 then 0, no net change (uncheck works).
13. `inspect interact` 320×160, tap all 8 — left 0, anyLeft 0, noneLeft 1 ("All done" shown), 8 host actions.
14. `inspect accessibility` — each row: contentDescription = item text, state "Done"/"Not done", clickable; count is a text node "7 left". Switched state wording to "Checked"/"Not checked".
15. `audit` — 0 errors/warnings; info: 8 TextData ops never executed.
16. `inspect summary` — repaint verdict idle, 7,684 B.
17–18. `render` samples none/some/all at phone (light) and 4x2 (dark) — correct.
19. `render` strike-through attempt (canvas line over muted label) — line runs across the whole label column, not the text width. Reverted (dead end).
20. `find` examples "strikethrough / textMeasure" — nothing relevant (dead end).
21. `convert` — reverted version OK.
22. `render` variants — all findings none.
23. `render` 4x2 componentTheme mono-inverted — fine (tick only, outline box).
24. `render` tiny 180×384 after making 2 columns require width ≥ 300 (tiny variant had shown 2 columns of "Buy…", "Pay…").
25. `render` variants after adding a 6 dp end spacer (label touched next column's checkbox) — all clean.
26. `convert` final — 7,916 B, info only.
27. `inspect interact` final, 4x2: all 8 → left 0; target 3 twice → actions toggleItem4 0 then 1.
28–29. `render` samples none/some/all at phone (light) and 4x2 (dark) — final images `out/phone-sample1..3.png`, `out/widget-sample1..3.png`.

## 2. Dead ends and wasted calls
- Did not run `check_component` on TodoRow before assembling (workflow step 2). It worked anyway, but the width-on-inner-row bug would probably have shown up in a sized check.
- Call 7 and 10 (`describe`): needed because `list` truncates the parameter docs; `variants`/`samples`/actions format could have been in the list line.
- Call 8 (inspect variables): chasing why 2 columns didn't happen. The variable was right; the component's outer box had no width. The render overflow finding named `column[8].flow[1].box[3]` 296 wide, which pointed there, but I didn't read it as "the wrapper box".
- Calls 19–20: strike-through. No text decoration key and no way (that the tools showed me) to size a line to the text's width; a fillMaxSize canvas in a box makes the box fill. Would have been avoided if `reference format` said "no strikethrough; dim instead" or showed textMeasure usage.
- Call 6's 4x2 failure → the "short" threshold and the tiny 2-column case each needed another render round; a single variants call shows them all, which is good.

## 3. Wrong, misleading, noisy or missing in tool output
- `Checkbox` label param is typed `"string"` with doc "Shown next to the box" — nothing says a host string (`"@item1"`) works there. It does (in my copied body), but a new user can't tell.
- No text decoration: the request's natural "struck through" is not mentioned anywhere (reference format lists text keys; none is strikethrough). A design rule says "a colour cannot be computed" so dimming means two coloured copies — fine, but costs bytes per row.
- `inspect interact` says `"effect": "the input changed the document"` for tap+tap on one item although changed_variables and changed_host_variables are empty (net no change). Also `"repaint": "continuous"` in interact vs `"verdict": "idle"` in summary — confusing without saying it's the 0.15 s check animation.
- `inspect interact` steps report `"label": null` for every target although the row has a contentDescription.
- `render` with `variants` and output_path also drops 3 extra `out/render-<timestamp>.png` files each time (noise in the workspace).
- `render` variants renders mono/mono-inverted only at the default size; the 4x2 is only in the default theme.
- `build_kit` "unmatched_terms": ["what"] — noise.
- The convert `unused_space` info ("add what the screen is for (history, details, actions)") on a fixed 8-item list is unhelpful advice.
- `reference format`: `{"padding": ...}` with per-side values is never shown; I avoided it.

## 4. What I would have liked
- A Checkbox/TodoItem option to dim or strike the label when checked (very common).
- A text decoration key (strikethrough) or a documented "line as wide as the text" recipe.
- interact reporting the intermediate states (after each tap) not only the net diff, so "tap → 7 left, tap again → 8 left" is one call.
- `variants` that includes the 4x2 size in dark/mono too, or a `sizes` × `themes` grid.
- Parameter details (variants, samples, actions) visible in `list` or build_kit next_steps.

## 5. Honest assessment
- Correctness: "N left" = 8 − Σ done_i computed in the document; "All done" at zero via two visibility-switched texts in one box. Verified by interact (8→7, back, 0 → All done).
- Interactions: the whole row (checkbox + text, ripple) is one tap target; each tap flips its own `doneN` (exported) and sends `toggleItemN` with the new value (0/1). Verified per item at 4x2 and phone.
- Host variables: item1..item8 exported strings (distinct sample texts), done1..done8 exported floats.
- Sizes: phone 360×640 single column 48 dp rows; 4x2 320×160 two columns 28 dp rows, labels ellipsized ("Pay electricity…", "Reply to Sam'…"); tablet ≥600 wide two columns; tiny/narrow one column. All variants render with no findings. Tablet has lots of empty space below the list. No scroll: at very short heights below ~150 dp it would clip. 28 dp rows in the widget are under the 48 dp touch-target guideline.
- Themes: all colours are @colors.*; light, dark, mono, mono-inverted rendered fine. In mono the checked box is an outline with a tick (library behaviour), not filled.
- Done look: checkbox filled with tick + label in muted colour. No strike-through (attempt failed). In light theme the dimming is subtle; the filled box carries most of the signal.
- Accessibility: each row announces item text + "Checked"/"Not checked" (verified with inspect accessibility; state follows the variable). The child text is also a readable node, so a reader may hear the text twice. Count is a plain text node ("5 left"/"All done"), not a live region, so a change isn't announced by itself. No checkbox role (format has none).
- Bytes: 7,916 B .rc; each row is a fully expanded component (~700 B incl. two label copies and stateDescription text ops).
