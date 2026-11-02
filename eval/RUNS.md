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
| 2 | 41 | ~20 | richer: a fitBox with full/compact/minimal layouts, host variables for the place and latitude, values within 2–3 min of NOAA | the expressions reference had step()'s argument order backwards (the engine takes the value first); the C++ fitBox rejected a layout that fit because a hidden text counted at full width in its intrinsic size (U41), and the rejected child's stale measures fed the overflow and zero-size findings; the kit was 43 KB; smaller inconsistencies (size warning at 75% vs the 72% variant, `convert` printing a stack trace in the wrapper, check_component's call shape) |

Fixed after run 1: inline components listed apart (`inline_components`) and `get` names the
example that defines one; number and filler words generic; snippets capped at 1.6 KB; the
weighted-child caveat in the size rule and the reference; a reference topic "expressions"
(functions, clock and system values, limits); the audit's `expression_entries` info (the
longest, against the 32-entry limit) and no empty-container note for spacer boxes; the
variants' clock shift is 45 days for a document that reads only the date; a word naming a
component no longer also pulls a capability example (DRW-04 for "curve").

Fixed after run 2: step(x, edge) documented as the engine has it; C++ intrinsic size ignores
hidden children (U41) and gone subtrees are left out of the render findings; kit entries are
compact (snippet and pitfall budgets, 43 KB → 32 KB, with a pointer to `get`); the size
warning uses the variants' 72% width; the wrapper prints a tool error as a message;
check_component accepts the wrapped call that `get` returns; words naming an event or a
quantity, and words that are not visual, are never reported as components to write; a Rating
component (tappable stars) for prompt 32; Switch, Stepper, Checkbox, LineChart, PagerDots,
Button, Slider, Gauge synonyms from a pre-check of every remaining prompt's kit; the default
layout model follows the kind of surface (form, screen, widget).

## Prompt 4: New Year countdown

"A countdown widget to New Year's Day with days, hours, minutes and seconds."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 56 | ~18 | right: local time to 1 January of year()+1, leap-year aware, 0 d 00:00:01 at 23:59:59, a 5-step fitBox clean down to 110×70, all looks | the expressions reference promised comparison operators (none exist: step/ifElse) and gave timeInSec() as seconds of the day (it is seconds within the hour): a full rebuild round; TIM-12 (16 KB) named as the layout model for a 4×2 widget; TIM-08 hard-coded its colours against the kit's own rule; nothing said only explicitly sized fitBox children can fail to fit, nor that an empty fit is 0×0; a blank "rc2image failed:" when the output folder did not exist; the date edges (31 Dec 23:59:59, 1 Jan 00:00:00) took a render each |
| 2 | 22 | 3 | right, verified at six pinned clocks in one call (31 Dec 23:59:59, 1 Jan 00:00:00 with "Happy New Year!", leap and non-leap years), all looks and sizes clean | a fitBox tier with fillMaxWidth + widthIn came out 0 wide for it (not reproducible across the three engines); the zero_size finding names player ids, not JSON paths; check_component's demo frame warned of text overflow at the size it was given; TIM-08's "within one calendar year" pitfall read as a warning against the task |

Fixed after run 1: the reference states the real operators (no comparisons; step and ifElse
recipes) and the real clock values (timeInSec within the hour; seconds of the day =
timeInMin() * 60 + timeInSec() % 60; epochSecond() not on Android); the fitBox rule (explicit
sizes, largest first, a wrap child last, 0×0 otherwise); render takes `clocks: [...]` for
several pinned times in one call; a missing output folder is created; the countdown example
is the default layout model for a plain widget and uses theme colours.

## Prompt 5: sunrise and sunset for Lisbon

"A sunrise and sunset widget for Lisbon with the sun's position over the day."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 54 | ~32 | excellent: TIM-12's solar maths with place/latitude/longitude as host variables, a fitBox with full/compact/minimal layouts, inline SunPath, TextChoice state, within a minute of the tables on seven dates, all looks | 22 calls chasing "repaints every frame" that the audit could not attribute (a TS layout oscillation around a TextChoice in an end-aligned column, U43); 9 calls bisecting a fitBox the C++ renderer rejected (a fillMaxWidth text's intrinsic width measured as its bound, U42); build_kit called the subject words unmatched though the example matched; `list` cut descriptions mid-sentence; check_component ignored a definition's plain call |
| 2 | 48 | ~14 | excellent, and Lisbon's UTC offset computed in-document from the EU DST rule (right from any device zone), verified against an independent NOAA implementation | the reference had weekDay() as 1 = Sunday (it is Monday); windowHeight() differed between the C++ renderer (the layout box) and the TS inspector (the header height); a system_variables override of the UTC offset made the inspector see a per-frame change, so every document read "repaints every frame"; fitBox's chosen child being stretched to the box was undocumented; the weighted-chart rule contradicted the weight/heightIn trap; TIM-12 uses the device's offsetToUtc() with no pitfall for a place elsewhere |

Fixed after run 1: the inspector names the animating component, its path and the mechanism
(U43 itself is open in the player); C++ text intrinsic width and widthIn minimums (U42); words an
example matched are not "unmatched"; the wrapper prints full descriptions; check_component
takes a definition's call in either form; render and audit findings and the repaint causes
carry JSON paths (json2rc's symbol table maps every component id to its path); a document
without a component call but with theme colours converts from a string too.

Fixed after run 2: weekDay() documented as 1 = Monday; the TS player's windowWidth()/
windowHeight() follow the host's surface (the Header op re-sized the document every frame,
U44) and the inspector's layout task reports them; the runtime verdict samples the repaint
flag per frame, so a burst (a layout change after a system-variable override) is no longer
"continuous"; the reference says the fitBox stretches its chosen child and that a weighted
chart takes a fixed height instead of a weight; TIM-12 warns that offsetToUtc() is the
device's zone.

## Prompt 6: Pomodoro timer

"A Pomodoro timer screen: 25 minutes of work, 5 minutes of break, a ring that empties, start/pause and reset."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 68 | ~30 | works: start/pause/reset verified by taps in both players, the ring empties over 25 min then over the 5 min break, ten variants clean | the reference had continuousSec() as "seconds running" (it wraps at the hour) and ifElse(cond, a, b) (the condition is last); the TS player took taps on hidden components (U45) and ignored a click expression that is a bare variable (U46); TextChoice failed on a tree-declared index with an error naming nothing (U47); resources.variables cannot read tree variables (undocumented); the kit had nothing for a startable timer |
| 2 | 26 | 0 | complete: TIM-14's state model, work/break cycle, session count, two rings and icons switched by phase, verified by taps and across the 25-minute boundary, all looks and sizes | a leftover line in the reference still gave ifElse(cond, a, b); the interactions listing and the touch-target finding counted the buttons of hidden fitBox alternatives; no design rule about switching content by state; the kit's layout model was a contacts list (fixed mid-run) |

Fixed after run 1: the reference states continuousSec()'s range and the elapsed-time recipe,
ifElse's argument order, and the resources-first ordering; the TS player ignores taps on hidden
components and reads a bare-variable click expression; the expander declares such a local in
the body (U47); a TIM-14 stopwatch example (start/pause/reset, elapsed from the day's seconds)
for the kit.

Fixed after run 2: the ifElse line; hidden components (a gone ancestor too) are no click
targets in the inspector; a "Switch content by state" design rule; the stopwatch example
ranks as the layout model for timers; subject words are weighted by rarity and time nouns count
as subjects (the week widget finds the calendar); the document's own strings read @theme.*
numbers.

## Prompt 7: analog watch face

"An analog clock watch face with a date window and a second hand."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 15 | 0 | correct: hands checked at pinned clocks, a date window at 3 o'clock from dayOfMonth(), a second hand ticking once a second, scales to a round face down to 160 px, mono as an outline ring without seconds | AnalogClock has no date option, so it copied the component (build_kit reported no gap); check_component takes no clock, so a clock component could not be checked at a pinned time; the canvas command names are listed nowhere; variants say nothing for a clean render |

Fixed after run 1: AnalogClock gets a `showDate` window; check_component takes clock and
system_variables; the reference lists the canvas commands; variants and clocks captions name
the file and say "findings: none".

## Prompt 8: week at a glance

"A "week at a glance" widget: the seven days of this week with today highlighted and the week number."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 55 | ~16 | right: Mon–Sun of this week, today in a filled circle, ISO week number verified at eleven dates including 53-week years, four fitBox layouts, all variants clean | the reference said a fitBox child is stretched (an exact width is centred); fillMaxWidth + widthIn below the minimum is laid out 0 wide in every player; componentWidth() in a modifier read 0 in the TS inspector while Java and C++ give the parent's width (U49); check_component said ok with four blank renders; the audit at 160×160 counted hidden fitBox alternatives as zero-size and repeated a stale repaint verdict; the kit's layout model was a canvas-only demo |

| 2 | 27 | 5 | right: dates from dayOfMonth()/weekDay() with leap-aware month lengths, ISO week by the Thursday rule verified at nine dates (both W53/W1 boundaries, leap February), today on a primary disc with a "Today" label, three fitBox layouts with the disc sized from windowWidth(), every variant and theme clean, audit clean; 14 KB (three expanded strips) | no calendar arithmetic anywhere and the kit said nothing was uncovered; the reference's "a wrap child always fits" was wrong (a row of seven 32 dp discs has a 224 dp minimum) and when nothing fitted the C++ render was blank while the TS inspector listed the rejected children with sizes and a cryptic "visibility 17"; check_component rendered its weighted row cell blank (hosted in a column) and the sweep showed captions only — and once hosted right, its disc still vanished because the constant-folded `today` local became {"visibility": 1}, a variable ID (U51); textAlign "end" was silently "start" (json2rc had no `end`, U50); render's variants/clocks parameters were only in the schema; convert's host_variables listed theme colours and a 12-entry table |

Fixed after run 2: the expressions reference has a Calendar section (leap year, days in a
month, dates N days away, ISO week; the formulas checked against every day of 1999–2040) and
build_kit's not_covered names it for calendar goals; the fitBox clause states the minimum-size
rule, the windowWidth() sizing idiom and that a number in "visibility" is a variable id; the
C++ player marks a fitBox nothing fits in GONE like the reference and rc2image reports it with
each child's minimum, so render says `fitbox_no_fit` with JSON paths; the inspector labels
hidden components HIDDEN, folds their subtrees and reports `fitbox_no_fit`/`fitbox_shows`;
check_component hosts a weighted cell in a row (`container`) and the expander declares a
variable for any literal visibility (a design warning for documents that write one); json2rc
accepts textAlign "end" (bytes match Java); render's description names variants and clocks;
host_variables skips theme colours and tables.

| 3 | 27 | 4 | right: "Week NN" by textMerge over the reference's ISO formulas, month + year label, seven inline DayCells with today on a primary disc and a "Today" label, mono ring + small disc, three fitBox layouts, verified at nine dates incl. both boundaries, no findings at six sizes × four looks; 12 KB | audit crashed on every input (the fitBox diagnostics added after run 2 had no `message`); check_component's sweep sheet lacked the call's document variables ("Unknown token @mon") and the output still listed "findings: none" for the looks; `contentAlignment` on a box and `contentDescription` on a text node were dropped without a word; the format reference named textMerge/textFromFloat/semantics without their syntax and said nothing about centring in a box; `find` did not know "textMerge"; convert check "renders it" but returns statistics; the kit's TIM-13 entry pasted a 49-value tide table |

Fixed after run 3: the audit crash; the sweep declares the call's variables and a failed
check drops its partial findings; designAudit warns on keys that convert and do nothing
(`ignored_key`: contentAlignment, contentDescription on a node, alignment, gravity, align —
no example trips it); the format reference shows the textMerge/textFromFloat nesting, the
container alignment keys ("there is no contentAlignment") and the semantics modifier; the
vocabulary knows textMerge/join; convert's description says what check returns; kit snippets
cut numeric arrays over 8 values to four and a count. Run 3 was as long as run 2 (27 calls)
with the result right first time at every date: moving on to prompt 9, which exercises the
same calendar section.


## Prompt 9: progress through the day, week, month and year

"A widget showing how far through the day, the week, the month and the year we are, as progress bars."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 21 | 0 | right: four rows (label, floored percentage, library ProgressBar) from one inline PeriodRow component; fractions from the clock with TIM-10's month length and the 100/400 leap rule, verified at six pinned clocks (29 Feb 2028 23:59, 28 Feb 2027, 31 Dec 23:59, two Sundays, 1 Jan 00:00); repaints once a minute; three fitBox layouts, seven sizes and four looks clean; audit clean, longest expression 24/32; 6 KB | guidance named tools of the underlying servers (build_kit's next_steps "rc-render.validate and render_rc … rc-inspect.audit", the authoring guide's get_component / find_components / package_web); the format reference gave fitBox rules without a node and LAY-09 (fixed sizes, three literal colours) looked like a contradiction; textFromFloat flags unexplained (5, 4 and 12 in different places); the reference's days-in-month (four eq() terms) would pass 32 entries — it used TIM-10's shorter form; render variants repeated png_path/Success lines per failing size; check_component printed the 150-line expansion before the numbers; a single render is dark by default and nothing said so |

Fixed after run 1: every guidance string names the front door's tools (convert, render, audit,
get, find, publish); the format reference shows a fitBox node and says what LAY-09 demonstrates;
the flags table (whole 0/4/12, decimals 0/1/3); the Calendar section's days-in-month is TIM-10's
27-entry form; variants and clocks print only the findings; check_component lists `expanded`
last; render's description says a single render is dark unless theme: "light". Right first
time with no dead end: on to prompt 10.

