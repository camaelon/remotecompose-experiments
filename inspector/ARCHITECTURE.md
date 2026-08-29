# RemoteCompose Inspector Code Architecture Guide

This document describes the high-level code architecture, modular design, data flow pipelines, Headless Chrome CDP evaluation bridge, and Model Context Protocol (MCP) server architecture of the **RemoteCompose Inspector**.

---

## 1. System Architecture Overview

The RemoteCompose Inspector is designed with a **two-tier hybrid architecture**:
1. **Client Web App (`src/` $\rightarrow$ `dist/index.html`):** An ultra-lean, self-contained single-file browser application with zero runtime npm dependencies.
2. **Host MCP Server (`mcp-server.mjs`):** A headless Model Context Protocol (MCP) server that connects AI assistants (Antigravity, Claude Desktop, Cursor) directly to the Inspector's evaluation engine over standard `stdio` JSON-RPC using Chrome DevTools Protocol (CDP).

```
 ┌──────────────────────────────────────┐
 │          AI Assistant Client         │
 │ (Antigravity, Claude Desktop, Cursor)│
 └───────────────────┬──────────────────┘
                     │  stdio (JSON-RPC)
                     v
 ┌────────────────────────────────────────────────────────┐
 │           Host MCP Server (mcp-server.mjs)             │
 │  - Tools: inspect, decompile, dead_code, screenshot,   │
 │           profile_performance                          │
 └───────────────────┬────────────────────────────────────┘
                     │  Chrome DevTools Protocol (CDP)
                     v
 ┌────────────────────────────────────────────────────────┐
 │       Headless Chrome Runtime (dist/index.html)        │
 │  ┌─────────────────────────┐ ┌───────────────────────┐ │
 │  │ RemoteComposeSerializer │ │  remote_compose_player│ │
 │  └─────────────────────────┘ └───────────────────────┘ │
 │  ┌───────────────────────────────────────────────────┐ │
 │  │ Modular Inspector Panels:                         │ │
 │  │ - CommandListPanel.js (Disassembly & Reachability)│ │
 │  │ - DependencyGraphPanel.js (RPN DAG Engine)        │ │
 │  │ - ProfilerPanel.js (Opcode & Timing Engine)       │ │
 │  └───────────────────────────────────────────────────┘ │
 └────────────────────────────────────────────────────────┘
```

### Core Architecture Principles
- **Zero Client Bloat:** The browser UI (`dist/index.html`) contains zero MCP polyfills or Node.js server dependencies. It loads instantly and runs as a pure static HTML5 application.
- **Single Source of Truth:** AI tools and human developers use the exact same TypeScript/JavaScript parser and rendering engine (`RcdPlayer` & `RemoteComposeSerializer`), eliminating parser drift.
- **Panel-by-Panel Modularization:** Every inspector panel is decoupled into its own ES module under `src/panels/` with deterministic query and analysis functions (`getUnusedIslandsAnalysis()`, `getVariableUsageInfo()`, `decompileDocumentToJson()`).

---

## 2. High-Level Data Flow Pipeline

```
+------------------+     Binary Stream     +-----------------------------+
| RemoteCompose    | --------------------> | RemoteComposeSerializer     |
| .rc / .json File |                       | - Parses Header & Opcodes   |
+------------------+                       +-----------------------------+
                                                          |
                                                          v
                                           +-----------------------------+
                                           | currentDocument             |
                                           | - Operations List           |
                                           | - RemoteComposeState        |
                                           +-----------------------------+
                                                          |
              +-------------------------------------------+-------------------------------------------+
              |                                           |                                           |
              v                                           v                                           v
+---------------------------+               +---------------------------+               +---------------------------+
| CommandListPanel.js       |               | Canvas & Player Engine    |               | DependencyGraphPanel.js   |
| - Disassembly Tree        |               | - Canvas2D Render Loop    |               | - buildExprGraphModel     |
| - Dead Variable Scanner   |               | - 60 FPS Micro-benchmarks |               | - Topological Sort (DAG)  |
| - Unused Island Badges    |               | - Frame Stepping Engine   |               | - Critical Path Tracing   |
+---------------------------+               +---------------------------+               +---------------------------+
```

---

## 3. Modular Panel Structure (`src/`)

The inspector source is structured as follows:

```
inspector/
├── build.mjs                      # Production bundler (esbuild IIFE + single-file injection)
├── mcp-server.mjs                 # Headless Chrome CDP Model Context Protocol server
├── remote_compose_player.js       # Generated: player engine bundled from players/typescript/
├── RemoteComposeSerializer.js     # Binary encoder & decompiler engine
├── dist/                          # Generated distribution bundle
│   └── index.html                 # Self-contained single-file inspector
└── src/
    ├── index.html                 # HTML shell and panel DOM templates
    ├── main.js                    # Core event bus and document loader
    ├── styles/
    │   └── main.css               # Dark theme layout styles
    └── panels/
        ├── LayoutManager.js       # Panel registry, tabs, splits, resizing
        ├── DocumentLoader.js      # Load, parse, and fan out to every panel
        ├── StagePanel.js          # Player, stage sizing, execution stepping
        ├── CommandListPanel.js    # Disassembly, byte offsets, parameter tables
        ├── OpParameters.js        # Shared operation parameter decoding
        ├── ComponentWalk.js       # Component tree walk, layer model, scroll & clip
        ├── ComponentTreePanel.js  # Static and running post-inflation trees
        ├── LayoutInspectorPanel.js# Box model, layout diagnostics
        ├── Layers3DPanel.js       # The component stack as orbitable planes
        ├── AccessibilityPanel.js  # The accessible tree
        ├── InteractionPanel.js    # Hit targets and action dispatch
        ├── RepaintPanel.js        # Repaint scheduling and its causes
        ├── ProfilerPanel.js       # Per-frame measurement and coverage
        ├── VariablesPanel.js      # State values and graphs
        ├── DependencyGraphPanel.js# Expression DAG
        ├── BinaryTreemapPanel.js  # Byte allocation treemap
        ├── DocumentStatsPanel.js  # Byte distribution and opcode KPIs
        ├── ThemeEnvironmentPanel.js
        ├── ResponsiveMatrixPanel.js
        └── JsonEditorPanel.js
```

### Shared model modules

Two modules hold knowledge about the format rather than about a panel, so that what one panel
displays and what another reasons about cannot drift apart:

- **`OpParameters.js`** decodes an operation's parameters. RemoteCompose stores a float that an
  expression drives as a NaN-boxed value — the exponent all ones, the mantissa carrying the
  variable id — so a literal and a reference occupy the same slot and are only distinguishable
  from the raw bits. Operations keep those bits in `mFooBits` and the value resolved for the
  frame in `mFoo`; matrix operations keep the bits directly in the named field. Paint
  parameters are walked with the `PaintBundle` tag grammar rather than scanned, because an
  opaque ARGB colour such as `0xFFFFC46B` also satisfies the NaN test and a blind scan reads it
  as a reference to variable 8373355.

- **`ComponentWalk.js`** walks the inflated component tree and builds the layer model: which
  components draw, which are pure structure, where each one is on screen, what clips it, and
  what is hidden. `getLocationInWindow()` sums parent positions and never accounts for scroll —
  correct for the engine, which hit-tests in unscrolled layout coordinates — so anything
  showing what is *displayed* subtracts it here instead.

### Panels, tabs and splits

`LayoutManager` owns three relationships:

- **Panels** are columns, declared in `PANEL_META` and ordered by `PANEL_PUCKS`.
- **`PANEL_SUBVIEWS`** are views that share a host by taking turns — tabs. Only one is on
  screen at a time.
- **`PANEL_SPLITS`** are views that share a host side by side, because they are needed
  together: a tree and the box model of the node you picked in it; a variable list and the plot
  of the ones you ticked. Each split half can be toggled off.

A merged sub-view keeps the element id its panel had, and inactive sub-views reuse the
`hidden-panel` class. That is what lets every pre-existing lookup, visibility guard and
`restorePanel('pane6')` call site keep working after the merge: `restorePanel` routes an
absorbed id to its host and selects the right tab.

Resize handles are generic — one per panel, addressed by `data-resize-pane` — and a drag moves
the *boundary*, growing one panel while shrinking its neighbour. The previous version hardcoded
every adjacent pair, which meant the panel order could not change without rewriting the drag
logic, and the last panel in the row could never be resized at all.

### The 3D layer view

`Layers3DPanel` renders with CSS 3D rather than a canvas, so every quad is a real element and
hit-testing, hover and click-to-select come from the DOM and reuse the tree's selection path.
The layers are parallel planes, so the one thing CSS 3D cannot do — interpenetrating geometry —
never arises. Three invariants are easy to break and worth stating:

- **Zoom and pan live *outside* the perspective**, on a wrapper the scene sits inside. Folding
  zoom into the 3D transform scales `translateZ` along with everything else, so zooming appears
  to change the layer spacing; and anchoring on the cursor through the 3D pivot is only exact
  on the pivot's own plane, because perspective moves other depths differently. A flat 2D scale
  about a fixed origin is exactly invertible at every depth.
- **Rotation turns about an explicit pivot** held at the centre of the viewport, so panning
  moves the pivot rather than sliding the image. Because pan is applied flat, it is folded back
  into the pivot when an orbit begins — same image, but the point at the centre of the view
  becomes the point rotation turns about.
- **The scene anchor is fixed once the stack is built.** Recomputing the content box every
  frame makes the scene re-centre as a list scrolls, which reads as everything that *doesn't*
  scroll drifting the other way.

