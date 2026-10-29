#!/usr/bin/env bash
# Run the Java reference layout dumper (java/RcLayoutDump.java) on a document.
#   players/conformance/java-layout.sh DOC.rc WIDTH HEIGHT [--density D] [--anim] [--click X Y] [--click-frame X Y] [--advance MS] [--settle]...
# Compiles androidx remote-core from the checkout (ANDROIDX, default ~/androidx) once, into a
# cache keyed by the sources' modification time; needs a JDK.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROIDX="${ANDROIDX:-$HOME/androidx}"
R="$ANDROIDX/frameworks/support/compose/remote"
CACHE="${RC_JAVA_CACHE:-${TMPDIR:-/tmp}/rc-java-ref}"
CP="$(ls "$HOME"/.gradle/caches/modules-2/files-2.1/org.json/json/*/*/json-*.jar 2>/dev/null | grep -v sources | tail -1)"
CP="$CP:$(ls "$HOME"/.gradle/caches/modules-2/files-2.1/org.jspecify/jspecify/1.0.0/*/jspecify-1.0.0.jar | head -1)"
CP="$CP:$(ls "$HOME"/.gradle/caches/modules-2/files-2.1/androidx.annotation/annotation-jvm/*/*/annotation-jvm-*.jar | grep -v sources | tail -1)"
STAMP="$(find "$R/remote-core/src/main/java" "$HERE/java" -name '*.java' -newer "$CACHE/.stamp" 2>/dev/null | head -1 || true)"
if [ ! -f "$CACHE/.stamp" ] || [ -n "$STAMP" ]; then
    rm -rf "$CACHE"; mkdir -p "$CACHE/out"
    javac -nowarn -d "$CACHE/out" -cp "$CP" \
        -sourcepath "$R/remote-core/src/main/java:$R/remote-creation/src/jvmTest/java" \
        "$HERE/java/RcLayoutDump.java" 2>&1 | grep -v "^Note:" >&2 || true
    touch "$CACHE/.stamp"
fi
exec java -cp "$CACHE/out:$CP" RcLayoutDump "$@"
