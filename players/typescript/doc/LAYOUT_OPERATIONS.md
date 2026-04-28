# Layout Operations

## Overview

RemoteCompose uses a tree of layout components to arrange UI elements. The layout system is modeled after Compose's `Box`, `Row`, and `Column` containers, with a `Canvas` variant for drawing operations. Each layout manager reads child operations until a `ContainerEnd` (opcode 214) marker.

## Component Hierarchy

```
Operation (abstract)
  └── Component (layout base, implements Container)
        ├── LayoutComponentContent (opcode 201) — child content marker
        ├── CanvasContent (opcode 207) — canvas drawing marker
        └── LayoutComponent (measurable)
              ├── RootLayoutComponent (opcode 200) — document root
              └── LayoutManager (abstract base for layout managers)
                    ├── BoxLayout (opcode 202)
                    ├── RowLayout (opcode 203)
                    ├── ColumnLayout (opcode 204)
                    └── CanvasLayout (opcode 205) — extends BoxLayout
```

## Operation Stream Structure

Layout operations use a **nested container pattern**. Each layout manager opens a scope, followed by modifiers, content, children, and a `ContainerEnd`:

```
[BoxLayout]                   ← opcode 202
  [Modifier]*                 ← width, height, padding, etc.
  [LayoutComponentContent]    ← opcode 201 (child content begins)
    [child operations]*       ← nested layout components or draw ops
  [ContainerEnd]              ← opcode 214 (closes LayoutComponentContent)
[ContainerEnd]                ← opcode 214 (closes BoxLayout)
```

For canvas components:
```
[CanvasLayout]                ← opcode 205
  [Modifier]*                 ← width, height, etc.
  [LayoutComponentContent]    ← opcode 201
    [CanvasContent]           ← opcode 207 (drawing commands begin)
      [draw operations]*      ← DrawRect, DrawText, etc.
    [ContainerEnd]            ← opcode 214 (closes CanvasContent)
    [child components]*       ← nested layout components
  [ContainerEnd]              ← opcode 214 (closes LayoutComponentContent)
[ContainerEnd]                ← opcode 214 (closes CanvasLayout)
```

---

## Binary Formats

### RootLayoutComponent (Opcode 200)

```
[opcode:1] [componentId:INT:4]
```

Total payload: **4 bytes**

The root of the layout tree. Always has componentId=-1 in practice.

---

### LayoutComponentContent (Opcode 201)

```
[opcode:1] [componentId:INT:4]
```

Total payload: **4 bytes**

Structural marker — wraps the child operations inside a layout manager. Created with zero dimensions; actual dimensions are computed during layout pass.

---

### BoxLayout (Opcode 202)

```
[opcode:1] [componentId:INT:4] [animationId:INT:4] [horizontalPositioning:INT:4] [verticalPositioning:INT:4]
```

Total payload: **16 bytes** (4 ints)

**Fields:**
- `componentId`: Unique ID for this component in the tree
- `animationId`: ID for animation (-1 if none)
- `horizontalPositioning`: Child horizontal alignment
- `verticalPositioning`: Child vertical alignment

**Positioning Constants:**

| Value | Name | Horizontal | Vertical |
|-------|------|------------|----------|
| 1 | START | Left align | Top align |
| 2 | CENTER | Center | Center |
| 3 | END | Right align | — |
| 4 | TOP | — | Top align |
| 5 | BOTTOM | — | Bottom align |

**Behavior:** Children are stacked on top of each other (like CSS `position: relative` with stacking). Each child is positioned according to the alignment settings. Box sizes to its largest child (wrap content) or fills available space.

---

### RowLayout (Opcode 203)

```
[opcode:1] [componentId:INT:4] [animationId:INT:4] [horizontalPositioning:INT:4] [verticalPositioning:INT:4] [spacedBy:FLOAT:4]
```

Total payload: **20 bytes** (4 ints + 1 float)

**Fields:**
- `componentId`: Unique ID for this component
- `animationId`: ID for animation (-1 if none)
- `horizontalPositioning`: Child horizontal arrangement
- `verticalPositioning`: Child vertical alignment
- `spacedBy`: Spacing between children (in pixels/dp)

