#!/bin/bash
# vec-parity.sh — compare the TypeScript VectorRpn against the reference, value by value.
#
# VectorExpression writes to variables rather than drawing, so the image-based 3d-parity.sh
# cannot see it. This runs the same RPN programs through both evaluators and requires the raw
# float bits to match exactly, which is a stricter test than a pixel diff: a wrong lane or a
# one-ULP arithmetic difference shows up directly instead of being quantized away by the
# rasterizer.
set -u
cd "$(dirname "$0")"

ORACLE=3d-oracle
TS=typescript
CORE=${RC_CORE:-/Users/john/code/androidx-main2/frameworks/support/compose/remote/remote-core/src/main/java}

javac -d "$ORACLE/classes" -nowarn \
    $(find "$ORACLE/src" -name '*.java' ! -path '*utilities/d3*' ! -path '*utilities/easing*') \
    $(find "$CORE" -name '*.java') || exit 1
(cd "$TS" && npx esbuild src/core/operations/utilities/VectorRpn.ts --bundle \
    --outfile=build-node/vecrpn.mjs --format=esm --target=es2020 >/dev/null) || exit 1
mkdir -p /tmp/3dparity/cppbuild
c++ -std=c++17 -O2 -ffp-contract=off -I cpp/lib/rccore/include \
    cpp/lib/rccore/src/d3/VectorRpn.cpp cpp/tools/vecrpn/main.cpp \
    -o /tmp/3dparity/cppbuild/vecrpn || exit 1

# name|softDomain|program
PROGRAMS=(
    "scalar_add|0|2 3 +"
    "scalar_chain|0|2 3 + 4 * 1.5 -"
    "build2|0|1 2 vec2"
    "build3|0|1 2 3 vec3"
    "build4|0|1 2 3 4 vec4"
    "vec_add|0|1 2 3 vec3 10 20 30 vec3 +"
    "vec_sub|0|5 6 7 vec3 1 2 3 vec3 -"
    "vec_scale|0|1 2 3 vec3 2.5 *"
    "vec_div|0|10 20 30 vec3 4 /"
    "vec_mod|0|10.5 20.25 30.125 vec3 4 %"
    "dot3|0|1 2 3 vec3 4 5 6 vec3 dot"
    "dot2|0|3 4 vec2 3 4 vec2 dot"
    "cross|0|1 0 0 vec3 0 1 0 vec3 cross"
    "cross_general|0|1.5 -2.25 3 vec3 -0.5 4 2.75 vec3 cross"
    "len3|0|3 4 0 vec3 len"
    "len4|0|1 2 3 4 vec4 len"
    "lensq|0|1.5 2.5 3.5 vec3 lensq"
    "norm|0|3 4 0 vec3 norm"
    "norm_general|0|-1.25 2.5 -3.75 vec3 norm"
    "min_max|0|1 5 2 vec3 3 2 4 vec3 min 0 0 0 vec3 max"
    "unary_chain|0|-2.7 abs sqrt 1.3 pow"
    "trig|0|0.7 sin 1.1 cos +"
    "rounding|0|2.5 floor -2.5 ceil + 2.5 round + -2.5 round +"
    "neg_inv|0|4 neg inv"
    "square|0|1 2 3 vec3 square"
    "nop|0|1 2 3 vec3 nop"
    "mixed_dim|0|1 2 vec2 3 4 5 vec3 +"
    # Domain edges: an exact divide by zero, then the same program under soft domain. The
    # reference produces Inf/NaN in the first and a finite value in the second, which is the
    # whole point of the retry path in VectorExpression.apply().
    "div_zero_exact|0|1 2 3 vec3 0 /"
    "div_zero_soft|1|1 2 3 vec3 0 /"
    "norm_zero_exact|0|0 0 0 vec3 norm"
    "norm_zero_soft|1|0 0 0 vec3 norm"
    "inv_zero_soft|1|0 inv"
)

pass=0; fail=0
printf "  %-18s %-8s %s\n" program TS C++
for entry in "${PROGRAMS[@]}"; do
    name="${entry%%|*}"
    rest="${entry#*|}"
    soft="${rest%%|*}"
    prog="${rest#*|}"
    if [ "$soft" = "1" ]; then
        j=$(java -cp "$ORACLE/classes" DumpVec --soft "$prog" 2>&1)
        t=$(cd "$TS" && node vecrpn.mjs --soft "$prog" 2>&1)
        c=$(/tmp/3dparity/cppbuild/vecrpn --soft "$prog" 2>&1)
    else
        j=$(java -cp "$ORACLE/classes" DumpVec "$prog" 2>&1)
        t=$(cd "$TS" && node vecrpn.mjs "$prog" 2>&1)
        c=$(/tmp/3dparity/cppbuild/vecrpn "$prog" 2>&1)
    fi
    tr="ok"; [ "$j" = "$t" ] || tr="DIFFERS"
    cr="ok"; [ "$j" = "$c" ] || cr="DIFFERS"
    printf "  %-18s %-8s %s\n" "$name" "$tr" "$cr"
    if [ "$j" = "$t" ] && [ "$j" = "$c" ]; then
        pass=$((pass+1))
    else
        [ "$j" = "$t" ] || printf "      java: %s\n      ts:   %s\n" "$j" "$t"
        [ "$j" = "$c" ] || printf "      java: %s\n      c++:  %s\n" "$j" "$c"
        fail=$((fail+1))
    fi
done
echo
echo "  $pass identical, $fail differing"
[ "$fail" -eq 0 ]
