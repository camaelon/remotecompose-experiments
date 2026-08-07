# Operation measurement hooks

*How the TypeScript player reports what executed, per frame — and what an implementer
porting this to the C++ or Java player needs to know.*

This describes **hooks, not a profiler.** The player counts what executed and hands the
numbers over once per frame. Accumulation, history, graphing, statistics, thresholds and
any notion of "slow" belong to whoever consumes them. Everything the demo page
(`players/typescript/web-player/measure.html`) displays is computed from what the hook
hands it, using no player internals — that page exists to prove the surface is sufficient.

---

## 1. What is measured

| | |
| :--- | :--- |
| **Total operations per frame** | The same number `CoreDocument.getOpsPerFrame()` reports, and the same number `MAX_OP_COUNT` is enforced against. |
| **Per operation *type*** | How many times each operation class executed this frame, keyed by wire opcode. |
| **Per operation *instance*** | How many times each individual operation object executed this frame, keyed by a stable id. |

### What is deliberately *not* measured

**Time.** Much of a document's real cost lands on a render thread the player does not
own, so a wall-clock number attributed to an operation would be misleading more often than
useful — it would measure when the compositor got round to the work, not what the
operation cost. Counts are honest about what they are. If timing is added later it should
be a separate, separately-enabled channel, not a field grafted onto these reports.

**Allocations, bytes, GPU state.** All of these would require instrumentation *inside*
operations. Every number here comes from the single call site the engine already had,
which is why the disabled cost is what it is.

---

## 2. The API

```ts
import type { FrameMeasurement, MeasurementSink } from './core/OperationMeasurement';

// On the context, or on RcdPlayer which forwards to it:
context.setMeasurementSink((frame: FrameMeasurement) => { /* consume */ });
context.setMeasurementSink(null);   // disable
context.isMeasurementEnabled();     // boolean
```

```ts
interface FrameMeasurement {
    frame: number;          // monotonic since measurement was enabled
    total: number;          // === getOpsPerFrame()
    unattributed: number;   // counted but with no identifiable instance
    byType: TypeCount[];        // { key, name, opCode, count }, descending
    byInstance: InstanceCount[]; // { id, key, name, count }, descending
}
```

`RcdPlayer` (the web player) additionally exposes `setMeasurementSink` and
`getOpsPerFrame`. A sink set on the player is **remembered across document loads** and
reapplied, so a profiler can arm itself before a document exists and still see the first
painted frame. A profiler that can only attach after startup misses exactly the frames
worth seeing.

### Three things a consumer must know

1. **The report is not yours to keep.** The collector reuses its maps after the sink
   returns. Copy what you want to retain. The demo page copies; `measure.mjs` copies.
2. **The sink is called during paint.** Do as little as possible in it. The demo page
   accumulates into plain maps and throttles its own rendering to ~10 Hz — at 60 fps,
   rebuilding two tables per frame would make the observer's cost dominate what it is
   observing.
3. **A throwing sink is caught and logged, not propagated.** Measurement is an observer,
   and an observer that can break the thing it observes is worse than no observer.

---

## 3. Cost

`incrementOpCount()` already existed and was already called once per executed operation.
Measurement adds to that call:

* one argument — a reference **already in scope** at every call site, so no work is done
  to produce it, and
* one null check.

When measurement is off the collector object does not exist. The instrumented path is
gone, not idle.

Measured on the 2,066-operation document `foo.rc`, four independent runs of 3,000 frames
each (best-of-5 within a run), Node 22 / macOS:

| | µs/frame |
| :--- | :--- |
| Before these changes existed | 428.4, 422.7, 434.3, 436.5 — mean **430.5** |
| After, measurement **off** | 430.6, 429.9, 431.7, 428.6 — mean **430.2** |
| After, measurement **on** | ~550 |

Off is indistinguishable from baseline: the run-to-run spread (~14 µs) is larger than the
difference between the two means (0.3 µs). Enabled costs roughly **60 ns per operation**
— +31 % on a 2,066-op document, +1.8 % on an 80-op one. That is the price of attribution,
and it is why it is opt-in.

---

## 4. Where the counting happens

Attribution needed almost no new call sites: 17 of the 24 already existed and already had
the relevant operation in scope, so the change was to pass it. The other seven were
genuine gaps found afterwards — three for child components (below) and four by the Java
call-site audit in §8.

