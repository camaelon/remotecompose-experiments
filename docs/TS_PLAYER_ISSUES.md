# Known issues in the TypeScript player

State of the TypeScript player against the Java reference (`remote-core`) and against a
real device, with a suggested way in for each. Ordered by damage per unit of effort, which
is not the same as severity.

Every entry says how it was established. Where something is suspected rather than measured
it says so — the distinction matters here, because most of these produce **plausible wrong
output rather than an error**, and a confident-sounding guess costs more than an open
question.

Device figures come from a Pixel Fold, 420 dpi (density 2.625), `dsl_ticker.rc` at a
980×1470 2:3 viewport, compared with `rcJson/ts_broken/compare.py`.

---

## A. Wrong output that looks right

### A1. Light and dark themes are swapped

**Verified against the device, twice.** Asking the player for `LIGHT` renders the document's
dark section and vice versa:

| | background |
| :--- | :--- |
| device, night mode off | light lavender |
| device, night mode on | dark navy |
| TypeScript `--theme light` | dark navy `(30,45,66)` |
| TypeScript `--theme dark` | light lavender `(221,232,255)` |

Exactly inverted. Reproduce with `adb shell cmd uimode night no|yes` and
`python3 ts_broken/compare.py dsl_ticker`.

What the mechanism is **not** — all of these were checked and match the reference exactly,
so do not spend time re-reading them:

- the constants (`LIGHT = -3`, `DARK = -2`, `UNSPECIFIED = -1` in both engines)
- `ColorTheme.read()` field order, and `ColorTheme.setTheme()`'s light/dark branch
- the paint-loop gating condition, which is character-for-character Java's
  `apply = currentTheme == theme || currentTheme == UNSPECIFIED || op instanceof Theme`
- the `Theme` operation's own read and `apply`
- `RemoteContext.setTheme`/`getTheme` field wiring
- `ID_LIGHT` (26) — this is the **ambient light sensor**, not a theme flag. A dead end that
  looks relevant.

What the mechanism **is**: `dsl_ticker.rc` carries **zero** `ColorTheme` (196) operations
and 24 `Theme` (63) markers — 8 `LIGHT`, 8 `DARK`, 8 `UNSPECIFIED` — so the whole effect
runs through paint-loop gating, not themed colour resolution.

*Suggested next step:* trace which op indices execute under `paint(theme = LIGHT)` versus
`paint(theme = DARK)` and diff the two sets, then take the same trace from the Java
reference and diff across engines. That names the operation that gates the wrong way. A
first instrumented pass showed all 13 top-level `ColorConstant`s running while the current
theme was still `UNSPECIFIED`, which means the colours that differ are set **inside the
layout tree**, not at top level — so the trace has to walk children, not just
`doc.mOperations`.

### A2. Density is applied in 2 places; the reference applies it in 11

**Verified by source in both engines.** `RemoteContext.setDensity` and the two dimension
modifiers landed in `typescript: give the player a display density`. The reference consults
`getDensityBehavior()`/`getDensity()` in nine further files:

| file | what it scales |
| :--- | :--- |
| `PaddingModifierOperation` | all four insets |
| `RowLayout`, `ColumnLayout` | `spacedBy` (2 sites each) |
| `FlowLayout` | `spacedBy` |
| `BorderModifierOperation` | `borderWidth`, `roundedCorner` |
| `OffsetModifierOperation` | `x`, `y` |
| `MarqueeModifierOperation` | scroll geometry |
| `CollapsibleRowLayout`, `CollapsibleColumnLayout` | collapse thresholds |

This is visible right now: with density otherwise correct, the TypeScript render of
`dsl_ticker.rc` has a **visibly compressed vertical rhythm** — shorter cards, tighter gaps —
against the device, which is what unscaled dp padding and unscaled `spacedBy` produce.

*Suggested fix:* mechanical, and the pattern is already established in
`ModifierOperations.updateVariables`:

