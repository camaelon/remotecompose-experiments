# Flight status card — eval notes (prompt 19, run 1)

Files: `doc.json` (source, with three inline components), `doc.rc` (17,285 B), `flight-status.html`
(published playground), `out/` (renders), `*.txt` (every tool output), `rc.sh` (wrapper), `notes.md`.

Decisions made without asking:
- Host strings: `flight`, `depCode`, `depCity`, `arrCode`, `arrCity`, `gate`, `status` (the word shown).
- Host numbers: `depMin`, `arrMin` = scheduled local time as minutes of the day (0..1439; 1440 and
  over means the next day: 1510 shows "01:10" with a "+1" badge); `progress` 0..1 (clamped);
  `statusIndex` 0 on time, 1 delayed, 2 boarding, 3 in flight, 4 landed. The word is a host string
  as the brief asked, but a colour cannot be computed from a string, so the colour and icon come
  from `statusIndex` (the app sets both; they must agree). The word is ellipsised when long.
- Status looks: on time = green check_circle, delayed = red warning triangle, boarding = amber
  flight_takeoff, in flight = blue flight, landed = muted flight_land. In mono the icon shape
  alone carries the state.
- Progress line: a canvas; the plane is drawn with primitives (three ovals) rather than the Icon
  component because nothing I tried positions a layout node by an expression in the renderer
  (see dead ends). Everything is scaled from componentWidth()/componentHeight() and the `plane` size.
- Sizes: a `stateLayout` picks one of four layouts from `windowWidth()`/`windowHeight()`:
  0 full (>= 240 wide, >= 120 high), 1 strip (< 120 high), 2 square (< 240 wide), 3 mini (both).

## 1. Tool calls in order (36)

1. `build_kit` (goal verbatim) — resolved card/transit/loading-state; Card + Icon components;
   examples TIM-12 (sun path, as the "layout model"), HST-01 (host card), DOC-03 (moving dot);
   no `needs_component`; icon suggestions flight/flight_takeoff/flight_land/gate. Took the design
   rules (state colour by visibility copies, TextChoice, host strings as root variables) and
   HST-01 as the real template. Decided TIM-12 was too far from the task to fetch.
2. `reference format` — JSON essentials: modifiers, visibility needs a declared 0/1 variable,
   widget sizes (4x2 320×160, 4x1 320×80, 2x2 160×160), textMerge/textFromFloat flags,
   semantics syntax, stateLayout. Core of what I built on.
3. `get TextChoice` — not needed in the end (status is a host string), but its pitfalls described
   the "0-size canvas global block with varName" trick I then tried.
4. `get HST-01 (json)` — exact syntax of exported string/float variables and a progress canvas.
5. `reference expressions` — step(x, edge) argument order, floor, no comparisons, 32-entry limit.
6. `reference components` — component definition syntax, locals, $if on a param, mono rules.
7. `get TIM-11 (json)` — to see the global-block text-op syntax (textSubtext/textTransform with
   varName, canvas `{"size": 0}`).
8. `convert check` — my own JSON brace error (position reported, fixed locally). Wasted.
9. `convert check` — "NotImplementedComponent: canvas command 'textfromfloat'": the global-block
   plan for a shared formatted time failed. Reworked: time formatting inside the Endpoint component.
10. `convert check` — ok, 15,971 B; design warning `ignored_key "align"` (my component's param
    name, a false positive). Renamed it `side`.
11. `render variants` — all themes/sizes; tiny (160×96) zero-size weight + clipped texts; small
    (230×96) clipped "Gate". Image showed the plane stuck at the left end and not rotated.
12. `audit` — one dead variable (`pct`), deep nesting info. Removed `pct`.
13. `inspect layout` — the spacer box measured 62 dp (correct) in the inspector, so the renderer
    and the inspector disagree on an expression width.
14. `check_component FlightLine` with sweep 0..1 and two plane approaches (spacer width,
    graphicsLayer translationX) — neither moved the plane correctly; rotationZ worked. Decided to
    draw the plane on the canvas.
15. `convert check` — new FlightLine, mini layout: ok, 17,028 B.
16. `render variants` — no findings at any size.
17-19. `render samples` ×3 (4x2 / 2x2 / 4x1) with `output_width` only — all refused: "give both
    output_width and output_height, or neither". Wasted.
