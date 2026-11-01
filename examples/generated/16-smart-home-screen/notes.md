# Smart home screen — eval notes (prompt 16, run 1)

Request: "A smart home screen: 4 rooms with light switches, the thermostat temperature and a door lock status."

Deliverables in this folder: `home.json` (the document), `home.rc` (21,125 B), `home-playground.html`
(published playground), `lightswitch.json` (the inline LightSwitch definition), renders in `out/`
(`variants-*.png`, `states-sample1..5.png`, `states-sheet.png`, `tablet-light.png`), every tool output
as `*.txt`. `home-statelayout-attempt.json` is the abandoned two-column version (see dead end 3).

## 1. Tool calls in order (44, counting `list` and two `describe`)

1. `list` — see the servers and tools. Took: the remotecompose workflow (build_kit → check_component → convert/render/audit → publish).
2. `build_kit` (goal verbatim) — got Gauge, Switch, Icon, layout model CMP-05, design rules, icon suggestions (lock, lock_open, door_open). `unmatched_terms: door, lock`. No `needs_component`. Decided: Gauge for the temperature, Switch for lights, TextChoice for state words, hostNamedAction per tap (rule "Taps reach the app").
3. `get Switch` — params: checked, label, color. No onClick param. Flagged the contradiction with the design rule.
4. `get INT-08` — the onClick list shape `[valueFloatExpressionChange, hostNamedAction]`, `resources.variables {x: {value, export: true}}`, visibility `"@v"` / `"1 - @v"`.
5. `get TextChoice` — the status-word component; index rounded and clamped.
6. `get ListItem` — considered for rows; later dropped (its subtitle is a static string, I wanted an On/Off TextChoice).
7. `find components "button"` — Button, IconButton, Stepper, Tabs; Button has onClick and an icon slot.
8. `get Switch definition:true` — confirmed onClick is hard-coded in the body (flip only). Decided to write my own LightSwitch from this definition with an `action` param.
9. `get Button` — surface param for outlined inside a Card; onClick takes a list.
10. `reference components` — authoring guide: param types (`variable`, `string` splicing), animated locals, mono rules, `$if theme.mono`.
11. `check_component LightSwitch` with sweep checked [0,1] — ok, 928 B, no lint findings; both cells right in light/dark/mono.
12. `reference format` — host variables, semantics, visibility rule, textMerge; no verticalScroll syntax.
13. `convert check:true` v1 — ok, 20,948 B, 6 host variables listed, 6 click targets.
14. `render variants:true` v1 — short/wide heights cut the lock card (no scroll); narrow clipped "Comfortable".
15. `find icons "room"` — wasted: my guessed names (weekend, cooking, bed, bathtub, lock, lock_open) all existed, as convert had just shown.
16. `get CMP-05 json` — found `{"verticalScroll": "@scroll"}` with `verticalWeight 1`.
17. `inspect interactions` v1 — 5 targets, each with ValueFloatExpressionChange + TextData + HostNamedAction; names shown as text ids only.
18. `audit` v1 — 0 errors/warnings; info: switch touch target 52×32 < 48 dp, never-executed click ops.
19. `convert` v2 (scroll, 48 dp hit box on the switch, stateLayout phone/tablet, subtitle fix) — ok, 29,159 B (cards duplicated).
20. `render variants` v2 — only narrow/small still clipped "Comfortable"; short sizes fixed by the scroll.
21. `render` 800×1100 light — two-column tablet layout fine.
22. `describe inspect` — interact `actions` syntax: `{target}`, `{tap:[x,y]}`, `{variables}`, `{wait}`.
23. `describe render` — found `samples` (several host-variable sets in one call).
24. `convert` v3 (thermostat card as a centred column) — ok 29,031 B.
25. `render samples` (all off, all on, unlocked, 12 °C, 29 °C) — all five correct (`out/states-sheet.png`).
26. `render variants` v3 — clean except the 180-px "tiny" widget size.
27. `inspect interact` tap kitchen (302,188) — kitchen 0→1, host action `kitchenLight`, nothing else changed. Correct.
28. `inspect interact` tap (290,657) Unlock — hit nothing: the card had moved down after step 24. My stale coordinates.
29. `inspect interact` 800×1100 tap bedroom — bedroom 1→0 but `host_actions: [{name: null}]`. The hidden stateLayout branch's click list owns the de-duplicated action-name text.
30. `inspect accessibility` — document description present; every text is a node; the 5 controls are clickable with role 255; the switch labels (contentDescription) are not shown in the output, only `text: None`.
31. `audit` v3 — 0 errors/warnings; same infos plus deep nesting ×13.
32. `convert` v4 (stateLayout removed; one column `width: min(windowWidth(), 560)` centred) — ok, 21,150 B.
33. `render variants` v4 — clean except tiny.
34. `render` tablet v4 — fine, centred 560 dp column.
35. `inspect interactions` v4 — Unlock centre now (290.6, 697).
36. `audit` v4 — 0/0/3 infos.
37. `inspect interact` target 4 (Unlock) — locked 1→0, `toggleLock`. Correct.
38. `inspect interact` variables locked=0 then tap Lock — `host_actions: [{name: null}]`: same text bug, now in a single layout (`toggleLock` shared by two buttons).
39. `inspect interact` 800×1100 target 2 — bedroom 1→0, `bedroomLight`. Correct at tablet width.
40. `publish` — home-playground.html, 731 KB, host variables listed.
41. `convert` v5 (distinct `unlockDoor` / `lockDoor` names) — ok, 21,125 B.
42. `inspect interact` locked=0 then tap Lock — `lockDoor` sent. Correct.
43. `publish` again — final playground.
44. (the `list` at the start is counted as call 1; two `describe`s are 22 and 23.)

