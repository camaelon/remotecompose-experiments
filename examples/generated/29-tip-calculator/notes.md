# Tip calculator: eval notes (run 1)

Deliverables: `tip.json` (source), `tip.rc` (6,717 bytes), renders in `out/` (`final-sample1..6.png`
for the states, `v2-*.png` for the themes and sizes, `tablet-light.png`). Every tool output I relied on is
saved as a `.txt` next to them.

## Decision: how the bill amount is entered
build_kit's design rule "Text entry is the app's" says the format has no keyboard input, and that "A NUMBER
the user sets (an amount, a count) can stay in the document: a Stepper, preset Chips, or a slider for
display — or the app's own numeric input via a tapped field". A bill is an arbitrary amount in cents, so a
stepper, presets or a slider would be unusable. I chose the **app's own numeric input via a tapped field**:
`bill` is an exported host float. The field shows "$84.50" (or "Tap to enter the bill" when it is 0), and a tap
sends `hostNamedAction "editBill"`. The app opens its numeric keypad and writes `bill` back.

## 1. Tool calls (29)
1. `list`: what exists. Workflow: build_kit, then convert/check, then render, audit, inspect. I followed it.
2. `build_kit` (the goal as the user wrote it): Chip, Stepper (it matched "split between"), Icon, EXP-11
   (money formatting, the 512 rounding flag), and the "Text entry is the app's" rule. I decided on Chip × 3,
   a Stepper from 1 to 20, a tapped bill field, and textFromFloat flags 535 (23 + 512).
3. `reference format`: syntax for exported variables (`{"value", "export": true}`), visibility, semantics,
   textMerge, and the U58 trap about a shared action name.
4. `find examples "single selection chips…"`: nothing for "exactly one selected". I decided on three 0/1
   variables, with each chip's onClick setting itself to 1 and the others to 0.
5. `convert check`: OK at 5.8 KB. The host variables are listed.
6. `describe render`: to learn `samples` and `variants`.
7. `render samples` (bill 0; 84.50 with 3, 1 and 20 people): all correct: $12.68 / $97.18 / $32.39, $4.86.
8. `inspect interactions`: found that the Stepper's `+` button has a HostNamedAction with no TextData, which is
   the U58 trap.
9. `describe inspect`: the syntax of the interact actions.
10. `inspect interact` (tap 20 % twice, + twice): exclusivity works, and a second tap keeps the chip selected.
    It **confirmed the `+` sends a nameless action** (`name: null`). I removed the Stepper `onClick`. The app
    reads the exported `people` instead.
11. `audit`: the chips are 32 dp and the stepper buttons 36 dp, both under 48 dp. `pct` was flagged unused (it is exported).
12. `inspect summary`: exported expressions (`tipAmt`, `total`, `each`, `pct`) do become host variables.
    Repaint is idle.
13. `inspect accessibility`: **Chip has no state** (state null), so "selected" is never announced. The people
    count "3" is read with no context. The stepper's "−" and "+" glyphs are exposed as text.
14. `get A11Y-02`: semantics `stateDescription` is fixed text, so the pattern is one face per state, switched by visibility.
15. `convert`: I wrote an inline `TipChip` component (two faces, each with a stateDescription, and a 48 dp
    tall touch box). I also added a semantics label "Split between N people".
16. `inspect interact`: I first put onClick on both faces, which would hit U58 (the same hostNamedAction in
    two lists). I moved onClick to the chip's outer box. Taps work and `tip10` is sent each time.
17. `inspect accessibility`: the chips now read "10%", "Not selected" / "Selected".
18. `render variants`: themes and mono render correctly. The tiny (180) size clips "20%" and "Split between".
    In mono the bill field and the unselected chips had no outline (surfaceHigh maps to black). Tablet: the
    rows stretch.
19. `render variants`: after adding a 1 dp outline ring (outline background, padding 1, inner background) and
    a content width of `min(560, windowWidth() - 32)`, mono and mono-inverted now show the field and chips.
20. `render 800×1280 light`: on a tablet the content is a centred 560 dp column.
21. `render samples` (6 states): 84.50 at 10 % split 2 showed **$46.47** (float 46.4749…). Wrong for money.
22. `audit`: warning: 3 clickable components without a label (the chip outer boxes).
23. `audit`: after putting the label on the outer box and only the stateDescription on the faces, the warning is gone.
24. `inspect interact`: 20 % selected and 10 % cleared; + makes people 3; `each` 33.8. `tip20` is sent.
25. `inspect accessibility`: labels are "10% tip" (clickable) and "Selected" (on a separate node). The results read "Tip $8.45" and so on.
26. `render samples`: **failed**. I had declared `billC` and `tipC` after their readers. The error was clear.
27. `render samples`: I computed in cents (`billC = round(bill*100)`, `tipC = round(bill*pct)`,
    `each = round((billC+tipC)/people)/100`). Every state is right: $46.48, $740.74 for $12,345.67 at 20 %
    split 20, and $0.00 at bill 0.
28. `convert check`: 6,717 bytes, no warnings.
29. `audit`: 0 errors, 0 warnings, 3 infos (the stepper touch targets, "unused" exported variables, never-executed click actions).

## 2. Dead ends and wasted calls
- Calls 21–23: the first version of the money maths used float division, so 46.475 printed as 46.47 even with
  the rounding flag. EXP-11's pitfall ("keep amounts … in cents") was there, but I read it as a size limit,
  not a rounding hazard. If build_kit had said "money: compute in integer cents and round()", this would have
  been avoided.
