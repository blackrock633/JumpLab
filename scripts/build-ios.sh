#!/bin/sh
set -eu
for nested in modules/*/node_modules; do
  if [ -d "$nested" ]; then
    printf 'Nested module install found at %s; remove it (duplicate react-native breaks autolinking).\n' "$nested" >&2
    exit 3
  fi
done
mkdir -p .cache/tmp .cache/DerivedData
export TMPDIR="$PWD/.cache/tmp"
export EXPO_NO_TELEMETRY=1
COCOAPODS_DISABLE_STATS=true pod install --project-directory=ios --no-repo-update
xcodebuild -workspace ios/JumpLab.xcworkspace -scheme JumpLab -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath .cache/DerivedData CODE_SIGNING_ALLOWED=NO build