## 2. Dead ends and wasted calls

1. **Switch cannot send a host action** (calls 3, 8). The kit's rule says "Library Switch/Button/IconButton take the same onClick list"; the Switch has no onClick param and its body hard-codes a flip-only click. Two calls to establish that, then a custom component. The kit should have said that Switch does not take onClick, or offered a `needs_component`/recipe for "a switch that tells the app".
2. **Icon search** (call 15) was unnecessary: convert had already accepted my guessed names. Avoidable by reading the convert result first instead of running the search in parallel as insurance.
3. **Two-column stateLayout for tablets** (calls 19–21, 29, 32–34): duplicating the cards in a stateLayout doubled the bytes (29 KB) and broke the hidden branch's host-action names (null). Replaced by a centred capped-width column. A note in the design rules that stateLayout duplicates subtrees (and that action-name texts don't survive it) would have steered me away.
4. **Stale tap coordinates** (call 28): I tapped where the Unlock button had been before a layout change. Using `{target: n}` from a fresh interactions list avoids it; I did so afterwards.
5. **Shared action name `toggleLock`** (call 38): costs one convert, one interact and one republish to fix (calls 41–43).
6. **`get ListItem`** (call 6) was not used in the end.

## 3. Wrong, misleading, noisy or missing in the tools' output

- **Wrong:** kit design rule "Taps reach the app": *"Library Switch/Button/IconButton take the same onClick list"*. Switch's params are `checked, label, color` only, and its body carries a fixed `onClick: valueFloatExpressionChange`. A Switch tap never reaches the app. The format reference says it correctly (*"A library Button/IconButton takes the same list"*), the kit does not.
- **Bug (converter or inspector):** a `hostNamedAction` name shared by two click lists is written as `TextData` once, inside the FIRST click list, and the second click only references the id. If the first click never ran (hidden stateLayout branch, or the Lock button when the door starts unlocked), `inspect interact` reports `host_actions: [{"name": null}]`. Whether a real player registers the text at load time or on click I could not tell from the tools, so I avoided shared names. The interactions listing does not resolve `textId=118` to its string either, so the only way to see the name is to run `interact`.
- **Missing:** the syntax of `verticalScroll`. The kit and the render size warning both say "put the content in a verticalScroll" and CMP-05 "teaches" *"verticalWeight 1 plus verticalScroll bound to a variable"*, but neither the kit snippets nor `reference format` show `{"verticalScroll": "@scroll"}`; I had to fetch CMP-05's whole JSON and grep it.
- **Missing:** `inspect accessibility` prints the switches as `role 255, text None, state None` and omits the `contentDescription` I set ("Kitchen light"), so I cannot confirm from the tool that the label reaches a screen reader; `has_semantics: true` and `click_areas: []` are the only hints. No "state" is ever reported, though the task asks for states to be announced.
- **Noisy:** `interact` lists every intermediate variable (TOUCH_POS_Y, `/ 960` ripple fractions, visibility expressions) before the ones that matter; `changed_host_variables` and `host_actions` are the useful part and should come first (they do, but buried under 14 rows of `changed_variables`).
- **Noisy:** `get INT-08` returned ~11 KB including the whole JSON twice (truncated snippet + full `json`), and `find components "button"` returned 15 KB for four components.
- **Misleading:** the size warning after `render variants` ("at 360×456 the content no longer fits…") is printed BEFORE the per-variant lines and is not tied to one of them; it took a moment to see it was the "short" variant.
- **Misleading:** `audit` flags my LightSwitch (52×32) as a touch target < 48 dp; the library Switch has the same size and is not called out anywhere in its pitfalls. I wrapped mine in a 52×48 box. The Button (40 dp high) is still flagged; that is the library's own height.
- **Unclear:** the format reference says visibility needs *"a DECLARED variable that is exactly 1 or 0"*, but INT-08 and my document use inline `"1 - @locked"` and it works (it is an integer expression). The rule reads as if an expression is forbidden.
- **Unclear:** `check_component` did not say whether `"name": "@action"` (a string param in a hostNamedAction) would be substituted; it passed the lint silently and only `interact` proved it works.
- **Minor:** `convert` prints the whole list of named theme colours (background, error, muted…) under `namedVariables` next to the real host variables; the `host_variables` finding line is the readable one.
- **Minor:** `find kind icons "room"` ranks meeting_room, room_service and spa first; no room-type icons (living room, kitchen, bedroom, bathroom), though `weekend`, `cooking`, `bed`, `bathtub` exist.

