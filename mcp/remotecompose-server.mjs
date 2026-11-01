// remotecompose-server.mjs — one MCP front door over every RemoteCompose server.
//
//   node remotecompose-server.mjs            stdio
//   node remotecompose-server.mjs --http     HTTP on MCP_HTTP_PORT (deployed on 8814)
//
// The single-purpose servers (json2rc, rc-render, rc-inspect, rc-deploy, rc-examples, guide)
// stay as they are; this one imports their tool definitions and regroups them into a dozen
// tools with one workflow, so a client configures one URL and one token, and a model reads
// one set of instructions instead of assembling the process from six. Tools that were
// variations of one another become one tool with a selector (`inspect` + `task`, `find` +
// `kind`): a long tool list costs context and makes the choice worse.
//
// Public routes (no token) are those of the servers it includes: the example gallery and
// playgrounds (/, /components/, /play/...), published pages (/pages/...) and rendered images
// (/images/...), all under this server's own MCP_PUBLIC_URL.

import { definition as json2rc } from "./json2rc-server.mjs";
import { definition as render } from "./rc-render-server.mjs";
import { definition as inspect } from "./inspect-server.mjs";
import { definition as deploy } from "./deploy-server.mjs";
import { definition as examples } from "./examples-server.mjs";
import { serve, isMain } from "./lib/mcp-server.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolvePath } from "./lib/workspace.mjs";
import { RC2IMAGE, runRc2image } from "./lib/rc2image.mjs";
import { enginesTool } from "./lib/engines.mjs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { designNotes, blockingFindings, readsClock } from "./lib/design-audit.mjs";

const resolveIn = (p) => resolvePath(p, "json_path");

/** The JSON document a call is about (inline or a file), or null for binary input. */
function jsonOf(args) {
    try {
        const j = args.json ?? ((args.json_path ?? args.input_path) ? readFileSync(resolveIn(args.json_path ?? args.input_path), "utf8") : null);
        return typeof j === "string" ? JSON.parse(j) : j;
    } catch { return null; }
}
/** A tool's content with the document's design warnings appended (see designNotes). */
function withDesign(content, args, { first = false } = {}) {
    const json = jsonOf(args);
    const notes = json ? designNotes(json) : "";
    if (!notes) return content;
    const block = { type: "text", text: "Design warnings to fix before this is shown or published (an image may still look right: they are about other players, sizes or states).\n" + notes };
    return first ? [block, ...content] : [...content, block];
}

const tool = (def, name) => {
    const t = def.tools.find((x) => x.name === name);
    if (!t) throw new Error(`${def.name} has no tool ${name}`);
    return t;
};
const text = (s) => [{ type: "text", text: s }];

/**
 * One tool that dispatches on a selector argument to several underlying tools. Its schema is
 * the union of theirs plus the selector; each underlying tool gets the arguments minus the
 * selector, so they keep their own validation and messages.
 */
function dispatcher({ name, title, description, selector, choices, fallback, annotations }) {
    const properties = { [selector]: { type: "string", enum: Object.keys(choices), description: `Which ${selector}.` } };
    for (const t of Object.values(choices)) {
        for (const [k, v] of Object.entries(t.inputSchema?.properties ?? {})) properties[k] ??= v;
    }
    return {
        name,
        annotations: { title, ...(annotations ?? {}) },
        description,
        inputSchema: { type: "object", properties, ...(fallback ? {} : { required: [selector] }) },
        handler: async (args = {}) => {
            const { [selector]: which = fallback, ...rest } = args;
            const t = choices[which];
            if (!t) throw new Error(`${name}: unknown ${selector} '${which}' (one of ${Object.keys(choices).join(", ")})`);
            return t.handler(rest);
        },
    };
}

const RO = { readOnlyHint: true, openWorldHint: false };

const WORKFLOW = `RemoteCompose: server-driven UI as a compact binary document (.rc), written as JSON.

The workflow for a new document:
1. build_kit with the goal in plain words. It returns the library components to call, the
   smallest set of verified examples (with JSON snippets and pitfalls), design rules for this
   goal, and needs_component: things to show that the library has no component for.
2. For each needs_component entry, write an inline component and check_component it with a
   sweep over its parameter range until every rendered state is right. Never use text glyphs
   or emoji as icons, and never paste the same drawing once per occurrence.
3. Assemble the document: components (library and inline), the examples' snippets, values
   computed in the document (from the clock, host variables, expressions) rather than pasted.
4. convert (with check: true) to validate it, render to look at it (other states too: other
   dates, values, light and dark, a narrow and a wide size), and audit it: the audit flags
   glyph icons, repeated subtrees, hard-coded dates and colours, and expressions Android
   rejects (over 32 entries). Fix and repeat.
5. publish to package it as a web page (a playground) when the user wants to see or share it.

Look things up with find (examples, components, capabilities) and get; reference has the
component authoring guide and full documentation for every tool. inspect answers questions
about a document (layout, variables, accessibility, interactions, bytes, runtime).`;

const EXPRESSIONS = `Expressions (a string anywhere a number goes: "componentWidth() / 2", "@progress * 360")
- Operators: + - * / % and unary -, with parentheses. Numbers are floats. There are NO comparison operators (no > < == ):
  a test is step(x, edge) (1 when x > edge) or ifElse(whenFalse, whenTrue, cond) — the CONDITION IS THE LAST ARGUMENT,
  cond > 0 picks the second (TIM-13 uses it); "x >= 0" is step(x, -0.0001), "a == b" is 1 - min(1, abs(a - b)) for
  integers, "x < edge" is 1 - step(x, edge).
- Functions: sin cos tan asin acos atan atan2(y, x) (radians), sqrt abs pow(x, y) exp log (base 10) ln square hypot(x, y),
  min max clamp(min, max, x) floor ceil round fract sign, step(x, edge) = 1 when x > edge else 0 (the VALUE first, the reverse
  of GLSL's step(edge, x); so is smooth_step(x, edge0, edge1)), lerp(a, b, t) mad(a, b, c) = a * b + c,
  ifElse(whenFalse, whenTrue, cond) (the condition LAST; cond > 0 picks whenTrue), ping_pong(x, len), rand(), arrayGet(array, i)
  arrayLength arrayMin arrayMax arraySum,
  spline / arraySpline(array, t) splineLoop.
- Variables: "@name" for a resources.variables entry, a named variable command, a component param or a local; a text
  cannot be read as a number (textFromFloat goes the other way). resources.variables are written first and in order:
  one may read an earlier one, never a "variable" command declared in the tree; a tree variable (a canvas "variable"
  command, a "global" block) may read resources.
- Clock and calendar (read live, so a document shows now, and pinned by render's clock): timeInHr() (0..23, the hour),
  timeInMin() (0..1439, minutes of the day), timeInSec() (0..3599, seconds within the HOUR, not of the day), so seconds of
  the day = timeInMin() * 60 + timeInSec() % 60; all whole numbers in the device's local time (offsetToUtc() for UTC);
  continuousSec() (0..3599.999, seconds WITHIN THE HOUR with fractions, updated every frame: it wraps at the hour, so a
  stopwatch or elapsed time uses timeInMin() * 60 + continuousSec() % 60, the fractional seconds of the day, and
  handles midnight), year(), calendarMonth() (1..12),
  dayOfMonth() (1..31), dayOfYear() (1..366), weekDay() (1 = Monday .. 7 = Sunday), epochSecond(), offsetToUtc() (seconds; pin it with
  system_variables {"10": 0} to check UTC days), animationTime(), deltaTime().
- Calendar arithmetic (no example has it; derive it, as named variables, from the clock values above; verified
  against every day of 1999-2040). Equality: "1 - min(1, abs(x))" is 1 when x = 0 (written eq(x) below).
  leap = eq(y % 4) * (1 - eq(y % 100)) + eq(y % 400), with y = year().
  daysInMonth = 30 + (m + floor(m / 8)) % 2 - eq(m - 2) * (2 - leap) with m = calendarMonth() (27 entries, as in
  TIM-10; a sum of eq() per short month passes 32); daysInYear = 365 + leap.
  A date N days away (|N| < 28): d = dayOfMonth() + N; past the end: "d - daysInMonth(calendarMonth()) * step(d,
  daysInMonth(calendarMonth()))"; before the 1st: add daysInMonth of the previous month (month 0 is December of y - 1).
  Monday of this week: dayOfMonth() - weekDay() + 1 (then the rule above when it is ≤ 0).
  ISO week number: p(y) = (y + floor(y / 4) - floor(y / 100) + floor(y / 400)) % 7; weeks(y) = 52 + max(eq(p(y) - 4),
  eq(p(y - 1) - 3)); wk = floor((dayOfYear() - weekDay() + 10) / 7); week = ifElse(ifElse(wk, 1, step(wk, weeks(y))),
  weeks(y - 1), step(1, wk)) — the last days of December can be week 1, the first days of January week 52 or 53.
  A computed date (a day-of-year d, from today + N or an event) as "21 December": month by counting the month
  starts passed, in two variables to stay under 32 entries, with L = leap: c1 = step(d, 31) + step(d, 59 + L) +
  step(d, 90 + L) + step(d, 120 + L) + step(d, 151 + L) + step(d, 181 + L); c2 = step(d, 212 + L) + step(d, 243 + L)
  + step(d, 273 + L) + step(d, 304 + L) + step(d, 334 + L); month = 1 + c1 + c2; before = ifElse(floor(30.6 * month -
  32.3) + L * step(month, 2), 31 * (month - 1), step(3, month)); day = d - before; the month name is a TextChoice over
  "month - 1", the number a textFromFloat (flags 5) joined by textMerge. Weekday name: TextChoice over weekDay() - 1.
  Check with render clocks ["2026-12-31", "2027-01-01", "2024-12-30", "2028-02-29"].
  A date the app stores (last watered, a due date, a birthday): the app sends it as an EPOCH DAY, the local date's
  days since 1970-01-01 (a float holds it exactly; 20757 is 2026-10-31). Today's epoch day, with y = year(): e1 =
  365 * (y - 1970) + floor((y - 1969) / 4); today = e1 - floor((y - 1901) / 100) + floor((y - 1601) / 400) +
  dayOfYear() - 1. Days since = today - @day ("today" / "1 day ago" / "N days ago" by step on it), days until = @day -
  today; any distance, across years and leap days. Not epochSecond() (see below) and not a day-of-year (wrong
  across New Year).
  Equinoxes and solstices (Meeus, mean, ±15 min, 2000-2050), as an epoch day with fractions (UTC), with Y =
  (year() - 2000) / 1000: March 11036.30984 + 365242.37404 * Y; June 11129.06767 + 365241.62603 * Y; September
  11222.71715 + 365242.01767 * Y; December 11312.55952 + 365242.74049 * Y (the quadratic terms are under a minute).
  Days until = floor(event + offsetToUtc() / 86400) - today; past this year's December one, use year() + 1.
- Component and host values: componentWidth() componentHeight() (the canvas's own box, inside a canvas's commands),
  windowWidth() windowHeight() density() fontSize() apiLevel(); batteryLevel() powerState() networkSignal() memoryFree()
  are json2rc extensions the Java parser rejects and Android does not define: a battery level is a host float the app
  exports and keeps up to date ({"battery": {"value": 76, "export": true}}, as BatteryIndicator takes it);
  (epochSecond() converts here but the Android parser does not know it: build an instant from dayOfYear(), timeInMin(),
  timeInSec() and offsetToUtc() instead, as TIM-08 does; a float keeps 24 bits, so subtract days and seconds separately),
  touchX() touchY() touchVelX() touchVelY() touchTime(), accelX/Y/Z() gyroX/Y/Z() magneticX/Y/Z() light().
- Limits: Android rejects an expression over 32 entries (operands and operators together): split a long formula into
  named variables (resources.variables or canvas "variable" commands) and combine them; the audit reports the longest.
  Trig is in radians; a modulo of a negative number keeps its sign (use fract or add the period first).
`;

