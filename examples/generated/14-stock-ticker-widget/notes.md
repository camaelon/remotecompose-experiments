# Eval 14, run 1 — stock ticker widget

Request: "A stock ticker widget for 3 stocks: price, change in percent coloured up or down, and a sparkline."

Deliverables in this folder: `ticker.json` (the document, with the inline `StockRow` component), `ticker.rc` (22,175 B), `ticker.html` (published playground), `stockrow.json` (the component alone), `build.py` (generates both JSON files), `out/*.png` (renders), `*.txt` (every tool output I relied on).

## 1. Tool calls in order (22, plus the wrapper's `list`)

0. `list` (wrapper) — server/tool overview. Took: the 5-step workflow (build_kit, check_component, assemble, convert/render/audit, publish).
1. `build_kit` goal verbatim — got the `Sparkline` library component (params, pitfalls), `Icon`, examples EXP-10, HST-02, TIM-08, EXP-11, design rules. Took: Sparkline call with `fill: true` and `@floatArray`; EXP-11's textFromFloat flags (grouping 16, no pre-pad 4, zero decimals 3, rounding 512). Decided: use library Sparkline, not HST-02's hand-built canvas. It did NOT tell me how to declare host variables, host strings, or how to colour by sign.
2. `reference format` — JSON essentials. Took: root/resources/header structure, `visibility` needs a declared 0/1 variable, fitBox rules (exact heights as thresholds, width thresholds don't work), stateLayout, semantics modifier with a textMerge description, weight ignores spacedBy. Decided: stateLayout on windowWidth for narrow vs wide, fitBox on height inside each.
3. `reference components` — authoring guide. Took: inline `components` block, locals, `$if` on enums and `theme.mono`, the trap "There are no colour expressions. To show a state colour, overlay two copies..." Decided: three stacked texts (success/error/muted) toggled by visibility locals `up/down/flat`, plus an arrow Icon so mono stays readable.
4. `get Sparkline definition:true` — confirmed `fill` → fillMaxSize, mono uses onSurface, already has a semantics label. Decided: put it in a weighted box with a fixed height.
5. `reference expressions` — `step(x, edge)` value-first, no comparisons, `ifElse(cond last)`. Decided: `up = step(@change, 0.005)`, `down = step(0 - @change, 0.005)`, `flat = 1 - step(abs(@change), 0.005)`.
6. `find examples "host-set text string variable exported"` — HST-01 teaches "Export a string with a root variable {vtype: string, export: true}"; LAY-12 confirms visibility reads an integer variable 0/1/2. Decided: strings are host-settable, so symbols are host variables.
7. `get HST-01 parts:[json]` — saw that `root` can be an array whose first items are `variable` commands. Copied that shape.
8. `check_component` (definition + call `symbol: "@sym"`, variables `sym: "AAPL"`, sweep over change) — FAILED: "json2rc failed: Unknown token in expression: AAPL". Dead end (see 2).
9. `check_component` (symbol as a `string` literal, `layout` enum, sweep) — FAILED: "Unknown token in expression: undefined". Dead end. Decided: stop fighting it, validate through convert/render on the whole document.
10. `convert check:true` — ok, 15,468 B; findings listed all 12 host variables (3 strings, 6 floats, 3 float arrays) with values. Took: proof the export syntax works.
11. `render variants:true` — 10 PNGs. Took: light/dark/mono/mono-inverted fine; short (320x102) fine via the compact layout; square fine via stacked; but small (230x102) and tiny (160x102) overflowed (zero_size, text_overflow), and a `fitbox_no_fit` warning for the HIDDEN stateLayout child at narrow widths.
12. `audit` — 0 errors, 2 infos (fitBox shows child 1; longest expression 21/32).
13. `check_component` with `doc:` instead of `call` — WORKED: lint clean, bytes per mode (pattern refused by U7 because of texts), 4 theme renders, no findings. Took: confirmation the component is lint-clean; the sweep was not applied with a doc.
14. `convert check:true` after adding `mini`/`micro` layouts — ok, 22,175 B.
15. `render variants:true` — all 10 sizes/themes now render with no real finding; only the false `fitbox_no_fit` for the hidden stateLayout child, now at EVERY size.
16. `render` all-up values, 320x170 light — three green ↑ with + sign. Good.
17. `render` all-down with chg2 = −45.67 and a falling 22,000→12,345 series, 320x170 dark — three red ↓, "-45.67%" fits. Good.
18. `render` same values at 320x80 (4x1) light — compact one-line rows, nothing clipped. Good.
19. `inspect accessibility` — each row node: "AAPL, price 189.84, change 1.27 percent", "BRK.A, price 12,345.67, change -0.84 percent"; the hidden sign variants do not appear; sparkline canvases carry "Price history". Good.
20. `inspect bytes` — 22,175 B: 39% float expressions (225), 23% text, 26% layout. Took: the cost is 15 row instances (5 layouts x 3 stocks); decided to accept it and note it.
21. `audit` final — 1 error `layout_fitbox_no_fit` on the hidden child's "0x0 box" (false positive), 2 infos.
22. `publish` — ticker.html (856 KB), lists sym/price/chg variables; did NOT refuse on the audit error.

Images looked at (not tool calls): variants light, mono, short, square, tiny, small, mono-inverted, allup light, alldown dark, alldown 4x1.

## 2. Dead ends and wasted calls (2)

- Call 8: `check_component` auto-declares every `@variable` the call references as a FLOAT, so a text/string param bound to "@sym" with `variables: {sym: "AAPL"}` crashes json2rc with "Unknown token in expression: AAPL". The tool's description ("Variables the call references are declared for the demo; set their values with variables") says nothing about types. Avoided by: a typed `variables` option, or the tool inferring a string from a string value, or a note in the description that only floats are demoable.
- Call 9: with `symbol` a literal and `sweep: {param: change, values: [...]}`, the error became "Unknown token in expression: undefined" — an internal bug with no pointer to what went wrong (my guess: the sweep substitutes the `change` param into the `call`, but my body is a top-level `$if` on an enum, or the sweep leaves `@chg` unresolved). Avoided by: an error naming the expression and the node, and a sweep that works on any body. I never got the captioned contact sheet the workflow promises, and substituted three plain renders.
- Not a dead end but a surprise: the first document overflowed at narrow-and-short sizes that are not home-screen sizes (230x102, 160x102); `render variants` was right to show them, and fixing them cost two more layouts and 7 KB.

## 3. Wrong, misleading, noisy or missing in the tools' output

- CONTRADICTION on state colour. build_kit's design rule says "colours follow the state through ifElse(whenFalse, whenTrue, cond) or a lerp", while the authoring guide says "There are no colour expressions. To show a state colour, overlay two copies and fade one with paint alpha, or with graphicsLayer {alpha: expr}". The kit's sentence, read first, would have sent me to an `ifElse` on a colour that cannot exist. I followed the guide (visibility-toggled copies).
- build_kit's `layout_model` was TIM-08 "Launch countdown" with "why: Structure the screen like this" — a centred three-line countdown has nothing to do with a three-row ticker. EXP-10 (download card) was included "about: the goal's subject: percent, down" — matched on the words "percent" and "down", useless for the goal. HST-02 was listed even though its `hand_built: ["Sparkline"]` means the library component supersedes it. `icons.suggestions: price_check` for "price" is noise. `unmatched_terms: ["up"]`.
- build_kit MISSED what a stock ticker needs: a host-settable string (HST-01), a 0/1 visibility switch (LAY-12), and the textFromFloat behaviour with negative numbers (does the sign count toward `whole`? still unknown; whole 4 worked for -45.67).
- `fitbox_no_fit` false positive: with a stateLayout, the hidden child is laid out at 0x0 and every render (10 per variants call) and the audit report "fitBox(es) show NOTHING: no child fits the box ... 0x0 in StateLayout". The audit rates it an ERROR. It buries real findings and would make a new user chase a non-problem. publish did not refuse on it (good, but inconsistent with "refused while the document has structural design problems").
- `check_component` errors are raw json2rc messages ("Unknown token in expression: undefined") with no location.
- `check_component` ignores `sweep` when given `doc` (silently).
- `publish`'s result lists host `variables` but omits the float arrays (hist1..3) though convert listed them as host-settable; I cannot tell whether the playground lets the viewer edit the series.
- `convert` prints `"fonts": {"families": 185}` and a full `ops.byName` table — noise for a check.
- The expression reference documents `step(x, edge) = 1 when x > edge` but the format reference's example `step(@days, 0.5)` gives no hint which argument is which; I needed the extra call to be sure.
- Nowhere are the home-screen sizes 4x2 / 4x1 / 2x2 given in dp; `render variants` uses 320x170 / 320x102 / 170x170 / 512x128 but does not say which widget cell each stands for (only "square 170×170 (a 2x2 cell)").
- The authoring guide's mono rule ("draw large surfaces as a 1 dp outline ring") applies only inside a component (`$if theme.mono`); a plain document body has no theme switch, so my card edge disappears in mono-inverted. The format reference does not mention this.

## 4. What I would have liked

- A kit that, for "coloured up or down", hands over the state-colour recipe (visibility-toggled texts + an arrow icon for mono) as a snippet, and for "3 stocks" an exported string example, instead of a countdown as the layout model.
- `check_component` with typed demo variables (string, float array) and an error that names the node; a sweep that works with any body (or a clear "sweep needs X").
- A document-level sweep: `render` with several `variables` sets in one call (like `variants` but for values), producing a captioned sheet.
- Layout analysis that skips hidden stateLayout children (or marks them "hidden"), so warnings and audit errors are real.
- Named widget presets ("4x2", "4x1", "2x2") in render/variants with their dp sizes.
- A way to write a mono variant at document level (a `$if theme.mono` outside components), or a note that the Card component is the way to get a mono ring.
- A single "what the host can set" list that is the same in convert, inspect and publish (arrays included).

## 5. Assessment of the final widget

- Correctness: three rows, each symbol + price ("$" + grouped, 2 decimals, rounded), a sparkline from its array, and the percent change: green ↑ "+x.xx%" when > 0.005, red ↓ "-x.xx%" when < −0.005, grey — "0.00%" otherwise. Checked all-up, all-down, one flat, −45.67%, 12,345.67. Rendered with no real findings in light, dark, mono, mono-inverted, and at 320x170, 320x102, 320x80, 170x170, 230x170, 512x128, 230x102, 160x102.
- Host variables (all exported, verified by convert): `sym1..3` (string), `price1..3`, `chg1..3` (float), `hist1..3` (float array, any length). Sample: AAPL 189.84 +1.27, BRK.A 12,345.67 −0.84, F 48.20 0.00.
- Sizes: wide ≥ 239 dp → full two-line rows (height ≥ 134+24) else one-line compact rows (≥ 56+24) else a single row; narrow < 239 → stacked two-row cells (height ≥ 124+24) else `mini` (symbol, price, change; no sparkline) else `micro` (symbol and change only). 4x2, 4x1 and 2x2 all show every field including the sparkline.
- Themes: theme colours only (surface, onSurface, muted, primary, success, error); the audit reports no hardcoded colours.
- Mono: arrows and the sign carry up/down; the sparkline is white/black. Weak: the card background is surface-on-background (invisible edge in mono-inverted; fine on a launcher that frames widgets).
- Accessibility: document description, per-row description with live symbol, price and change, sparkline label "Price history" (does not name the stock: the label is a string param and I did not try splicing the symbol variable into it).
- Bytes: 22,175 (rc), 856 KB html. Heavy for a widget: 15 StockRow instances (5 layouts x 3 stocks) each with its own sparkline loop, 3 state expressions and a 7-op description chain; pattern mode is blocked by the U7 text trap. Dropping `micro`/`mini` or sharing the state variables per stock would cut ~5-7 KB.
- Known weak spots: the sparkline is always `primary`, not coloured by the change (two overlaid sparklines would double the bytes); the "$" is fixed; a change of exactly ±0.005 displays 0.01 but is treated as flat; floats keep ~7 digits so cents are lost above ~167,772; the sweep contact sheet was never produced, so the sign logic was checked at 4 values via renders, not a sweep.