## Prompt 10: seasons widget

"A seasons widget: the current season, the date of the next solstice or equinox and days until it."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 30 | 2 | right: a panel with a ProgressRing of the season's progress around the season's Material icon, the season name, "N days until the" event and its local date; event instants from Meeus' mean series converted with offsetToUtc(), a `south` host variable flips the hemisphere; verified at 20+ pinned clocks (year boundary, 29 Feb 2028, the September equinox at −7 h and the December solstice at +10 h); three fitBox layouts, six sizes × four looks clean, audit clean; 16.7 KB (icons 41%) | convert refused a json_path outside the server workspace (the eval ran the CLI from the repo, not from its folder); `{"visibility": "step(@days, 0.5)"}` on a text hid the day count and nothing said so (an inline visibility is an integer expression — abs/min/max/clamp only — and anything else becomes a text id, U54); render clocks cut 14 clocks to 12 silently; the kit's layout model was a 565-op phone screen (TIM-12) for a widget; no recipe for formatting a computed date (day-of-year → "21 December") |
| 2 | 34 | 2 | right on every pinned date (both sides of all four 2026 events, midnights, New Year, 29 Feb 2028, UTC-7 and UTC+13, both hemispheres): a progress ring with the season's icon, days until the next event from Meeus' mean formulas, five layouts by size; 23.6 KB | paths outside the workspace rejected without saying where it is (now named); no equinox formulas (now in the calendar recipes, checked against 2026); fitBox vs stateLayout advice |

Fixed after run 1: the eval CLI runs from the agent's folder (its outputs land there);
designAudit warns on an inline visibility that is not an integer expression
(`inline_visibility`, no example trips it) and the format reference states the rule; render
clocks says "14 asked, the first 12 rendered"; a widget or tile goal only gets widget-sized
layout models (the seasons kit now models on TIM-08); the Calendar section has the day-of-year
→ month/day recipe (two step sums + the 30.6 rule, checked over 1999–2040) with TextChoice for
the names. Right first time: on to prompt 11.

## Prompt 11: weather widget (host data)

"A weather widget: current temperature, condition icon, high and low, and the next 6 hours as a small chart."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 28 | 1 (+2 premature publishes) | right: a card with the library WeatherIcon switched by a host `condition`, the temperature and condition word (TextChoice), high/low (hidden under 200 dp), and a LineChart over an exported `hourly` array with hour labels from the clock or a host `startHour`; a weighted fitBox drops the labels, then the chart; theme colours only, four looks and ten sizes clean, audit clean; checked at −12° flat, 38° steep, storm at 160×96; 8.7 KB | the kit's layout model LAY-14 contradicted its own rules (57 hex colours, "22°", a hand-drawn sun); "a StateLayout (LAY-15)" read as a component (get said it was a node — one call); convert's host_variables still listed the theme colours and left out the exported array; every named render was saved twice (the eval CLI saved the returned image too); LineChart's xLabels taking text objects was undocumented; render never said the .rc size |

Fixed after run 1: LAY-14 rewritten on theme colours, host variables and the WeatherIcon
(same structure and teaches; rebuilt with the Java byte-check); the state rule names the
stateLayout node with its JSON; host_variables lists only non-colour variables, arrays by
their length; the eval CLI no longer re-saves a named image; the xLabels doc shows a
textFromFloat entry; render prints rc_bytes. Right first time: on to prompt 12.

## Prompt 12: step counter watch tile

"A step counter watch tile: today's steps against a 10,000 goal as a ring, and the last 7 days as bars."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 26 | 1 (+4 misleading renders) | right: a ProgressRing (steps/goal clamped, scaled to its box) with the count and "N to go" / "Goal reached" inside, a BarChart of the exported week array below; host variables steps, goal, week; sized from min(window) so 160/192/220 give the same picture inside the inscribed circle, a stateLayout indexed by the window aspect switches to ring-left / bars-right for a wide widget; four looks clean, audit clean, 3.9 KB | a render with host `variables` showed the ring mid-ease ("74 % with 0 in the centre") and no finding — three sample checks wrong until `duration: 1`; `size` refused a @variable while the reference said width/height take one; the exported float array syntax was nowhere (guessed right); the design rule "a StateLayout switches on a host value, not on the size" was false (the window aspect is the only way to tell 192×192 from 360×180); no round-watch guidance; kit noise from "counter"/"today" |

Fixed after run 1: a render with host variables is the state one second in (eased values
settled; `duration` overrides) and says so; the format reference states that size takes
numbers (width/height for a computed size) and shows floatArrays with export and the array
functions; the size rule says a stateLayout may be indexed from the window; a "watch is round
and small" rule for watch/tile goals (inscribed square, window-relative sizes, 160/192/220
renders, aspect-indexed stateLayout); vocabulary: "step counter", "steps", "counter",
"watch", "tile" no longer pull in integer expressions, the Stepper control, the clock or the
Card. Right first time: on to prompt 13.

## Prompt 13: battery widget (phone, watch, earbuds)

"A battery widget for my phone, watch and earbuds, each with its level and charging state."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 27 | 3 (~6 calls) | right: three rows (Material device icon, a battery drawing filled to the level — green / amber under 50 / red with "!" under 20 — a bolt with a halo while charging, the percentage); six exported host variables; a fitBox picks 4x2 / 4x1 / 2x2 layouts; theme colours only, four looks and every size clean; live contentDescriptions ("Phone, 76%"); 16.4 KB (nine instances, expand mode) | the kit sent it to BatteryIndicator, which has no charging state, so it wrote its own; check_component returned ~15 KB per call (the expansion with every icon path); fillMaxWidth cells in a spaceBetween row collapsed to 0 and the zero_size finding blamed weights; no 2x2 size among the variants; no way to render several host-variable sets in one call; a textMerge in semantics.contentDescription was the only way to read live values and was undocumented |

Fixed after run 1: BatteryIndicator gains a `charging` param (bolt over the body, normal fill
while charging, "charging" in its description; delegated, rebuilt with the Java byte-check);
check_component's expansion is opt-in (`expanded: true`); rc2image's zero_size names a
fillMaxWidth child of a row (or fillMaxHeight of a column) as the cause with the weight fix;
render variants adds a square (2x2) size for wide documents; render takes `samples` (several
host-variable sets, one captioned settled image each); the format reference shows a textMerge
contentDescription. Right first time: on to prompt 14.

## Prompt 14: stock ticker widget

"A stock ticker widget for 3 stocks: price, change in percent coloured up or down, and a sparkline."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 22 | 2 | right: three StockRow calls (symbol over a grouped price, a library Sparkline from an exported array, the change as a green up-arrow / red down-arrow / grey dash with the signed percent switched by visibility); host strings for the symbols (root string variables), floats and arrays exported; a stateLayout on the width plus fitBoxes give five layouts; theme colours, mono readable by arrow and sign, live descriptions; checked all-up, all-down, flat, −45.67 %, 12,345.67 at ten sizes × four looks; 22 KB (15 instances) | check_component declared every "@name" as a float, so a string param failed ("Unknown token in expression: AAPL") and a sweep with a literal symbol failed without a location; the design rule said "colours follow the state through ifElse or a lerp" while the authoring guide said there are no colour expressions (the guide is right); the fitBox finding added after prompt 8 fired on every stateLayout pane that was not shown ("fitBox shows NOTHING … 0x0 in StateLayout", an audit ERROR); the kit had no host-string example and the format reference no host-string syntax |

Fixed after run 1: check_component declares a string param's "@name" as a root string variable
(the sweep too); the design rule says a colour cannot be computed (two coloured copies switched
by visibility, or a host colour); the fitBox finding only fires for a fitBox that found nothing
itself and had room (C++ and the inspector: a pane a stateLayout hides, or one whose child would
fit, is left alone); the format reference shows the host-string form and the exported-number
form; HST-01 carries the host-string keywords (catalog rebuilt). Right first time: on to
prompt 15.

## Prompt 15: music player screen

"A music player screen: album art placeholder, title and artist, progress you can scrub, play/pause, previous/next, shuffle and repeat."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 38 | 6 | right, with one hole: a phone column capped at 480 dp (centred on tablets), an inline art placeholder, host-string title/artist, a Slider bound to `position` with m:ss / h:mm:ss texts, five IconButtons (play/pause swaps icon and label with `playing`, shuffle/repeat show their state); every tap updates an exported variable and sends a hostNamedAction; verified by interact at 360 and 800 wide, four looks, nine sizes, audit info only; 10 KB. The hole: the scrub never reaches the app (U56) | `interact` numbered targets over the unfiltered list (hidden components included) while `interactions` filtered them, so target 2 tapped what the other task called 1, and the log named no component; the Slider's drag writes its own variable, not the exported one, and `export` on an expression was dropped silently; the kit turned "placeholder" into a shimmering Skeleton and "play pause" into Button (never IconButton), had no host-action example (there was none in the catalog) and no reference showed hostNamedAction or the interact syntax |

Fixed after run 1: interact and interactions number the same visible targets and the log
names the component and its label; the format reference has an Actions bullet (set a
variable, compute one, hostNamedAction with a literal payload, the "reach the app" rule) and
the Slider's doc states that a touch expression's value cannot be exported (U56, open: a
format limitation); vocabulary: Skeleton is no longer a bare "placeholder", IconButton owns
the media words; a host-actions example (INT-08, delegated) teaches the action forms with
library IconButtons and a state-swapped play/pause icon. Right first time apart from the
format limitation: on to prompt 16.

## Prompt 16: smart home screen

"A smart home screen: 4 rooms with light switches, the thermostat temperature and a door lock status."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 44 | 6 | right: a scrolling phone column (capped at 560 dp on tablets) with a Lights card (four rows: room icon lit when on, name, On/Off word, a switch that flips its room and sends `<room>Light`), a Thermostat card (Gauge 10–30 °C, value, Cold/Comfortable/Warm/Hot word) and a Front-door card (lock icon, word, Unlock/Lock button sending its action); six exported floats; interact verified each switch changes only its room and reaches the app, both lock states; five sample states and nine variants clean; audit clean; 21 KB | the kit's new rule said Switch takes an onClick list — it had no such param (hard-coded flip), so the agent copied the Switch into a custom component; two controls sharing a hostNamedAction name: the name's text is written once inside the first click list and registered when it runs, so the second sent `name: null` (U58, the reference parser does the same); verticalScroll recommended three times with no syntax anywhere; a two-column stateLayout tried and abandoned (~7 calls) |