| file | line | passes | counts |
| :--- | ---: | :--- | :--- |
| `core/CoreDocument.ts` | 496 | `op` | data pass |
| `core/CoreDocument.ts` | 624 | `op` | paint pass, top level |
| `core/operations/ParticleOperations.ts` | 292, 446 | `child` | per-particle child op |
| `core/operations/ParticleOperations.ts` | 470 | `this` | one pair comparison |
| `core/operations/ParticleOperations.ts` | 486, 493 | `this` | one matched pair (added, §8) |
| `core/operations/StubOperations.ts` | 76, 115 | `op` | impulse list op |
| `core/operations/StubOperations.ts` | 81 | `this` | impulse process paint |
| `core/operations/ConditionalOperations.ts` | 75 | `op` | taken branch |
| `core/operations/layout/Component.ts` | 189 | `op` | child paint |
| `core/operations/layout/RootLayoutComponent.ts` | 109 | `op` | root child paint |
| `core/operations/layout/LayoutComponent.ts` | 411, 456 | `op` | draw-content / content ops |
| `core/operations/layout/LayoutComponent.ts` | 435 | `mod` | modifier |
| `core/operations/layout/LayoutComponent.ts` | 476, 484, 491 | `child` | **child components** (added, see below) |
| `core/operations/layout/LoopOperation.ts` | 53, 70 | `op` | per-iteration body op |
| `core/operations/layout/LoopOperation.ts` | 51, 60 | `this` | one loop iteration (added, §8) |
| `core/operations/layout/managers/StateLayout.ts` | 133 | `op` | active state's ops |

Two sites pass `this` because they count work the enclosing operation performed itself
rather than a child it dispatched to. That is not a fudge: a `ParticlesCompare` that runs
10,000 pair comparisons *should* show 10,000 against itself, because that is where the
work is.

### Child components — the gap that was there before measurement

`LayoutComponent.paintingComponent` paints `mChildrenComponents` in three branches
(z-sorted, unsorted, and the single-child case) and **counted none of them**. Every
component nested inside a layout container — every `BoxLayout`, `RowLayout`,
`ColumnLayout`, `CoreText`, `CanvasContent` below the top level — executed without being
counted. Across the 281-document corpus that was **740 uncounted executions in 272 of 274
paintable documents**: nearly every document in the corpus, and on some of them the
majority of the real work.

This was a pre-existing defect in the op counter, not something measurement introduced —
`getOpsPerFrame()` had always under-reported, and `MAX_OP_COUNT` had always been enforced
against a number that ignored nested components. The Java reference counts in exactly
these loops (`LayoutComponent.internalPaintingComponent`, both branches), so this was also
a parity gap. Fixed by adding the three counts where Java has its two.

Consequence worth knowing: **op counts went up.** `foo.rc` 2,066 → 2,085, `02_ticker.rc`
1,166 → 1,240, the corpus peak 6,424 → 6,426. Nothing comes near the 20,000 limit, so no
document changed from working to throwing, but a document that was already borderline
could.

### `unattributed`

Reserved for counted work with no identifiable instance. Currently every site attributes,
so this is 0 for every document in the corpus — but it exists so that a future call site
without an operation in scope contributes to `total` *and* says so, rather than being
silently dropped or invented. **A profiler showing a total its own breakdown does not add
up to is worse than one that says how much it could not attribute.**

---

## 5. The frame window — read this before trusting a number

Measurement brackets exactly the window the op counter already used:

```
CoreDocument.paint()
    ...
    context.clearLastOpCount();
    context.beginMeasuredFrame();     <-- window opens
    ...  paint the operation tree ...
    this.mLastOpCount = context.getLastOpCount();
    context.emitMeasuredFrame();      <-- window closes, sink called
```

This is a deliberate choice, and it has a consequence worth stating plainly:

> **Operations executed in the data pass and during layout fall outside the window.**

They fall outside the *pre-existing* counter too — `clearLastOpCount()` at the top of
paint discards whatever the data and layout passes counted, and the layout pass runs
before it. Aligning to that window means `total` is the number `getOpsPerFrame()` reports
and the number `MAX_OP_COUNT` is enforced against. Choosing a wider window would have made
measurement answer a different question than the limit does, and a profiler whose totals
disagree with the engine's own limit is a bug generator.

If you need data-pass and layout attribution, add it as a **separate report** with its own
window rather than widening this one.

---

## 6. Identity

**Type key.** `op:<OP_CODE>` where the class declares a static `OP_CODE`, else
`cls:<ClassName>`. The opcode is preferred because it survives minification, where class
names do not. `name` is carried alongside for display and has the bundler's `_` prefix
stripped. Types that report `opCode: -1` are internal classes with no wire representation
(layout managers, containers) — a consumer should show them but not expect to find them in
the format spec.

**Instance id.** A monotonic integer assigned on first sight and stored on the operation
under a `Symbol` key, non-enumerable, so it never appears in serialisation, structured
cloning, or a debugger's property list. Ids are stable for the life of the operation
object, which means they survive disabling and re-enabling measurement — a profiler can
correlate across a pause. They do **not** survive a document reload, because the operation
objects do not either.

