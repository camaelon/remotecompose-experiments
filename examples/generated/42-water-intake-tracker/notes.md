# Water intake tracker: eval notes (run 1)

Final document: `water.json` (converted: `water.rc`, 6,508 B). The Bottle component is inline in it and also saved on its own as `bottle.json`. `water-v1.json` is the version from before the narrow-width fix.

Decisions made without asking:
- **Layout:** one layout for every size. A row holds the bottle (left) and the count and status (right), with a row of controls under it. I did not build a separate layout per aspect ratio, because a second copy of the controls would duplicate the host action names.
- **Host values:** `drunk` (default 5) and `goal` (default 8), both exported floats. `g = max(1, goal)` guards against a goal of 0.
- **Taps:** +1 sets `drunk = @drunk + 1` and sends hostNamedAction `addGlass` with value `@drunk` (float). −1 sets `drunk = max(0, @drunk - 1)` and sends `removeGlass`. The app gets the new count in the action's payload and can also read the exported variable.
- **Past the goal:** the bottle stays full, the status reads "Goal reached" with a check icon, and a "+N extra" line is added.
- **No moving wave:** the wave is a static sine on the water surface. An animated wave needs `continuousSec()`, which repaints every frame, and that is wrong for a widget. The level eases over 0.6 s.
- **−1 button:** it is an outlined IconButton ("remove" icon) labelled "Remove a glass". It is disabled at 0, and the screen reader announces it as disabled.
- **+1 button:** it is a filled Button "+1 glass". Below 140 dp of window width it switches to a filled IconButton "+", labelled "Add a glass", through a `stateLayout`.

## 1. Tool calls in order

1. `list`: the tool list and workflow. I followed it: build_kit first.
2. `build_kit`, with the goal verbatim. It offered ProgressRing, TIM-13 (tides), STR-03 (water glasses loop), TIM-03 (date card) and needs_component "bottle". I took STR-03's tick and loop idea and the needs_component recipe. I ignored TIM-13 and TIM-03, which are irrelevant (see section 3).
3. `find` examples for "button increments counter, tells app, a11y". I got TIM-14, CMP-01, INT-08 and INT-01: valueFloatExpressionChange plus hostNamedAction in an onClick list.
4. `reference components` (the authoring guide). I took the animated local `{value, anim}`, `$if theme.mono`, and the unit box scaled to the canvas.
5. `get ProgressRing definition:true`. I copied its canvas skeleton (s, translate, scale, animated local).
6. `get DRW-12` (json, meta). I took the pathCreate / pathAppendLineTo / clipPath / pathExpression syntax.
7. `reference format`. I took textMerge/textFromFloat for "5 / 8", semantics with a live contentDescription, hostNamedAction with `valueType` (the new count), the visibility rules, collapsibleColumn and stateLayout.
8. `get Button`. I took its params. It has no separate a11y label (the label is the a11y label), the face is 48 dp tall, and enabled can be a runtime value.
9. `check_component Bottle`, sweeping level over 0, .125, .5, .875, 1 and 1.375. All cells were right first time, in light, dark, mono-dark and mono-light (1,124 B per instance).
10. `convert` with check. OK, 5,679 B. It reported one ellipsized text.
11. `render` samples for drunk 0, 1, 4, 7, 8, 11 and goal 6/12 (light). They came back as 8 separate PNGs with no contact sheet, so I made the sheet myself. All states were correct, but the "−1" Button (fill, weight 1) showed as "…".
12. `render variants:true`. The light, dark and mono looks were fine. "+1 glass" was ellipsized after I removed fill from −1. Short sizes clipped texts. **The 4x2 and 4x1 renders were both written to `variants1-widget.png`, so the 4x2 one was lost.**
13. `get IconButton`. I switched −1 to an outlined IconButton with a "remove" Icon and the label "Remove a glass".
14. `render sizes` 160², 320×160, 360×640, 160×96 and 115×160, after making the info column a collapsibleColumn. 2x2, 4x2 and phone were OK. At 160×96 the count is dropped, and at 115 wide "+1 glass" becomes "…".
15. `inspect task:list_interactions`. **Error:** the rc-inspect server's tool is called list_interactions, but the unified inspect task is `interactions`.
16. `inspect interactions`. Two click targets, each with ValueFloatExpressionChange and HostNamedAction.
17. `inspect interact` with `{"tap":0}`. **Error:** "expected one of wait, target, tap, drag, variables". The index form is `target`, and tap takes a point.
18. `inspect interact` with targets, from drunk 7: +1, +1, −1. Host actions addGlass 8, addGlass 9, removeGlass 8. done/notDone switched correctly.
19. `inspect accessibility`. The bottle reads "Water bottle, 5 of 8 glasses drunk today", the buttons are "Remove a glass" and "+1 glass", and the texts are readable.
20. `audit` at 160². 0 errors and 0 warnings. One info: never-executed TextData, which is the action names.
21. `inspect summary`. 5,888 B; repaint verdict idle.
22. `describe render`. I needed the touch_events format.
23. `render` with three taps from drunk 2, captured at 0.45 s. The count reads 5 while the water is still rising, so the easing is confirmed.
24. `render` dark, all 8 samples. Good.
25. `render componentTheme mono-dark`, 8 samples. Good: white water, the done check icon, and a dimmed disabled −1 at 0.
26. `render variants` plus 110², 320×160 and 360×640. At 110² (the smallest 2x2) "+1 glass" is "…".
27. `render sizes` after adding the stateLayout (an icon "+" below 140 dp). 110 and 115 now show the − and + icon buttons.
28. `inspect interact` at 110², tapping "+" twice: addGlass 6 and 7.
29. `inspect interact` at 160², tapping "+1 glass" twice: the same result.
30. `convert` with check (6,535 B), then
31. `audit` at 110². Info: the "+" target is 42×48 dp, and shared_action_name (addGlass is used by the two stateLayout alternatives).
32. I set padding to 6 and removed the 4 dp spacer, then ran `convert` (6,508 B) and `render` at 110², 160², 320×160 and 360×640 with drunk 8. All good.

