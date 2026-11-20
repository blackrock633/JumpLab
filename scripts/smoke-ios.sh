#!/bin/sh
set -eu
: "${JUMPLAB_SIMULATOR_UDID:?Set the booted iOS simulator UDID}"
app=.cache/DerivedData/Build/Products/Debug-iphonesimulator/JumpLab.app
result_bundle=.cache/LaunchSmoke.xcresult
if [ ! -x "$app/JumpLab" ]; then
  printf '%s\n' 'JumpLab simulator binary is missing. Run npm run build:ios:simulator first.' >&2
  exit 2
fi
if ! xcrun simctl getenv "$JUMPLAB_SIMULATOR_UDID" HOME >/dev/null; then
  printf 'Boot simulator %s and ensure CoreSimulator is available before retrying.\n' "$JUMPLAB_SIMULATOR_UDID" >&2
  exit 2
fi
mkdir -p .cache/tmp
export TMPDIR="$PWD/.cache/tmp"
xcrun simctl install "$JUMPLAB_SIMULATOR_UDID" "$app"
xcrun simctl launch "$JUMPLAB_SIMULATOR_UDID" app.jumplab.ios
if [ -e "$result_bundle" ] || [ -L "$result_bundle" ]; then
  find "$result_bundle" -depth -delete
fi
xcodebuild test -workspace ios/JumpLab.xcworkspace -scheme JumpLab -destination "id=$JUMPLAB_SIMULATOR_UDID" -derivedDataPath .cache/DerivedData -resultBundlePath "$result_bundle" -only-testing:JumpLabUITests CODE_SIGNING_ALLOWED=NO
