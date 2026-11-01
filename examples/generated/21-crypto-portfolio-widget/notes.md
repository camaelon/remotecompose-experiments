# Crypto portfolio widget — eval notes (prompt 21, run 1)

Request: "A crypto portfolio widget: total value, 24 h change, and the share of each coin as a donut chart."

Result: `portfolio.json` (source), `portfolio.rc` (16,689 bytes), `portfolio.html` (playground), renders under `out/`.
43 tool calls (limit 45). Saved tool outputs: `list.txt`, `kit.txt`, `donut.txt`, `ref-expressions.txt`, `ref-format.txt`, `exp08.txt`, `check*.txt`, `convert*.txt`, `render*.txt`, `audit*.txt`, `a11y.txt`, `bytes.txt`, `publish*.txt`.

## 1. Tool calls in order

1. `list` — what servers/tools exist. Took the workflow (build_kit → check_component → convert check → render → audit → publish). Decided to use only `remotecompose`.
2. `build_kit` (goal verbatim) — got DonutChart (library, no legend, mono = thick/thin slices), Icon, examples TIM-08 / INT-08 / EXP-08, design rules. Took: DonutChart call, "flags 21 = thousands grouping" from EXP-08, host-string pattern. Decided: library donut + my own legend row component + a headline component.
3. `get DonutChart` (definition + demo_json) — learned how the slices are toned (alpha 1 − 0.7·i/n), mono alternates thick/thin, `fill: true` in a sized box, locals syntax. Decided to mirror the tone in my legend swatch.
4. `reference expressions` — step/ifElse argument order, no comparisons, 32-entry limit, resources.variables declared in order. Used for `up`, `show0..4`, the size thresholds.
5. `reference format` — host strings as root-level `variable` commands, host numbers as exported resources.variables, visibility needs a declared variable, textMerge/textFromFloat flags, widget sizes (4x2 320×160, hosts 250×110…; 4x1 250×40 up; 2x2 110×110 up), stateLayout, spacedBy-with-weights trap. Decided: stateLayout switched by windowWidth()/windowHeight().
6. `get EXP-08` — confirmed `flags: 21` with `whole: 6` prints 58,700. Took the flag value only.
7. `check_component` CoinRow, sweep over index with `variables: {coins: [...]}` — FAILED: "json2rc failed: Error: Unknown token in expression: undefined". Guessed the call's `@coins` was declared as a float, not an array.
8. `check_component` CoinRow with a whole `doc` declaring the float array — FAILED: "Unknown token in expression: @coinrow1_pct". A local used in the row's own semantics/text is not resolved.
9. `check_component` variant A (pct inlined, `shown` still a local used in `visibility`) — "ok": true but every render "solid": the local in visibility hid every row silently.
10. `check_component` variant B (`shown` passed in as a declared variable) — OK; rows 0-2 shown, 3-4 hidden, tones and mono thick/thin rings right; overflow of 12 px = the two `spacedBy` gaps (weighted child ignores spacedBy). Decided: padding instead of spacedBy.
11. `convert check` v1 — error: "Legend: unknown parameter 'modifiers'". Modifiers aren't allowed on a component call; wrapped in boxes.
12. `convert check` v1 — ok, 14,880 bytes, host variables listed (total, change, coins, sym0-4).
13. `render variants: true` v1 — 4x2/2x2/4x1 right; "wide 512×120" picked the 4x2 layout and overflowed; "small/tiny" clipped the total. Decided: row layout below 146 dp, donut side from windowHeight(), hide the legend when there is no room.
14. `audit` v1 — no findings.
15. `render variants` v2 — only "tiny 160×96" still clips (below the 4x1 minimum, accepted).
16. `render` 320×160 dark, total 1,234,567.89, change −2.15 — red arrow-down "−2.15%", but total printed "$1,234,567.9".
17. `render` 320×160 light, 3 coins 90/6/4 — 90 % dominant slice OK, legend 3 rows.
18. `render` 160×160, two coins, change −12.5 — OK but "$5,000.0" and "−12.5%": trailing zeros dropped. Decided flags 23 (money) and 7 (percent).
19. `render` 320×80 componentTheme mono-inverted, change −0.5, total 1,000,000 — OK.
20. `convert check` v3 — ok, 14,949 bytes.
21-23. `render` v3: neg+million dark 4x2 ("$1,234,567.90": float32 cents), two coins square ("$5,000.00", "−12.50%"), dominant 4x1 mono — all good.
24. `inspect accessibility` 320×160 — total ("Total value 85,213.57 dollars"), change ("24 hour change, up 3.42 percent") and each coin ("BTC, 61 percent" …) are announced. The donut canvas is a semantics node with a null description (DonutChart label "").
25-26. `audit` at 160×160 and 320×80 — no findings.
27-29. `render` host minimums: 250×110 OK (legend hidden), 110×110 OK (legend hidden), 250×40 overflowed (needs a one-line strip).
30. `inspect bytes` — 32 % expressions, 25 % text; nothing dominant; 3 layouts × (headline + 5 legend rows) is the cost.
31. `publish` v3 — portfolio.html (721 KB); the playground's variable list omits the `coins` float array.
32-37. `convert`, `render variants`, `render` ×2, `audit`, `publish` v4 (strip layout + Headline `inline`) — ALL FAILED: "Unknown token in expression: @shortIdx" (I declared `shortIdx` after `layoutIdx`, which reads it).
38. `convert check` v4 (variables reordered) — ok, 16,689 bytes.
39. `render variants` v4 — same as v2 (only "tiny" clips).
40. `render` 250×40 light — strip layout: total, change, 32 dp donut; no findings.
41. `render` 320×48 mono, change −1.25 — OK.
42. `audit` 250×40 — no findings.
43. `publish` v4 — portfolio.html (750 KB).