Total: 32 tool calls. There were also two shell-quoting failures that never reached the server.

## 2. Dead ends and wasted calls

- **Call 15** used the wrong task name. The `list` output shows the rc-inspect server's `list_interactions` next to the unified `inspect` task `interactions`. One naming scheme, or an alias, would have avoided it.
- **Call 17** used `{"tap": 0}`. The `list` description says "Feed a target's index or centre to interact", which reads as if tap takes an index. The real key for an index is `target`, and the error message does not say what each key takes.
- **Calls 11–12 and 26–27:** the button row went through three versions (−1 ellipsized, then +1 ellipsized, then a stateLayout). The Button pitfall says the width wraps the label, but nothing gives the minimum width of "+1 glass" or warns that a 2x2 can be 110 dp wide. A minimum-width figure in the Button docs (or from check_component) would have saved two renders.
- **Call 26** was partly needed only because the variants render had overwritten the 4x2 image with the 4x1 one (both go to `-widget.png`).

## 3. Wrong, misleading, noisy or missing

- **build_kit matched irrelevant terms.**
  - "today" resolved to `time.date` and pulled in TIM-03 (a tear-off date card) and TIM-13 (tides), which became the `layout_model`. Neither has anything to do with water intake.
  - "water intake", "glass" and "out of 8" all mapped to ProgressRing, while "filling" and "bottle" were unmatched.
  - It returned nothing about Button, hostNamedAction or accessibility, although the goal is a tracker you tap. I had to find those myself (call 3).
