# Expression Engine Internals

## Overview

The RemoteCompose expression engine allows computed values (floats, integers, colors) to be evaluated on the player side using RPN (Reverse Polish Notation) expressions. Values can depend on system variables (window size, time, touch), user variables, and data collections — enabling animations, responsive layout, and interactivity without re-serializing the entire document.

There are three expression types:

| Operation | Opcode | Evaluator | Operator Encoding |
|-----------|--------|-----------|-------------------|
| FloatExpression | 81 | AnimatedFloatExpression | NaN-encoded in float array |
| IntegerExpression | 144 | IntegerExpressionEvaluator | Bitmask + int array |
| ColorExpression | 134 | (special: 4 float params → ARGB) | Float params may be NaN IDs |

## NaN Encoding Scheme

### How It Works

IEEE 754 floats have a NaN (Not a Number) representation when the exponent bits are all 1s. RemoteCompose exploits this to encode integer IDs inside float values.

**Encoding** (`asNan`):
```
float = intBitsToFloat(id | 0xFF800000)
```
The `0xFF800000` sets the sign bit and all 8 exponent bits to 1, making the result a NaN. The lower 23 bits carry the ID.

**Decoding** (`idFromNan` / `fromNaN`):
```
id = floatToRawIntBits(value) & 0x3FFFFF   // Utils.java: 22-bit mask
id = floatToRawIntBits(value) & 0x7FFFFF   // NanMap.java: 23-bit mask
```

The two masks differ only for IDs with bit 22 set (≥ 0x400000). In practice, all current IDs fit within 22 bits, so both masks produce the same result. The expression evaluator uses the 23-bit `NanMap.fromNaN()`.

### ID Regions

The upper bits of the 23-bit ID space are used to categorize ID types:

| Region | Bits 20-22 | Range | Purpose |
|--------|-----------|-------|---------|
| TYPE_SYSTEM (0) | `0x0xxxxx` | 0 – 0x0FFFFF | System variables (WINDOW_WIDTH, etc.) |
| TYPE_VARIABLE (1) | `0x1xxxxx` | 0x100000 – 0x1FFFFF | User-defined variables |
| TYPE_ARRAY (2) | `0x2xxxxx` | 0x200000 – 0x2FFFFF | Data arrays/collections |
| TYPE_OPERATION (3) | `0x3xxxxx` | 0x300000 – 0x3FFFFF | Math operators & path ops |

Check with: `(id >> 20) == regionType`

Mask: `ID_REGION_MASK = 0x700000`

### System Variables (Region 0)

System variables are injected by the player and available to all expressions. Defined in `RemoteContext.java`:

| ID | Name | Description |
|----|------|-------------|
| 1 | CONTINUOUS_SEC | Continuous seconds since epoch |
| 2 | TIME_IN_SEC | Current second (0-59) |
| 3 | TIME_IN_MIN | Current minute (0-59) |
| 4 | TIME_IN_HR | Current hour (0-23) |
| 5 | WINDOW_WIDTH | Player viewport width |
| 6 | WINDOW_HEIGHT | Player viewport height |
| 7 | COMPONENT_WIDTH | Current component width |
| 8 | COMPONENT_HEIGHT | Current component height |
| 9 | CALENDAR_MONTH | Current month (1-12) |
| 10 | OFFSET_TO_UTC | Offset from UTC in seconds |
| 11 | WEEK_DAY | Day of week |
| 12 | DAY_OF_MONTH | Day of month |
| 13 | TOUCH_POS_X | Current touch X position |
| 14 | TOUCH_POS_Y | Current touch Y position |
| 15 | TOUCH_VEL_X | Touch velocity X |
| 16 | TOUCH_VEL_Y | Touch velocity Y |
| 17 | ACCELERATION_X | Accelerometer X |
| 18 | ACCELERATION_Y | Accelerometer Y |
| 19 | ACCELERATION_Z | Accelerometer Z |
| 20 | GYRO_ROT_X | Gyroscope rotation X |
| 21 | GYRO_ROT_Y | Gyroscope rotation Y |
| 22 | GYRO_ROT_Z | Gyroscope rotation Z |
| 23 | MAGNETIC_X | Magnetometer X |
| 24 | MAGNETIC_Y | Magnetometer Y |
| 25 | MAGNETIC_Z | Magnetometer Z |
| 26 | LIGHT | Ambient light sensor |
| 27 | DENSITY | Display density |
| 28 | API_LEVEL | RemoteCompose API level |
| 29 | TOUCH_EVENT_TIME | Time of last touch event |
| 30 | ANIMATION_TIME | Time since document load (seconds) |
| 31 | ANIMATION_DELTA_TIME | Time since last frame |
| 32 | EPOCH_SECOND | Unix epoch seconds (long, via INT_EPOCH_SECOND) |
| 33 | FONT_SIZE | System font size |
| 34 | DAY_OF_YEAR | Day of year (1-366) |
| 35 | YEAR | Current year |
| 36 | FIRST_BASELINE | First text baseline |
| 37 | LAST_BASELINE | Last text baseline |

