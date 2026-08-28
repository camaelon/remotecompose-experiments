# RemoteCompose MCP Server & LLM Insights Guide

This guide explains how to connect AI coding assistants (Antigravity, Claude Desktop, Cursor) to the **RemoteCompose Inspector MCP Server** (`mcp-server.mjs`), how to automate deep `.rc` document diagnostics via LLMs, and how to integrate headless inspections into CI presubmit pipelines.

---

## 1. Overview: The RemoteCompose MCP Engine

The RemoteCompose Inspector provides an official **Model Context Protocol (MCP)** server that exposes the internal parser, layout engine, canvas renderer, and performance profiler directly to AI assistants.

With this server, LLMs are no longer limited to guessing binary behavior from text dumps. Instead, they can:
- 📊 **Audit Dead Code & Reachability:** Discover unreferenced variables and calculate exact byte reductions.
- 🌳 **Inspect Component Trees:** Decompile binary layouts into structured UI hierarchies (`Column`, `Row`, `Box`, `Modifiers`).
- 📸 **Perform Multimodal Visual QA:** Render documents to high-resolution PNG images to spot clipping, text wrapping, and theme contrast bugs.
- ⏱️ **Profile Microsecond Latency:** Execute $N$-frame benchmarks to measure average, median, p95, and p99 frame times, FPS, and hot-spot operations.

---

## 2. Setting Up the MCP Server

### A. Claude Desktop Configuration
Add the server definition to your `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "remotecompose-inspector": {
      "command": "/Users/nicolasroard/.gradle/nodejs/node-v22.0.0-darwin-arm64/bin/node",
      "args": [
        "/Users/nicolasroard/androidx-main-secondary/frameworks/support/compose/remote/Documentation/inspector/mcp-server.mjs"
      ]
    }
  }
}
```

### B. Cursor / VS Code MCP Configuration
Add the server entry to your project's `.cursor/mcp.json` or MCP settings:

```json
{
  "mcpServers": {
    "remotecompose": {
      "command": "node",
      "args": ["inspector/mcp-server.mjs"]
    }
  }
}
```

### C. Direct CLI Execution (Automated Scripts & CI)
The server can also be invoked directly from the terminal or shell scripts:

```bash
# Node environment setup
export PATH=/Users/nicolasroard/.gradle/nodejs/node-v22.0.0-darwin-arm64/bin:$PATH
cd /Users/nicolasroard/androidx-main-secondary/frameworks/support/compose/remote/Documentation/inspector

# 1. Inspect operations and dead code
node mcp-server.mjs --inspect samples/02_ticker.rc

# 2. Decompile UI Component Tree
node mcp-server.mjs --decompile samples/02_ticker.rc

# 3. Capture visual PNG screenshot
node mcp-server.mjs --screenshot samples/02_ticker.rc

# 4. Run 60-frame microsecond performance benchmark
node mcp-server.mjs --profile samples/02_ticker.rc --frames 60

# 5. Analyze binary byte allocation and treemap categories
node mcp-server.mjs --treemap samples/02_ticker.rc
```

---

## 3. Tool Reference

| MCP Tool Name | Description | Key Parameters |
| :--- | :--- | :--- |
| **`rc_inspect_document`** | Complete disassembly, opcode breakdown, document dimensions, and variable usage statistics. | `filePath` *(string, required)* |
| **`rc_analyze_dead_code`** | Pinpoints exact unreferenced variable IDs, dead-code calculation islands, and removable operation indices. | `filePath` *(string, required)* |
| **`rc_analyze_binary_treemap`** | Hierarchical byte allocation treemap, category breakdown (Header, Layout, Modifiers, Text, Paths, State, Draw, Bitmaps), and top space-consuming operations. | `filePath` *(string, required)* |
| **`rc_decompile_tree`** | Decompiles binary stream into logical layout hierarchy (`RootLayoutComponent`, `BoxLayout`, `ColumnLayout`, `Modifiers`, `DrawOps`). | `filePath` *(string, required)* |
| **`rc_render_screenshot`** | Headlessly renders the canvas and saves a full-resolution PNG image to the artifact directory for visual analysis. | `filePath` *(string, required)*, `outputName` *(string, optional)* |
| **`rc_profile_performance`** | Executes $N$ frames under the profiler and returns average, median, p95/p99 latency (ms), FPS, and hot-spot operations. | `filePath` *(string, required)*, `frameCount` *(number, optional)*, `warmupFrames` *(number, optional)* |

---

## 4. Five Core LLM Analysis Workflows

