# C++ RemoteCompose Player — Progress

## Milestone 1: WireBuffer + rc2json parsing sample_data ✅

- **Status:** Complete
- **Result:** 80/80 sample_data files parse, 0 field mismatches vs Java rc2json.jar

## Milestone 2: Skia Backend + rc2image rendering sample_data ✅

- **Status:** Complete
- **Result:** 78/79 PNGs pass RMSE < 10% (1 file is corrupt HTML, not a valid .rcd)
- Key components:
  - Skia m143 (HumbleUI/SkiaBuild) integrated via CMake FetchContent
  - PaintContext abstract interface + SkiaPaintContext backend
  - PaintBundle decoder (26 tag types: color, gradient, blend mode, typeface, etc.)
  - CoreDocument two-pass execution (DATA + PAINT)
  - Bitmap loading with SkCodec (PNG/WEBP/JPEG) + raw ARGB/RAW8

### Lessons Learned

1. **Bitmap type/encoding fields:** Java defaults to `TYPE_PNG_8888` when `widthAndType <= 0xFFFF`, not RAW. The `type` field determines pixel format (PNG/RAW8/RAW8888), while `encoding` determines delivery method (inline/URL/file/empty).

2. **Skia m143 API changes:**
   - `SkPath` mutation methods removed → use `SkPathBuilder` + `detach()`
   - `SkFontMgr::RefDefault()` removed → use `SkFontMgr_New_CoreText(nullptr)` on macOS
   - `SkDashPathEffect::Make` needs `SkSpan` overload (3-arg behind `SK_SUPPORT_UNSPANNED_APIS`)

3. **Font initialization:** Must explicitly set a typeface on `SkFont` via `SkFontMgr`. Default constructor creates a font without a usable typeface in m143.

4. **PathData wire format:** `readInt(idAndWinding) + readInt(numFloats) + numFloats * readFloat()`. Winding in upper 8 bits (`id >> 24`), path ID in lower 24 bits (`id & 0xFFFFFF`).

5. **Reference background color:** 0xAABBCC (RGB 170, 187, 204), not white.

## Milestone 3: Parse advanced_samples ✅

- **Status:** Complete
- **Result:** 59/59 advanced_samples parse, 0 field mismatches vs Java rc2json.jar

## Milestone 4: Runtime — Expressions + Layout + Render advanced_samples ✅

- **Status:** Complete
- **Result:** 59/59 render without crashes. ~45 render well/meaningfully at t=0. Remaining ~14 are animation/touch-dependent (blank at t=0) or have minor layout issues that will resolve with the interactive viewer.

### Key Components Implemented

- **RPN Expression evaluator** (`FloatExpression`): Stack-based with 40+ operators (arithmetic, trig, logic, comparisons, array ops, system variables)
- **Layout system**: RootLayoutComponent, BoxLayout, RowLayout, ColumnLayout, CanvasLayout, CoreText, FitBoxLayout, CollapsibleRow/ColumnLayout
- **Layout modifiers**: Width, Height, Padding, Background, Border, Offset, Visibility, ZIndex, GraphicsLayer, RoundedClipRect, AlignBy, DrawContent, LayoutCompute, etc.
- **Container runtime**: LoopOperation, ConditionalOperations with proper DATA+PAINT dual pass per iteration
- **Expression types**: FloatExpression, ColorExpression, IntegerExpression, BooleanExpression, NamedVariable, ComponentValue
- **Text operations**: TextFromFloat, TextMerge, TextLookup, TextTransform, DrawTextAnchored, DrawTextOnPath
- **Path operations**: PathCreate, PathAppend (with NaN variable resolution and append accumulation)
- **Data operations**: DataListFloat, DataListIds, DataMapIds, IdLookup, DataDynamicListFloat
- **Paint NaN variable resolution**: STROKE_WIDTH, TEXT_SIZE, ALPHA, STROKE_MITER now resolve NaN-encoded variable references

### Sample Rendering Assessment (at t=0, 800x800)

**Excellent renders (45+):**
activity_rings, alignment_and_justification, battery_radial_gauge, canvas, check_touch_x, color, demo_graphs0, demo_graphs1, demo_text_transform, double_pendulum_example, experimental_gmt, experimental_solar_gmt, experimental_sweep_clock, fancy_clock2, good_pie_chart, heart_rate_timeline, hydration_wave, linear_regression, moon_phase_dial, pie_chart, plot_wave, plot2, plot3, pressure_gauge, server_clock, shader_calendar, simple_java_anim, sleep_quality_rings, spread_sheet, step_progress_arc, stock_sparkline, stop_absolute_pos, stop_ends, stop_gently, stop_instantly, stop_notches_absolute, stop_notches_even, stop_notches_percents, text_baseline, themed_plot1, thumb_wheel1, thumb_wheel2, touch_wrap, touch1, weather_forecast_bars, base, 2_vtext, balls_animation_example