User variables start at `START_VAR = (1 << 20) + 42 = 0x10002A`.
Array variables start at `START_ARRAY = (2 << 20) + 42 = 0x20002A`.

---

## FloatExpression (Opcode 81)

### Binary Format

```
[opcode:1] [id:INT:4] [packedLen:INT:4] [values:FLOAT*valueLen] [animation:FLOAT*animLen]
```

- `id`: Result variable ID (where the computed value is stored)
- `packedLen`: `valueLen | (animLen << 16)` — two 16-bit lengths packed into one int
- `values`: The RPN expression as a float array (literals + NaN-encoded operators/variables)
- `animation`: Optional animation parameters (animLen floats, only if animLen > 0)

**Java write** (FloatExpression.apply, lines 279-304):
```java
buffer.writeInt(id);
buffer.writeInt(valueLen | (animLen << 16));
for (float v : values) buffer.writeFloat(v);
for (float v : animation) buffer.writeFloat(v);
```

**Java read** (FloatExpression.read, lines 312-335):
```java
id = buffer.readInt();
len = buffer.readInt();
valueLen = len & 0xFFFF;
animLen = (len >> 16) & 0xFFFF;
// read valueLen floats into values[]
// read animLen floats into animation[]
```

### RPN Evaluation — Two-Phase Approach

The float array (`mSrcValue[]`) contains a mix of:
1. **Literal float values** — pushed onto the stack
2. **NaN-encoded variable references** — system/normal vars pre-resolved, array refs kept as NaN
3. **NaN-encoded operators** — pop operands, compute, push result

**Phase 1: Variable Pre-Resolution** (`FloatExpression.updateVariables`):
```
mPreCalcValue = new float[mSrcValue.length]
for each float v in mSrcValue:
    if v is NaN AND NOT isMathOperator(v) AND NOT isDataVariable(v):
        // System or normal variable → resolve NOW
        mPreCalcValue[i] = context.getFloat(idFromNan(v))
    else:
        // Literal, operator, or array ref → copy as-is
        mPreCalcValue[i] = v
```

After this phase, the `mPreCalcValue[]` array contains:
- Literal floats (resolved from variables or original literals)
- NaN-encoded operators (unchanged)
- NaN-encoded array references (unchanged, for array ops to dereference later)

**Phase 2: RPN Stack Evaluation** (`AnimatedFloatExpression.eval`):
```
for each float v in mPreCalcValue:
    if v is NaN:
        id = fromNaN(v)                          // extract 23-bit ID
        if (id & ID_REGION_MASK) != ID_REGION_ARRAY:
            sp = opEval(sp, id)                   // operator dispatch (full ID, NOT id-OFFSET)
        else:
            push v as-is                          // array ref stays on stack for array ops
    else:
        push v                                    // literal or pre-resolved variable
return stack[sp]
```

**Note:** `opEval(sp, id)` receives the FULL `fromNaN` value (e.g., `0x310_001` for ADD). The switch cases compare against `OP_ADD = OFFSET + 1`, `OP_SUB = OFFSET + 2`, etc. IDs that don't match any case (shouldn't happen after pre-resolution) fall through with no effect.

### Float Operators

**OFFSET = 0x310_000** — All operator IDs are `OFFSET + n` where `n` is the operator number below.

`opEval(sp, id)` receives the full `fromNaN` value. The switch cases use `OP_ADD = OFFSET + 1`, `OP_SUB = OFFSET + 2`, etc. The `n` below is `id - OFFSET`.