### Workflow 1: Dead Code & Stream Compaction Audit 🧹
Ask the LLM to inspect any `.rc` file for unreachable variables or redundant initialization loops.

**Example Prompt:**
> *"Audit `samples/ScreenshotTest_screenshotTest_pixel_6_night.rc` for dead code and explain where the binary bloat is coming from."*

**What the LLM does:**
1. Calls `rc_analyze_dead_code` to detect unused variable clusters.
2. Identifies that **119 out of 152 state variables (78.3%)** are never consumed.
3. Points out that 14-element arrays were initialized with 14 sequential `UpdateDynamicFloatList` commands instead of a single `DataFloatArray` payload.
4. Generates an optimization plan to reduce file size by ~50%.

---

### Workflow 2: Multimodal Visual QA & Layout Bounds Verification 📸
Ask the LLM to render and visually inspect a component for layout bugs, text truncation, or viewport clipping.

**Example Prompt:**
> *"Take a screenshot of `samples/ScreenshotTest_screenshotTest_pixel_6_night.rc` and verify if the layout fits inside its declared dimensions."*

**What the LLM does:**
1. Calls `rc_render_screenshot` to generate `ScreenshotTest_screenshotTest_pixel_6_night_rendered.png`.
2. Inspects the rendered image visually using multimodal vision.
3. Detects that the header declares `300×300 px`, but the container has `WidthModifier(475)` and `HeightModifier(541)`, causing the bottom card (`"Light rain"`) and secondary weather metrics to be clipped.
4. Recommends setting the header to `480×560` or using `MATCH_PARENT` sizing.

---

### Workflow 3: Hierarchical Component Architecture Review 🌳
Ask the LLM to analyze the logical layout structure and suggest modifier simplifications or accessibility improvements.

**Example Prompt:**
> *"Decompile `samples/02_ticker.rc` and review its component hierarchy for accessibility and modifier efficiency."*

**What the LLM does:**
1. Calls `rc_decompile_tree` to extract the JSON layout tree.
2. Evaluates the nested `ColumnLayout` and `BoxLayout` containers.
3. Flags missing accessibility content descriptions on interactive and dynamic text nodes.

---

### Workflow 4: Microsecond Real-Time Frame Profiling & Jank Detection ⏱️
Ask the LLM to benchmark frame execution times to ensure smooth 60Hz or 120Hz playback on target devices.

**Example Prompt:**
> *"Profile `samples/02_ticker.rc` over 60 frames and tell me if it meets the 120Hz display target."*

**What the LLM does:**
1. Calls `rc_profile_performance` with `frameCount: 60`.
2. Evaluates the benchmark results:
   - **Average Frame Latency:** `1.097 ms` (capable of **912 FPS** $\rightarrow$ comfortably exceeds 120Hz requirement of $< 8.33\text{ ms}$).
   - **Ops Per Frame:** `1,035 ops/frame`.
   - **Hot Spot:** Discovers that instances `#127–#131` (dynamic digit loop) execute **154 times per frame**.

---

### Workflow 5: Automated CI Presubmit Quality Gate 🚀
Integrate the MCP CLI tool into your GitHub Actions / Gerrit presubmit script to catch regressions automatically:

```bash
#!/usr/bin/env bash
# CI Quality Gate for RemoteCompose Binary Outputs

FAIL=0
for rc_file in out/screenshots/*.rc; do
  echo "Checking $rc_file..."
  
  # Run performance profiler
  PERF_JSON=$(node inspector/mcp-server.mjs --profile "$rc_file" --frames 30)
  AVG_MS=$(echo "$PERF_JSON" | grep -o '"averageFrameTimeMs": [0-9.]*' | awk '{print $2}')
  
  # Fail if average frame time exceeds 8.33ms (120Hz threshold)
  if (( $(echo "$AVG_MS > 8.33" | bc -l) )); then
    echo "❌ ERROR: $rc_file frame latency (${AVG_MS}ms) exceeds 8.33ms budget!"
    FAIL=1
  fi
done

exit $FAIL
```

---

## 5. Summary of Benefits

- **Zero Web Client Bloat:** The browser UI (`dist/index.html`) stays 100% lean, fast, and static.
- **Accurate Ground Truth:** The LLM uses the exact same `RcdPlayer` renderer and `RemoteComposeSerializer` decompiler as the browser.
- **Autonomous Fixing:** Enables the AI assistant to detect, diagnose, benchmark, and optimize RemoteCompose streams in a single conversational turn.
