# Stopwatch with lap times: eval notes (run 1)

Final document: `stopwatch.json` (made by `gen.py`), `stopwatch.rc` (18,161 B), `stopwatch.html` (local playground).
Renders are in `out/`: six-laps-dark, running-light, watch-running, and v2-* (all the variants).

## 1. Tool calls (26 in total)

1. `list`: server and tool overview. I took the workflow from it: build_kit, then convert/render/audit, then publish.
2. `build_kit {"goal":"A stopwatch with lap times."}` (kit.txt): it returned TIM-14 (a stopwatch) and TIM-08, plus design rules. From TIM-14 I took the running/startAt/accumulated model, the label cut with textSubtext, and the pitfall that repaint is always continuous. Nothing in it covered the laps, which I designed myself.
3. `get TIM-14` (tim14.txt): the full JSON. I copied the variable model, the TimeText formatting and the Button usage.
4. `reference format` (ref-format.txt): I needed hostNamedAction with `"value":"@var","valueType":"float"`, the visibility rules (a declared 0/1 variable), stateLayout and verticalScroll.
5. `get Button`: confirmed that `enabled` accepts a runtime 0/1 variable and that a disabled button drops the click and is announced as disabled. I decided on three buttons (Reset, Start/Stop, Lap), with Lap enabled = @running and Reset enabled = stopped with time on it.
6. `convert check:true`: the first draft converted cleanly (16.8 KB). Info: unused_space.
7. `inspect interactions`: found only the toggle at (187,208), because the other buttons are disabled at rest. I needed the running layout.
8. `describe inspect`: to get the `actions` syntax for interact.
9. `inspect interact` (tap Start, include_layout): got the Lap (283,208) and Reset (83,208) coordinates from the outline.
10. `inspect interact` (start, lap, lap, lap, stop): the TS player gave the right l1..l3, minLap/maxLap and lapCount, and host actions startStop/lap with values.
11. `reference expressions`: I was looking for a way to stop the repaint while stopped. There is none (only continuousSec gives fractions).
12. `render` with touch_events (6 laps, C++ player): wrong. Every row was one lap behind ("Lap 6" showed lap 5's values) and the fastest lap was not marked. The cause was an action list that read `@lapAt` right after setting it in the same list: the C++ player read the stale value, while TS (call 10) read the fresh one. Fix: read @elapsed directly and send the host action first.
13. `render` again: correct. Lap 6 to 2, two tied Slowest, one Fastest. A zero_size warning came from the empty tag box, so I gave it a height.
14. `render variants:true` with over-an-hour variables: light, dark and mono were fine. Found three problems: totals over an hour printed "61:40.12"; on the watch the label "Resume" was cut to "Resu…"; the short and 4x2 sizes overflowed. Fixes: an h:mm:ss total switched by visibility, Start/Stop labels only, a compact layout below 260 wide OR 400 tall, and verticalScroll on the phone column.
15. `render variants:true` again: no findings on any variant.
16. `inspect interactions` at 200×200: watch targets at (65,119) Lap/Reset and (138,119) Start/Stop.
17. `inspect interact` on the watch (start, lap, lap, stop, reset): host actions carried the values and every variable was back to 0 after reset.
18. `inspect interact` on the phone: disabled Reset and Lap taps were not handled; start, lap, stop, reset worked; a second Reset was ignored. Host actions: startStop 0, lap 1.03, startStop 2.10, reset 2.10.
19. `inspect runtime` while stopped: "continuous". Three listeners on CONTINUOUS_SEC. This confirms the TIM-14 pitfall.
20. `inspect accessibility`: elapsed "Elapsed time 0:12.34"; buttons Reset, Start (Stop) and Lap (disabled); each lap row has "Lap N, lap time …, total …".
21. `audit`: 0 errors, 0 warnings; info repaint_continuous and never_executed.
22. `inspect bytes`: 18.1 KB. Expressions 35% and text 34%.
23. `render` on the phone, light theme, running with 3 laps: correct, with Fastest and Slowest marked.
24. `render` on the watch at 200×200, running with 2 laps: shows the time, the last lap, and Lap and Stop.
25. `convert check:true`: the final stopwatch.rc.
26. `publish` (local): stopwatch.html.

## 2. Dead ends and wasted calls

- Calls 7 and 9: the interactions list only shows targets that are enabled now, so I needed an extra interact with include_layout to find the Lap and Reset buttons. A "targets including disabled ones" option, or names next to the targets, would have avoided this.
- Call 8: I had to describe inspect to learn the `actions` syntax. The tool list does not show it.
- Call 12: the stale `@lapAt` read. The format reference says actions run "in order", and TIM-14 teaches "accumulated = @elapsed must run before…". Nothing warns that the C++ player may read a value set earlier in the same click list stale, or that TS and C++ disagree. The interact (TS) and the render (C++) results contradicted each other, and I lost a render to it.
- Call 11: a search for a repaint-free stopwatch. TIM-14's pitfall had already said it is impossible.
- Call 14: my over-an-hour test variables used inconsistent minLap/maxLap, so the marks were not exercised there. That was my mistake.

## 3. Wrong, misleading, noisy or missing in tool output

- **TS vs C++ disagreement on action order.** `valueFloatExpressionChange` → `lapAt = @elapsed + 0`, then `l1 = @lapAt + 0` works in inspect interact (TS) but gives the stale lapAt in render (C++). No tool flagged it, and neither the guidance ("Order the toggle's actions: accumulated = @elapsed must run before…") nor convert check mentioned it.
- **The "repaint only while running" requirement is impossible**, according to TIM-14's pitfall: "The format has no way to drop the listener when running is 0". Every clock-driven stopwatch therefore repaints every frame while stopped. The audit only says "info … Fine for an animation" and does not acknowledge this case.
- **The zero_size warning is noisy.** It fired on an empty box whose children were all visibility-hidden: "3 visible component(s) got no size from the layout, so they draw nothing". That was harmless, but the advice about weights and collapsible layouts does not fit the case.
- **The unused_space info is noise** for a list screen with few laps: "The content ends at 50% of the screen's height…".
- **Duplicate expressions.** The interact output showed the same `floor((var_87 % 60))` 3 or more times (one per use of the formatter). The bytes report does not say that identical float expressions are not shared, even though textMerge/textFromFloat objects are said to be.
- **Stray files.** `render variants` left unnamed `render-1793474205…png` files in out/ next to the named variants.
- **No watch variant.** `variants` has no watch-shaped (square, about 200) size. "tiny 180×384" is the closest. The tool list says "a watch tile 160–220 square" but variants does not render one.
- **The interactions target list lacks `center`** for some targets: target 0 had no center key in one response (call 16), so my script crashed.
- **Shared action names (U58).** The guidance says each control needs its own name, so I couldn't send "start" and "stop" as separate names from one toggle. The app gets "startStop" with the elapsed time and must read @running to tell them apart.

## 4. What I would have liked

- A way (or an explicit statement and an example) to make a clock-driven value idle while paused, or an audit note that a stopwatch must repaint.
- A warning in convert check when an action list reads a variable that an earlier action in the same list wrote, with the player difference stated.
- An example of "record values into a fixed-size history on tap" (shift registers l1..lN). build_kit matched "lap" to time.timer, but TIM-14 has no laps.
- An option for inspect interactions to list disabled or hidden targets, with labels.
- A watch size in render variants.
- A live-region or "announce" semantics option, so the elapsed time is read out on change.

## 5. Assessment of the final screen

- **Correctness:** start, lap, lap, stop gives the right totals and lap times in both players (verified by interact and render). The list shows the last 5 laps, newest first, as "Lap N", the lap time and the total. Fastest and Slowest are marked once there are 3 or more laps, over all laps; ties mark both. The main time switches to h:mm:ss over an hour, and so do the totals. Lap times stay m:ss.cc, so a lap over an hour shows "61:00.00". Precision: seconds-of-day floats have about 1/256 s granularity, so the hundredths can be off by 1.
- **Interactions:** Reset is enabled only when stopped with time on it, Lap only while running; disabled taps do nothing. Host actions are startStop, lap and reset (phone) and watchStartStop and watchLapOrReset (watch), each carrying @elapsed at the tap. Reset clears everything.
- **Sizes:** a phone layout at 260 wide or more and 400 tall or more, which scrolls if short. Otherwise a compact layout (time, last lap, Lap/Reset and Start/Stop buttons) used for watches (200×200 rendered) and small widgets. All variants have no findings.
- **Themes and mono:** only theme colours are used; light, dark, mono and mono-inverted all render correctly. In mono, Fastest and Slowest differ only by the word.
- **Accessibility:** the header description is set. The elapsed time has a label ("Elapsed time 0:12.34"), and each lap row has a combined description. Button labels follow the state (Start/Stop, Lap/Reset on the watch), and disabled buttons are announced as disabled. There is no live-region announcement.
- **Repaint:** **fails the requirement.** It is continuous while stopped (three continuousSec listeners). According to the tool guidance, the format cannot avoid this.
- **Bytes:** 18.1 KB. That is large, because of 5 lap rows times several formatted texts and the duplicated expressions.
- **Weak spots:** the always-on repaint, the 1/256 s rounding, lap times over an hour, and the single "startStop" action name.