| # | Name | Args | Operation | Description |
|---|------|------|-----------|-------------|
| 1 | ADD | 2 | a + b | Addition |
| 2 | SUB | 2 | a - b | Subtraction |
| 3 | MUL | 2 | a * b | Multiplication |
| 4 | DIV | 2 | a / b | Division |
| 5 | MOD | 2 | a % b | Modulo (remainder) |
| 6 | MIN | 2 | min(a, b) | Minimum |
| 7 | MAX | 2 | max(a, b) | Maximum |
| 8 | POW | 2 | pow(a, b) | Power |
| 9 | SQRT | 1 | sqrt(a) | Square root |
| 10 | ABS | 1 | abs(a) | Absolute value |
| 11 | SIGN | 1 | signum(a) | Sign (-1, 0, 1) |
| 12 | COPY_SIGN | 2 | copySign(a, b) | Copy sign of b to a |
| 13 | EXP | 1 | exp(a) | e^a |
| 14 | FLOOR | 1 | floor(a) | Floor |
| 15 | LOG | 1 | log10(a) | Log base 10 |
| 16 | LN | 1 | ln(a) | Natural log |
| 17 | ROUND | 1 | round(a) | Round to nearest int |
| 18 | SIN | 1 | sin(a) | Sine (radians) |
| 19 | COS | 1 | cos(a) | Cosine |
| 20 | TAN | 1 | tan(a) | Tangent |
| 21 | ASIN | 1 | asin(a) | Arc sine |
| 22 | ACOS | 1 | acos(a) | Arc cosine |
| 23 | ATAN | 1 | atan(a) | Arc tangent |
| 24 | ATAN2 | 2 | atan2(a, b) | Two-arg arc tangent |
| 25 | MAD | 3 | a * b + c | Multiply-add |
| 26 | IFELSE | 3 | a > 0 ? b : c | Conditional select |
| 27 | CLAMP | 3 | clamp(a, b, c) | Clamp a to [b, c] |
| 28 | CBRT | 1 | cbrt(a) | Cube root |
| 29 | DEG | 1 | toDegrees(a) | Radians to degrees |
| 30 | RAD | 1 | toRadians(a) | Degrees to radians |
| 31 | CEIL | 1 | ceil(a) | Ceiling |
| 32 | A_DEREF | 2 | array[index] | Array dereference |
| 33 | A_MAX | 1 | max(array) | Array max |
| 34 | A_MIN | 1 | min(array) | Array min |
| 35 | A_SUM | 1 | sum(array) | Array sum |
| 36 | A_AVG | 1 | avg(array) | Array average |
| 37 | A_LEN | 1 | array.length | Array length |
| 38 | A_SPLINE | 2 | spline(array, t) | Catmull-Rom spline interpolation |
| 39 | RAND | 0 | random() | Random [0, 1) |
| 40 | RAND_SEED | 1 | random(seed) | Seeded random (deterministic) |
| 41 | NOISE_FROM | 1 | noise(x) | Perlin-like noise |
| 42 | RAND_IN_RANGE | 2 | random(min, max) | Random in range |
| 43 | SQUARE_SUM | 2 | a² + b² | Sum of squares |
| 44 | STEP | 2 | a > b ? 1 : 0 | Step function |
| 45 | SQUARE | 1 | a * a | Square |
| 46 | DUP | 1→2 | a, a | Duplicate top of stack |
| 47 | HYPOT | 2 | sqrt(a² + b²) | Hypotenuse |
| 48 | SWAP | 2→2 | b, a | Swap top two |
| 49 | LERP | 3 | a + (b - a) * c | Linear interpolation |
| 50 | SMOOTH_STEP | 3 | smoothstep(a, b, c) | Hermite interpolation |
| 51 | LOG2 | 1 | log2(a) | Log base 2 |
| 52 | INV | 1 | 1/a | Inverse |
| 53 | FRACT | 1 | a - floor(a) | Fractional part |
| 54 | PINGPONG | 2 | pingpong(a, b) | Triangle wave |
| 55 | NOP | 0 | (nothing) | No operation |
| 56 | STORE_R0 | 1→1 | R0 = a, keep a | Store to register 0 |
| 57 | STORE_R1 | 1→1 | R1 = a, keep a | Store to register 1 |
| 58 | STORE_R2 | 1→1 | R2 = a, keep a | Store to register 2 |
| 59 | STORE_R3 | 1→1 | R3 = a, keep a | Store to register 3 |
| 60 | LOAD_R0 | 0→1 | push R0 | Load from register 0 |
| 61 | LOAD_R1 | 0→1 | push R1 | Load from register 1 |
| 62 | LOAD_R2 | 0→1 | push R2 | Load from register 2 |
| 63 | LOAD_R3 | 0→1 | push R3 | Load from register 3 |
| 70 | VAR1 | 1 | (context-dependent) | Variable operation 1 |
| 71 | VAR2 | 2 | (context-dependent) | Variable operation 2 |
| 72 | VAR3 | 3 | (context-dependent) | Variable operation 3 |
| 73 | CHANGE_SIGN | 1 | -a | Negate |
| 74 | CUBIC | 4 | cubic(a,b,c,d) | Cubic polynomial |
| 75 | A_SPLINE_LOOP | 2 | spline_loop(array, t) | Looping spline |
| 76 | A_SUM_TILL | 2 | sum(array[0..n]) | Partial sum |
| 77 | A_SUM_XY | 3 | (specialized) | Sum with XY |
| 78 | A_SUM_SQR | 1 | sum(a²) | Sum of squares |
| 79 | A_LERP | 3 | lerp within array | Array lerp |