## 2. Dead ends and wasted calls

- Calls 7-9 (3 calls): check_component with component locals. (a) The sweep + `variables: {coins: [...]}` form fails with "Unknown token in expression: undefined" — no location, no hint that the call's `@coins` was declared as a scalar. (b) Locals are not visible in the component root's own modifiers (semantics text) — the error names a mangled `@coinrow1_pct`. (c) A local in `visibility` passes lint and converts, then silently hides everything ("solid" renders). Would have been avoided by: lint catching "local used in a modifier of the body root / in visibility", and a doc line saying locals are only resolved inside children, not the root's modifiers.
- Call 11: `modifiers` on a component call is rejected; neither the kit nor the format reference says a call can't take modifiers (the Headline/Legend calls looked like any node). One sentence would have saved it.
- Calls 32-37 (6 calls): fan-out before a single convert; the ordering rule is in the expressions reference, I overlooked it. A better error ("@shortIdx is declared after @layoutIdx: resources.variables are resolved in order") would have made the fix obvious; a converter that topologically orders resources.variables would remove the trap entirely.
- Calls 16/18 → 20-23 (half a round): decimals printing "5,000.0" because flags 5 strips trailing zeros; the format reference does list the flag bits, but the kit's "thousands grouping = flags 21" snippet from EXP-08 is for integers and gave me the wrong default for money.
Roughly 10 of 43 calls were wasted; 4 distinct dead ends.

## 3. Wrong, misleading, noisy or missing in the tools' output

