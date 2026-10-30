# MCP servers

**Use `remotecompose-server.mjs`: one server for everything.** It imports the single-purpose
servers below and regroups their tools into eleven, with one workflow in its instructions
(deployed at `https://DOMAIN/mcp`, which also serves the example gallery and published pages
at the domain root):

| tool | what | from |
| :--- | :--- | :--- |
| `build_kit` | start here: components, examples, design rules and `needs_component` for a goal | rc-examples |
| `find` (`kind`: examples, components, icons, capabilities, terms) | search the catalog and the 4,157 Material Symbols icons (drawn with the `Icon` component) | rc-examples |
| `get` | one example (by id) or component (by name) | rc-examples |
| `check_component` | lint, expand, render, size and `sweep` a component you write | rc-examples |
| `convert` (`check`, `expanded`) | JSON to .rc; validate it; or show the expanded JSON | json2rc, rc-render, rc-examples |
| `render` | render a document to PNG (states, sizes, themes, touch) | rc-render |
| `audit` | problems and design issues, each naming the fix | rc-inspect |
| `inspect` (`task`: summary, layout, variables, interact, ...) | answer a question about a document | rc-inspect |
| `publish`, `pages` | package as a web page; list or unpublish pages | rc-deploy |
| `reference` (`topic`: workflow, components, tools) | the workflow, the authoring guide, every tool's schema | all |

Six single-purpose [MCP](https://modelcontextprotocol.io) servers (the front door's building
blocks, still served on their own). Over stdio they're registered for
this repo in `../.mcp.json`. Over HTTP they're meant for a VPS (see below). Both are plain
Node (18+) with no dependencies, so they run from a bare checkout on macOS or Linux.

| server | tool | wraps |
| :--- | :--- | :--- |
| `json2rc-server.mjs` | `json2rc` | the TypeScript converter in `players/typescript/build-json2rc` |
| `rc-render-server.mjs` | `render_rc`, `validate` | the C++/Skia headless renderer `players/cpp/tools/rc2image` |
| `inspect-server.mjs` | `inspect_summary`, `audit`, `list_operations`, `get_operation`, `inspect_layout`, `inspect_structure`, `inspect_variables`, `inspect_bytes`, `inspect_accessibility`, `list_interactions`, `interact`, `inspect_runtime`, `inspect_theme` | the inspector's analysis code (`inspector/src/panels`) on the TypeScript player, headless in Node |
| `deploy-server.mjs` | `package_web`, `list_pages`, `unpublish_page` | the TypeScript web player (`players/typescript`), bundled with esbuild |
| `examples-server.mjs` | `build_kit`, `find_examples`, `get_example`, `find_components`, `get_component`, `expand_components`, `resolve_terms`, `list_capabilities` | the example catalog (`examples/catalog.json`, built by `examples/tools/build.mjs`), its vocabulary (`docs/examples-vocabulary.json`) and the component library (`examples/components`) |
| `guide-server.mjs` | `overview`, `describe` | the other servers' own definitions: the single entry point |

**Start with `rc-guide`.** `overview` explains what each server does, when to use it (and
when not), how to connect, and which tool fits each common task. `describe` gives every
option of a server or tool, with examples (`format: "json"` returns the raw schemas). The
guide imports the servers' definitions rather than keeping a copy, so its option lists are
the schemas the servers actually accept. To add a server, export its `definition` with a
`guide` block and list it in `SERVERS` in `guide-server.mjs`. On a deployment,
`MCP_PUBLIC_BASE_URL` makes the guide show the remote endpoints.

## Logs: retracing a session

