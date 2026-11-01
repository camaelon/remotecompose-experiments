# 46-run1: 2x2 clock and weather widget

Final document: `widget.json` (source, written by `gen.py`), converted to `widget.rc` (27,828 B).
Contact sheets: `sheet3.png` (themes, mono, sizes), `sheet-samples.png` (conditions, day/night, temperatures, 12h),
`sheet-clk.png` / `sheet-mid24.png` (23:59 -> 00:00 in 12h and 24h), `sheet-h12c.png` (12h at each size), `sheet-mono.png`.
Tool outputs I relied on are saved as *.txt. I made 26 tool calls in all (the `list` included).

## 1. Tool calls in order

1. `list`: what the tools are. I took the workflow from it (build_kit, components, convert check, render variants, audit).
2. `build_kit` (the goal exactly as the user wrote it): it gave DateLabel, WeatherIcon and Icon, with LAY-14 (collapsibleColumn), TIM-03 and TIM-13, plus design rules. WeatherIcon has only sun, cloud, rain, snow and storm, and its condition is static. It has no fog, no partly cloudy and no night, so I chose Material `Icon`s switched at run time instead.
3. `find kind terms` ["12-hour","24-hour","time format","digital clock","is24HourFormat"]: this led me to DigitalClock. "12-hour" and "24-hour" were silently dropped (see 3).
4. `get DigitalClock`: its format is a static 24h/12h param, and 12h has "no AM/PM marker". It does not follow the device setting. I took its formulas for the 12-hour hour and the padding flags.
5. `reference expressions`: I looked for a system 12/24-hour value and found none. timeInHr()/timeInMin() repaint once a minute. I decided the app sends `use24h` (0/1) as a host value, from DateFormat.is24HourFormat.
6. `reference format`: it gave me the syntax for host floats and host strings (a root `variable` command), visibility, stateLayout, fitBox, collapsibleColumn, the textFromFloat flags, autoSize and semantics.
7. `get TextChoice`: weekday, month and AM/PM names picked by index as layout texts, so a screen reader can read them.
8. `find icons "weather"`: it confirmed cloud, rainy, weather_snowy, thunderstorm, partly_cloudy_day and clear_day. I guessed clear_night, partly_cloudy_night and foggy, and they worked.
9. `reference components`: the authoring guide, for inline component syntax ($if, static params).
10. `convert` check: ok at 22 KB. Its findings were the host variables and unpainted corners.
11. `render variants`: themes and mono were fine. The time and temperature were clipped at narrow sizes, 160x96 picked the wide layout, "October" was clipped at 256x120, and the date got 0 size at short sizes.
12. `render variants` again after adding autoSize, a width condition on the wide layout and short month names: clean. But at short heights the collapsible column dropped the weather and kept the date.
13. `render variants` after adding a third "short" layout (time and weather only, chosen when height < 120): every variant was clean. I looked at sheet3.
14. `render samples` (12 host sets: every condition, night variants, -12, 38, 12h, °F 100.4): every one was right. In 12h, "PM" sat far right because the digits text was weighted.
15. `render sizes` in 12h at 12:59: "PM" was clipped at 115 and 110 wide. Only 6 of the 7 sizes I passed rendered.
16. `render sizes` with the time font size as an expression variable ("@tfs" = min(36, …)): wrong. The digits came out bigger than 36 and PM vanished, with no warning. Dead end, reverted.
17. `render sizes` with the 12h time as a fitBox of three font sizes (a text's minimum width is its one-line width, so the first that fits wins): right everywhere except 80x96.
18. `render clocks` 12h (31 Dec 23:59, 1 Jan 00:00, 00:00 and 12:00), after adding a fourth fitBox size: 11:59 PM, then 12:00 AM with the date rolled over, and 12:00 PM at noon. Correct.
19. `render clocks + sizes` (24h midnight at two sizes): `clocks` was ignored silently and it rendered the wall clock. Wasted.
20. `render clocks` 24h, light: 23:59 Thu 31 Dec, then 00:00 Fri 1 Jan. Correct.
21. `audit`: 0 errors, 0 warnings, one info about nesting depth 9.
22. `inspect runtime`: "scheduled", every ~59 s on timeInMin (once a minute, as required).
23. `inspect accessibility`: the time, "Sat", "31", "Oct", the icon labelled "Partly cloudy" and "18°C" are all readable.
24. `inspect bytes`: 27.8 KB, 42% of it the 9 icon paths (11.7 KB).
25. `render componentTheme mono-light` with samples: the night, thunder and fog icons and 12h are all right.
26. `convert` check (final): widget.rc at 27,828 B, ok.

## 2. Dead ends and wasted calls
- Call 16: I set the font size from the window ("@tfs"). Nothing said a text's fontSize can't be an expression. The tools converted and rendered it without complaint, but wrongly. A lint or converter error would have avoided it.
- Call 19: I passed `clocks` together with `sizes`. The description doesn't say they are exclusive, and the result didn't say clocks was ignored.
- Call 15 was partly wasted: I first tried autoSize on a text that had no bounded width (no weight or fill), and it did nothing. The format reference says autoSize "shrinks the font to fit its box" without saying that the box must be constrained.
- Calls 11 and 12: I trusted collapsibleColumn priorities to keep the weather at short heights. The LAY-14 pitfall ("Dropping stops at the first row that does not fit") explains why it doesn't, but I only understood that after seeing it.

## 3. Wrong, misleading, noisy or missing in the tools' output
- `find terms`: "12-hour" and "24-hour" appear neither in `matched` nor in `unmatched_terms`. They vanish.
- Nothing says whether the device's 12/24-hour preference can be read. The expressions reference lists no such value, and DigitalClock's `format` is `"static": true`. A new user can't tell "unsupported" from "not documented". I made it a host value.
- DigitalClock 12h: "no AM/PM marker". A 12-hour clock without AM/PM is ambiguous, and the kit didn't propose a way to add one.
- build_kit `icons.suggestions`: `{"for": "home screen widget", "icons": ["home"]}`. That is noise. It suggested no weather icons (clear_night, partly_cloudy_night, foggy), although Icon was already among the components.
- build_kit offered WeatherIcon for "weather icon" but no `needs_component` for fog, partly cloudy or night, which it can't draw.
- build_kit offered DateLabel. Its accessibility label is a static string ("Date"; the date is drawn, not a text node), so a screen reader hears "Date", not the date. The kit didn't point out that TextChoice is the accessible alternative.
- render `variants` for a home-screen widget includes three round watch sizes with `round_cut` warnings ("207 px of ink beyond the 160 px circle"). That is noise for this form factor.
- render `sizes`: I passed 7 sizes and got 6 back (250x110 missing), with no message.
- render `clocks` + `sizes`: clocks silently ignored.
- A text's `fontSize` given as an expression variable converts and renders wrongly, with no finding.
- `unpainted_corners` info is repeated on every render. Its advice ("put the background on the root") is wrong for a launcher widget, where the corners should stay transparent.
- The light theme's `@colors.warning` (used for a sun) renders brownish amber on white. That is a theme choice, but it looks muddy for a sun.

## 4. What I would have liked
- A system value (or an explicit "not available, make it a host value") for the 12/24-hour preference, and a DigitalClock whose format can be a variable, with an AM/PM option.
- A WeatherIcon with fog, partly cloudy and night variants and a runtime index (it already exists conceptually: "put the five icons in a stateLayout").
- A text-fit mechanism that works on a wrap-width text (autoSize against the parent's width), or a note that it needs fill/weight.
- render: combinations of clocks × sizes × samples, or at least an error when one option overrides another.
- Form-factor-aware variants (widget: drop round watch sizes, add 110x110 and 250x110).
- A size hint for Material icons: filled rounded icons cost about 1.3 KB each. A cheaper style suggestion would help.

## 5. Assessment of the final widget
- **Correctness:** time from timeInHr()/timeInMin(). In 24h it is zero-padded HH:MM. In 12h it is an unpadded hour with a smaller AM/PM, correct at 23:59 -> 00:00 (12:00 AM) and at noon. The date (weekday, day, month) comes from the clock and rolls over at midnight, verified at 31 Dec -> 1 Jan.
- **Host variables:** `cond` 0..6 (clear, partly cloudy, cloudy, rain, snow, thunder, fog; sample 1), `night` 0/1 (sample 0), `temp` (sample 18, rounded and shown with its sign), `unit` (host string, "°C"; "°F" tested at 100.4 -> "100°F"), and `use24h` 0/1 (sample 1). I found no system 12/24-hour value, so the app passes `use24h`. Out-of-range `cond` values clamp (stateLayout); not verified beyond 0..6.
- **Night:** clear and partly cloudy switch to clear_night and partly_cloudy_night. Rain, snow, thunder, fog and cloudy have no night variant (none makes sense in Material Symbols).
- **Sizes:** three layouts chosen by the window. Compact (2x2, column) and wide (width >= 1.6 × height and >= 230: 4x1 and 4x2, a row with the long weekday) were checked at 160², 115x160, 256x120, 320x160 and 320x80. Short (height < 120: time and weather, no date) was checked at 160x96, 115x96, 110x110 and 80x96. Every size had clean findings.
- **Themes and mono:** only theme colours. Light, dark, mono-dark and mono-light were all checked. The icon tints are warning (sun), primary (rain, snow), muted (cloud, fog) and secondary (night).
- **Repaint:** scheduled once a minute (inspect runtime: about 59 s, timeInMin).
- **Accessibility:** header description "Clock and weather widget". The time, the date parts and the temperature are text nodes. The icon has a condition label ("Partly cloudy night", ...). Weak spot: the date is read as three nodes with abbreviations ("Sat", "31", "Oct").
- **Byte size:** 27.8 KB, of which 11.7 KB is the 9 icon paths. TimeText is written in three layouts, each with four fitBox alternatives for 12h, so it is larger than ideal.
- **Known weak spots:** the 12/24-hour preference is a host value, not read from the device. The temperature autoSize shrinks only in the compact and short layouts. The light-theme sun is brownish. The corners are left unpainted (deliberate: the launcher shows through). The fitBox and stateLayout behaviour is verified only in the tools' players, not on a device.