20-22. `render samples` ×3 again with both — 4x2: long city names starved the middle column
    (zero_size, clipped "Gate"); 2x2 and 4x1 fine, "+1" badge and 01:10 correct.
23. `convert check` — weighted columns, ellipsis on status, threshold 120: ok, 17,137 B.
24. `audit` — clean (0/0/0).
25. `render variants` — clean at every size.
26. `render samples` 4x2 (6 states, 2× zoom) — all clean; long names ellipsised.
27. `render samples` with `componentTheme: "mono"` — IGNORED: images are the dark theme.
28. `inspect accessibility` — root description "Flight UA 1452, In flight. From San Francisco at
    15:05 to New York at 18:50. Gate B12", progress box "Flight progress 45 percent", status icon
    labelled. Added a label to the "+1" badge afterwards.
29. `convert check` — ok, 17,268 B.
30. `audit` at 160×160 — clean.
31. `audit` at 320×80 — clean.
32. `render` 360×240 light — phone width fine, no findings.
33. `publish` — flight-status.html (752 KB page, 17,285 B rc), 11 host variables listed.
34. `inspect bytes` — 22% expressions, 15% paths (5 icons, 2.5 KB), 15% text.
35. `convert check` — final doc.rc in sync after adding the rounded clip.
36. `render` default — final dark 4x2 confirmed.

Calls that never reached the server (not counted): a zsh quoting slip on calls 2-4's first attempt,
and `call remotecompose describe render` (describe is a CLI subcommand; redone as `describe`).

## 2. Dead ends and wasted calls (8 of 36)

- Call 8: my own malformed JSON. Avoided by validating locally first (I now do).
- Call 9 + the TIM-11 fetch (call 7) feeding it: the format reference says a canvas `global`
  block takes "text ops: textFromFloat, textMerge, textSubtext, textTransform, textLookup", and the
  TextChoice pitfalls recommend the 0-size-canvas trick. The converter refuses textFromFloat there.
  A correct list in the reference would have avoided two calls and a rewrite.
- Calls 11-14 (partly): positioning the plane Icon by an expression width. The format reference
  ("width/height take a @variable or an expression"), the component guide ("for a fraction of the
  parent, use width: @go * (componentWidth() - padding): in a modifier, componentWidth() is the
  parent's full width") and the inspector (62 dp, right) all say it works; the render engine drew
  it at ~0-20 dp. graphicsLayer translationX was not applied either. Two calls lost, plus a redesign.
  A note that the C++ renderer does not evaluate componentWidth() in a width modifier (or a
  renderer-agreement warning) would have avoided it.
- Calls 17-19: `output_width` alone refused although the tool description says "output_width /
  output_height scale the document to fit" as if either suffices. The description should say both
  are required (or accept one and keep the aspect).
- Call 27: `componentTheme` silently ignored with `samples`; the result claims success. Wasted.

## 3. Wrong, misleading, noisy or missing in the tools' output

- reference format: "global {commands} (text ops: textFromFloat, textMerge, textSubtext,
  textTransform, textLookup)" — textFromFloat (and so textMerge of a computed number) is refused:
  "NotImplementedComponent: canvas command 'textfromfloat'". There is no way to format a number
  once and reuse it in several texts and in a contentDescription; I had to write the HH:MM
  textMerge tree four times (two Endpoint calls per layout expand it; the root description repeats it).
- reference format / components guide: expression widths. "width/height take a "@variable" or an
  expression" and "{"width": "@go * (componentWidth() - padding)"}: in a modifier, componentWidth()
  is the parent's full width". The renderer disagrees with the inspector (inspect layout: 62.11 dp;
  render: the box at ~0-20 dp). One of the two engines is wrong and nothing says which matches Android.
- Same for `graphicsLayer.translationX` with an expression: the guide lists translationX among
  animatable paint-time values; the render ignored it. rotationZ worked.