```ts
if (context.getDensityBehavior?.() !== RemoteContext.DENSITY_BEHAVIOR_PIXELS) {
    const d = context.getDensity();
    if (d > 0 && !Number.isNaN(d)) { /* scale the dp-valued fields */ }
}
```

Do them one file at a time against `layout/run.py` (117 documents, three engines) — the
corpus is the check that a scale factor went in the right place. Padding and the three
`spacedBy` sites are the ones with visible payoff.

### A3. The paint loop is missing the reference's dirty gate

**Source-level divergence, runtime impact not yet measured.** Java:

```java
if (apply) {
    boolean opIsDirty = op.isDirty();
    if (opIsDirty || op instanceof PaintOperation) {     // <-- TypeScript has no equivalent
        if (opIsDirty && op instanceof VariableSupport) { ... }
        context.incrementOpCount();
        op.apply(context);
    }
}
```

TypeScript applies **every** operation that passes theme gating, dirty or not. Two
consequences if real: non-paint operations re-apply every frame when the reference runs them
once, and op counts are inflated relative to Java — which matters, because op counts are
what the measurement hooks report and what `MAX_OP_COUNT` is enforced against.

I tried to quantify it and the attempt was invalid: `PaintOperation` is not exported from
`node-entry.ts`, so the `instanceof` test was always false and the "99% of ops would be
skipped" figure it produced is meaningless. Recorded here so nobody repeats it.

*Suggested next step:* export `PaintOperation` from the node entry, then count per frame how
many ops are neither dirty nor a `PaintOperation`. If that number is non-trivial, add the
gate and re-run `coverage.mjs` plus the measurement invariants — this changes op counts, so
it is a behavioural change to the measurement feature, not just a perf tweak.

---

## B. Missing engine support

Full per-opcode inventory in [`MISSING_SUPPORT.md`](MISSING_SUPPORT.md), regenerable with
`players/typescript/support-audit.py`.

### B1. 15 opcodes the reference reads and TypeScript does not — the reader desynchronises

**The worst category.** An unregistered opcode has no known length, so the reader cannot skip
it: the byte stream loses alignment and **every operation after it is garbage**. The document
does not fail cleanly; it renders nonsense or throws somewhere unrelated.

```
  2 COMPONENT_START          153 TEXT_LOOKUP_INT          183 BITMAP_TEXT_MEASURE
 14 ANIMATION_SPEC           166 FUNCTION_CALL            184 DRAW_BITMAP_TEXT_ANCHORED
 48 DRAW_BITMAP_FONT_TEXT_RUN        167 DATA_BITMAP_FONT         185 REM
 49 DRAW_BITMAP_FONT_TEXT_RUN_ON_PATH  168 FUNCTION_DEFINE        189 DATA_FONT
 57 DRAW_TEXT_ON_CIRCLE      171 ATTRIBUTE_IMAGE          175 PATH_COMBINE
```

*Suggested order:* the font cluster first (48, 49, 167, 183, 184, 189) — six of the fifteen,
one coherent feature, and a document with a custom font is currently unreadable rather than
merely unstyled. Then `FUNCTION_DEFINE`/`FUNCTION_CALL` (166/168) as the other natural pair.

Cheapest possible mitigation, worth doing first regardless: make the reader **fail loudly**
on an unknown opcode instead of desynchronising silently. A clear "unsupported operation 167"
is worth more than a garbled render.

### B2. 17 operations parse and then do nothing

Safe for the stream — the document loads and renders and is quietly wrong. Notable:

- `MODIFIER_MULTI_CLICK` (83) — long-press and double-click never fire, while single click works
- `WAKE_IN` (191) — a time-gated block cannot wake itself
- `MODIFIER_RIPPLE` (229), `MODIFIER_ALIGN_BY` (237), `MODIFIER_COLLAPSIBLE_PRIORITY` (235)
- the half-finished macro system: `MACRO_CALL`/`ARGUMENT`/`INCLUDE` inert while
  `DEFINE`/`FOR_EACH`/`BLOCK` are wired
- `VALUE_INTEGER_EXPRESSION_CHANGE_ACTION` (218) — see B3