### Dirty Tracking

FloatExpression tracks which variables have changed since last evaluation. If no dependencies changed, the cached result is returned. Dependencies are collected during the first evaluation by recording which variable IDs are accessed.

---

## IntegerExpression (Opcode 144)

### Binary Format

```
[opcode:1] [id:INT:4] [mask:INT:4] [len:INT:4] [values:INT*len]
```

- `id`: Result variable ID
- `mask`: Bitmask indicating which positions in the values array are operators (vs operands)
- `len`: Number of int values
- `values`: The RPN expression as an int array

### Operator Identification via Bitmask

Unlike FloatExpression (which uses NaN encoding), IntegerExpression uses a bitmask:

```
if ((mask >> i) & 1) == 1:
    values[i] is an operator → call opEval(sp, values[i] - OFFSET)
else:
    values[i] is a literal or variable reference → push onto stack
```

**OFFSET = 0x10000** for integer operators.

### Integer Operators

| # | Name | Args | Operation |
|---|------|------|-----------|
| 1 | I_ADD | 2 | a + b |
| 2 | I_SUB | 2 | a - b |
| 3 | I_MUL | 2 | a * b |
| 4 | I_DIV | 2 | a / b |
| 5 | I_MOD | 2 | a % b |
| 6 | I_SHL | 2 | a << b |
| 7 | I_SHR | 2 | a >> b |
| 8 | I_USHR | 2 | a >>> b |
| 9 | I_OR | 2 | a \| b |
| 10 | I_AND | 2 | a & b |
| 11 | I_XOR | 2 | a ^ b |
| 12 | I_COPY_SIGN | 2 | copySign(a, b) |
| 13 | I_MIN | 2 | min(a, b) |
| 14 | I_MAX | 2 | max(a, b) |
| 15 | I_NEG | 1 | -a |
| 16 | I_ABS | 1 | abs(a) |
| 17 | I_INCR | 1 | a + 1 |
| 18 | I_DECR | 1 | a - 1 |
| 19 | I_NOT | 1 | ~a |
| 20 | I_SIGN | 1 | signum(a) |
| 21 | I_CLAMP | 3 | clamp(a, b, c) |
| 22 | I_IFELSE | 3 | a > 0 ? b : c |
| 23 | I_MAD | 3 | a * b + c |
| 24 | I_VAR1 | 1 | (context-dependent) |
| 25 | I_VAR2 | 2 | (context-dependent) |

---

## ColorExpression (Opcode 134)

### Binary Format

```
[opcode:1] [id:INT:4] [p1:INT:4] [p2:INT:4] [p3:INT:4] [p4:INT:4]
```

- `id`: Result color variable ID
- `p1-p4`: Four parameters (may be literal ints or NaN-encoded float IDs)

The four parameters typically represent ARGB components that can be dynamic (referencing FloatExpression results).

### Total payload: 20 bytes (5 ints)

---

## Path Operations in Float Arrays

Path data (PathData, opcode 123) uses NaN-encoded floats for path commands within the float array:

| ID | Name | Following Floats |
|----|------|-----------------|
| 0x300_000 | MOVE | x, y |
| 0x300_001 | LINE | x, y |
| 0x300_002 | QUADRATIC | cx, cy, x, y |
| 0x300_003 | CONIC | cx, cy, x, y, weight |
| 0x300_004 | CUBIC | c1x, c1y, c2x, c2y, x, y |
| 0x300_005 | CLOSE | (none) |
| 0x300_006 | DONE | (none) |

---

## TS vs Java: Critical Differences Found

### Bug 1: Wrong Operator ID Scheme

**Java** (AnimatedFloatExpression):
- Operators are NaN-encoded with IDs in the `0x3xxxxx` region
- OFFSET = `0x310_000`
- ADD = `0x310_001`, SUB = `0x310_002`, MUL = `0x310_003`, etc.
- Identification: `(fromNaN(v) >> 20) == 3` → it's an operator
- Dispatch: `opEval(sp, fullId)` where switch cases are `OP_ADD = OFFSET + 1`, etc.

