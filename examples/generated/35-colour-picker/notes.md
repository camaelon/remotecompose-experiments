# Eval 35 run 1: HSL colour picker

Final deliverable: `picker.json` (source), `picker.rc` (6,493 B). Build scripts: gen.py, then gen2.py, gen3.py, gen4.py, gen5.py and gen6.py, with the last patches applied by inline python edits to picker.json. Renders are in out/final-*.png.

## 1. Tool calls (36 total)
1. `list`: tool overview. I followed the workflow it gives (build_kit, then convert, render, audit).
2. `build_kit` (goal verbatim): it gave me the Slider (onRelease, showValue), the CMP-12 layout model, and the design rule "Compute the colour" with the HSL to HSV formula. needs_component = swatch. I decided to compute RGB directly using the f(n) HSL formula and an argb computed colour.
3. `reference format`: computed colours, textMerge/textFromFloat, the trap "visibility needs a declared var", and canvas paint. I saw no gradient syntax here.
4. `find examples "linear gradient…"`: DRW-13 gave me the `paint.ops[linearGradient]` syntax and `shader 0`. I chose to draw a gradient strip under each slider.
5. `reference expressions`: `%`, min/max/clamp/round/floor and the 32-entry limit.
6. `get Slider definition:true`: track geometry (x 12 to w−60, y 20, 40 dp tall) and how onTouchUp works. I needed this to line the ramp strips up with the track.
7. `convert check` (v1): OK but 13.7 KB. The hex was six TextChoice components (96 visibility ops).
8. `render variants` (v1): the layout is good. In mono the ramps still show colour, and the hex digits come out small and not monospace.
9. `render` with a held drag: the **preview does not follow a drag**. Only the slider's own value moves, because resources.colors read the bound variable, which changes only on release.
10. `get TextChoice`: its pitfall pointed me at textSubtext in a canvas `global` for long lists. I used that for the hex: 6 one-character subtexts of "0123456789ABCDEF".
11. `describe render`: the touch_events schema.
12. `find "computed colour live drag"`: nothing for a live colour (dead end).
13. `convert check` (v2, Ramp and Swatch inline components with a mono variant): 5.9 KB.
14. `render samples` (5 HSL sets): every colour was correct, but the "#" was missing from the hex (textMerge drops a leading "#" literal).
15. `render variants` (v3): themes, mono, tablet and tiny are OK. The "#" was moved to its own text.
16. `describe inspect`: the interact action schema.
17. `inspect interact` (library Slider, onRelease sending a packed `@hsl` int): **the packed value is stale** (2107050 = the old values) and **lightnessReleased fires on every release**.
18. `inspect interact` (send `@hue`): **releasing the hue slider also set lightness to 0.** In the TS player the lightness slider's onTouchUp runs on any release and recomputes from touchX.
19. `render` (C++, drag and release): **the C++ player never commits on release** ("click miss"), so the preview never updates.
20. `render` (C++, tap): same result. The C++ player ignores onTouchUp.
21. `get Slider demo_json`: the demo does **not** use onRelease, although the kit says "every param in use".
22. `inspect interact` (own ChannelSlider, onTouchUp on the a11y box reading a differently named live var): nothing committed (dead end).
23. `inspect interact` (y-guard in `locals`): nothing committed.
24. `inspect operations` (filter): not useful. TouchUp ops have no params.
25. `inspect operations 240–275`: locals are evaluated as tree FloatExpressions before the canvas.
26–27. `inspect operation 249/250`: confirmed that the guard locals were evaluated outside the touch-up.
28. `inspect interact` (guard inlined): lightness was no longer corrupted, but hue came out 23 instead of 0.
29. `inspect interact` (taps): a constant 16 dp offset (x0 read as 0) caused by my `pick` local.
30. `inspect interact` on the library Slider version: 180 was correct, which confirms the offset was my own local.
31. `inspect interact` (mapping inlined into the onTouchUp): hue 180, sat 0, lit 75 were all correct. The other sliders were unharmed.
32. `render variants` final: no findings.
33. `audit`: dead_code and unused_variables, plus touch target 40 dp < 48 and the longest expression at 27/32. I removed the unused `hsl`.
34. `inspect accessibility`: the swatch reads "Colour preview, hex FF0000, hue 0 degrees, saturation 100 percent, lightness 50 percent", and each slider gives its label plus its value as state.
35. `convert` final: 6,493 B.
36. `render samples` final: the swatch pixels were (255,0,0), (0,255,0), (0,0,128), (0,0,0) and (255,255,255), all correct.
(Calls 1, 11 and 16 were list/describe. The total counts every CLI invocation.)

