#!/usr/bin/env bash
# Build the iosViewer app. Generates iosViewer.xcodeproj from project.yml via
# xcodegen, then runs xcodebuild for arm64 iOS device.
#
# Prerequisites:
#   - Xcode 15+ with Command Line Tools
#   - Homebrew (for installing xcodegen on first run)
#   - The rcX iOS static libs built at ../../ios/output/
#     (run `(cd ../../ios && ./build.sh)` if missing)
set -euo pipefail

cd "$(dirname "$0")"

# --- Sanity-check the iOS libs ---
IOS_LIB_DIR="../../ios/output/lib"
if [ ! -f "$IOS_LIB_DIR/librccore.a" ] || [ ! -f "$IOS_LIB_DIR/libskia.a" ]; then
    echo "error: rcX iOS libs not found at $IOS_LIB_DIR"
    echo "       Run: (cd ../../ios && ./build.sh)"
    exit 1
fi

# --- Install xcodegen if missing ---
if ! command -v xcodegen >/dev/null 2>&1; then
    echo ">>> xcodegen not found; installing via Homebrew…"
    if ! command -v brew >/dev/null 2>&1; then
        echo "error: Homebrew not found. Install from https://brew.sh/ and re-run."
        exit 1
    fi
    brew install xcodegen
fi

# --- Generate the Xcode project ---
echo ">>> Running xcodegen…"
xcodegen generate

# --- Build ---
DEST="${DEST:-generic/platform=iOS}"
CONFIG="${CONFIG:-Debug}"
echo ">>> Building iosViewer (config=$CONFIG, destination=$DEST)…"
xcodebuild \
    -project iosViewer.xcodeproj \
    -scheme iosViewer \
    -configuration "$CONFIG" \
    -destination "$DEST" \
    CODE_SIGNING_ALLOWED=NO \
    build
