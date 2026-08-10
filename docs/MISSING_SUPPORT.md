# Missing support in the TypeScript player

*Every operation this player does not implement, and what each one costs. Generated and
re-checkable with `players/typescript/support-audit.py`.*

Java `remote-core` registers **163** opcodes. This player registers **162**. Of those 162,
**17** parse their bytes and then do nothing, and a further **14** are parsing stubs that
keep the byte stream aligned without implementing anything (§1b).

The categories below are ordered by how badly they fail, which is not the same as how often
they are hit. Read §0 before treating anything here as a work item.

---

## 0. How to read this — the distinction that matters

An operation with an empty `apply()` is **not** necessarily unimplemented. Many are
supposed to be inert: a width modifier does not *apply* itself, it is read by the layout
system during measurement. Eighteen operations look broken by that measure and are
completely correct (§3).

So "missing" here means the stricter thing: the `apply`/`paint` body has no executable
statement **and** nothing outside the class's own file and the opcode registry ever
mentions it. Nothing reads its fields, nothing switches on its type. It is parsed and
dropped.

That distinction is the whole value of this document. A naive scan reports 35 broken
operations; 18 of those are fine, and burying the 17 real ones in a list of 35 is how they
stay unfixed.

---

## 1. Unregistered opcodes — the reader stops dead (1)

An unregistered opcode has no known length, so the reader cannot skip it. It does not
silently garble what follows — `RemoteComposeBuffer` warns and returns, so **every
operation after it is dropped** and the document renders a prefix of itself. Measured: an
unregistered opcode spliced into `dsl_ticker.rc` takes it from 75 operations to 1.

| op | name | what it is |
| ---: | :--- | :--- |
| 57 | `DRAW_TEXT_ON_CIRCLE` | text laid out around a circle |

**This one is parity, not a gap.** `DrawTextOnCircle` exists as a class in `remote-core` and
has documentation, but it is not registered in `Operations.java` either — the reference
cannot read it any more than this player can. It is listed for completeness and needs no
work until the reference registers it.

The other fourteen used to live here. They are now §1b.

---

## 1b. Parsing stubs — stream stays aligned, operation does nothing (14)

`src/core/operations/UnsupportedOperations.ts`. Each stub reads *exactly* the fields the
reference reader reads and then does nothing, so a document using one of these loses that
one feature instead of losing everything after it.

| op | name | what it is |
| ---: | :--- | :--- |
| 2 | `COMPONENT_START` | component framing |
| 14 | `ANIMATION_SPEC` | animation curve specification |
| 48 | `DRAW_BITMAP_FONT_TEXT_RUN` | bitmap-font text |
| 49 | `DRAW_BITMAP_FONT_TEXT_RUN_ON_PATH` | bitmap-font text along a path |
| 153 | `TEXT_LOOKUP_INT` | integer-keyed text lookup |
| 166 | `FUNCTION_CALL` | with 168, the float-function mechanism |
| 167 | `DATA_BITMAP_FONT` | bitmap font data |
| 168 | `FUNCTION_DEFINE` | float function definition |
| 171 | `ATTRIBUTE_IMAGE` | image attributes |
| 175 | `PATH_COMBINE` | boolean path operations |
| 183 | `BITMAP_TEXT_MEASURE` | bitmap-font metrics |
| 184 | `DRAW_BITMAP_TEXT_ANCHORED` | anchored bitmap-font text |
| 185 | `REM` | a comment; inert by design, so this stub is complete |
| 189 | `DATA_FONT` | font data |

Six of the fourteen (48, 49, 167, 183, 184, 189) are one cluster — **bitmap fonts and font
data** — and remain the single largest coherent gap. `FUNCTION_DEFINE` (168) and
`FUNCTION_CALL` (166) are the other pair: together the whole float-function mechanism, and
one of the six places Java counts operations that this player has no equivalent for (see
[OPERATION_MEASUREMENT.md](OPERATION_MEASUREMENT.md) §8).