## 2. Dead ends / wasted calls
- **TextChoice hex (call 7):** the kit's "Switch content by state" rule names TextChoice for "a word from an index". A long list needs the textSubtext route, which is in TextChoice's own pitfalls but not in the kit.
- **Live preview (calls 9, 12):** the kit rule "Compute the colour … it re-evaluates when the variables change" sits right next to the Slider, but the two do not combine into a live preview. Nothing in the tools says so. A combined warning would have avoided both calls.
- **Packed `@hsl` value (call 17):** resource expressions are not recomputed before the onRelease action reads them. The Slider doc only promises that the bound variable is fresh.
- **Slider onRelease with several sliders (calls 17–31, about 13 calls):** the library Slider's onRelease is broken with more than one slider in the TS player and does nothing in the C++ player. My attempts at a workaround: a live var on the box (22), guard locals (23–27) and a pick local (28–30). What I learned: component `locals` that read touchX()/touchY() are evaluated outside the touch-up, so they must be inlined into the action expression. Nothing documents that.
- **Calls 24–27:** operation-level debugging that a clear "locals are evaluated once per frame before the component" note would have avoided.

## 3. Wrong, misleading or noisy output
- Slider `onRelease`: "Before them the slider writes the released level into the bound variable". In the TS player (inspect interact and the playground) **every** Slider's onTouchUp fires on any release, so releasing one slider rewrites another from the lift x. In the C++ render, onTouchUp never fires ("click miss"). The Slider's pitfalls only mention the old drag-mapping fixes.
- Kit `demo`: "returns the demo document calling it (every param in use)". The Slider demo uses neither onRelease nor color.
- The design rule "Compute the colour … re-evaluates when the variables change" says nothing about it only updating on release when the variables come from Sliders. The Slider pitfall ("an expression in resources keeps reading the starting value") says it never updates at all. In fact it updates on release, so both texts are partly wrong.
- textMerge silently drops a literal "#" part (probably read as a colour). There was no finding.
- audit `dead_code`/`unused_variables` flags variables that are read only by computed colours (resources.colors argb). That is a false positive: removing them would break the ramps.
- render `variants` returns 11 separate files, and `samples` returns 5 separate files. There is no contact sheet, so I had to montage them myself.
- The kit's needs_component "swatch" suggested drawing a component. A swatch is just a box with a computed background, so the recipe (sweeps, regimes) was noise here.
- Touch target info: "Touch Target < 48dp" on the library Slider's 40 dp height. The library default triggers its own audit.

## 4. What I would have liked
- A Slider with a live, document-wide value (or a colour that can be computed from the touch value), so the preview follows the finger.
- A tested multi-slider onRelease example, and a player-consistency note when the C++ and TS players disagree on onTouchUp.
- A built-in way to print hex (textFromFloat with radix 16), or a kit snippet for it.
- A gradient track option on Slider (`trackColors`).
- Documentation of when component `locals` are evaluated.
- A contact sheet for variants and samples.

## 5. Assessment of the final screen
- **Correctness:** HSL→RGB is verified at the 5 required points (pixel-exact), and the hex matches (FF0000, 00FF00, 000080, 000000, FFFFFF).
- **Interactions:** each slider's thumb and value follow the finger. On release the bound variable is committed (rounded) and the slider sends its own host action (`hueReleased`, `saturationReleased`, `lightnessReleased`) carrying its value. The variables are exported so the app can read all three. **Weak spots:**
  - The swatch, hex and the saturation/lightness ramps update on release, not live during the drag.
  - In the TS player a spurious `lightnessReleased` (with the unchanged value) also fires on other sliders' releases.
  - In the C++ player release does nothing, so the preview never changes there. I could not verify Java or Android.
  - My release guard uses componentValue valueType 5 (POS_ROOT_Y), which I inferred from the decoded operations rather than from any documentation.
- **Sizes:** phone 360×760 is good. The tablet (792 wide) works but simply stretches; a two-column layout would be nicer. Narrow, short and tiny scroll fine. There were no overflow findings.
- **Themes:** the chrome follows light and dark. The swatch has a 1 dp outline frame so white or black stays visible.
- **Mono:**
  - The swatch is replaced by "Colour preview off in monochrome: read the values below".
  - The ramps are hidden.
  - The hex and the three values stay readable.
  - In mono-inverted the replacement panel blends into the white background, though its text is readable.
- **Accessibility:** the swatch is announced with its hex and H/S/L values, and each slider with its name plus its value as state. There are no adjust actions (a format limit), and touch targets are 40 dp, under the recommended 48.
- **Bytes:** 6,493 B. The longest expression has 27 of 32 entries.