**TS** (ExpressionOperations.ts, current):
- Uses `idFromNan(v)` (correct extraction)
- But checks `if (id >= 0 && id < 128)` — **WRONG**: operator IDs are ~3.2M, not 0-127
- Uses wrong operator numbers: `case 30: // ADD` — **WRONG**: ADD is `OFFSET + 1` = `0x310_001`
- The entire operator dispatch is non-functional with real data

**Impact**: FloatExpression evaluate() never matches any operator from actual .rc files. All NaN values fall through to variable lookup. Expressions that should compute `a + b` instead try to look up variable ID 0x310001, getting 0.

### Bug 1b: No Two-Phase Resolution

The Java pre-resolves system/normal variables via `updateVariables()` BEFORE calling `eval()`. The TS does everything inline in a single pass, which is a valid approach but it must correctly distinguish:
- System/normal variable NaN → resolve via `context.getFloat(id)` and push the float
- Operator NaN → execute the operator
- Array NaN → push as-is for array operators to dereference

The TS currently treats all NaN with `id < 128` as operators and everything else as variables, which is backwards.

### Bug 2: Missing Operator Coverage

Even fixing the ID scheme, the TS implements only 15 of 79 operators:

**Implemented** (need renumbering): ADD, SUB, MUL, DIV, MOD, SIN, COS, TAN, MIN, MAX, ABS, FLOOR, CEIL, ROUND, SQRT

**Missing** (64 operators): POW, SIGN, COPY_SIGN, EXP, LOG, LN, ASIN, ACOS, ATAN, ATAN2, MAD, IFELSE, CLAMP, CBRT, DEG, RAD, all array ops (A_DEREF through A_LERP), RAND/NOISE, SQUARE_SUM, STEP, SQUARE, DUP, HYPOT, SWAP, LERP, SMOOTH_STEP, LOG2, INV, FRACT, PINGPONG, NOP, all register ops (STORE_R0-R3, LOAD_R0-R3), VAR1-3, CHANGE_SIGN, CUBIC, A_SPLINE_LOOP, A_SUM_TILL, A_SUM_XY, A_SUM_SQR

### Bug 3: IntegerExpression Not Evaluated

The TS IntegerExpression.apply() just loads `mValues[0]` as the result, ignoring the RPN expression entirely. Real integer expressions with operators produce wrong values.

### Bug 4: ColorExpression Oversimplified

The TS ColorExpression.apply() just loads `mParam1` as the color. It doesn't evaluate the parameters as potential NaN-encoded float references that resolve to dynamic ARGB components.

---

## Worked Example

### Expression: `WINDOW_WIDTH / 2`

**Creation** (Java):
```java
float[] expr = {
    Utils.asNan(5),                           // WINDOW_WIDTH (system var ID 5)
    2.0f,                                     // literal 2
    Utils.asNan(AnimatedFloatExpression.OFFSET + 4)  // DIV operator (0x310_004)
};
```

**Wire bytes** (for the expression part):
```
[NaN(5)]  [2.0f]  [NaN(0x310004)]
```

**Phase 1: updateVariables**:
1. `mSrcValue[0] = NaN(5)` → NOT operator, NOT array → resolve: `context.getFloat(5)` = 1080.0
2. `mSrcValue[1] = 2.0` → literal → copy as-is
3. `mSrcValue[2] = NaN(0x310004)` → IS operator → copy as-is

`mPreCalcValue = [1080.0, 2.0, NaN(0x310004)]`

**Phase 2: eval**:
1. `v = 1080.0` → literal → push 1080.0
2. `v = 2.0` → literal → push 2.0
3. `v = NaN(0x310004)` → NaN, not array region → `opEval(sp, 0x310004)` → matches `OP_DIV`
   - `stack[sp-1] = stack[sp-1] / stack[sp]` → 1080.0 / 2.0 = 540.0
4. Result: 540.0

---

## Authoritative Sources

| Source | Path | Purpose |
|--------|------|---------|
| AnimatedFloatExpression.java | `remote-core/.../operations/utilities/` | Float RPN evaluator, all 79 operators |
| IntegerExpressionEvaluator.java | `remote-core/.../operations/utilities/` | Integer RPN evaluator, 25 operators |
| FloatExpression.java | `remote-core/.../operations/` | Binary format, read/write, animation support |
| NanMap.java | `remote-core/.../operations/utilities/` | ID regions, path constants, NaN encoding |
| Utils.java | `remote-core/.../operations/` | asNan/idFromNan encoding functions |
| ExpressionOperations.ts | `ts/src/core/operations/` | TS implementation (has bugs documented above) |