---

## 7. Verifying an implementation

Four invariants must hold on every frame of every document. `measure.mjs --verify` checks
all four; the demo page checks the first three live and prints the result on screen every
frame, so a document that breaks attribution says so instead of quietly reporting a
plausible-looking number.

1. `report.total === getOpsPerFrame()`
2. `sum(byType.count) + unattributed === total`
3. `sum(byInstance.count) + unattributed === total`
4. An instance id never changes type across frames.

Plus: **with the sink set to `null`, nothing is emitted.**

### Self-consistency is not completeness — check coverage separately

The four invariants above prove the breakdowns agree with their own total. They **cannot**
detect a missing count site, because a missing site lowers `total`, `byType` and
`byInstance` by the same amount and everything still adds up perfectly. That is exactly
how the child-component gap survived a clean 274/274 invariant run.

Completeness needs an independent source of truth for what *should* have been counted.
`coverage.mjs` provides one: it walks the whole operation tree, wraps every operation's
`apply`/`paint` to record what actually executed, paints a frame, and reports operations
that **executed but were never counted**.

```sh
node coverage.mjs path/to/*.rc
```

The executed-vs-inert distinction is the load-bearing part. A first version reported every
uncounted operation in the tree and indicted ~6 per document — but most were layout-only
modifiers that never run during paint and are *correctly* absent. Only
executed-and-uncounted is a defect. Current status: **0 uncounted executions across all
274 paintable documents.**

```sh
cd players/typescript
npx esbuild src/node-entry.ts --bundle --outfile=build-node/node-entry.js \
    --format=esm --platform=node --external:canvas
node measure.mjs --verify path/to/*.rc      # exit 1 on any failure
node measure.mjs --top 12 doc.rc            # hottest types and instances
```

Current status over the 281-document corpus in `rcJson`: **274 pass, 7 fail.** All 7
failures are the same pre-existing headless limitation — documents using WebGL shaders
throw `document is not defined` because `WebGLShaderRenderer` needs a DOM. They fail
identically with measurement never enabled (`node ops.mjs` on the same files), so this is
not a measurement defect. It does mean those 7 documents are unverified, not verified-good.

The browser path is verified separately, because Node's canvas is not a browser: a
harness inlining the bundle plus a base64 document, run under headless Chrome, confirms the
invariants hold with a real canvas and a real `requestAnimationFrame`.

---

## 8. Porting to C++ and Java

### Parity with the Java call sites — audited class by class

Java `remote-core` has **26** `incrementOpCount()` call sites; TypeScript now has **24**.
The difference is *not* 2 missing counts — the mapping is structural, and the audit below
is the actual state after diffing every Java site against its TypeScript counterpart.

| Java class | sites | TypeScript | sites | status |
| :--- | ---: | :--- | ---: | :--- |
| `CoreDocument` | 2 | `CoreDocument` | 2 | match |
| `ConditionalOperations` | 1 | `ConditionalOperations` | 1 | match |
| `Component` | 2 | `layout/Component` | 1 | **equivalent** — Java counts in both arms of an `if (op instanceof PaintOperation)`; TS counts once before the branch. Same count per operation. |
| `ImpulseOperation` | 2 | `StubOperations` | 2 | match |
| `ImpulseProcess` | 1 | `StubOperations` | 1 | match |
| `RootLayoutComponent` | 1 | `layout/RootLayoutComponent` | 1 | match |
| `LayoutComponent` | 2 | `layout/LayoutComponent` | 3 | **equivalent** — Java has z-sorted and unsorted branches, TS additionally splits the single-child case. Same count per child. |
| `LoopOperation` | 4 | `layout/LoopOperation` | 4 | match *(2 added — see below)* |
| `ParticlesCompare` | 4 | `ParticleOperations` | 4 | match *(2 added — see below)* |
| `ParticlesLoop` | 1 | `ParticleOperations` | 1 | match |
| `ComponentModifiers` | 1 | `layout/LayoutComponent` | 1 | **divergent phase** — see below |
| `CanvasOperations` | 1 | `CanvasOperationsOp` | 0 | TS class is a stub: `apply()` is empty and it holds no child list. Nothing executes, so nothing can be counted. |
| `ClickModifierOperation` | 1 | `ClickModifier` | 0 | Java counts in `apply()` over its `TextData` children; the TS `apply()` is a documented no-op ("handled by layout") and actions run from `onClick`. No equivalent path. |
| `MultiClickModifier` | 1 | `MultiClickModifier` | 0 | same shape as above |
| `ListActionsOperation` | 1 | — | 0 | class not implemented in TS |
| `FloatFunctionDefine` | 1 | — | 0 | class not implemented in TS |
| — | 0 | `managers/StateLayout` | 1 | **TS extra** — Java has no counting in its state-layout paint |

