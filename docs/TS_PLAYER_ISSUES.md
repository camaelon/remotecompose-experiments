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

### A2. Density — padding and spacedBy done; ~6 sites remain

`RemoteContext.setDensity` and the two dimension modifiers landed first; `PaddingModifier`
and the four `spacedBy` sites (row, column, flow, both collapsibles) followed, along with
`PaintContext.getDensity`/`getDensityBehavior` and reading `Header.DOC_DENSITY_BEHAVIOR`.

**The guard differs per operation and this is the thing to get right:**

| operation | scales when |
| :--- | :--- |
| `DimensionInModifierOperation` (widthIn/heightIn) | `!= DENSITY_BEHAVIOR_PIXELS` |
| padding, `spacedBy`, border, offset, marquee, collapsibles | `== DENSITY_BEHAVIOR_DP` |

The default is LEGACY, so everything in the second row is inert unless the document declares
DP — and **no document in the corpus declares it**. Verified by injecting the header value:
padding 24 stays 24 under LEGACY and PIXELS, becomes 63 under DP at density 2.625, and stays
63 across five paints rather than compounding.

**Correction.** An earlier version of this entry claimed unscaled padding and spacing
explained the compressed vertical rhythm against the device. That was wrong: every
`spacedBy` in `dsl_ticker.rc` is 0 and the document is LEGACY, so neither scales in either
engine. The rhythm difference is still unexplained — see §D2.

*Still unscaled:* `BorderModifierOperation` (`borderWidth`, `roundedCorner`),
`OffsetModifierOperation` (`x`, `y`), `MarqueeModifierOperation`. Same `== DP` guard, same
shape as the ones already done, and equally inert until a document declares DP.

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

### C1. Modifier scrolling — implemented; top-level still missing

`ScrollModifier` was ~30 lines that translated by a position nothing ever wrote. The
measurement half was already there (`LayoutManager` measures content unbounded on the scroll
axis and writes the max/notch variables); what was missing was every touch path.

The reason it looked inert rather than broken: **the modifier carries its own
`TouchExpression` in its operation list**, not among the component's children, so the
component's touch walk — which only ever looks for a `TouchExpression` among children —
never reached it. Nothing wrote a position, so the translate was always by zero.

Ported from `ScrollModifierOperation`:

- `inflate()` binds the contained `TouchExpression` to the component
- `onTouchDown/Drag/Up/Cancel`, each with the reference's touch-version branch
- `setVerticalScrollDimension` / `setHorizontalScrollDimension`, called from the measure
  pass — without them the modifier's max stays 0 and a drag clamps to nothing
- `apply()` now runs its own list first. That is what applies the `TouchExpression`, and
  its `apply()` is what refreshes the bounds it rejects out-of-range touches against.
  Bounds left at 0×0 discard every touch, which reads as "not implemented".
- the two position modes the reference distinguishes: expression-driven (the variable is
  authoritative and recomputed each frame) and direct (the drag is integrated and clamped
  to `[-max, 0]`)
- `invalidateMeasure()` on drag and release

**A related defect found on the way.** `RemoteContext.mTouchVersion` defaulted to 0 while
the reference defaults to `FIX_TOUCH_EVENT` (1), and nothing read `FEATURE_TOUCH_VERSION`
from the header. Version 0 makes `TouchExpression.updateBounds` compute *absolute* bounds
while the dispatch code passes *component-local* coordinates, so a touch expression inside
any positioned component rejected touches that were inside it. Now seeded from the header
with the reference's default.

**Verified**: vertical, horizontal and notched, each dragging, clamping at both ends, and
moving pixels; through `doc.touchDown/Drag/Up` headlessly and through real `PointerEvent`s
in Chrome. Nothing in the corpus scrolled, so `ts_broken/src/scroll_probe.py` generates the
three probes — 12 numbered bands of 200 in a 600 viewport, so the offset is readable off a
render rather than only from a number. Horizontal had never been exercised by anything.

*Not done:* fling parity. Both engines ease after release — a 400px slow drag settles at 424
here against the device's 499 — but the easing is wall-clock driven and a headless loop does
not advance wall-clock realistically, so that gap is unconfirmed rather than measured. Edge
effects (`applyEdgeEffect`, `ScrollingEdgeEffect`) are not ported; they are the overscroll
glow and affect nothing structural.

*Still missing:* **top-level scrolling** — the `RootContentBehavior` scroll modes, which are
host work in `RcdPlayer` rather than in the engine.

*Authoring gap:* `rcj` implements neither `verticalScroll` nor `horizontalScroll`, so the
probes fall back to the Java oracle. Worth closing if scroll documents are going to be
iterated on.

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
2. **Vertical rhythm compressed** — cause open. *Not* padding or `spacedBy`: this document
   is LEGACY and all its spacing is 0, so neither scales in either engine (§A2). Next thing
   to look at is text line height and the intrinsic height of the card contents, since the
   cards are shorter rather than merely closer together.
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