Every tool call logs one line (stderr; `journalctl` on the VPS) with a short client id (a hash of
the caller's address and user agent, never the token), what was asked and what came back:

```
initialize {"client":"bb4cde","clientInfo":{"name":"…","version":"…"},"ua":"…"}
build_kit ok 228ms {"client":"bb4cde","args":{"goal":"…the user's prompt…"},"result":{"examples":["TIM-12","EXP-14"],"layout_model":"TIM-12","components":["Icon"],"icons":["wb_twilight"],"unmatched":["sunset"]}}
render ok 35ms {"client":"bb4cde","args":{"json":{"bytes":515,"sha":"bdfa1028"}},"result":{"images":1,"design_warnings":["fixed_coordinates","text_anchor"]}}
```

Prompts and queries are logged in full; documents only as size and hash (the same `sha` across
calls is the same document). `MCP_LOG_CALLS=0` keeps only the `<tool> ok <ms>` part.

```sh
journalctl -u rcmcp@remotecompose --since today | grep -E ' (ok|error) |initialize'   # a day's calls
journalctl -u rcmcp@remotecompose --since today | grep '"client":"bb4cde"'          # one client's session
```

## Setup (local)

The renderer needs `rc2image` built (`players/cpp`, see its BUILDING.md). On Linux the
configure step wants the same packages CI uses, even for a tools-only build — the prebuilt
Skia links against X11/GL, though rendering itself is CPU-only and needs no display:

```sh
sudo apt install cmake git pkg-config build-essential libfontconfig1-dev libfreetype-dev \
     libgl1-mesa-dev libglfw3-dev libx11-dev libxext-dev libxrender-dev fonts-dejavu-core
cd players/cpp
cmake -B build -DCMAKE_BUILD_TYPE=Release -DRCX_BUILD_APPS=OFF -DRCX_BUILD_TESTS=OFF
cmake --build build --target rc2image -j
```

Install at least one font: without one, Skia draws text as nothing and says nothing.

`RC2IMAGE` overrides the binary path (default `players/cpp/build/tools/rc2image/rc2image`,
then `rc2image` on PATH). `JSON2RC_DIR` overrides the converter folder; after changing
the converter sources, refresh it with `players/typescript/src/json2rc/build.sh`.

## Remote (HTTP on a VPS)

Each server also speaks MCP's Streamable HTTP transport with `--http [PORT]`. It's
stateless and answers each POST with plain JSON, without SSE. On a Debian/Ubuntu VPS,
from a checkout:

```sh
sudo mcp/deploy/setup.sh mcp.example.com
```

The domain's DNS has to point at the VPS, with ports 80 and 443 open. The script installs
the packages, builds `rc2image` under `/opt/remotecompose-experiments`, and sets up five
systemd services, `rcmcp@json2rc`, `rcmcp@rc-render`, `rcmcp@guide`, `rcmcp@deploy` and
`rcmcp@inspect`. All of them run as an unprivileged
`rcmcp` user and listen on 127.0.0.1 only. Caddy sits in front and provides TLS. The
script prints the token and the endpoints:

```
https://mcp.example.com/guide/mcp
https://mcp.example.com/deploy/mcp
https://mcp.example.com/inspect/mcp
https://mcp.example.com/json2rc/mcp
https://mcp.example.com/rc-render/mcp
```

Run the script again after `git pull` to update. It keeps the token.

**Connecting.** In Claude Code:

```sh
claude mcp add --transport http rc-render https://mcp.example.com/rc-render/mcp \
    --header "Authorization: Bearer $TOKEN"
```

Some clients only accept a URL, such as claude.ai's custom-connector form. For those,
the token can go in the path instead: `https://mcp.example.com/rc-render/mcp/$TOKEN`.
Anyone who has that URL can use the server, so treat it like a password.

**What HTTP mode enforces:**
- **Token.** `MCP_TOKEN` is required and must be at least 24 characters. Without one the
  server refuses to start, unless `MCP_ALLOW_NO_AUTH=1` is set.
- **Workspace.** `MCP_ROOT` is required. Every path a tool takes is resolved inside it,
  and anything that leads outside it (`..`, an absolute path, a symlink) is refused.
  Paths you get back are relative to it.
- **Generated files.** Files nobody named go to `MCP_ROOT/out/` and are pruned after
  `MCP_OUT_TTL_HOURS` (24 by default).
- **Render limits.** At most `MCP_MAX_RENDERS` renders run at once (2 by default). Each
  one is killed after 120 s.
- **Origin.** If `MCP_ALLOWED_ORIGINS` is set, any request whose `Origin` isn't listed
  is refused.
- **Health check.** `GET /healthz` answers without auth.
- **Logs.** One line per tool call: `journalctl -u 'rcmcp@*' -f`.

Over HTTP you don't need paths at all. `render_rc` takes `json`, `json_path` or `rc_base64`
directly and returns the PNG inline. `json2rc` → `render_rc` by `rc_path` also works,
because both servers share the workspace.

Known gap: an `.rc` that embeds a sub-document (`rc:<file>`) is resolved by `rc2image`
relative to the document's folder, and that lookup isn't confined to the workspace. Such
a file could only be parsed as a document; nothing outside the workspace is written or
returned.

## Components and the example catalog

Any tool that takes JSON (json2rc, render_rc, validate, every rc-inspect tool, package_web)
accepts **library component calls**, `{"Button": {"label": "Save", "onClick": {...}}}`, and
expands them first (`lib/components.mjs`; the components are `examples/components/<Name>/component.json`,
their syntax is described at the top of that file). `rc-examples.expand_components` shows the
plain JSON a document becomes.

**Two ways to the wire.** A top-level `"componentMode"` picks how calls are compiled (one call
can override it with `"componentMode"` in its args):
- `"expand"`: every call is replaced by its body.
- `"pattern"`: each call that can be becomes a `definePattern` template, written once at the
  head of a root array, plus a call of it. Numbers, `@variable`s, texts and colours are
  pattern arguments; enum/static/bool params, `$if`/`$each`/`$count`, theme numbers and
  actions are resolved per call, so each static combination used is one template
  (`Button__outlined_icon`). Slots are `patternArgument`/`patternBlock`, per-call state is a
  pattern local.
- `"auto"` (default): a variant used two or more times becomes a pattern when the converted
  document is smaller that way; both forms are converted and measured.

Templates are only used where every player renders them like the expansion. A text component
in a template (U7), a canvas command reading a parameter, local or expression (T22, C35),
`graphicsLayer` on a parameter (C35, C++) and a colour parameter outside `background` (U22)
either write the value into the template or expand the call (`PATTERN_TRAPS` in
components.mjs). Until those are fixed, labelled components (Button, Chip, Card, ...) stay
expanded and auto picks templates for repeated label-free pieces (Divider in CMP-05 and
CMP-12). `expand_components` returns a `report` (per variant: mode, template name, calls,
reason, measured bytes) and `modes` (per component); the build records them in
`meta.derived.component_modes` / `component_patterns`.

Inside a component's `body`, besides `@param`, `$slot`, `$if`, `@colors.*` and `@theme.*`:
- `"locals"` names values private to each call. A number is per-call state (a variable of its
  own). An expression (`"frac": "@value / @max"`, or a `{"$if"}` choosing one) is computed once
  per call: it becomes one float expression in `resources.variables` that every `@frac` in the
  body reads, or a literal when the arguments are static numbers. `{"$count": "labels"}` is the
  length of a list param. Gauge, StatTile and Tabs use them.
- A `string` param is text: `"Decrease @label"` gives `"Decrease guests"` (in an expression, a
  non-trivial value is parenthesised instead).
- `{"$each": "labels", "as": "label", "index": "i", "count": "n", "do": ...}` repeats over a
  static list, with `@n` the number of items.

**Light, dark and mono.** A top-level `"componentTheme"` picks the look (removed before
conversion; `expand_components` takes it as `theme`):
- `"auto"` (default): every theme colour is a themed `{"light", "dark"}` colour, and the
  player picks the side from the system theme (`render_rc` `theme`, `rc2image --theme`, the
  playground's look control). Each themed colour costs about 100 B more than a plain one; the
  component demos grew by 30% on average, from 55.8 KB to 72.3 KB in total.
- `"light"` / `"dark"`: that palette only, as plain colours. `"dark"` writes exactly what the
  library wrote before themed colours.
- `"mono"`: light on black, for always-on displays and OLED. It uses black, white and one
  grey, and each component draws its `{"$if": "theme.mono"}` variant: state is shown by shape,
  large surfaces are outlined, and strokes are thin. Animations are removed, and the clocks
  drop their seconds. There is no mono mode in the format: `PROFILE_LOW_POWER` is declared but
  nothing reads it.
- `"mono-inverted"`: the same variants dark on white, for e-ink and other reflective
  displays: the theme's `modes.mono-inverted` palette (white, black, grey `#616161`), so a
  watch's always-on button (white outline and text on black) is the e-ink button (black on
  white) without a change to any component.

A document re-themes by defining a theme colour itself, with a plain value or `{light, dark}`,
optionally with a `mono` and a `mono-inverted` value. `docs/COMPONENT_AUTHORING.md` has the
mono rules.

A document can also **define its own components** under a top-level `components` object
(`{"components": {"PriceTag": {"params": ..., "body": ...}}, "root": ...}`); they are called
the same way and win over a library component of the same name. `docs/COMPONENT_AUTHORING.md`
(also served by `rc-examples.component_authoring_guide`) explains how to write one, and
`rc-examples.check_component` lints a definition, expands a call, converts it, renders it and
reports the bytes and the bytes each extra instance costs in both modes (`modes.expand`,
`modes.pattern`, with the reason when a call can't be a template), and the bytes per theme
(`themes`). It renders the call four times: light, dark, mono and mono-inverted.

Each library component folder also holds a demo, built like an example: `doc.json` (a
document calling it), `meta.json`, and the built `doc.expanded.json`, `doc.rc` and `render.png`
(`node examples/tools/build.mjs <Name> --java`, or `components` for all of them). Its
`meta.check.renders` adds `render-light.png`, `render-dark.png`, `render-mono.png` and
`render-mono-inverted.png`. Each mono render converts its own expansion
(`doc.mono.expanded.json`, `doc.mono.rc`; `doc.mono-inverted.*`), with its own Java byte check. Any example can list renders this way: an entry is render_rc arguments, plus
`componentTheme` for a document of its own. `get_component` returns the demo and all of its
renders.

`rc-examples` answers "how do I build this": `build_kit({goal})` returns the components that
fit and the smallest set of catalog examples covering the rest, each with the JSON snippet
that shows each capability and the pitfalls found while verifying it. Every catalog example
converts byte-identically with the Java reference parser (`examples/tools/build.mjs --java`),
renders, and passes the audit; `docs/EXAMPLES_FINDINGS.md` lists what building them uncovered.

Over HTTP, rc-examples also serves public pages (no token; the catalog is public content):
`<base>/` is every example as a grid of renders, `<base>/components/` every component, and
clicking one opens `<base>/play/<id>/`, the deploy server's playground for that document
(`lib/examples-web.mjs`; also `<base>/img/<id>.png` and `<base>/json/<id>.json`). A card with
other renders shows them as a light / dark / mono / mono-inverted strip, and a menu switches
every card. The strip opens the playground in that theme (`#t=light`), or at
`<base>/play/<id>/mono/` (`mono-inverted/`) for a mono document (`<base>/img/<id>/mono.png`,
`<base>/json/<id>.mono.expanded.json`). In these playgrounds the look control has two more
segments, **Mono** and **Mono inverted**, which go to the variant's page (only when the
example has it; `#t=mono` on the main page goes there too), and the **JSON** buttons show
`doc.json`, the **Expanded JSON** (`doc.expanded.json`, when the document calls components)
and, on a variant's page, its expansion. On the VPS `<base>` is `https://DOMAIN/examples`.

## `json2rc`

`json` (object or string) **or** `input_path`, plus optional `output_path`, `base_dir`
(where `{"file": ...}` bitmaps resolve) and `include_base64`. Returns `{rc_path, bytes}`,
plus `rc_base64` if you asked for it. Unsupported constructs
are an error naming the construct, never an approximation.

## `render_rc`

Returns one PNG (as an image, and written to `output_path` or a temp file).

| option | meaning |
| :--- | :--- |
| `rc_path` / `rc_base64` | a binary `.rc` document |
| `json` / `json_path` | a RemoteCompose JSON document, inline or as a file, converted with json2rc in-process first |
| `base_dir` | for JSON input: where `{"file": ...}` bitmaps resolve (default: `json_path`'s folder) |
| `width`, `height` | layout size the document sees (default: its own) |
| `output_width`, `output_height` | PNG resolution; the document is scaled to fit, centred |
| `density` | display density, dpi/160 (the `DENSITY` variable; font size follows) |
| `theme` | `light` or `dark` (default dark) |
| `clock` | `"HH:MM[:SS]"`, `"YYYY-MM-DD"`, `"YYYY-MM-DDTHH:MM[:SS]"` or epoch ms |
| `variables` | `{name: value}` for the document's NAMED_VARIABLEs; parsed per declared type (number, `#AARRGGBB` colour, string, number array) |
| `system_variables` | `{id: float}` raw-id overrides, e.g. `{"38": 15}` battery level |
| `touch_events` | `[{t, type: down\|move\|up\|tap, x, y, vx?, vy?}]`, document coordinates |
| `duration`, `fps` | frame-by-frame simulation length (default with events: last `t` + 0.5 s) and rate (60) |
| `animation_time` | pin animationTime for a single-frame render (not with simulation) |
| `seed` | pin `rand()` |
| `background` | `transparent` or `AARRGGBB` clear colour |

With `touch_events` or `duration`, the document runs frame by frame **with the clock
advancing**, so animation time, its delta and the wall clock agree, and a fling's easing
plays out. The captured last frame is at `clock` (or now). `up` dispatches touchUp and then
onClick, as the desktop viewer does on release. Without `vx`/`vy` the release velocity is
measured from the previous event.

The same options exist as `rc2image` flags (`--density`, `--theme`, `--var`, `--var-id`,
`--events`, `--duration`, `--fps`); run it with no arguments for the full usage.

**Image links.** Every render is returned as an MCP image block. Some clients (ChatGPT)
can't display those, so in HTTP mode with `MCP_PUBLIC_URL` set (setup.sh sets it to
`https://DOMAIN/rc-render`), the result also carries `image_url`. That's a public link to
the PNG at `MCP_PUBLIC_URL/images/<id>.png` with a 128-bit random id and no token. It
expires after `MCP_IMAGE_TTL_HOURS` (default 24). Pass `public_link: false` to skip it.

Every render also comes back with **findings**, the sanity checks listed under `validate`
below. Look at them before trusting the picture.

## `validate`

`validate` checks a document without returning an image. It takes the same document
inputs (`rc_path` / `rc_base64` / `json` / `json_path`) and the same render options as
`render_rc`, plus:
- `render` (default true): set it to false to stop after parsing and the data pass.
- `include_image`: also return the PNG from the sanity render.

It returns JSON:

| field | what |
| :--- | :--- |
| `ok` | false if any finding is an error |
| `findings` | `[{level: error\|warning\|info, code, message}]` |
| `conversion` | for JSON input: whether json2rc converted it, and the converter's error if not |
| `parse` | whether the engine parsed the `.rc`; on failure, `kind`, byte `offset`, `opcode` and `lastGoodOp` |
| `header`, `ops` | the document's size; operation counts, total and by name |
| `namedVariables` | `{name, id, type, value}`: what `variables` can set, with initial values |
| `features` | text, particles/impulses (`frameDriven`), touch, click targets, 3D |
| `fonts` | how many font families the renderer found |
| `render` | pixel stats: fraction differing from the background, distinct colours, content bounds |

Findings:

| code | level | meaning |
| :--- | :--- | :--- |
| `conversion_failed` | error | json2rc rejected the JSON (syntax error or unsupported construct) |
| `parse_unknown_opcode` / `parse_read_past_end` | error | the `.rc` doesn't parse, with where it fails |
| `render_failed` | error | rc2image refused the options, e.g. an unknown variable name |
| `no_fonts` | error | the document draws text but the server has no fonts |
| `blank` / `solid` / `nearly_blank` | warning | the image is all background, one colour, or under 0.1% changed |
| `needs_frames` | warning | particles/impulses rendered as a single frame; pass `duration` |
| `empty_document`, `no_size` | warning | no content operations; no size in the header |
| `taps_missed` | warning | taps were sent and none hit a click target |
| `renderer` | warning | a warning from rc2image itself, e.g. `move` with no `down` |
| `interactive`, `host_variables`, `small_content` | info | context (`render_rc` leaves info findings out) |

rc2image does the measuring itself (`--report FILE|-`, `--check`), and `lib/analysis.mjs`
decides what counts as suspicious, so thresholds can change without a rebuild.

## rc-inspect

`inspect-server.mjs` is the [inspector](../inspector/README.md) without its UI. It runs the
inspector's own analysis functions (`inspector/src/panels`) on the TypeScript player,
headless in Node. No browser is needed: `lib/inspector-env.mjs` provides the few browser
APIs the panels and the player touch. Every tool takes a document the same way as the
other servers (`rc_path`, `rc_base64`, `json`, `json_path`; JSON is converted with json2rc
first), plus these view options:

| option | meaning |
| :--- | :--- |
| `width`, `height` | layout size in dp (default: the document's declared size). Re-run at other sizes to see how the document responds |
| `density` | layout space is `width × density` pixels; default 1, so coordinates are dp |
| `theme` | `light` or `dark` |
| `clock` | as for `render_rc`. Default: the time of the call. Pinned either way; frames advance it |
| `variables` | host variables to set first |

| tool | what it returns |
| :--- | :--- |
| `inspect_summary` | the overview: header, operation counts, byte categories, component tree size, variable statistics, host variables, interaction targets, accessibility, theme, repaint verdict, audit counts and top findings |
| `audit` | findings with severity, code, explanation and examples (component ids and bounds, or op indices), listed below |
| `list_operations` | the disassembly: index, name, opcode, byte offset and size, decoded parameters, expression formulas. Filters: `filter` (regex), `from`/`to`, `references` (a variable id). Paged with `offset`/`limit` |
| `get_operation` | one op by `index`: parameters, variables read and written, the ops that read its output, formula and value |
| `inspect_layout` | the laid-out tree with bounds, padding, modifiers, text and visibility, as an outline (default) or JSON (`format`), plus layout diagnostics. `max_depth` collapses deeper components |
| `inspect_structure` | the document decompiled to a component tree with modifiers (the inspector's JSON view) |
| `inspect_variables` | every variable with kind, formula, value, inputs, outputs, consuming ops and an unused flag, plus statistics. `variable` (an id or a name) traces one instead: upstream, downstream and the ops reading it |
| `inspect_bytes` | bytes per category, per operation type, and the largest operations |
| `inspect_accessibility` | the semantics tree: role, label, text, state, clickable, bounds; click areas |
| `list_interactions` | click targets (with bounds, centre and the actions they run), click areas, touch-driven variables |
| `interact` | runs `actions` and reports what they changed. Each action is `{wait: s}`, `{target: i}`, `{tap: [x, y]}`, `{drag: [x0, y0, x1, y1]}` or `{variables: {...}}` |
| `inspect_runtime` | repaint verdict and causes; ops per frame over `frames` simulated frames (by type, hottest ops); execution coverage |
| `inspect_theme` | named colours by Material role, named floats, light/dark theme sections |

**`interact` compares against a baseline.** It runs a second copy of the document through
the same timeline without the input. So `changed_variables`, `changed_host_variables` and
`layout_changes` show what the input caused, not what time changed (clocks, animations). A
result of "no difference" is a real answer: the input has no effect. For example, a click
target whose modifier runs no actions.

**Audit findings:**

| code | severity | meaning |
| :--- | :--- | :--- |
| `empty_document` | error | no components and nothing that draws |
| `layout_zero_size` | warning | a component with content, laid out at zero width or height |
| `layout_overflow` | warning | components past the layout box that no scrolling or clipping parent explains |
| `dead_code` | warning | expressions whose results reach no draw, layout or output (removable) |
| `a11y_no_semantics` / `a11y_unlabeled_clickable` | warning | clickable components a screen reader cannot announce |
| `layout_touch_target` | info | clickable components under 48×48 dp |
| `layout_empty_container`, `layout_deep_nesting` | info | containers with nothing in them; nesting deeper than 8 |
| `unused_variables` | info | variables defined and never read |
| `repaint_continuous` | info | the document repaints every frame, with the cause |
| `never_executed` | info | operations no frame of a short run executed |
| `click_types` | info | long-press or double-tap targets, which the TypeScript player does not dispatch |
| `deep_expressions`, `size_dominated`, `size_single_op` | info | long expression chains; one category or one op dominating the file |
| `glyph_icon` | warning (info: one glyph under 24 sp) | a symbol or emoji (◐ ☾ ★ ✓ …) drawn as text where an icon belongs: draw it on a canvas, or use a library or inline component |
| `repeated_subtree` | warning at ≥ 20 copies or ≥ 12 KB, else info | ≥ 4 structurally identical subtrees (≥ 150 B each, ≥ 3 KB in all) differing in a few literals, with the differing paths: make it an inline component. JSON input only, before library components expand |
| `hardcoded_date` | warning when nothing reads the clock or the day numbers 1..28+ are literal texts, else info | "OCTOBER 2026", "Oct 30", "2026-10-30" typed in: compute it from calendarMonth(), dayOfMonth(), year(), weekDay() |
| `hardcoded_colors` | info (warning next to another design warning) | ≥ 16 literal colour uses, ≥ 6 distinct, ≥ 90% of all colours: use `@colors.*` theme roles or `{light, dark}` colours. JSON input only |

The design rules (the last four, `mcp/lib/design-audit.mjs`) read the JSON as written when the
input is JSON; for an `.rc` they look at its text data only (glyphs and dates).

**Limits.**
- **Text widths are estimates.** Text is measured with standard Helvetica advance widths
  scaled by the font size, so sizes involving text are close to a browser's but not exact.
- **Nothing is drawn.** Pixels come from `render_rc`.
- **Clocks are pinned.** Both the clock and animation time are pinned and advanced frame by
  frame, so results are reproducible.
- **One worker per call.** Each call runs in its own worker thread, because the panels keep
  module-level state. The thread is killed after `MCP_INSPECT_TIMEOUT_MS` (default 30 s), and
  at most `MCP_MAX_INSPECTIONS` run at once (default 2).
- **The inspector sources ship with the checkout.** `inspector/src/panels` is read in place,
  or from `RC_INSPECTOR_PANELS`.

## `package_web` (rc-deploy)

`package_web` turns a document (`rc_path` / `rc_base64` / `json` / `json_path`) into one
self-contained HTML page. The minified TypeScript player (about 450 KB) and the `.rc` are
both inlined, so the page works from any static host, as an attachment, or opened from
disk. Animation, touch and clicks all work.

| option | meaning |
| :--- | :--- |
| `controls` | default true: the playground page described below. `false`: the bare player, with only the document on the page |
| `layout` | `fill`: the document fills the window (or the playground's stage) and re-lays out on resize. `fixed`: a `width` x `height` CSS-px box (default: the document's own size). Default: `fill` for the bare player. The playground starts at the document's own size when it fits, and fills otherwise |
| `title`, `background` | page title; page background colour |
| `theme` | `light`, `dark` or `auto` (default `auto`, which follows the viewer's system setting) |
| `density` | `device` (default) uses the viewer's devicePixelRatio, which is sharp and right for documents authored in dp. A number pins it; use 1 for documents drawn in raw pixels, which otherwise look smaller on high-DPI screens |
| `variables` | initial host-variable values (float, int, colour, string). Unknown names are an error that lists what the document declares |
| `url_variables` | default true: `?name=value` in the page URL overrides any declared variable, so one page can show many variants |
| `publish` | host the page (default on a deployment), see below |
| `output_path` | also write the HTML file |

**The playground** (`controls`, on by default) is for seeing how a document *behaves*,
not just how it looks:

- **Size.** Drag the frame's right, bottom or corner handle, type a width and height, swap
  them, pick a preset (the document's own size, watch, phones, tablet, laptop, desktop,
  2×2 / 4×2 / 4×1 widgets), or press **Fill** to follow the window. A label shows the CSS
  size and the device pixels it lays out at.
- **Host variables.** The page has one `<rc-variable>` web component per declared variable:
  - float and int get a slider and a number field. The slider's range grows to fit what is typed.
  - colour gets a picker, an alpha slider and `#AARRGGBB` text.
  - string gets a text field.
  - long and float-array variables are shown read-only, since the web player can't set them.

  Each variable has its own reset button, and there is a **Reset all**. Edits re-run layout
  as well as paint, so a longer string or a size variable reflows the document.
- **The document itself.** The `.rc` size is shown next to the title, and **Download** saves
  the `.rc`, named after the source file. The bytes are already embedded in the page, so the
  download makes no request and also works for a page opened from disk.
- **Look.** A segmented control next to the title: **Auto** (the system's setting),
  **Light** and **Dark** switch the player theme of the document (themed colours, THEME
  sections). The examples' playgrounds add **Mono** / **Mono inverted**, which are documents
  of their own (see rc-examples above); a `package_web` page has only the theme segments.
- **JSON.** A page published from `json` / `json_path` has a **JSON** button (and **Expanded
  JSON** when the document calls library components) opening a viewer: pretty-printed,
  syntax-highlighted, with Copy and Download. A page made from an `.rc` has none. (Config:
  `json: [{label, url | text, file}]` in `lib/web-page.mjs`.)
- **Density, Pause/Play, Restart.** Restart reloads the document, which replays
  animations and clears touch state.
- **State in the URL.** Variables that differ from their defaults go in `?name=value`, which
  the bare page reads the same way. The view goes in `#w=&h=&d=&t=` (or `#fill=1`).
  **Copy link** therefore shares exactly what is on screen, and a reload keeps it.

Before building, the C++ engine reads the document once (`rc2image --check --report`).
That rejects documents that don't parse and gets the document's size and each host
variable's type, so the page knows how to apply `variables` and URL overrides.

**Publishing.** In HTTP mode with `MCP_PUBLIC_URL` set, `package_web` also stores the page
under `MCP_ROOT/pages/` and returns `MCP_PUBLIC_URL/pages/<id>/`. That URL works **without
the token**: anyone with the link can open the page, and the 128-bit random id makes it
unguessable. Published pages are not pruned. Manage them with `list_pages` and
`unpublish_page`, which deletes a page and stops its link working immediately. Pages are
served with `noindex`, `nosniff` and `no-referrer`.

**Page index.** `https://DOMAIN/pages` (also `MCP_PUBLIC_URL/pages/`) is a public,
token-free list of every published page: title, source, kind (playground or bare player),
document (`.rc`) and page sizes, and date, each linking to its page. This makes every published page discoverable,
so the random ids no longer keep anything private. To turn the index off, add
`MCP_PAGE_INDEX=0` to `/etc/rcmcp/deploy.env` and restart `rcmcp@deploy`; `/pages` then
returns 404 and unlisted links keep working.

**The player bundle** is built from `players/typescript/src/web/main.ts` into
`players/typescript/build-mcp/player.min.js` (gitignored), or `RC_PLAYER_BUNDLE`. Locally
it's rebuilt automatically whenever a player source file is newer. On a deployment the
services can't write the checkout, so `setup.sh` runs `npm ci` and
`node mcp/lib/web-player.mjs --build`. Re-run setup after pulling player changes.

The page runs the **TypeScript** engine and `render_rc` runs the **C++** one, and the two
can differ. Check the page itself, not only a `render_rc` picture.

