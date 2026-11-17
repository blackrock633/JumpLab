#!/bin/sh
set -eu
: "${JUMPLAB_SIMULATOR_UDID:?Set the booted iOS simulator UDID}"
mkdir -p .cache/tmp
export TMPDIR="$PWD/.cache/tmp"
xcrun simctl install "$JUMPLAB_SIMULATOR_UDID" .cache/DerivedData/Build/Products/Debug-iphonesimulator/JumpLab.app
xcrun simctl launch "$JUMPLAB_SIMULATOR_UDID" app.jumplab.ios
xcodebuild test -workspace ios/JumpLab.xcworkspace -scheme JumpLab -destination "id=$JUMPLAB_SIMULATOR_UDID" -derivedDataPath .cache/DerivedData -resultBundlePath .cache/LaunchSmoke.xcresult -only-testing:JumpLabUITests CODE_SIGNING_ALLOWED=NO
