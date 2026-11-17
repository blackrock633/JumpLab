#!/bin/sh
set -eu
mkdir -p .cache/tmp .cache/DerivedData
export TMPDIR="$PWD/.cache/tmp"
export EXPO_NO_TELEMETRY=1
COCOAPODS_DISABLE_STATS=true pod install --project-directory=ios --no-repo-update
xcodebuild -workspace ios/JumpLab.xcworkspace -scheme JumpLab -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath .cache/DerivedData CODE_SIGNING_ALLOWED=NO build
