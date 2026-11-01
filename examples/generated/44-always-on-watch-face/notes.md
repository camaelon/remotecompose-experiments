# Eval 44, run 1: always-on monochrome watch face (time, date, battery)

Final document: `face.json` (source), `face.rc` (2,418 B in auto/themed mode; 1,806 B as rendered in mono).
Contact sheets I stitched locally from the tools' PNGs: sheet1 (clocks, v1), sheet4 (battery 100/50/14/3), sheet5/6 (themes, sizes), sheet7 (160 and 220 round, mono).

## 1. Tool calls (23)
1. `list`: discovered the tools and the 5-step workflow (build_kit, components, assemble, convert+render+audit, publish).
2. `build_kit` (goal verbatim) -> kit.txt: proposed BatteryIndicator, DateLabel, Icon, TIM-12 (sunrise layout model), TIM-02 (analog). "alway" unmatched. Took: BatteryIndicator pitfall that battery must be a host variable; watch design rule (inscribed circle, size from window, render 160/192/220). It did not propose the library's DigitalClock/AnalogClock.
3. `reference expressions`: clock functions (timeInHr, timeInMin, weekDay 1=Mon, dayOfMonth). Lists `batteryLevel()` as a plain host value with no caveat, contradicting the kit. Decided: battery is an exported host float `battery` (the watch-face host feeds it from the device), as the component pitfall says.
4. `find` examples (watch-face, ambient, battery): found CMP-10 (AnalogClock/DigitalClock), TIM-01. Took: "without seconds, once a minute" repaint.
5. `get DigitalClock`: each field is its own text and no weight/label params -> decided to write the time as one textMerge text (one readable node "10:10", thin weight).
6. `reference format`: semantics modifier with live textMerge contentDescription, textFromFloat flags, spacedBy, visibility needs a declared 0/1 variable.
7. `get TextChoice`: weekday by index; pitfall describes the global textSubtext trick for names.
8. `convert` check v1: ok, 2,689 B, no problems.
9. `render` clocks (10:10, Sat 31 23:59, Sun 1 00:00, Tue 29 Feb 2028) mono 192 round: dates right; `{"padding":{"left":4}}` silently ignored ("FRI30").
10. `render` sizes 160/220 + componentTheme mono + samples: DEAD END, sizes silently dropped componentTheme and samples (rendered the navy dark theme, battery 76 only).
11. `render` samples battery 100/50/14/3 mono: low state shows "!" in the body below lowAt 15. Fine but subtle -> decided to add a "LOW" word.
12. `inspect runtime`: "scheduled", once a minute (timeInMin). Good.
13. `inspect accessibility`: nodes "FRI", "30", "10:10", "Battery", "14%". Decided the date should read "Friday 30".
14. `get TIM-11` json: exact syntax for a canvas `global` textSubtext + textTransform (padding uses "start", not "left").
15. `render` v2 samples: date "FRI 30" as one text with a "Friday 30" description; LOW appears at 14 and 3.
16. `render variants` v2 at 23:59 battery 14: all looks fine, but the default dark theme background is navy (#101828), not black, which is wrong for an always-on face.
17. `render variants` v3 (resources.colors background {light white, dark black}): dark now black; mono-dark/mono-light unaffected.
18. `render` 160 round mono, 29 Feb 2028, battery 50: fits.
19. `render` 220 round mono, 23:59, battery 14: fits, scales up.
20. `inspect accessibility` v3: "FRI 30" described "Friday 30", "10:10", "Battery", "14%", "LOW".
21. `audit`: 0 findings.
22. `convert` check final: ok, 2,418 B, host var battery.
23. `inspect runtime` at 23:59:30: scheduled, minute boundary.

## 2. Dead ends / wasted calls
- Call 10: combined `sizes` with `componentTheme` and `samples`; the result silently ignored both (no warning). Cost one call plus the two follow-up single renders (18, 19). A warning, or applying them per size, would have avoided it.
- Call 14 (get TIM-11) was needed only because the TextChoice pitfall describes the global textSubtext trick in prose without the JSON keys; one snippet would have saved it.
- The `padding: {left: 4}` attempt (call 9) failed silently; the format reference never lists the padding object keys (start/end/top/bottom).
Count: 1 clear dead end (call 10), 1 half-wasted render (padding).

## 3. Wrong, misleading, noisy or missing in the output
- Battery source contradiction: reference expressions lists "batteryLevel() powerState() networkSignal() memoryFree()" as ordinary values, while BatteryIndicator says "There is no portable system battery level: batteryLevel() (system variable 38) is an rcj/json2rc extension that the Java parser rejects". The user asked for the battery "from the device": the honest answer is that the host must push it, which only the component pitfall tells you.
- build_kit did not offer DigitalClock/AnalogClock for a watch face asking for "the time", and unmatched "alway" (always-on) plus `find` unmatched "ambient" and "mono", though mono is a first-class componentTheme. No always-on/ambient guidance in the kit (black background, few lit pixels, thin weight).
- The kit's layout model for a watch face is TIM-12, a phone sunrise card (16 KB, astronomy formulas): pure noise for this goal.
- render: `sizes` silently drops `componentTheme` and `samples` (see dead ends).
- render variants: "round 192×192 (a small watch)" while the kit says watches are 160-220 dp and tells you to render at 160; the variants never include 160.
- The default dark theme background is #FF101828 (navy). For a watch face/always-on that is a lit, bluish full screen; nothing warns about it. The mono-dark look is black, but a watch in normal dark mode would show navy.
- Name drift: render takes componentTheme "mono"; get_component/variants call it "mono-dark"; render describes it as "mono" or "mono-light".
- textTransform operation 3: format reference says "uppercase | lowercase | capitalize (the numbers 1, 2, 3 mean the same)", i.e. 3 = capitalize, but TextChoice/DateLabel pitfalls and TIM-11 use operation 3 as "trim". One of them is wrong (it trimmed correctly in render).
- inspect runtime: at 23:59:30 it said `"delay_ms": 29002, "requested": "every ~29002 ms"` but the cause says `"in 59121 ms — the next minute boundary"`; at 10:10:00 the two were 59002 vs "in 29835 ms". The numbers look swapped or inconsistent, and "every ~29002 ms" reads as a 29 s repaint cadence.
- `{"padding": {"left": 4}}` is accepted and ignored with no finding.
- BatteryIndicator's ANIMATED_FLOAT/LoopOperation (12 loops for a battery icon) are unexplained in the op counts; harmless (runtime still once a minute).

## 4. What I would have liked
- An "always-on / ambient" design rule in build_kit (black, <~15% lit, no seconds, thin weights, dimmed secondary text) and a watch-face example that is already mono-first.
- A single statement on battery: "on device, the watch-face host must set @battery; batteryLevel() only works in these renderers".
- render: a captioned contact sheet for clocks/samples (I stitched PNGs myself), and the ability to combine sizes x componentTheme x samples, or at least a warning when an option is ignored.
- A lit-pixel percentage in render findings (it reports dominantFraction in convert, but only there).
- Padding object keys in the format reference.

## 5. Assessment of the final face
- Choice: digital, 24 h. Reasons: one big number is the most legible at a glance and at 160 dp; a single layout text reads as "10:10" to a screen reader; no second hand temptation; 24 h avoids an AM/PM marker the library lacks. Analog would light fewer pixels but needs a dial to be readable and is harder to announce.
- Correctness: time, weekday and day correct at 10:10, Sat 31 23:59 -> Sun 1 00:00, Tue 29 Feb 2028. Battery 100/50/14/3 render right; below 15 the icon shows "!" and a "LOW" word appears (shape + text, so it reads in mono).
- Sizes: text sizes derive from min(windowWidth, windowHeight); fits 160, 192, 220/227 round, and survives narrow/short/tiny variants. Battery icon size is static (26 dp; component param is static), so it looks slightly small at 220.
- Looks: black background (dark and mono), white thin time, grey date, small outlined battery. Lit pixels roughly 4% (convert reported dominant background 95.7%). Light theme is a white face, mono-light white for e-ink.
- Repaint: scheduled at the minute boundary only (timeInMin), no animation, no seconds; date names come from the same minute-driven pass.
- Accessibility: header description; date node "Friday 30"; time "10:10"; battery "Battery", "14%", "LOW". Weak: battery announced as three nodes, and no single merged "10:10, Friday 30" announcement.
- Bytes: 2,418 B (themed), 1,806 B (mono).
- Weak spots: battery depends on the host pushing `battery` (default 76 shown until it does); English names only; the BatteryIndicator fill at 100% is a solid white block (more lit pixels than an outline would be); in the colour dark look the low battery is red (not monochrome there, by the component's design); no burn-in shifting.