- **TIM-13 as the layout model** for a tiny 2x2 widget (15 KB, clock maths, a forecast array) was noise.
- **The rule "Give each control its OWN action name: a name shared by two click lists is written once, inside the first … (U58)"** (reference format) is stated as a hard rule. The audit later says json2rc handles shared names correctly ("json2rc declares a shared name once before the tree, so every control sends it") and that only the reference JSON parser has the bug. I nearly rejected the stateLayout because of the stronger wording. The format reference should say what the audit says.
- **render variants file collision:** "widget 4x2 320×160 → variants1-widget.png" and "widget 4x1 320×80 → variants1-widget.png". The 4x2 image is overwritten. The `variants` description also does not mention the widget sizes, or the size warning that is printed even when you pass only `sizes`.
- **render samples** gives one file per sample, with no contact sheet. The description says "several sets of host variables in one call", but check_component's sweep makes a captioned sheet and this does not, so comparing 8 states means opening 8 images.
- **inspect accessibility** gives button bounds that disagree with `interactions`: the +1 button at x 76, w 92 (it extends past 160) against 60/92 in interactions, and −1 at 13.5,109.5 against 8,104. Role is reported as `255` for buttons. Is that a button role or unknown? It is not explained.
- **inspect summary** lists theme colours (background, muted, primary…) under `host_variables`, mixed in with drunk and goal. That is confusing when checking which values the app supplies.
- **convert check** op counts show `LoopOperation: 19` and `ANIMATED_FLOAT: 22` for a document with one loop and one animated value. These look like mislabelled op names, and they make the counts hard to trust.
- **The render size warning** at 160×96 repeated LAY-13/14 advice, although I already had a collapsibleColumn. The real cause was the fixed 48 dp button row plus a weighted top row, and it did not say so. The `collapsed` info ("no priority: dropped last, it did not fit on its own") was useful.

## 4. What I would have liked

- build_kit should recognise "tracker" + "tap +1" + "tells the app" and return Button/IconButton, the onClick list with `hostNamedAction valueType`, and a11y semantics directly. It should not key on "today".
- A captioned contact sheet for `render samples` (as check_component's sweep has), and unique file names in variants.
- The minimum width of a Button for a given label, or a check of the controls row at the smallest 2x2 (110 dp) from variants, which only covers 115 and 80 wide.
- Clear, enumerated action schemas for `inspect interact` (tap: [x,y]; target: index).
- A library "LevelContainer" or "FillShape" component (bottle, glass, battery), since "fill level in a shape" is a common widget pattern. Writing it was easy thanks to DRW-12 and the sweep, though.

## 5. Assessment of the final widget

- **Correctness:**
  - The water level follows `drunk / goal`, clamped, eased 0.6 s, with a static sine wave that flattens when empty or full.
  - There is one tick per glass (`goal - 1` ticks), so goal 6 and goal 12 show 5 and 11 marks.
  - The text reads "5 / 8" with "glasses" beneath. It is one line of meaning on two lines, so "5 / 8 glasses" never ellipsizes in the 2x2.
  - Status: "N to go", then "Goal reached" with a check icon at the goal, plus "+N extra" past it. Verified at 0, 1, 4, 7, 8 and 11 with goal 8, at 6/6, and at 9/12 (3/6 earlier).
- **Host variables:** `drunk` and `goal` are exported. The taps change `drunk` in the document and send `addGlass` or `removeGlass` with the new count as a float. Verified with interact at 110² and 160².
- **Sizes:**
  - 2x2 (110² to 160²): good. Below 140 dp wide the +1 button becomes a "+" icon button.
  - 4x2 (320×160 and 256×120): good, with some empty space around the bottle.
  - Phone (360×640): it works, but the controls sit at the bottom with a lot of empty space. It is not designed as a phone screen.
  - 160×96 and 4x1 drop the count text (the bottle is tiny and the buttons stay). 4x1 is not supported.
- **Themes:** light and dark use theme colours only (the audit found no hard-coded colours). mono-dark and mono-light render cleanly: the water is a solid fill, the outlines are thin, and there is no motion.
- **Accessibility:**
  - The bottle has a live contentDescription: "Water bottle, 5 of 8 glasses drunk today".
  - The buttons are labelled "Remove a glass" and "+1 glass", or "Add a glass" below 140 dp. −1 is disabled at 0.
  - Weak spot: the description says "drunk today" but does not announce "Goal reached". That is only in the visible text, which is still readable.
- **Bytes:** 6,508 B. About 1.1 KB is the bottle, and the runtime-enabled −1 button is written twice.
- **Known weak spots:**
  - The wave does not move.
  - The done state changes no colour on the bottle.
  - The phone layout is sparse.
  - Shared action names across the stateLayout alternatives are fine in json2rc but would break in the reference Java JSON parser, according to the audit.
  - Values over 99 glasses would print badly (whole 2).
  - The −1 action sends a removeGlass even at 0, but it cannot fire then because the button is disabled.