const FORMAT = `RemoteCompose JSON essentials (get an example with \`get\` for full syntax):

Structure
- {"header": {"apiLevel": 7, "width", "height", "profiles": 513, "contentDescription"}, "resources": {...}, "root": {...}}.
- Lay a UI out with components: column, row, box, flow, text, spacer, image, statelayout, collapsibleRow/Column,
  and library components (Card, ListItem, StatTile, Icon, Gauge, ...: find kind "components"). They measure and
  wrap text, follow the font scale and the screen size, and expose text to screen readers.
- A canvas is for drawings (a chart, a dial, an arc), sized by its modifiers inside the layout. Do not draw a
  whole screen on one canvas: its texts are placed by hand and nothing relayouts when the size changes.
- Modifiers are a list: ["fillMaxWidth", {"padding": 16}, {"spacedBy": 8}, {"background": "@colors.surface"},
  {"clip": {"roundedRect": 16}}, {"weight": 1} (in a row), {"verticalWeight": 1} (in a column), {"visibility":
  "@shown"}]. visibility takes a DECLARED variable that is exactly 1 (shown) or 0 (hidden): put the condition in
  resources.variables ({"shown": "step(@days, 0.5)"}) and reference it. An expression written inline is an INTEGER
  expression (+ - * / %, abs, min, max, clamp, whole numbers only): "step(@days, 0.5)" is not one, becomes a text id
  and hides the component; a plain number is a variable id. 0 removes the component (GONE: no space, no taps);
  2 (INVISIBLE) keeps its space AND still takes taps — hide a button with 0, never 2.
  Any layout node takes it (text, box, row, canvas…); a library or inline component CALL takes its params only — to
  hide or switch a call, wrap it in a box carrying the visibility. width/height take a "@variable" or an expression;
  size takes numbers only ({"size": 40} or [w, h]) — write width and height for a computed size.
- Arrays: "resources": {"floatArrays": {"week": [6200, 8400, 7100, 10300, 5600, 12100, 9000]}} (or {"week":
  {"value": [...], "export": true}} for one the host sets); a chart component takes it as "@week"; in an expression
  arrayGet(@week, 3), arrayMax(@week), arraySum(@week), arrayLength(@week) (EXP-08). There is no sum of PART of an
  array ("total so far today"): have the app send a running-total array too (arrayGet(@cum, timeInHr()) is the total
  up to now), rather than one variable per element.
- Repaint: a document that reads the running clock (continuousSec(), animationTime(), a time-driven expression) repaints
  every frame for as long as it is shown — the format cannot drop the listener when the value stops changing (a stopped
  stopwatch still repaints). Keep clock reads to what must move; a document that reads only minutes repaints once a
  minute. Date values alone (dayOfMonth(), weekDay(), dayOfYear()...) schedule NO repaint: a date-only document turns
  the page at the host's next redraw. To flip at midnight on its own it must read the time (timeInMin(): a check every
  minute, the pixels unchanged until the day turns); a wake at midnight is the canvas command {"type": "wakeIn",
  "seconds": "(1440 - timeInMin()) * 60 + 1"}, which reads timeInMin() too. No once-a-day wake exists: on e-ink, either
  accept the minute check (a host refreshes the panel only when pixels change) or have the app redraw at midnight.
- Computed colours (json2rc extension; the reference JSON parser has none): in resources.colors,
  {"swatch": {"hsv": ["@hue", "@sat", "@val"], "alpha": 255}} with h, s, v in 0..1 (hue as a fraction of the turn), or
  {"argb": [a, r, g, b]} in 0..1 — numbers, "@variables" or expressions; "@colors.swatch" then follows the values at
  run time (a colour picker's preview). HSL is not native: V = L + S·min(L, 1 − L), S_v = 2·(1 − L / V) (0 when V = 0).
  A library Slider: "@level" read AFTER the slider in the tree (a text, a canvas expression, a tree variable command
  placed after it) is the live dragged value; resources.variables are computed before the tree and see the bound
  variable, written only when the drag ENDS (with onRelease): compute a live preview after the slider. A literal text that starts with "#" is read as a colour, not a text (both parsers):
  join "#" through a text that does not start with it ("Hex " + "#…", or a textMerge whose first part is " #").
- A colour the app sets (a document colour in resources.colors, set by name like any host variable) wins in every
  look, mono included: its "mono-dark"/"mono-light" values are only the starting value. For a mono look that ignores
  the app's colour, draw that element through a component with {"$if": "theme.mono"} choosing @colors.onSurface.
- Host numbers are floats (resources.variables {"code": {"value": 3, "export": true}}), codes and counts too: an
  "integers" resource reads as 0 in every float expression (an index, a size, a TextChoice), so it never moves.
- 12/24-hour: no system value gives the device's preference; the app sends it as a host float ("use24h": 0/1)
  and the document picks the format from it (DigitalClock takes it).
- Text input: there is none. A document shows text (literal, computed, or host strings the app sets) and reacts to
  taps and drags; typing happens in the app. A form field is a host string displayed in a box whose tap sends the app
  an action to open its own input (see the "Text entry is the app's" design rule).
- Actions: a tap is a modifier {"onClick": {...}} or {"onClick": [{...}, {...}]} on any component. Set a variable:
  {"type": "valueFloatChange", "target": "@playing", "value": 1}; compute one: {"type": "valueFloatExpressionChange",
  "target": "@playing", "value": "1 - @playing"}; tell the app: {"type": "hostNamedAction", "name": "next"} or with a
  literal payload {"type": "hostNamedAction", "name": "open", "value": "track-3"}, or a variable's CURRENT value with a
  type: {"type": "hostNamedAction", "name": "setVolume", "value": "@level", "valueType": "float"} (int, string and
  floatArray too; read when the action runs — a json2rc extension: the reference JSON parser writes only literals). A tap that must reach the app sends a
  hostNamedAction; an exported variable alone only changes what the app can read. A dragged value: the format's
  HostNamedAction can carry a float/int/string VARIABLE (read when it runs) and {"onTouchUp": [...]} fires at the end
  of a drag: {"onTouchUp": [{"type": "hostNamedAction", "name": "setVolume", "value": "@level", "valueType": "float"}]}
  sends the level when the finger lifts. Every host action needs the app to handle it: a demo without a host shows
  nothing, but inspect interact lists host_actions with their values and the playground's panel logs each one. Several controls may send
  the SAME action name (five stars sending "rate" with their value): json2rc declares a shared name once before the
  tree. The reference Java parser does not (the second control would send a nameless action until the first is
  tapped, U58), so for a document that must also convert with it, give each control its own name.
- Scrolling: {"column": {"modifiers": ["fillMaxSize", {"verticalScroll": "@scroll"}], "children": [...]}} with
  "scroll": 0 in resources.variables (the scroll position; horizontalScroll likewise). A phone screen longer than its
  height scrolls; a widget never does (it drops or compacts content instead).
  A library Button/IconButton takes the same list in its "onClick" param. Check taps with inspect interact.
- Host strings (a name, a symbol, a label the app sets): not in resources — a root-level variable command before the
  layout, "root": [{"variable": {"name": "sym", "vtype": "string", "value": "AAPL", "export": true}}, {"column": ...}],
  then "@sym" wherever a text goes (HST-01). Numbers the app sets: resources.variables {"price": {"value": 189.84,
  "export": true}}.
- Widget sizes (Android home screen, dp): a cell is ~70 dp less margins, so design 4x2 at 320×160 (hosts give
  250×110 up to 360×190), 4x1 at 320×80 (250×40 up), 2x2 at 160×160 (110×110 up); a watch tile 160–220 square;
  render variants covers narrow, short, small, tiny and square. Check the smallest you support.
- Maps (Natural Earth, public domain; built when the document is built): the library WorldMap covers most maps:
  {"WorldMap": {"region": "Europe", "borders": true, "highlight": ["FRA"], "cities": ["Paris"], "labels": true}};
  at run time it also colours countries from a host array ("values": "@visited", "valueCountries": ["FRA", ...], one
  value 0..1 each, in that order), draws points from host arrays ("pointsLon": "@lons", "pointsLat": "@lats"), a
  great-circle route ("routeFrom": "Paris", "routeTo": "Singapore", "progress": "@p" for the flown part and a plane on
  its heading), state/province borders ("states": ["AUS"]), the night side ("night": true) and one moving marker
  ("markLon"/"markLat"). map_info {region} lists a region's countries (the valueCountries order), its height, its
  cities and how coarse it is. Building blocks for your own canvas: {"$map": {"region": "world" | a continent | a
  country (ISO "FRA" or name: its main landmass with nearby islands) | [lonMin, latMin, lonMax, latMax], "layer":
  "land" | "countries" | "states" | "lakes" | "graticule", "detail": "low" | "medium" | "high", "countries": [...],
  "outline": true}} is a path in a box 1000 units wide and {"$mapHeight": region} tall (scale it uniformly:
  s = min(componentWidth() / 1000, componentHeight() / height), and clipRect the box; "outline": true for a STROKED
  coast, without the straight edges where a fill is cut); {"$mapPoint": {"region": ..., "at": "Tokyo" | [lon, lat],
  "axis": "x" | "y"}} is a point (a number), or with "lon": "@lon", "lat": "@lat" (any expression, "arrayGet(@lons,
  i)" in a loop) an expression; {"$mapRoute": {"region": ..., "from": "Paris", "to": "Singapore"}} a great-circle
  path, and with "axis": "x" | "y" | "angle" its samples as a float array (evenly spaced by distance, "wrap":
  "arraySpline({}, @progress)" is the point at that fraction; angle is the heading in degrees, 0 = east, 90 = down).
  Equirectangular: x ∝ longitude, y ∝ latitude, x scaled by cos of the region's middle latitude. Data is 1:50m (1:110m
  for regions over 90° wide): fine for a continent or a country, too coarse for a city (map_info says). A world of
  land at low detail is ~6 KB. Places at map coordinates in LAYOUT (a card beside a city): there is no offset
  modifier: stack a box over the map whose column holds a spacer {"height": "y * s"} then a row of a spacer {"width":
  "x * s"} and the card (x, y from $mapPoint, s the map's scale), or draw the label in the canvas.
- Charts from data: pathExpression draws a SMOOTH curve through its samples (a spline: a jump between neighbours
  bows), so it suits a trend line, not steps or bars. A step chart (a hypnogram, a bar per slot) is a canvas loop
  {"loop": {"index": "i", "from": 0, "until": "arrayLength(@stages)", "commands": [{"drawRect": {... "arrayGet(@stages,
  i)" ...}}]}} — the loop index is a name the loop binds; or the library BarChart / LineChart for the common cases.
- A "global" block declares shared values once, before everything: at the root, {"global": {"children": [{"variable":
  {"name": "goal", "value": 10000}}, ...]}} (STR-10); in a canvas, {"global": {"commands": [{"textSubtext": {...}},
  {"textTransform": {...}}]}} for named texts a layout text can then show (TIM-11) — the converter writes a global
  block's declarations before the root, but a name is resolved where the JSON READS it: put the block before its
  first reader (a canvas's commands come after its own modifiers, so the canvas holding the global cannot use it in
  its own semantics; use a size-0 canvas placed earlier), or the reader gets the literal "@name".
- Smaller sizes: a widget is resized by its host. Drop content by priority with a collapsibleColumn inside a padded
  box: {"box": {"modifiers": ["fillMaxSize", {"padding": 16}], "children": [{"collapsibleColumn": {"modifiers":
  ["fillMaxSize"], "horizontalAlignment": "start", "verticalArrangement": "top", "children": [...]}}]}}, with
  {"collapsiblePriority": {"orientation": "vertical", "priority": N}} on the optional children (lowest N dropped first;
  none = dropped last, only if it does not fit on its own). A weighted child is never dropped and shrinks first: give a
  chart a fixed height instead of a weight (a weight does not combine with heightIn), so the optional texts are what goes.
- fitBox: {"fitBox": {"modifiers": ["fillMaxSize"], "children": [{"column": {"modifiers": ["fillMaxWidth", {"height":
  132}], ...}}, {"row": {"modifiers": ["fillMaxWidth", {"height": 72}], ...}}, {"row": {"modifiers": ["fillMaxWidth"],
  ...}}]}} (LAY-09 is the feature demo: fixed-size cards in three colours so the chosen one is obvious — a widget uses
  fillMaxWidth alternatives and theme colours). The first child, in order, that fits is shown; the others are hidden. A child fits when its
  MINIMUM size fits the box: an exact width or height, and what its content cannot shrink below (a row sums its
  children's minimums: seven 32 dp discs need 224 dp; a text's minimum is its own width; fill and wrap count 0).
  A TEXT's minimum is its whole one-line width even when it may wrap or ellipsize (a sentence or a long name inside an
  alternative makes it "need" 300+ dp, and the two players disagree on a weighted text's minimum): when the
  alternatives hold texts, switch layouts with a stateLayout on the window instead — {"stateLayout": {"indexId":
  "@layout", ...}} with layout = "step(windowWidth(), 300) + step(windowHeight(), 140)" — which picks by size, not by
  content. Each alternative is a full copy of its content (bytes add up): keep two or three, with inline components.
  So a wrap child does not always fit: order the children largest first, and make the last one fit the smallest
  size you support (size it from the box: "width": "@disc" with disc = "min(32, (windowWidth() - 40) / 7)"); when
  nothing fits the fitBox shows nothing (inspect layout reports fitbox_no_fit). The chosen child is measured in the
  box: fillMaxWidth fills it, an exact width is CENTRED at that width, an exact height stays, a wrap child wraps.
  Use exact HEIGHTS as the thresholds (fillMaxWidth + height N on each alternative); a width threshold via widthIn
  min does not work (below the minimum the child is laid out 0 wide). width/height accept a "@variable" or an
  expression; componentWidth()/componentHeight() in a width/height modifier read the PARENT's box: {"width":
  "componentWidth() * 0.4"}. A width relative to the PARENT is also {"fillMaxWidth": 0.5} or {"fillMaxWidth":
  "@fraction"} (a fraction of the parent; same for fillMaxHeight), a weight in a row, or windowWidth() (the surface).
  collapsibleColumn ignores its own padding and centres by default. Or a StateLayout, or verticalScroll.
- Text picked by a runtime index (a phase name, a weekday, "Rising"/"Falling"): the TextChoice component
  ({"TextChoice": {"items": ["New moon", ...], "index": "@phaseIndex"}}). A layout text cannot take textSubtext /
  textTransform / textLookup (only canvas commands can); numbers go through textFromFloat, joins through textMerge:
  {"text": {"value": {"type": "textMerge", "id1": "Week ", "id2": {"type": "textFromFloat", "value": "@week",
  "whole": 2, "decimal": 0, "flags": 5}}}} (nest textMerge for more parts). whole/decimal are digit counts; flags
  is the padding: whole part 0 spaces | 4 none | 12 zeros, plus decimals 0 spaces | 1 none | 3 zeros, plus 16 for
  thousands grouping — so 5 = no padding ("7"); 0 (the default when flags is left out) pads the whole part with
  SPACES to "whole" digits (" 12 min", a leading space a screen reader reads): give flags 5 (or 4) unless you want
  aligned columns; 13 = zero-padded whole ("07"), 7 = forced decimals ("7.50", money),
  23 = grouped money ("1,234.50" with whole 7, decimal 2), 15 = "07.50".
  "whole" is a maximum: a number with more digits loses the leading ones (whole 4 shows 12345 as "2345"), so size it
  for the largest value the app can send — and with grouping (16) the separators count too (260,840 needs whole 7:
  whole 6 shows "60,840").
  Money: compute in whole cents and round there, then divide — "round(@bill * @pct)" in cents, shown as "@cents / 100"
  with decimal 2: a float like 46.475 is stored as 46.47499… and prints "46.47" whatever the flags.
  textTransform needs {"text": "@name", "start": 0, "len": -1 (to the end), "operation": N, "varName": "out"} (all
  required; it runs among canvas commands, like textSubtext {"text", "start", "len", "varName"}) and takes "operation" as a NUMBER: 1 lowercase, 2 UPPERCASE, 3 trim, 4 Capitalize Each Word, 5 Capitalize
  first. Do not use the names: the format's JSON parser maps "uppercase" to 1 (lowercase), "lowercase" to 2 and
  "capitalize" to 3 (trim) — json2rc writes the same bytes (U74).
- Text keys: {"text": {"text" | "value": ..., "fontSize": 14, "fontWeight": 700 (a NUMBER 100-900: "bold" is an
  error), "fontStyle": "italic", "fontFamily": "sans-serif" | "serif" | "monospace", "color": "@colors.onSurface",
  "textAlign": "start|center|end", "maxLines": 1, "overflow": "ellipsis" | "clip", "letterSpacing": 0.05 (in em: 0.1 is wide, 1 is huge), "autoSize":
  true (shrinks the font to fit its box; "minFontSize"/"maxFontSize" bound it, alone they do nothing), "strikethrough": true, "underline": true, "modifiers": [...]}}.
  strikethrough/underline are fixed per text: a to-do "done" look is two texts of the item (one plain, one
  strikethrough + muted) switched by visibility on the item's state.
- Alignment is a key of the container, not of the child: box {"horizontalAlignment": "center", "verticalAlignment":
  "center"} centres its children (so does fitBox); row {"verticalAlignment", "horizontalArrangement"}; column
  {"horizontalAlignment", "verticalArrangement"}; values start | center | end (top | bottom for vertical, plus
  spaceBetween | spaceAround | spaceEvenly for an arrangement). There is no contentAlignment.
- Accessibility: the header's contentDescription describes the document; a node is labelled with the modifier
  {"semantics": {"contentDescription": "Today", "clickable": true}} (contentDescription as a plain key on a text or
  box is dropped); the description may be a text object ({"type": "textMerge", "id1": "Phone, ", "id2": {"type":
  "textFromFloat", "value": "@level", ...}}) so a screen reader hears live values. Every layout text is already a
  readable node; a drawing on a canvas is not.
  A word joined to other text in one wrapping line ("Waning gibbous, 57% lit") is not a TextChoice: compute it as a
  named text in a canvas "global" block (textSubtext over fixed-width names, then textTransform to trim; see
  TIM-11), then use "@name" in a layout text's textMerge.
- Trap: a weight does not combine with widthIn/heightIn (the child gets 0 and vanishes): give it one or the other.
- Checking dates: render and inspect take system_variables {"10": 0} to pin offsetToUtc() (UTC days), so a
  result does not depend on the server's time zone; pass clock too.
- Trap: weighted children ignore spacedBy (the weights share the whole width, then the gaps overflow it). In a
  row or column with weights, put fixed spacer boxes ({"box": {"modifiers": [{"width": 8}]}}) between them.

Canvas (when you do draw)
- Commands, in "commands": paint {color, style "fill"|"stroke", strokeWidth, textSize, textAlign...} sets the paint for what
  follows; drawRect / drawRoundRect {left, top, right, bottom, rx, ry} / drawCircle {cx, cy, radius} / drawOval / drawArc
  and drawSector {left, top, right, bottom, startAngle, sweepAngle} / drawLine {x1, y1, x2, y2} / drawPath {path} (a
  pathExpression or a "path" resource, not an SVG string) / drawTextAnchored {text, x, y, panX, panY} / drawTextOnPath;
  save / restore, translate {dx, dy}, rotate {angle, cx, cy}, scale {sx, sy}, clipRect, clipPath; variable {name, value}
  (a named float for the commands after it), loop {index, from, until, commands}, conditionalOperations, global
  {commands} (text commands: textSubtext, textTransform, textLookup, textMeasure; textFromFloat and textMerge are not
  commands but VALUE objects, usable wherever a text goes — a text's value, drawText's text, a contentDescription — and
  identical objects convert to one shared op, so repeating one costs nothing). get DRW-* examples show each.
- Derive coordinates from componentWidth() / componentHeight() (named "variable" commands, then reused), or
  scale a fixed design box to the size: literal coordinates only fit the header size.
- The paint is sticky: set color/style/strokeWidth/textSize before each kind of draw.
- drawTextAnchored {text, x, y, panX, panY}: the pan says where the TEXT goes relative to (x, y):
  panX -1 = to the right of x (left-aligned), 0 = centred on x, 1 = to the left of x (right-aligned);
  panY -1 = above y, 0 = centred on y, 1 = below y.
- Never SVG path strings: use pathExpression or the components (Java writes SVG strings as empty paths).
- A fixed shape is a "path" resource written as ops: "resources": {"paths": {"tri": [{"type": "moveTo", "x": 8, "y": 5},
  {"type": "lineTo", "x": 19, "y": 12}, {"type": "lineTo", "x": 8, "y": 19}, {"type": "close"}]}} drawn with {"drawPath":
  {"path": "$paths.tri"}}. Avoid hand-written pathData arrays: their verbs carry the PREVIOUS point too (a LINE is
  "path:LINE", x0, y0, x1, y1; a CUBIC eight numbers), and a LINE given only its end point draws nothing.

Values
- Colours: theme colours "@colors.onSurface" etc.; literal "#AARRGGBB" otherwise. Write each component call once:
  the same JSON expands for every look. Light and dark follow the system theme; mono and mono-light
  (always-on, e-ink) are the same JSON expanded with the components' mono implementation (render with
  componentTheme "mono-dark" or "mono-light" to check it; the published playground's Mono buttons switch to it).
- Expressions are strings: "componentWidth() / 2", "@progress * 360"; Android rejects one over 32 entries:
  split long formulas into named variables.
- Anything that depends on the date or time (today, this month, "in 3 days") is computed from the clock
  (dayOfMonth(), calendarMonth(), year(), timeInMin(), ...), never typed in.
- Icons: {"Icon": {"name": "wifi"}} (find kind "icons"), never text glyphs or emoji.`;

