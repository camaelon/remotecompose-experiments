# Eval 43, run 1: watch tile with the next calendar event

Final document: `tile.json` (expands to `tile.rc`, 6,035 B). Contact sheets: sheet1.png to sheet5.png; renders are in out/.

## 1. Tool calls, in order (25 calls; `list` not counted)
0. `list`: read the server overview. Took the workflow: build_kit, then convert/render/audit.
1. `build_kit` (goal verbatim): returned Icon, TIM-12 (sunrise), TIM-08 (countdown), TIM-11 (moon). "watch" unmatched. Took the "A watch is round and small" rule (inscribed square 0.7 x min), "Switch content by state", "Compute what depends on now". None of the examples is a tile or an event.
2. `reference format`: took host strings (root `variable` vtype string export), visibility needing a declared 0/1 variable, textMerge/textFromFloat flags (5 / 13), onClick hostNamedAction with a string variable value, semantics.
3. `find examples "wear os watch tile round next event"`: only TIM-02 analog clock is watch-round. Nothing useful (dead end).
4. `reference expressions`: the key find. "A date the app stores ... EPOCH DAY", with the today formula. Decided start/end = epoch day + minute of day (local), 4 host floats.
5. `describe render`: learned samples (with `$clock`), clocks, sizes, variants, componentTheme.
6. `find examples "host colour set by the app"`: HST-01 shows `colors: {accent: ...}` called "exported accent colour". Used `resources.colors.calColor`.
7. `reference components`: read "Light, dark and monochrome". Gave calColor `mono-dark`/`mono-light` values.
8. `get TextChoice`: used it for the weekday name (Mon..Sun) for events 2+ days away.
9. `convert check:true`: OK, 5,977 B. Host variables listed. calColor is NOT in the "Host-settable" list but is in namedVariables.
10. `render` 7 samples at 192: every state right; "No upcoming events" clipped (text_overflow). Content looked small.
11. `render variants + sizes [192],[227]`: dark/light/mono-dark/mono-light all fine. Widget sizes irrelevant to a watch (4x1 gives zero_size, ignored).
12. `render` 6 samples at 192 incl. `$clock` 23:50 (midnight crossing) and Dec 31 (New Year): Today 13:00, Now until 23:59, In 15 min across midnight, Tomorrow across the year: all right.
13. `audit`: 0 errors/warnings; 1 info never_executed.
14. `inspect accessibility`: box label plus every visible text readable; hidden states are gone.
15. `inspect interact` with `{"type":"tap","x":..}`: rejected (wasted, I guessed the action shape).
16. `inspect runtime`: scheduled repaint, once a minute (timeInMin). Good for a watch.
17. `inspect interact` `{"tap":[96,96]}`: host_actions openEvent "evt-123". 
18. `render` light 227 samples incl. calColor pink: host colour works.
19. `render` mono-dark samples: the host-set pink calColor shows in mono (my mono-dark value is only the initial value).
20. `render` after putting `{"$if":"theme.mono"}` in a document modifier: "json2rc failed: NotImplementedComponent: background non-string" (dead end).
21. `check_component` CalDot (inline component with the $if): "theme colour 'calColor' is not in the theme" (dead end, its call refers to a document colour).
22. `render` mono-dark with CalDot: dot is white in mono even with a pink host colour. Fixed.
23. `render` dark with CalDot: pink dot. Fine.
24. `convert check:true`: 6,035 B, OK.
25. `audit` at 227: clean.

## 2. Dead ends and wasted calls (5)
- #3 find for watch examples: there are none; build_kit already said "watch" unmatched. Avoidable.
- #15 interact: I guessed `{"type":"tap"}`; the parameter description should show the action shapes (the error did, which was good).
- #19-#21 mono calendar colour: the guide's "colour can carry a mono-dark value" reads as if that handles mono, but a host-set colour overrides it at run time. `$if theme.mono` only works inside a component, which is never said; I learned it by failure. check_component then failed on its own call snippet.
- #11 variants: half the images are phone/widget sizes (narrow, wide, 4x1, 4x2) that a watch tile never sees, and 4x1 raised a zero_size warning that does not apply.

