# Eval runs

Each prompt of prompt.md is run blind: an assistant that sees only the `remotecompose` MCP
tools through `eval/mcp-cli.mjs`, from an empty folder, with the request as the user wrote it.
It writes notes (every call, dead ends, what misled it, what it missed) and the final document.
What it stumbled on is fixed in the server, the library or the players, then the prompt is run
again. A run is judged on the result (correct, adapts to size, themes, mono, icons and drawings
rather than text) and on the path (calls, dead ends, false leads).

## Prompt 1: moon phase widget

"Make a widget showing the current moon phase, tonight's moonrise-style label ("waxing gibbous,
82% lit"), and how many days until the next full moon."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 25 | 4 | correct | no way to show an index-picked word in a layout text; TIM-11 taught canvas text; the collapsible snippet did not work as written (U35); MoonPhase light colours inverted; build_kit noise (generic words as missing components, unrelated icons); 27 false "unused variables" |
| 2 | 13 | 0 | good | "moonrise" (from "moonrise-style") flagged as a missing component; TextChoice advice clashes with a combined label; collapsibleColumn repainted every frame (a TS player bug, U38); unused variables by id only; publish listed theme colours as the document's variables |
| 3 | 39 | 8 | good | a collapsibleColumn with weight and padding in a row drew nothing in the C++ renderer (U39: two divergences from Java; 8 calls lost bisecting it); no overflow or clipping finding anywhere; inspect lost variable names, printed 0.0338 as 0.00, listed no accessibility labels; variants ignored output_path |
| 4 | 27 | 5 | good, adapts with a fitBox | the size rule pointed at StateLayout "on the size" (it switches on a host value; fitBox is the size switch) and `get StateLayout` crashed; inspect ignored system_variables, so it and render disagreed on the clock; a drawing cut off at a short size went unreported (the layout clamps the box; the component drew for its `size` param) |
| 5 | 37 | 12 | good, checked on six dates | render said "findings: none" twice while content had vanished (a 0-wide weighted box next to a widthIn; a collapsible column that dropped every text); the overflow hint did not name the padded collapsible parent (U35); build_kit flagged "disc, fraction" as missing though MoonPhase covers them, an empty snippet list forced an 11 KB get; the audit's "flatten chains" info contradicted the 32-entry split advice; variants lacked small and mono-inverted; the time-zone pin (system variable 10) was documented only in TIM-11's pitfalls |

Fixed between runs (in order): TextChoice component; TIM-11 reworked to layout texts; theme
highlight/shadow colours and MoonPhase defaults; the collapsible snippet in the rule, the size
warning and the reference; build_kit noise filters (generic and style-qualifier words, icons
by name only, needs covered by components or icons); unused-variable audit (themed colours,
TextMerge inputs, the defining op named); TS Component.layout keeps the override visibility
bits (U38); publish `theme_colors`; the combined-label pattern in the reference; C++ row weight
share and fresh collapsible wrap pass (U39); rc2image counts text truncated or cut per painted
line and components placed past their parent, as render findings `text_overflow` and
`component_overflow`; json2rc symbol table so inspect names every variable; computed
contentDescriptions resolved; formula coefficients at full precision; variants honour
output_path; the size rule and warning name fitBox (LAY-09); a layout node asked for as a
component gets a pointer, not a stack trace; inspect takes system_variables; `find kind
capabilities` with a query returns only what the words resolve to; theme colours work in a
document with no component; drawing components scale to the box they get, and the C++
renderer clamps a fixed-size canvas to its parent as Java does (U40). Then (run 5): the render
reports `zero_size` (a visible component the layout gave no size, a collapsible that dropped
everything) and names a padded collapsible parent in `component_overflow`; variants add small
and mono-inverted; snippets fall back to all when none match; MoonPhase synonyms (disc,
fraction); icons match the leading name word only; the chain advice defers to the 32-entry
limit; the reference states the weight + widthIn trap and the system_variables {"10": 0} pin.

Findings log: docs/EXAMPLES_FINDINGS.md U35–U40. Run folders (widget.json, notes.md, renders)
live in the session scratchpad, not the repo.

## Prompt 3: day length in Oslo

"Show how the length of the day changes over the year in Oslo, with a curve for all twelve
months and a marker for today."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 25 | 5 | good: LineChart in fn mode (a fitted declination formula, worst 5 min against the almanac), today's marker, "6 min shorter than yesterday", all looks | build_kit listed the examples' own inline components (Panel) with the library ones, so `get Panel` failed; number and filler words ("twelve", "all", "change") as missing components and icons; a 2 KB snippet dumped; the collapsible advice silently did nothing because the weighted chart absorbs the shortage; no list of expression functions or clock values, no entry counter; "seven hours later" identical for a date-driven widget; the audit flagged spacer boxes as empty containers and the TextChoice index as unused |

Fixed after run 1: inline components listed apart (`inline_components`) and `get` names the
example that defines one; number and filler words generic; snippets capped at 1.6 KB; the
weighted-child caveat in the size rule and the reference; a reference topic "expressions"
(functions, clock and system values, limits); the audit's `expression_entries` info (the
longest, against the 32-entry limit) and no empty-container note for spacer boxes; the
variants' clock shift is 45 days for a document that reads only the date; a word naming a
component no longer also pulls a capability example (DRW-04 for "curve").