**Two real gaps were found by this audit and closed:**

* `LoopOperation` counted its body operations but not the loop itself. Java counts **once
  per iteration** in both branches (`LoopOperation.java:126`, `:135`), so a loop's cost
  scales with its iteration count even when its body is cheap. TS counted `N × M`; Java
  counts `N × (M + 1)`.
* `ParticlesCompare` counted `runChildren` and the per-pair condition evaluation, but not
  the **per-matched-pair** count Java adds after each `runChildren`
  (`ParticlesCompare.java:559`, `:606`).

Effect on the corpus: `02_ticker.rc` 1,240 → 1,498 ops/frame, `foo.rc` 2,085 → 2,145. The
corpus peak is unchanged at 6,426, still well under the 20,000 limit.

**The one remaining divergence that is not simply "unimplemented":** Java counts component
modifiers in `ComponentModifiers.apply()` — the *data* pass — and its `paint()` does not
count at all. TypeScript counts them in `LayoutComponent.paintingComponent`, the *paint*
pass. Since the measured window is paint-only (§5), modifier counts appear in a TypeScript
frame report and would not appear in the equivalent Java one. Moving TS to match would
push those counts out of the measured window entirely, which is arguably worse for a
profiler; it is recorded here as a known, deliberate difference rather than silently
matched.

What `coverage.mjs` reporting zero does and does not prove: it proves every operation that
**executed during paint** was counted, for this corpus. It cannot see the four
unimplemented paths above, because nothing executes there — those are format-support gaps,
not counting gaps, and they close when the operations are implemented.

So a per-type or per-instance report from two engines on the same document can still
differ, and the difference is a **call-site parity gap, not a measurement bug**. Note the
risk when closing one: adding a count site can push a borderline document over
`MAX_OP_COUNT` and turn a working document into a thrown error.

### C++ does not enforce the limit

`RemoteContext::incrementOpCount()` in the C++ player is `{ mOpCount++; }` — it counts and
never checks `MAX_OP_COUNT`. A document that Java and TypeScript reject as too complex
runs to completion in C++. Anyone porting measurement to C++ will be reading that function
anyway; the enforcement gap is worth fixing in the same pass, but note it changes
behaviour for documents that currently run.

### Porting checklist

1. Add a collector object owned by the context, null/absent when disabled. **Do not** use
   a boolean flag plus always-allocated maps; the point of the null is that the disabled
   path allocates nothing and holds nothing.
2. Give `incrementOpCount` an optional operation parameter. Do not add new call sites and
   do not compute anything to produce the argument — if an operation is not already in
   scope at a site, pass nothing and let it land in `unattributed`.
3. Cache type metadata per class, not per call. In C++ that is a `type_index` map; in Java
   a `ClassValue` or an `IdentityHashMap<Class<?>, …>`.
4. For instance identity, prefer a field on the operation over a map keyed by object —
   TypeScript uses a symbol-keyed property specifically to avoid a per-op hash lookup on
   the hot path. In Java a package-private `int` field is cheaper still.
5. Bracket the same window: wherever the engine clears and reads its op count.
6. Contain sink exceptions.
7. Run the four invariants over a real corpus before believing any number.

### If you are adding timing later

Do not attach it to these reports. The reason is in §1: on Android the paint operations
enqueue work onto a render thread, so per-operation wall-clock measured in the player
attributes the compositor's scheduling to whichever operation happened to be executing.
A timing channel needs its own design and its own honest statement of what it measures.

---

## 9. Files

| path | what |
| :--- | :--- |
| `players/typescript/src/core/OperationMeasurement.ts` | the collector and the report types |
| `players/typescript/src/core/RemoteContext.ts` | `incrementOpCount(op?)`, `setMeasurementSink`, frame bracket |
| `players/typescript/src/core/CoreDocument.ts` | calls `beginMeasuredFrame` / `emitMeasuredFrame` |
| `players/typescript/src/web/main.ts` | `RcdPlayer.setMeasurementSink` / `getOpsPerFrame` |
| `players/typescript/measure.mjs` | headless harness and invariant checker |
| `players/typescript/coverage.mjs` | executed-but-uncounted detector (completeness) |
| `players/typescript/packaging/mkmeasure.py` | builds the demo page |
| `players/typescript/web-player/measure.html` | the demo page (generated; do not hand-edit) |

The demo page embeds the player bundle and goes stale the moment that bundle is rebuilt:

```sh
cd players/typescript && npm run bundle && python3 packaging/mkmeasure.py
```