/**
 * render with variants: the states a user will reach, in one call, each captioned: the
 * themes (and mono for always-on and e-ink), a narrow and a wide size, another time of day
 * for a document that reads the clock. A model checks what is cheap to check.
 */
/**
 * Does the document still fit when the host makes it smaller (a widget resized down)? The
 * audit's layout overflow at 60% of the height and 72% of the width (the variants' sizes), as a note naming the
 * fixes, or "" when it fits.
 */
async function smallSizeNote(args) {
    const json = jsonOf(args);
    const header = json?.header ?? {};
    const W = args.width ?? header.width, H = args.height ?? header.height;
    if (!W || !H) return "";
    const src = json ? { json } : args.rc_path ? { rc_path: args.rc_path } : null;
    if (!src) return "";
    // What breaks at a smaller size and not at the design size: content past its box, or (a
    // column that runs out of room squeezes its last children to nothing) zero-size components.
    // Judged by the renderer the images come from (C++), not the TS inspector: the two measure
    // text a fraction apart, and a fitBox at its threshold flipped in one only (a calorie card
    // "no longer fit" at a size whose render showed the compact layout intact).
    const broken = async (w, h) => {
        const r = await tool(render, "render_rc").handler({ ...src, width: w, height: h, public_link: false, _probe: true });
        const text = r.filter((c) => c.type === "text").map((c) => c.text).join("\n");
        const n = (code) => (text.match(new RegExp(`\\[${code}\\] (\\d+)`)) ?? [0, 0])[1] * 1 || (text.includes(`[${code}]`) ? 1 : 0);
        return { overflow: n("component_overflow") + n("text_overflow"), zero: n("zero_size") + n("fitbox_no_fit") };
    };
    const over = [];
    try {
        const base = await broken(W, H);
        for (const [w, h] of [[W, Math.round(H * 0.6)], [Math.round(W * 0.72), H]]) {   // the variants' short and narrow
            const b = await broken(w, h);
            if (b.overflow > base.overflow || b.zero > base.zero) over.push(`${w}×${h}`);
        }
    } catch { /* no verdict */ }
    if (!over.length) return "";
    // A scrolling screen is not a widget: what is cut is a text that does not wrap (the
    // render's text_overflow says which), not content that should collapse.
    if (json && /"verticalScroll"/.test(JSON.stringify(json))) return `size note: at ${over.join(" and ")} something no longer fits (the screen scrolls, so look at the render's text_overflow / component_overflow lines for what is cut).`;
    return `size warning: at ${over.join(" and ")} the content no longer fits (cut off or squeezed to nothing). A widget is resized by its host, ` +
        "often smaller than designed: drop the least important content first (a collapsibleColumn with collapsiblePriority " +
        "on the optional children, inside a box that carries the padding, horizontalAlignment \"start\", lowest priority " +
        "dropped first: examples LAY-13, LAY-14; reference topic \"format\" has the snippet), switch to a compact layout " +
        "with a fitBox (its first child that fits is shown, full layout first: LAY-09), or at minimum put the content in a verticalScroll.";
}