**Animation/touch-dependent (need interactive viewer):**
cube3d, anchored_text, stock, countdown, count_down, plot4

**Layout issues (minor):**
calendar_heatmap_grid (oversized blocks), paths_demos (sizing), rc_flow (FlowLayout wrapping)

### Bugs Fixed

1. **LoopOperation DATA+PAINT pass**: When LoopOp runs in PAINT mode, expressions inside the loop need a DATA pass per iteration to evaluate with the current loop index. Fixed by running DATA pass on children before PAINT pass for each iteration.

2. **Array ID mismatch in ExpressionEvaluator**: DataListFloat stores under full ID (e.g., 0x200000 | 42 = 2097194), but A_LEN/A_DEREF masked with `& 0xFFFFF` giving 42. Removed the mask.

3. **PathCreate NaN encoding**: Used operator-region NaN (`0x7FD1000A`) but buildPathFromFloats expects simple NaN where `nanId` returns 10 (PATH_MOVE). Fixed to use `0x7FC00000 | cmd`.

4. **PathCreate/PathAppend variable resolution**: Wire data contains NaN-encoded variable references as coordinates. Added resolution from context before building paths.

5. **PathAppend replace vs append**: Each `loadPathData` call replaced the entire path. In a loop, only the last iteration survived. Added `appendPathData` that accumulates raw float data and rebuilds the complete SkPath.

6. **PaintBundle NaN variable resolution**: STROKE_WIDTH, TEXT_SIZE, ALPHA, STROKE_MITER values can be NaN-encoded variable references. Java resolves these via `fixFloatVar()` before applying. Added the same resolution in C++. This fixed activity_rings (thin→thick arcs), sleep_quality_rings, step_progress_arc, and many other samples.

## Milestone 5: GLFW Interactive Viewer ✅

- **Status:** Complete
- **Binary:** `build/apps/viewer/rcviewer`

### Usage

```bash
# Interactive viewer
rcviewer <file.rc | directory> [width height]

# Headless screenshot (single file)
rcviewer --screenshot <file.rc> <output.png> [width height] [delay_sec]

# Batch screenshot (entire directory)
rcviewer --screenshot-dir <dir_of_rc> <output_dir> [width height] [delay_sec]
```

Screenshot mode renders headlessly (no window), simulates animation up to `delay_sec` (default 0.2s), saves a PNG, and exits. Useful for visual regression testing and verifying demo output.

### Features

- **CPU raster rendering** with OpenGL texture upload (reliable, no GPU linking issues)
- **Animation loop**: Updates `ANIMATION_TIME` system variable each frame
- **File cycling**: Left/Right arrows navigate through .rc/.rcd files in directory
- **Keyboard controls**: Space=pause, R=reload, D=debug, S=screenshot, Q/Escape=quit
- **Mouse tracking**: Cursor position available for touch-interactive samples
- **Retina-aware**: Uses window size (not framebuffer) for render dimensions
- **VSync**: 60fps with vsync enabled
- **Title bar**: Shows file index, name, animation time, and pause state
- **Headless screenshot**: `--screenshot` and `--screenshot-dir` flags for batch PNG generation

### Architecture

- GLFW 3.4 window with OpenGL 2.1 context (legacy GL for simplicity)
- Skia raster `SkSurface` renders to CPU pixels
- Pixels uploaded to GL texture via `glTexImage2D` (BGRA format)
- Fullscreen quad draws the texture to the window
- On each frame: update time → render to Skia surface → upload → display

## Variable Dependency System ✅

- **Status:** Complete
- Matches the Java `VariableSupport` / `listensTo` / dirty-tracking architecture

### Components

1. **Operation dirty tracking** (`Operation.h`):
   - `isDirty()` / `markDirty()` / `markNotDirty()` on base Operation class
   - `isVariableSupport()` — override returns true for ops with variable dependencies
   - `registerListening(context)` — register variable dependencies via `context.listensTo(id, this)`
   - `updateVariables(context)` — resolve cached NaN variable references to actual values
   - `isPaintOperation()` — override returns true for draw/matrix/clip/paint ops