Fixed after run 1: Switch, Checkbox, Chip, Rating, Stepper and Tabs take `onClick` extra
actions after their own (delegated, library rebuilt with the Java byte-check); the rule names
exactly which components take what; designAudit warns on a hostNamedAction name shared by
several click lists (`shared_action_name`) and the reference says to give each control its
own; the reference shows verticalScroll with its scroll variable. Right first time: on to
prompt 17.

## Prompt 17: package delivery tracker

"A package delivery tracker: the steps (ordered, shipped, out for delivery, delivered) with the current one highlighted and the ETA."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 25 | 3 (+2 fix rounds) | right: the library Steps bound to a host `stage`, the ETA from host day-of-year + minutes rendered as "today, 14:30" / "tomorrow, 09:00" / "2 Nov, 14:30" (calendar maths from the reference, checked on 29 Feb 2028 and 31 Dec), a status TextChoice, a host tracking string; a stateLayout picks 2x2 / 4x2 / 4x1 layouts from the window; four looks clean, audit clean, a11y announces step and ETA; 15 KB | render said "findings: none" while a collapsibleColumn dropped the Steps row at 4x1 and a label ended in "…" — the render tool filtered out every info-level finding (text_ellipsized was computed and discarded), and nothing counted children a collapsible drops; `get <component>` returns no demo JSON unless `parts: ["demo_json"]`, which only the schema mentions; no dp sizes for 4x2/4x1/2x2 anywhere; the `global` text-op syntax described in prose only (a 34 KB TIM-11 fetch for one line); the kit's examples (a contacts list, a countdown) were off-target |

Fixed after run 1: render keeps the infos about the image (text_ellipsized, fitbox_shows and
the new `collapsed`: rc2image counts the children a collapsible layout dropped, with their
priority); the kit's component entries say how to get the demo document; the format
reference gives widget cell sizes and the `global` block syntax. Right first time: on to
prompt 18.

## Prompt 18: sleep summary

"A sleep summary: hours slept, a hypnogram-like chart of sleep stages, and a quality score."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 38 | 3 clusters (~11 calls) | right: a card with hours asleep (awake slots excluded), the in-bed span, a ProgressRing score, a per-slot hypnogram (four stage levels and colours; a step line over level guides in mono) and a legend of the shares; host `stages` array (powers-of-100 codes so one arraySum gives every count), slot length, start/end, score; three layouts by window size; eight sizes × four looks clean; a live a11y description verified by inspect; 12 KB | the render tool drew every number sharing a textFromFloat with the semantics description as "0" ("0h 00m", legend 0 %) while the inspector computed them — the C++ player dropped a data op written straight into the root (U59), and the format reference recommended exactly that sharing; pathExpression turned out to be a spline (no step chart with it) and nothing said so; the component lint called a canvas loop's index "neither a param nor a local"; the kit resolved "score" to games and "hour" to the clock, offered no ring for the score, and LAY-15 (cited by the rules) used a glyph and hex colours the audit flags |

Fixed after run 1: the C++ player runs the root's plain data ops (a dirty one refreshed first,
as the document's own) — conformance unchanged; the lint accepts loop indices; the
reference says pathExpression is a smooth curve and shows the canvas-loop step chart; ProgressRing
and Gauge answer "score"; "hour" no longer summons the clock; LAY-15 is being rewritten on
theme colours and Icons (delegated). Right first time apart from the player bug: on to prompt 19.

## Prompt 19: flight status card

"A flight status card: flight number, departure and arrival airports and times, gate, status and a progress line."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 36 | 8 | right: host strings for flight, codes, cities, gate and status word, host minutes for the times (≥ 1440 = next day, shown with a "+1" badge), a status index driving icon + theme colour (check / warning / takeoff / flight / landing), a canvas route line with a plane at the progress; four layouts by window size; theme colours, mono checked, root semantics announce everything; verified at all statuses, progress 0/1, long names, past-midnight, ten sizes; 17 KB | the reference listed textFromFloat/textMerge among canvas commands (they are value objects; convert refused the command); a width "@p * (componentWidth() - …)" that the reference called "the parent's box" is self-referential (the C++ render collapsed it, the TS inspector showed an intermediate value — and two such boxes crashed the TS reader, U60); `componentTheme` was dropped on the samples/clocks paths (a "mono" samples render came back dark, reported as success); `output_width` alone errors though the description reads as either; the `ignored_key` lint fired on a component param named `align` |

Fixed after run 1: the reference says textFromFloat/textMerge are value objects (one shared op
when repeated), that componentWidth() in a component's own size modifier reads its own box and
that a parent-relative width is {"fillMaxWidth": fraction | "@variable"} (U61; the TS player
ignored a variable fraction — U62, fixed); the TS player's component-value list is null-safe
(U60); samples and clocks honour componentTheme; the lint skips a component call's args.
Right first time: on to prompt 20.

## Prompt 20: habit tracker

