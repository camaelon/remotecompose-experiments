# Conformance: the players against the Java reference

These tools compare the C++ player and the TypeScript player with androidx's Java
`remote-core`: same bytes in, same component tree out (ids and bounds).

| tool | what it does |
| :--- | :--- |
| `layout-specs.mjs` | Runs androidx's `compose/remote/layout-specs` (189 specs, each with the bytes Android compiled and the tree an Android device laid out) through `rc2layout` (C++) and `layout.mjs` (TS), comparing every component by id. Use `--engine cpp\|ts\|both`, `--filter REGEX`, `--verbose` and `--json OUT`. Rebuilds the TS bundle first unless `--no-rebuild` |
| `java-layout.sh` | **The Java reference on any document**: `remote-core` on the JVM with `MockRemoteContext` (as layout-specs' coverage harness does), printing `LAYOUT id x y w h Type` lines in tree order. `java-layout.sh DOC.rc W H [--density D] [--click X Y]...`. It compiles the androidx sources into a cache on first use, so it needs a JDK and the androidx checkout (`ANDROIDX`, default `~/androidx`) |
| `java-json.sh` | **The Java JSON converter**: androidx's `RemoteComposeJsonParser` (Kotlin and Java, compiled once into a cache; needs `kotlinc`). `java-json.sh DOC.json OUT.rc`. json2rc is checked byte for byte against it, and `examples/tools/build.mjs --java` does so for every catalog example |
| `compare.mjs` | Three-way: the Java reference (`java-layout.sh`) against C++ and TS on any `.rc` files. `--size WxH` (default: the header's DOC_WIDTH × DOC_HEIGHT, read with the TypeScript player's header parser; it used to take rc2layout's first output line, which is the most negative id, a leaf, since rc2layout sorts by id: CMP documents came out 52x32), `--engine`, `--verbose`. Duplicate ids are matched in order, because the reference itself shares ids, such as a text inside a pattern. An engine that keys layout by id, as the C++ player does, gets its collapsed repeats counted apart rather than as missing |

**Text measurement.** `java-layout.sh` measures text the way `MockRemoteContext` does: 100×10
for simple text, and 30 per character by 40 for complex text. Set `RC_MOCK_TEXT=1` to make the
TypeScript player measure text the same way, so a comparison isolates layout logic from fonts.
The C++ player has no such mode yet, so its text-sized components differ from the reference
for font reasons. This is inherent to the headless reference, not a bug in it or in the tools:
`MockRemoteContext` (remote-creation's jvmTest) has no font backend, and its `getTextBounds`
returns a fixed 100×10 whatever the string or font size (`layoutComplexText` 30 per character
by 40). Every simple text in a `java-layout.sh` result is therefore 100×10; compare text sizes
only with `RC_MOCK_TEXT=1` on the TS side, or against a device.

`layout-specs.mjs --interactive` runs the cases with steps instead of the others: `click`
(`settle: false` → `--click-frame`), `advanceTime` (`--advance`), `settle` and `resize`, with
`--anim` when the spec has `animation: true`. rc2layout, layout.mjs and java-layout.sh take the
same flags, on a manual clock that only moves when a step moves it. A reference size of
2^63/100 or more (Java's saturated `Math.round(v * 100) / 100.0` of a gone child measured
against Float.MAX_VALUE) is matched by any engine value as large.

## Status (2026-10-29)

| | C++ | TypeScript |
| :--- | :--- | :--- |
| layout-specs cases passing (of 211; 105 interactive cases skipped) | 163 (components 1667/1866 match; was 133, 1510) | 178 (components 1692/1866 match; was 166, 1631) |
| `--interactive` (62 click/advanceTime/settle/resize cases; 43 drag/long-press/double-click skipped) | 44 (437/504) | 56 (482/504) |
| collapsible* and stateLayout* (24 non-interactive cases, plus 14 interactive) | 24/24, interactive 13/14 | 24/24, interactive 14/14 |
| `pattern.loom.inflate`, `pattern.loom.inflation-ops` | 1 / 2 (see below) | 2 / 2 |
| `modifier.include.style` | passes (newly) | passes |
| Loom: the 125 readers that remap ids, matching Java | all hand-checked; the scripted check sees 95, since manual remaps read a raw word first | 109 by the scripted check, plus manual ones |

`pattern.loom.inflation-ops` fails in C++ only because that player defines system variable 40
as free memory in MB (an extension). The spec passes `arguments: [40]`, which the JSON parser
turns into variable id 40, so the template's box is sized by free memory. On Java, id 40 is
unassigned and reads 0.
