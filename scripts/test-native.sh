#!/bin/sh
set -eu
mkdir -p .cache/swift .cache/tmp
export TMPDIR="$PWD/.cache/tmp"
swiftc -module-cache-path "$PWD/.cache/swift" modules/jump-analysis/ios/ContactDetector.swift tests/ContactDetectorTests.swift -o .cache/contact-tests
.cache/contact-tests
swiftc -module-cache-path "$PWD/.cache/swift" modules/jump-analysis/ios/ContactDetector.swift modules/jump-analysis/ios/VideoAnalyzer.swift tests/MediaTests.swift -o .cache/media-tests
.cache/media-tests