"A habit tracker for 5 habits with this week's checkmarks and a streak count."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 29 | 3 | right: a header with the real weekday letters (today in primary), five rows (host-string name, seven cells — ring / filled tick, today's ring heavier — flame + streak); host bitmask per habit and streak floats, all exported; only today's cell tappable (flips the bit, sends done-/undo-habitN; verified by interact at phone and 4x2, undo proven); a phone-only "N of 35" ProgressBar; four looks and sizes clean; rows and the tap box announce; 21 KB | `fontWeight: "bold"` refused as "Unknown token in expression: bold" (the reference listed no text keys; the Java parser also takes a number); interact with a pinned variable said "no difference" while listing the host action it sent; render variants never include the 4x2/4x1 sizes the reference says to design for; the kit left "streak" unmatched and offered a water tracker, a contacts list and a date card; a flame icon "rendered orange in mono" — not reproduced (the call has no colour; the Icon's default is white in mono) |
| 2 | 26 | 3 | right: five rows of week circles (done, missed, today ringed, future dotted) and a streak flame, today's circle tappable (sends the new mask); four looks; 16.2 KB | {"spacedBy": "@gap"} collapsed every row to 0 wide with only a text_overflow finding (spacing is a plain number: now an audit warning); per-instance expressions made the first version 50 KB; "tracker" matched map markers (removed) |

Fixed after run 1: the reference lists the text keys (fontWeight is a number 100–900); interact
counts a sent host action as an effect; render variants add "widget 4x2 320×160" and "4x1
320×80" for widget-sized documents; "checkmarks/habit" trigger the "Taps reach the app" rule.
Right first time: on to prompt 21.

## Prompt 21: crypto portfolio widget

"A crypto portfolio widget: total value, 24 h change, and the share of each coin as a donut chart."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 43 | 4 (~10 calls) | right: a stateLayout with four layouts by window size, the total with thousands grouping and cents, the change signed with an up/down Icon in success/error, the library DonutChart scaled to its box, an inline CoinRow legend (swatch in the slice's tone, symbol, rounded percent; hidden past the array length); host total/change, an exported `coins` array, host symbol strings; four looks clean, audit clean at four sizes; verified with a negative change, a 90 % coin, two coins, a total over 1,000,000; 16.7 KB | a component local used in the body root's own modifiers failed with "Unknown token … @coinrow1_pct" (no cause), and a tree-declared local in a visibility passed every lint and hid everything; a resources variable declared after its reader was just "Unknown token @shortIdx"; `modifiers` on a component call was "unknown parameter 'modifiers'" with no hint; the flags for money (forced cents, grouping) were undocumented; the kit resolved "share" to host input and a share icon and had no legend |

Fixed after run 1: json2rc's unknown-token errors explain the cause (declared later in
resources, a component local read before its declaration, undeclared); the expander says a
call takes its params only (wrap it in a box for modifiers); check_component runs the design
lint over the expansion and a new finding (`tree_variable_visibility`) catches a visibility
reading a variable declared inside the tree (the U57 shape, now caught before a render); the
flags doc has grouping (16) and the money forms (7, 23); a Legend component is being added to
the library (delegated). Right first time: on to prompt 22.

## Prompt 22: air quality widget

"An air quality widget: AQI value with a coloured scale, the main pollutant, and a recommendation."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 28 | 2 | right: host `aqi` and a host pollutant string; the band index computed in the document, category and recommendation as TextChoice lists on it; an inline AqiScale canvas (six bands in the standard colours, tick labels, a ring marker placed piecewise; outlined bands with the current one filled in mono); three layouts by window size; verified at 12/50/51/55/151/301/480 and in a sweep, four looks, audit clean; 9 KB | a fitBox alternative holding a wrapping sentence "needed 356 dp" (a text's minimum is its one-line width) so nothing fit and the widget was blank in every variant — undocumented; `inspect accessibility` with `variables: {aqi: 480}` reported the number node as 55 (the load-time text) while the category read "Hazardous"; check_component passed a local nothing used; the kit matched "coloured scale" to the dial Gauge and reported nothing uncovered; the agent rendered seven single values not knowing `samples` |

Fixed after run 1: the fitBox clause states a text's minimum is its one-line width (maxLines +
ellipsis, or a box of exact width); the accessibility task runs two frames before it reads the
tree; the component lint warns on an unused local; the render description names `samples`;
"calories/macros/grams/protein" count as quantities for the visual rule. Right first time:
on to prompt 23.

Contact sheets of every prompt's final result (light, dark, mono, mono-inverted) prompted two
render findings: `unused_space` (a portrait screen whose content ends above 70 % of its height:
the habit tracker, 56 %) and `unpainted_corners` (corners left at the clear colour behind a
rounded card: six dark widgets showed white triangles). rc2image reports the dominant colour,
the ink bounds (pixels other than it) and the corners left at the clear colour. Also fixed:
the inspector's host-variable path left shared ops in hidden panes stale (U63).

## Prompt 23: calorie tracker

"A calorie tracker: calories eaten vs target as a ring, and macros (protein, carbs, fat) as bars."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 27 | 2 | right: an inline CalorieRing (eaten/target, a second lap in the error colour past the target, a thin inner lap in mono) with eaten / "of 2,000 kcal" / "N left" or "N over" computed in the document; three MacroBars scaled to max(eaten, target) with the excess in red (outlined in mono) and "+N over"; eight exported host floats with a zero-target guard; a fitBox with four layouts; checked at 0, half, at target, 30 % over, one macro over, four looks, six sizes, audit clean; 11.9 KB | a "NOT DONE YET" header on every call: `text_only` counted 13 texts and no visual because its canvases sat in the document's own components, and the size note ("no longer fits at 230×160") came from the TS inspector, which measured the wide row 0.24 dp over its box while the C++ render fit; "macros" resolved to modifier macros (STR-09); BarChart offered for per-target bars; no guidance for values past a target; whole 4 silently showed 12345 as "2345" |

Fixed after run 1: `text_only` counts calls to the document's components that draw; the size
note judges sizes with the C++ render it shows (and rc2image now reports an exact-size child
squeezed to 0 by a column out of room — no example trips it at its design size); "macro" no
longer resolves to modifier macros, ProgressBar answers "macros"; a "Show the overshoot" rule
for goals against a target; the flags doc says `whole` is a maximum. Right first time: on to
prompt 24.

## Prompt 24: transit departures board

"A transit departures board: the next 5 buses with line number, destination and minutes until departure."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 35 | 4 (~10 calls) | right: host stop name, lines and destinations (strings) and departure minutes of the day (-1 = empty); minutes computed live as (t − timeInMin() + 2160) % 1440 − 720 (midnight-safe), repainting each minute; "now" in the departure minute, gone rows disappear and the rest move up, "No more departures" when empty; primary badges; three layouts by width/priority; four looks clean, a11y per row; 10.9 KB | two exported host strings with the same initial value ("42") shared one id (U65, as the reference parser); the render showed "0 min" instead of "now" with `variables`/`samples` while the TS inspector was right — the render tool's 1 s settle let a visibility enter/exit play unfinished (U64); every render flagged the unselected stateLayout pane as a "visible" zero-size collapsible; "buses" became "buse" in the kit; no list-of-rows or host-string example in the kit |
| 2 | 24 | 2 | right: line badges in the app's colours, destinations and minutes ("now", midnight wrap), empty slots hidden, "No more departures"; 4x2, 4x1 and compact layouts; 11.8 KB | build_kit offered sunrise and fps examples and nothing on rows (a "Rows from the app" rule, ListItem/LabelValue for transit words); onPrimary on an app colour; clock-relative samples look empty at other hours (said in the samples rule) |

Fixed after run 1: the settle for host values runs forward from the pinned clock with layout
animations off (rc2image `--no-layout-anim`); a stateLayout's hidden panes are not reported as
dropped collapsibles or empty fitBoxes; `shared_string_value` warns on host strings sharing a
value; irregular plurals ("buses") resolve. Right first time apart from the render settle:
on to prompt 25.

## Prompt 25: server status dashboard

"A server status dashboard: 6 services with up/down status, latency and an uptime percentage."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 30 | 4 (~6 calls) | right: a header with an overall status icon and "4 of 6 up · 1 degraded · 1 down" computed from host statuses; six cards (status icon distinct by shape in mono, host name and status word, latency with a 0–1000 ms bar red above 1 s, uptime with a 90–100 % bar amber below 99 %); a flow for two columns on tablets; a 4x2 grid of cells and a 4x1 strip of icons by stateLayout on the window; per-service a11y; four looks and sample states clean; 44.5 KB (three alternatives in full) | `text_only` raised "NOT DONE YET" while the screen had seven icons and twelve bars (inside its own components: only canvases were counted); the fitBox advice for compact layouts failed — the alternatives held a weighted, ellipsized name, whose minimum the two players compute differently (U66) — and the reference had recommended maxLines + ellipsis for exactly that; nothing said each alternative copies its content in full (61 KB before a flow replaced the tablet layout); the "illegible 4x1" was an intermediate version (the final one renders cleanly) |

Fixed after run 1: `text_only` counts the document's components that call library visuals
(Icon, ProgressBar…) and components calling those; the fitBox clause says a text's minimum is
its full width even ellipsized, recommends a stateLayout on windowWidth()/windowHeight() for
alternatives holding text, and warns that each alternative is a full copy. On to prompt 26.

## Prompt 26: settings screen

"A settings screen with sections: notifications (toggles), display (brightness slider, theme choice), and account."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 30 | 5 | right except the slider drag: a scrolling column capped at 600 dp with three cards — four notification rows (icon, On/Off line, library Switch, each its own exported variable and action, verified one flips only itself), a brightness Slider with a live percentage, Light/Dark/System radio rows (one exported `theme`, an action per option, Dark clears System), host name and email, "Change password" and an error-coloured "Sign out" (both verified tappable after scrolling); four looks clean, every control labelled; 21.7 KB | the brightness drag moves the slider but cannot reach the app (U56: a touch value is not exported; the C++ player reports a click on release, TS does not); a false `shared_action_name` warning (and "NOT DONE YET") because an inline component passed its action name as a param ("@action") — the expanded names were distinct; library Switch and Slider announce no state (on/off, value); `find` components returned 10 of 35 with no word about the rest |

Fixed after run 1: the action-name lint skips a param-named action (the expanded document is
clean, the shared-name repro still caught); `find` components with no query lists the whole
library (names, with a total) and a cut list says how many more matched; Switch, Checkbox and
Slider gain state semantics (delegated). On to prompt 27 once the library is rebuilt.

## Prompt 27: login screen

"A login screen with email and password fields, a "remember me" checkbox and a sign-in button."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 27 | 3 | right within the format: host-string email and masked password in an inline FieldDisplay (label, icon, placeholder; a tap sends editEmail/editPassword so the app opens its input), an app error row, a library Checkbox (exported `remember`, rememberMe action, flips both ways), Sign in dimmed and inert until both lengths (host floats) are non-zero, then sends signIn; centred and capped at 420 dp, scrolls when short; four looks, four states rendered; fields and controls announced; 8 KB | no tool said the format has no text input (build_kit listed field/password/email/login as unmatched, matched "sign" to math, reported nothing uncovered); a false shared_action_name from the inline component's own `call` example; Button's `enabled` is static and it cannot fill the width — the stacked two-button workaround is the one TIM-14 warns about; the components search for "text field" returned an avatar and a clock |

Fixed after run 1: the format reference and a "Text entry is the app's" design rule state the
model (host string + tap action + app input + length float + masked password), and build_kit's
not_covered names it for login/password/search/typing goals; "sign" no longer means math; the
action-name lint reads the document tree only; Button's `enabled` accepts a runtime variable
and a `fill` param (delegated). On to prompt 28 once the library is rebuilt.

## Prompt 28: volume mixer

"A volume mixer: master, music, voice and effects sliders with mute buttons."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 23 | 1 (+1 partial) | right within the format: Master in its own card, then Music, Voice, Effects — label, 0–100 slider with the live number, a round mute button (crossed speaker on a red disc when muted, slider greyed, level kept); master is the overall control and greys every channel when muted; levels and mutes exported; a mute tap flips only its channel and sends mute/unmute, a tap on a track sets the level and sends setXLevel, a drag moves the slider but cannot reach the app (U56); four looks clean; a11y per slider and mute button; 10.3 KB | the Slider's doc suggested "send it with a hostNamedAction … or let the app read the value another way" — there is no way (an action carries a fixed string), and the sentence was broken; "effects" pulled in an AGSL shader example; IconButton has no size (40 dp fixed) so four rows don't fit a 4x2; render variants offer no 4x2/tablet size for a phone screen |

Fixed after run 1: the Slider doc and the format reference say plainly that a drag cannot reach
the app and what to use instead (discrete taps, presets, Stepper); "effect" no longer resolves
to shaders. Open: an IconButton size param. On to prompt 29.

## Prompt 29: tip calculator

"A tip calculator: bill amount, tip percentage chips (10/15/20%), split between N people, and the result."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 29 | 3 | right: a tappable bill field the app fills (no keyboard input; a tap sends editBill, "Tap to enter the bill" when empty), 10/15/20 % chips with exactly one selected (each sends its own action), a people stepper 1–20, results computed in whole cents (84.50 at 15 % split 3: $12.68 / $97.18 / $32.39); inputs and results exported; four looks, tablet column; chips, count and results announced; 6.7 KB | the Stepper `onClick` I added after prompt 16 put the caller's actions on both − and + — one action name in two click lists, the U58 trap, so + sent a nameless action; the library Chip never announced "selected" and no pattern was given for exactly-one-selected; Chip (32 dp) and Stepper (36 dp) fail the 48 dp audit; 46.475 printed "$46.47" (float storage) and nothing said to compute in cents |

Fixed after run 1: Stepper gets onIncrement/onDecrement, Chip state semantics, 48 dp touch
targets for Chip and Stepper, and an IconButton size (delegated); the flags doc says to compute
money in whole cents; the "Taps reach the app" rule describes the exactly-one-selected pattern.
On to prompt 30 once the library is rebuilt.

Between prompts 29 and 30 (from the user): host actions can carry values. json2rc accepts
{"type": "hostNamedAction", "name": …, "value": "@var", "valueType": "float|int|string|floatArray"}
(an extension: the reference JSON parser writes only literal values); the library Slider takes
`onRelease` (sends the level where the drag or tap ended: 87.755, 31.633, 36.73 in three
interactions); the playground panel lists every host action with time, name and value
(verified in Chrome: sendLevel 40, then 72 after the panel changed it). U56 closed.

## Prompt 30: temperature converter

"A unit converter for temperature: Celsius and Fahrenheit, adjust one and see the other."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 34 | 4 | right: "20.0 °C" and "68.0 °F" each with −/+ (1° per tap), either side recomputing the other in the document with one decimal; a drawn thermometer on −40..100 °C with ticks at −40/0/37/100; a hint for freezing, body temperature, boiling and "−40: where both scales agree"; presets for −40, 0, 37, 100; every tap sends the °C value with its own action name; four looks clean, 4x2 keeps values, buttons, thermometer and hint; values announced with units; 6.9 KB | chose ±buttons because two Sliders cannot share one value live (each thumb follows its own touch; the shared variable is written on release); the kit mapped "temperature" to weather and offered Slider without that caveat; render variants had no 4x2 size for a phone screen; the audit called every button action "never executed / dead code"; the library Button is 40 dp and the audit flags it; a stray "-40°" from the thermometer drawing in the a11y tree; `interact` said "repaint: continuous" (the tap ripple) while runtime said idle |

Fixed after run 1: the coverage finding leaves out actions (they run on input only); render
variants add a 4x2 widget and a tablet size for portrait phone screens; Button gets a 48 dp
touch target (delegated). On to prompt 31.

## Prompt 31: to-do list

"A to-do list with 8 items you can check off, and a count of what's left."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 29 | 3 | right: a "To-do" title with "N left" / "All done" computed as 8 − Σ done; eight rows (host-string texts, the whole row taps, flips its exported doneN and sends toggleItemN with the value); done = filled box with a tick and muted text; one column on phones, two at 4x2 and on tablets; tap/untap and all-done verified; four looks clean; rows announced with text and Checked/Not checked; 7.9 KB | no way to strike text through (the agent drew a line across the whole label column and dropped it): json2rc accepts "strikethrough"/"underline" (bytes identical with Java) but the reference never listed them and the C++ renderer ignored both flags; `interact` reported "the input changed the document" for tap+untap (net no change) and gave `label: null`; the interactions task's boxes drifted from the layout (U67, fixed since) |

Fixed after run 1: the C++ renderer draws underline and strikethrough (CoreText kept the flags
it read past); the reference lists them with the two-texts "done" pattern. On to prompt 32.

## Prompt 32: rating card

"A rating card: 5 stars you can tap, with a text that changes ("poor" ... "excellent")."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 25 | 3 | right: a host-string question, five custom stars (Material paths, "N stars" labels), the word under them (Tap a star / Poor … Excellent, TextChoice on the rating), a Submit Button enabled by step(@rating, 0.5) sending submitRating with the value; rating exported, each star sends rateN with the value; star 4 → four filled + "Very good" + 4 sent, re-tap keeps it, star 2 → "Fair", Submit inert at 0; four looks; 6.5 KB | wanted ONE "rate" action from five stars — the shared-name trap (U58) made it impossible, and the library Rating's onClick doc steered into it; Rating cannot label stars individually; the format reference said a component call takes visibility (calls take their params only); interact accepted a malformed action silently; variants reported nothing at 160×96 (8 dp stars, question cut) |

Fixed after run 1: json2rc declares a host-action name used by several actions once before the
tree (U58 fixed in json2rc; single-use names stay Java-identical), so five stars can send one
"rate" action with valueType; the shared-name lint is an info about portability; the reference
says calls take params only (wrap in a box); interact rejects malformed actions; Rating gets
per-star labels and a documented single rate action (delegated). On to prompt 33.

## Prompt 33: segmented control

"A segmented control to switch between day, week and month views, with content that changes."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 29 | 4 | right: an "Activity" title, a 48 dp pill segmented control (Day/Week/Month, the selection a filled pill that slides; announced "Week, Selected"), a card with the period ("Today · Saturday 31 October", "This week", "October 2026" from the clock), total steps and bars — 24 hourly with the current hour highlighted, 7 daily with M–S and today highlighted, one per day of the real month (checked at 31, 30, 28 and 29-day months); host step arrays; an exported `sel` and an action per option carrying the index; four looks, five sizes, audit clean, idle; 11.7 KB | 260,840 printed "60,840" with whole 6 and grouping (the separators count against whole, as in the reference) and nothing said so; the library Tabs is an underline bar that announces no selection and (before the json2rc fix) repeated one action name on every tab; INT-07's pitfalls said visibility takes no expression and only an integer variable (both wrong); the authoring guide stated "weights ignore spacedBy" for rows only; white text on the dark theme's primary is 2.6:1 |
| 2 | 17 | 2 | right: segmented Tabs (Day/Week/Month) sending the index, three panels with clock-derived labels, totals and bar charts (current hour/day highlighted, 28-31 month bars); 13.2 KB | textTransform's required fields undocumented (now listed); no partial array sum (the reference says to have the app send a running total); BarChart cannot highlight or stop at now |

Fixed after run 1: the flags doc says separators count against whole; INT-07's pitfalls corrected;
the guide says weights ignore spacedBy in columns too; the theme's onPrimary is dark on the dark
primary (6.7:1, as Material); Tabs gets a segmented style and selection state (delegated after
the Rating update). On to prompt 34.

## Prompt 34: stopwatch with lap times

"A stopwatch with lap times."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 26 | 4 | right, but repaints while stopped: clock-driven elapsed m:ss.cc (h:mm:ss past an hour), Reset / Start-Stop / Lap with state-dependent enabling, the last five laps (number, lap time, total, Fastest/Slowest from three laps) recorded in the document by shifting l1..l6 on each Lap; a compact layout for watches; every tap sends its action with the elapsed time; four looks, every size, audit clean, labels follow the state; 18 KB | the C++ render recorded every lap one behind: an action read an expression's cached value instead of evaluating it as the reference does (U68); the "repaint only while running" requirement cannot be met — a clock listener cannot be dropped — and nothing in the tools said so; build_kit matched "lap" to TIM-14, which has no laps; interactions omit disabled buttons; render variants have no watch square |

Fixed after run 1: the C++ value-expression action evaluates the expression when it runs (U68,
conformance unchanged); the reference states the clock-repaint limit. Library: Tabs gained a
segmented style, per-tab Selected state and the single action carrying the index; Rating gained
star labels and a single rate action (both Java-identical). On to prompt 35.

## Prompt 35: colour picker

"A colour picker with hue, saturation and lightness sliders and a preview swatch."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 36 | 5 (~15 calls) | right on colour, live only on release: a rounded preview swatch from a computed HSV colour (HSL converted), its hex code, three labelled sliders with gradient strips (hue rainbow, grey→colour, black→colour→white); pixel-checked (0,100,50) red, (120,100,50) green, (240,100,25) #000080, L 0 black and 100 white; each slider sends its value on release; mono replaces the swatch with the readable values; a11y for swatch and sliders; 6.5 KB | the C++ player never ran onTouchUp actions (U70), so releases did nothing in renders; its own copy of the slider fired every slider's release in TS (the library Slider does not: verified, only the dragged one fires); the "Compute the colour" rule implied a live preview while a Slider writes its variable on release; a literal "#" joined into the hex text vanished (a "#…" text is a colour to both parsers); the audit counted variables used only by computed colours as unused |

Fixed after run 1: C++ runs touch-down/up/cancel modifier actions for the touched components
(U70, conformance unchanged); the reference says a Slider's value — and a preview computed from
it — updates on release, and how to join a "#". On to prompt 36.

## Prompt 36: fitness dashboard

"A fitness dashboard: heart rate now with a chart over the last hour, active minutes, and calories."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 26 | 4 | right: the heart rate big with a static heart (no per-frame pulse), its zone (Rest / Fat burn / Cardio / Peak) in a theme colour beside a 4-segment meter readable in mono; a last-hour line with "−60 min / −30 min / now", a data-driven y axis and min/max dots; two goal rings with "Goal reached"; host hr, hrHour (60 samples), active and kcal with goals; layouts for 4x2, short phone, phone and tablet by window size; four looks and every sample clean, runtime idle; 32.6 KB | LineChart's min/max option dots every sample equal to the min or max (a flat hour is a bar of dots; drawing the chart twice to avoid it doubled the bytes); the kit offered no progress component for "active minutes and calories" and an STR-11 canvas chart with hard-coded colours; a spacedBy-with-weight overflow's advice pointed elsewhere; `step` strict-greater only in the expressions reference |

Fixed after run 1: LineChart marks one min and one max (the first, none when flat — delegated);
ProgressRing/Bar answer goal words; the overflow advice names spacedBy with weighted children.
On to prompt 37.

## Prompt 37: sales dashboard

"A sales dashboard: today's revenue with the change from yesterday, sales per hour, and the top three products."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 17 | 3 | right: the total as arraySum of 24 hourly values with grouped money ("$1,152,100"), the signed change against yesterday with an arrow (mono-safe), an hourly bar chart with the current hour highlighted, a ranked top three with units and revenue; a compact widget layout by stateLayout; four looks clean, a11y labels for total, change, chart and each product; 10 KB | minFontSize alone did not shrink the big number and C++ ignored autoSize anyway (U71); check_component's sweep and mono looks drew no bars for a float-array chart and said "findings: none" (U72); the canvas loop index "i" listed as accessibility text; a scroll-only document called "interactive"; publish lists no float array as editable; StatTile's 6-digit limit unflagged |
| 2 | 20 | 4 | right, with the new BigNumber (total and signed change) and its own hour chart and product rows; four looks; 19.7 KB | RankedList rows shared their measuring variables (one long name shrank every row: fixed, per-row names); a missing header "profiles" and $each needing a list cost two converts (profiles now supplied); the change compares a partial day with yesterday's whole day (noted) |

Fixed after run 1: C++ autoSize (U71) and the reference names `"autoSize": true`; check_component
sweeps and looks carry the doc's data and their own host colour, and report sweep findings (U72);
accessibility drops a canvas's drawn texts; a scroll alone is no longer "interactive"; the TS
player takes a host float array by name, so publish, the playground and inspect can set one. The looks were renamed: mono is now mono-dark and
mono-inverted mono-light (the old names still accepted). On to prompt 38.

## Prompt 38: budget overview

"A budget overview: spending per category as horizontal bars against their limits."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 18 | 2 | right: a summary card (total of budget, a bar, left or over) and six category rows (icon, name, bar against the limit, "$N left" / "⚠ $N over", spent / limit); a bar over its limit rescales, ticks the limit and shows the excess in red (outlined in mono); a 4x2 widget grid by height; four looks, eleven sizes and six sample sets clean; each row announced with amounts and over/under; 30 KB | ProgressBar clamps, though the overshoot rule said it did not, so it wrote its own bar; `$if` with `"else": null` crashed json2rc with a raw TypeError; the audit called expressions read as paint alpha "unused"; the sweep's `themes` option was not obvious |
| 2 | 16 | 1 | right, with ProgressBar overshoot (hatched excess in mono), a widget grid by height, amounts to $250,000; 29.9 KB | samples × sizes dropped a sample silently (now up to 24 renders, the rest said); the contact sheet overlapped tall cells (rows sized per image now) |

Fixed after run 1: ProgressBar gained `overshoot` (the bar rescales, a tick marks the limit, the
excess is an overColor segment, hatched with oblique lines in mono) and the rule points at it; a
null `$if` branch is no branch; the audit counts variables a paint reads (alpha, stroke width,
colour ids) as used; the sweep's `themes` names the four looks. On to prompt 39.

## Prompt 39: plant care widget

"A plant care widget: soil moisture gauge, light level, and days since last watered."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 25 | 2 | right: a 240° moisture dial with the plant's ideal band (host lo/hi), the value as a dot and "Too dry / OK / Too wet"; light as a word with grouped lux and a log bar; "Watered today / 1 day ago / N days ago" from an epoch day the app sends and today's epoch day computed from year() and dayOfYear() (checked across New Year and 29 Feb); a "Needs water" pill or "Water again in N days"; three layouts by window size (4x2, 2x2, mini); four looks; 14.8 KB | texts without a colour drew black on dark and mono-dark while render said nothing; build_kit sent moisture to Gauge, whose zones go green → red as the value rises (bone dry reads green); no recipe for a date the app stores; one conversion error printed once per variant; "(on the server)" on local paths |

Fixed after run 1: the audit warns about texts with no colour (uncolored_text); Gauge gained an
ideal band (bandLo/bandHi: green inside, amber outside, a filled or hollow dot in mono; bytes
unchanged without a band, Java-identical — delegated) and a "right range" design rule points at it;
the reference gives the epoch-day recipe for app dates; variants report a conversion error once;
"(on the server)" only for a remote server. On to prompt 40.

## Prompt 40: EV dashboard

"A car dashboard for an EV: speed, battery range as an arc, and the next navigation turn."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 30 | 3 (8 calls) | right: a big eased speed with a 0–200 bar, a battery arc with percent and km (red, an alert icon and "Low battery" at 15 % or less), a next-turn card with a Material arrow per direction code, the distance as "Now / 50 m / 1.2 km / 25 km" and the street on two lines; a row layout for wide screens, a column for square ones; four looks; 11.8 KB | `"anim": 1` silently did not animate (U73: the reference parser writes a 1 s duration as no animation; json2rc matches it); build_kit sent the battery arc to Gauge, whose alarm rises with the value, and offered nothing for navigation; render variants could not take the car's sizes; interact said "repaint: continuous" while runtime said idle |
| 2 | 20 | 1 | right: speed scaled to the window, Gauge with the 20-100 % band for the battery, turn icons per code, eased values; row or stacked layout by shape; 13.9 KB | Gauge's band has no critical state and a static spoken label; a hidden text listed in accessibility with a negative size (filtered now); clipping by a card's bounds unreported |

Fixed after run 1: the audit flags `"anim": 1` and the expander writes 0.999 for a component's
animated local (U73); "Low is the alarm" (Gauge with a band for battery/fuel) and "Turn arrows
are icons" (the Material turn icons by name) design rules; render variants take `sizes`;
interact's repaint verdict says an animation may still be easing. On to prompt 41.

## Prompt 41: solar panel widget

"A solar panel widget: power produced now, today's production curve, and money saved."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 25 | 5 | right, with a visible workaround: power now as "640 W" / "4.45 kW" / "12.35 MW" with "Producing now / Not producing", money saved computed in cents ("€6.77", grouped), a LineChart of 33 half-hour samples with now from the clock; three layouts (4x2, 2x2, 4x1); four looks; 11.5 KB | LineChart could not stop at now — future samples pushed below a clipped plot left a vertical stroke at now and forced the area off; render `sizes` was ignored without variants and wrote every size to one file; a contentDescription naming no variable was read out as "@powerDesc" with no finding; samples could not carry a clock; "panel" matched Card |

Fixed after run 1: LineChart gained `upTo` (line and area stop there, extremes over the drawn part;
bytes unchanged without it, Java-identical — delegated) and a "Today's curve stops at now" rule;
render `sizes` works alone and names each file; the audit flags undeclared "@name" texts
(undeclared_reference); a sample takes "$clock"; Card no longer answers "panel". On to prompt 42.

## Prompt 42: water intake tracker

"A water intake tracker: glasses drunk today out of 8, as a filling bottle drawing."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 32 | 4 | right: a drawn bottle whose water (clipped to the bottle, a still sine surface, a tick per glass) eases to drunk/goal; "5 / 8 glasses" with "3 to go", "Goal reached" with a check, or "+3 extra"; −1 (disabled at 0) and +1 change the count and send it to the app; a "+" icon button below 140 dp; four looks, idle; 6.5 KB | build_kit modelled it on the tide example ("water", "today") and sent "glasses" to ProgressRing, with nothing on buttons or telling the app; the reference called a shared action name a hard rule while the audit said json2rc handles it; variants wrote the 4x2 and 4x1 widget renders to one file; accessibility bounds were offset from the layout's; the summary listed theme colours as host variables; role 255 unexplained |

Fixed after run 1: the taps rule fires for trackers and counters; ProgressRing no longer answers
drink words; the reference says json2rc handles a shared action name and when to avoid it; every
variant gets its own file named after its caption; accessibility bounds come from the layout
(as interactions, U67) and role 255 reads as none; the summary lists theme colours apart. Open:
the tide example still models "water ... today" goals. On to prompt 43.

## Prompt 43: watch tile, next calendar event

"A watch tile showing the next calendar event, its time and location."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 25 | 5 | right: a centred column inside the round screen (0.74 × the smaller side): a calendar-colour dot and "Next", the title (2 lines, ellipsis), the time relative to now ("In 40 min", "Now · until 11:30", "Today 13:00", "Tomorrow 9:00", "Wed 14:00") from start/end epoch days and minutes, the location with a pin; "No upcoming events"; a tap sends openEvent with the id; four looks, repaints once a minute; 6 KB | build_kit ignored "watch" and said calendar arithmetic had no example though the reference has the epoch-day recipe; render had no round preview and variants checked phone/widget sizes; an app-set colour overrode its mono value silently; `{"$if": "theme.mono"}` in the document failed with "background non-string"; convert's host list left out the document's own colour; probe renders left stray files |

Fixed after run 1: rc2image --round masks the image to the round screen and reports ink the
circle cuts off (render `round`, finding round_cut); variants check a square watch-sized
document at 192 and 227 round; "watch", "tile", "wear os" resolve to the round form factor; the
calendar note points at the reference recipes; `{"$if": "theme.mono"}` works anywhere in the
document tree (resolved by the look); the reference says an app-set colour wins in mono and how to
keep mono white; convert lists the document's own colours as host-settable; probe renders go to a
temporary file. On to prompt 44.

## Prompt 44: always-on watch face

"An always-on watch face (monochrome) with the time, date and battery."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 23 | 1 | right: a thin 24-hour digital time, "SAT 31" above it, an outlined BatteryIndicator with the percent (a "!" and "LOW" under 15 %), black in dark and mono, ~4 % lit pixels, sizes from the window (160-227 round), repaints once a minute; dates right across midnight, month ends and 29 Feb; 2.4 KB | the expressions reference listed batteryLevel() with no caveat (only BatteryIndicator's pitfall says Android rejects it); render dropped componentTheme and samples when given sizes, and variants skipped the 160 watch; build_kit had no always-on guidance, offered no clock component and modelled it on a phone sunrise card; textTransform's names are mis-mapped by the reference parser (U74); runtime's two delays disagreed (wall clock against the pinned clock); a padding {left} was dropped silently |

Fixed after run 1: the reference says batteryLevel() and the other device values are not on
Android (a host float instead); render applies componentTheme and samples with sizes (each sample
at each size) and variants add a 160 round watch; an "Always-on is mono-dark" rule, watch-face
words for the clocks and the round form factor, and watch faces modelled on the analog clock;
the reference gives textTransform's numbers (U74); the repaint analysis reads the document's
clock; the audit flags padding keys other than start/top/end/bottom. On to prompt 45.

## Prompt 45: notification summary widget

"A notification summary widget: unread counts for mail, messages and calendar with icons."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 25 | 3 | right: three items with an icon and a count badge (filled icon, badge and latest sender when unread; an outlined muted icon and "No new mail" when zero), "99+" from 100, "All caught up" when all are zero, each opening its app; rows for 2x2, tiles for 4x1/4x2 by a stateLayout; screen readers hear "Mail, 150 unread"; four looks, idle; 16 KB | variants called an 80×80 square "a 2x2 cell" (the reference says 160×160); build_kit resolved "light" to 3D lighting, offered the deliberately broken DX-02 and icons for "accessible" and "open"; the sweep warned about its own sheet's captions; shared_action_name fired across stateLayout alternatives; Badge had no cap; C++ and TS dropped different collapsible children (open, as U66) |
| 2 | 17 | 1 | right: Badge with max ("99+"), outlined muted icon at zero, "All caught up", taps sending openMail/openMessages/openCalendar, each item read with its count; 15.4 KB | the same samples × sizes drop; interact called a tap that only sent a host action a document change (now said as a host action) |

Fixed after run 1: variants check a widget's 2x2 cell at 160×160; quality words (accessible, mono,
light, open...) give no icon, diagnostics never answer a goal, "lights" left 3D; mono and
accessible resolve to their capabilities; sweep findings only report cells that drew nothing;
shared_action_name ignores names in separate stateLayout children; Badge takes `max` (and
maxText "99+"), bytes unchanged without it. On to prompt 46.

## Prompt 46: compact 2x2 time and weather widget

"A compact 2x2 home screen widget showing the time, date, weather icon and temperature."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 26 | 4 | right: the time and date from the device clock (a repaint a minute), the weather from host values (7 conditions, night, signed temperature with its unit) as a Material icon picked at run time, 12/24-hour from a host value with a small AM/PM; three layouts (2x2, wide 4x1/4x2, short); four looks; 27.8 KB (42 % icons) | nothing said the device's 12/24-hour preference cannot be read, the words "12-hour"/"24-hour" vanished from the kit, DigitalClock's 12-hour mode had no AM/PM and a static format; render ignored clocks with sizes and silently dropped a seventh size; WeatherIcon had no fog, partly cloudy or night; DateLabel's label was "Date"; variants added round watch sizes to a 2x2 widget; the corner note repeated on every variant; the "home" icon for "home screen" |

Fixed after run 1: DigitalClock gains AM/PM and a run-time use24h; WeatherIcon gains partly
cloudy, fog and a night variant; DateLabel announces the full date (delegated; Java-identical,
unchanged bytes where the old defaults apply, except DateLabel's label and 12-hour AM/PM, which
change the default; CMP-10, TIM-12, TIM-13 rebuilt). The reference says 12/24-hour comes from the
app; render draws clocks at each size, takes 10 sizes, checks round sizes only for watches and says
an info once per variants call. A variable fontSize could not be reproduced as wrong. On to 47.

## Prompt 47: e-ink daily dashboard

"An e-ink style daily dashboard: date, weather, three agenda items and a quote, in black and white."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 26 | 3 | right: mono-light only (black, white, one grey, no motion); 800×480, 480×800 and a 296×128 shelf label by window size; the full date from the clock, the weather icon and name with high/low, up to three agenda rows ("Nothing scheduled" when none), the quote and author; long texts ellipsize; idle (the app must redraw at midnight); 14.8 KB | build_kit read "ink" as press input and never mentioned mono-light; TextChoice fed an `integers` host value always showed item 0 (float expressions read integers as 0) and its internal variables were listed as host-settable; DateLabel announced only "Today's date"; an example's wakeIn advice was taken as an expression, and nothing said a once-a-day wake is impossible; a resize note on every explicit-size render |

Fixed after run 1: an "E-ink is mono-light" rule and "ink" off press input; the audit flags an
`integers` value read in an expression and the reference says host numbers are floats; component
internals are not listed as host variables; the reference explains date-only repaint, the
wakeIn canvas command and the e-ink choice (minute check or an app redraw); explicit sizes get no
resize guess. On to prompt 48.

## Prompt 48: boarding pass

"A boarding pass with gate, seat, boarding time, a countdown and a QR-code placeholder."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 19 | 0 (~3 iterations) | showcase quality: a ticket card (flight strip, big airport codes with cities, passenger, gate/seat/group, boarding and departure times), a countdown pill from the clock ("Boarding in 1 h 25 min / now / Gate closed / Departed"), a perforated tear line and a framed QR-like drawing; a gate change as a filled "NEW GATE" tile and a banner, a delay as a red chip; widget, phone and tablet layouts; four looks; 28 KB | inspect accessibility read the countdown as "0 h 0 min" (texts computed at load, before the clock and system values were pinned); build_kit had nothing for the QR and matched "placeholder" to loading/pattern examples; the reference showed letterSpacing 0.5 without its unit (em); the audit called a host variable's sample date a hard-coded date |
| 2 | 18 | 1 | right: route, gate/seat/boards, a status pill per state, a gate-change banner, LabelValue pairs read as one item, the QrPlaceholder; 24.1 KB | the reference query returned the fitBox paragraph garbled (lines picked one by one: now whole paragraphs or a continuous window) and tool schemas ahead of prose (ranked lower now); LAY-12 uses literal colours and integers |

Fixed after run 1: inspect reruns the data pass after pinning the clock and system values (the
announced countdown matches the render); an "A QR code is a drawing" rule; "placeholder" no
longer matches host variables or pattern slots; letterSpacing documented in em; sample dates in
host variables are not hard-coded dates. On to prompt 49.

## Prompt 49: recipe card

"A recipe card: title, cooking time, servings you can adjust (scaling ingredient amounts), and steps."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 21 | 2 | showcase quality: a header (title, description, prep/cook/total with icons), an ingredients card with a −/+ servings control (1-12) rescaling eight amounts live (eighths and thirds as ½ ⅓ ¾, grams to 5, "a pinch" fixed, singular/plural units), a steps card with a progress bar, "N of M done" and steps that tick and strike through; side by side from 600 dp; four looks; servings and steps announced with value and state; 32 KB | the library Checkbox claimed to wrap its label but had a fixed 40 dp row (multi-line steps were cut) and a literal white tick; build_kit sent "cooking time" to the clock and the tide example and "steps" to a delivery tracker, with nothing on fraction formatting or a checklist; shared_string_value's advice did not say only the starting values must differ; variants gave a phone screen widget sizes |
| 2 | 25 | 2 | right: the servings Stepper rescaling eighths/thirds, grams and "a pinch", plural units, steps that tick and strike through, side by side from 600 dp; 34.8 KB | interact accepted {"tap": {"x", "y"}} silently (now an error, or read as x/y) and gave null labels (filled from accessibility); "Step @n. " in a component text never filled (a lint now: numbers are not spliced into text) |

Fixed after run 1: Checkbox's row grows with its label (heightIn from the control height, the label
weighted) and its tick is onPrimary (CMP-02, CMP-13 rebuilt, Java-identical); an "Amounts read
like a cook writes them" rule; Checkbox answers checklist words and Steps no longer answers bare
"steps"; shared_string_value says only the initial values must differ. On to prompt 50.

## Prompt 50: onboarding screen

"An onboarding screen with 3 pages, page dots, and next/skip buttons."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 31 | 6 | right: three pages with different drawn illustrations (calendar, cloud sync, padlock), titles and bodies as host strings, sliding page dots, Next → "Get started" on the last page and Skip (both tell the app), a swipe either way changing the page on release, a 300 ms fade, a side-by-side layout for landscape and tablets, "Page N of 3" announced; four looks; 8.9 KB | no guidance for a pager of laid-out pages (the only swipe example draws on one canvas; a touch-tracking variable cannot drive visibility: five calls); inspect interact's drag never ran the onTouchUp action (U75, TS); tree_variable_visibility fired for variables declared before their readers, under a "NOT DONE YET" header while the render was fine; an INVISIBLE (2) Skip still took taps; variants gave a phone screen tiny and widget sizes |

Fixed after run 1: the TS player runs a component's touch-up / cancel modifier actions after a
drag that leaves it (U75, as C++ U70; conformance unchanged); a "Pages are a page variable" rule
with the swipe handlers; tree_variable_visibility only flags reads before the declaration; the
design header no longer says NOT DONE YET; the reference says visibility 2 still takes taps;
phone screens get no tiny size and the widget check says it is optional.

All 50 prompts have had a first run.

## Prompt 2: world clock (run after maps)

"A world clock widget for London, New York, Tokyo and Sydney: local time, day or night, and the difference from my time."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 30 | 4 | right at every clock checked (London morning, midnight crossings, New Year, a user in Tokyo, DST samples): each city's local time from a host offset in minutes (DST included) and offsetToUtc(), a sun or moon icon (06-18 rule), "+9 h" / "same time" / "· +1 day"; layouts for 4x2, 2x2, 4x1, small and a phone screen with a WorldMap night shade; four looks; once a minute; 38 KB | the kit's time-zone rule gave the difference with the wrong sign; false "no longer fits" notes and a zero_size for a row whose children were all hidden on purpose; inspect engines reported hidden texts as disagreements; "difference" resolved to path ops and "local time" suggested local_shipping; no tall phone size |

Fixed after run 1: the rule's difference is (@offCity - offsetToUtc() / 60) / 60 (offsetToUtc() is local
minus UTC); a wrap whose children are all hidden is not zero_size (C++ report; conformance unchanged);
the TS layout dump marks GONE (and fitBox alternatives) and engines compares only what TS shows;
"difference"/"local" no longer misfire; variants add a tall phone. Added to the generated corpus.