/** One render per pinned clock, captioned; the findings of each follow its image. */
/** The args with a component look folded into the JSON (what the single render does itself). */
function withLook(args, componentTheme) {
    if (!componentTheme || componentTheme === "auto") return args;
    componentTheme = { mono: "mono-dark", "mono-inverted": "mono-light" }[componentTheme] ?? componentTheme;   // the old names
    const json = jsonOf(args);
    return json ? { ...args, json: { ...json, componentTheme }, json_path: undefined } : args;
}

/** One render per set of host variables, captioned with the values; eased values settled. */
async function renderSamples(t, args, samples) {
    const stem = typeof args.output_path === "string" ? args.output_path.replace(/\.png$/i, "") : null;
    const content = [];
    if (samples.length > 12) content.push({ type: "text", text: `── ${samples.length} samples asked, the first 12 rendered: call again with the rest.` });
    let i = 0;
    for (const vars of samples.slice(0, 12)) {
        i++;
        // An array is summarised (a 44-value array as a caption overlapped the sheet's cells).
        const short = (v) => Array.isArray(v) ? (v.length > 6 ? `[${v.length} values: ${v.slice(0, 4).join(",")}…]` : JSON.stringify(v))
            : typeof v === "string" && v.length > 24 ? JSON.stringify(v.slice(0, 22) + "…") : JSON.stringify(v);
        const label = Object.entries(vars ?? {}).map(([k, v]) => `${k}=${short(v)}`).join(" ");
        // A sample may pin its own clock ("$clock": "2026-06-21T12:00"): a time-of-day scenario
        // is its data AND its hour.
        const { $clock, ...values } = vars ?? {};
        const a = { ...args, variables: { ...(args.variables ?? {}), ...values }, ...($clock !== undefined ? { clock: $clock } : {}) };
        if (stem) a.output_path = `${stem}-sample${i}.png`;
        try {
            const r = await t.handler(a);
            // Errors, warnings and the infos about what the image shows (a text cut with "…").
            const notes = r.filter((c) => c.type === "text" && /^(error|warning|info): /m.test(c.text))
                .map((c) => ({ type: "text", text: c.text.split("\n").filter((l) => /^(error|warning): /.test(l) || /^info: .*(ellipsis|text_ellipsized)/.test(l)).join("\n") }))
                .filter((c) => c.text);
            const file = a.output_path ? ` → ${a.output_path}` : "";
            content.push({ type: "text", text: `── sample ${i}: ${label}${file}${notes.length ? "" : " · findings: none"}` }, ...r.filter((c) => c.type === "image"), ...notes);
        } catch (e) { content.push({ type: "text", text: `── sample ${i} (${label}): ${String(e?.message ?? e).split("\n")[0]}` }); }
    }
    return withDesign(content, args, { first: true });
}