**Do not trust a stub's layout by eye.** Three of them (48, 49, 183, 184) hide an optional
float behind the sign bit of their first int, and `DATA_BITMAP_FONT` packs a version into
the high half of a count word and then has a kerning table that only exists from version 2.
A stub that mis-reads a length is worse than no stub, because it desynchronises the stream
while looking like support. All fourteen are covered by a splice test — a synthetic
operation inserted after a real document's header, asserting the document still parses to
the same tail — with an unregistered opcode as the negative control.

`REM` is the one that is genuinely finished: it is a comment, so parsing it and doing
nothing is the correct implementation. Its `deepToString` prints the comment text.

---

## 2. Parsed, then ignored — silently does nothing (17)

These are safe for the byte stream: the reader knows their length, so everything after them
still parses. The feature just does not happen, with no error anywhere. **This is the
hardest failure mode to notice** — the document loads, renders, and is quietly wrong.

| op | name | class | consequence |
| ---: | :--- | :--- | :--- |
| 83 | `MODIFIER_MULTI_CLICK` | `MultiClickModifier` | **long-press and double-click never fire.** The class implements `onClick`/`onLongPress`/`onDoubleClick`, but nothing dispatches to them — `ClickModifier` (59) *is* wired up at `LayoutComponent.ts:530`, so single click works and the other two gestures silently do not. |
| 143 | `DATA_BOOLEAN` | `BooleanConstant` | boolean constants unavailable to expressions |
| 158 | `PATH_TWEEN` | `PathTween` | path morphing is inert |
| 173 | `CANVAS_OPERATIONS` | `CanvasOperationsOp` | Java paints a child list here; the TS class holds no list at all |
| 177 | `HAPTIC_FEEDBACK` | `HapticFeedback` | host side effect only |
| 179 | `DEBUG_MESSAGE` | `DebugMessage` | host side effect only |
| 191 | `WAKE_IN` | `WakeIn` | **no repaint scheduling.** A time-gated block cannot wake itself. Pairs with the impulse work: `ImpulseOperation.paint` calls `context.wakeIn(...)` before its window opens, and with nothing acting on that, the document depends on some other source of repaints to reach its own start time. |
| 216 | `HOST_METADATA_ACTION` | `HostActionMetadataOperation` | host callback metadata |
| 218 | `VALUE_INTEGER_EXPRESSION_CHANGE_ACTION` | `ValueIntegerExpressionChangeAction` | the integer counterpart of an action that *is* implemented for floats. Body is an explicit stub: `// Requires document.evaluateIntExpression — stub for now`. |
| 229 | `MODIFIER_RIPPLE` | `RippleModifier` | no touch ripple |
| 235 | `MODIFIER_COLLAPSIBLE_PRIORITY` | `CollapsiblePriorityModifier` | collapsible row/column cannot prioritise what to drop |
| 237 | `MODIFIER_ALIGN_BY` | `AlignByModifier` | alignment lines ignored |
| 241 | `SKIP` | `Skip` | conditional skipping of operations does not happen |
| 245 | `INCLUDE_REFERENCED_OPERATIONS` | `IncludeReferencedOperations` | macro/Loom |
| 247 | `MACRO_CALL` | `PatternInflation` | macro/Loom |
| 248 | `MACRO_ARGUMENT` | `PatternArgument` | macro/Loom |
| 250 | `ACCESSIBILITY_SEMANTICS` | `AccessibilitySemantics` | no semantics exposed to assistive tech |

**Clusters worth taking as single pieces of work:**

- **Macro / Loom** — 245, 247, 248 are dead, while 244 (`MACRO_FOR_EACH`), 246
  (`MACRO_DEFINE`) and 249 (`MACRO_BLOCK`) *are* consumed by `nestContainers.ts` and
  `ExpansionContext.ts`. So the macro system is half-wired: the container shapes are
  understood, the call/argument/include mechanism is not. Finishing it means the three dead
  ones.
- **Gestures** — 83 and 229 together are long-press, double-click and ripple. Single click
  already works, so the plumbing to build on exists.
