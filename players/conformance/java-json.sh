#!/usr/bin/env bash
# Convert a JSON document with the Java reference parser (java/JsonToRc.java), which is the
# authority json2rc is checked against.
#   players/conformance/java-json.sh DOC.json OUT.rc
# Compiles androidx remote-creation-core (Kotlin and Java) and remote-core from the checkout
# (ANDROIDX, default ~/androidx) once, into a cache keyed by the sources' modification time;
# needs a JDK and kotlinc.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROIDX="${ANDROIDX:-$HOME/androidx}"
R="$ANDROIDX/frameworks/support/compose/remote"
CACHE="${RC_JAVA_JSON_CACHE:-${TMPDIR:-/tmp}/rc-java-json}"
G="$HOME/.gradle/caches/modules-2/files-2.1"
# org.json as on Android (the SDK's own sources): its JSONObject keeps insertion order, as a
# device does, where desktop org.json's HashMap reorders keys, and with them the ids the
# parser assigns to resources.
ORGJSON_SRC="${ANDROID_ORGJSON:-$(ls -d "$ANDROIDX"/prebuilts/fullsdk-darwin/sources/android-35/org/json "$ANDROIDX"/prebuilts/fullsdk-linux/sources/android-35/org/json 2>/dev/null | head -1)}"
CP="$CACHE/orgjson"
CP="$CP:$(ls "$G"/androidx.annotation/annotation-jvm/*/*/annotation-jvm-*.jar | grep -v sources | tail -1)"
CP="$CP:$(ls "$G"/org.jspecify/jspecify/1.0.0/*/jspecify-1.0.0.jar | head -1)"
KSTD="$(ls "$G"/org.jetbrains.kotlin/kotlin-stdlib/2.1.0/*/kotlin-stdlib-2.1.0.jar | head -1)"
STAMP="$(find "$R/remote-core/src/main/java" "$R/remote-creation-core/src/main" "$HERE/java/JsonToRc.java" \
    -name '*.java' -newer "$CACHE/.stamp" -o -name '*.kt' -newer "$CACHE/.stamp" 2>/dev/null | head -1 || true)"
if [ ! -f "$CACHE/.stamp" ] || [ -n "$STAMP" ]; then
    rm -rf "$CACHE"; mkdir -p "$CACHE/kt" "$CACHE/out" "$CACHE/orgjson-src/org/json" "$CACHE/orgjson"
    echo "java-json: compiling the reference parser (once)..." >&2
    # Strip the platform annotations so the sources build outside the platform.
    for f in "$ORGJSON_SRC"/*.java; do
        sed -E '/^import (static )?(android|libcore|dalvik|com\.android)\./d;
                s/@(UnsupportedAppUsage|SystemApi|Nullable|NonNull)(\([^)]*\))?//g' "$f" \
            > "$CACHE/orgjson-src/org/json/$(basename "$f")"
    done
    # The parser is written against desktop org.json, whose JSONException is unchecked.
    sed -i.bak 's/extends Exception/extends RuntimeException/' "$CACHE/orgjson-src/org/json/JSONException.java"
    javac -nowarn -d "$CACHE/orgjson" "$CACHE"/orgjson-src/org/json/*.java >&2
    kotlinc $(find "$R/remote-creation-core/src/main" -name '*.kt') \
        "$R/remote-creation-core/src/main/java" "$R/remote-core/src/main/java" \
        -cp "$CP" -d "$CACHE/kt" -nowarn 2>&1 | grep -E "error" >&2 || true
    javac -nowarn -d "$CACHE/out" -cp "$CACHE/kt:$KSTD:$CP" \
        -sourcepath "$R/remote-creation-core/src/main/java:$R/remote-core/src/main/java" \
        "$HERE/java/JsonToRc.java" 2>&1 | grep -v "^Note:" >&2 || true
    touch "$CACHE/.stamp"
fi
exec java -cp "$CACHE/out:$CACHE/kt:$KSTD:$CP" JsonToRc "$@"
