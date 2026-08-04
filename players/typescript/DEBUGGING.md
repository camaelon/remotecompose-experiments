# Debugging this player

A plan for the tooling, written after a long hunt for one bug. The bug — `impulse` being
a no-op, so a one-time `setValue` ran every frame — was found in the end by asking the
*document* which operation wrote a particular variable. Almost everything tried before
that was slower, and several steps were actively misleading. The tools below are chosen
to make the fast path the default one.

## What already exists

| tool | what it answers |
| :--- | :--- |
| `trace.mjs DOC.rc --frames N --dump` | what each float variable is, per frame |
| `trace.mjs --ops` | which operation classes ran, and how many times |
| `trace.mjs --hold` | the same with touch held from frame 2 |
| `sweep.mjs DIR` | the above across a whole corpus |
| `RcTraceTest` (remote-core) | the same trace from the reference engine |
| `RcFixtureTest` (remote-core) | minimal single-feature documents |
| `NoOpPaintContext` | lets the reference run headless without drawing |
| `flappy-debug.html` | live variable table + `rcdump()` in a real browser |

Together these give: state over time, on both engines, on real documents and on minimal
ones. What they do *not* give is structure — which is what the last bug needed.

## What is missing, in priority order

### 1. `whowrites <doc.rc> <id>` — the tool that would have saved days

Walk the loaded document and print every operation that writes a given variable id,
with its full ancestor path.

```
$ node whowrites.mjs flappy.rc 45
setValue target=45 fromExpr=44
   under: Root > Box > Content > CanvasLayout > Content > RunActionOperation
setValue target=45 fromExpr=44
   under: ... > ParticlesCompareOp > ConditionalOperations > RunActionOperation
```

The first line is the answer: an unconditional writer at canvas level, where the
document intended it to be gated by an impulse. This was written ad hoc at the very end;
it should be a command. Generalise it to any id and any writer op
(`ValueFloat*ChangeAction`, `variable`, `FloatConstant`, `FloatExpression`).

### 2. `structure <doc.rc>` — the operation tree, with containment

A plain indented dump of the op tree. Every wrong hypothesis in the last hunt would have
died in seconds against a correct picture of what contains what. Show container nesting,
child counts, and flag operations whose class is a known no-op (see `GAPS.md`) so a
document's dead features are visible at a glance.

### 3. A conformance runner with a stored baseline

`sweep.mjs` compares against a live reference run. Make the reference output a checked-in
baseline instead, so:

- a regression is a diff, not a re-run of two engines;
- CI can run it;
- fixing a gap shows up as a measurable count.

Today's number, for the record: **159/180 documents agree**.

### 4. Fixture coverage per opcode

`RcFixtureTest` has ten fixtures. Make the list opcode-indexed and report which registered
opcodes have no fixture. Every fixture written so far either found a real bug or retired a
suspicion permanently — they are the highest-yield artefact here.

### 5. A "did anything actually happen" assertion

Most of the wasted effort came from checks that could not distinguish *working* from
*silently doing nothing*. Give the tracer an expectation file per fixture — the trajectory
a variable must follow — so a fixture fails loudly rather than reading 0 and looking
plausible.

## Lessons that should shape the tools

**Pixels are the worst instrument available.** A frame that looks alive can be entirely
driven by `continuousSeconds()` while every action is inert. Colour-variety checks, frame
hashes and sprite trackers all gave confident wrong answers; one "droid tracker" was
measuring a cloud. Never conclude from a rendering what a state trace can answer.

**Headless browsers do not run the document.** Headless Chrome under
`--virtual-time-budget` paints roughly once, so every before/after pixel comparison in it
compares a frame with itself. The Node tracer exists because of this.

**A malformed fixture looks exactly like an engine bug.** Three fixtures in a row were
wrong before one was right: an array id from the wrong id space, a single particle where
the algorithm needs pairs, and a bare variable reference where the pair encoding needs
`CMD1`. A wrong document does not error here — it quietly evaluates to something else.
Always write the negative control (`cond_false`) alongside the positive one; without it,
"it works" and "it always fires" are indistinguishable.

**Suspect the harness before the engine.** Four bugs in this hunt were empty stubs in
androidx's own `MockRemoteContext`, not in either player. When the reference disagrees,
check that the reference is actually running.

**A differential tells you *that* two engines differ, never *which* is right.** The
arbiter is the DSL source of a document known to work. Reading
`DslGameFlappyDroid.kt` — seeing `drawCircle` inside the `particlesComparison` body —
settled in one minute a question that fixtures had left ambiguous for hours.

**Go to structure early.** State tracing localises to a variable; only structure
localises to an operation. The step that ended the hunt was extracting the `setValue`
targets from the document and looking at what contained them.