## Prompt 51: world day and night map

"A world map showing where it is day and night right now, with my city marked."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 26 | 2 | right: WorldMap with the night shade from the clock and season, the app's city (name, lat, lon) marked, the local time and "Daylight here · midnight over Asia and Australia" from the sun's height; compact 4x1, 4x2 and phone layouts; once a minute; 12.4 KB | render's clock is the server's local time (undocumented: Lyon at 14:30 rendered as night until offsetToUtc was pinned); WorldMap's default night colour lightened the dark theme and a custom colour dropped the mono shade; MAP-01 padded minutes wrongly ("10:5"); the fitBox reference paragraph came back garbled |

Fixed after run 1: the render clock's time zone and system variable 10 documented; WorldMap's night
is black at 0.32 in light/dark and always onSurface in mono, and its pitfalls say it fills the width;
MAP-01 pads with flags 12; reference search returns whole paragraphs.

## Prompt 57: four-stroke engine explanation

"Explain how a four-stroke engine works: a drawing of the piston and valves, steps you can go through with next/previous, and an animation of each stroke."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 28 | 3 | right: a labelled cylinder cross-section (valves, plug and spark, piston from crank-rod geometry), gases told apart by marks (dots, stars, rings), four steps with captions, previous/next that play each stroke once, a play mode cycling at 2.5 s a stroke, side by side on landscape tablets; idle when paused; 25.8 KB | Walkthrough's autoplay could not loop (an engine is a cycle: it rebuilt the frame); runtime and audit said "continuous" over 60 frames for a document idle after a 1.6 s ease at load; the guide still advised continuousSec() for motion; render ignored animation_time when host values were set; the header's profiles again |