- render: "output_width/output_height scale the document to fit" but one alone is an error.
- render: `componentTheme: "mono"` with `samples` is ignored without a word; the images are dark.
- convert design warning `[ignored_key] "align" is not a RemoteCompose key (3 use(s))` fired on my
  own component's parameter (`align` in Endpoint calls). The scanner reads call arguments as format
  keys; a param name that collides with a format word is flagged. False positive, noisy.
- build_kit: the "layout_model" is TIM-12 (a 16 KB sun-path document) for a flight card; HST-01 was
  the useful one. `unmatched_terms: flight, airport, gate` yet icon suggestions found them. No
  `needs_component` although the brief's "progress line with a plane" has no library component
  (ProgressBar was not even suggested). The 12-rule `design` block repeats the server instructions.
- build_kit/design: "a state colour is two coloured copies switched by visibility (LAY-12)" is the
  only option offered; it costs five copies of the pill per layout (StatusMark ×4 layouts = 20 rows,
  ~3 KB). No host colour variable alternative was shown with syntax.
- inspect accessibility: the root node reports `"text": "Flight "` (the first fragment of the
  textMerge) — a quirk; the full merged string is on the box below it.
- check_component sweep: the contact sheet is small (5 cells in 360 px); no zoom option, so the
  20 dp plane could not be judged there; I used render with output_width/height instead.
- The format reference does not say how a host sets a time (no "minutes of the day" convention
  example); I chose minutes and documented it.
- Nothing warns that a 4x2 host minimum (250×110) is below the header 320×160 until you read the
  one line in reference format about hosts giving "250×110 up to 360×190".

## 4. What I would have liked

- A reliable way to declare a formatted text once (named text from textFromFloat/textMerge) and
  reuse it in texts and in semantics descriptions.
- A statement of which engine (render vs inspect) is the Android oracle when they disagree, or a
  warning in render when a modifier expression could not be evaluated.
- A library component for "a marker along a track" (a plane/dot on a route line), or at least a
  `needs_component` entry for it from build_kit.
- A status/state pill component taking an index and a list of (icon, colour, label) so the
  five-copies-with-visibility pattern is written once.
- render `samples` honouring `componentTheme`, and `samples` combined with `variants` or several
  sizes in one call.
- A zoom option on check_component's sweep and on render variants.
- build_kit returning HST-01 as the layout model for a "card" goal, and fewer repeated design rules.

## 5. Honest assessment of the final card

- Correctness: flight number, codes, cities, HH:MM times (zero-padded, 24 h), gate, status word,
  status icon+colour, progress line with a plane. Arrival past midnight shows "01:10" with a red
  "+1" badge (checked at 1510 and 1505). Progress 0 and 1 put the plane on the departure / arrival
  dot. All five statuses rendered. Long city names and a long status word ellipsise. Times are
  24-hour only (no AM/PM option).
- Host variables: 7 strings, 4 floats, all exported with sample values; listed by convert and publish.
  The app must keep `status` and `statusIndex` consistent (a weak spot by design of the format).
- Sizes: 4x2 full layout, 4x1 strip, 2x2 square, 2x1/230×96 mini, phone 360×240 fine (type could be
  larger on a phone; it keeps widget sizes). Verified with variants (10 renders, no findings),
  samples at 320×160, 160×160, 320×80 and audits at three sizes (clean). Not checked: 110×110 and
  250×40 host minimums (the mini layout should cover the first; a 40 dp strip is a known weak spot).
- Themes: light/dark via theme colours only (no literal colour anywhere); mono and mono-inverted
  rendered and look right; in mono the done part of the line (white) vs track (grey) is subtle.
- Accessibility: root description reads flight, status, route with cities and times, gate; the
  progress box announces the percentage; status icons carry labels; "+1" badge labelled. The
  description was only checked via inspect accessibility (TS), not on a device.
- Byte size: 17,285 B; 2.5 KB in five icon paths, ~3 KB in the status copies, 22% expressions
  (four layouts each carry their own time formatting). Could drop to ~12 KB with fewer layouts.
- Known weak spots: plane is a hand-drawn glyph (three ovals), not the Material icon; the plane
  position relies on canvas expressions only (works in this renderer; the expression-width path did
  not, so the real-device behaviour of either is unverified); status word duplicates statusIndex;
  no tap action (none requested); the strip layout at a host's 40 dp minimum will clip.