- Call 26: I declared variables after their readers. That was my error, and the message told me how to fix it.
- Call 10: I had to remove the Stepper's `onClick`. The Stepper documentation advertises the feature, but it
  runs into the format's own U58 trap (see 3).
- Calls 6 and 9 (`describe`): the call list truncates each tool's description, so I needed a describe call to learn the `samples` and `actions` syntax.
That makes 3 dead ends (calls 10, 21, 26), plus 2 overhead calls.

## 3. Wrong, misleading, noisy or missing
- **Stepper `onClick` is broken by design.** The documentation says: "`onClick` actions are appended to both
  buttons' click lists … an app reading the exported `value` on a hostNamedAction sees the new number". The
  format reference says: "Give each control its OWN action name: a name shared by two click lists is written
  once, inside the first, and the second control sends a nameless action until the first is tapped (U58)."
  interact confirmed that `+` sends `name: null`. The library component walks into the trap its own reference
  warns about, and convert/audit say nothing.
- **Chip does not announce its selected state.** Its documentation says "label: Also the accessibility label"
  and nothing about state. inspect accessibility shows `state: null`. build_kit recommends it for a selection
  without mentioning this. A11Y-02 is the fix, but build_kit did not surface it.
- **No pattern for single selection.** The Chip summary says "a tap toggles its 0/1 `selected`". Nothing
  mentions radio or exclusive groups: the find query for "single selection / radio" returned toggles and Tabs.
- **Library touch targets fail the library's own audit.** Chip is 32 dp and Stepper is 36 dp, against the
  audit's "smaller than the recommended 48×48dp".
- **Mono loses the field and chip outlines.** My `@colors.surfaceHigh` background turns into the page colour
  in mono with no warning. Render variants reported "findings: none" for a field that had become invisible.
- **Inspector bounds are offset.** Accessibility and interactions report the bill row at `x 32, w 328` (later
  `x 33, y 84.7`) when it is drawn at x 16. It looks like the row's own inner padding gets added. This is
  harmless for taps at the centre, but misleading.
- **Exported computed values look host-settable.** convert says "Host-settable variables: … each (float) = 0,
  tipAmt …". Those are outputs, and an app that sets them would be overwritten. audit also flags
  exported-but-not-displayed `pct` as "defined but never read … cost bytes … for nothing", though the app reads it.
- **Noise.** inspect summary lists the theme colours (background, muted, …) as host_variables. The
  "unused_space" info appears on every phone render of a short form. A json2rc error is repeated once per
  sample (6×). Some calls left stray `out/render-<timestamp>.png` files I never asked for (I deleted them).
- **A recommendation that does not fit.** "Give quantities a visual … the number as text is secondary" is
  noise for a calculator.
- **Rounding.** EXP-11 says "Without 512 … the decimals are cut, not rounded", which implies 512 is enough.
  For money it is not: 46.475 is stored as 46.4749 and prints 46.47.

## 4. What I would have liked
- A `ChipGroup` or `SegmentedChoice` (one index variable, exactly one selected, stateDescription, 48 dp
  targets), or at least a single-select recipe in the Chip pitfalls.
- Chip and Stepper announcing state and value ("15% tip, selected"; "3 people"), and a Stepper with separate
  `onDecrease` / `onIncrease`, or with the U58 issue handled.
- A `NumberField` / `AmountField` component for the "app's input via a tapped field" pattern that the design
  rules recommend (placeholder, money format, label, action).
- A money recipe: integer cents with round().
- convert/audit flagging a hostNamedAction name shared between click lists, and mono renders flagging
  surfaces that vanish.
- Exported outputs marked as read-only/derived in the host variable listings.

## 5. Assessment of the final screen
- **Correctness:** tip, total and per person are computed in the document in cents. Spot checks: 84.50 at 15 %
  gives $12.68 / $97.18, and $32.39 for 3 people, $97.18 for 1, $4.86 for 20. 10 % split 2 gives $46.48. A
  grouped amount: $12,345.67 at 20 % split 20 gives $740.74. Bill 0 gives "Tap to enter the bill" and $0.00
  everywhere. The display goes up to 9 whole digits.
- **Interactions** (verified with interact): a chip tap selects it and clears the others. Re-tapping keeps it
  selected, so exactly one is always selected. The stepper is clamped to 1–20. The results update.
- **Host variables:** inputs `bill` (the app writes it after `editBill`), `people`, `tip10`/`tip15`/`tip20`.
  Outputs `pct`, `tipAmt`, `total`, `each`. Actions `editBill`, `tip10`, `tip15`, `tip20`.
  **Weak spot:** a people change sends no action. The app must read `people` / `each` (Stepper U58 issue above).
- **Sizes:** phone 360 and narrow 259 are fine. Tablet 800: a centred 560 dp column. Short heights scroll.
  At 180 wide (half width) the 20 % chip and "Split between" clip.
- **Themes and mono:** light, dark, mono and mono-inverted all render correctly with theme colours only.
  Field and chips have a 1 dp outline ring.
- **Accessibility:** the document is described. The bill field reads "Bill amount, $84.50" (clickable). Chips
  read "10% tip" plus "Selected"/"Not selected", but the state sits on a child node and not the clickable one,
  so a reader may announce it separately. The people row reads "Split between 3 people". Each result reads
  "Tip $12.68" and so on, but the child texts are also exposed, so they may be read twice. The stepper's −/+
  glyph texts are exposed. The stepper buttons are 36 dp (under 48).
- **Bytes:** 6,717 bytes. Repaint is idle.
