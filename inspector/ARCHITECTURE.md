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

The inspector source code is structured as follows:

```
inspector/
├── build.mjs                      # Production bundler (esbuild IIFE + single-file injection)
├── mcp-server.mjs                 # Headless Chrome CDP Model Context Protocol server
├── remote_compose_player.js       # Generated: player engine bundled from players/typescript/
├── RemoteComposeSerializer.js     # Binary encoder & decompiler engine
├── dist/                          # Generated distribution bundle
│   └── index.html                 # Self-contained single-file inspector (243 KB)
└── src/
    ├── index.html                 # HTML shell and panel DOM templates
    ├── main.js                    # Core event bus and document loader
    ├── styles/
    │   └── main.css               # Dark theme layout styles
    └── panels/
        ├── CommandListPanel.js    # Disassembly, hex offsets & variable reachability
        ├── ComponentTreePanel.js  # Static and running post-inflation component trees
        ├── DependencyGraphPanel.js# RPN DAG graph analyzer & dead-code island detection
        ├── DocumentLoader.js      # Drag-and-drop, URL parameter fetcher & array buffer parsing
        ├── DocumentStatsPanel.js  # Document byte distribution & opcode KPI cards
        ├── JsonEditorPanel.js     # CodeMirror editor, JSON decompiler & live recompiler
        ├── LayoutManager.js       # Workspace resizers, panel toggles & instance lookup
        ├── ProfilerPanel.js       # Opcode frequency and microsecond timing measurement
        ├── StagePanel.js          # Stage sizing, density presets & operation stepper
        ├── VariablesPanel.js      # Variable inspector & real-time oscilloscope graphing
        └── BinaryTreemapPanel.js  # Squarified binary treemap & byte allocation analyzer
```

---

## 4. Headless Chrome CDP Bridge (`Option A`)

The MCP server uses **Chrome DevTools Protocol (CDP)** over a temporary loopback WebSocket to evaluate RemoteCompose documents headlessly without needing any network ports exposed on public interfaces:

1. **Process Isolation:** The MCP server launches `/Applications/Google Chrome.app` in headless mode (`--headless=new --remote-debugging-port=94xx`).
2. **Binary Injection:** The `.rc` binary is converted to base64 and loaded via `window.loadRcArrayBuffer(bytes.buffer, fileName)` inside the page context.
3. **Execution & Extraction:** The MCP server invokes the modular analysis functions on `window` and extracts structured JSON results directly over the CDP `Runtime.evaluate` channel.
4. **Clean Teardown:** Headless Chrome terminates automatically upon command completion.

---

## 5. Model Context Protocol (MCP) Tools Registry

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

## 6. Build Workflow

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
