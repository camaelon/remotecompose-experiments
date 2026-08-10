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

### A1. ~~Light and dark themes are swapped~~ — FIXED

**Was:** asking the player for `LIGHT` rendered the document's dark colours and vice versa,
verified against a device in both night modes.

**It was not theme handling.** Everything on that path matches the reference exactly and was
checked: the constants, `ColorTheme`'s read order and light/dark branch, the paint-loop
gating condition, the `Theme` operation, and `RemoteContext`'s field wiring. Gating provably
selects the right section — an instrumented paint showed `paint(LIGHT)` running exactly the
operations following `Theme.LIGHT`.

**The defect was in `DefaultSystemColors`**, the stand-in Material You palette used when no
host supplies dynamic colours. AOSP's tonal ramps run light to dark as the number rises:

```
system_accent2_50  = #EEF0FF   (near white)      ours: 0xFF1E2D42  (dark navy)
system_accent2_800 = #2A3042   (dark navy)       ours: 0xFFDDE8FF  (near white)
```

Our ramp ran the other way. A document doing `addThemedColor(accent2_50, accent2_800)`
therefore got a dark colour for its light theme and a light one for its dark theme — which
reads as inverted theming while every operation involved behaves correctly.

Values were regenerated from the platform's own table
(`$ANDROID_SDK/platforms/android-36/data/res/values/colors.xml`) rather than hand-corrected:
151 of 189 entries changed, 30 were already right, 15 names the platform does not define are
left alone.

*Worth keeping as a methodology note.* Every layer of the theme machinery was suspect and
none of it was at fault; the bug was in a data table three layers away from the symptom.
The thing that finally located it was giving up on reading code and instrumenting instead —
logging which operation wrote the colour, with what inputs.

*Also worth knowing:* the device derives Material You colours from the wallpaper, so hues
will not match this baseline palette and comparing them across engines proves nothing. What
is comparable is whether the light theme is lighter than the dark one.

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

### B1. ~~15 unreadable opcodes~~ — parsing stubs added, 14 of 15

**Corrected from the first version of this document:** an unknown opcode does not garble
what follows. `RemoteComposeBuffer` warns and returns, so everything after it is **dropped**
and the document renders a prefix of itself. Measured: an unregistered opcode spliced into
`dsl_ticker.rc` takes it from 75 operations to 1.

All fourteen that were genuinely missing now have parsing stubs in
`src/core/operations/UnsupportedOperations.ts`. Each reads exactly the fields the reference
reads and does nothing, so a document using one loses that feature instead of losing
everything after it. Full list in [MISSING_SUPPORT.md](MISSING_SUPPORT.md) §1b.

The fifteenth, `DRAW_TEXT_ON_CIRCLE` (57), is **parity rather than a gap** — `remote-core`
defines and documents the class but does not register it either, so the reference cannot
read it any more than this player can.

Stub layouts are not obvious and were taken from the reference readers, not inferred: four
of them (48, 49, 183, 184) hide an optional float behind the sign bit of their first int,
and `DATA_BITMAP_FONT` (167) packs a version into the high half of a count word with a
kerning table that only exists from version 2. All fourteen are covered by a splice test
that inserts a synthetic operation after a real document's header and asserts the document
still parses to the same tail, with an unregistered opcode as the negative control.

*Still to do:* the stubs make documents survive; they do not implement anything. The bitmap
font cluster (48, 49, 167, 183, 184, 189) is still the largest coherent feature gap, and
`FUNCTION_DEFINE`/`FUNCTION_CALL` (166/168) the other natural pair.

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

1. **A2 density** — mechanical, corpus-checked, and the visible remaining geometry
   difference. Padding and `spacedBy` first.
2. **C1 modifier scrolling** — the largest missing feature, self-contained, direct port.
3. **A3 dirty gate** — measure first; only then decide.
4. **B1 proper** — the bitmap-font cluster, now that documents using it survive parsing.
5. **B3** — make integer and string `SetValue` write, or say plainly that they do not.

Done since this document was written: **A1** (theme inversion) and the **B1 mitigation**
(parsing stubs).
