#!/usr/bin/env bash
# determinism.sh — does a document render identically twice? The precondition for using
# anything as a pixel regression baseline.
#
#     players/determinism.sh DOC.rc [more.rc ...]
#     players/determinism.sh --free DOC.rc ...    # deliberately DON'T pin the clock
#
# Renders each document twice and compares bytes. With the clock pinned (the default) a
# difference is a real defect: the renderer is not a function of its inputs. Without the
# pin, most animated documents differ and that means nothing.
#
# Why the pin is not optional, measured 2026-08-25 over 90 documents from ten directories:
#
#     vary run-to-run, free clock:    62
#     vary run-to-run, pinned clock:   0
#
# So the corpus IS a usable baseline — the run-to-run variation everyone had noticed was
# the wall clock, not RAND. Corpus-wide only a couple of dozen documents contain anything
# resembling a RAND opcode, and the unseeded candidates in device-docs render identically
# even with a free clock. Do not reach for a seed to fix a diff until this script, run
# pinned, actually reports one.
#
# `--free` exists so this check can be shown to fail. A check nobody has watched fail is
# not evidence of anything; run it on any animated document and it should report drift.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RC2IMAGE="${RC2IMAGE:-$HERE/cpp/build/tools/rc2image/rc2image}"
EPOCH="${EPOCH:-1735689600000}"   # 2025-01-01T00:00:00Z
SIZE="${SIZE:-240}"

PIN=(--time "$EPOCH")
UNPINNED_NOTE=""
if [[ "${1:-}" == "--free" ]]; then
    PIN=(); UNPINNED_NOTE="   (clock NOT pinned)"; shift
fi

[[ -x "$RC2IMAGE" ]] || { echo "error: rc2image not built at $RC2IMAGE" >&2; exit 2; }
[[ $# -gt 0 ]] || { echo "usage: determinism.sh [--free] DOC.rc ..." >&2; exit 2; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
drift=0; ok=0; failed=0

for f in "$@"; do
    n="$(basename "$f" .rc)"
    if ! "$RC2IMAGE" "$f" "$TMP/a.png" "$SIZE" "$SIZE" ${PIN[@]+"${PIN[@]}"} >/dev/null 2>&1; then
        printf '  %-38s render failed\n' "$n"; failed=$((failed+1)); continue
    fi
    "$RC2IMAGE" "$f" "$TMP/b.png" "$SIZE" "$SIZE" ${PIN[@]+"${PIN[@]}"} >/dev/null 2>&1
    if cmp -s "$TMP/a.png" "$TMP/b.png"; then
        ok=$((ok+1))
    else
        printf '  %-38s DRIFT\n' "$n"; drift=$((drift+1))
    fi
done

echo
echo "  $ok stable, $drift drifted, $failed failed to render${UNPINNED_NOTE:-}"
[[ $drift -eq 0 && $failed -eq 0 ]]