async function renderClocks(t, args, clocks) {
    const stem = typeof args.output_path === "string" ? args.output_path.replace(/\.png$/i, "") : null;
    const content = [];
    // At most 12 renders in one call; say so rather than drop the rest quietly.
    if (clocks.length > 12) content.push({ type: "text", text: `── ${clocks.length} clocks asked, the first 12 rendered: call again with the rest (${clocks.slice(12).map(String).join(", ")}).` });
    for (const clock of clocks.slice(0, 12)) {
        const a = { ...args, clock };
        if (stem) a.output_path = `${stem}-${String(clock).replace(/[^0-9A-Za-z]+/g, "-")}.png`;
        try {
            const r = await t.handler(a);
            // Only the findings: the png_path / Success lines repeat what the caption says.
            // Errors, warnings and the infos about what the image shows (a text cut with "…").
            const notes = r.filter((c) => c.type === "text" && /^(error|warning|info): /m.test(c.text))
                .map((c) => ({ type: "text", text: c.text.split("\n").filter((l) => /^(error|warning): /.test(l) || /^info: .*(ellipsis|text_ellipsized)/.test(l)).join("\n") }))
                .filter((c) => c.text);
            const file = a.output_path ? ` → ${a.output_path}` : "";
            content.push({ type: "text", text: `── clock ${clock}${file}${notes.length ? "" : " · findings: none"}` }, ...r.filter((c) => c.type === "image"), ...notes);
        } catch (e) { content.push({ type: "text", text: `── clock ${clock}: ${String(e?.message ?? e).split("\n")[0]}` }); }
    }
    return withDesign(content, args, { first: true });
}

const SIZE_MARK = Symbol("size");
async function renderVariants(t, args, sizes = [], onlySizes = false, samples = null, clocks = null) {
    const json = jsonOf(args);
    const header = json?.header ?? {};
    const W = args.width ?? header.width ?? 360, H = args.height ?? header.height ?? 640;
    const base = { ...args, width: W, height: H };
    // A document that reads the time of day moves visibly in seven hours; one that reads only
    // the date (a calendar, a season, a day-length curve) needs weeks to show another state.
    const timeOfDay = (j) => /\b(timeInMin|timeInSec|timeInHr|hour|minute|second|continuousSec|animationTime|clock)\s*\(/.test(JSON.stringify(j));
    const clockShift = (hours) => {
        const c = args.clock ? new Date(args.clock) : new Date();
        const d = new Date(c.getTime() + hours * 3600_000);
        const p = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    };
    // A watch face or tile (its words say so) is checked round; a 2x2 widget is square too.
    const isWatch = /\b(watch|wear|tile|face|wrist|round)\b/i.test(JSON.stringify(json?.header ?? {}) + " " + (args.title ?? "") + " " + (args.json_path ?? ""));
    const plan = [
        ["dark theme", { ...base, theme: "dark" }],
        ["light theme", { ...base, theme: "light" }],
        ...(json ? [["mono-dark (always-on displays)", { ...base, json: { ...json, componentTheme: "mono-dark" }, json_path: undefined, theme: "dark" }],
                    ["mono-light (e-ink)", { ...base, json: { ...json, componentTheme: "mono-light" }, json_path: undefined, theme: "light" }]] : []),
        [`narrow ${Math.round(W * 0.72)}×${H}`, { ...base, width: Math.round(W * 0.72) }],
        [`wide ${Math.round(W * 1.6)}×${Math.round(H * 0.75)}`, { ...base, width: Math.round(W * 1.6), height: Math.round(H * 0.75) }],
        [`short ${W}×${Math.round(H * 0.6)} (a widget resized down)`, { ...base, height: Math.round(H * 0.6) }],
        [`small ${Math.round(W * 0.72)}×${Math.round(H * 0.6)} (narrow and short at once)`, { ...base, width: Math.round(W * 0.72), height: Math.round(H * 0.6) }],
        // (A phone screen is never half a phone wide: tiny is for widgets.)
        ...(H > W * 1.3 && H >= 400 ? [] : [[`tiny ${Math.round(W * 0.5)}×${Math.round(H * 0.6)} (half the width)`, { ...base, width: Math.round(W * 0.5), height: Math.round(H * 0.6) }]]),
        // A square of the height: a 2x2 home-screen cell for a wide widget, a secondary screen for a big one.
        // (A widget's 2x2 cell is 160×160, as the format reference says, whatever its own height.)
        ...(W > H * 1.3 ? [H <= 260 ? ["widget 2x2 160×160", { ...base, width: 160, height: 160 }] : [`square ${H}×${H}`, { ...base, width: H, height: H }]] : []),
        // The caller's own sizes (a car display's screens, a kiosk).
        ...(Array.isArray(sizes) ? sizes : []).filter((s) => Array.isArray(s) && s[0] > 0 && s[1] > 0).slice(0, 10)
            .map(([w, h]) => [`size-${Math.round(w)}x${Math.round(h)} (${Math.round(w)}×${Math.round(h)})`, { ...base, width: Math.round(w), height: Math.round(h), [SIZE_MARK]: true }]),
        // A square watch-sized document is a watch face or tile: check it round, small and large.
        ...(W === H && W <= 260 && isWatch ? [["round 160×160 (the smallest watch)", { ...base, width: 160, height: 160, round: true }],
                                   ["round 192×192 (a small watch)", { ...base, width: 192, height: 192, round: true }],
                                   ["round 227×227 (a large watch)", { ...base, width: 227, height: 227, round: true }]] : []),
        // A widget-sized document (not a phone screen) is also checked at the home-screen cell
        // sizes the format reference tells authors to design for.
        ...(W <= 420 && H <= 260 && !(W === H && W <= 260 && isWatch) ? [["widget 4x2 320×160", { ...base, width: 320, height: 160 }], ["widget 4x1 320×80", { ...base, width: 320, height: 80 }]]
            .filter(([, a]) => !(a.width === W && a.height === H)) : []),
        // A phone screen is often asked to work as a widget too, and a tablet is the other end.
        ...(H > W * 1.3 && H >= 400 ? [[`tall ${W}×${Math.round(H * 1.25)} (a long phone)`, { ...base, height: Math.round(H * 1.25) }], ["as a 4x2 widget 320×160 (only if it must also work as a widget)", { ...base, width: 320, height: 160 }], [`tablet ${Math.round(W * 2.2)}×${Math.round(H * 1.4)}`, { ...base, width: Math.round(W * 2.2), height: Math.round(H * 1.4) }]] : []),
        ...(json && readsClock(json) ? [[timeOfDay(json) ? "seven hours later" : "45 days later", { ...base, clock: clockShift(timeOfDay(json) ? 7 : 45 * 24) }]] : []),
    ];
    // sizes alone (no variants): just the caller's sizes.
    if (onlySizes) plan.splice(0, plan.length, ...plan.filter(([, a]) => a[SIZE_MARK]));
    for (const [, a] of plan) delete a[SIZE_MARK];
    // Clocks with sizes: each clock at each size (the first 4 clocks).
    if (Array.isArray(clocks) && clocks.length && onlySizes && !(Array.isArray(samples) && samples.length)) {
        const more = [];
        for (const [label, a] of plan) more.push(...(await renderClocks(t, { ...a, ...(typeof args.output_path === "string" ? { output_path: args.output_path.replace(/\.png$/i, "") + `-${label.split(" (")[0].replace(/[^a-z0-9]+/gi, "-")}.png` } : {}) }, clocks.slice(0, 4))).map((c) =>
            c.type === "text" && c.text.startsWith("── clock") ? { ...c, text: c.text.replace("── clock", `── ${label.split(" (")[0]} · clock`) } : c));
        return more;
    }
    // Samples with sizes: each sample at each size, up to 24 renders in all; what does not fit
    // is said, not dropped quietly.
    if (Array.isArray(samples) && samples.length && onlySizes) {
        const per = Math.max(1, Math.floor(24 / plan.length));
        const more = samples.length > per ? [{ type: "text", text: `── ${samples.length} samples × ${plan.length} sizes: the first ${per} samples rendered at each size (24 renders at most); call again for samples ${per + 1}-${samples.length}.` }] : [];
        for (const [label, a] of plan) more.push(...(await renderSamples(t, { ...a, ...(typeof args.output_path === "string" ? { output_path: args.output_path.replace(/\.png$/i, "") + `-${label.split(" (")[0].replace(/[^a-z0-9]+/gi, "-")}.png` } : {}) }, samples.slice(0, per))).map((c) =>
            c.type === "text" && c.text.startsWith("── sample") ? { ...c, text: c.text.replace("── sample", `── ${label.split(" (")[0]} · sample`) } : c));
        return more;
    }
    const content = [];
    const saidInfo = new Set(), seenErr = new Set();
    // output_path names the set: <stem>-<variant>.png beside it (dark, light, mono-dark, narrow, ...).
    const stem = typeof args.output_path === "string" ? args.output_path.replace(/\.png$/i, "") : null;
    for (const [label, a] of plan) {
        const clean = Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined));
        // The file is named after the caption up to its note ("widget 4x2 320×160" → widget-4x2-320x160).
        if (stem) clean.output_path = `${stem}-${label.split(" (")[0].replace(/ theme$/, "").replace(/×/g, "x").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase()}.png`;
        try {
            const r = await t.handler(clean);
            // Only the findings: the png_path / Success lines repeat what the caption says.
            // An info line (unpainted corners, a collapsed child) is said once, at its first variant.
            const notes = r.filter((c) => c.type === "text" && /^(error|warning): /m.test(c.text))
                .map((c) => ({ type: "text", text: c.text.split("\n").filter((l) => /^(error|warning): /.test(l) || (/^info: /.test(l) && !saidInfo.has(l.slice(0, 40)) && saidInfo.add(l.slice(0, 40)))).join("\n") }))
                .filter((c) => c.text);
            const file = clean.output_path ? ` → ${clean.output_path}` : "";
            content.push({ type: "text", text: `── ${label}${file}${notes.length ? "" : " · findings: none"}` }, ...r.filter((c) => c.type === "image"), ...notes);
        } catch (e) {
            const msg = String(e?.message ?? e);
            // A document that does not convert fails every variant the same way: say it once.
            if (/json2rc failed|does not parse|Unknown token|not valid JSON/i.test(msg)) {
                return [{ type: "text", text: `The document does not convert, so no variant was rendered:\n${msg}` }];
            }
            const first = msg.split("\n")[0];
            content.push({ type: "text", text: `── ${label}: ${seenErr.has(first) ? "the same error" : first}` });
            seenErr.add(first);
        }
    }
    if (!json && !onlySizes) content.unshift({ type: "text", text: "(An .rc has its components expanded already: the mono-dark and mono-light looks need the JSON document, json or json_path.)" });
    // (Asked sizes only: the caller chose them, a smaller-size guess is beside the point.)
    const small = onlySizes ? "" : await smallSizeNote(args);
    if (small) content.unshift({ type: "text", text: small });
    return withDesign(content, args, { first: true });
}