*Note:* a further 18 operations have inert `apply()` bodies **correctly** — they are consumed
by the layout system rather than executed. `support-audit.py` separates these into group C.
Do not "fix" those.

### B3. Only the float `SetValue` writes anything

**Verified.** `runAction { setValue … }` is the one sanctioned way to feed a value back into
a document. Of the four action operations only `ValueFloatChangeAction` actually writes, via
`overrideFloat`. `ValueIntegerChangeAction`, `ValueStringChangeAction` and
`ValueIntegerExpressionChangeAction` have `apply()` bodies that write nothing.

An integer or string `SetValue` is therefore silently inert: the document loads, the action
runs, it is even counted by the measurement hooks, and no value changes.

---

## C. Interaction

### C1. Scrolling does not work — neither kind

**Verified by source.** `ScrollModifier` (226) is ~30 lines that read a position variable and
`translate()` by it. The reference's `ScrollModifierOperation` is 619 lines and carries
everything that makes the position *move*:

```
onTouchDown / onTouchUp / onTouchDrag / onTouchCancel
registerListening / updateVariables / layout / reset
setHorizontalScrollDimension / setVerticalScrollDimension
applyEdgeEffect
```

None of these exist in TypeScript. Nothing ever writes the scroll position, so the modifier
translates by a value that is always its initial one. Top-level (host) scrolling is
separately unimplemented in `RcdPlayer`.

*Suggested order:* modifier scrolling first, because it is self-contained and the reference
is a direct port — position state, clamp to content-minus-host, drag from the existing
touch-down/move/up plumbing (which works, since the click fix), then notch snapping and
fling. Top-level scrolling is host work in `RcdPlayer` and can follow.

*Watch for:* `setHorizontalScrollDimension`/`setVerticalScrollDimension` are called by the
layout pass, so the port is not purely inside the modifier — the container has to hand it
the content size. This is the part most likely to be missed and to leave the scroll range
stuck at zero, which looks exactly like "scrolling still not implemented".

### C2. Text arbitration is device-only

Text metrics come from the platform. The headless Java reference measures every text
component as 0×0 — its paint context returns no metrics and its text store does not populate
— so `layout/run.py`'s `k*` documents will always disagree on text and that is expected, not
a TypeScript defect. Estimating metrics in the harness was tried and abandoned.

Practical consequence: **text differences can only be arbitrated on a real device.** Do not
treat the headless three-engine comparison as authoritative for anything text-shaped.

---

## D. Remaining diffs on `dsl_ticker.rc`

With density, the weight fix and the gradient fix in, geometry now matches the device: 3
cards on row 1 plus NYA on row 2, chart, and button all agree. What is left, in the
same-viewport/same-density/same-theme comparison:

1. **Theme inverted** — A1.
2. **Vertical rhythm compressed** — A2, unscaled padding and spacing.
3. **Cents overflow the small cards.** TypeScript draws `.51 / .9 / .98` and they clip or
   overflow the card; the device omits them in the small cards and shows them only on the
   wide NYA card. Since both engines have the same text, this is likely a measurement or
   clipping difference in the card's inner row — investigate after A2, since padding
   changes the space available and may account for it.
4. **The `↓` badge renders as a double lozenge** rather than a circle. A rounded-rect or
   arc-drawing difference; `BorderModifierOperation`'s `roundedCorner` is in the A2 list and
   is the first thing to rule in or out.

---

## Suggested order

1. **B1 mitigation** — fail loudly on unknown opcodes. Small, and it converts a class of
   silent corruption into a readable message.
2. **A2 density** — mechanical, corpus-checked, and it is the visible remaining geometry
   difference. Padding and `spacedBy` first.
3. **A1 theme** — user-visible and wrong in the most confusing possible way, and the
   investigation is narrowed to a single trace.
4. **C1 modifier scrolling** — the largest missing feature, self-contained, direct port.
5. **A3 dirty gate** — measure first; only then decide.
6. **B1 proper** — the font opcode cluster.
