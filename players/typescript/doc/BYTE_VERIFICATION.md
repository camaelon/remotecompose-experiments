# Byte-Level Verification Methodology

## The Problem

RemoteCompose binary format has **no length prefix** per operation. Each operation's `read()` function defines how many bytes to consume, and this is **variable** — it depends on the data (counts, string lengths, flags, etc.).

If a `read()` function consumes even **one byte** too many or too few, every subsequent operation in the stream is misaligned and parsing fails completely. The parser sees garbage bytes as opcodes and either crashes or produces wrong results.

## The Authoritative Sources

1. **Java `read()` and `write()` methods** in `remote-core/src/main/java/androidx/compose/remote/core/operations/` — the only complete truth for each operation's byte layout
2. **OpcodeRegistry.java** in `integration-tests/player-view-demos/.../convert/OpcodeRegistry.java` — defines field specs for operations the converter understands (useful cross-reference for fixed-length ops)
3. **JSON converter output** — the `payloadBase64` field captures the exact bytes consumed by each operation (via the Java `companion.read()`)

## The Verification Harness

### `trace-parse.mjs`

Traces byte offsets during TS parsing and compares against expected offsets from JSON converter output.

```bash
# Trace a single file
node trace-parse.mjs ../advanced_samples/count_down.rc

# Compare against JSON (reports mismatches)
node trace-parse.mjs ../advanced_samples/count_down.rc ../advanced_samples/json/count_down.json

# Sweep all samples
for f in ../advanced_samples/*.rc; do
  name=$(basename "$f" .rc)
  json="../advanced_samples/json/${name}.json"
  node trace-parse.mjs "$f" "$json" 2>&1 | grep -E "MISMATCH|match|mismatches"
done
```

Output format:
```
[17] offset=397  opcode=133 (DrawTextAnchored)  24 payload bytes
```

Mismatch format:
```
[17] MISMATCH opcode=133 (DRAW_TEXT_ANCHOR)
      payload: TS=25 vs JSON=24
```

### How the JSON comparison works

The converter (`RemoteComposeConverter.java`) uses Java's `companion.read()` to determine byte boundaries:
```java
int startIdx = buffer.getIndex();
int opcode = buffer.readByte();
companion.read(buffer, tempOps);
int endIdx = buffer.getIndex();
byte[] payload = new byte[endIdx - startIdx - 1];
```

For operations it understands structurally (`kind=op`), it also deconstructs fields.
For operations it doesn't fully understand (`kind=opaque`), it captures the raw bytes as `payloadBase64`.

Either way, the byte count is authoritative because it comes from the Java parser.

## Methodology for Each New Operation

1. **Read Java source**: Find the operation class in `remote-core/.../operations/`. Read both `write()` and `read()` methods.
2. **Document byte layout**: Write the format as `[opcode:1] [field1:4] [field2:4] ...` with exact byte sizes.
3. **Cross-reference OpcodeRegistry**: Check if the converter has field specs. Verify they match.
4. **Implement TS read()**: Write the TypeScript read function to consume identical bytes.
5. **Run trace-parse**: Verify 0 mismatches across all samples.

## Bugs Found by This Methodology

### DrawTextAnchored (opcode 133)
- **TS read**: `INT, FLOAT, FLOAT, FLOAT, FLOAT, FLOAT, BOOLEAN` = 25 bytes
- **Java read**: `INT, FLOAT, FLOAT, FLOAT, FLOAT, INT` = 24 bytes
- **Bug**: TS had extra `angle:FLOAT` and `rtl:BOOLEAN` instead of `flags:INT`
- **Impact**: 1-byte overread caused desync for all subsequent ops

### RootLayoutComponent (opcode 200)
- **TS read**: `INT, INT` = 8 bytes
- **Java read**: `INT` = 4 bytes
- **Bug**: TS read an extra `alignment:INT` that doesn't exist in the format
- **Impact**: 4-byte overread caused desync

### NamedVariable (opcode 137)
- **TS read**: `UTF8, INT, INT` (string first)
- **Java read**: `INT, INT, UTF8` (string last)
- **Bug**: Field order was swapped — string is variable-length so byte counts diverge
- **Impact**: Variable-size desync depending on string length

## Verification Status

After fixes: **0 mismatches across all 60 advanced samples** for all implemented operations.