/**
 * A render result with several images turned into one contact sheet: each image captioned
 * with the "── label" line before it, drawn by rc2image --sheet. The text (findings) is kept.
 */
async function toSheet(content, args) {
    const imgs = [];
    let caption = "";
    for (const c of content) {
        if (c.type === "text" && c.text.startsWith("── ")) caption = c.text.slice(3).split(/ → | · /)[0].trim();
        else if (c.type === "image") imgs.push({ data: c.data, caption });
    }
    if (imgs.length < 2) return content;
    const dir = path.join(os.tmpdir(), `rc-sheet-${randomBytes(6).toString("hex")}`);
    const { mkdirSync, rmSync } = await import("node:fs");
    mkdirSync(dir, { recursive: true });
    try {
        const files = imgs.map((im, i) => { const f = path.join(dir, `${i}.png`); writeFileSync(f, Buffer.from(im.data, "base64")); return `${f}=${im.caption.replace(/=/g, ":")}`; });
        const out = typeof args.output_path === "string" ? resolvePath(args.output_path.replace(/\.png$/i, "") + "-sheet.png", "output_path") : path.join(dir, "sheet.png");
        const { err, stderr } = await runRc2image(["--sheet", out, "--cell", "360", ...files]);
        if (err) return [...content, { type: "text", text: `(no contact sheet: ${String(stderr || err.message).split("\n")[0]})` }];
        const sheetPng = readFileSync(out).toString("base64");
        const texts = content.filter((c) => c.type !== "image");
        return [{ type: "image", data: sheetPng, mimeType: "image/png" },
                { type: "text", text: `contact sheet: ${imgs.length} renders${typeof args.output_path === "string" ? ` → ${args.output_path.replace(/\.png$/i, "")}-sheet.png` : ""}` }, ...texts];
    } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
}

