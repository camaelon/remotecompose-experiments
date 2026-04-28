# RemoteContext & RemoteComposeState — Data Table System

## Overview

The RemoteContext system is the runtime heart of RemoteCompose playback. It manages
ID-keyed tables of data (floats, colors, text, bitmaps, paths, etc.) that operations
read from and write to during document execution.

```
 ┌──────────────┐        ┌──────────────────────┐
 │  Operations  │──call──▶   RemoteContext       │  (abstract)
 │  (parsed     │        │   loadFloat()         │
 │   from .rc)  │        │   loadColor()         │
 │              │        │   getText()  ...      │
 └──────────────┘        └──────────┬───────────┘
                                    │ delegates to
                         ┌──────────▼───────────┐
                         │  RemoteComposeState   │  (data tables)
                         │  mFloatMap            │
                         │  mColorMap            │
                         │  mIntDataMap (text,   │
                         │    bitmaps...)        │
                         │  mPathData            │
                         │  mCollectionMap       │
                         │  ...                  │
                         └──────────────────────┘
```

## Architecture

### RemoteContext (abstract base)
- Declares all abstract data operations (loadFloat, loadColor, loadText, etc.)
- Holds references to CoreDocument, PaintContext, RemoteComposeState
- Manages animation time, density, theme, and debug state
- Defines 37 system variable IDs (time, layout, touch, sensors)
- Provides NaN-encoded float constants for expression references
- Tracks execution mode (DATA / PAINT / UNSET)
- Enforces 20,000 operations-per-frame safety limit

### RemoteComposeState (concrete data store)
- Contains all the actual ID → value maps:
  - `mFloatMap` (IntFloatMap) — float values
  - `mIntegerMap` (IntIntMap) — integer values
  - `mColorMap` (IntIntMap) — ARGB color values
  - `mIntDataMap` (IntMap) — general objects (text strings, bitmaps)
  - `mObjectMap` (IntMap) — generic object storage (fonts, shaders)
  - `mPathData` (IntMap) — float arrays for paths
  - `mPathMap` (IntMap) — platform-specific path objects
  - `mCollectionMap` (IntMap) — array/list collections
  - `mDataMapMap` (IntMap) — structured data maps
- Implements variable listener system (reactive updates)
- Manages override tracking (data, float, integer, color)
- Provides ID generation (starting at START_ID=42)

### WebRemoteContext (concrete implementation for browser)
- Extends RemoteContext with Canvas2D-specific behavior
- Bridges to CanvasPaintContext for bitmap/text/path loading
- Implements named variable tracking for host-side overrides
- Routes loadBitmap/loadText through the paint context

## Data Flow

### Initialization (ContextMode.DATA)
1. Header operation sets document dimensions and version
2. Data operations execute: TextData, BitmapData, FloatConstant, ColorConstant, etc.
3. Each calls context.loadText(id, text), context.loadFloat(id, value), etc.
4. RemoteComposeState caches all values in its maps
5. Operations with expressions call context.listensTo(id, this) to register

### Rendering (ContextMode.PAINT)
1. CoreDocument.paint() iterates all operations
2. Draw operations check mMode === DATA and skip if so
3. Operations read values: context.getFloat(id), context.getText(id), etc.
4. Values resolve through RemoteComposeState maps
5. NaN-encoded float IDs resolve to system variables or user variables

## System Variable IDs

IDs 1–37 are reserved for system variables. Operations reference them via
NaN-encoded floats (Utils.asNan(id)):

| ID | Name | Description |
|----|------|-------------|
| 1 | CONTINUOUS_SEC | Seconds from midnight, 0–3600 (looping) |
| 2 | TIME_IN_SEC | Seconds from midnight, quantized 0–3599 |
| 3 | TIME_IN_MIN | Minutes from midnight, 0–1439 |
| 4 | TIME_IN_HR | Hours from midnight, 0–23 |
| 5 | WINDOW_WIDTH | Viewport width in pixels |
| 6 | WINDOW_HEIGHT | Viewport height in pixels |
| 7 | COMPONENT_WIDTH | Current component width |
| 8 | COMPONENT_HEIGHT | Current component height |
| 9 | CALENDAR_MONTH | Month 1–12 |
| 10 | OFFSET_TO_UTC | UTC offset in seconds |
| 11 | WEEK_DAY | Day of week 1–7 (Monday=1) |
| 12 | DAY_OF_MONTH | Day 1–31 |
| 13–14 | TOUCH_POS_X/Y | Touch position |
| 15–16 | TOUCH_VEL_X/Y | Touch velocity |
| 17–19 | ACCELERATION_X/Y/Z | Accelerometer (m/s^2) |
| 20–22 | GYRO_ROT_X/Y/Z | Gyroscope (rad/s) |
| 23–25 | MAGNETIC_X/Y/Z | Magnetometer (uT) |
| 26 | LIGHT | Ambient light (lux) |
| 27 | DENSITY | Display density |
| 28 | API_LEVEL | Build number |
| 29 | TOUCH_EVENT_TIME | Touch event timestamp |
| 30 | ANIMATION_TIME | Animation time (seconds) |
| 31 | ANIMATION_DELTA_TIME | Frame delta time |
| 32 | EPOCH_SECOND | Seconds since epoch |
| 33 | FONT_SIZE | Default font size |
| 34 | DAY_OF_YEAR | Day 1–366 |
| 35 | YEAR | Year (e.g. 2026) |
| 36 | FIRST_BASELINE | First text baseline |
| 37 | LAST_BASELINE | Last text baseline |

## Variable Listener System

Operations that depend on variable values implement `VariableSupport`:

```typescript
interface VariableSupport {
    registerListening(context: RemoteContext): void;
    updateVariables(context: RemoteContext): void;
    markDirty(): void;
}
```

When a variable changes (via updateFloat/updateColor/etc.), RemoteComposeState
notifies all registered listeners by calling `markDirty()`. On the next frame,
dirty operations recompute via `updateVariables()`.

## Override System

Host applications can override document values at runtime:

- **Named variables**: `setNamedColorOverride("primaryColor", 0xFF0000FF)`
  resolves via `namedVariables` map → ID → `mRemoteComposeState.overrideColor(id, color)`
- **Override tracking**: `mFloatOverride[id]` / `mIntegerOverride[id]` / `mDataOverride[id]`
  prevent document operations from overwriting host-set values
- **Clear**: `clearNamedFloatOverride(name)` removes the override, restoring document default

## CollectionsAccess

RemoteComposeState implements the collections interface for expression engines:

```typescript
getFloatValue(id: number, index: number): number
getListLength(id: number): number
```

Collections are registered by DataListIds, DataListFloat operations and accessed
by expressions evaluating array lookups.

## Map Utility Classes

All maps use open-addressing hash tables with linear probing:

- **IntMap<T>** — int keys → generic values (null = not present)
- **IntFloatMap** — int keys → float values (0 = default)
- **IntIntMap** — int keys → int values (0 = default)

Key sentinel: `NOT_PRESENT = -2147483648` (Integer.MIN_VALUE)
