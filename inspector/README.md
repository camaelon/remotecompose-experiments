# RemoteCompose Inspector User Guide

The **RemoteCompose Inspector** is a comprehensive, interactive in-browser diagnostic studio, visual player, performance profiler, and dependency graph analyzer for RemoteCompose binary (`.rc`) files and JSON documents.

It provides deep visual introspection into RemoteCompose document layouts, opcodes, state variables, real-time animation formulas, execution graph dependencies, and frame-by-frame performance measurements.

---

## Table of Contents

- [Architecture & MCP Server Guides](#architecture--mcp-server-guides)
  - [Architecture Guide (`ARCHITECTURE.md`)](ARCHITECTURE.md)
  - [MCP Server & LLM Insights Guide (`MCP_LLM_GUIDE.md`)](MCP_LLM_GUIDE.md)
- [Quick Start](#quick-start)
- [Key Features](#key-features)
- [The Panel Bar](#the-panel-bar)
  - [Player](#player)
  - [Disassembly](#disassembly)
  - [Structure](#structure)
  - [Runtime](#runtime)
  - [Variables](#variables)
  - [DAG](#dag)
  - [Environment](#environment)
  - [Statistics](#statistics)
  - [JSON](#json)
- [Deep Dive: Layers 3D](#deep-dive-layers-3d)
- [Deep Dive: Repaint Scheduling](#deep-dive-repaint-scheduling)
- [Deep Dive: Profiler & Coverage](#deep-dive-profiler--coverage)
- [Deep Dive: Expression Dependency Graph](#deep-dive-expression-dependency-graph)
- [Mouse & Keyboard Controls](#mouse--keyboard-controls)


## Architecture & MCP Server Guides

Build the single-file inspector with `npm run build` from the repo root, which compiles the
player from `players/typescript/`, bundles the UI, and publishes to `docs/inspector/`. Run the
test suite with `npm test` from `inspector/`.

- 📐 **[Architecture Guide (`ARCHITECTURE.md`)](ARCHITECTURE.md)**: Deep dive into the modular multi-panel architecture, high-level data flow pipelines, and zero-dependency build system.
- 🤖 **[MCP Server & LLM Insights Guide (`MCP_LLM_GUIDE.md`)](MCP_LLM_GUIDE.md)**: Complete guide on using the Headless Chrome CDP Model Context Protocol server (`mcp-server.mjs`) to automate dead-code pruning, component tree decompilation, multimodal vision screenshot review, and microsecond performance profiling via AI coding assistants.

---

## Quick Start

1. **Open the Inspector**: Open `index.html` in any modern web browser (Chrome, Firefox, Safari, Edge).
2. **Load a RemoteCompose File**:
   - **Drag & Drop**: Drag a `.rc` or `.json` file anywhere onto the inspector window.
   - **File Picker**: Click **"Choose File"** in the top navigation bar.
   - **URL Query Parameter**: Open `index.html?url=path/to/document.rc` to load remote or local binary files automatically.
3. **Explore**:
   - View live canvas rendering in the **Player**.
   - Read operations and the expressions driving them in **Disassembly**.
   - Profile frame throughput and coverage in **Runtime ▸ Profiler**, and find out what is
     forcing repaints in **Runtime ▸ Repaint**.

---

## Key Features

- **Live Canvas Player & Frame Controls**: Render RemoteCompose documents with real-time variable updates, play/pause animations, and single-frame stepping.
- **Hierarchical Command List**: Inspect all document operations with compact/detailed formatting, searching, opcode filter badges, and dead-code indicators.
- **Real-Time Performance Profiler**: Measure operation counts per frame, track peak/mean execution workloads, inspect sparkline waveforms, and rank opcodes by type or instance.
- **Interactive DAG Dependency Visualizer**: Render complex `FloatExpression`, `IntegerExpression`, System Variable, Constant, and Consumer operation dependencies as a directed acyclic graph.
- **Live Variable Value Simulator**: Adjust System Variables (`$TIME`, `$ANIMATION`, `$WIDTH`, `$HEIGHT`) and Constants using interactive range sliders with real-time canvas and graph card updates.
- **Critical Path Tracing**: Identify the deepest calculation stack in the document with gold arrow highlights and step-by-step formula evaluation badges (`10.00 ➔ var_11`).
- **Dead-Code & Unused Island Detection**: Automatically isolate unconsumed calculation chains (`unusedIslandSet`) and calculate the exact number of operations (`removableOpsCount`) that can be safely deleted without affecting canvas rendering.
- **Sugiyama / Barycenter Layout Optimization**: Multi-pass layer sweep algorithm that aligns connected nodes horizontally to minimize connection lengths and edge crossings.
- **Interactive Minimap**: High-level visual radar with a real-time viewport finder box, click-to-center, and drag navigation.
- **Operation Parameters**: Every operation shows its decoded parameters and which expression drives each one, with click-through to the defining operation.
- **Layers 3D**: The component stack as orbitable planes, with clip regions, live positions, and an optional capture of the rendered pixels.
- **Repaint Scheduling**: What causes the next paint, with the operations responsible and the value each schedules.
- **Interaction & Accessibility**: Hit targets you can fire through the engine's own dispatch, and the accessible tree a screen reader would see.
- **Execution Coverage**: Which operations measurement has never seen, and which have gone quiet.

---

## The Panel Bar

Nine panels, in the order you work: what the document *is*, then what it *does* when it runs,
then what it renders to and compiles into. Several panels hold more than one view — either as
**tabs**, when the views answer the same question in turn, or as a **split**, when you need
both at once. Every panel has a `✕` to close it, a `+` to grow it into the free space, and a
drag handle on its right edge that moves the boundary with its neighbour.

A fresh session opens with **Player** and **Disassembly**.

### Player

Live canvas playback: play/pause, step a frame, reset, and a resizable stage with density,
zoom and theme controls. The stage is pinned to the top-left so it stays reachable when you
size it past the viewport.

### Disassembly

Every operation in the document, in wire order, with byte offsets and hex.

Operations show their **parameters**, not just their name — and, critically, which expression
drives each one. `DrawRect(0, 0, 400, 400)` hides the fact that its right and bottom edges come
from `componentWidth()`; the panel shows `left=0 top=0 right=var_42 (400) bottom=var_43 (400)`,
and a click on `var_42` jumps to the operation that defines it. Paint parameters are decoded
through the `PaintBundle` tag grammar, so a paint reads `color=#FF7BD88F style=stroke
strokeWidth=10 strokeCap=round`.

Values a component measures during layout (`x`, `y`, `width`, `height`) are marked 📐, because
they are computed rather than stored in the binary.

### Structure

Three tree views that take turns, beside a **Layout & Box Model** split you can toggle:

| tab | what it shows |
| :--- | :--- |
| **Component Tree** | the document's declared component hierarchy |
| **Running Tree** | the tree after inflation, as the engine actually walks it |
| **Layers 3D** | the component stack as planes you can orbit — see the deep dive below |
| **Accessibility** | what a screen reader would find |

The **Accessibility** tab lists the document's `contentDescription`, each component's
accessible name and where it comes from, and warns about clickable components that have none.
Where a document has no `AccessibilitySemantics` operations it says so, rather than presenting
names inferred from drawn text as though the document had stated them.

### Runtime

What the document does once it is running. Three tabs:

- **Profiler** — per-frame operation counts by type and by instance, with a sparkline and the
  invariants check. Includes **execution coverage**: which operations measurement has never
  seen, and which ran earlier but not in the last 30 frames.
- **Repaint** — why the next paint happens and which operation asks for it. See the deep dive.
- **Interaction** — every clickable and touchable target, where it is, and what it runs.
  **Fire** dispatches through the engine's own hit-testing, so it behaves exactly like a tap.
  It flags targets that cannot work: zero-sized regions, click modifiers with no actions, and
  long-press or double-tap targets, which this player never dispatches.

### Variables

The document's state, split so you can see both halves at once: every float, integer, colour,
path and string variable on the left with live editing, and a plot of the ones you tick on the
right. The graph half can be toggled off.

### DAG

The expression dependency graph — see the deep dive.

### Environment

The conditions the document renders under. **Size Matrix** renders it across size buckets
side by side; **Theme** switches light/dark and the system environment variables.

### Statistics

**Overview** gives byte distribution, opcode KPIs and per-type metrics — including the
average size of each operation type, which separates "many small ops" from "one large one".
**Treemap** is the same bytes as a squarified treemap you can drill into.

### JSON

The document decompiled to JSON, editable and recompilable.


## Deep Dive: Layers 3D

`Structure ▸ Layers 3D` draws every component as a plane in a stack you can orbit, which is
where overdraw and stacking become visible in a way no tree can show.

**Flattening.** A component that draws nothing of its own — a `ColumnLayout` that only groups
its children — does not get a plane. It stays in the model as a selectable wireframe on its
parent's plane, so nothing becomes unreachable, but it does not pad the stack with an empty
layer. Across the sample documents this removes 37–59% of the planes.

Deciding what "draws" is the subtle part, and the obvious rule is wrong: this engine draws
through *leaf components*. `weather_demo` has 67 `CoreText` and 25 `ImageLayout` and not one
draw operation inside any component's child list. A component is a layer when it is
self-drawing (`CoreText`, `TextLayout`, `ImageLayout`, `CanvasContent`), holds canvas draw
operations, or paints a background.

**Stack by.** *Nesting* separates by containment, the familiar hierarchy view. *Paint order*
gives every drawn component its own plane in the order it is painted, which is what actually
shows one thing sitting on top of another. On documents that draw through leaves, nesting
collapses nearly flat — droidkaigi is 3 planes by nesting and 313 by paint order.

**Controls.**

| control | effect |
| :--- | :--- |
| **Spacing** | separation between planes |
| **Text** | render a text layer as the words it draws, at its real size and colour |
| **Clips** | outline scrolling containers in red, and fade what falls outside them |
| **Scroll** | position layers where they are displayed rather than where they were laid out |
| **Containers** | show or hide the flattened wireframes |
| **📷 Capture** | paint each layer with its pixels from the current frame |

**Capture has two honest limits.** Only what has been rendered can be shown, so on a scrolling
list the layers outside the visible window come back empty — they were never drawn. And a
layer's window into the frame shows whatever its neighbours painted there too: it is the
composite within those bounds, not that layer's private contribution.

**GONE and INVISIBLE are different states, and the stack treats them differently.** `GONE` is
not laid out at all, so it has no place and no size: it is left out and counted in the header.
`INVISIBLE` does occupy its space and is simply never painted, so it stays in the stack drawn
in **mauve** — the difference between "this is not here" and "this is here and you cannot see
it". Both are inherited: nothing inside a `GONE` component is laid out, and nothing inside an
`INVISIBLE` one is painted. Neither consumes a paint plane.

Visibility is re-evaluated as the document runs, so a component that goes `GONE` and comes
back reappears in the stack without a reload.

---

## Deep Dive: Repaint Scheduling

`Runtime ▸ Repaint` answers why a document will not sit still. The engine decides in
`CoreDocument.paint()`, and the panel reproduces that decision rather than inventing one:

1. an operation called `needsRepaint()`, or layout asked for one → paint again immediately
2. otherwise `getOpsToUpdate()`:
   - a listener on `$CONTINUOUS_SEC` → immediately, before anything else is considered
   - a listener on `$TIME_IN_SEC` → the next second boundary
   - a listener on `$TIME_IN_MIN` → the next minute boundary
   - an explicit `wakeIn(seconds)` → that
   - nothing → idle

Causes are listed in that order, each tagged **determines next paint** or **subsumed**, with
the operations behind it and the value it schedules. A listener on `$CONTINUOUS_SEC` is the
usual answer to an unexplained constant repaint.

One case cannot name its caller: `PaintContext` records the immediate flag as a bare boolean.
For that branch the panel resolves the operations that request an immediate repaint when they
run — `TimeAttribute` in its elapsed modes, `ParticlesLoop`, `ParticlesCompare`, animated
`FloatExpression`s while still running, `TouchExpression` — marks the ones whose state says
they are doing so right now, and says the attribution is derived rather than observed.

The **observed** paint rate is measured over five seconds of wall clock, and is deliberately
separate from what the document *asks for*: the two can disagree.

---

## Deep Dive: Profiler & Coverage

The **Profiler** tab of the Runtime panel allows document authors and engine developers to measure the exact execution cost of a RemoteCompose document frame by frame.

```
+-----------------------------------------------------------------------------------+
|                        ⏱️ Runtime ▸ Profiler                                           |
+-----------------------------------------------------------------------------------+
| [Last Frame: 142]   [Peak: 185]   [Mean: 138]   [Frames: 1,240]   [Types: 14]       |
+-----------------------------------------------------------------------------------+
| Sparkline Waveform (Last 600 Frames)                                              |
| ~~~~~~~~~~~~~~~~~~~~~~~~/\~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ |
+-----------------------------------------------------------------------------------+
| Invariant Status: ✅ Invariants hold over 1,240 frames                             |
+-----------------------------------------------------------------------------------+
| Rank Mode: [ Last Frame ▼ ]                                                       |
|                                                                                   |
| BY OPCODE TYPE                          | BY OPERATION INSTANCE                   |
| Opcode Name        Count   Peak   Total | Inst ID   Opcode Name    Count Peak Total |
| ------------------ -----  -----  ------ | --------  -------------  ----- ---- ----- |
| DrawRect (#110)       45     60   55,800| Inst #12  MatrixRotate      1    1  1,240 |
| MatrixSave (#130)     12     12   14,880| Inst #45  DrawPath          1    1  1,240 |
| FloatExpression (#81) 18     18   22,320| Inst #88  DrawRect          8    8  9,920 |
+-----------------------------------------------------------------------------------+
```

### Understanding Profiler Metrics

- **Last Frame Ops (`Last`)**: The exact number of operations processed in the most recent render frame.
- **Peak Ops (`Peak`)**: The maximum number of operations recorded in any single frame during the current session. Spikes here indicate burst re-layout or heavy animation frames.
- **Mean Ops (`Mean`)**: Average operation throughput per frame (`Total Ops / Total Frames`).
- **Total Frames (`Frames`)**: Total number of rendered frames measured since load or last reset.
- **Unique Op Types (`Types`)**: Number of distinct opcode types executed in the document.
- **Unique Instances (`Inst`)**: Number of distinct operational object instances executed.

---

### Ranking Modes: Last, Total, and Peak

Use the **Rank Mode** dropdown in the Profiler to sort opcode and instance tables:

1. **Last Frame (`last`) [Default]**:
   - Sorts opcodes and instances by their execution count in the most recent frame.
   - **Best Used For**: Real-time animation monitoring. Helps identify which drawing or matrix operations are currently executing on the current frame.
2. **Total Accumulated (`total`)**:
   - Sorts opcodes and instances by cumulative operations executed over the entire run session.
   - **Best Used For**: Long-term hotspot identification. Reveals which opcodes dominate total rendering time over extended playback.
3. **Peak Frame (`peak`)**:
   - Sorts by the maximum single-frame execution count observed.
   - **Best Used For**: Diagnosing burst lag or layout recalculation spikes. Identifies operations responsible for frame drops.

---

### Operation Instance Deep-Linking

Every row in the **By Operation Instance** table represents a specific instantiated operation object in the document.

- **Clicking an Instance Row**:
  1. Instantly locates and highlights the operation in the **Command List (the Disassembly panel)**.
  2. Centers and zooms the corresponding node in the **DAG**.
  3. Displays detailed byte offsets and properties in **Disassembly**.

---

### Step-by-Step Performance Profiling Workflow

To optimize a RemoteCompose document using the Profiler:

1. **Start Playback & Observe Sparkline**: Press Play (`▶`) in the Player. Observe the green sparkline waveform in the Profiler.
   - *Flat, low waveform*: Document is light and efficient.
   - *Spiky or high waveform*: Document has high per-frame operation volume or periodic rendering spikes.
2. **Identify Heavy Opcode Types**: Inspect the **By Opcode Type** table. Look for high counts of expensive operations:
   - Excessive `MatrixSave` (`#130`) / `MatrixRestore` (`#131`) pairs suggest redundant matrix stack saves.
   - High `FloatExpression` (`#81`) counts suggest complex variable math that could be simplified.
3. **Locate Hotspot Instances**: Switch Rank Mode to **Total** or **Peak** and click top instance rows to jump directly to the offending commands in Disassembly and the DAG.
4. **Verify Engine Invariants**: Ensure the green **Invariants Status** bar reports `Invariants hold`. If `INVARIANT FAILED` appears, one or more custom operations are not properly reporting their frame execution counts.

---

## Deep Dive: Expression Dependency Graph

The **DAG** panel translates flat document opcode lists into an interactive directed acyclic graph (DAG). It is designed specifically to analyze mathematical formulas, trace variable state flows, and clean up bloated documents.

```
+-----------------------------------------------------------------------------------+
|                        🧬 DAG — Expression Dependency Graph                      |
+-----------------------------------------------------------------------------------+
| [🌐 Graph] [📋 Tree] [🎯 Fit] [⚠️ Unused First] [🔥 Critical Path] [🎛️ Live Sim]  |
+-----------------------------------------------------------------------------------+
| 🔍 Search expressions, var IDs, formulas...             [ All Types ▼ ]           |
+-----------------------------------------------------------------------------------+
| 🟨 SysVar  🟦 FloatExpr  🟪 IntExpr  🟩 Constant  🎨 Consumer  ⚠️ 2 Unused Islands   |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|   [ 🟨 sys_1 ($TIME) ] ───➔ [ 🟦 var_10 (var_10 = sys_1 * 6.0) ]                   |
|                                         │                                         |
|                                         ▼                                         |
|                             [ 🟦 var_12 (var_12 = var_10 + 45.0) ]                |
|                                         │                                         |
|                                         ▼                                         |
|                             [ 🎨 MatrixRotate #15 ]                               |
|                                                                                   |
|                                                                    +------------+ |
|                                                                    | 🗺️ Minimap | |
|                                                                    +------------+ |
+-----------------------------------------------------------------------------------+
```

---

### Workflow 1: Dead-Code Identification & Binary Optimization

Documents compiled from design tools often contain "dead code" — expressions or variables calculated during layout that are never read by any drawing operation.

#### How to Analyze & Clean Up Dead Code:
1. **Check Legend Bar**: Look for the orange badge `⚠️ X Unused Islands (Y ops removable)`.
   - `Unused Islands`: Groups of expressions that do not connect to any Consumer operation.
   - `Removable Ops`: The exact number of operations that can be deleted to shrink file size.
2. **Enable `⚠️ Unused First` Sorting**: Click **`⚠️ Unused First`** in the the DAG header. This sorts all dead-code islands to the top of graph columns.
3. **Inspect Unused Subgraphs**: Unused nodes and edges are styled with orange dashed strokes (`stroke-dasharray="5 3"`).
4. **Prune Document**: Remove the unused variable IDs from your source layout definition to reduce binary file size and decrease engine initialization time.

---

### Workflow 2: Interactive Animation & Formula Simulation (`🎛️ Live Simulator`)

Test animation behavior and inspect expression calculations in real-time without re-compiling the document.

#### How to Simulate Variable State:
1. **Open Simulator**: Click **`🎛️ Live Simulator`** in the the DAG header to open the range slider tray.
2. **Adjust System Variables**:
   - Drag **`$TIME (sys_1)`** (0s to 60s) to simulate clock hand motion or time-based animations.
   - Drag **`$ANIMATION (sys_4)`** (0.0 to 1.0) to test transition progress bars or entrance animations.
   - Drag **`$WIDTH (sys_2)`** or **`$HEIGHT (sys_3)`** to test responsive layout resizing.
3. **Observe Live Graph Feedback**:
   - Every node card in the DAG displays a live green value pill (`Val: 15.00`).
   - Dragging a slider updates all downstream expression pills and repaints the Player synchronously.
4. **Test Edge Cases**: Move sliders to extreme bounds (`$TIME = 0`, `$WIDTH = 0`, `$ANIMATION = 1.0`) to check for `NaN` values, divide-by-zero errors, or broken layout math.

---

### Workflow 3: Bottleneck & Latency Tracing (`🔥 Critical Path`)

Complex RemoteCompose documents with deeply nested `FloatExpression` chains can introduce latency during frame evaluation.

#### How to Trace Critical Calculation Pipelines:
1. **Enable Critical Path**: Click **`🔥 Critical Path`** in the the DAG header.
2. **Identify Deepest Chain**: The engine runs a topological longest-path algorithm ($O(V + E)$) and highlights the deepest calculation stack in glowing gold (`#f59e0b`).
3. **Inspect Step Evaluation Badges**: Connection arrows display live evaluation step chips directly on the curve midpoints (`10.00 ➔ var_11`).
4. **Optimize Pipeline**: Simplify multi-stage expression chains (e.g. `sys_1 ➔ var_10 ➔ var_11 ➔ var_12 ➔ MatrixRotate`) by folding constant math terms or combining redundant expressions into single `FloatExpression` operations.

---

### Workflow 4: Deep Subgraph Exploration & Focused Debugging

Isolate specific components or variables within large DAG graphs containing 100+ nodes.

#### How to Isolate Subgraphs:
1. **Select Node**: Click any node card in the DAG or any operation in the Disassembly panel.
2. **Visual Color Hierarchy**:
   - **Cyan (`#38bdf8`)**: Currently selected target node.
   - **Soft Emerald Green (`#34d399`)**: Direct & transitive **Upstream Ancestors** (all variables and constants required to compute the selected node).
   - **Soft Purple (`#c084fc`)**: Direct & transitive **Downstream Dependents** (all expressions and drawing ops affected by the selected node).
   - **Dimmed (`Opacity 0.25`)**: Unrelated background subgraphs.
3. **Search Filtering**: Type into **`🔍 Search expressions...`** to filter graph nodes by variable ID (`101`), variable name (`$TIME`), or formula substring (`sin`).
4. **Deselect**: Click any empty canvas area or click **`✕ Clear Highlight`** in the legend bar to restore full graph visibility.

---

### Workflow 5: Visual Navigation via Minimap (`🗺️ Minimap`)

Navigate massive multi-column DAG layouts effortlessly using the floating minimap overlay.

1. **Overview Radar**: Located in the bottom-right corner of the DAG. Shows a color-coded thumbnail of all graph nodes.
2. **Viewport Finder Box**: The semi-transparent cyan rectangle (`#exprMinimapViewport`) indicates your current visible canvas area.
3. **Click-to-Center**: Click anywhere inside the minimap to instantly center the main DAG canvas on that position.
4. **Drag Navigation**: Drag the cyan finder box to smoothly pan across large graph layouts.
5. **Collapse**: Click **`−`** in the minimap title bar to collapse it down to a 24px header when not needed.

---

## Mouse & Keyboard Controls

| Context | Action | Behavior |
| :--- | :--- | :--- |
| **Panels** | Drag a handle | Moves the boundary: the panel on the left grows, the one on the right shrinks |
| **Panels** | Double-click a handle | Resets both panels it separates to their default widths |
| **Panels** | `+` in the header | Grows the panel into the free space; press again to restore |
| **Disassembly** | Single click | Selects the operation and centres the matching node in the DAG |
| **Disassembly** | Double click / arrow | Expands the parameter table, byte offsets and hex |
| **Disassembly** | Click `var_N` | Jumps to the operation that defines that variable |
| **Structure ▸ Layers 3D** | Drag | Orbits about the centre of the view |
| **Structure ▸ Layers 3D** | Shift-drag, middle-drag, right-drag | Pans |
| **Structure ▸ Layers 3D** | Scroll / pinch | Zooms, anchored on the cursor |
| **Structure ▸ Layers 3D** | Click a quad | Selects the component and fills in the box model |
| **DAG** | Click node | Highlights upstream ancestors (green) and downstream dependents (purple) |
| **DAG** | Click empty canvas | Deselects |
| **DAG** | Drag | Pans the graph |
| **DAG** | Scroll / pinch | Zooms, anchored on the cursor |
| **DAG minimap** | Click / drag | Pans the graph to that world location |
| **Runtime ▸ Profiler** | Click instance row | Locates the operation in Disassembly and the DAG |
| **Runtime ▸ Interaction** | **Fire** | Dispatches through the engine's hit-testing, as a real tap would |