## 3. Wrong, misleading, noisy or missing
- build_kit for "watch tile ... calendar event" gives a sunrise almanac (TIM-12, 16 KB) and a moon-phase calendar: noise. "not_covered: calendar arithmetic (no example...)" while the reference does have the epoch-day recipe that solves it; build_kit should point to it ("A date the app stores... EPOCH DAY").
- No watch-tile example; no "relative time" ("in 25 min / now / tomorrow") pattern, which is the core of this request.
- Watch sizes disagree: build_kit says "160-220 dp" and "Render at 160x160, 192x192 and 220x220"; the format reference says "a watch tile 160–220 square"; real large watches are 227+.
- render has no round mask / round preview; I had to draw circles myself to check the inscribed area. `variants` is phone/widget oriented.
- render with output_path left 3 stray `render-<timestamp>.png` files in out/ (from the variants call?) nobody asked for.
- HST-01 calls `colors.accent` "the exported accent colour", but convert's "Host-settable variables" list omits calColor. Render accepts it as a variable. Unclear whether a real host can set it.
- Mono: the colour's `mono-dark` value is silently replaced when the host sets the colour; nothing warns. `$if` at document level fails with an unhelpful "NotImplementedComponent: background non-string".
- check_component "ok": false "theme colour 'calColor' is not in the theme" although lint passed: a component using a document colour can't be checked without passing `doc`; the message doesn't say so.
- Design rule "size everything from the window (not fixed dp)", but no example shows a window-scaled fontSize; I kept fixed sp (it is a font-scale vs window trade-off the tools don't address).
- Accessibility: no guidance on what a clickable container with a contentDescription does to its child texts on Wear (merged? hidden?). inspect accessibility lists both, so I can't tell what TalkBack will say.

## 4. What I would have liked
- A watch-tile example (round, ambient, tap to open) and a "relative time to an event" example with epoch-day + minute host values.
- render `round: true` (circular mask and overflow check against the circle), and a watch preset for variants (192, 227 round, ambient).
- convert listing host-settable colours; a warning when a host colour is used in mono.
- `$if theme.mono` allowed in the document body, or a documented `mono` colour override that wins over host values.
- 12/24-hour formatting help (system flag for the user's clock preference).

## 5. Assessment of the final tile
- Correct states, checked by render: In 5 min, In 25 min, Now · until 11:30, Today 13:00, Tomorrow 9:00, Wed 14:00, Ended 10:30 (stale data), No upcoming events; midnight and New Year crossings; long title (2 lines, ellipsis) and long location (1 line, ellipsis).
- Host variables: title, location, eventId (strings); hasEvent, startDay, startMin, endDay, endMin (floats; epoch day local + minute of day); calColor (colour). Tap sends hostNamedAction openEvent with eventId (verified).
- Sizes: content in a centred column 0.74 x min(window) wide; inside the circle at 192 and 227. It does not use the round screen's width at the middle, and text is fixed-size, so on 227 it looks a bit small.
- Themes: light, dark fine; mono-dark/mono-light fine (primary becomes white, dot becomes onSurface via an inline CalDot component). No large lit surfaces.
- Accessibility: header description, clickable box with label "Next calendar event. Double tap to open in Calendar", every visible text readable; hidden states are GONE. The label is static (doesn't include title or time).
- Bytes: 6,035 B. Repaints once a minute.
- Weak spots: 24-hour time only; an event spanning days says "Now · until 9:00" without the day; "In N min" only under 60 min, then "Today H:MM" (no "in 2 h"); no way to hide the location row when the location is empty (no string length test); the "Ended" state relies on the app replacing the event; the no-event label wraps to two lines at 192.
