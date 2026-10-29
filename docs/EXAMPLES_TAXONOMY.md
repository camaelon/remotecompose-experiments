# RemoteCompose example catalog

A plan for a **new, intentional catalog** of RemoteCompose examples, and for the MCP tool
that serves it. Every example is generated (or regenerated) for the catalog. So from the
start each one comes with a rich, consistent description: what it shows, the capabilities
it demonstrates, what it teaches, which fragment of its JSON demonstrates each thing, and
verified facts about how it renders and behaves.

The point is **retrieval**. Given a topic, keywords or a list of capabilities ("a 4×2
weather widget with an hourly forecast and tap to refresh"), the `rc-examples` MCP tool
returns the few examples that together show how to build it, simplest first. Each comes with
the snippet that matters, so a model can write a new document from scratch instead of
guessing at the format.

The document has four parts:
1. **The catalog's design:** the [capability vocabulary](#capability-vocabulary), the
   [metadata](#metadata) every example carries, and the
   [generation pipeline](#generation-pipeline).
2. **[The retrieval tool](#the-retrieval-tool-rc-examples).**
3. **[Component templates](#component-templates):** a library of reusable components
   (buttons, cards, gauges, charts…) that examples and new documents invoke by name.
4. **[What already exists](#what-already-exists):** prior corpora, used for reference and to
   see where examples are missing.
5. **The sample plan:** 163 entries in capability families, from one feature (level 1) to
   complete showcases (level 5), plus component galleries and diagnostic fixtures. This is the catalog's seed list;
   each entry becomes one example.

## Capability vocabulary

Tags are useful for retrieval only if they're consistent, so capabilities come from a
**controlled vocabulary**: dotted ids in a shallow tree. The source of truth is
[`examples-vocabulary.json`](examples-vocabulary.json):
- 85 capabilities with 723 synonyms;
- 20 use cases and 7 form factors, each with its own synonyms;
- the family-to-capability map.

The table below shows the main keywords; the JSON has the full synonym lists, which cover
plurals, other platforms' terms ("vstack", "recycler", "seekbar", "material you") and
everyday words.

Each node carries:
- **synonyms**: the words a user would actually type, which are the retrieval side;
- **evidence**: the JSON keys or operations that prove a document uses it, which are the
  honesty side.

The pipeline **rejects a capability claim with no evidence in the document**, and suggests
claims for evidence it finds. Tags therefore can't drift from what the example does.

| capability | keywords (what users say) | evidence (must appear) |
| :--- | :--- | :--- |
| `doc.header` | size, metadata, description | `header` |
| `doc.fps` | frame rate, battery, smooth | `header.desiredFPS`, `wakeIn` |
| `doc.density` | dp, density, scale, sharp | `densityBehavior`, `density()` |
| `layout.stack` | vertical, horizontal, overlay, stack | `column`, `row`, `box` |
| `layout.align` | center, align, justify, space between | `horizontalAlignment`, `verticalAlignment`, `*Arrangement`, `spacedBy`, `contentAlignment` |
| `layout.size` | fill, match parent, wrap, min, max | `width`, `height`, `size`, `fillMax*`, `widthIn`, `heightIn` |
| `layout.weight` | proportional, flex, ratio, split | `weight`, `horizontalWeight`, `verticalWeight` |
| `layout.spacing` | margin, padding, gap, spacer | `padding`, `spacer`, `offset` |
| `layout.decoration` | card, rounded corners, outline, background | `background`, `border`, `clip` |
| `layout.flow` | wrap, chips, tags | `flow` |
| `layout.responsive` | adaptive, breakpoints, resize, collapse | `fitBox`, `collapsibleRow`, `collapsibleColumn`, `componentWidth()` in a condition |
| `layout.scroll` | list, carousel, scrolling | `verticalScroll`, `horizontalScroll` |
| `layout.state` | expand, collapse, show/hide, switch layout | `stateLayout`, `visibility` |
| `layout.zorder` | on top, overlap, layer | `zIndex` |
| `text.basic` | label, text, heading | `text`, `drawTextAnchored` |
| `text.style` | bold, italic, font weight, letter spacing | `fontWeight`, `fontStyle`, `letterSpacing`, `lineHeight*` |
| `text.overflow` | ellipsis, truncate, max lines | `maxLines`, `ellipsis` |
| `text.autosize` | fit text, shrink to fit | `minFontSize`, `maxFontSize` |
| `text.path` | curved text, text on circle | `drawTextOnPath`, `drawTextOnCircle` |
| `text.dynamic` | number format, counter, value label, concatenate | `textFromFloat`, `textMerge`, `textLookup` |
| `text.measure` | text width, badge, fit background | `textMeasure`, `textLength` |
| `text.marquee` | scrolling text, ticker | `marquee` |
| `text.font` | custom font, typeface, variable font | `addFont`, `fontData`, `fontAxis` |
| `draw.shapes` | rectangle, circle, line, oval | `drawRect`, `drawRoundRect`, `drawCircle`, `drawOval`, `drawLine` |
| `draw.arc` | pie, donut, ring, gauge, progress ring | `drawArc`, `drawSector` |
| `draw.stroke` | outline, line cap, dashed | `strokeWidth`, `strokeCap`, `strokeJoin`, `pathEffect` |
| `draw.path` | icon, svg, shape, polygon | `drawPath`, `pathCreate`, `pathAppend*` |
| `draw.plot` | graph, curve, function, waveform | `pathExpression`, `polarPathExpression` |
| `draw.morph` | morph, tween, shape animation | `pathTween`, `drawTweenPath` |
| `draw.path-ops` | union, intersect, combine shapes | `pathCombine` |
| `draw.transform` | rotate, scale, translate, matrix | `save`, `rotate`, `scale`, `translate`, `matrix*` |
| `draw.clip` | mask, clip | `clipRect`, `clipPath` |
| `draw.gradient` | gradient, fade | `linearGradient`, `radialGradient`, `sweepGradient` |
| `draw.shader` | shader, agsl, glsl, effect, plasma | `shader` with AGSL |
| `draw.mesh` | mesh, warp | `drawMesh2D` |
| `image.bitmap` | image, picture, icon, photo | `drawBitmap`, `drawScaledBitmap`, `resources.bitmaps` |
| `image.offscreen` | cache, render to texture | `createOffscreenBitmap`, `drawOnBitmap` |
| `image.bitmap-font` | pixel font, sprite text | `drawBitmapFontTextRun` |
| `data.tokens` | constants, design tokens, theme values | `resources.variables`, `resources.colors` |
| `data.expression` | formula, computed, math | expressions (any non-literal value) |
| `data.condition` | if, conditional, threshold, warning | `conditionalOperations`, `ifElse` |
| `data.loop` | repeat, grid, for each | `loop` |
| `data.array` | list of values, data, series | `floatArrays`, `arrayGet`, `addDataList` |
| `data.spline` | smooth curve, interpolate | `spline`, `splineLoop` |
| `data.random` | random, noise, scatter | `rand` |
| `data.measure` | component size, responsive drawing | `componentWidth()`, `componentHeight()` |
| `data.function` | reusable function, easing function | `createFloatFunction` |
| `data.integer` | integer, counter, bit flags | `resources.integers`, integer expressions |
| `time.clock` | clock, time, watch, hour, minute | `timeInHr`, `timeInMin`, `timeInSec`, `continuousSec` |
| `time.date` | date, calendar, weekday, month | `weekDay`, `dayOfMonth`, `calendarMonth`, `year` |
| `time.animation` | animate, pulse, spin, loop animation | `animationTime()` |
| `time.easing` | easing, transition, spring, overshoot | `animationSpec` |
| `time.impulse` | bounce, one-shot, kick | `impulse`, `impulseProcess` |
| `time.transition` | fade in, appear, enter animation | `defineVisibilityAnimation` |
| `input.tap` | button, click, tap, counter | `onClick`, click actions |
| `input.toggle` | switch, checkbox, on/off | click action changing a variable that drives the drawing |
| `input.gesture` | double tap, long press | `multiClick` |
| `input.drag` | slider, knob, drag, seek bar | `touchExpression` |
| `input.fling` | fling, spin, momentum, inertia | `touchExpression` with velocity / `stopMode` |
| `input.pager` | swipe, pages, carousel, snap | `touchExpression` with snapping |
| `input.press` | pressed state, highlight | `onTouchDown`, `onTouchUp`, `ripple` |
| `input.host` | share, open, send to app, haptic, sound | `hostAction`, `hostNamedAction`, `performHaptic`, `playSound`, `clickArea` |
| `host.variables` | parameterised, template, dynamic content | `resources.variables` with `export` |
| `host.data` | live data, feed, data from app | exported arrays, `dataMapLookup` |
| `host.system` | battery, sensor, accelerometer, light | system variables (battery, `acceleration*`, `lightLevel`) |
| `host.theme` | dynamic colour, material you, palette | `color.system_*` named colours |
| `host.font-scale` | font size, accessibility size | `system.font_size`, `fontSize()` |
| `host.custom` | native view, embed, map, video | `custom` |
| `a11y.labels` | accessibility, screen reader, talkback | `semantics`, `contentDescription` |
| `a11y.state` | announce state | `stateDescription` |
| `fx.particles` | confetti, snow, sparks, particles | `createParticles`, `particlesLoop` |
| `fx.physics` | bounce, collide, gravity | `particlesComparison`, `impulse` with velocity |
| `3d.scene` | 3d, camera, light | `camera3D`, `lights3D` |
| `3d.mesh` | cube, sphere, model, primitive | `meshPrimitive3D`, `defineMesh3D`, `drawMesh3D` |
| `3d.surface` | 3d plot, surface, terrain | `meshExpression3D` |
| `3d.texture` | texture, globe, material | `texture3D`, `material3D` |
| `reuse.global` | shared definitions | `global` |
| `reuse.pattern` | template, repeat a component, list item | `definePattern`, `patternForEach` |
| `reuse.macro` | macro, include, component library | `include`, `includeMacro`, `referencedOperations` |
| `theme.mode` | dark mode, light mode | theme sections / themed colours |

**Use cases** are a second, orthogonal axis: what the example *is*, whatever technique it
uses. `card`, `widget`, `watch-face`, `chart`, `gauge`, `dashboard`, `list`, `control`
(button, switch, slider), `game`, `onboarding`, `iot-panel`, `media-player`, `calendar`,
`weather`, `fitness`, `finance`, `transit`, `loading-state`, `generative-art`.

**Form factor** is a third axis: `phone` (360×780), `tablet`, `widget-4x2` (360×180),
`widget-2x2`, `widget-4x1`, `watch-round` (227×227), `square` (300×300).

The vocabulary is versioned. A new capability is added with its keywords and evidence
before any example claims it, never by an example inventing a tag.

## Metadata

Every example is a folder, `examples/<id>-<name>/`, holding the files below. Fields are of
two kinds:
- **Authored** fields are written by the generator and reviewed. They cover what can't be
  computed: intent, explanation, the words people use.
- **Derived** fields are computed by the pipeline from the compiled document, so they can't
  drift from what it actually does.

| file | content |
| :--- | :--- |
| `doc.json` | the document |
| `doc.rc` | compiled by json2rc (or the Java parser, recorded in `derived.converter`) |
| `meta.json` | the fields below |
| `render.png` | the C++ render at the example's canonical inputs (its `check`) |

```jsonc
{
  // ── authored ──
  "id": "INT-04", "name": "drag-slider", "version": 1,
  "title": "Draggable value slider",
  "summary": "A 0–100 slider dragged by its thumb, with the value shown live.",   // one sentence: what it shows
  "prompt": "A horizontal slider (0–100) dragged by its thumb, showing the value.",   // what it was generated from
  "level": 3,
  "capabilities": { "primary": ["input.drag"], "secondary": ["text.dynamic", "draw.shapes", "data.expression"] },
  "use_cases": ["control"],
  "form_factor": "square",
  "keywords": ["slider", "seek bar", "volume", "range input"],   // extra user words, beyond the vocabulary's
  "teaches": [   // 2–4 "how to" lines: the retrieval text that matters most
    "Map a horizontal drag to a clamped 0–100 value with touchExpression min/max",
    "Position a thumb from a touch-driven variable",
    "Show a live number with textFromFloat"
  ],
  "pitfalls": [  // optional: traps verified against the reference, which retrieval returns too
    "touchExpression takes `expression` as an array (one infix string is fine) and an integer `touchMode`; an infix string or a named `stopMode` is an rcj extension the Java parser drops"
  ],
  "snippets": [   // anchors into doc.json: the fragments a builder should copy
    { "pointer": "/root/canvas/commands/2", "shows": "input.drag",
      "note": "touchExpression: value = touchX() mapped to 0..100, touchMode 0 (gently)" },
    { "pointer": "/root/canvas/commands/5", "shows": "text.dynamic",
      "note": "textFromFloat(@value, 3 whole digits, 0 decimals)" }
  ],
  "inputs": {
    "variables": {},   // host variables: name -> {type, meaning, default, min, max, step}
                       // every exported number needs min/max: the playground's slider covers it and
                       // clamps typed values, and an agent setting the variable knows what makes sense
    "clock": null, "touch": true
  },
  "check": {
    "describe": "Dragging from x=50 to x=250 raises the value.",
    "interact": [{ "drag": [50, 50, 250, 50] }, { "wait": 0.5 }],
    "expect": { "changed_variables": "includes the slider value" }
  },
  "prerequisites": ["DRW-01", "TXT-08"],   // simpler examples to read first
  "related": ["INT-05", "SHW-05"],

  // ── derived (pipeline, never edited by hand) ──
  "derived": {
    "converter": "json2rc", "json2rc_compatible": true,
    "json_keys": ["root", "canvas", "touchExpression", "textFromFloat", "…"],   // every key in doc.json
    "operations": { "TouchExpression": 1, "DrawCircle": 1, "…": 0 },   // rc-inspect list_operations histogram
    "evidence": { "input.drag": ["touchExpression"], "text.dynamic": ["textFromFloat"] },   // what justified each capability
    "header": { "width": 300, "height": 100 }, "bytes": 612, "op_count": 48,
    "host_variables": [],   // validate namedVariables
    "interaction_targets": { "click": 0, "touch": 1, "area": 0 },
    "repaint": "idle",   // rc-inspect repaint verdict
    "audit": { "error": 0, "warning": 0, "info": 1 },
    "engines": { "cpp": "ok", "ts": "ok", "agree": true },
    "check_passed": true,
    "generated": { "by": "<model or person>", "at": "2026-11-02", "from_prompt": true }
  }
}
```

Rules the pipeline enforces:
- **Evidence:** every primary and secondary capability must have evidence in `derived.json_keys`
  or `derived.operations`. A capability whose evidence is present but not claimed is flagged
  for review.
- **Snippets:** every snippet `pointer` must resolve in `doc.json`, and every primary
  capability needs at least one snippet. Retrieval returns snippets, not whole documents,
  whenever a whole document isn't needed.
- **Teaches:** at least two lines, each starting with a verb ("Map …", "Position …").
  They're the text that searches match best.
- **Related ids:** `prerequisites` and `related` must name existing examples.
  `prerequisites` must be of a lower or equal level.

## Generation pipeline

For each entry of the sample plan:

1. **Generate** `doc.json` from the entry's prompt. Give the generator the schema, the
   capability rows for the entry's planned capabilities, and the snippets of 1–3 catalog
   examples that already demonstrate those capabilities. The catalog bootstraps itself:
   later examples are built from the snippets of earlier ones.
2. **Convert and validate** with `rc-render.validate`. Fix every conversion error and every
   `error` finding.
3. **Render** with `rc-render.render_rc` at the check's inputs, and confirm the picture
   matches `check.describe`. Store it as `render.png`.
4. **Run the check.** For interactive examples run `rc-inspect.interact` with `check.interact`;
   for time-based ones render at the pinned `clock`. Record `derived.check_passed`.
5. **Audit** with `rc-inspect.audit`: no warnings, except in diagnostic fixtures, which must
   produce their target finding and nothing else.
6. **Compare engines:** package with `rc-deploy.package_web`, and compare the TS player with
   the C++ render. Record `derived.engines`.
7. **Derive** the `derived` block, check evidence and snippets, and write `meta.json`.
8. **Review** the authored fields, by a human or a second model pass: is the summary accurate,
   do the teaches lines teach, do the snippets point at the right fragment?

An example enters the catalog only when steps 2–7 pass. A failed check is a finding about
the document, the converter or an engine, and is worth keeping as an issue.

## The retrieval tool: rc-examples

`mcp/examples-server.mjs` serves the catalog. It is read-only, has no dependencies, and loads
an index the pipeline builds from every `meta.json`.

| tool | arguments | returns |
| :--- | :--- | :--- |
| `find_examples` | `query` (free text), `capabilities[]`, `use_cases[]`, `form_factor`, `max_level`, `json2rc_only` (default true), `limit` (default 5) | ranked examples. Each has its id, title, summary, level, the capabilities it matches and lacks, *why* it matched, its snippets for the matched capabilities, and a render link |
| `build_kit` | `goal` (free text) or `capabilities[]`, `max_examples` (default 4) | **the smallest set of examples that together cover the goal**, simplest first. Each comes with the capabilities it contributes and their snippets, plus an honest `not_covered` list. This is the "build from scratch" tool |
| `get_example` | `id`, `parts` (`json`, `meta`, `snippets`, `render`, `rc_base64`) | the example, or the parts asked for |
| `list_capabilities` | `prefix`, `with_counts` | the vocabulary: ids, keywords, evidence, and how many examples demonstrate each, so a model can learn the words to ask with |
| `resolve_terms` | `terms[]` | maps user words ("seek bar", "donut", "material you") to capability, use-case and form-factor ids through the synonyms, and lists the terms nothing matched |

**Search, phase 1: tags and synonyms.** Nothing is learned; it is all deterministic and
explainable.
1. **Normalise the query.** Lower case; hyphens, underscores and spaces are equivalent; drop
   a plural "s".
2. **Match phrases**, longest first, against every synonym in the vocabulary. "pie chart"
   wins over "pie" and "chart". Each match yields ids: capabilities, use cases or form
   factors.
3. **Keep ambiguous terms.** A term that maps to several ids keeps them all. "slider" is
   both `input.drag` and the use case `control`, and "graph" is both `draw.plot` and
   `chart`, so both are scored.
4. **Report leftover words.** Words that match nothing are kept for a plain text match over
   `title`, `summary`, `teaches` and `keywords`, and are reported back as `unmatched_terms`.
   That way a caller sees "the catalog doesn't know 'gyroscope'" instead of a silent miss.
   Unmatched terms are also the signal for what to add to the vocabulary.

**Search, phase 2: a small model.** Later, a small model can take over the picking: reading
the goal, choosing capabilities, ranking examples. It sits behind the same tools
(`find_examples`, `build_kit`) and reads the same metadata. The rich authored fields
(`summary`, `teaches`, snippet notes) are what make that possible, and phase 1 is its
baseline to beat. Keep phase 1 as the fallback, and as the explanation of why an example
was picked.

**Ranking in `find_examples`:**
1. **Resolve terms** as above.
2. **Score.** Each example scores on:
   - capability matches, primary weighted above secondary, and an exact id above an ancestor
     (`input` matches `input.drag`);
   - use case and form factor;
   - a plain text match of the leftover words over `title`, `summary`, `teaches`,
     `keywords` and snippet notes.
3. **Tie-break** toward lower level and fewer operations: a smaller example teaches better.
   Examples whose `check_passed` or `engines.agree` is false rank last and say why.

**`build_kit` as set cover:**
1. Resolve the goal to capabilities, the *needed* set.
2. Choose the example covering the most needed capabilities per unit of level or size, and
   repeat until everything is covered or nothing more helps. This is the greedy set-cover
   approximation.
3. Order the kit by level.
4. For each capability, return the one snippet that shows it, so the model gets the fragments
   it needs rather than four whole documents.
5. List anything left uncovered: an honest "the catalog has no example of `text.font`" is
   better than a near miss.

Example call: `build_kit({goal: "4x2 weather widget, hourly forecast, tap to refresh, dark mode"})`
resolves the goal to `form_factor: widget-4x2`, `use_cases: weather`, `layout.weight`,
`layout.responsive`, `text.dynamic`, `host.variables`, `input.tap` and `theme.mode`. It
returns something like SHW-01 (the whole widget) together with HST-01 (host variables),
INT-01 (tap action) and THM-01 (light/dark). `not_covered` would list what remains, if
anything.

The tool sits next to the others:
- the guide's "Build a document from scratch" workflow becomes `build_kit`, then
  `validate`/`render_rc`, then `audit`;
- render links reuse rc-render's public image route;
- on a deployment the catalog is part of the checkout, so the index can't be out of date
  with the server.

## Component templates

The catalog should teach building documents **from components**, not only from primitives.
A library of common components (buttons, switches, cards, list items, gauges, charts…) is
defined once, documented like the examples, and invoked by name. A new document is then
mostly calls:

```json
{
  "header": { "width": 360, "height": 180 },
  "components": ["Card", "StatTile", "ProgressRing", "Button"],
  "root": { "Card": { "title": "Today",
    "content": [
      { "row": { "children": [
        { "StatTile": { "label": "Steps", "value": "@vars.steps", "unit": "" } },
        { "ProgressRing": { "progress": "@vars.goal", "color": "@colors.accent" } }
      ] } },
      { "Button": { "label": "Details", "style": "text", "onClick": { "hostNamedAction": "open-details" } } }
    ] } }
}
```

### What the format already offers, and how well it works

RemoteCompose has runtime templates. In the Java parser, `definePattern` writes a template
into the document once (`MACRO_DEFINE`) and registers its `name` as a new component type.
Each call is a `MACRO_CALL`:
- **Calls:** `{"CounterButton": {"label": "+", …}}`, or with `arguments: [...]`.
- **Inside the template:** parameters are `@param` references, `locals` gives each instance
  its own state, `patternBlock` is a slot filled by the call's `children`,
  `patternForEach` repeats over a data list, and a pattern can also be used as a modifier
  (a "style factory").

The format is right for this, but support is thin, as tested 2026-10-29 on the corpus's
`material-toggle-button-macro`:

| layer | state |
| :--- | :--- |
| Java parser | full |
| json2rc (the MCP converter) | none: `definePattern` and the calls aren't implemented |
| RemoteCompose-Examples' converter | none: all five macro demos are `jsonReproduces: "unsupported"` |
| C++ engine | the document loads, but the **inflated buttons aren't drawn**, so taps on them miss |
| TypeScript player | the buttons are drawn, with layout defects ("RESET" clipped to "R", the row overflowing). **Their click actions don't fire**: the action targets a pattern-local id (2³² + 43) the player doesn't resolve |

### One library, two compilation modes

So the library is defined once, and the tooling compiles calls in either of two ways:

- **`expand`** (the default): each call is replaced by the component's body, with parameters
  substituted, defaults filled in, static options resolved, locals renamed per instance
  (`Button_3.pressed`) so each keeps its own state, and slots placed. The output is plain
  JSON that every converter and engine handles today. The cost is size: each instance is
  written out in full.
- **`pattern`**: each component used becomes one `definePattern` in the `global` section,
  and each call a pattern call. This is smaller and is the format's own mechanism. Turn it on
  per component once its pattern form passes in json2rc, C++ and TS.

The same document compiles both ways, and the two must render identically and behave the
same under `interact`. **The library is therefore also the conformance suite for runtime
patterns.** Each component that renders the same in both modes is one more case the
converter and the engines get right.

### Defining a component

`examples/components/<Name>/component.json` (the full syntax is at the top of
`mcp/lib/components.mjs`, which expands them):

```jsonc
{
  "component": "Switch", "version": 1,
  "summary": "An on/off switch: a tap flips its variable (0 or 1); ...",
  "params": {
    "checked": { "type": "variable", "initial": 0, "doc": "bind \"@wifi\", or omit: the switch keeps its own" },
    "label":   { "type": "string", "required": true },
    "color":   { "type": "color", "default": "@colors.primary" },
    "style":   { "type": "enum", "values": ["filled", "outlined"], "static": true }   // e.g. Button
  },
  "slots":    { "icon": { "optional": true } },          // filled by the call's "slots": {"icon": [...]}
  "capabilities": ["input.toggle", "a11y.labels"],
  "call":     { "Switch": { "label": "Wi-Fi", "checked": "@wifi" } },   // the minimal call snippet
  "pitfalls": ["..."],
  "body":     { "canvas": { ... "@checked", "16 + @checked * 20", "@colors.track", "@theme.radius_md" ... } }
}
```

In a body:
- `"@p"` is the argument, whatever its JSON type. Inside an expression it is spliced in as a
  number, a `@variable` or a parenthesised expression. A `string` param is text and is spliced
  as written, so `"Decrease @label"` gives `"Decrease guests"`.
- A `variable` param is bound to the caller's variable, or to a fresh per-call variable, so each
  instance keeps its own state.
- `"@colors.x"` is a theme colour. It is added to `resources.colors` unless the document
  defines it, which is how a document re-themes the library.
- `"@theme.x"` is a theme number. Arithmetic on static numbers folds to a literal.
- `"locals"` are names private to each call. A number is per-call state. An expression
  (`"frac": "@value / @max"`, or a `$if` choosing one) is computed once per call: one float
  expression in `resources.variables` that every `@frac` reads, or a literal when the arguments
  are static numbers. Gauge shares its fraction and sweep this way, and StatTile its
  `abs(@delta)` and `step(@delta, 0)`. `{"$count": "labels"}` is the length of a list param.
- `{"$slot": "icon"}` splices the slot content.
- `{"$each": "labels", "as": "label", "index": "i", "count": "n", "do": …}` repeats over a
  static list, binding the item, its index and the number of items.
- `{"$if": "style == 'outlined'", "then": …, "else": …}` chooses at compile time. On a slot or
  a runtime param, `{"$if": "p"}` tests whether it was given.
- An optional param with no default, used as a whole value (`"onClick": "@onClick"`), drops its
  key when absent.

**Compile modes** (implemented 2026-10-29; `"componentMode"` at the top of a document, or in
one call). `expand` inlines every call into plain JSON. `pattern` compiles each call to a
`definePattern` template per component and static variant (`Button__outlined_icon`, at the
head of a root array rather than in `global`) plus a pattern call; runtime values are
arguments, slots are patternArgument/patternBlock, per-call state is a pattern local. `auto`
(the default) takes a template for a variant used twice or more when the converted document is
smaller, measured both ways. Templates are only emitted where both players render them like the
expansion, which today excludes any component with a text (U7) or a canvas reading a
parameter, local or expression (T22, C35): auto picks Divider in CMP-05 (4403 → 4100 B) and
CMP-12 (2665 → 2598 B) and keeps the rest expanded. Every gallery stays byte-identical to Java
in either mode. `docs/COMPONENT_AUTHORING.md` ("expand vs pattern") has the mapping and the
traps.

**Runtime state without colour expressions.** The JSON has no colour interpolation. A component
whose colour follows a value draws both variants and sets each one's paint alpha to a 0/1
expression: `@checked` and `1 - @checked`, or `step(f, 0.6)` for gauge zones.

**Theme.** `examples/components/theme/default.json` holds the colours (`background`, `surface`,
`primary`, `onPrimary`, `muted`, `track`, `success`, `warning`, `error`, …) and the numbers
(`radius_md`, `space_4`, `text_md`, `control_height`, …).

**Accessibility is part of the contract.** Every interactive component takes a label (or uses
its `label`) and emits `semantics`. A component can't enter the library with an `audit`
accessibility warning.

### The initial library

**Built so far (2026-10-29):**
- 20 components: Button, Switch, Checkbox, Chip, Badge, ProgressBar, ProgressRing, Divider,
  KeyValueRow, Stepper, Card, Avatar, ListItem, TopBar, Tabs, PagerDots, StatTile, Gauge,
  AnalogClock and DigitalClock.
- Every one is in a gallery: CMP-01 (Button), CMP-02 (Switch, Checkbox), CMP-04 (Chip, Badge),
  CMP-05 (TopBar, Card, ListItem, Avatar, Divider), CMP-06 (Tabs, PagerDots), CMP-07
  (ProgressBar, ProgressRing), CMP-08 (Gauge, StatTile), CMP-10 (AnalogClock, DigitalClock),
  CMP-12 (KeyValueRow, Stepper) and CMP-13 (the library re-themed). Chip's and Tabs' selected
  states are `graphicsLayer` alpha overlays; Tabs draws one underline that slides with an
  animated selection.

| component | params (main) | capabilities | synonyms |
| :--- | :--- | :--- | :--- |
| `Button` | label, style, color, enabled, onClick, icon slot | `input.tap`, `layout.decoration`, `a11y.labels` | cta, action button, push button |
| `IconButton` | icon slot, label (a11y), onClick | `input.tap`, `a11y.labels` | icon, toolbar button |
| `Switch` | checked (variable), label | `input.toggle`, `a11y.state` | toggle, on/off |
| `Checkbox` | checked, label | `input.toggle`, `a11y.state` | tick box, check |
| `Slider` | value (variable), min, max, label | `input.drag`, `text.dynamic` | seek bar, range, volume |
| `Chip` | label, selected, onClick | `layout.decoration`, `input.toggle` | tag, pill, filter |
| `Badge` | text or count, color | `text.dynamic`, `layout.decoration` | count, notification dot |
| `Card` | title, subtitle, content slot, actions slot | `layout.stack`, `layout.decoration` | panel, tile, surface |
| `ListItem` | leading slot, title, subtitle, trailing slot, onClick | `layout.stack`, `input.tap` | row, cell, menu item |
| `Avatar` | initials or image, size | `draw.shapes`, `image.bitmap` | profile picture, user icon |
| `Divider` | inset, color | `draw.shapes` | separator, rule |
| `TopBar` | title, navigation slot, actions slot | `layout.stack`, `layout.align` | app bar, toolbar, header |
| `Tabs` | labels (data), selected (variable) | `input.tap`, `layout.state` | segmented control, tab bar |
| `PagerDots` | count, current | `data.loop`, `data.condition` | page indicator, dots |
| `ProgressBar` | progress, color | `data.measure`, `data.expression` | loading bar, progress |
| `ProgressRing` | progress, color, thickness | `draw.arc` | circular progress, ring |
| `Gauge` | value, min, max, zones (data), label | `draw.arc`, `text.dynamic`, `data.condition` | meter, dial, speedometer |
| `StatTile` | label, value, unit, delta | `text.dynamic`, `data.condition` | kpi, metric, number tile |
| `Sparkline` | values (data), color | `draw.plot`, `data.array` | trend, mini chart |
| `BarChart` | values, labels (data), color | `data.array`, `data.loop`, `draw.shapes` | histogram, columns |
| `DonutChart` | values (data), colors | `draw.arc`, `data.array` | pie, donut |
| `AnalogClock` | style, show seconds | `time.clock`, `draw.transform` | clock face, watch hands |
| `DigitalClock` | format (static) | `time.clock`, `text.dynamic` | time display |
| `DateLabel` | format (static) | `time.date`, `text.dynamic` | date, today |
| `WeatherIcon` | condition (static: sun, cloud, rain, snow, storm) | `draw.path` | weather symbol |
| `BatteryIndicator` | level (default: system battery) | `host.system`, `data.condition` | battery |
| `Skeleton` | shape, size | `draw.gradient`, `time.animation` | shimmer, placeholder, loading |
| `Banner` | text, kind (static: info, warn, error), action slot | `layout.decoration`, `time.transition` | alert, toast, snackbar |
| `KeyValueRow` | key, value | `layout.weight`, `text.basic` | property row, detail line |
| `Stepper` | value (variable), min, max, step | `input.tap`, `text.dynamic` | plus/minus, counter |

### In the catalog and the tools

Components are catalog entries like examples, with `kind: "component"`. Each has:
- its params schema, summary and synonyms (also in
  [`examples-vocabulary.json`](examples-vocabulary.json) under `components`), and its
  capabilities;
- a **gallery example** showing every variant and state (the `CMP` family below), with its
  render;
- a minimal **call snippet** (the smallest correct invocation);
- its support status per mode: `expand` passes, and `pattern` passes or fails in json2rc,
  C++ and TS.

Examples record the components they use (`derived.components`), so retrieval can say "this
weather widget is built from `Card`, `WeatherIcon` and `KeyValueRow`".

`rc-examples` gains:

| tool | what it does |
| :--- | :--- |
| `find_components` | search the library by capability, synonym or text, the same way `find_examples` does |
| `get_component` | the params table, the call snippet, the gallery render, and the definition |
| `expand_components` | a document using components becomes plain JSON (`expand`), or a `definePattern` document (`pattern`) |

`build_kit` prefers components: when a goal needs a gauge, it returns the `Gauge` call
snippet before any example that draws one by hand.

On the server side, `lib/document.mjs` (`prepareDocument`) expands components before
json2rc. So json2rc, `render_rc`, `validate`, every rc-inspect tool and `package_web` all
accept documents that use the library, with no change to their callers.

### Building and verifying the library

For each component:
1. Write `component.json` and the gallery example (`CMP-<nn>`).
2. Expand the gallery and run the usual pipeline:
   - `validate`, `render_rc`, `audit` (no accessibility warnings);
   - `interact` for every interactive param, checking that it changes what it should;
   - compare the two engines.
3. Compile the same gallery in `pattern` mode, and record per engine whether it matches the
   expanded render and behaviour. A failure there is a bug report against json2rc or an
   engine, with a minimal reproduction already attached.
4. Re-express the showcases (`SHW`) using the library. The kits then carry real component
   usage, and the showcases test the components in realistic layouts.

## What already exists

Three places hold examples today. Check them before generating anything.

**[RemoteCompose-Examples](https://hoford.github.io/RemoteCompose-Examples/index.html)** is
the main corpus: **1,336 documents** with a browsable catalogue and a playground.

- **Where they come from:** `rcjson` 919, `androidx` 237, `origami` 156, `droidkaigi26` 14
  and `rc-experiments` 10.
- **JSON:** 871 have a JSON source. 666 of those rebuild to the same bytes
  (`jsonReproduces: "yes"`), 201 use something the converter doesn't support, and 4 differ.
- **Collections:** `render` (392), `androidx-demos` (173), `python-samples` (141),
  `layout` (120, a systematic layout-rule suite), `iot-panels` and `iot-panels-light` (80
  each), `androidx-kotlin` (64), the `vis-set-01…13` data-visualisation sets (16 each),
  `games` (13), `formula`, `charts2d`, `charts3d`, `skeleton-watch`, and 3D assemblies.
- **Tags:** dominated by `test`, `animated`, `graph`, `layout`, `iot`, `validation`, `input`,
  `3d`, `gauge`, `widget` and `particles`, plus subject tags (biology, economics…).
- **Indexes for agents:**
  - `catalog/corpus.jsonl` has one line per document: apis, flags, tags, size, op count.
  - `catalog/by-command.json` maps each JSON key to the documents using it, smallest first.
  - `catalog/by-op.json` does the same per wire operation.
  - `catalog/coverage.json` lists the operations with no example.
  - `catalog/schema.json` lists every accepted command.
  - `AGENTS.md` gives an authoring recipe, which recommends the `paint: {ops: [...]}`
    dialect.

**This repository** has the inspector's 20 sample `.rc` files and two JSON files
(`inspector/samples`), ten 3D data-visualisation JSONs (`samples/3d`), and the shader cases
in `players/typescript/src/json2rc/tests/shaders`.

**The androidx checkout** has the Java parser's tests (`remote-creation-core/src/test/…/json/`)
and the integration-test demos. 237 of these are already in the corpus as `androidx` and
`androidx-demos`.

**Where the corpus is thin.** 58 of the 176 known operations have **no** example at all
(`coverage.json`). A few of those are reserved or internal (`EXTENSION_RANGE_RESERVED_*`,
`EXTENDED_OPCODE`, `SKIP`, `UPDATE`, `COMPONENT_START`); the rest are real authoring gaps.
- **Families with no examples:**
  - all 2D bitmap drawing (`DRAW_BITMAP`, `DRAW_BITMAP_INT`, `LOAD_BITMAP`,
    `ATTRIBUTE_IMAGE`);
  - bitmap fonts, embedded fonts (`DATA_FONT`) and `TEXT_STYLE`;
  - `DRAW_TEXT_ON_CIRCLE`, `TEXT_LENGTH`, `TEXT_SUBTEXT` and `TEXT_LOOKUP_INT`;
  - `PATH_COMBINE`, and the matrix family (`MATRIX_FROM_PATH`, `MATRIX_SKEW`,
    `MATRIX_CONSTANT`);
  - 2D meshes;
  - `ANIMATION_SPEC`;
  - float functions (`FUNCTION_DEFINE`/`CALL`);
  - the macro family (`MACRO_*`) and `REFERENCED_OPERATIONS`;
  - `MODIFIER_MULTI_CLICK`, `MODIFIER_MARQUEE`, `MODIFIER_COLLAPSIBLE_PRIORITY`,
    `MODIFIER_DIMENSION_CONSTRAINTS` and `MODIFIER_DRAW_CONTENT`;
  - `HOST_NAMED_ACTION`, `VALUE_STRING_CHANGE_ACTION` and `EVENT_ACTION`;
  - `DATA_MAP_LOOKUP`, `DATA_SOUND` and `LAYOUT_CUSTOM`;
  - particle comparison and processing (`PARTICLE_COMPARE`, `PARTICLE_LOOP`,
    `PARTICLE_PROCESS`).
- **Covered by a single document:** `fitBox`, `stateLayout`, `horizontalScroll`, `ripple`,
  `drawTextOnPath`, `pathEffect`, `include` and `referencedOperations`.
- **No JSON key used anywhere:** `collapsibleRow`/`collapsibleColumn`, `textMerge`,
  `textLookup`, `textMeasure`, `radialGradient`, `polarPathExpression`, `pathTween`,
  `drawBitmap`, `createOffscreenBitmap`, `animationSpec`, `defineVisibilityAnimation`,
  `wakeIn`, `stateDescription`, `desiredFPS` and `densityBehavior`.

So the corpus is strong on charts, gauges, IoT panels, layout rules, expressions, 3D and
`touchExpression` interaction. It is weak on everything bitmap- and font-related, rich text,
path algebra, reuse, host integration, and the newer modifiers. The 🆕 samples target
exactly that.

**Starting points per family.** These are the smallest existing documents using a family's
key command. Fetch `docs/<id>/doc.json` from the corpus.

| family | start from |
| :--- | :--- |
| LAY | `layout/e01-row-one-weight` (weight), `layout/g01-widthin-min-forces-growth`, `layout/i04-clip-oversized-child`, `layout/j03-offset`, `layout/j05-visibility-gone`, `layout/j07-zindex`, `render/17-components` (fitBox), `render/scroll-h`, `render/material-toggle-button` (stateLayout) |
| TXT | `render/01-hello`, `render/02-text-layout`, `render/02-ticker` (textFromFloat), `formula/clockwork` (drawTextOnPath) |
| DRW | `formula/guilloche` (drawPath, pathExpression), `charts2d/rose` (drawSector), `iot-panels-light/03-dimmer-switch` (drawArc), `render/15-paint` (sweepGradient), `formula/phyllotaxis` (linearGradient, loop), `render/dashboard-card` (AGSL), `formula/clockwork` (matrix stack) |
| VAR | `render/21-floatarrays`, `formula/phyllotaxis` (loop), `games/bubble-drop` (conditionalOperations, variables) |
| INT | `render/p04-click-actions` (onClick, ripple), `render/01-sakura-season` (semantics, onClick), any of the 50 `touchExpression` documents |
| FX | `games/bubble-drop` (createParticles, particlesLoop, impulse) |
| 3D | `architecture3d/architecture3d` (camera3D, lights3D, meshPrimitive3D, material3D), `charts3d/02-surface` (meshExpression3D), `render/c10-grazing-canvas` (texture3D, bitmaps) |
| RU | `render/material-toggle-button-macro` (definePattern), `render/rc-json-referenced-operations-macro-demo` (include, referencedOperations) |
| SHW | `iot-panels/*` (widgets), `skeleton-watch/*` and its recipe (a watch that keeps time), `games/*`, `vis-set-*` (data visualisation) |

---

## The sample plan

The entries below are the catalog's seed: each becomes one example once it passes the
[pipeline](#generation-pipeline). The family each sits in gives its primary capability
subtree; the full capability list, keywords, teaches lines and snippets are written at
generation time. The columns:

| field | meaning |
| :--- | :--- |
| **ID** | `<FAMILY>-<nn>`, stable. Files are `<id>-<name>.json`, for example `LAY-04-weights.json` |
| **Name** | short kebab-case slug |
| **Level** | 1–5, see below |
| **Prompt** | what to build: size, what is visible, how it behaves, which inputs drive it |
| **Exercises** | the JSON features the sample must use, by their JSON names, so coverage can be tracked |
| **Check** | how to verify it, usually with the MCP tools (`render_rc` with a pinned `clock`, `touch_events`, `variables`; `audit`; `interact`) |
| **Corpus** | 🆕 means the [RemoteCompose-Examples](https://hoford.github.io/RemoteCompose-Examples/index.html) corpus has no example of the sample's defining feature: no document uses the operation (`coverage.json`), or no JSON document uses the key (`by-command.json`), as of 2026-10-29. ◐ means only one to three documents use it. Unmarked means it is covered, so start from an existing example and vary it |
| **json2rc** | ⚠️ means a feature isn't in the TypeScript json2rc converter yet, which is what the MCP servers use (as of 2026-10-29). Those samples need the Java `RemoteComposeJsonParser`, or converter work first. Unmarked samples should convert; json2rc names the exact construct when it doesn't |

Every sample also carries a **family** (its section below) and, implicitly, its **inputs**:
the clock, touch, host variables, system variables or theme. Inputs are spelled out in the
prompt so that renders can be reproduced.

### Levels

| level | meaning | typical size |
| :---: | :--- | :--- |
| 1 | one feature, static, minimal | < 30 lines of JSON |
| 2 | one feature with its options, or two features combined | 30–80 |
| 3 | dynamic: expressions, time, or interaction drive what is shown | 50–150 |
| 4 | composite: several families working together | 100–300 |
| 5 | showcase: a complete, realistic artifact | 200+ |

### Conventions for every sample

- **Resizing.** A document is laid out in whatever box the host gives it, not only its header
  size. Build layouts that adapt: fill the box (`fillMaxSize`/`fillMaxWidth`, weights), place
  canvas drawing from `componentWidth()`/`componentHeight()` rather than the header's numbers,
  and degrade gracefully when smaller (ellipsis, `maxLines`, collapsible rows, `fitBox`). Every
  example proves it with at least one `check.renders` entry at another `width`/`height` (the
  build renders it and audits the layout at that size), or sets `meta.fixed_size` to the reason
  it can't (a 227×227 round watch face). Two traps: `componentWidth()` inside a modifier is the
  modified component's own width, not its parent's; and a scale-to-fit canvas (a `min(cw/W,
  ch/H)` scale plus a centring translate) costs about 147 B until the parser can write the
  format's own ROOT_CONTENT_BEHAVIOR scaling (U25).
- **Size.** State the header size: `width`/`height` in dp, `apiLevel` 7, `profiles` 513
  unless the sample is about them. Widgets use a widget size (for example 360×180 for 4×2),
  watch faces a round 227×227, and screens 360×780.
- **Determinism.** A sample that reads time names the `clock` value it should be checked at.
  One that uses `rand()` seeds it. One that reacts to input lists the `touch_events` or
  `interact` actions that demonstrate it.
- **Host variables.** Declare them in `resources.variables` with `"export": true`, with
  defaults that look good, so the document renders well with no host at all.
- **No external files.** Bitmaps and fonts are embedded (`resources.bitmaps` with `base64`,
  or `file`, which json2rc inlines).
- **Validate before you trust a sample.** Run `validate`, then `render_rc`, then `audit`.
  Package it with `package_web` to see it in the TypeScript player too: the two engines can
  differ, and a difference is a finding.

## DOC — Document and header

| ID | Name | Lvl | Prompt | Exercises | Check |
| :--- | :--- | :---: | :--- | :--- | :--- |
| DOC-01 | hello-box | 1 | A 300×200 document with one box filling it, painted teal, with the text "Hello" centred. | `header`, `box`, `fillMaxSize`, `background`, `text` | Renders a teal card with centred text; `audit` is clean |
| DOC-02 | header-metadata | 1 | DOC-01, plus a header `contentDescription` ("Greeting card") and `profiles`. | `header.contentDescription`, `header.profiles` | `inspect_summary` shows the description and profiles |
| DOC-03 🆕 | desired-fps | 2 | A dot sliding left to right every 2 s, with the header asking for 30 fps. | `header.desiredFPS`, `animationTime()` | `inspect_runtime`: continuous repaint; renders at t=0 and t=1 differ |
| DOC-04 🆕 | density-behavior | 2 | A 200×200 card with a 1 dp hairline border, 16 dp padding and 14 sp text, meant to look identical at densities 1, 2 and 3. | `header.densityBehavior`, `padding`, `border`, `density()` | Renders at `density` 1/2/3 look the same at different sharpness |
| DOC-05 ⚠️ | compressed | 2 | DOC-01 with header `compress` enabled. | `header.compress` | Converts; renders identically to DOC-01; smaller file |

## LAY — Layout

| ID | Name | Lvl | Prompt | Exercises | Check |
| :--- | :--- | :---: | :--- | :--- | :--- |
| LAY-01 | column-stack | 1 | Three 60 dp coloured boxes stacked in a column, 8 dp apart, centred horizontally in a 300×300 document. | `column`, `horizontalAlignment`, `spacedBy`, `size` | Three boxes centred with even gaps |
| LAY-02 | row-arrangements | 2 | Six rows, each with three small squares, using `start`, `center`, `end`, `spaceBetween`, `spaceEvenly` and `spaceAround`, each labelled on the left. | `row`, `horizontalArrangement` (all six) | Each row's squares are distributed as its label says |
| LAY-03 | box-alignment | 1 | A 300×300 box with nine small labelled squares, one at each alignment (top-start … bottom-end). | `box`, `contentAlignment` | Nine squares at the corners, edges and centre |
| LAY-04 | weights | 2 | A row of three boxes with weights 1:2:1 filling the width, plus a column below it with weights 1:1. | `weight`, `horizontalWeight`, `verticalWeight` | At width 300 the middle box is 150 dp; at 600 it is 300 (`inspect_layout` at both) |
| LAY-05 | size-constraints | 2 | Boxes showing `width`, `size`, `widthIn(min, max)` and `heightIn` behaviour, each with a label of its rule. | `width`, `height`, `size`, `widthIn`, `heightIn` | `inspect_layout` bounds match the constraints at widths 200 and 500 |
| LAY-06 | padding-offset-border | 2 | Nested cards: an outer one with 16 dp padding and a 2 dp rounded border, and an inner one offset by (8, 8) with its own background and clip. | `padding`, `offset`, `border`, `clip` (`roundRect`), `background` | Inner card offset inside the outer one; corners clipped |
| LAY-07 | spacers | 1 | A toolbar row: a title, a weighted spacer, then two icon squares pushed to the right end. | `spacer`, `weight` | Icons are right-aligned at any width |
| LAY-08 | flow-chips | 2 | Twelve tag chips with different text lengths in a `flow`, wrapping onto new lines. | `flow`, `padding`, `background`, `clip` | Two lines at width 360, four at width 200 |
| LAY-09 ◐ | fitbox-responsive | 3 | A `fitBox` holding a large, a medium and a small layout of the same content, so the largest one that fits is shown. | `fitBox` | Large at 400×200, medium at 250×150, small at 150×100 |
| LAY-10 | vertical-scroll-list | 3 | A 360×400 list of 30 rows (avatar circle, two text lines) that scrolls vertically. | `verticalScroll`, `column`, `loop` or repeated rows | `interact` drag (180,350)→(180,50): `layout_changes` shows the rows moving |
| LAY-11 ◐ | horizontal-carousel | 3 | A row of eight 200 dp cards that scrolls horizontally. | `horizontalScroll` | Dragging left reveals the later cards |
| LAY-12 | visibility | 2 | Three items where the middle one has `visibility` gone, then invisible (two variants side by side). | `visibility` | Gone collapses its space; invisible keeps it |
| LAY-13 🆕 | collapsible-row | 3 | An app bar (title "Inbox", a "12 new" chip, search, share, an overflow menu) that drops its least important items as it narrows: the chip first, then share, then search; the title and the overflow menu stay. Shown at 328, 240, 200, 152 and 112 dp. | `collapsibleRow`, `collapsiblePriority`, unprioritized weighted `spacer` | 328: everything; 240: no chip; 200: no share; 152: title and ⋮ only; 112: title only |
| LAY-14 🆕 | collapsible-column | 3 | A tall, narrow weather widget that sheds content as it gets shorter: forecast rows first (bottom up), then the condition, then high/low, then the icon; city and temperature stay. Shown at 256, 208, 164 and 100 dp. | `collapsibleColumn`, `collapsiblePriority` (vertical), tied priorities | 256: all; 208: one forecast row left; 164: city, icon, temp, high/low; 100: city and temp |
| LAY-15 ◐ | state-layout | 3 | A photo backup status card with three states chosen by an integer the host can set: compact "Up to date", expanded "Backing up" (progress, Pause/Details), red "Paused, no Wi-Fi" with Retry; a tap goes to the next state and the card animates. | `stateLayout`, `indexId`, exported `integers`, per-state `onClick` `valueIntegerChange`, `animationSpec` `animationId` | Tap at (180,52) settles to the expanded card; `state` 2 shows Paused; taps cycle 0→1→2→0 |
| LAY-16 ⚠️ ◐ | z-order | 2 | Three overlapping cards whose draw order is set by `zIndex` rather than document order. | `zIndex` | The card with the highest `zIndex` is on top |
| LAY-17 | baseline-align | 2 | A run summary card with three stats (8.42 km, 42:10 min, 5′01″ /km), each a big number with a small unit on its baseline, above the same card with default centring for comparison. | `alignByBaseline`, `weight` | The bottom card's units sit on the baseline; the top card's float at mid-height |
| LAY-18 | dashboard-grid | 4 | A 360×640 screen: a header row, a 2×2 grid of stat cards made with weights, and a list below. | `column`, `row`, `weight`, `padding`, `verticalScroll`, `text` | `audit` is clean at 360×640 and at 800×1280 |

## TXT — Text

| ID | Name | Lvl | Prompt | Exercises | Check |
| :--- | :--- | :---: | :--- | :--- | :--- |
| TXT-01 | text-basic | 1 | One line of text with a chosen size and colour. | `text`, `fontSize`, `color` | Readable text |
| TXT-02 | text-styles | 2 | A specimen sheet: weights 100–900, italic, letter spacing, and line height on a paragraph. | `fontWeight`, `fontStyle`, `letterSpacing`, `lineHeightMultiplier` | Each line visibly differs |
| TXT-03 | text-overflow | 2 | The same long sentence in 120 dp boxes with `maxLines` 1/2/3 and start, middle and end ellipsis. | `maxLines`, `ellipsis`, `start_ellipsis`, `middle_ellipsis` | Ellipses at the right places |
| TXT-04 | text-autosize | 3 | A title that shrinks to fit its box, between 12 and 48 sp. | `minFontSize`, `maxFontSize` | Large at 400 wide, small at 150 wide, never clipped |
| TXT-05 | text-anchored | 2 | In a canvas, the same word drawn at nine anchor points (`panX`/`panY` −1, 0 and 1) with a crosshair at each anchor. | `drawTextAnchored`, `panX`, `panY` | Each word sits on its crosshair as its anchor says |
| TXT-06 ◐ | text-on-path | 2 | A sentence following a sine-wave path, with the path drawn faintly underneath. | `drawTextOnPath`, `drawPath`, `hOffset`, `vOffset` | The text follows the wave |
| TXT-07 ⚠️ 🆕 | text-on-circle | 2 | Watch-dial style numbers or a slogan around a circle. | `drawTextOnCircle` | The text wraps around the circle |
| TXT-08 | number-format | 3 | A live counter (seconds since midnight) formatted with 0, 1 and 2 decimals. | `textFromFloat` (`whole`, `decimal`), `timeInSec()` | At `clock` 10:10:05 it reads 36605 / 36605.0 / 36605.00 |
| TXT-09 ⚠️ 🆕 | text-merge | 3 | "Battery: 73%" built from a literal, a number and a suffix. | `textMerge`, `textFromFloat` | The text updates with the value |
| TXT-10 🆕 | text-lookup | 3 | Today's weekday name, chosen from a seven-name array. | `textLookup`, `adddatalist`, `weekDay` | Shows "Wednesday" at `clock` 2026-10-28 |
| TXT-11 ⚠️ 🆕 | marquee | 3 | A long song title in a narrow box that scrolls horizontally. | `marquee` | Renders at t=0 and t=2 differ |
| TXT-12 ⚠️ 🆕 | text-measure | 3 | A badge whose rounded background sizes itself to its dynamic text, measured at runtime. | `textMeasure`, `textLength` | Badge width follows the text at two values |
| TXT-13 | multilingual | 2 | One line each of English, Japanese, Arabic (right to left), and emoji. | `text`, font fallback | Every glyph renders; no tofu boxes (`validate` `no_fonts` must not fire) |
| TXT-14 ⚠️ 🆕 | custom-font | 3 | A heading in an embedded font (`addFont`/`fontData`), with variable-font axes. | `addfont`, `fontdata`, `fontAxis` | The heading uses the font, not the fallback |

## DRW — Canvas drawing

| ID | Name | Lvl | Prompt | Exercises | Check |
| :--- | :--- | :---: | :--- | :--- | :--- |
| DRW-01 | primitives | 1 | A grid of a rect, a rounded rect, a circle, an oval and a line, each filled or stroked. | `canvas`, `drawRect`, `drawRoundRect`, `drawCircle`, `drawOval`, `drawLine` | Five clear shapes |
| DRW-02 | arcs-sectors | 2 | A donut progress ring (`drawArc`, stroked, 270°) and a three-slice pie (`drawSector`). | `drawArc`, `drawSector`, `startAngle`, `sweepAngle` | The ring ends at 270°; the slices meet exactly |
| DRW-03 | stroke-styles | 2 | Lines showing butt/round/square caps and miter/round/bevel joins at 2, 8 and 16 dp, with alpha. | `paint` `strokeWidth`, `strokeCap`, `strokeJoin`, `alpha`, `style` | Visibly different ends and corners |
| DRW-04 | svg-path | 1 | A heart icon from an SVG path string, filled red. | `drawPath` (SVG string) | A recognisable heart |
| DRW-05 | path-builder | 2 | A five-point star built point by point. | `pathCreate`, `pathAppendLineTo`, `pathAppendClose` | A symmetric star |
| DRW-06 | path-expression | 3 | A plot of y = sin(x)·e^(−x/4) across the canvas, as one path. | `pathExpression`, `sin`, `exp` | A smooth decaying wave |
| DRW-07 ⚠️ 🆕 | polar-rose | 3 | A rose curve r = cos(5θ), slowly rotating. | `polarPathExpression`, `animationTime()` | Ten petals that rotate between renders |
| DRW-08 ⚠️ 🆕 | path-morph | 3 | A circle morphing into a star and back every 2 s. | `pathTween` / `drawTweenPath` | Midway (t=0.5) it is visibly in between |
| DRW-09 ⚠️ 🆕 | path-combine | 2 | Two overlapping circles shown as union, intersection, difference and xor. | `pathCombine` | Four distinct results |
| DRW-10 ⚠️ ◐ | dashed | 2 | Dashed and dotted outlines around shapes. | `pathEffect` | Dashes visible |
| DRW-11 | matrix-stack | 2 | Twelve clock ticks drawn by rotating the canvas in a loop, with save/restore around each. | `save`, `translate`, `rotate`, `restore`, `loop` | Evenly spaced ticks |
| DRW-12 | clipping | 2 | A striped pattern clipped to a circle, then to a star path. | `clipRect`, `clipPath` | Stripes only inside the shapes |
| DRW-13 | gradients | 2 | Three swatches: a linear gradient, a sweep gradient, and a radial one. | `linearGradient`, `sweepGradient`, `radialGradient` ⚠️ | Smooth gradients (the radial one needs the Java parser) |
| DRW-14 | agsl-plasma | 3 | A full-canvas AGSL plasma shader animated by `iTime`. | `shader` `{agsl, uniforms}`, uniform from `continuousSec()` | Colourful; renders at two clocks differ; C++ and TS match |
| DRW-15 | agsl-uniforms | 3 | An AGSL ring shader whose centre, radius and colour are uniforms bound to host variables. | `shader` uniforms bound to `@vars`, float arrays | Changing `variables` moves and recolours the ring |
| DRW-16 | agsl-texture | 4 | An AGSL ripple distortion of an embedded bitmap (`uniform shader uTex`). | `shader` bitmap uniform, `resources.bitmaps` | The bitmap is visibly distorted, and animates |
| DRW-17 ⚠️ 🆕 | mesh2d | 3 | A colour-gradient mesh warped into a wave. | `drawMesh2D` | A smooth warped mesh |

## IMG — Bitmaps

| ID | Name | Lvl | Prompt | Exercises | Check |
| :--- | :--- | :---: | :--- | :--- | :--- |
| IMG-01 ⚠️ 🆕 | draw-bitmap | 1 | An embedded 64×64 PNG icon drawn at its natural size and scaled ×2. | `drawBitmap`, `drawScaledBitmap`, `resources.bitmaps` | The icon is crisp at both sizes |
| IMG-02 ⚠️ 🆕 | image-fit | 2 | A photo in three boxes: fit, crop and fill. | `drawScaledBitmap` scale modes | Each box shows its mode |
| IMG-03 ⚠️ 🆕 | offscreen-cache | 3 | A costly pattern drawn once into an offscreen bitmap, then tiled. | `createOffscreenBitmap`, `drawOnBitmap`, `drawBitmap` | Matches a direct draw |
| IMG-04 ⚠️ 🆕 | bitmap-font | 3 | A score counter in a pixel-art bitmap font. | `drawBitmapFontTextRun` | Glyphs from the sprite sheet |
| IMG-05 ⚠️ 🆕 | image-attributes | 2 | A layout sized from the image's own width and height. | `imageAttribute` | Box size equals the image's size |

## EXP — Expressions

The systematic reference for the expression language; VAR keeps the first-steps examples. Capability ids `expr.*`.

| ID | name | level | prompt | exercises | check |
| :--- | :--- | :--- | :--- | :--- | :--- |
| EXP-01 | operators | 1 | Cheat sheet of formulas over a = 7, b = 3 with live results | `+ - * / %`, precedence, parentheses, left-to-right, unary minus, truncating `%` (expr.operators) | rows read 13, 20, 3, 2.33, 1, -1, 6 |
| EXP-02 | math-library | 1 | Reference card of the math functions with sample arguments | sqrt, pow, exp, ln, log (base 10), hypot, square, atan2, floor/ceil/round/fract on negatives, abs, sign, max (expr.math) | 1.414, 1024, 2.718, 2.303, 3, 5, 2.25, 0.785 / -3, -2, 3, -2, -0.25, 4, -1, 8 |
| EXP-03 | easing-curves | 2 | Five easing curves overlaid on one chart with a legend | square ease-in/out, `smooth_step(t, 1, 0)`, smootherstep polynomial as pathExpressions (expr.shaping) | five curves from bottom-left to top-right, S-curves crossing at the centre |
| EXP-04 | remap-ranges | 2 | Temperature, gain and speed mapped from their units onto tracks | `clamp(0, 1, (v - lo)/(hi - lo))` + `lerp`, out-of-range pinning, `{"shader": 0}` (expr.shaping) | 23 °C two thirds along, gain bar 70 %, speed full with an "over range" note |
| EXP-05 | polar-trig | 3 | Compass dial whose needle points at a target, with bearing and distance | ticks around a circle from sin/cos in a loop, `atan2(dx, -dy)`, radians to degrees, `hypot`, `step(i % 5, 0)` (expr.trig) | needle at the target, 53° and 75 px |
| EXP-06 | branchless-select | 3 | Three batteries coloured by level, with time left or time to full | step masks as paint alpha, band mask, `ifElse(else, then, cond)`, `max` as a lower bound (expr.select) | 18 % red Low 108 min left; 42 % amber 69 min to full; 86 % green 516 min left |
| EXP-07 | conditional-blocks | 2 | Air-quality badge and advice by threshold band | conditionalOperations eq/gt/le, nesting for AND, complement for else (expr.conditional) | 132 gives the orange "Unhealthy for some" badge; 0/30/75/180 give the other bands |
| EXP-08 | array-stats | 3 | Week of steps as bars with best day, average line and stats | arraySum/Length/Max/Get, arraySumSqr standard deviation, avg as a named variable, grouping flags (expr.array) | 58,700 total, 8,386 average, 12,100 best, 2,139 std dev; Saturday highlighted |
| EXP-09 | seeded-skyline | 3 | Night skyline with random towers and lit windows, the same every time | `seed(key, rand())` per loop index, keys combined across nested loops, a seeded loop `until`, step on/off (expr.random) | 14 towers, amber windows, moon, stars; the same on every render |
| EXP-10 | modifier-expressions | 3 | Download card: bar, riding % bubble, level bars, fading caption | `fillMaxWidth: "@p"`, offset with clamp, height from an array, graphicsLayer alpha (expr.modifiers) | bar at 65 % with the bubble over its end; a 0.12 render moves both |
| EXP-11 | text-formatting | 2 | Number-format reference: currency, separators, parentheses, zero pad, mm:ss, % | textFromFloat flag arithmetic, textMerge chains, `whole` counts separators (expr.format) | $1,234.50 · 1.234,50 € · 9_876_543 · (42.50) · 007 · 07:05 · 65% · 543 |
| EXP-12 | text-ops | 2 | Contact card from raw strings: capitalised name, initial, fitted role pill, trimmed preview | textTransform (numeric ops), textSubtext, textLength, textMeasure, textMerge (expr.string) | "Ada Lovelace", A avatar, ANALYST pill, "…elabo…", 50 characters |
| EXP-13 | system-values | 2 | Diagnostics card of window/canvas size, density, font size, time, day of year | windowWidth/Height, componentWidth/Height, density(), fontSize(), timeInHr, timeInMin % 60, dayOfYear (expr.system) | at 10:08 on 28 Oct: 360 × 230, 1.00, 14.0, 10:08, 301 |
| EXP-14 | sun-arc | 4 | Daylight widget: sun on its arc, elapsed daylight, daylight left | clamp-normalised clock, polar arc pathExpression scaled by @t, day/night step mask, "h min" formatting (expr.shaping + expr.trig) | 14:42: sun two thirds along, "3 h 32 min of daylight left" |
| EXP-15 | integer-rating | 3 | Five-star rating bound to an exported integer; tapping the stars cycles 1–5 | integer infix in int-id slots: star `visibility` = `clamp(0, 1, @rating - k)`, label by integer division, `valueIntegerExpressionChange` `@rating % 5 + 1` (expr.integer) | default 4 stars "Great"; rating 1 → "Poor", 3 → "Okay"; tap 4→5, again → 1 |

## ANM — Animations

Expression animation (`{"value": expr, "anim": seconds}`), component animation (`animationSpec`), visibility enter/exit (built-in and `defineVisibilityAnimation`), StateLayout transitions, path morphs and triggered effects. Capability ids `anim.*`. Renders are taken mid-animation (a tap at `t`, then a frame a fraction of a second later).

| ID | name | level | prompt | exercises | check |
| :--- | :--- | :---: | :--- | :--- | :--- |
| ANM-01 | animated-value | 2 | A brightness bar with a knob and Low/Medium/High buttons; a tap makes the bar glide to that level. | `{"value","anim"}` in a canvas `variable`, `valueFloatChange` | Tap High at 0.1 s, render at 0.35 s: bar caught mid-glide (~70 %) |
| ANM-02 | easing-gallery | 3 | Six labelled tracks, one dot each; a tap sends every dot to the other end with a different easing. | `animationSpec` `motionEasing` (all six), spacer `width` expression, `valueFloatExpressionChange` | Tap at 0.1 s, render at 0.5 s: Overshoot and Decelerate lead, Anticipate has barely left |
| ANM-03 | staggered-entrance | 3 | "This week": five reminder rows slide in and fade up one after another when the list appears. | `animationTime()`, `clamp`, `offset`, `graphicsLayer` `alpha`, `wakeIn` with `step` | `duration` 0.75: row 1 in place, rows 2–4 at different stages, row 5 not shown yet |
| ANM-04 | ping-pong-loop | 2 | A "Syncing photos" card: a puck slides back and forth, slowing at each end, over three bouncing dots. | `continuousSec()`, `abs(% 2 - 1)` triangle wave, `smooth_step`, `loop` + phase-shifted `sin` | `clock` 10:00:01: puck about a quarter along the track |
| ANM-05 | animated-resize | 3 | Two order cards; tapping the first expands it to show delivery details and pushes the second down. | `height` expression + `animationSpec` (DECELERATE) on both cards, details `graphicsLayer` alpha `{"value","anim"}` | Tap at 0.1 s, render at 0.2 s: card mostly grown, details fading in, second card moved down |
| ANM-06 | enter-exit | 3 | Three notifications; a tap slides one away to the right before the others close the gap; Restore fades them back in. | `visibility` (int), `animationSpec` `exitAnimation` SLIDE_RIGHT, `exitSequence` BEFORE, `enterSequence` AFTER | Tap row 2 at 0.1 s, render at 0.25 s: row half off to the right (C++ only fades yet) |
| ANM-07 | custom-visibility | 3 | "Show offer" reveals a promo banner that rises and fades in; tapping the banner shrinks and fades it out. | `defineVisibilityAnimation` ×2 (`save`, paint `alpha`, `translate`/`scale`, `drawComponentContent`), `enterFunction`/`exitFunction` | Tap at 0.1 s, render at 0.3 s: rising, half faded (C++ plain fade yet) |
| ANM-08 | state-expand | 4 | A mini player (art, title, play) that expands into a full card when tapped, the album art growing into place. | `stateLayout` `indexId`, shared `id` modifiers, `animationSpec` on the stateLayout, `valueIntegerExpressionChange` | Tap at 0.1 s, render at 0.3 s: mid-morph (C++ wrong yet) |
| ANM-09 | play-pause-morph | 3 | A round play button that morphs into pause when tapped, and back. | `pathTween` with `tween` `{"value":"@playing","anim":0.35}`, op-list `resources.paths`, `drawPath` | Tap at 0.1 s, render at 0.25 s: halfway shape |
| ANM-10 | spring-switch | 3 | Wi-Fi and Bluetooth switches whose thumbs spring across with overshoot while the track fades to blue. | `animationSpec` OVERSHOOT on the thumb, spacer width `@bt * 22`, overlay `graphicsLayer` alpha `{"value","anim"}` | Tap Bluetooth at 0.1 s, render at 0.18 s: thumb past halfway, track half blue |
| ANM-11 | counting-number | 2 | A savings card; tapping "+ $250" makes the balance count up to the new total while the bar grows. | Root `variable` `{"value":"@total","anim":0.9}`, `textFromFloat(round(@shown))` | Tap at 0.1 s, render at 0.4 s: $1364 on the way from $1250 to $1500 |
| ANM-12 | like-pop | 4 | A like heart: a tap fills it, pops it bigger and back, and sends out a ring. | Tap stores `animationTime()` in `@tapAt`; `impulse` with `start` `@tapAt`; scale `sin(πp)(1-p)`; `wakeIn` only during the pop | Tap at 0.2 s, render at 0.35 s: heart filled and enlarged inside a ring |

## STR — Program structure

The format's own runtime structure: loops, conditionals, templates (`definePattern`, inflated by the player), referenced operations, macros, the `global` section. Library components (expand mode, json2rc side) are compared in STR-07. Capability ids `struct.*`.

| ID | name | level | prompt | exercises | check |
| :--- | :--- | :---: | :--- | :--- | :--- |
| STR-01 | month-grid | 3 | October 2026 calendar, Monday first, weekends dimmed, today (29) circled | nested `loop` (week × weekday), day = week*7+wd+1-@firstWeekday, a named variable per iteration, step masks as alpha/radius (struct.loop) | 1 under Thu, 31 under Sat, 29 circled |
| STR-02 | agenda-pairs | 3 | Four meetings as bars on an 8–18 h timeline, now line at 14:00, finished ones dimmed | `loop` with `step` 2 and `until: arrayLength(@meetings)` over flat start/end pairs, stepped hour-axis loop (struct.loop_data) | 4 bars, first two dimmed, "4 meetings" |
| STR-03 | loop-bounds | 2 | Water tracker: 5 of 8 glasses filled, the rest outlined, progress bar, "3 to go" | loop `until: min(@drunk,@goal)`, second loop `from: @drunk until: @goal`, empty ranges instead of if (struct.loop) | 5 filled + 3 outlines; drunk 0 / 9 checked |
| STR-04 | switch-cases | 3 | Weather card switching on a condition code 0–3, with "No data" for any other code | one `eq` block per case, a shared range block (ge 1 ∧ le 3), default as `lt 0` + `gt 3`, `rem` labels (struct.conditional, struct.comment) | code 2 rain; 0/1/3/-1/4 checked |
| STR-05 | pattern-list | 3 | Favourites contact list of 5 names: initial avatar, name, chevron | `definePattern` ContactRow + `patternForEach` over `addDataList` (hoisted with a `global` command), `textSubtext` for the initial (struct.pattern_data, struct.pattern) | 5 rows A, B, C, E, G |
| STR-06 | pattern-slot | 3 | Two dashboard panels in one style, each with its own content | `patternArgument` slot in the template + `patternBlock` at each call (struct.pattern_slot) | two identical frames, different content |
| STR-07 | pattern-vs-component | 4 | The same phone-spec rows built once with definePattern and once with the KeyValueRow library component | runtime template ≈48 B per extra row vs expand-mode component ≈200 B per row; break-even about 2 rows (struct.pattern) | the two cards look the same |
| STR-08 | referenced-include | 3 | Reviewers list, a verified tick after three of the four names, drawn once | root-level `referencedOperations` + `include` ×3 (900 B vs 1163 B written out) (struct.referenced) | 3 ticks, Linus without |
| STR-09 | modifier-macro | 3 | Three pill buttons and two tags styled by two shared style macros | `definePattern` whose body is a `modifier` list + `includeMacro` modifier, with and without arguments (struct.macro) | Save/Share/Delete pills, 2 grey tags |
| STR-10 | global-section | 2 | Steps widget: 74 % ring, 7,420, "2,580 to go" against a 10,000 goal, with shared constants | `global` component (rem, goal, gap) + `{"global":{"commands":[…]}}` hoisting `progress` out of a canvas (struct.global) | ring 74 %, 7,420, 2,580 to go |
| STR-11 | float-function | 3 | Heart-rate line for today (14 readings) with the lowest, highest and latest readings marked by one reusable helper | `createFloatFunction` pin(i, size): `arrayGet`, a ringed dot and a `textFromFloat` label; three `callFloatFunction` calls; a `loop` draws the line (struct.function) | dots labelled 55, 95 and a larger 64 on the last point; C++ and TS match |
| STR-12 ⚠️ | dynamic-list | 3 | A rolling history the document updates itself | `dynamicFloatList`, `setArrayValue`, `updateDynamicFloatList` (struct.dynamic_list) | waits on U21 (a dynamic list can't be read from expressions in Java JSON) |

## VAR — Variables and expressions

| ID | Name | Lvl | Prompt | Exercises | Check |
| :--- | :--- | :---: | :--- | :--- | :--- |
| VAR-01 | named-constants | 1 | A design-token card: corner radius, gap and accent colour from `resources.variables` and `resources.colors`. | `resources.variables`, `resources.colors`, `@name` references | `inspect_variables` lists the tokens |
| VAR-02 | progress-bar | 2 | A progress bar whose fill width is `componentWidth() * @progress`, with progress 0.65. | expressions, `componentWidth()` | The fill is 65% of the track at any width |
| VAR-03 | function-gallery | 3 | Small plots of sin, cos, clamp, lerp, step, fract, abs and pow, each labelled. | `sin`, `cos`, `clamp`, `lerp`, `step`, `fract`, `abs`, `pow`, `loop` | Each curve has its expected shape |
| VAR-04 | conditional-badge | 3 | A temperature reading that shows a red warning badge only when `@temp` > 30. | `conditionalOperations`, comparison | Badge shown at temp 35, hidden at 20 (`variables`) |
| VAR-05 | loop-grid | 2 | A 10×10 grid of dots coloured by their index. | `loop` (nested), index expressions | 100 dots, colour gradient |
| VAR-06 | array-bar-chart | 3 | A bar chart from a 12-value `floatArrays` resource, normalised by `arrayMax`. | `floatArrays`, `arrayGet`, `arrayMax`, `arrayLength`, `loop` | The tallest bar fills the height |
| VAR-07 | spline-curve | 3 | A smooth curve through eight control values, with the control points drawn as dots. | `spline`, `splineLoop`, `floatArrays` | The curve passes through every dot |
| VAR-08 | seeded-scatter | 2 | 200 random dots placed with `rand()` and a fixed seed. | `rand`, `seed` | Two renders with the same `seed` are identical |
| VAR-09 | component-values | 3 | Corner markers and a centred label positioned from the component's measured size. | `componentWidth()`, `componentHeight()`, `ComponentValue` | Correct at 200×200 and at 500×300 |
| VAR-10 ⚠️ 🆕 | float-function | 3 | An easing function defined once and reused by three animations. | `createFloatFunction`, `callFloatFunction` | All three ease identically |
| VAR-11 ⚠️ 🆕 | integer-vars | 3 | An integer counter with integer expressions (modulo, bit masks) shown as text. | `resources.integers`, integer expressions, `textLookupInt` | Text matches the arithmetic |
| VAR-12 ⚠️ | dynamic-list | 3 | A float list the document updates itself (a rolling history). | `dynamicFloatList`, `updateDynamicFloatList`, `setArrayValue` | The history shifts between frames |

## TIM — Time and animation

| ID | Name | Lvl | Prompt | Exercises | Check |
| :--- | :--- | :---: | :--- | :--- | :--- |
| TIM-01 | digital-clock | 2 | HH:MM:SS in large digits, from the clock. | `timeInHr`, `timeInMin`, `timeInSec`, `textFromFloat` | `clock` "10:10:05" shows 10:10:05 |
| TIM-02 | analog-clock | 3 | A round clock face with hour, minute and second hands. | `rotate`, `timeInHr()`, `timeInMin()`, `continuousSec()` | At `clock` 10:10 the hands make the classic V |
| TIM-03 | date-card | 3 | "Wed 28 Oct": weekday and month names from arrays, plus the day of the month. | `weekDay`, `calendarMonth`, `dayOfMonth`, `textLookup` | Correct for `clock` 2026-10-28 |
| TIM-04 | pulse | 2 | A heart that pulses: scale and alpha follow a sine of animation time. | `animationTime()`, `sin`, `scale` | Renders at t=0 and t=0.25 differ |
| TIM-05 ⚠️ 🆕 | easing-gallery | 3 | Eight dots, each animating with a different easing (`LINEAR` … `CUBIC_OVERSHOOT`) when a value changes. | `animationSpec`, easing curves | Different positions mid-animation |
| TIM-06 | impulse-bounce | 3 | A ball dropped at start that bounces three times, then rests. | `impulse`, `impulseProcess` | Moving at t=0.5 s, still at t=5 s; **needs** `duration` (`validate` `needs_frames`) |
| TIM-07 ⚠️ 🆕 | visibility-anim | 3 | A banner that fades and slides in when it becomes visible. | `defineVisibilityAnimation`, `visibility` | Mid-animation frame is partially visible |
| TIM-08 | countdown | 3 | "Launch in 02:14:07", counting down to a fixed date and time. | `offsetToUtc`, `epochSecond`-based math, `textFromFloat` | Correct at a pinned `clock` |
| TIM-09 ⚠️ 🆕 | low-power-update | 3 | A minute-resolution clock that asks to be woken once a minute instead of every frame. | `wakeIn` | `inspect_runtime`: scheduled, not continuous |

## INT — Interaction

| ID | Name | Lvl | Prompt | Exercises | Check |
| :--- | :--- | :---: | :--- | :--- | :--- |
| INT-01 | tap-counter | 2 | A button that increments a displayed counter on each tap. | `onClick`, `valueFloatChange` | `interact` [{target:0},{target:0}]: the counter variable +2 |
| INT-02 | toggle-switch | 3 | An iOS-style switch: a tap toggles it, and the thumb position and track colour follow. | `onClick`, `valueFloatExpressionChange`, expressions | `interact` tap: thumb `x` and colour change |
| INT-03 🆕 | multi-click | 3 | A tile that reacts differently to a tap, a double tap and a long press. | `multiClick` | Taps work; note the TS player only dispatches single taps (`audit` `click_types`) |
| INT-04 | drag-slider | 3 | A horizontal slider (0–100) dragged by its thumb, showing the value. | `touchExpression` (`min`, `max`, `stopMode`), `touchX()` | `interact` drag (50,50)→(250,50): the value rises |
| INT-05 | fling-wheel | 3 | A prize wheel you can fling; it decelerates to a stop. | `touchExpression` with velocity, `touchVelocityX()` | Fast drag, then `wait` 2 s: the rotation changed and settled |
| INT-06 | pager | 4 | Three full-width pages swiped horizontally, snapping to the nearest page, with dot indicators. | `touchExpression` snapping, conditional dots | Swipe left: page 2's dot is active |
| INT-07 | tabs | 3 | Three tabs; tapping one shows its panel and underlines it. | `onClick`, `visibility` or `conditionalOperations` | `interact` tap tab 3: its panel is visible |
| INT-08 ⚠️ 🆕 | pressed-state | 3 | A button that darkens while pressed. | `onTouchDown`, `onTouchUp`, `onTouchCancel` | Pressed frame differs |
| INT-09 ⚠️ ◐ | ripple | 2 | Material buttons with a ripple on tap. | `ripple` | Ripple visible right after the tap |
| INT-10 ⚠️ | click-areas | 3 | An image map: named rectangular areas the host can handle. | `clickArea` | `list_interactions` lists the areas |
| INT-11 ⚠️ 🆕 | haptic-sound | 2 | Buttons that ask the host for haptic feedback or a sound. | `performHaptic`, `playSound` | The actions appear on the click targets |
| INT-12 ⚠️ 🆕 | host-actions | 3 | A "Share" and an "Open" button that send named actions with metadata to the host. | `hostAction`, `hostNamedAction`, `hostMetadataAction` | The actions appear in `list_interactions` |

## HST — Host integration

| ID | Name | Lvl | Prompt | Exercises | Check |
| :--- | :--- | :---: | :--- | :--- | :--- |
| HST-01 | parameterised-card | 2 | A profile card whose name, subtitle, accent colour and progress are host variables, with good defaults. | exported `resources.variables` (string, float, colour) | `render_rc` with `variables` changes all four; the `package_web` playground edits them |
| HST-02 | host-data-chart | 3 | A sparkline from a host-provided float array. | float-array named variable | Different arrays draw different lines |
| HST-03 | battery-gauge | 3 | A battery icon filled to the system battery level, red below 20%. | system variable (battery), conditional colour | `system_variables` {"38": 15} draws a red, nearly empty battery |
| HST-04 | bubble-level | 3 | A spirit level whose bubble follows the accelerometer. | `accelerationX()`, `accelerationY()` | Different `system_variables` move the bubble |
| HST-05 | ambient-dim | 3 | A card that dims and switches to high contrast in low ambient light. | `lightLevel()`, conditional colours | Low light gives a dark render |
| HST-06 | dynamic-colors | 3 | A card using Material dynamic colour roles (`color.system_accent1_…`), so it re-themes with the host's palette. | named system colours, `colors` resources | `inspect_theme` lists the roles; overriding one recolours the card |
| HST-07 | font-scale | 2 | Text and a container sized from the system font scale. | `system.font_size`, `fontSize()` | Larger font scale gives a taller card |
| HST-08 ⚠️ 🆕 | custom-component | 3 | A placeholder the host fills with its own native view (map, video). | `custom` component | Converts; the placeholder has bounds |
| HST-09 ⚠️ 🆕 | data-map | 3 | A transit card showing fields looked up by key in host-provided data. | `dataMapLookup`, `idLookup` | Different data shows different fields |

## A11Y — Accessibility

| ID | Name | Lvl | Prompt | Exercises | Check |
| :--- | :--- | :---: | :--- | :--- | :--- |
| A11Y-01 | labeled-buttons | 2 | A toolbar of icon-only buttons, each with a content description and a button role. | `semantics` (`contentDescription`, role), `onClick` | `inspect_accessibility`: every clickable is labelled; `audit` has no a11y warning |
| A11Y-02 🆕 | state-description | 2 | A toggle that announces "On" or "Off". | `semantics` `stateDescription` | The state appears in the accessibility tree |
| A11Y-03 | document-description | 1 | A chart with a header content description summarising it. | `header.contentDescription` | `document_description` is set |
| A11Y-04 | touch-targets | 2 | Buttons at 48 dp and larger, with small visual icons inside big hit areas. | `size`, `padding`, `onClick` | No `layout_touch_target` finding |

## FX — Particles and physics

| ID | Name | Lvl | Prompt | Exercises | Check |
| :--- | :--- | :---: | :--- | :--- | :--- |
| FX-01 | confetti | 3 | A burst of 150 confetti pieces falling under gravity with random colours and spin. | `createParticles`, `particlesLoop`, `rand` | Needs `duration`; frames differ |
| FX-02 🆕 | snowfall | 3 | Endless snowfall: flakes respawn at the top when they leave the bottom. | `particlesLoop`, `particlesComparison` | Steady density over time |
| FX-03 | tap-fireworks | 4 | Tap anywhere to launch a firework burst at that point. | `onClick`/`touchExpression`, `impulse`, particles | `interact` tap, then `wait` 0.5 s: particle variables changed |
| FX-04 🆕 | bouncing-balls | 3 | Twenty balls bouncing off the walls and floor. | particles, `particlesComparison` (bounds) | Balls stay inside the box over 10 s |
| FX-05 | starfield | 3 | A 3D-feeling starfield zooming outward. | particles, perspective math | Frames differ; stars spread from the centre |

## 3D — 3D

| ID | Name | Lvl | Prompt | Exercises | Check |
| :--- | :--- | :---: | :--- | :--- | :--- |
| 3D-01 | rotating-cube | 2 | A lit cube rotating about its diagonal. | `camera3D`, `lights3D`, `meshPrimitive3D` (cube), `matrix3D`, `drawMesh3D` | Shaded faces; frames differ |
| 3D-02 | primitive-gallery | 3 | A 5×5 grid of the 23 mesh primitives with labels. | `meshPrimitive3D` (all) | Every primitive renders |
| 3D-03 | surface-plot | 3 | z = sin(x)·cos(y) as a shaded surface (see `samples/3d/02_surface.json`). | `meshExpression3D` | A smooth surface |
| 3D-04 | textured-sphere | 3 | A globe: a sphere textured with an embedded equirectangular image, spinning. | `texture3D`, `resources.bitmaps` | The texture wraps correctly |
| 3D-05 ◐ | materials-lights | 3 | Three spheres with different materials under a moving directional light. | `material3D`, `lights3D` (directional) | Specular highlights move |
| 3D-06 | orbit-camera | 4 | A model you orbit by dragging. | `touchExpression` → `camera3D` | `interact` drag changes the camera variables |
| 3D-07 | 3d-bar-chart | 4 | A 3D bar chart from a data array, with axes (see `samples/3d/04_bars.json`). | `meshPrimitive3D`, `loop`, `floatArrays` | Bar heights match the data |
| 3D-08 | depth-layers | 3 | Overlapping translucent meshes with depth bias and depth clearing. | `depthBias3D`, `clearDepth3D` | No z-fighting |

## RU — Reuse and composition

These samples use the format's own reuse operations directly. The component library
([Component templates](#component-templates)) is built on top of `definePattern`, and its
`pattern` mode doubles as the conformance test for these.

| ID | Name | Lvl | Prompt | Exercises | Check |
| :--- | :--- | :---: | :--- | :--- | :--- |
| RU-01 | global-section | 2 | Shared constants and colours declared once in a `global` section and used throughout. | `global`, `resources` | Converts; resources hoisted |
| RU-02 ⚠️ 🆕 | pattern-list | 3 | A contact list built from one row pattern applied to a data list. | `definePattern`, `patternForEach`, `patternArgument` | N rows from one definition |
| RU-03 ⚠️ ◐ | include-macro | 3 | A reusable button macro included three times with different labels. | `include`, `includeMacro` | Three identical-looking buttons |
| RU-04 ⚠️ ◐ | referenced-ops | 3 | A complex drawing recorded once and replayed in several places. | `referencedOperations` | Replays match the original |
| RU-05 | pattern-counter | 3 | Three counter buttons from one `definePattern` with a `locals` tap counter, so each instance counts its own taps. | `definePattern` (`parameters`, `locals`), pattern call by name | Each button's counter moves alone; byte-identical to the Java parser |

## CMP — Component galleries

One gallery per library component ([Component templates](#component-templates)). Each
shows every variant and state of the component, with labels. Each is checked in `expand`
mode, then compared in `pattern` mode.

| ID | Name | Lvl | Prompt | Exercises | Check |
| :--- | :--- | :---: | :--- | :--- | :--- |
| CMP-01 | button-gallery | 2 | `Button` in filled, outlined and text styles, each enabled and disabled, with and without an icon; the last one tapped is shown. | `Button`, `input.tap` | `interact` on each enabled button changes "last tapped"; disabled ones do nothing |
| CMP-02 | toggles-gallery | 2 | `Switch` and `Checkbox`, off and on, each driving a status line. | `Switch`, `Checkbox` | Each tap flips its variable; `stateDescription` follows |
| CMP-03 | slider-gallery | 3 | Three `Slider`s (0–1, 0–100, −50–50) with their values shown. | `Slider` | Drags change each value within its range |
| CMP-04 | chips-badges | 2 | A `flow` of `Chip`s, two selected, and `Badge`s with 1, 12 and 999+ counts. | `Chip`, `Badge` | Chip taps toggle selection; badges fit their text |
| CMP-05 | cards-list | 3 | A `TopBar` over a scrolling list of `ListItem`s (avatar, two lines, trailing chevron) inside `Card`s, with `Divider`s. | `TopBar`, `Card`, `ListItem`, `Avatar`, `Divider` | Scrolls; every item is labelled |
| CMP-06 | tabs-pager | 3 | `Tabs` switching three panels, and `PagerDots` following the selection. | `Tabs`, `PagerDots` | Tapping a tab changes the panel and the dot |
| CMP-07 | progress-gallery | 2 | `ProgressBar` and `ProgressRing` at 0, 33, 66 and 100%, plus `Skeleton` rows shimmering. | `ProgressBar`, `ProgressRing`, `Skeleton` | Proportions match; renders at t=0 and t=1 differ for the skeleton |
| CMP-08 | gauges-stats | 3 | `Gauge`s with green/amber/red zones at three values, and `StatTile`s with positive and negative deltas. | `Gauge`, `StatTile` | Zone colours and delta colours follow the values (`variables`) |
| CMP-09 | charts-gallery | 3 | `Sparkline`, `BarChart` and `DonutChart` from the same 8-value dataset. | `Sparkline`, `BarChart`, `DonutChart` | All three change with a different dataset |
| CMP-10 | time-gallery | 2 | `AnalogClock` (with and without seconds), `DigitalClock` 12/24 h, and `DateLabel` formats. | `AnalogClock`, `DigitalClock`, `DateLabel` | Correct at `clock` 2026-10-28T10:10:05 |
| CMP-11 | status-gallery | 2 | `WeatherIcon` (every condition), `BatteryIndicator` (95, 40, 10%), and `Banner` (info, warn, error). | `WeatherIcon`, `BatteryIndicator`, `Banner` | Battery colour follows `system_variables`; every icon is distinct |
| CMP-12 | form-rows | 2 | A settings screen of `KeyValueRow`s and a `Stepper`. | `KeyValueRow`, `Stepper` | The stepper clamps at its min and max |
| CMP-13 | themed-library | 3 | CMP-01, CMP-02 and CMP-08 together, rendered with the default theme and with an overridden one (a brand palette and larger radii). | theme tokens | Every component picks up the override; nothing hard-codes a colour |
| CMP-14 | nested-components | 3 | A `Card` whose content slot holds a `ListItem` whose trailing slot holds a `Switch`. | slots, `uses` | Expands without collisions; each `Switch` keeps its own state |

## THM — Theme and density

| ID | Name | Lvl | Prompt | Exercises | Check |
| :--- | :--- | :---: | :--- | :--- | :--- |
| THM-01 | light-dark | 2 | A card with distinct light- and dark-theme colours. | theme sections / themed colours | `render_rc` `theme` light vs dark differ appropriately |
| THM-02 | palette-swatches | 2 | A swatch board of every colour role the document uses, labelled. | `resources.colors`, named colours | `inspect_theme` matches the swatches |
| THM-03 | density-sweep | 2 | A layout checked at densities 1, 2 and 3 for identical proportions. | dp sizes, `density()` | Proportions identical across renders |

What the component library already covers (2026-10-29): every library component and CMP
gallery is themed. The theme colours are themed `{light, dark}` colours (Java's
addThemedColor), and each demo is rendered and Java-checked in light, dark and mono
(`meta.check.renders`, giving render-light/dark/mono.png). That exercises THM-01's mechanism
across 30 documents, and checks it in C++ with `--theme`. THM-01 is still worth building as a
small hand-written example of the raw form: `{"light", "dark"}`, the `@colors.x` pair form,
and `lightName`/`darkName`. It also needs json2rc support for themed colours (J34, a patch is
ready). The TS player doesn't switch text colours (T26). Monochrome (always-on display,
e-ink) has no format support: `PROFILE_LOW_POWER` is unread. It is the library's
`"componentTheme": "mono"` build mode. A THM-04 `mono-variant` example (one document built in
both auto and mono) could teach it outside the library.

---

## SHW — Showcases (composites)

Complete artifacts that combine families. Each lists the families it draws on.

| ID | Name | Lvl | Prompt | Draws on | Check |
| :--- | :--- | :---: | :--- | :--- | :--- |
| SHW-01 | weather-widget | 5 | A 4×2 weather widget: city, current temperature, a condition icon drawn with paths, high/low, and a six-hour forecast row. All values are host variables; it adapts from 4×2 to 2×2 by dropping the forecast. | LAY, TXT, DRW, HST, (LAY-13 ⚠️ for the collapse) | Renders at 360×180 and 180×180; `variables` change the values |
| SHW-02 | calendar-month | 5 | A month calendar widget: weekday header, a 6×7 day grid computed from the clock, today highlighted, weekends dimmed. | VAR (loops, date math), TIM, TXT | `clock` 2026-10-28: October 2026, 28 highlighted |
| SHW-03 | fitness-rings | 5 | Three concentric activity rings (move, exercise, stand) with animated progress to host values, and totals in the centre. | DRW (arcs), TIM (easing), HST | Ring sweeps match the values after the animation settles |
| SHW-04 | watch-face | 5 | A 227×227 round watch face: analog hands, a date complication, a battery arc, and steps from a host variable. | TIM, DRW, HST, TXT | `clock` 10:10; `system_variables` battery 15 shows a red arc |
| SHW-05 | music-player | 5 | A now-playing card: artwork, a marquee title, a draggable progress slider, play/pause toggle, and skip buttons. | INT, TXT (TXT-11 ⚠️), IMG ⚠️, HST | `interact`: play toggles; dragging the slider changes the position |
| SHW-06 | stock-list | 5 | A scrolling watchlist: symbol, price, change in green or red, and a sparkline from each row's data. | LAY (scroll), VAR (arrays), DRW (paths), HST | Colours follow the sign of the change; the list scrolls |
| SHW-07 | onboarding-pager | 5 | Three onboarding pages with illustrations drawn from paths, swipe navigation, an animated dot indicator, and a "Get started" button on the last page. | INT-06, DRW, TIM | Swiping twice reaches page 3, where the button is visible |
| SHW-08 | smart-home | 5 | A dashboard of room tiles with toggles (lights), a thermostat dial (drag), and a scene selector (tabs). | INT, DRW, LAY, A11Y | All controls labelled; `interact` changes each |
| SHW-09 | charts-dashboard | 5 | Line, bar, pie and donut charts from host data arrays, with legends and axis labels. | VAR (arrays), DRW, TXT, HST | Charts match the data at two datasets |
| SHW-10 | orbit-catcher | 5 | An original tap game: a dot orbits a planet and each tap flips its orbit direction to catch passing stars, with a score counter and a game-over state. | INT, TIM, VAR, FX | `interact` taps change the direction variable; the score text updates |
| SHW-11 ⚠️ | loading-states | 4 | A card with a shimmering skeleton while `@loaded` is 0, cross-fading to the content when it becomes 1. | LAY-15 ⚠️, DRW (gradient), TIM | `variables` {"loaded": 1} shows the content |
| SHW-12 | generative-art | 4 | An evolving piece combining an AGSL background, particles and a time-driven path. | DRW-14, FX, TIM | Renders at different clocks differ; both engines agree |
| SHW-13 | departure-board | 5 | A transit board: the next five departures, countdowns, a "Due" state when under a minute, and a platform column. | TIM-08, TXT-10, VAR-04, HST | Correct at a pinned clock with host data |
| SHW-14 | habit-tracker | 4 | A 7-day habit strip: tap a day to mark it, with a streak count computed from the marks. | INT-01, VAR, TXT | Taps change the streak |

## DX — Diagnostic fixtures (deliberately flawed)

Documents that should trigger one specific finding, for testing `validate`, `audit` and
the tools that rely on them. Each one should trigger its target finding and nothing else.

| ID | Name | Lvl | Prompt | Target finding | Check |
| :--- | :--- | :---: | :--- | :--- | :--- |
| DX-01 | overflow | 2 | A 300×200 document with a 400 dp wide fixed child, not in a scroll container. | `audit` `layout_overflow` | The finding names the child |
| DX-02 | zero-size-content | 2 | A text inside a box with height 0. | `audit` `layout_zero_size` | Fires once |
| DX-03 | dead-expressions | 2 | A chain of three expressions whose result nothing reads. | `audit` `dead_code` | Lists the three ops |
| DX-04 | unlabeled-clickables | 2 | Three icon buttons with `onClick` and no semantics. | `audit` `a11y_no_semantics` | Fires with three examples |
| DX-05 | needless-repaint | 2 | A static card that reads `animationTime()` in an expression with no visible effect. | `audit` `repaint_continuous` | The cause is the animation-time read |
| DX-06 | single-frame-particles | 2 | A particle burst rendered without `duration`. | `validate` `needs_frames` | Fires; with `duration` it doesn't |
| DX-07 | missing-fonts | 1 | Text in a document checked on a machine with no fonts. | `validate` `no_fonts` | Environment test |
| DX-08 | blank | 1 | Content drawn entirely outside the canvas. | `validate` `blank` | Fires |
| DX-09 | small-touch-target | 1 | A 24×24 dp clickable icon. | `audit` `layout_touch_target` | Fires |
| DX-10 | truncated | 1 | DOC-01 with its last 40 bytes cut off (an `.rc`, not JSON). | `validate` `parse_read_past_end` | Fires with the byte offset |

---

## Coverage

Coverage is the point of the corpus, so track it per feature rather than per sample. A
first pass of the samples above covers:

- **Layout:** every component json2rc converts (`column`, `row`, `box`, `canvas`, `text`,
  `spacer`, `flow`, `fitBox`) and every one it doesn't (`collapsibleRow`,
  `collapsibleColumn`, `stateLayout`, `custom`, patterns).
- **Modifiers:** sizing, padding, offset, background, border, clip, the scrolls, visibility,
  weights, `onClick`, `multiClick` and semantics; plus the ones json2rc lacks (`zIndex`,
  `ripple`, `marquee`, touch-down/up/cancel, graphics layer, `animationSpec`, host actions).
- **Drawing:** every primitive, path construction form, paint property and gradient, and
  shaders.
- **Expressions:** the operator and function families, arrays and splines, conditionals,
  loops, `rand` with a seed, component values, and time and system variables (time, date,
  touch, sensors, battery, light, font scale).
- **Engines:** particles, impulses, 3D, and the interaction dispatch paths (click, touch,
  scroll, multi-click).

**Gaps to fill once the converter supports them:** graphics layer
(`graphicsLayer`/`translationX`/`scaleX`/`rotationZ`), `layoutCompute`, `drawWithContent`,
`dimensionConstraints`, `textSubtext`/`textTransform`, `matrixFromPath`/`matrixMultiply`, and
`drawComponentToBitmap`. Add a sample for each one json2rc gains, in its family.

The 🆕 marks are the generation priority: 34 samples whose feature has no example anywhere
in the corpus. The ⚠️ marks double as a work list for json2rc: as of 2026-10-29, 38 of the 163 samples
need features the TypeScript converter doesn't have yet.