**Additional Positioning Constants (beyond Box):**

| Value | Name | Description |
|-------|------|-------------|
| 6 | SPACE_BETWEEN | Equal gaps between items, none at edges |
| 7 | SPACE_EVENLY | Equal spacing including edges |
| 8 | SPACE_AROUND | Equal spacing around each item |

**Behavior:** Children are laid out horizontally left-to-right. Supports weight-based sizing (children with horizontal fill weight share remaining space proportionally).

---

### ColumnLayout (Opcode 204)

```
[opcode:1] [componentId:INT:4] [animationId:INT:4] [horizontalPositioning:INT:4] [verticalPositioning:INT:4] [spacedBy:FLOAT:4]
```

Total payload: **20 bytes** (4 ints + 1 float)

Identical binary format to RowLayout. Same positioning constants.

**Behavior:** Children are laid out vertically top-to-bottom. Supports weight-based sizing (children with vertical fill weight share remaining space).

---

### CanvasLayout (Opcode 205)

```
[opcode:1] [componentId:INT:4] [animationId:INT:4]
```

Total payload: **8 bytes** (2 ints)

**Fields:**
- `componentId`: Unique ID for this component
- `animationId`: ID for animation (-1 if none)

**Behavior:** Extends BoxLayout. Can contain both drawing operations (via CanvasContent) and child components. Supports two API structures for backward compatibility:
- **Old (API ≤ 7):** CanvasLayout → Modifiers → LayoutComponentContent → CanvasContent → DrawInstructions
- **New (API > 7):** CanvasLayout → Modifiers → LayoutComponentContent → DrawInstructions → Components

---

### CanvasContent (Opcode 207)

```
[opcode:1] [componentId:INT:4]
```

Total payload: **4 bytes**

Structural marker wrapping drawing commands inside a CanvasLayout.

---

### ContainerEnd (Opcode 214)

```
[opcode:1]
```

Total payload: **0 bytes** (no fields)

Marker indicating the end of a container's children.

---

## TS Implementation Status

| Opcode | Name | TS Status | Impact |
|--------|------|-----------|--------|
| 200 | RootLayoutComponent | Registered, read() works | OK |
| 201 | LayoutComponentContent | **NOT IMPLEMENTED** | Blocker |
| 202 | BoxLayout | **NOT IMPLEMENTED** | Blocker (32 samples) |
| 203 | RowLayout | **NOT IMPLEMENTED** | Blocker |
| 204 | ColumnLayout | **NOT IMPLEMENTED** | Blocker (5 samples) |
| 205 | CanvasLayout | **NOT IMPLEMENTED** | Blocker (11 samples) |
| 207 | CanvasContent | **NOT IMPLEMENTED** | Blocker |
| 214 | ContainerEnd | Registered, works | OK |

### What's Needed for Parsing (Not Full Layout)

To stop the parser from desyncing on layout operations, we only need to implement `read()` methods that consume the correct number of bytes. Full layout/measure/paint can be stubbed.

**Minimum implementation per component:**
1. Define the class with `static readonly OP_CODE`
2. Implement `static read(buffer, operations)` that reads exact bytes per the format above
3. Register in Operations.ts

This will allow the parser to correctly skip over layout operations and continue parsing subsequent operations (draw commands, data, expressions) that come after.

---

## Authoritative Sources

| Source | Path | Purpose |
|--------|------|---------|
| BoxLayout.java | `remote-core/.../operations/layout/managers/` | Box read/write, layout logic |
| RowLayout.java | `remote-core/.../operations/layout/managers/` | Row read/write, layout with spacing/weights |
| ColumnLayout.java | `remote-core/.../operations/layout/managers/` | Column read/write, layout with spacing/weights |
| CanvasLayout.java | `remote-core/.../operations/layout/managers/` | Canvas read/write, drawing container |
| LayoutComponentContent.java | `remote-core/.../operations/layout/` | Content marker |
| CanvasContent.java | `remote-core/.../operations/layout/` | Canvas content marker |
| Component.java | `remote-core/.../operations/layout/` | Base class, container semantics |
