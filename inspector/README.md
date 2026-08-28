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
- [Panel Overview](#panel-overview)
  - [Pane 1: Command List & Tree](#pane-1-command-list--tree)
  - [Pane 2: Operations & Payload Details](#pane-2-operations--payload-details)
  - [Pane 3: RemoteCompose Live Canvas Player](#pane-3-remotecompose-live-canvas-player)
  - [Pane 5: State & Variable Inspector](#pane-5-state--variable-inspector)
  - [Pane 8: Profiler & Operation Measurement Engine](#pane-8-profiler--operation-measurement-engine)
  - [Pane 9: Expression Dependency Graph](#pane-9-expression-dependency-graph)
- [Deep Dive: Profiler & Performance Optimization (Pane 8)](#deep-dive-profiler--performance-optimization-pane-8)
  - [Understanding Profiler Metrics](#understanding-profiler-metrics)
  - [Ranking Modes: Last, Total, and Peak](#ranking-modes-last-total-and-peak)
  - [Operation Instance Deep-Linking](#operation-instance-deep-linking)
  - [Step-by-Step Performance Profiling Workflow](#step-by-step-performance-profiling-workflow)
- [Deep Dive: Expression Dependency Graph & Document Analysis (Pane 9)](#deep-dive-expression-dependency-graph--document-analysis-pane-9)
  - [Workflow 1: Dead-Code Identification & Binary Optimization](#workflow-1-dead-code-identification--binary-optimization)
  - [Workflow 2: Interactive Animation & Formula Simulation (`🎛️ Live Simulator`)](#workflow-2-interactive-animation--formula-simulation-️-live-simulator)
  - [Workflow 3: Bottleneck & Latency Tracing (`🔥 Critical Path`)](#workflow-3-bottleneck--latency-tracing--critical-path)
  - [Workflow 4: Deep Subgraph Exploration & Focused Debugging](#workflow-4-deep-subgraph-exploration--focused-debugging)
  - [Workflow 5: Visual Navigation via Minimap (`🗺️ Minimap`)](#workflow-5-visual-navigation-via-minimap-️-minimap)
- [Mouse & Keyboard Controls](#mouse--keyboard-controls)

---

## Architecture & MCP Server Guides

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
   - View live canvas rendering in the center pane.
   - Profile frame performance and operation throughput in Pane 8.
   - Explore expression calculations and critical execution paths in the Expression Dependency Graph (Pane 9).

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

---

## Panel Overview

### Pane 1: Command List & Tree

Displays all operations contained within the RemoteCompose document.

- **Display Modes**:
  - **📋 Compact Mode**: Groups operations hierarchically, indenting child operations within layout containers (`RootLayoutComponent`, `BoxLayout`, `CanvasLayout`).
  - **🔍 Detailed Mode**: Lists every operation flat with full opcode numbers, payload byte offsets, and hex dumps.
- **Search & Filtering**: Search by opcode ID, opcode name (e.g. `DrawRect`, `MatrixRotate`), or property value. Filter by opcode type using dropdown filters.
- **Command Selection**:
  - **Single Click**: Selects the operation, highlights it in Pane 1, and centers/highlights the corresponding node in Pane 9 (Expression Dependency Graph).
  - **Double Click or Arrow Click**: Expands or collapses detailed operation properties inline.
- **Unused Badges (`⚠️ Unused`)**: Highlights operations that belong to unconsumed expression islands and do not contribute to canvas rendering.

---

### Pane 2: Operations & Payload Details

Displays detailed byte payload structures, property key/value pairs, raw bits, and visual path data previews.

- **Path Data Preview**: Automatically renders vector path commands (`MoveTo`, `LineTo`, `CubicTo`, `QuadTo`) as interactive 2D previews.
- **IEEE-754 NaN Bit Decoder**: Displays raw bit representations (`0x7f800000 | varId`) for float-encoded expression variable references.

---

### Pane 3: RemoteCompose Live Canvas Player

Provides interactive real-time visual playback of the RemoteCompose document.

- **Controls**:
  - **Play / Pause (`▶` / `⏸`)**: Toggles real-time state variable animation (e.g. `$TIME` advancement).
  - **Step Forward (`⏭`)**: Advances playback by a single frame.
  - **Reset (`🔄`)**: Resets state variables to default initial values.
- **Canvas Interaction**: Zoom and pan the canvas preview to inspect high-resolution vector drawing details.

---

### Pane 5: State & Variable Inspector

Lists all active variables stored in `RemoteComposeState`.

- **Categories**: Float Variables, Integer Variables, Color Variables, Path Variables, and String Resources.
- **Live State Overrides**: Edit variable values directly in input fields to override engine state and trigger instant canvas repainting.

---

### Pane 8: Profiler & Operation Measurement Engine

Measures real-time per-frame execution workload, operation throughput, and rendering invariants.

- **Sparkline Waveform**: Plots operation volume across the last 600 frames to visualize rendering stability and burst spikes.
- **Opcode & Instance Breakdown**: Ranks operation types and individual instances by execution frequency.
- **Invariants Engine**: Automatically verifies that per-type and per-instance operation totals match total ops per frame (`getOpsPerFrame()`).

---

### Pane 9: Expression Dependency Graph

A full DAG visualizer for expressions, variables, and consumer operations.

- **Node Types**:
  - **🟦 FloatExpr**: `FloatExpression` formulas (e.g. `var_10 = sys_1 * 6.0`).
  - **🟪 IntExpr**: `IntegerExpression` formulas and color expressions.
  - **🟨 SysVar**: System Environment Variables (`sys_1` `$TIME`, `sys_2` `$WIDTH`, `sys_3` `$HEIGHT`, `sys_4` `$ANIMATION`).
  - **🟩 Constant**: Static float or integer constant definitions (`var_1`, `var_2`).
  - **🎨 Consumer**: Drawing, matrix, and modifier operations that consume expression values (`DrawRect`, `MatrixRotate`, `MatrixScale`, `MatrixSkew`).
  - **⚠️ Unused Island**: Dead-code expression nodes that are not consumed by any live rendering path.
- **Multi-Tier Level of Detail (LOD)**:
  - **Full LOD (`≥ 55% Zoom`)**: Displays icon, label, formula text, and live value pill (`Val: 15.00`).
  - **Medium LOD (`30% - 55% Zoom`)**: Displays icon, label, and live value pill.
  - **Low LOD (`< 30% Zoom`)**: Displays compact micro-cards for large zoomed-out overviews.

---

### Pane 10: Binary Treemap & Byte Allocation Visualizer

Visualizes binary file size distribution and byte consumption across semantic opcode categories and individual operations.

- **Squarified 2D Treemap**: Aspect-ratio-optimized hierarchical rectangles representing categories (Header, Layout, Modifiers, Text, Paths, State, Draw, Bitmaps, Control Flow).
- **Drill-down Navigation**: Click any category tile to zoom into its individual operation tiles with live breadcrumb navigation.
- **Ranked Allocation Table**: View and sort all operations by byte size, opcode hex code, and byte offset range (`0x0721..0x0986`).
- **Top 5 Space Consumers**: Quick-access pills highlighting the largest operations in the document.
- **Bidirectional Command List Deep-Linking**:
  - Clicking any tile, table row, or hog pill instantly restores the **Command List (Pane 2)**, selects the operation, expands its properties, and smoothly scrolls to it with a cyan pulse glow animation (`treemap-highlight-pulse`).
  - Selecting any operation in the Command List or Profiler automatically syncs and highlights the corresponding tile/row in the Binary Treemap.

---

## Deep Dive: Profiler & Performance Optimization (Pane 8)

The **Profiler & Op Measurement Panel (Pane 8)** allows document authors and engine developers to measure the exact execution cost of a RemoteCompose document frame by frame.

```
+-----------------------------------------------------------------------------------+
|                        ⏱️ Profiler & Op Measurement (Pane 8)                      |
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

Use the **Rank Mode** dropdown in Pane 8 to sort opcode and instance tables:

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
  1. Instantly locates and highlights the operation in the **Command List (Pane 1)**.
  2. Centers and zooms the corresponding node in the **Expression Dependency Graph (Pane 9)**.
  3. Displays detailed byte offsets and properties in **Pane 2**.

---

### Step-by-Step Performance Profiling Workflow

To optimize a RemoteCompose document using Pane 8:

1. **Start Playback & Observe Sparkline**: Press Play (`▶`) in Pane 3. Observe the green sparkline waveform in Pane 8.
   - *Flat, low waveform*: Document is light and efficient.
   - *Spiky or high waveform*: Document has high per-frame operation volume or periodic rendering spikes.
2. **Identify Heavy Opcode Types**: Inspect the **By Opcode Type** table. Look for high counts of expensive operations:
   - Excessive `MatrixSave` (`#130`) / `MatrixRestore` (`#131`) pairs suggest redundant matrix stack saves.
   - High `FloatExpression` (`#81`) counts suggest complex variable math that could be simplified.
3. **Locate Hotspot Instances**: Switch Rank Mode to **Total** or **Peak** and click top instance rows to jump directly to the offending commands in Pane 1 and Pane 9.
4. **Verify Engine Invariants**: Ensure the green **Invariants Status** bar reports `Invariants hold`. If `INVARIANT FAILED` appears, one or more custom operations are not properly reporting their frame execution counts.

---

## Deep Dive: Expression Dependency Graph & Document Analysis (Pane 9)

The **Expression Dependency Graph (Pane 9)** translates flat document opcode lists into an interactive directed acyclic graph (DAG). It is designed specifically to analyze mathematical formulas, trace variable state flows, and clean up bloated documents.

```
+-----------------------------------------------------------------------------------+
|                        🧬 Expression Dependency Graph (Pane 9)                    |
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
2. **Enable `⚠️ Unused First` Sorting**: Click **`⚠️ Unused First`** in the Pane 9 header. This sorts all dead-code islands to the top of graph columns.
3. **Inspect Unused Subgraphs**: Unused nodes and edges are styled with orange dashed strokes (`stroke-dasharray="5 3"`).
4. **Prune Document**: Remove the unused variable IDs from your source layout definition to reduce binary file size and decrease engine initialization time.

---

### Workflow 2: Interactive Animation & Formula Simulation (`🎛️ Live Simulator`)

Test animation behavior and inspect expression calculations in real-time without re-compiling the document.

#### How to Simulate Variable State:
1. **Open Simulator**: Click **`🎛️ Live Simulator`** in the Pane 9 header to open the range slider tray.
2. **Adjust System Variables**:
   - Drag **`$TIME (sys_1)`** (0s to 60s) to simulate clock hand motion or time-based animations.
   - Drag **`$ANIMATION (sys_4)`** (0.0 to 1.0) to test transition progress bars or entrance animations.
   - Drag **`$WIDTH (sys_2)`** or **`$HEIGHT (sys_3)`** to test responsive layout resizing.
3. **Observe Live Graph Feedback**:
   - Every node card in Pane 9 displays a live green value pill (`Val: 15.00`).
   - Dragging a slider updates all downstream expression pills and repaints the Live Canvas Player (Pane 3) synchronously.
4. **Test Edge Cases**: Move sliders to extreme bounds (`$TIME = 0`, `$WIDTH = 0`, `$ANIMATION = 1.0`) to check for `NaN` values, divide-by-zero errors, or broken layout math.

---

### Workflow 3: Bottleneck & Latency Tracing (`🔥 Critical Path`)

Complex RemoteCompose documents with deeply nested `FloatExpression` chains can introduce latency during frame evaluation.

#### How to Trace Critical Calculation Pipelines:
1. **Enable Critical Path**: Click **`🔥 Critical Path`** in the Pane 9 header.
2. **Identify Deepest Chain**: The engine runs a topological longest-path algorithm ($O(V + E)$) and highlights the deepest calculation stack in glowing gold (`#f59e0b`).
3. **Inspect Step Evaluation Badges**: Connection arrows display live evaluation step chips directly on the curve midpoints (`10.00 ➔ var_11`).
4. **Optimize Pipeline**: Simplify multi-stage expression chains (e.g. `sys_1 ➔ var_10 ➔ var_11 ➔ var_12 ➔ MatrixRotate`) by folding constant math terms or combining redundant expressions into single `FloatExpression` operations.

---

### Workflow 4: Deep Subgraph Exploration & Focused Debugging

Isolate specific components or variables within large DAG graphs containing 100+ nodes.

#### How to Isolate Subgraphs:
1. **Select Node**: Click any node card in Pane 9 or any operation in Pane 1.
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

1. **Overview Radar**: Located in the bottom-right corner of Pane 9. Shows a color-coded thumbnail of all graph nodes.
2. **Viewport Finder Box**: The semi-transparent cyan rectangle (`#exprMinimapViewport`) indicates your current visible canvas area.
3. **Click-to-Center**: Click anywhere inside the minimap to instantly center the main DAG canvas on that position.
4. **Drag Navigation**: Drag the cyan finder box to smoothly pan across large graph layouts.
5. **Collapse**: Click **`−`** in the minimap title bar to collapse it down to a 24px header when not needed.

---

## Mouse & Keyboard Controls

| Context | Action | Behavior |
| :--- | :--- | :--- |
| **Command List (Pane 1)** | Single Click | Selects operation & syncs/centers node in Pane 9 |
| **Command List (Pane 1)** | Double Click / Arrow | Expands inline detailed property breakdown |
| **Dependency Graph (Pane 9)**| Click Node | Selects node, highlights upstream ancestors (green) & downstream dependents (purple) |
| **Dependency Graph (Pane 9)**| Click Empty Canvas | Deselects node selection |
| **Dependency Graph (Pane 9)**| Mouse Drag | Pans the graph canvas |
| **Dependency Graph (Pane 9)**| Mouse Wheel | Zooms in/out with cursor-centered focal scaling |
| **Minimap (Pane 9)** | Pointer Click / Drag | Pans main graph canvas to clicked world location |
| **Profiler (Pane 8)** | Click Instance Row | Locates operation in Pane 1 & centers node in Pane 9 |