- **Scheduling** — 191 alone, but it gates whether time-driven documents animate at all
  without an external repaint source.

---

## 3. Inert `apply()`, and that is correct (18) — do not "fix" these

Listed so nobody re-derives the §0 distinction and files bugs against them. Each has an
empty `apply()` because the layout system reads its fields directly; the "consumer" column
is where that happens.

| op | name | class | consumed at |
| ---: | :--- | :--- | :--- |
| 16 | `MODIFIER_WIDTH` | `WidthModifier` | `LayoutComponent.ts:111` |
| 58 | `MODIFIER_PADDING` | `PaddingModifier` | `LayoutComponent.ts:100` |
| 59 | `MODIFIER_CLICK` | `ClickModifier` | `LayoutComponent.ts:154` |
| 67 | `MODIFIER_HEIGHT` | `HeightModifier` | `LayoutComponent.ts:114` |
| 174 | `MODIFIER_DRAW_CONTENT` | `DrawContentModifier` | `LayoutComponent.ts:171` |
| 201 | `LAYOUT_CONTENT` | `LayoutComponentContent` | `LayoutComponent.ts:175` |
| 207 | `LAYOUT_CANVAS_CONTENT` | `CanvasContent` | `LayoutComponent.ts:175` |
| 214 | `CONTAINER_END` | `ContainerEnd` | `CoreDocument.ts:353` |
| 219 | `MODIFIER_TOUCH_DOWN` | `TouchDownModifier` | `LayoutComponent.ts:157` |
| 220 | `MODIFIER_TOUCH_UP` | `TouchUpModifier` | `LayoutComponent.ts:157` |
| 225 | `MODIFIER_TOUCH_CANCEL` | `TouchCancelModifier` | `LayoutComponent.ts:157` |
| 231 | `MODIFIER_WIDTH_IN` | `WidthInModifier` | `LayoutComponent.ts:117` |
| 232 | `MODIFIER_HEIGHT_IN` | `HeightInModifier` | `LayoutComponent.ts:119` |
| 238 | `LAYOUT_COMPUTE` | `LayoutComputeOperation` | `LayoutComponent.ts:165` |
| 243 | `MODIFIER_DIMENSION_CONSTRAINTS` | `DimensionConstraintsModifier` | `LayoutComponent.ts:121` |
| 244 | `MACRO_FOR_EACH` | `PatternForEach` | `nestContainers.ts:29` |
| 246 | `MACRO_DEFINE` | `PatternDefine` | `nestContainers.ts:28` |
| 249 | `MACRO_BLOCK` | `PatternBlock` | `ExpansionContext.ts:106` |

"Consumed" here means *referenced*, which is weaker than *correct*. It proves the operation
is not dropped on the floor; it does not prove the behaviour matches the reference. Layout
conformance is a separate question, answered by the three-engine differential in
`rcJson/layout/`.

---

## 4. Regenerating this

```sh
cd players/typescript
python3 support-audit.py          # the three tables
python3 support-audit.py --json   # machine-readable
```

The script reads `Operations.java` from the local androidx checkout for the reference side.
Two traps it exists to avoid, both of which produced confidently wrong numbers first time:

- **Java registers opcodes on several maps** — `map`, `mapV7`, `sMapV7AndroidX`,
  `sMapV7Widgets`, and the experimental/deprecated variants. Matching only `map.put(` finds
  125 of 163 and invents 38 nonexistent gaps.
- **`OP_CODE` is declared three ways** in this codebase: `static readonly OP_CODE = n`,
  `static override readonly OP_CODE = n`, and `static readonly OP_CODE: number = n`.
  Matching only the first misses five operations, including `CORE_TEXT` (239) — which then
  reads as an unregistered opcode despite being the main text path.

`players/typescript/GAPS.md` predates this audit and disagrees with it in places; where they
conflict this file is the checked one. In particular GAPS.md lists 208 `LAYOUT_TEXT` as
unregistered — it is registered, at `Operations.ts:243`.