2. **RemoteContext listener system** (`RemoteContext.h/.cpp`):
   - All system variable IDs (1–35): CONTINUOUS_SEC, TIME_IN_SEC, ANIMATION_TIME, etc.
   - `listensTo(variableId, op)` — register op as listener for a variable
   - `notifyListeners(variableId)` — marks all listeners dirty when a variable changes
   - All `loadFloat`/`loadInteger`/`loadColor`/etc. call `notifyListeners()` automatically
   - `getRepaintDelay()` — returns frame rate based on which time variables have listeners

3. **TimeVariables** (`TimeVariables.h/.cpp`):
   - Computes wall-clock time (hours, minutes, seconds, epoch, etc.) from `std::chrono`
   - Loads all system time variables into context each frame
   - Drives animation via `ANIMATION_TIME` and `ANIMATION_DELTA_TIME`

4. **PaintBundle mArray/mOutArray caching** (`PaintBundle.h/.cpp`):
   - `mArray` stores original wire data with NaN-encoded variable IDs
   - `mOutArray` stores resolved values after `updateVariables()`
   - `registerVars()` scans for NaN-encoded floats (STROKE_WIDTH, TEXT_SIZE, ALPHA, STROKE_MITER) and color IDs (COLOR_ID, COLOR_FILTER_ID), including GRADIENT/FONT_AXIS/PATH_EFFECT sub-arrays
   - `fixFloatVar()` resolves NaN → `context.getFloat(id)`
   - `getData()` returns `mOutArray` when populated, else `mArray`

5. **Operation overrides** (all 6 groups complete):
   - **Group 1 — DrawBase pattern (7 ops):** DrawRect, DrawCircle, DrawLine, DrawOval, DrawRoundRect, DrawSector, DrawArc — full mOut caching + registerListening + updateVariables
   - **Group 2 — Text/Bitmap draw ops (6 ops):** DrawTextRun, DrawTextAnchored, DrawTextOnPath, DrawBitmap, DrawBitmapScaled, DrawTweenPath — full mOut caching
   - **Group 3 — Matrix + Clip ops (5 ops):** MatrixScale, MatrixTranslate, MatrixRotate, MatrixSkew, ClipRectOp — full mOut caching
   - **Group 4 — Expression/Path ops (8 ops):** PathExpressionOp, PathAppendOp, PathCreateOp, MatrixExpressionOp, MatrixVectorMathOp, MatrixFromPathOp, TextLookupOp, TextTransformOp — registerListening for dependency tracking
   - **Group 5 — Container ops (2 ops):** LoopOperationOp, ConditionalOp — registerListening with recursive child registration
   - **Group 6 — Layout modifier + container ops (15 ops):** ModifierWidth, ModifierHeight, ModifierPadding, ModifierBackground, ModifierBorder, ModifierRoundedClipRect, ModifierWidthIn, ModifierHeightIn, ModifierOffset, ModifierScroll, LayoutRow, LayoutColumn, LayoutFlow, LayoutText, CoreTextOp — full mOut caching + inflateLayout uses resolved values
   - `PaintValues`: isPaintOperation + registerVars/updateVariables via PaintBundle
   - `FloatExpression`, `ColorExpressionOp`, `IntegerExpressionOp`: scan expression arrays for NaN variable refs
   - `TextFromFloat`: registers for the NaN-encoded float ID
   - `TouchExpressionOp`: scans expression arrays

6. **CoreDocument paint cycle** (`CoreDocument.cpp`):
   - `registerListeners(context)` — walks all ops recursively, calls registerListening()
   - `paint()` now runs both DATA re-eval and PAINT passes
   - Calls `updateVariables()` on dirty VariableSupport ops before `apply()`
   - Marks ops as not-dirty after execution

7. **Viewer animation loop** (`viewer/main.cpp`):
   - Persistent `RemoteContext` and `SkiaPaintContext` across frames
   - `TimeVariables::updateTime()` called each frame with animation time + delta
   - Touch/mouse position loaded as system variables
   - `getRepaintDelay()` checked to determine if continuous repaint is needed

## RMSE Comparison: C++ vs TS (advanced_samples) — Session 7

**Average RMSE: 7.2%** across 59 files (3.5% excluding known TS bugs)

### Bugs Fixed This Session

