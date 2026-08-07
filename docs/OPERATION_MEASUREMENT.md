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

Attribution required no new call sites. Every existing `incrementOpCount()` already had
the relevant operation in scope; the change was to pass it.

| file | line | passes | counts |
| :--- | ---: | :--- | :--- |
| `core/CoreDocument.ts` | 496 | `op` | data pass |
| `core/CoreDocument.ts` | 624 | `op` | paint pass, top level |
| `core/operations/ParticleOperations.ts` | 292, 446 | `child` | per-particle child op |
| `core/operations/ParticleOperations.ts` | 470 | `this` | one pair comparison |
| `core/operations/StubOperations.ts` | 76, 115 | `op` | impulse list op |
| `core/operations/StubOperations.ts` | 81 | `this` | impulse process paint |
| `core/operations/ConditionalOperations.ts` | 75 | `op` | taken branch |
| `core/operations/layout/Component.ts` | 189 | `op` | child paint |
| `core/operations/layout/RootLayoutComponent.ts` | 109 | `op` | root child paint |
| `core/operations/layout/LayoutComponent.ts` | 411, 456 | `op` | draw-content / content ops |
| `core/operations/layout/LayoutComponent.ts` | 435 | `mod` | modifier |
| `core/operations/layout/LoopOperation.ts` | 49, 65 | `op` | per-iteration body op |
| `core/operations/layout/managers/StateLayout.ts` | 133 | `op` | active state's ops |

Two sites pass `this` because they count work the enclosing operation performed itself
rather than a child it dispatched to. That is not a fudge: a `ParticlesCompare` that runs
10,000 pair comparisons *should* show 10,000 against itself, because that is where the
work is.

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

### The counts are not comparable across engines today

This is the single most important thing to know before porting, and it is easy to get
wrong: **the three engines do not count the same events.** As of this writing there are
**26** `incrementOpCount()` call sites in Java `remote-core` and **17** in TypeScript.

TypeScript is missing counting entirely in: `ComponentModifiers`, `CanvasOperations`,
`ClickModifierOperation`, `MultiClickModifier`, `ListActionsOperation`,
`FloatFunctionDefine`. TypeScript *adds* a site Java does not have, in `StateLayout`.

So a per-type or per-instance report from two engines on the same document will differ,
and the difference is a **call-site parity gap, not a measurement bug**. Fixing that gap is
worth doing but is a separate change with its own risk: adding a count site can push a
borderline document over `MAX_OP_COUNT` and turn a working document into a thrown error.

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
| `players/typescript/packaging/mkmeasure.py` | builds the demo page |
| `players/typescript/web-player/measure.html` | the demo page (generated; do not hand-edit) |

The demo page embeds the player bundle and goes stale the moment that bundle is rebuilt:

```sh
cd players/typescript && npm run bundle && python3 packaging/mkmeasure.py
```