## 4. What I would have liked

- A kit entry for "switch that reaches the app": either an `onClick`/`action` param on Switch or a `needs_component` recipe (the Switch definition plus one param), instead of a wrong rule.
- The `verticalScroll` snippet in `reference format` and in the size warning.
- `interactions` resolving action-name text ids to their strings, and `interact` putting `host_actions` and `changed_host_variables` first and the rest under a `details` key.
- `inspect accessibility` printing each control's contentDescription and state, and a warning for a clickable with none.
- A warning from `convert check` or `audit` when a hostNamedAction name text is declared inside a click list that another click list reuses (or the converter hoisting such texts).
- A design-rule note that stateLayout branches are full copies (bytes ×2) and a suggested alternative (capped-width column, or a flow).
- `publish` returning the file path only once it is confirmed written; fine as is.

## 5. Honest assessment of the final screen

- **Correctness:** 360×760 phone screen: title, a Lights card with four rows (room icon, name, On/Off word, switch), a Thermostat card (Gauge 10–30 °C with value and label, a Cold/Comfortable/Warm/Hot word computed from the temperature) and a Front door card (filled lock icon in green when locked, open lock in amber when unlocked, Locked/Unlocked word, an Unlock or Lock button). Verified at all off, all on, unlocked, 12 °C and 29 °C.
- **Interactions:** verified with `interact`: tapping a room's switch flips that room only and sends `<room>Light`; Unlock sends `unlockDoor` and sets locked 0; Lock sends `lockDoor` and sets locked 1; works at 800 wide too.
- **Host variables:** living, kitchen, bedroom, bathroom, temperature, locked — all exported floats with sample values (1, 0, 1, 0, 21.5, 1). `scroll` is internal.
- **Themes / mono:** light, dark, mono and mono-inverted all render with no findings; the switch is outlined/filled by state in mono, the gauge shows tick marks instead of colour zones. Only theme colours are used.
- **Sizes:** variants narrow/wide/short/small are clean; the column scrolls on short screens; on a tablet the column is capped at 560 dp and centred (no two-column layout, see dead end 3). The 180-px "tiny" variant clips the On/Off words and the lock row (a half-width widget, not a phone).
- **Accessibility:** document contentDescription; every switch has contentDescription "<Room> light"; buttons are labelled Unlock/Lock; state is announced through the visible On/Off, Locked/Unlocked and comfort words (plain text nodes). Weak spot: the switch itself has no state in its own semantics (the format gives me no stateDescription), so a screen reader hears "Kitchen light" and separately "Off"; the gauge's accessibility label is "Indoor °C" with the number as a separate text.
- **Bytes:** 21,125 B .rc (6 icons account for a good share; the Gauge and four switches the rest). Playground 731 KB.
- **Known weak spots:** the thermostat zones are the Gauge's green/amber/red (no "cold" blue zone — the comfort word covers it); the lock buttons' 40 dp height is below the 48 dp touch target guideline; `tiny` width unsupported; the thermostat and lock cards do not sit side by side on a tablet.