1. **PaintBundle STYLE encoding** (`LayoutOperations.cpp`): `paintBorder()` used `addTag(STYLE, STYLE_STROKE)` which pushed 2 array elements, but the Skia reader expects the style value packed in the upper 16 bits of the tag word. Fixed with `addUpperTag()`. **Impact:** color.rc 21.6% → 0.8%, all bordered components now render correctly.

2. **Density default** (`RemoteContext.h`): Changed `mDensity` from `200/160 = 1.25` to `1.0` to match TS behavior when no `DOC_DENSITY_AT_GENERATION` property is set in the header. **Impact:** linear_regression 25.0% → 1.8%, demo_graphs0 16.5% → 1.0%, weather_forecast_bars 10.1% → 1.0%.

3. **TextAlign support** (`LayoutOperations.cpp paintLayoutComponent`): Added CENTER (3) and RIGHT/END (2/6) alignment for layout text. Previously all text was left-aligned regardless of the textAlign field.

4. **TextLookup collection lookup** (`AdvancedOperations.cpp`): `TextLookupOp::apply()` was just stringifying the index (`std::to_string((int)idx)`) instead of looking up text from the `DataListIds` collection. Fixed to use `getFloatList(dataSet)` → index → get text ID → resolve text. Empty string is a valid result (textId >= 0 check, not text.empty()). **Impact:** spread_sheet and thumb_wheel2 now show correct text labels.

5. **AlignBy modifier** (`LayoutOperations.cpp`): Implemented baseline alignment for Row layouts. Parses modifier 237, computes baselines via `getAlignByValue()`, applies Y offset `maxAlignByValue - thisChildAlignByValue` in Row positioning.

6. **GLFW viewer R/B color swap** (`viewer/main.cpp`): On macOS, Skia N32 = kRGBA_8888 (R at byte 0), but GL upload used `GL_BGRA` format. Changed to `GL_RGBA, GL_UNSIGNED_BYTE`.

7. **Bitmap decoding byte order** (`SkiaPaintContext.cpp`): TYPE_RAW8888 and TYPE_RAW8 used `SkColorSetARGB()` which returns 0xAARRGGBB regardless of platform, but N32 bitmaps on macOS are RGBA. Changed to `SkPreMultiplyARGB()` which returns `SkPMColor` in native N32 byte order.

### Remaining High-RMSE Files (Categorized)

**TS bugs (C++ is correct):**
- demo_graphs1 (56.7%), demo_text_transform (52.1%), alignment_and_justification (47.7%) — TS `TextLayout` opcode 208 is a stub/non-container, corrupts tree structure
- balls_animation_example (50.1%) — TS truncated rendering width
- stock (20.2%) — TS renders only red rectangle
- experimental_sweep_clock (11.4%) — TS `buildPath2D` ignores start/end params (no path trimming)
- demo_use_of_global (7.2%) — TS LAYOUT_TEXT stub misses cyan timer bar

**Rendering engine differences (Skia vs Canvas2D, not fixable):**
- text_baseline (18.6%) — Different font metrics
- hydration_wave (13.0%) — Gradient interpolation
- spread_sheet (10.9%) — Font rendering
- stop_* files (4-6%) — C++ correctly renders dash path effects, TS doesn't
- thumb_wheel2 (7.9%) — Font/scale differences

**Potentially fixable (need more investigation):**
- 2_vtext (25.1%) — Scroll position handling
- shader_calendar (7.0%) — Shader rendering

### Key Architecture Notes

- **Skia N32 on macOS** = `kRGBA_8888_SkColorType` (SK_R32_SHIFT=0). NOT BGRA. Use `GL_RGBA` for OpenGL uploads.
- **SkColorSetARGB** always returns 0xAARRGGBB as uint32 regardless of platform. Do NOT write directly to N32 bitmap pixels — use `SkPreMultiplyARGB` instead.
- **PaintBundle tags with upper-bit encoding**: STYLE, STROKE_CAP, ANTI_ALIAS, BLEND_MODE, STROKE_JOIN — value must be packed as `tag | (value << 16)`, not pushed as a separate array element. Use `addUpperTag()`.
- **TextLookup dataSet IDs** can be large compound values (e.g., 0x20002A = 2097194). The TS masks with `& 0xFFFFF` but C++ uses the full ID — both work because DataListIds stores under the same full ID.
- **Density**: Default should be 1.0 (matching TS). Document may set DOC_DENSITY_AT_GENERATION (header property key 7) to override.

## Integer Expression Evaluator ✅

- **Status:** Complete
- **Files:** `IntegerExpressionEvaluator.h` (new), `AdvancedOperations.h/.cpp` (fixed)