- build_kit term resolution: `"term": "share", "ids": ["capability:input.host"]` and an icon suggestion `"for": "share", "icons": ["share", "ios_share"]` — "share of each coin" is a proportion, not the share action. `"value" → data.array`, `"total" → expr.array` are also loose. `unmatched_terms: ["coin"]` is fine. Harmless but noise.
- build_kit examples: the layout model is TIM-08 "Launch countdown" (a 3-line centred text) and INT-08 "Media controls" (hostNamedAction) — neither is close to a KPI + chart + legend widget. The one useful example, EXP-08, is a canvas-only demo flagged "take the technique, not the structure". No example shows a legend, a signed/coloured change, or a stateLayout by window size, although the design rules reference LAY-15 and LAY-09 for those.
- build_kit `needs_component` was absent, yet the library has no legend and no "signed change with colour" element; I had to invent both. The DonutChart summary says "with the total and a caption in the centre" — fine — but its only accessibility hook is the drawn `label`, so a donut without a caption gets a semantics node with no description (seen in `inspect accessibility`).
- check_component error "json2rc failed: Error: Unknown token in expression: undefined" (call 7): no position, no expression, no hint. The same for "@coinrow1_pct" (call 8): the user never wrote that name.
- check_component lint claims to catch "references that are neither params nor locals" and visibility traps, but it passed a local in `visibility` that then hid every row, and the only signal was a render finding "[solid] … only a background fill drew" that reads like a success note.
- Format reference flag text: "decimals 0 spaces | 1 none | 3 zeros — so 5 = no padding" does not say that "none" also strips trailing zeros ("5,000.0", "12.5"); money needs 23/7. The EXP-08 snippet's `flags: 21` is quoted as "thousands separators" without saying it is integer-only.
- Variable declaration order: the expressions reference says "resources.variables are written first and in order: one may read an earlier one" but the converter's error for a violation is just "Unknown token in expression: @shortIdx".
- Modifiers on a component call: rejected with "unknown parameter 'modifiers'"; nowhere documented that calls take params only (wrap in a box).
- publish result `variables` lists `change`, `sym0..4`, `total` but not the exported float array `coins`, so the playground can't exercise the data-driven legend (2 coins, 90 % dominant). Not stated as a limitation.
- render `variants: true` names "widget 4x1 320×80" but the format reference says hosts give 4x1 "250×40 up"; the variant set has no 250×40 nor 110×110 nor 250×110 (the host minimums it itself quotes), so I spent 3 extra renders on them.
- The `list` output prints the same tool twice under different servers (rc-examples build_kit/check_component, rc-render render_rc, rc-inspect …) — 29 KB of near-duplicate descriptions for a user told to use one server.
- Float precision: a 32-bit float cannot hold cents above ~$167,772; "$1,234,567.89" prints "$1,234,567.90". No tool mentions this for money; only the time reference mentions the 24-bit mantissa.

## 4. What I would have liked

- A kit tuned to the goal: a KPI/stat tile with a signed, coloured delta (success/error + arrow), a legend component for DonutChart (or a `legend` param), and the stateLayout-by-window-size pattern as a snippet instead of a pointer to LAY-15.
- check_component errors with the expression and the JSON pointer, and lint for "local referenced from the body root's modifiers" and "local used in visibility".
- A converter that orders resources.variables itself, or an error that says "declared later".
- A money format recipe (grouping + 2 forced decimals = flags 23; cents lost above 2^24).
- render variants that include the host minimums it quotes (250×110, 110×110, 250×40) and a 4x2 at 1.5× font scale.
- publish letting the viewer edit exported float arrays and strings.
- Byte guidance: is 16.7 KB acceptable for a home-screen widget? No tool says what a budget is.

## 5. Assessment of the final widget

- Correctness: total with thousands grouping and 2 decimals ("$85,213.57", "$1,234,567.90"); change signed with "+"/"−", an up/down arrow icon and success/error colour, readable in mono by sign + arrow; donut from the host array (DonutChart, scaled to its box); legend rows (swatch in the slice's tone, symbol, rounded percent) hidden when the array is shorter. Percents are rounded individually so they can sum to 99 or 101.
- Host variables: `total` (float), `change` (float, percent), `coins` (float array, exported), `sym0..sym4` (strings). Confirmed by convert's host_variables finding. The total is independent from the sum of `coins` (by the request); a host must keep them consistent.
- Sizes: stateLayout with four states chosen from windowWidth()/windowHeight(): 4x2 column (height ≥ 146), row layout (wide, 56-145 high: 4x1 at 320×80, 4x2 at 250-360 × 110-145, wide 512×120), strip (< 56 high: 250×40), square (2x2, including 110×110). The legend hides when `width − donut < 215` (row) or `width < 149` (square). Only the "tiny 160×96" variant (below any 4-cell minimum) clips the total.
- Themes: light/dark follow the system; mono and mono-inverted use DonutChart's thick/thin slices and my matching thick/thin ring swatches; the change keeps its sign and arrow.
- Accessibility: header description; "Total value N dollars"; "24 hour change, up/down N percent"; "SYM, N percent" per visible coin. Hidden layouts and rows don't appear. The donut canvas itself has an empty description (a DonutChart limitation: its label is also drawn).
- Bytes: 16,689 (.rc); four layouts × (Headline + Legend) is the cost; audit reports nothing. Playground HTML 750 KB.
- Weak spots: cents above ~$167k are float32-rounded; "24h" wording hard-coded in English; donut has no centre text; at the 250×110 4x2 minimum and 110×110 the legend disappears (shares then unannounced); the strip's 32 dp donut shows little; `coins` not editable in the playground; no tap action (none requested).
