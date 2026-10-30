# Writing a RemoteCompose component

A component is a named, parameterised piece of RemoteCompose JSON. You write it once and call
it by name from any document:

```json
{ "Gauge": { "value": "@cpu", "label": "CPU %" } }
```

Before conversion the call is replaced by plain JSON: either the body itself (*expanded*), or
a `definePattern` template plus a call of it (*pattern* mode, below). The players and the
Java parser only ever see that plain JSON. Every MCP tool compiles components itself: json2rc,
render_rc, validate, audit and package_web all accept documents that call them.

The library's 20 components (`examples/components/`) are worked examples of everything below.
Read a similar one first, with `get_component {"name": "Stepper", "definition": true}`.

## Where a component can live

**Inside one document.** Put the definition under a top-level `components` object, beside
`header`, `resources` and `root`:

```json
{
 "header": {"apiLevel": 7, "width": 240, "height": 80, "profiles": 513},
 "components": {
  "PriceTag": {
   "summary": "A price in a coloured pill",
   "params": {
    "price": {"type": "string", "required": true, "doc": "The amount, e.g. 9.99"},
    "color": {"type": "color", "default": "@colors.primary", "doc": "Pill colour"}
   },
   "body": {"text": {"value": "$ @price", "color": "@colors.onPrimary", "fontSize": 16,
            "modifiers": [{"clip": {"roundedRect": 12}}, {"background": "@color"}, {"padding": [12, 6]}]}},
   "call": {"PriceTag": {"price": "9.99"}}
  }
 },
 "root": {"type": "row", "modifiers": [{"spacedBy": 8}],
          "children": [{"PriceTag": {"price": "9.99"}}, {"PriceTag": {"price": "4.50", "color": "@colors.success"}}]}
}
```

A document definition wins over a library component with the same name. The `components`
key is removed when the document is expanded.

**In the library.** Add a folder `examples/components/<Name>/` holding:

| file | written by | what it is |
| :--- | :--- | :--- |
| `component.json` | you | the definition: the same object as above, plus `"component": "<Name>"`, `version`, `capabilities` (vocabulary ids) and `pitfalls` |
| `doc.json` | you | a small demo document that calls the component, showing its default and its main variants |
| `meta.json` | you | the demo's metadata, as for an example: `id` (= the name), `title`, `prompt`, `keywords`, `teaches`, `snippets`, `check`, `related`. Its summary, capabilities and pitfalls come from component.json |
| `doc.expanded.json`, `doc.rc`, `render.png`, `meta.derived` | the build | `node examples/tools/build.mjs <Name> --java` |

Also add the component to `docs/examples-vocabulary.json` → `components`, with the synonyms
people would use ("toggle" for Switch, "kpi" for StatTile), so searches find it.

## The definition

| key | what |
| :--- | :--- |
| `summary` | one sentence; search results show it |
| `params` | `{name: {type, default?, required?, static?, doc}}` (types below) |
| `slots` | `{name: {optional?, doc}}`: places where the caller passes JSON nodes. A slot called `content` also takes the call's `children` |
| `locals` | values private to each call: state, or an expression computed once (below) |
| `body` | the JSON the call expands to: one node, or an array of nodes (only where a list of children is expected) |
| `call` | a minimal call, used by get_component and check_component |
| `pitfalls` | traps for the people calling it |

Parameter types:

| type | the caller passes | in the body |
| :--- | :--- | :--- |
| `float` | a number, a `"@variable"` or an expression | spliced into expressions, parenthesised |
| `bool` | `true`/`false` (or 0/1, or a `"@variable"`) | as a number, or tested by `$if` |
| `color` | `"#AARRGGBB"`, `"@colors.name"` or a colour variable | wherever a colour goes |
| `string` | text, or a `"@textVariable"` as the whole value | spliced as written: `"Decrease @label"` |
| `text` | a text id or a text variable | a whole value |
| `enum` | one of `values` | compile-time choice with `$if: "style == 'outlined'"` |
| `action` | an action object or an array of them | `"onClick": "@onClick"` |
| `variable` | a `"@variable"` the component reads and writes (a switch's state) | `"@checked"`. If the caller binds nothing, or gives a number, the call gets its own variable, starting at that number or at `initial` |
| `list` | a JSON array, known when the document is expanded | `$each` and `$count` |

Mark a param `static: true` when it chooses structure, not a value (a style, a size used in
arithmetic). Static values fold to literals, which is smaller than an expression.

## Body syntax

- `"@param"`: the argument, whatever its JSON type, when it is the whole string.
- `"... @param ..."`: inside an expression or text. A number or a variable is spliced in. An
  expression is spliced in parentheses. A `string` is spliced as written.
- `"@colors.primary"`: a theme colour. It is added to `resources.colors` unless the
  document defines it, so a document re-themes every component by defining the same name.
  It is a themed colour (a light and a dark value); see "Light, dark and monochrome".
- `"@theme.radius_md"`: a theme number, substituted as a literal. Static arithmetic on it
  folds: `"@theme.space_2 * 2"` becomes `16`.
- `{"$slot": "icon"}`: the caller's slot content, dropped when it isn't given.
- `{"$if": "style == 'filled'", "then": X, "else": Y}`: a choice made when the document is
  expanded. It also takes `a != 'x'`, `a` and `!a`. On a slot, or a param bound to a
  variable, `a` tests whether it was given. `theme.mono` and `!theme.mono` test the theme
  (any theme number works: 0 is false). Use it for the monochrome variant.
- `{"$each": "labels", "as": "label", "index": "i", "count": "n", "do": X}`: X once per
  item of a list param (or `count` times for a number).
- `{"$count": "labels"}`: the number of items, as a literal.
- `{"$name": "value"}`: the bare name (`vol` for `"@vol"`) of the variable a `variable` param
  or a state local is bound to, for an op that declares a name. Slider names its
  `touchExpression` after its `value`, so from the slider on the caller's variable is the
  touch value. It keeps the call out of pattern mode.
- An optional param with no default, used as a whole value (`"onClick": "@onClick"`), drops
  its key when the caller leaves it out.

Locals:

```json
"locals": {
 "taps": 0,
 "frac": "@value / @max",
 "sweep": "clamp(0, 240, @frac * 240)"
}
```

- **A number** (`"taps": 0`) is per-call state: a variable of the call's own.
- **An expression** is computed once per call and shared by every use. It becomes a literal
  if it folds, an alias if it is a single variable, and otherwise one expression in
  `resources.variables`. Computing a value once like this is the biggest size saving
  available to a component. Gauge reads `@frac` in three places for the cost of one
  expression.
- **An animated local** (`"p": {"value": "@checked", "anim": 0.3}`) eases to its expression
  whenever that changes (standard cubic curve, `anim` seconds), at paint time. It is written
  as a tree `variable` at the head of the body (first in a canvas's `commands`, else first
  among the top container's children), so read it only inside the body, not in the top
  node's own modifiers. It keeps a call out of pattern mode (except in mono, where it is the
  plain value). See "Animating state".

## Light, dark and monochrome

Every component comes in four looks, from one definition:

| Mode | How it is chosen | What it writes |
|---|---|---|
| light and dark | default (`"componentTheme": "auto"`) | each theme colour as a themed colour, `{"light": .., "dark": ..}` in `resources.colors`. The player picks the side from the system theme while it plays (`rc2image --theme`, render_rc `theme`, the playground's Light / Dark segments) |
| light only, dark only | `"componentTheme": "light"` or `"dark"` | plain colours from that side, with no theme ops. `"dark"` writes the library's look from before themed colours, byte for byte |
| mono | `"componentTheme": "mono"` | light on black, for always-on displays and OLED: the theme's `modes.mono` palette (black, white and one grey `#9E9E9E`), `@theme.mono` = 1, and no animation |
| mono inverted | `"componentTheme": "mono-inverted"` | dark on white, for e-ink and other reflective displays: `modes.mono-inverted` (white, black and one grey `#616161`), the same mono variants (`@theme.mono` = 1), no animation |

`componentTheme` is a top-level key of the document, next to `componentMode`. The expansion
removes it, and `expand_components` takes it as `theme`. Light and dark are native to the
format. The Java parser writes `{light, dark}` with `addThemedColor`: two colour constants,
then a colour that a `THEME` section sets to one of them. That costs about 100 B per theme
colour used, compared with a plain colour. A colour whose light and dark values are equal
(`onPrimary`) stays plain.

The format has no monochrome mode. The header profile `PROFILE_LOW_POWER` (0x8) is declared
in RcProfiles, but nothing in the Java core, the creation API or the players reads it, so
setting it changes nothing. Mono is therefore chosen when the document is built, and a host
that wants both looks serves two documents. One document holding both looks, switched at run
time by a host variable on `visibility`, works too, but it is about 75% bigger (see
docs/EXAMPLES_FINDINGS.md).

A document re-themes as before, by defining a colour of the same name:
- a plain value is used in both light and dark;
- `{"light": .., "dark": ..}` is a themed colour of its own;
- either form can also carry a `mono` value: `{"light": .., "dark": .., "mono": ..}` or
  `{"value": .., "mono": ..}`. In mono, a colour that has a theme name and no `mono` value
  takes the mono palette's value, because brand colours don't survive on a 1-bit display.
  Colours the theme doesn't name are kept (a themed one takes its dark side).
- the same with a `mono-inverted` value for mono inverted (a themed colour the theme doesn't
  name takes its light side there).

### Writing the mono variant

Mono is for always-on displays (AOD) and OLED, light on black. A watch's always-on button has
a white outline and white text on black; the same widget on e-ink is the reverse, black on
white. That is mono inverted, and it needs nothing from a component: it is the same variant
with the palette swapped (`modes.mono-inverted`: background and surface white, onSurface and
primary black, onPrimary white, the grey darker so muted text stays readable on white, 6.2:1).
Write the variant against the theme colours, never a literal black or white, and both work.
On e-ink the AOD rule "few lit pixels" reads "little ink": the outlined surfaces become
black rings on white, and a small filled face (a selected Chip, a filled Button, a progress
fill) is a black one with white text. Choose with `{"$if": "theme.mono", "then":
MONO, "else": NORMAL}`, at the smallest node that differs: one paint op, one modifier, one
stroke width. Keep the params the same in both modes. The rules:

- **Show state by shape, not colour.** In mono, primary, success, warning and error are all
  white. Show state as outlined or filled (Chip, Badge), a tick (Checkbox), a thumb's side
  and fill (Switch: a hollow grey thumb on the left, a filled white one on the right), a
  chevron's direction (StatTile), or a tick mark on the track (Gauge's warnAt and alertAt).
- **Few lit pixels.** Draw large surfaces as a 1 dp `outline` ring on black instead of a fill
  (Card, StatTile, Avatar, Stepper's buttons, the clock face, a rule under TopBar). Draw a ring
  as a background, `padding 1`, a clip one dp smaller, and the inner background, because
  `border` can't take a theme colour. Small filled faces are fine: a Badge, a selected Chip,
  a filled Button, a progress fill.
- **Thin strokes, but not hairlines:** tracks at 1.5 dp, outlines at `@theme.stroke` (2), and
  arcs at about half their normal thickness.
- **No gradients or alpha washes.** Use only the three colours. Paint alpha that switches a
  state (0 or 1) is fine.
- **No motion.** E-ink should not repaint continuously. The expansion removes every `anim` of
  an animated value and every `animationSpec` modifier, both the document's and the
  components'. The result reports how many as `motion_removed`. Drop anything that ticks
  faster than once a minute: AnalogClock and DigitalClock draw no seconds in mono, and the
  minute hand steps once a minute.
- **Contrast:** onSurface is white on black. Muted, outline, track and disabled are all the
  one grey (7.8:1 on black). Text on a filled face is `onPrimary`, which is black in mono. In mono
  inverted it is all reversed: black on white, the grey `#616161` (6.2:1 on white), and
  `onPrimary` white on a black face.

The light palette was chosen for contrast on its own background: onSurface is 16:1, muted
5.6:1, outline 3:1 (so a checkbox's edge is visible), track 2:1 (a white thumb on it is
visible), and white text on primary, success and error is 5:1 or more. Build a new component's
demo with `"renders"` in `meta.check` (light, dark, mono and mono-inverted, as the library
does: `{"name": "mono-inverted", "componentTheme": "mono-inverted"}`) and look at all four.

## How a component reaches the wire: expand vs pattern

A document chooses with a top-level `"componentMode"`: `"auto"` (the default), `"expand"` or
`"pattern"`. One call can override it with `"componentMode"` among its arguments.

- **expand**: the call is replaced by its body, with everything substituted. Each instance is
  written out in full, so a body of 170 B costs 170 B per call. Nothing at run time knows a
  component was there. Every player handles it.
- **pattern**: the component becomes a `definePattern` template, written once, and each call a
  pattern call (`MACRO_CALL`) of a few bytes plus its arguments; the player inflates it. STR-07
  measured about 48 B per extra row as a template against 171 B expanded, with a break-even
  around two calls (the template itself costs about one instance).
- **auto**: a variant used twice or more becomes a pattern only when the whole document,
  converted both ways, is smaller. It is measured, not estimated. The build's
  `meta.derived.component_modes` and `component_patterns`, and `expand_components`' `report`,
  say which way each component went and why.

What becomes what in a template:

| in the component | in pattern mode |
| :--- | :--- |
| `float` / `color` / `string` / `text` param given a value | a pattern parameter, passed as an argument (resolveTextId): a number, `"@colors.x"` or `"#..."`, the text or text object. A whole number goes through a float variable (`"_n2": 2` in resources.variables), because the parsers read an integer argument as an id |
| `variable` param bound to `"@wifi"` | a parameter, passed `"@wifi"`: every inflation reads and writes the caller's variable |
| `variable` param not bound, a number local | a pattern local (`locals` + a `variable` at the head of the template): each inflation gets its own |
| computed local | inlined at each use (it reads parameters, which resources cannot see); a literal when it folds |
| `enum`, `static`, `bool`, `list` params, `$if`, `$each`, `$count`, `@theme.*` | resolved per call and written into the template. Each combination used is a template of its own, named after it: `Button__outlined_icon`. Calls whose templates come out identical share one |
| `action` param | written in (an action is not an id) |
| `@colors.x` in the body | stays a colour resource reference |
| `{"$slot": "x"}` | `patternArgument`; the call passes its content in a `patternBlock` |

What writes a value in, or forces expand mode (the trap names are `PATTERN_TRAPS` in
components.mjs, and each is reported):

| trap | why | effect |
| :--- | :--- | :--- |
| `text` | U7: a text component inside a template shares its component id across inflations and with every text of the same string anywhere in the document: labels vanish, overlap or clip to another call's width (Java, C++ and TS) | the call expands. Every component with a label (Button, Chip, Card, ListItem, ...) is expanded today |
| `canvas` | canvas commands inside a template don't see parameters, locals or float expressions (T22, C35) | a parameter used there is written in; a local or an expression (`componentWidth()`, `16 + @checked * 20`) expands the call |
| `graphicsLayer` | a parameter or local there draws nothing in the C++ player (C35) | parameter written in; local: expand |
| `color` | only `background` resolves a colour parameter; text and paint colours write its id as a literal (U22) | parameter written in |
| limits of the compiler | a slot outside a `children` list, a body that calls another component, an animated local | expand |

So today pattern mode pays off for repeated label-free, canvas-free (or static-canvas) pieces:
dividers, swatches, frames with slots, gauges or rings drawn with the same static values. As
the players fix the traps, take the trap out of the list (`traps` option) and the same library
compiles to more templates; the CMP galleries are the check, in both modes.

Writing for pattern mode: give a value a `background` rather than a paint colour when it
should be an argument, keep per-call state out of canvas expressions, and don't put text in a
component you expect to repeat many times until U7 is fixed.

## Animating state

A tap that flips a state should move, not jump: Switch, Checkbox, Chip, Tabs, PagerDots and
the progress components all animate their state by default. What works, checked frame by
frame in Java (androidx remote-core), C++ and TypeScript:

- **Paint time is the default.** An animated value `{"value": "<expr>", "anim": s}` is a float
  expression that eases from its old result to the new one, re-evaluated every frame while it
  runs. Use it anywhere a float is drawn: paint `alpha`, draw coordinates, `graphicsLayer`
  `alpha` / `translationX` / `scaleX`. Nothing is re-measured. To read one eased value in
  several places, make it an animated local (`locals`, above) and derive the rest from it.
- **Only the standard cubic easing.** JSON gives `anim` a duration, nothing else. A spring or
  overshoot is an expression over the eased progress: Switch's thumb is
  `16 + 20 * (p + 0.5 * sin(3.14159 * p) * (2 * @checked - 1))`, about 10% past the end and
  back. The sine term flips with the target, so a tap mid-travel jumps a little.
- **Layout motion** (`animationSpec` on the component that moves, with a layout input that
  changes) works only through an **exact** `width` / `height` bound to a variable: Java
  resolves a variable there and re-measures. A fill fraction (`fillMaxWidth: "@go"`) or a
  weight bound to a variable is **not** resolved in Java (always a full fill, U26). For a
  fraction of the parent, use `{"width": "@go * (componentWidth() - padding)"}`: in a
  modifier, componentWidth() is the parent's full width.
- **No overshooting easing on layout motion.** Java ends a bounds animation at the first frame
  its progress reaches 1 and leaves the component there (U28): OVERSHOOT stops past the
  target. Use paint time for springs.
- **Tree positions matter less than you think.** An animated expression inside the layout
  tree (a component's content, a canvas) is applied when its component paints and keeps
  itself running, so it is fine anywhere below its first use.
- **Mono has no motion.** The mono expansion strips `anim` (a `{value}` left alone becomes the
  plain value) and animated locals read the value itself, so states snap. Write mono-only
  branches of an expression with `{"$if": "theme.mono"}` in the local (Switch's thumb).

Press feedback needs nothing from the component: **every `onClick` ripples** in Java (when
animations are on, the default), and the C++ and TS players now draw the same ripple (U29):
a white translucent circle from the touch point, clipped to the component, painted where the
`onClick` sits in the modifier list (after a `background` and `clip`, it is inside the
rounded face). The `ripple` modifier draws it on touch down instead; don't add it next to an
`onClick`, or Java draws two. The ripple is faint on white surfaces; that is the reference's
look.

## Rules that keep components small and portable

In expand mode every call is written in full, so every byte in the body is paid once per
instance. `check_component` reports `bytes` and `bytes_per_extra_instance` for both modes;
watch them.

1. Compute shared values once in `locals`; don't repeat an expression.
2. Prefer modifiers (`background`, `clip`, `padding`) to a canvas with drawRect.
3. Drop keys equal to their default, and wrapper boxes that only hold one child.
4. Let static params fold: `static: true`, and arithmetic on literals only.
5. Use theme colours and numbers, never hard-coded colours, so documents can re-theme and
   light, dark and mono all work. A literal `#FFFFFFFF` tick is invisible on a mono face;
   use `@colors.onPrimary`.
6. Don't create a variable per instance unless the call really owns state.

Traps the library hit (the linter catches the first four):

- `clamp(min, max, value)`: the value goes **last**.
- `border` can't take a theme colour; the Java parser reads its colour as a literal. Draw an
  outline as a background inside a slightly larger background.
- An SVG path string in `drawPath` costs about 4 KB in Java, because it is padded to 1024
  floats. Use primitives, `drawLine`, or the op-list path form.
- `animationTime()` alone never schedules a repaint; use `continuousSec()` for motion.
- Weights ignore `spacedBy`: in a weighted row, use spacer boxes between the children.
- `border` rounds only with `"shape": 2`; a `cornerRadius` alone draws a square border.
- There are no colour expressions. To show a state colour, overlay two copies and fade one
  with paint alpha, or with `graphicsLayer {alpha: expr}` (see Switch, Chip, Tabs).
- `textFromFloat`'s `whole` is the number of digits kept: `whole: 1` prints 10 as "0".
- Paint state can carry from one canvas to the next. The TS player keeps the last paint
  `alpha`, so a canvas that starts without one inherits a 0 and draws nothing; C++ resets it.
  Start each branch that later fades with `{"alpha": 1}` in its first paint (Switch and
  Checkbox mono).

## Workflow

1. `find_components` to check it doesn't exist yet. Then `get_component` with
   `definition: true` on the closest one, to copy its structure.
2. Write the definition.
3. Run `check_component {"definition": ..., "variables": {...}}`. It lints, expands the call,
   converts, renders it in light, dark and mono, and measures the cost per instance in both
   modes (and why a call can't be a pattern) and the bytes per theme. Iterate until there are no errors
   or warnings and the render looks right.
4. Use it inline under `components` in your document. Or, to add it to the library, add
   the folder and run `node examples/tools/build.mjs <Name> --java`, which requires bytes
   identical to the Java parser's output, and add it to a CMP gallery.