### What Was Broken

The original `IntegerExpressionOp` was fundamentally wrong in three ways:
1. **Read floats from wire** — Java writes `int[]` via `writeInt()`, but C++ read with `readFloat()`, reinterpreting int bits as IEEE 754 floats
2. **Used float ExpressionEvaluator** — which uses NaN-based operator detection at `OFFSET=0x310000`, but integer operators use bitmask-based detection at `OFFSET=0x10000`
3. **Resolved variables via `getFloat()`** — should use `getInteger()`

### What Was Fixed

- Created `IntegerExpressionEvaluator` class with mask-based operator identification matching Java's `IntegerExpressionEvaluator.java`
- All 25 integer operators: ADD, SUB, MUL, DIV, MOD, SHL, SHR, USHR, OR, AND, XOR, COPY_SIGN, MIN, MAX, NEG, ABS, INCR, DECR, NOT, SIGN, CLAMP, IFELSE, MAD, VAR1, VAR2, VAR3
- Fixed `IntegerExpressionOp::read()` to use `readInt()` instead of `readFloat()`
- Fixed `apply()` to use `updateVariables()` with `context.getInteger()` and clear mask bits for resolved IDs
- Fixed `registerListening()` to use `IntegerExpressionEvaluator::isId()` for proper ID detection

### Key Design Difference from Float Expressions

Integer expressions use a completely different evaluation paradigm:
- **Float**: NaN-encoded operators in float array, detected by `isnan()` + region mask
- **Integer**: Bitmask (`mask`) where bit `i` set means `exp[i]` is an operator (value >= `0x10000`) or an ID reference (value < `0x10000`). The `isId()` check: `((1 << i) & mask) != 0 && value < OFFSET`

## FloatExpression Animation System ✅

- **Status:** Complete
- **New files:** `easing/Easing.h`, `easing/CubicEasing.h`, `easing/BounceCurve.h`, `easing/ElasticOutCurve.h`, `easing/MonotonicCurveFit.h`, `easing/StepCurve.h`, `easing/FloatAnimation.h`, `easing/SpringStopEngine.h`
- **Modified:** `AdvancedOperations.h/.cpp` (FloatExpression rewrite), `RemoteContext.h/.cpp` (added getAnimationTime/needsRepaint)

### What Was Broken

The original C++ `FloatExpression::apply()` simply evaluated the RPN expression and loaded the static result. The `animation` array was read from wire but completely ignored. No animation support existed.

### What Was Implemented

Ported the full Java animation system to C++ with matching file names:

**Easing curves (all header-only):**
- `Easing.h` — Abstract base class with type constants (matches `Easing.java`)
- `CubicEasing.h` — CSS cubic-bezier with binary search + 6 presets (matches `CubicEasing.java`)
- `BounceCurve.h` — Bounce ease-out (matches `BounceCurve.java`)
- `ElasticOutCurve.h` — Elastic ease-out with exponential decay (matches `ElasticOutCurve.java`)
- `MonotonicCurveFit.h` — Multi-dimensional Hermite spline (matches `MonotonicCurveFit.java`)
- `StepCurve.h` — Custom spline-based easing (matches `StepCurve.java`)

**Animation engines:**
- `FloatAnimation.h` — Easing curve interpolation with duration, wrap, directional snap (matches `FloatAnimation.java`)
- `SpringStopEngine.h` — Damped spring physics with RK2 integration, boundary modes, energy-based stop (matches `SpringStopEngine.java`)

**FloatExpression rewrite (matches `FloatExpression.java`):**
- Constructor: animation array parsed to create `FloatAnimation` or `SpringStopEngine` based on `animSpec[0] == 0` check
- `updateVariables()`: Tracks when expression inputs change, re-evaluates expression, triggers animation target updates with proper initial/target chaining
- `apply()` with 3 code paths:
  - **Path A (FloatAnimation)**: Uses `mFloatAnimation->get(t - mLastChange)` for easing-based interpolation
  - **Path B (SpringStopEngine)**: Uses `mSpring->get(t)` with absolute time and energy-based stop detection
  - **Path C (static)**: Direct RPN evaluation, no animation

### Key Design Notes