Fixed after run 1: Walkthrough takes loop (bytes unchanged without it); runtime judges over 180 frames
and the audit over 120; the guide says to drive start/stop motion with an animated value; render keeps
an explicit animation_time; the converter supplies "profiles": 513 when the header has none.

## Prompt 52: visited countries of Europe

"A map of Europe highlighting the countries I have visited, with a count in the corner."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 26 | 5 | right: 44 European countries each filled from one host 0/1 array (an inline component of per-country `$map` paths), microstates as dots, "9 of 44 countries" computed from the array, a live screen-reader sentence listing the visited names; mono looks fill visited solid on an outline; 33.6 KB | text references inside a component were renamed in their declarations but not in their uses ("@vn0" read literally) and nothing warned; nothing said countries can be coloured at run time (WorldMap's highlight is build-time, its pitfall read as "impossible"); no way to list a region's countries; the audit called the land path "usually an embedded bitmap or font"; samples captions printed the whole array; used the json2rc server once |
| 2 | 31 | 5 | right: the 44 UN states from one host array (WorldMap values; the 7 microstates as dots of its own, filled when visited), count from arraySum, a host names string as the map's label, a stateLayout for the widget (big "9" beside the map); 44.3 KB | 3 dead ends were the server failing to load (a quoting error in catalog.mjs, mine, mid-run); WorldMap drew nothing for microstates in valueCountries without a word; three different Europes (pitfall 44, MAP-04 37, map_info 54 with Syria and Turkey); MAP-04's label static |

Fixed after run 1: WorldMap colours countries from a host array (values + valueCountries, MAP-04); map_info lists a region's countries and which are too small; the audit flags a name read before its declaration (reference_before_declaration) and undeclared names in textMerge parts; the guide says where a global block must sit; the size audit no longer calls a path "an embedded bitmap or font"; samples captions summarise arrays.

## Prompt 53: delivery tracker

"A delivery tracker: the courier's position on a city-region map moving between the depot and my address, with the ETA."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 26 | 2 | right but coarse: San Francisco Bay (a coastline to show), route depot→address with the travelled part in the primary colour, the courier easing to each new position, ETA "N min"/"Arriving"/"Delivered", a step row, a 4x2 widget layout; 15.0 KB | MAP-03 scales x and y separately (stretches outside 1000:508); no warning that the map data is far too coarse for a city; no help to fit the view around two host points; in mono the region's clip edges draw as stray lines; `whole: 3` without flags gives " 12 min" (a leading space read aloud); render clipped "12 min" on a tablet while inspect said it fits |
| 2 | 28 | 5 | right, schematic: map_info said a city box is too coarse, so a hand-drawn London schematic (Thames, parks) with depot, address and courier from host lon/lat, the view fitted to the two points, the covered part up to the courier's projection, easing 1.2 s, live description; 12.4 KB | fillMaxWidth before weight gave width 0 with a misleading warning; componentHeight() in a height modifier read 0 in TS (U79 only half fixed); map_info listed USA/Russia/NLD as partly in a London box; WorldMap's route ends are build-time; the audit said "repaints every frame" while runtime said idle |

Fixed after run 1: MAP-03 rewritten with one uniform scale, a clip and a real route; map_info reports how coarse a region is and says a city-sized box needs a schematic; {"$map": {..., "outline": true}} strokes a coast without the cut edges; flags 0's leading spaces documented.

## Prompt 54: flight status

"A flight status card: the route from Paris to Singapore on a map, the plane's progress, departure and arrival…"

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 23 | 2 | right: a real great circle (48 points, computed by hand), the flight icon placed by distance along it and turned to its heading, flown part in the primary colour, local departure/arrival times and "next day" from host offsets, "6 h 27 left"/"Arrived", fitBox phone / 4x2 / minimal; repaint once a minute; 22.2 KB | MAP-03 teaches a decorative sin arc and a linear plane; no route helper; the cos-latitude scale's axis unclear; textFromFloat flags contradict across docs (MAP-03 vs BigNumber vs EXP-13); `step()` in a visibility fails to convert with an error naming neither node nor fix; samples cannot carry a clock each; the map is written once per fitBox child |
| 2 | 19 | 2 | right: WorldMap's great-circle route with the plane on its heading and the flown part from the host progress, local times, weekday and UTC offset from host offsets, Departs in / Arrives in / Landed from the clock, four layouts by size; 22.4 KB | render dropped clocks when samples were given; build_kit had no time-zone guidance ("Rows from the app" gave a same-day formula); WorldMap's label was a fixed string (no progress) |

Fixed after run 1: {"$mapRoute"} (great-circle path, or x/y/angle samples for arraySpline), WorldMap routeFrom/routeTo/progress with a plane on its heading; MAP-03 teaches the great circle; step() in a visibility now explains integer expressions and the float-variable fix.

## Prompt 55: Australia weather

"A weather overview of Australia: each state capital on the map with its temperature and a condition icon."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 24 | 6 | right, hand-tuned: Australia with the 8 capitals, a dot, leader and card (icon, temperature, name) each, condition and temperature from the host, a compact grid without the map below 320×260; 52.4 KB | asking for Australia by country dropped Tasmania (and mono lost its outline); no way to put layout content at map coordinates (no offset modifier, the guides contradicted each other on componentWidth() in a modifier); $mapHeight not found; overlapping cards rendered with no findings; no state borders offered; a host-chosen WeatherIcon needs all 5 drawings per place (80 icons) with no cost stated |
| 2 | 25 | 4 | right: own canvas map of Australia with Tasmania and the state borders, the 8 capitals each a dot, leader and chip (icon, temperature, name) placed with expression-sized spacers, a grid below 330×300; 60.7 KB | reused GEN-55 (run 1) from include_generated; ellipsised names not reported in samples; overlapping chips not checked; map_info listed only 5 Australian cities (the 110m places lack the state capitals); repeated_panes advised pattern mode for no gain; render variants on an .rc skipped the mono looks silently |

Fixed after run 1: a country region keeps islands across narrow straits (Tasmania) and drops far ones (Macquarie, Alaska, Svalbard); WorldMap states and pointsLon/pointsLat (MAP-05); the reference says how to put layout content at map coordinates; componentWidth() in a width modifier is the parent's box in all three players (the TS player read 0, U79) and the guide's contradiction is gone. (Tasmania's missing outline in mono was the Hobart card covering it.)

## Prompt 56: time-zone planner

"A time-zone planner: pick a meeting hour with a slider and see on a world map where it falls in working hours."

| run | calls | dead ends | result | what it stumbled on |
| :-- | --: | --: | :-- | :-- |
| 1 | 22 | 0 | right: slider for the meeting hour, the 09:00–18:00 band shaded by longitude (solar, not real zones), five city dots from host arrays filled when in working hours, a team list with local times, "+1 day" and Working/Late/Night/Early | slider guidance contradicts itself on live vs release; slider a11y formatting and no steps; WorldMap's byte claim (3.5 KB vs 5.7 KB measured); the slider gallery's "drops trailing zeros" claim is wrong; a widget warning on a scrolling phone screen; no guidance for shading a band on a map |

Fixed after run 1: Slider step and stateText; the guide says live derived values go after the slider in the tree; the map byte figure corrected (~6 KB); CMP-03's trailing-zero claim corrected; the size warning on a scrolling screen is a note.

## Comparison prompt: next departures widget (2026-11-01)

The transit widget prompt (three sizes, four data cases, every look), run on ChatGPT over the
deployed server, then twice with a fresh Claude agent through the CLI.

| run | client | tools | calls | dead ends | elapsed | size | result |
| :-- | :-- | :-- | --: | --: | --: | --: | :-- |
| 1 | ChatGPT | as deployed | ~200 (log, estimated) | ~8 | 18 min | 10.4 KB | so-so: header clipped at every size (padding before clip), fixed widths, "Oc…" at 2x2, no icons, mono faked |
| 2 | Claude, with its own scripts | before the fixes | ~136 | 9 | 12 min | 33.5 KB | good, but large and hand-written |
| 3 | Claude, no scripts | after the fixes | 36 | 5 | 7 min | 13.3 KB | good: built on CMP-15 and edited in place |

Different clients and infrastructure: compare calls and rewrites, not minutes. Run 3 has not been
repeated on ChatGPT. Fixes: render looks (one call, contact sheets), convert edits (no resend),
ExpandableRow and CMP-15, icon and error messages, padding_before_background, fixed_widths,
text_barely_shown, clipped long words, stateLayout rather than fitBox for text alternatives.

After one-call checks (convert looks, edits repeat the check, changed pictures only, $tap in samples):

| run | prompt | calls | dead ends | elapsed | size | note |
| :-- | :-- | --: | --: | --: | --: | :-- |
| 4 | next departures | 22 | 3 | 6 min | 16.1 KB | was 36 calls in run 3; text_overflow left at 2x2 on a long word |
| 2 | prompt 11, weather | 20 | 3 | 4 min | 8.1 KB | was 28 calls in its run 1, on earlier tools; no prompt-specific example |

Timed local reruns on the committed tools (no scripts; one tool call per command):

| prompt | calls | dead ends | size |
| :-- | --: | --: | --: |
| next departures | 12 | 2 | 12.3 KB (adapted CMP-15, a near-exact example) |
| prompt 11, weather | 14 | 0 | 8.1 KB |
| prompt 6, Pomodoro | 16 | 1 | 8.5 KB |

With inspection in the check, label taps, $expect, a richer kit and READY:

| prompt | calls | dead ends | size |
| :-- | --: | --: | --: |
| next departures | 13 | 0 | 12.4 KB (adapted CMP-15) |
| prompt 11, weather | 10 | 0 | 7.7 KB |
| prompt 6, Pomodoro | 8 | 0 | 10.4 KB (160x160 lost its controls) |

Where the time goes (2026-11-01, six runs): model time follows output at about 100 tokens/s; a turn
with little output takes about 1.5 s even with 100K+ of context, so reading costs almost no time on
this model. Output: thinking about 50% (worked out as the rest), document and edits 15-25%, CLI commands
and notes about 25-30% (mostly an eval artefact).

With from_example and set:

| prompt | calls | output tokens (before) | used from_example |
| :-- | --: | --: | :-- |
| next departures | 12 | 22.3K (21.2K) | yes: document 3.2K to 0, edits 0.5K to 2.7K, thinking unchanged |
| prompt 11, weather | 7 | 15.6K (18.6K) | no |
| prompt 6, Pomodoro | 10 | 15.8K (18.6K) | no |

The brief also asked for shorter notes, which accounts for part of the drop. Structures and selection
scores: docs/structures/.

Structure selection: start example of the right structure 11 to 22 of 32 held-out prompts (eval/score-selection.mjs).

RowList with and without (one run each, brief notes):

| prompt | arm | output tokens | calls | what happened |
| :-- | :-- | --: | --: | :-- |
| 31 to-do | kit offers RowList | 9.5K | 11 | ignored it: a column of Checkbox was simpler |
| 31 to-do | hidden | 10.8K | 9 | |
| 13 battery | kit offers RowList | 13.3K | 7 | tried and dropped it: rows and tiles hid the wrong things |
| 13 battery | hidden | 12.9K | 6 | |
| 25 server | kit offers RowList | 14.7K | 11 | kept it, with two inline components |
| 25 server | hidden (clean rerun; a first control leaked RowList, 15.2K) | 17.2K | 7 | hand-written; shows all 6 rows at small sizes, where RowList shows 3 and can hide a down service |

RowList after its fixes (readOnly, cut lists counted, below, check):

| prompt | calls | dead ends | .rc | what happened |
| :-- | --: | --: | --: | :-- |
| 25 server | 8 | 1 | 16.4 KB | kept it, with readOnly; all 6 rows at small sizes, latency dropped at 160 |
| 13 battery | 7 | 3 | 13.1 KB | kept it; trailSpace and the drop order misled it |
| 31 to-do | 8 | 3 | 5.6 KB | dropped it: no scrolling, 2 of 8 rows reachable at 320x160; a scrolling column of Checkbox won |

Fresh data-row and control-row prompts, kit offering RowList or not (one run each; "hidden" only removes it from the kit, find can still reach it):

| prompt | kit | output tokens | kept RowList | notes |
| :-- | :-- | --: | :-- | :-- |
| 14 stocks | offered | 27.5K | no | structure guessed hero-chart; no slot for price, change and sparkline; found wrong number formatting |
| 14 stocks | hidden | 18.3K | yes, found through find | |
| 38 budget | offered | 14.6K | yes | structure guessed meter-breakdown; bars gone at widget sizes |
| 38 budget | hidden | 16.9K | no | |
| 28 mixer | offered | 24.6K | no, dropped | sliders in a scrolling list cross-talk in TypeScript |
| 28 mixer | hidden | 30.0K | no | sliders move together in C++ |

After the slider fix: prompt 28 mixer, 12 calls, 2 dead ends, 13.4 KB. RowList was suggested and dropped: cross-talk with onRelease in a scroll, which is the reference player's behaviour.

Classifier on 36 fresh prompts written without sight of it (docs/structures/fresh-labels.json): 25 right, 27 before the last tuning. Keyword rules have reached their limit at about 70%, so build_kit now takes the structure the caller chooses.

Structure list in the build_kit description (fresh prompts, one run each; output tokens with / without): stock 11.0K / 12.5K, morning 26.4K / 21.3K, meditation 26.9K / 11.4K (the run with the list built four layouts, 14.6 KB against 3.6 KB), parcel 9.5K / 8.7K. A repeat of the "without" condition, where the list was present but unseen, gave 11.6K, 22.6K, 12.6K and 10.1K, so noise is about 10%. Every run with the list still made a first build_kit call without structure and repeated it. Offline, a model's main pick was right on 54 of 63 shuffled eval prompts (86%), and on all 36 fresh prompts, though those are listed in structure order and written from the same definitions.

Baseline (eval/baseline.md, commit b1cf728e; output tokens and minutes, two runs each):

| prompt | run 1 | run 2 | spread |
| :-- | --: | --: | --: |
| notifications | 8.3K, 1.7 | 6.8K, 1.4 | 20% |
| solar | 15.4K, 2.9 | 17.0K, 3.4 | 10% |
| music player | 20.5K, 4.0 | 15.2K, 3.1 | 30% |
| calorie tracker | 17.1K, 3.1 | 11.5K, 2.2 | 39% |
| tip calculator | 16.3K, 3.2 | 15.7K, 3.3 | 4% |
| recipe | 13.2K, 2.5 | 17.7K, 3.4 | 29% |
| binary search | 28.0K, 5.3 | 22.3K, 4.2 | 22% |
| watch tile | 16.7K, 3.1 | 15.8K, 2.9 | 5% |

Mean 16.1K, spread between repeats 20% on average. A change on one prompt in one run tells little below about 40%; judge across the set.

Verticals (media, charts/finance, health): 14 components, CMP-19 to CMP-24. Output tokens against the baseline, two runs each, not committed yet:

| prompt | before | with the verticals | after the kit fix |
| :-- | --: | --: | --: |
| music player | 20.5K, 15.2K | 14.7K, 20.1K | |
| calorie tracker | 17.1K, 11.5K | 6.8K, 11.1K | |
| solar (control) | 15.4K, 17.0K | 31.6K, 20.5K | 22.7K, 25.6K |
| 14 stocks | 27.5K, 18.3K (earlier runs, not the baseline set) | 22.5K, 20.2K | 18.1K, 18.9K |
| 36 fitness | none | 18.3K, 19.2K | |

Music and calorie have a matching example, and they were shaped by these prompts: they show the gain when one exists, not in general. Solar stayed above its baseline after CMP-17 was restored as its start, cause not established. Agents took components well beyond their vertical (PriceChart and GoalBar for heart rate). Most runs reported a fault found only by looking, after NO FAULTS FOUND (clipped bars, squashed charts, QuoteRow symbol reduced to dots, $0.0116).

Solar, why it rose (eval/run-trace.py, RC_TRACE, RC_HIDE_VERTICALS). Same prompt, five runs per condition, output tokens:

| condition | runs | mean | orient | first build | revise | convert calls |
| :-- | :-- | --: | --: | --: | --: | --: |
| baseline commit b1cf728e | 20.1, 21.3, 23.0, 26.8, 28.3 | 23.9K | 4.9K | 9.0K | 9.9K | 3.2 |
| current, verticals hidden | 18.3, 19.3, 20.0, 20.3, 22.3 | 20.0K | 3.1K | 5.6K | 11.4K | 3.6 |
| current | 19.8, 19.9, 21.6, 22.2, 22.3 | 21.2K | 5.0K | 7.5K | 8.7K | 2.6 |

The rise was not caused by the verticals: the old commit itself now costs 23.9K against the 15.4K and 17.0K first measured. The brief also differs: these runs and the verticals runs used a new wording, not the baseline's, so none of them can be compared with the 16.1K baseline. Compare only runs with one brief, in the same batch. Baseline runs here used today's rc2image, icons and player bundle, and had no rc2layout, so no engines check. Phase splits are unreliable where a small test convert counts as the first build (hid1, hid5).

Baseline again at 5f558b16, original brief (eval/baseline.md), output tokens, two runs each:

| prompt | b1cf728e | 5f558b16 | change in the mean |
| :-- | --: | --: | --: |
| notifications | 8.3K, 6.8K | 6.4K, 4.9K | -25% |
| solar | 15.4K, 17.0K | 12.9K, 12.3K | -22% |
| music player | 20.5K, 15.2K | 8.1K, 6.6K | -59% |
| calorie tracker | 17.1K, 11.5K | 4.4K, 4.3K | -70% |
| tip calculator | 16.3K, 15.7K | 18.1K, 13.7K | 0% |
| recipe | 13.2K, 17.7K | 18.7K, 18.0K | +19% |
| binary search | 28.0K, 22.3K | 30.7K, 28.3K | +17% |
| watch tile | 16.7K, 15.8K | 13.1K, 16.4K | -9% |

Mean 16.1K to 13.6K. Music and calorie give all of it, and their examples were shaped by these prompts (both music runs shipped CMP-19 unchanged, Equalizer included); the other six stay at 16.1K. Solar on the same code cost 12.6K with this brief and 21.2K with the stricter one, so the brief explains the earlier rise. New vocabulary added false matches: "next" to TransportControls (watch), "steps" to Steps and GoalBar (recipe). Found twice: Stepper decimals:2 drops a trailing zero (64.5), Card refuses a missing title, RowList drops requested icons at 160, "power" brings EXP-02.

Checks added after that baseline, not yet measured: squashed_content (a chart with room reduced to a sliver), cut_by_window (text past the window with no scroll), odd_number (float noise, E notation, money with one decimal), text_barely_shown also for short texts ("AAPL" as ".."). A failed check now removes the old final sheets. Across all 155 examples at 360x640, 640x360, 320x160 and 160x160: squashed_content and odd_number fire on none, cut_by_window on 25, nearly all galleries at widget sizes they were not designed for, and at the phone sizes only CMP-11 and LAY-13 at 640x360, both unjudged. Not caught still: requested content dropped on purpose (RowList icons at 160), text touching a drawing, wrong logic that renders tidily (a reversed ifElse). Also: Stepper keeps trailing zeros when decimals is set; "next", "previous", "skip" no longer reach TransportControls, "steps" no longer GoalBar, "power" no longer expr.math.

Images: json2rc gained drawBitmap, drawBitmapInt and drawScaledBitmap, byte-identical to the Java parser with a numeric image id. The Java parser has no resources.bitmaps (its images come from the host), so a document embedding a PNG cannot be byte-checked. C++ DrawBitmapScaled ignored src and scaleType and stretched; it now follows ImageScaling.java. Seen drawing in C++ and in the TypeScript player in Chrome, all eight scale types, and inside CoverArt's image slot. Not run on a device. PNG only. DRW-16 shows it. build.mjs now refuses a partial --catalog that would drop examples.

Held-out test of the step, form and panel sets (StepExplainer, CellRow, ChoiceChips, InputsResult, ScaledAmount, NumberedList, TwoColumns, CMP-25 to 29; RC_HIDE_BATCH). Prompts written before building and kept from the builders; original brief; output tokens, new then without, two runs each:

| prompt | with | without | change |
| :-- | --: | --: | --: |
| merge sort | 32.1, 24.5 | 23.0, 33.6 | 0% |
| TCP handshake | 25.1, 20.0 | 25.0, 21.4 | -3% |
| bill to law | 22.8, 15.2 | 26.6, 26.7 | -29% |
| binary search (baseline) | 23.6, 32.1 | 26.1, 37.5 | -12% |
| mortgage | 11.3, 8.8 | 16.5, 19.3 | -44% |
| unit converter | 20.6, 17.6 | 16.3, 21.1 | +2% |
| RSVP | 19.3, 14.4 | 17.0, 17.4 | -2% |
| tip (baseline) | 11.3, 21.5 | 18.4, 12.2 | +7% |
| cocktail | 8.4, 9.8 | 15.4, 14.4 | -39% |
| itinerary | 13.9, 12.5 | 23.6, 24.4 | -45% |
| medication | 17.6, 17.8 | 18.9, 16.1 | +1% |
| recipe (baseline) | 9.2, 7.0 | 18.8, 18.2 | -56% |

Means 17.3K against 21.2K (-18%); 8 of 12 prompts cheaper; sign-flip p about 0.02 on prompt means. Step -11%, form -10%, panel -36%. Biased slightly for the new sets: in the without condition the Walkthrough pitfall names the hidden StepExplainer (a failed get in at least 5 runs). Card's optional title stays in both. Found by runs: textFromFloat misprints small values (0.000621 as 0.21) and 10.97 as 10.96, CMP-16's small-size icon stays on the first stage, a sample on a non-exported variable fails with an opaque HEADER error, design rule says Walkthrough while StepExplainer exists, kit omits Stepper and Slider for forms, ScaledAmount from a Slider factor does not follow a drag.

textFromFloat: the misprints come from androidx StringUtils.floatToString, not our players. Run on the JVM, every x.97 at 2 decimals prints x.96 (1.0% of cent values, up to 50,000), 0.000621 at 6 decimals prints 0.210001, and C++ and TS match it. Printing floor(cents / 100) and cents % 100 as whole numbers had 0 wrong in 5,000,000 on the JVM, and 10.97, 19.97, 0.07 and 1234.5 read right in TS (19.97 also in C++). Library components that print decimals keep the bug: an upstream fix would cover them all. The kit now gives this rule on money words. CMP-16's stuck small icon did not reproduce with stage 0 and 2 set directly; the two runs saw it in their own copies.