const tools = [
    {
        ...tool(examples, "build_kit"),
        description: "START HERE for a new document. Pass the user's request as they wrote it (not a rewritten or " +
            "embellished version: extra adjectives only add noise). " + tool(examples, "build_kit").description,
    },
    dispatcher({
        name: "find", title: "Search examples, components, icons, capabilities", selector: "kind", fallback: "examples", annotations: RO,
        description:
            "Search the verified catalog. kind \"examples\" (default): rank examples for a query and/or " +
            "capability, use-case, component ids, each with why it matched and its snippets. kind " +
            "\"components\": library components for a query or capabilities. kind \"icons\": Material Symbols " +
            "icons (4,157) by name, tag or category, each with its {\"Icon\": ...} call. kind \"capabilities\": the " +
            "capability ids (optionally under a prefix) with example counts. kind \"terms\": how words " +
            "resolve to capabilities, use cases and components.",
        choices: {
            examples: tool(examples, "find_examples"),
            components: tool(examples, "find_components"),
            capabilities: tool(examples, "list_capabilities"),
            terms: tool(examples, "resolve_terms"),
            icons: tool(examples, "find_icons"),
        },
    }),
    {
        name: "get",
        annotations: { title: "Get an example or a component", ...RO },
        description:
            "Fetch one catalog entry: an example by id (\"TIM-10\"; or a generated document \"GEN-20\", parts meta, json, notes, render) with its JSON, meta, pitfalls and " +
            "renders (`parts` selects which), or a library component by name (\"Gauge\") with its call, " +
            "params and pitfalls (definition: true adds the full definition, to copy its structure).",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "Example id (e.g. \"EXP-06\") or component name (e.g. \"ProgressRing\")." },
                ...tool(examples, "get_example").inputSchema.properties,
                ...tool(examples, "get_component").inputSchema.properties,
                parts: { type: "array", items: { type: "string" }, description:
                    "For an example (default [\"meta\", \"json\"]): meta, json, expanded_json, snippets, render, rc_base64. " +
                    "For a component: demo_json, render (and definition: true for its full definition)." },
            },
        },
        handler: async ({ id, name, ...rest } = {}) => {
            const key = id ?? name;
            if (!key) throw new Error("get: give an example id or a component name");
            if (/^GEN-\d+$/i.test(key)) return getGenerated(key.toUpperCase(), rest);
            const out = await (/^[A-Z0-9]+-\d+/.test(key)
                ? tool(examples, "get_example").handler({ id: key, ...rest })
                : tool(examples, "get_component").handler({ name: key, ...rest }));
            // Compact JSON: documents are half the size without the indentation, which matters
            // in a model's context (and clients that re-fetch large results).
            return out.map((c) => {
                if (c.type !== "text") return c;
                try { return { ...c, text: JSON.stringify(JSON.parse(c.text)) }; } catch { return c; }
            });
        },
    },
    tool(examples, "check_component"),
    {
        name: "convert",
        annotations: { title: "Convert JSON to .rc (and check it)", ...RO },
        description:
            "Before writing a new document, call build_kit: it returns the components, layout patterns and " +
            "design rules for the goal (a UI is laid out with column/row/text and library components, not drawn " +
            "on one canvas). " +
            "Convert a RemoteCompose JSON document to a binary .rc (component calls expand " +
            "automatically). check: true also parses and runs the document like a player and reports " +
            "problems; it also renders it unless render: false and reports the render's findings and pixel " +
            "statistics, not the image (call render to see it). expanded: true returns the plain JSON that " +
            "component calls become instead of converting.",
        inputSchema: {
            type: "object",
            properties: {
                json_path: { type: "string", description: "Path to the JSON document (same as input_path)." },
                ...tool(json2rc, "json2rc").inputSchema.properties,
                ...tool(examples, "expand_components").inputSchema.properties,
                check: { type: "boolean", description: "Also validate the result (parse, data pass, findings)." },
                render: { type: "boolean", description: "With check: also render it (default true)." },
                expanded: { type: "boolean", description: "Return the expanded JSON instead of converting." },
            },
        },
        handler: async ({ check, expanded, render: doRender, json_path, ...args } = {}) => {
            // One name for a JSON file everywhere: json2rc calls it input_path, the others json_path.
            const file = json_path ?? args.input_path;
            if (expanded) {
                const json = args.json ?? (file ? JSON.parse(readFileSync(resolveIn(file), "utf8")) : undefined);
                return tool(examples, "expand_components").handler({ ...args, json });
            }
            const out = await tool(json2rc, "json2rc").handler({ ...args, ...(file ? { input_path: file } : {}) });
            if (!check) return out;   // json2rc already appends the design warnings
            const { input_path: _, output_path: __, include_base64: ___, ...vargs } = args;
            const v = await tool(render, "validate").handler({ ...vargs, ...(file ? { json_path: file } : {}), render: doRender ?? true });
            return [...out, ...v];
        },
    },
    (() => {
        // render, plus componentTheme: the same JSON expanded for another look (the components'
        // mono, light or dark implementation), set on the JSON before rendering it. By default
        // ("auto") light and dark, by the system theme; "all" carries mono too, switched at run time.
        const t = tool(render, "render_rc");
        return {
            ...t, name: "render",
            description: t.description + " The result ends with the document's design warnings, if any (a UI hand-drawn on a canvas, " +
                "glyph icons, hard-coded dates or colours): fix them. componentTheme (\"mono-dark\" or \"mono-light\") renders the monochrome look " +
                "of a JSON document (always-on displays, e-ink) without editing it: the same component calls, expanded with the components' mono " +
                "implementation. By default the document follows the system's light or dark theme, and a single render " +
                "is DARK unless theme: \"light\". Before publishing, " +
                "render with variants: true (every theme and size in one call) and, for a date-driven document, with " +
                "clocks: [\"2026-12-31T23:59:59\", ...] (several pinned dates in one call); for a host-data document, " +
                "samples: [{\"aqi\": 12}, {\"aqi\": 480}] (several sets of host variables in one call, each settled).",
            inputSchema: { ...t.inputSchema, properties: { ...t.inputSchema.properties,
                samples: { type: "array", items: { type: "object" }, description: "Several sets of host variables in one call ({name: value} each, up to 12), one captioned image each, every eased value settled: check a host-data document at its edges ([{\"level\": 0}, {\"level\": 100, \"charging\": 1}]). A sample may add \"$clock\": \"2026-06-21T12:00\" to pin its own time (a night, a noon and an evening scenario in one call). With output_path, files are <stem>-sample1.png, -sample2…" },
                clocks: { type: "array", items: { anyOf: [{ type: "string" }, { type: "number" }] }, description: "Several pinned clocks in one call (the same formats as clock; up to 12 per call), one captioned image each: check a date-driven document at its edges (\"2026-12-31T23:59:59\", \"2027-01-01T00:00:00\", a full-moon day) without a call per date. With output_path, files are <stem>-<clock>.png." },
                sizes: { type: "array", items: { type: "array", items: { type: "number" } }, description: "Extra [width, height] sizes to render (up to 10): with variants, added to them; alone, only these sizes (with samples or clocks: each at each size) (the target device's own screens, e.g. [[800, 480], [600, 600]] for a car display), each captioned with its size." },
                sheet: { type: "boolean", description: "With samples, clocks, sizes or variants: ONE contact-sheet image (every render in a captioned grid) instead of one image each; the findings are kept per render. Saves reading many images." },
                variants: { type: "boolean", description: "Check every state in one call: dark, light, mono-dark and mono-light, narrow, wide, short, small (narrow and short) and tiny (half the width), and (when the document reads the clock) seven hours later, each image captioned with its size. Each render's findings follow its image. With output_path, the files are <stem>-<variant>.png named after each caption (-dark, -light, -mono-dark, -mono-light, -narrow-259x640, -widget-4x2-320x160, -seven-hours-later, ...) or -45.png (seven hours or 45 days later, by whether the document reads the time of day). Use it before publishing." },
                componentTheme: { type: "string", enum: ["auto", "all", "light", "dark", "mono-dark", "mono-light"], description: "For JSON input: the look to expand the components for. auto (default): light and dark by the system theme; mono-dark (light on black) / mono-light (dark on white): the components' monochrome implementation; light / dark: that side only; all: every look in one larger document, mono switched by the host's theme.mono float." } } },
            handler: async ({ sheet, ...all } = {}) => {
                const r = await renderMany(all);
                return sheet ? toSheet(r, all) : r;
            } };
        // The render itself (samples, clocks, sizes, variants or one image).
        async function renderMany({ componentTheme, variants, clocks, samples, sizes, ...args } = {}) {
            // Samples and clocks together: each sample at each clock (a sample's own $clock wins),
            // rather than the clocks dropped without a word.
            if (Array.isArray(samples) && samples.length && Array.isArray(clocks) && clocks.length) {
                samples = samples.flatMap((smp) => smp && "$clock" in smp ? [smp] : clocks.map((c) => ({ ...(smp ?? {}), $clock: c })));
                clocks = undefined;
            }
            return variants || (Array.isArray(sizes) && sizes.length) ? renderVariants(t, withLook(args, componentTheme), sizes, !variants, samples, clocks)
                // (A mono look asked for with samples or clocks applies to every image: the JSON is expanded for it once.)
                : Array.isArray(samples) && samples.length ? renderSamples(t, withLook(args, componentTheme), samples)
                : Array.isArray(clocks) && clocks.length ? renderClocks(t, withLook(args, componentTheme), clocks) : withDesign(await (async () => {
                // One of width/height: the other from the document's own aspect ratio.
                if ((args.width === undefined) !== (args.height === undefined)) {
                    const h = jsonOf(args)?.header;
                    const r = h?.width && h?.height ? h.height / h.width : null;
                    if (!r) throw new Error("render: give both width and height (the document's header has no size to keep the ratio of)");
                    if (args.height === undefined) args = { ...args, height: Math.round(args.width * r) };
                    else args = { ...args, width: Math.round(args.height / r) };
                }
                if (!componentTheme) return t.handler(args);
                const json = args.json ?? (args.json_path ? JSON.parse(readFileSync(resolveIn(args.json_path), "utf8")) : null);
                if (!json) throw new Error("render: componentTheme needs a JSON document (json or json_path)");
                const { json_path: _, ...rest } = args;
                return t.handler({ ...rest, json: { ...(typeof json === "string" ? JSON.parse(json) : json), componentTheme } });
            })(), args, { first: true });
        }
    })(),
    tool(inspect, "audit"),
    dispatcher({
        name: "inspect", title: "Inspect a document", selector: "task", fallback: "summary", annotations: RO,
        description:
            "Answer a question about a document (.rc or JSON). task: summary (default; what it is, sizes, " +
            "top findings), layout (the laid-out component tree with bounds), structure, variables, " +
            "theme, accessibility, interactions (click and touch targets), interact (run actions: taps, " +
            "variable changes, then report), runtime (repaint and per-frame cost), bytes (what the size " +
            "is made of), operations (list, filterable), operation (one, by index) and engines (do the C++ " +
            "player render uses and the TypeScript one inspect uses lay it out alike? the components they disagree on).",
        choices: {
            summary: tool(inspect, "inspect_summary"),
            layout: tool(inspect, "inspect_layout"),
            structure: tool(inspect, "inspect_structure"),
            variables: tool(inspect, "inspect_variables"),
            theme: tool(inspect, "inspect_theme"),
            accessibility: tool(inspect, "inspect_accessibility"),
            interactions: tool(inspect, "list_interactions"),
            interact: tool(inspect, "interact"),
            runtime: tool(inspect, "inspect_runtime"),
            bytes: tool(inspect, "inspect_bytes"),
            operations: tool(inspect, "list_operations"),
            operation: tool(inspect, "get_operation"),
            engines: enginesTool,
        },
    }),
    (() => {
        const t = tool(deploy, "package_web");
        // The publishing rules (JSON only, playground only, the design gate) are package_web's own,
        // for this server and rc-deploy alike. Here: no controls option, warnings at the top.
        return { ...t, name: "publish",
            description: t.description + " A public page is always the playground, made from the JSON (given a .rc that " +
                "convert wrote, its JSON beside it), and is refused while the document has structural design problems " +
                "(the result lists the fixes).",
            inputSchema: { ...t.inputSchema, properties: {
                ...Object.fromEntries(Object.entries(t.inputSchema.properties).filter(([k]) => k !== "controls")),
                layout: { type: "string", enum: ["fill", "fixed"], description: "Leave it out: the page fills the window and the document relayouts to it (the viewer can still pick sizes). \"fixed\" only when the user asks for one fixed size." } } },
            handler: async ({ controls: _ignored, ...args } = {}) => {
                // The layout: the page fills the window unless the user asked for a fixed size.
                args = { layout: "fill", ...args };
                const out = await t.handler(args);
                const src = args.json || args.json_path ? args : (args.rc_path ? { json_path: args.rc_path.replace(/\.rc$/i, ".json") } : args);
                const small = await smallSizeNote(src);
                return withDesign(small ? [{ type: "text", text: small }, ...out] : out, src, { first: true });
            } };
    })(),
    dispatcher({
        name: "pages", title: "Published pages", selector: "action", fallback: "list",
        description: "The pages published with publish: action \"list\" (default) or \"unpublish\" (with page_id).",
        choices: { list: tool(deploy, "list_pages"), unpublish: tool(deploy, "unpublish_page") },
    }),
];