- **FloatAnimation**: Time is relative to `mLastChange` (animation start). `get(t/duration)` returns easing factor.
- **SpringStopEngine**: Time is absolute `ANIMATION_TIME`. Engine tracks `mLastTime` internally and computes delta.
- **Animation chaining**: When expression output changes mid-animation, new animation starts from previous target value.
- **Repaint signaling**: Calls `context.needsRepaint()` which delegates to `PaintContext::needsRepaint()`.
- **mLastChange**: Captured when expression output changes. Acts as animation start time anchor.

## New Dataset Testing & Fixes ✅

- **Status:** Complete
- **Result:** 65/65 files from `integration-tests/player-view-demos/src/main/res/raw/` parse and render
- **New files tested:** attribute_string, clock, color_list, color_table, color_theme, digital_clock1, experimental_fancy_clock, experimental_sweep_clock1, hostile_actor1_c, hostile_actor1, maze, maze1, maze2, moon_phases

### Bugs Fixed

1. **ParticlesCreate reader (161)**: C++ read `{readInt, count=readInt, count*(readInt,readFloat)}` but Java reads `{id, particleCount, varLen, varLen*(varId=readInt, equLen=readInt, equLen*readFloat)}`. Completely wrong wire format caused parser sync loss.

2. **ParticlesLoop reader (163)**: C++ read only `{readInt}` (one int!) but Java reads `{id, restartLen, restartLen*readFloat, varLen, varLen*(equLen=readInt, equLen*readFloat)}`. Missing 95%+ of the operation data.

3. **ParticlesCompare reader (194)**: C++ read `{readInt, readInt, readFloat, readInt}` (16 bytes) but Java reads `{id, flags=readShort, min=readFloat, max=readFloat, readFloats(expression), result1Len=readInt, result1Len*readFloats(), result2Len=readInt, result2Len*readFloats()}` (286+ bytes). Caused parser sync loss → all maze files crashed/failed.

4. **Missing ATTRIBUTE_COLOR (180)**: Added `ColorAttributeOp` with full `apply()` implementation. Extracts color components (HUE, SATURATION, BRIGHTNESS, RED, GREEN, BLUE, ALPHA) from a color variable using HSB/RGB conversion. Fixed color_table, color_theme, experimental_fancy_clock.

5. **Missing DATA_BITMAP_FONT (167)**: Added `BitmapFontDataOp` parse-only stub. Correctly reads glyph array (chars, bitmapId, margins, dimensions) and optional kerning table (version >= 1). Fixed digital_clock1 parsing.

6. **Missing DRAW_BITMAP_FONT_TEXT_RUN (48)**: Added `DrawBitmapFontTextOp` parse-only stub. Handles conditional glyphSpacing field (signaled by high bit of textId). Fixed digital_clock1 parsing.

### Key Lesson

Stub operation readers that consume too few bytes from the wire buffer cause cascading parse failures. The parser loses byte alignment and interprets data bytes as opcodes. This manifested as "unknown opcode 27" (actually a data byte 0x1B inside a ParticlesCompare payload) and "readBuffer: count 452984832 exceeds buffer" (0x1B000000 being read as a length). Always match the exact Java wire format, even for stub readers.

## Shader Feedback + Particle Systems + Bug Fixes

### draw_to_bitmap mode=1 (Persistent Bitmap State)

- **Bug:** `beginDrawToBitmap` with `mode=1` (MODE_NO_INITIALIZE) was erasing to transparent instead of preserving previous content. Fixed to copy existing image pixels into the new offscreen bitmap.
- **Bug:** `loadBitmap` for `ENCODING_EMPTY` re-allocated bitmaps every frame during the DATA pass, destroying content written by `draw_to_bitmap`. Fixed with `mImages.find(imageId) == mImages.end()` guard to only allocate once.
- These fixes enable shader feedback loops where a shader reads its own render target from the previous frame.

### CLAMP Expression Operator

- **Bug:** CLAMP popped `lo` and `hi` in the wrong order from the stack. With `clamp(val, 0, 1)` producing RPN `[val, 1, 0, CLAMP]` (Python swaps args 2/3 to match Java), the evaluator must use `min(max(sp-2, sp), sp-1)` matching Java's convention.
- Java reference: `mStack[sp - 2] = Math.min(Math.max(mStack[sp - 2], mStack[sp]), mStack[sp - 1])` — `sp` is used in `max` (lower bound), `sp-1` in `min` (upper bound).

### Viewer: Auto-Advance Slideshow

- Added `--auto <sec>` flag for automatic file cycling every N seconds.
- Arrow keys reset the timer. Pause (Space) also pauses auto-advance.
- Usage: `rcviewer --auto 3 directory/` cycles every 3 seconds.
