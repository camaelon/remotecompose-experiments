# Pomodoro timer screen: tool-server usability notes (run 2)

Request: "A Pomodoro timer screen: 25 minutes of work, 5 minutes of break, a ring that empties, start/pause and reset."

Result: `screen.json` (9237 bytes as .rc, 478 ops), `page.html` (local playground, 621 KB). 26 tool calls, 0 dead-end tool calls (two shell mistakes on my side, see section 2).

## 1. Every tool call in order

1. `list remotecompose` — 11 tools on the `remotecompose` server (plus rc-examples, rc-render, rc-inspect, json2rc, guide as separate servers in the same listing). The server description already gives the 5-step workflow. Decided: follow it, start with build_kit.
2. `build_kit(goal)` — resolved to time.timer/countdown/clock, components Button + ProgressRing, and three examples: TIM-14 (a stopwatch with a 25-minute Pomodoro ring, Start/Pause/Resume toggle, Reset, fitBox for small hosts), CMP-05 (list screen, as "layout model"), TIM-08 (launch countdown). `needs_component` absent, `not_covered` empty. Decided: TIM-14 is 80 % of the answer; copy its state model (running / startAt / accumulated), its button-label trick and its fitBox; add a work/break cycle on top.
3. `get TIM-14 (json, meta, pitfalls)` — full JSON (6.6 KB), 9 pitfalls, the `check` block with the verified tap coordinates and expected variable values. Learned: continuousSec() wraps hourly (use timeInMin()*60 + continuousSec()%60), valueFloatExpressionChange refuses literals, the three toggle actions must be ordered, don't switch three buttons with visibility (U45), the ring animates 0.3 s so renders that set variables need duration 0.5. Decided: reuse its TimeText/Header/Controls structure, drop tenths (a Pomodoro counts down whole seconds), count down instead of up.
4. `reference expressions` — functions, clock values, no comparison operators, step(x, edge), 32-entry limit. Learned how to derive a phase: step(cycleT, workLen). Noticed a contradiction about ifElse (see section 3). Decided: avoid ifElse, use step + arithmetic masks.
5. `reference format` — layout essentials, fitBox semantics (heights are thresholds, chosen child stretched), TextChoice component for a text picked by index, weights ignore spacedBy. Decided: TextChoice for the "Focus"/"Break" label; keep TIM-14's textSubtext trick for the Button label because a Button's label is a string param, not a layout text.
6. `find icons "coffee break"` — `coffee`, `local_cafe`. Decided: header icon `timer` during work, `coffee` during the break.
7. `get TextChoice` — params and pitfalls: index rounded and clamped, each item a GONE text, about 90 B per item. Decided: index "@isBreak", two items.
8. `find examples "show hide by visibility variable"` — LAY-12 and TIM-13: `{"visibility": "@var"}` reads the variable's integer value, so the variable must be exactly 0 or 1 (step, 1 - x). Decided: two ProgressRings (primary / success) and two Icons in boxes with visibility @isWork / @isBreak.
9. Wrote screen.json, then `convert(check: true, render: true)` — ok, 9237 bytes, 6 click targets (the 3 fitBox alternatives with buttons × 2), host variables listed. The "render" part gave only statistics (changedFraction, distinctColors), no image path. Decided: render variants explicitly.
10. `render` fresh (dark, clock pinned) — 25:00, full ring, Focus, Start/Reset. No findings.
11. `render` light, accumulated 754.3, duration 0.5 — 12:26, half ring, Resume. Correct.
12. `render` break (accumulated 1620) — 03:00, green ring at 60 %, coffee icon, "Break". Correct.
13. `render` componentTheme mono — white arc on a thin grey track, outlined buttons. Readable.
14. `render` componentTheme mono-inverted, break state — black on white. Readable.
15. `render` 240 × 200 — fitBox picked the compact column: header, 12:26 Focus, buttons. Fits.
16. `render` 360 × 140 — fitBox picked the single row: time + Focus left, buttons right. Fits.
17. `inspect interactions` — six click targets with bounds and centres; targets 0/1 are the visible Start (154, 364) and Reset (243, 365). Targets 2 to 5 belong to the fitBox alternatives that are not shown (bounds like 3 × 40 at x 181) — noise but harmless.
18. `inspect interact` tap, wait 1.5, tap, wait 1, tap, wait 1, tap — accumulated 2.5703, startAt 37203.6, state 1 (label Resume), remaining 1497.43, remWhole 1498, ring 0.9983. Start/Pause/Resume/Pause works exactly like TIM-14's verified run.
19. `inspect interact` with accumulated 900: tap Start, wait 1, tap Reset — accumulated back to 0, remaining 1500, ring 1, state 0 (Start). Reset works mid-run.
20. `render` accumulated 1498, tap Start at 0.2 s, duration 4 — 04:59 "Break", green ring, coffee icon, label Pause. The break follows the work period while running.
21. `render` tap Start then 65 s — 23:56 Focus, Pause, ring just open. Correct.
22. `audit` default size — 0 errors, 0 warnings, 3 infos: touch targets 40 dp tall (the library Button's fixed height), continuous repaint (continuousSec, expected for a timer), 18 never-executed ops (the click actions, expected).
23. `audit` 240 × 200 — same three infos; the touch-target list includes the hidden fitBox alternatives at y = -50.
24. `publish(output_path: "page.html", publish: false)` — wrote page.html (621 KB), listed the host variables and theme colours it exposes. Nothing uploaded.
25. `render` 600 × 360, accumulated 1900 — "Session 2", 23:20 Focus, ring 93 %. The cycle wraps correctly.
26. `inspect accessibility` — document description set; Start and Reset are clickable with content descriptions; the texts (Pomodoro, Session 1, 25:00, Focus) are exposed.

## 2. Dead ends and wasted calls

- No tool call was a dead end: every call returned something I used. Two shell mistakes on my side cost time but no tool calls: a `echo ======` line that zsh read as a command, and a `$CLI` variable holding a whole command line that zsh does not word-split, so a batch of seven renders failed before reaching the server. Fixed with a tiny wrapper script.
- Call 9's `render: true` on convert was effectively wasted: it rendered but gave back only numbers (changedFraction, distinctColors, contentBounds), no image path, so I rendered again anyway (call 10).
- build_kit's CMP-05 (contacts list, 7 KB of the 26 KB response) and TIM-08 (UTC launch countdown) were not useful for this goal; TIM-14 alone covered it. I read them, decided they were irrelevant, and moved on.
- Call 17 (interactions) was mostly redundant: I had already guessed the button centres from the render (138, 363) and those taps hit; the listing confirmed it but also listed four phantom targets from hidden fitBox branches.

## 3. Wrong, misleading, noisy or missing

- **Contradiction in `reference expressions` about ifElse**: one sentence says "ifElse(whenFalse, whenTrue, cond) — the CONDITION IS THE LAST ARGUMENT", the next line's function list says "ifElse(cond, a, b) (cond non-zero picks a)". I avoided ifElse entirely because of this. One of the two is wrong.
- **convert with `render: true` returns no image.** The result has a `render` block of statistics but no PNG path or inline image, unlike `render`. Either return the image or say "use render to see it".
- **Phantom click targets.** `inspect interactions` and the audit's touch-target finding list the buttons of fitBox alternatives that are not displayed (bounds 3 × 40 dp, or at y = -50). They are not reachable and should be filtered out or marked "in a hidden fitBox child". The audit's "Touch Target < 48dp ×6" is really ×2.
- **Touch-target info for the library Button.** The audit flags the library's own Button (40 dp high, control_height) at every size. The library sets that height, so either the rule should know the library's choice or the Button should be 48 dp. As a user I cannot fix it without writing my own button.
- **build_kit's layout_model is generic.** For a timer screen it attached a contacts list (CMP-05) with three large snippets (TopBar, ListItem, Divider) as "structure the screen like this". That is 7 KB I had to read to find out it did not apply. When the best example is already a complete screen of the same kind (TIM-14), the layout model should be that example, or omitted.
- **Nothing in build_kit about phases / switching content by a value.** The goal says "25 minutes of work, 5 minutes of break", which implies a phase that changes what is shown (label, colour). build_kit resolved "pomodoro" to time.timer only and gave no capability or snippet for visibility / TextChoice; I needed two extra calls (format reference, a find for visibility) to learn `{"visibility": "@var"}` and that the variable must be an exact integer.
- **TIM-14's pitfall text says "see check.renders"**, but the `check` block in the get result is only partially readable: its `describe` text is truncated mid-sentence in the build_kit `verified` field ("Reset (243,2"). Minor.
- **The `find` result for icons** returned `pause` and `pause_circle` for "coffee break" because "break" is a tag; harmless, but the ranking put them above nothing better.
- Nothing the tools said was factually wrong for what I built: TIM-14's pitfalls (continuousSec wrap, action order, duration 0.5 for animated rings, exact-integer visibility) all held in the simulations.

## 4. What I would have liked

- A build_kit that recognises "work ... break" as a phase and points at TextChoice + visibility directly (one capability id like `layout.state` with its snippet), instead of me finding it through the format reference and a search.
- A `check`-style recipe in TIM-14's result I could rerun as-is: it has `renders` and `interact` entries with expected values; a tool that executes an example's check block against *my* document (same taps, same variables) would have replaced calls 17 to 21.
- `render` with `variants` (the schema lists a `variants` parameter) is not explained anywhere in the tool descriptions I read; one call producing the standard contact sheet (light, dark, mono, mono-inverted, narrow, short) would have replaced seven calls. I did not try it because its format was undocumented in the listing.
- A colour param that can take an expression or a `{"$if"}` on a variable, so a ring that changes colour with the phase does not need two rings and two visibility boxes (which doubles the ring's ops and the animated locals).
- A way to simulate long durations cheaply: I tested the 25-minute boundary by setting accumulated to 1498 and running 4 s, which worked, but the tools could offer a "clock jump" action in interact.
- The convert check could state the chosen fitBox child per size, or the audit could run the standard sizes itself, instead of me rendering each size.

## 5. Honest assessment of the final screen

- **Correctness**: the ring empties from full to empty over the 25-minute work period (verified at 65 s, 754 s, 1498 s and at the 1500 s boundary), then refills and empties over the 5-minute break (verified at 1620 s: 03:00, 60 %), then starts work again as Session 2 (verified at 1900 s). Start / Pause / Resume toggle on one button, Reset clears to 25:00 Focus from any state. The countdown text uses ceil so it reads 25:00 at the start and 00:01 just before the switch. The transition is automatic while running; it depends only on the clock and three host variables, so a host can restore a session.
- **Known limits**: the phase switch is silent (no sound or vibration, the format has none here); the document repaints every frame even when paused (inherent to continuousSec, the audit says so); the two rings and two icons double a little of the ops; when the ring switches from work to break, the break ring animates 0 → 1 over 0.3 s instead of appearing full (cosmetic).
- **Small sizes**: 240 × 200 falls back to header + time + buttons; 360 × 140 to one row; anything smaller shows the time and phase alone. Nothing overflowed in any render and the audit at 240 × 200 reported no overflow. The "Focus" label beside the time in the compact rows sits at the baseline and reads a bit loose; acceptable.
- **Light / dark**: both rendered with theme colours only (no literal colours in the document, the audit raised no hardcoded_colors); the break ring uses @colors.success, which contrasts in both.
- **Mono / mono-inverted**: the library components' mono variants produce a white (or black) arc on a thin grey track with outlined buttons; the phase colour distinction disappears, which is fine because the icon and the "Break" word carry it.
- **Accessibility**: Start/Resume/Pause and Reset carry their labels through the Button's semantics; the document has a contentDescription; touch targets are 40 dp high (library default), below the 48 dp recommendation.