Content offsets belong inside the transform, never as a CSS margin: margins apply in layout
space and are not affected by the scale that follows them, so a tall scrolling document ends up
displaced by thousands of unscaled pixels.

---

## 4. Testing

```bash
cd inspector && npm test          # node --test tests/*.test.js
```

Tests run against the built player in `dist/`, so run a build first if the engine changed.
`tests/test_helpers.js` provides `setupMockEnvironment()` for a DOM stub and
`loadSampleDocument(name)` to load a real `.rc` from `samples/` through the actual player —
the model-level suites use real documents rather than fixtures, because the bugs worth
catching here have all been about what the format actually does.

The suites divide by what they protect:

| suite | protects |
| :--- | :--- |
| `OpParameters` | the NaN-boxing rules, including that an opaque ARGB colour is not a variable reference |
| `ComponentWalk` | the layer model: what draws, what flattens, scroll accumulation, GONE vs INVISIBLE |
| `Layers3DPanel` | clip fractions and the screen↔scene projection inverse |
| `RepaintPanel` | that the panel reports the engine's decision rather than deriving its own |
| `InteractionPanel` | hit targets, dispatchability, and the accessible tree |
| `ProfilerPanel` | measurement accumulation and coverage |
| `LayoutManager` | the panel registry, tabs, splits, and id routing after the merge |

---

---

## 5. Headless Chrome CDP Bridge (`Option A`)

The MCP server uses **Chrome DevTools Protocol (CDP)** over a temporary loopback WebSocket to evaluate RemoteCompose documents headlessly without needing any network ports exposed on public interfaces:

1. **Process Isolation:** The MCP server launches `/Applications/Google Chrome.app` in headless mode (`--headless=new --remote-debugging-port=94xx`).
2. **Binary Injection:** The `.rc` binary is converted to base64 and loaded via `window.loadRcArrayBuffer(bytes.buffer, fileName)` inside the page context.
3. **Execution & Extraction:** The MCP server invokes the modular analysis functions on `window` and extracts structured JSON results directly over the CDP `Runtime.evaluate` channel.
4. **Clean Teardown:** Headless Chrome terminates automatically upon command completion.

---

## 6. Model Context Protocol (MCP) Tools Registry

The MCP server (`mcp-server.mjs`) exposes the following tool suite to LLMs:

| MCP Tool Name | Target Analysis Function | Purpose |
| :--- | :--- | :--- |
| **`rc_inspect_document`** | `getAllOperationsFlat`, `getVariableUsageInfo` | Returns opcode counts, byte offsets, dimensions, and variable counts. |
| **`rc_analyze_dead_code`** | `getUnusedIslandsAnalysis` | Finds all unreferenced variables and removable dead-code operations. |
| **`rc_analyze_binary_treemap`** | `buildBinaryTreemapModel` | Hierarchical byte allocation treemap, category breakdown, and top space consumers. |
| **`rc_decompile_tree`** | `decompileDocumentToJson` | Decompiles stream into hierarchical UI Component Tree with Modifiers. |
| **`rc_render_screenshot`** | `canvas.toDataURL("image/png")` | Captures high-res canvas PNG for multimodal vision inspection. |
| **`rc_profile_performance`** | `RcdPlayer.setMeasurementSink` | Measures $N$-frame latency (avg/median/p95/p99 ms), FPS, and hot spots. |

---

## 7. Build Workflow

`build.mjs` runs three stages, from sources to the published distribution:

1. **Compile the player engine.** `players/typescript/src/web/main.ts` is bundled with esbuild
   (IIFE, `--global-name=RC`, ES2020) into `inspector/remote_compose_player.js`. The engine is
   never hand-edited here — it is always a build product of the TypeScript player.
2. **Bundle the inspector UI.** `src/main.js` and `src/panels/*.js` are bundled, then injected
   together with `src/styles/main.css` into the `src/index.html` shell to produce a
   self-contained `index.html` (written to both `inspector/` and `inspector/dist/`).
3. **Publish.** The three distribution files — `index.html`, `remote_compose_player.js` and
   `RemoteComposeSerializer.js` — are copied to `docs/inspector/`, which is what ships.

esbuild is resolved from the nearest local `node_modules/.bin` (repo root, `inspector/`, or
`players/typescript/`), falling back to `npx`. Each stage pins its esbuild working directory so
the module paths embedded in the bundles stay stable and the build is byte-for-byte reproducible.

```bash
npm install          # once, from the repo root — provides esbuild
npm run build        # full pipeline: player + inspector + publish to docs/inspector/
```

Equivalent invocations, and the variants:

```bash
node inspector/build.mjs               # same as npm run build
node inspector/build.mjs --no-player   # skip stage 1, reuse the existing player bundle
node inspector/build.mjs --watch       # rebuild on changes in src/ and players/typescript/src/
```