// reference: the workflow, the authoring guide, or any tool's full documentation.
const describeTool = (t) => [`## ${t.name}`, "", t.description, "", "```json", JSON.stringify(t.inputSchema, null, 1), "```",
    ...(t.examples?.length ? ["", "Example arguments:", "```json", JSON.stringify(t.examples[0], null, 1), "```"] : [])].join("\n");
tools.push({
    name: "reference",
    annotations: { title: "Workflow, guides and tool documentation", ...RO },
    description:
        "topic \"workflow\" (default): how to go from a request to a verified document. topic \"format\": the " +
        "JSON essentials and its traps (layout vs canvas, text anchoring, sizes, expressions). topic \"expressions\": every " +
        "function, operator and clock/system value an expression can use, with the limits. topic " +
        "\"components\": the component authoring guide (syntax, light/dark/mono, animation, drawing " +
        "something the library lacks). topic \"tools\": every tool's full schema and options, or one " +
        "with tool: <name>. query: a few words instead of a topic returns just the matching paragraphs from all of them " +
        "(\"step argument order\", \"visibility taps\"): use it to check one rule without rereading a topic.",
    inputSchema: {
        type: "object",
        properties: {
            topic: { type: "string", enum: ["workflow", "format", "components", "expressions", "tools"] },
            tool: { type: "string", description: "With topic \"tools\": one tool name." },
            query: { type: "string", description: "Words to look up across every topic (\"step argument order\", \"visibility invisible taps\", \"map region\"): the best-matching paragraphs, each with its topic, instead of a whole topic." },
        },
    },
    handler: async ({ topic = "workflow", tool: name, query } = {}) => {
        if (typeof query === "string" && query.trim()) return text(await searchReference(query));
        if (topic === "components") return tool(examples, "component_authoring_guide").handler({});
        if (topic === "format") return text(FORMAT);
        if (topic === "expressions") return text(EXPRESSIONS);
        if (topic === "tools") {
            const list = name ? tools.filter((t) => t.name === name) : tools;
            if (!list.length) throw new Error(`no tool '${name}'`);
            return text(list.map(describeTool).join("\n\n"));
        }
        return text(WORKFLOW + "\n\nTools: " + tools.map((t) => t.name).join(", "));
    },
});

tools.push({
    name: "map_info",
    annotations: { title: "What a map region holds", ...RO },
    description:
        "Before a map that colours, lists or labels places: a region's box, its height for width 1000 (the same as " +
        "$mapHeight), the countries in it (ISO A3 and name, alphabetical, the ones too small to show at the detail flagged), " +
        "the countries partly in it, those with state/province borders, its largest cities, and how coarse the outlines are " +
        "at that size. The countries list is the order to use for WorldMap's values/valueCountries when nothing else fixes one.",
    inputSchema: { type: "object", properties: {
        region: { description: "As WorldMap's region: \"world\", a continent, a subregion, a country (ISO or name) or [lonMin, latMin, lonMax, latMax]." },
        detail: { type: "string", enum: ["low", "medium", "high"], description: "The detail you will draw at (default low)." },
    }, required: ["region"] },
    handler: async ({ region, detail = "low" } = {}) => {
        const { mapInfo } = await import("./lib/maps.mjs");
        return text(JSON.stringify(mapInfo(region, { detail }), null, 1));
    },
});

/** A generated-corpus document: its prompt, run, JSON and (with parts render) its looks. */
async function getGenerated(id, { parts = ["meta", "json"] } = {}) {
    const { loadGenerated, EXAMPLES_DIR } = await import("./lib/catalog.mjs");
    const e = loadGenerated().find((x) => x.id === id);
    if (!e) throw new Error(`no generated example ${id} (GEN-01 .. GEN-50; find with include_generated lists them)`);
    const dir = path.join(EXAMPLES_DIR, e.folder);
    const out = [];
    if (parts.includes("meta")) out.push({ type: "text", text: JSON.stringify({ ...e, note: "Built by an assistant from the prompt with these tools in one eval run: a whole working document, not a minimal or Java-verified example. notes.md (parts: notes) is that run's account of what was hard." }) });
    if (parts.includes("json")) out.push({ type: "text", text: readFileSync(path.join(dir, "doc.json"), "utf8") });
    if (parts.includes("notes") && existsSync(path.join(dir, "notes.md"))) out.push({ type: "text", text: readFileSync(path.join(dir, "notes.md"), "utf8") });
    if (parts.includes("render")) for (const look of e.renders ?? []) {
        out.push({ type: "text", text: `render-${look}` }, { type: "image", data: readFileSync(path.join(dir, `render-${look}.png`)).toString("base64"), mimeType: "image/png" });
    }
    return out;
}

/** The reference's paragraphs that best match some words, across every topic. */
async function searchReference(query) {
    const guide = (await tool(examples, "component_authoring_guide").handler({})).map((c) => c.text ?? "").join("\n");
    const topics = { format: FORMAT, expressions: EXPRESSIONS, workflow: WORKFLOW, components: guide,
        tools: tools.map(describeTool).join("\n\n") };
    const stem = (w) => w.toLowerCase().replace(/(ies)$/, "y").replace(/(es|s)$/, "");
    const words = [...new Set(String(query).toLowerCase().split(/[^a-z0-9$@#.]+/).filter((w) => w.length > 1).map(stem))];
    const paras = [];
    for (const [t, body] of Object.entries(topics)) {
        // A paragraph: a "- " bullet with its continuation lines, or a block between blank lines.
        let cur = [];
        const flush = () => { if (cur.length) paras.push({ topic: t, text: cur.join("\n") }); cur = []; };
        for (const line of String(body).split("\n")) {
            if (!line.trim() || /^(- |#{1,4} |\d+\. )/.test(line)) flush();
            if (line.trim()) cur.push(line);
        }
        flush();
    }
    // Rare words count more (a paragraph about "step" beats one that merely uses "order").
    const tokd = paras.map((p) => p.text.toLowerCase().split(/[^a-z0-9$@#.]+/).map(stem));
    const has = (toks, w) => toks.includes(w) || (w.length > 3 && toks.some((t) => t.startsWith(w)));
    const idf = Object.fromEntries(words.map((w) => [w, Math.log((paras.length + 1) / (1 + tokd.filter((t) => has(t, w)).length))]));
    const scored = paras.map((p, i) => {
        const toks = tokd[i];
        const hits = words.filter((w) => has(toks, w));
        const tf = hits.reduce((n, w) => n + idf[w] * (1 + Math.log(1 + toks.filter((t) => t === w).length)), 0);
        // Prose topics first: a tool schema mentions every option name in passing.
        return { ...p, hits: hits.length, score: (tf / Math.sqrt(1 + toks.length / 60)) * (p.topic === "tools" ? 0.6 : 1) };
    });
    // Two of the words when any paragraph has them, else any one.
    const need = scored.some((p) => p.hits >= Math.min(words.length, 2)) ? Math.min(words.length, 2) : 1;
    const best = scored.filter((p) => p.hits >= need).sort((a, b) => b.score - a.score).slice(0, 5);
    if (!best.length) return `Nothing in the reference matches "${query}". Topics: format, expressions, components, workflow, tools.`;
    // (A tool schema paragraph can be long: the matching lines and a little around them.)
    // (A very long paragraph — a tool schema — is cut to a continuous window around its first
    // match: lines picked one by one read as garbled sentences.)
    const trim = (t) => {
        if (t.length < 3000) return t;
        const lines = t.split("\n");
        const at = Math.max(0, lines.findIndex((l) => words.some((w) => l.toLowerCase().includes(w))));
        return lines.slice(Math.max(0, at - 2), at + 22).join("\n") + "\n…";
    };
    return best.map((p) => `[${p.topic}]\n${trim(p.text)}`).join("\n\n");
}

export const definition = {
    name: "remotecompose",
    version: "1.0.0",
    instructions: WORKFLOW,
    tools,
    // The public pages of the servers it includes, under this server's own base URL.
    async publicRoute(req, url, res) {
        for (const d of [render, deploy, examples]) {
            if (d.publicRoute && (await d.publicRoute(req, url, res))) return true;
        }
        return false;
    },
};

if (isMain(import.meta.url)) serve(definition);
