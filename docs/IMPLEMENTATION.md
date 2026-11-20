# JumpLab implementation handoff

## Round 7, stage S2

I explicitly opened and read `claude.md/CLAUDE.md` before any other project work and then read the linked setup, backend, measurement, training, privacy and verification guides. Every later architect, engineer, reviewer and revision pass must explicitly open and read `claude.md/CLAUDE.md` first, then read the linked guide for each area being changed or reviewed. The companion `.claude/CLAUDE.md` imports that file.

Iteration 1 ran on 2026-11-20 MST from `ca701cf`, the approved S1 checkpoint. The published parent is `7382f40`. The host was arm64 macOS 15.7.3 (24G419), Xcode 26.3 (17C529), Node 24.21.0, npm 12.2.0, CocoaPods 1.17.0 and Swift 6.2.4. Full command output is in the ignored `.cache/round7-s2-*.log` files. Commands ran at the repository root unless shown otherwise. The simulator build used the repository-local DerivedData path allowed by the spec.

### Disk and command evidence

`df -h / "$PWD"` showed the same values before and after the build attempts. Neither attempt reported ENOSPC. Both stopped at workspace loading. The current Xcode and CoreSimulator errors and the measured storage headroom are separate conditions.

| Filesystem | Size | Used | Available | Capacity | Mount |
| --- | ---: | ---: | ---: | ---: | --- |
| `/dev/disk3s1s1` | 228 GiB | 19 GiB | 8.1 GiB | 71% | `/` |
| `/dev/disk3s5` | 228 GiB | 180 GiB | 8.1 GiB | 96% | `/System/Volumes/Data` |

| Command | Exit | Observed result |
| --- | ---: | --- |
| `sw_vers`, `uname -m`, `xcodebuild -version`, `node --version`, `npm --version`, `pod --version`, `swift --version` | 0 each | Reported the toolchain above. |
| `df -h / "$PWD"`, before and after the build attempts | 0 each | 8.1 GiB available on both paths. |
| `du -sh .cache ios/Pods node_modules`, before the checks | 0 | 650 MiB, 1.4 GiB and 855 MiB. |
| `COCOAPODS_DISABLE_STATS=true EXPO_NO_TELEMETRY=1 pod install --project-directory=ios --no-repo-update` | 0 | Installed 102 pods from 103 Podfile dependencies. The generated provider warned that the upstream internal `CoreModule` class cannot be referenced for automatic linking. |
| `cmp ios/Pods/Manifest.lock ios/Podfile.lock`, `shasum ios/Podfile`, checksum comparison and `git diff --exit-code 7382f40 -- ios/Podfile.lock package.json` | 0 each | Manifest and lock are byte-identical. The Podfile SHA-1 and lock's `PODFILE CHECKSUM` both equal `412c7a2cb4b1f83736c98325eb2a40bf1ee91a23`. No tracked native lock or manifest change was needed. |
| `cd ios && xcodebuild -workspace JumpLab.xcworkspace -scheme JumpLab -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath "$PWD/../.cache/DerivedData" CODE_SIGNING_ALLOWED=NO -quiet build` | 66 | First diagnostic `DVTFilePathFSEvents: Failed to start fs event stream.` First simulator failure `CoreSimulatorService connection became invalid. Simulator services will no longer be available.` Opening the CoreSimulator log returned `Operation not permitted`. Xcode ended with `xcodebuild: error: 'JumpLab.xcworkspace' is not a workspace file.` |
| `npm run build:ios:simulator` | 66 | CocoaPods completed. First Xcode diagnostic `DVTFilePathFSEvents: Failed to start fs event stream.` The same CoreSimulator connection and log failures followed. Xcode ended with `xcodebuild: error: 'ios/JumpLab.xcworkspace' is not a workspace file.` |
| `xmllint --noout ios/JumpLab.xcworkspace/contents.xcworkspacedata` and `plutil -lint ios/JumpLab.xcodeproj/project.pbxproj ios/Pods/Pods.xcodeproj/project.pbxproj` | 0 each | Workspace XML and both project files parse. |
| `xcodebuild -list -workspace "$PWD/ios/JumpLab.xcworkspace" -disableAutomaticPackageResolution` | 66 | Xcode rejected the absolute workspace path with the same workspace error. |
| `cd ios && xcodebuild -list -project JumpLab.xcodeproj -disableAutomaticPackageResolution` | 0 | Listed the JumpLab scheme and both targets. Also reported Xcode log-store permission errors. |
| `xcrun simctl list devices available` | 1 | CoreSimulator connection invalid, then `Unable to locate device set` with `NSPOSIXErrorDomain Code=61 "Connection refused"`. |
| `test -x .cache/DerivedData/Build/Products/Debug-iphonesimulator/JumpLab.app/JumpLab` | 1 | Linked simulator executable was absent. |
| `node scripts/check-secrets.mjs .cache/DerivedData/Build/Products/Debug-iphonesimulator/JumpLab.app` | not run | Requires a linked simulator app. |
| Simulator boot, `CI=1 npx expo start --dev-client --port 8081` and `JUMPLAB_SIMULATOR_UDID=<udid> sh scripts/smoke-ios.sh` | not run | Requires a linked app and a usable device set. No XCTest pass or skip counts or screenshot attachments were produced. |
| `npm run test:native` | 0 | 11 synthetic transition checks and 10 host timing, media and file checks passed. No failures or skips were reported. This covers synthetic inputs on macOS and includes no real athlete footage. |
| `npm run -s typecheck`, `npm run -s lint` and `npx --no-install expo config --type public --json > /dev/null` | 0 each | TypeScript, focused lint and Expo public config passed. |
| `npm run test:unit` and `npm run test:ui` | 0 each | 51 unit tests and 53 component/store tests across five suites. Both suites reported zero failures and skips. |
| `EXPO_NO_TELEMETRY=1 npx --no-install expo export --platform ios --output-dir .cache/round7-s2-ios-export` | 0 | Metro processed 719 modules and produced a Hermes bundle and metadata. |
| Same iOS export with `--dump-sourcemap --output-dir .cache/round7-s2-ios-mapped` and a read-only source-path check | 0 each | 714 mapped sources. No glob, minimatch, Zod or Forge modules. Of the audited Expo parent packages, the export contained only the CLI's Metro require bootstrap. |
| `npm run check:secrets` and `node scripts/check-secrets.mjs .cache/round7-s2-ios-export` | 0 each | Zero pattern findings across source and reachable patches. The second invocation also scanned two exported client assets. |
| `npm run check:dependencies` on a local copy of the `7382f40` manifests | 1 | Nine affected package nodes, six moderate and three high. |
| `npm run check:dependencies` and `npm audit --omit=dev --json` on the S2 checkout | 1 each | Eight affected package nodes, six moderate and two high. Forge cleared. Both audits got advisory data from npm. |
| Read-only Node integrity-entry count on `7382f40` and `HEAD`, `shasum -a 256 package-lock.json` and nested-install absence checks | 0 each | 53 missing integrity entries on each lock, all optional. Current SHA-256 is `ac5d69f120b3119a4d5bf0087ead778325140ad7f348f21622d9f666b8595315`. Neither nested install path exists. |
| `npm ci` | not run | S2 used the installed tree and verified the approved S1 lock. The clean install and byte-for-byte comparison are recorded in historical S1 evidence below. |
| `supabase --version`, `docker info` and `psql --version` | 127 each | All three commands are absent from PATH. |
| `npm run check:database-types`, `npm run test:integration` and `npm run test:security`, with `JUMPLAB_TEST_DISPOSABLE` unset | 2 each | Local guards stopped the commands. Zero generated-type comparisons, backend requests or permissions assertions. |
| `supabase start`, `supabase db reset`, `psql … -f supabase/tests/limits.sql` and live backend suites | not run | Requires Supabase CLI, a running container runtime and psql for an explicitly disposable loopback stack. No hosted project was contacted. |
| `npm run evaluate:video` | 2 | `UNVERIFIED: no annotated real clips.` Zero evaluated clips and zero accuracy observations. |
| `npm run check:docs`, `git diff --check` and `git diff --check 7382f40` | 0 each | Documentation paths and 38 IDs found. No whitespace errors. |
| Read-only comparison of current IDs and historical Round 6 content | 0 | All 38 current IDs occur in order. Round 6 and older evidence is byte-identical to the S2 base. |
| `git diff --stat 7382f40` and scoped `git diff --exit-code 7382f40 -- App.tsx src modules supabase tests scripts README.md package.json ios/Podfile.lock` | 0 each | The change since the published parent is confined to the handoff and the S1 transitive npm lock update. |

### Audit and lockfile reconciliation

The only package version difference from `7382f40` is `node-forge`, 1.4.0 → 1.4.3. S2 made no dependency changes. The audit reproduces the reduction from nine to eight affected package nodes, with three remaining root advisories and five dependent Expo packages. Missing integrity remains 53 → 53, all optional platform entries. S1's compatibility probes are preserved below. The fresh source map confirms the runtime JavaScript export scope, and a linked-app pattern scan remains outstanding.

| Residual advisory | Dependency path and shipping scope | Compatibility limit |
| --- | --- | --- |
| [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), high | `expo → @expo/cli@58.1.13 → zod@3.25.76`. Node CLI tooling. No Zod modules in the iOS export. | Fix starts at 4.6.6, outside the retained consumer's Zod 3 range. The SDK 58 CLI that removes Zod requires a newer native LogBox. The attempted SDK fallback also produced a Swift concurrency compiler error. |
| [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), moderate | `expo → @expo/{cli,config,config-plugins,metro-config,fingerprint} → glob@13.0.6`. Node build tooling. No glob modules in the iOS export. | Fix starts at 14.0.2, outside the 13.x ranges. S1's 13.0.7 probe retained the advisory. The tooling update that removed glob changed the native dependency tree. |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), moderate | `expo → @expo/fingerprint@0.21.5 → minimatch@10.2.6`, also reachable through audited glob paths. Node tooling. No minimatch modules in the iOS export. | Fix starts at 11.0.1. The retained fingerprint and the newer 0.21.10 examined in S1 both constrain minimatch to 10.x. |

### Current acceptance status

| ID | Status | Evidence and next verification |
| --- | --- | --- |
| JL-001 | Blocked (working Xcode workspace session → link the app) | CocoaPods and typecheck passed. The local build exited 66 before compiling. Clean installation evidence is preserved in S1. |
| JL-002 | Local pass | This pass kept the configured workflow and mapped all original IDs. The scoped changes exclude orchestration. |
| JL-003 | Blocked (consented annotated originals → trace production import and detector events) | The evaluation manifest supplied zero clips. |
| JL-004 | Local pass | The scope check shows handoff-only S2 changes and a transitive tooling update from S1. |
| JL-005 | Blocked (working simulator and disposable account → exercise picker and timing prefill) | Component tests exercised mocked import. No system-picker XCTest ran. |
| JL-006 | Local pass | Host timing tests covered CFR, VFR, mapped timing and ambiguous timelines. Production footage variants remain outstanding. |
| JL-007 | Blocked (consented annotated clips for all three jump types → verify tracking and repeated segmentation) | Synthetic native transitions passed. |
| JL-008 | Blocked (annotated unsuitable clips → exercise production rejection and retry) | Synthetic and component rejection checks passed. |
| JL-009 | Local pass | Unit tests checked the flight-time formula and boundaries. |
| JL-010 | Unverified | Unit tests checked uncertainty, summaries and compatible comparisons. Verify chart rendering and persisted backend round trips. |
| JL-011 | Blocked (annotated originals and fixture manifest → measure errors and coverage) | Fixture and matcher tests passed. The evaluator exited 2 with zero clips. |
| JL-012 | Unverified | Native host tests covered cancellation and media limits. Verify installed-app interruption, repeated use and outgoing traffic. |
| JL-013 | Unverified | Profile and conflict behavior have passing component/store coverage. Verify onboarding, persistent edits and plan replacement on iOS with local Auth. |
| JL-014 | Local pass | Unit tests verified deterministic and complete prescriptions. |
| JL-015 | Blocked (disposable loopback Supabase → verify plan parity and rollback) | Host planning scenarios passed. Live profile/plan verification requires the integration suite. |
| JL-016 | Local pass | Host progression, spacing, deload and final-day rollover checks passed. |
| JL-017 | Unverified | Host pain, fatigue and history guards passed. Verify persisted adaptation reasons against the applied schema. |
| JL-018 | Unverified | SQLite and logging tests passed. Exercise process termination during logging and result saving on iOS. |
| JL-019 | Unverified | Host pending-write and retry checks passed. Verify offline cold launch, analysis and reconnection on iOS. |
| JL-020 | Blocked (disposable loopback Supabase → exercise concurrent writes and account switching) | Host erase, retry and acknowledgment checks passed. Live idempotency and conflicts remain outstanding. |
| JL-021 | Unverified | Host-native file checks passed. Test provider interruption, cleanup and result reopening on iOS. |
| JL-022 | Blocked (Supabase CLI, container runtime and psql → apply migrations and compare generated types) | The type-generation guard exited 2. Zero schema comparisons. |
| JL-023 | Unverified | Redirect and mocked account tests passed. Verify signup, recovery, refresh and revoked tokens with iOS and local Auth. |
| JL-024 | Blocked (disposable loopback Supabase → run the anonymous and two-account permission matrix) | Zero live permissions assertions. |
| JL-025 | Blocked (disposable backend and linked simulator app → validate RPC boundaries and scan the app) | Pattern scans of source, history and two exported assets passed. |
| JL-026 | Blocked (disposable backend and hosted Auth configuration access → run quota suites and inspect hosted controls) | Zero SQL or live quota assertions. |
| JL-027 | Blocked (disposable backend and installed app → verify deletion, old tokens and restart) | Zero live deletion assertions. |
| JL-028 | Unverified | Focused lint and pattern scans passed. Seeded runtime logs, traffic and provider retention remain outstanding. |
| JL-029 | Blocked (linked app and working simulator → render navigation, history and charts) | Component tests passed. No rendered captures. |
| JL-030 | Blocked (working simulator and signed iPhone → render accessibility states and exercise assistive technology) | Component assertions passed. Smoke rendering and physical VoiceOver remain outstanding. |
| JL-031 | Unverified | Mocked fault and retry flows passed. Exercise failure and recovery in the installed app. |
| JL-032 | Unverified | Zero clip latency, memory or responsiveness measurements. |
| JL-033 | Blocked (disposable loopback Supabase → run the existing live suites) | 51 unit, 53 UI and 21 synthetic native checks passed. Zero live client assertions. |
| JL-034 | Blocked (Xcode workspace and CoreSimulator access with sufficient disk headroom → rerun build and launch smoke) | Both simulator build commands exited 66 with `is not a workspace file`. CoreSimulator refused connections. No linked app or launch result. |
| JL-035 | Failed | Docs and export/source scans passed. The advisory check exited 1 with the documented tooling residuals, and the linked-client scan remains outstanding. |
| JL-036 | Blocked (Apple signing team, provisioned iPhone in Developer Mode, consented clips and Instruments for the device protocol → install and verify physical flows) | Record model, iOS, build, picker, offline, interruption, persistence and accessibility outcomes. |
| JL-037 | Blocked (Apple signing team, provisioned iPhone in Developer Mode, consented clips and Instruments → measure repeated physical runs) | Zero device latency, peak memory, responsiveness or thermal observations. |
| JL-038 | Local pass | The handoff maps every ID to current evidence or an outstanding prerequisite. Independent verification is pending. |

### External prerequisites

- Clear enough host storage to reach about 15 GB or more available, then check `df -h /` and `df -h "$PWD"` again before a full build. Current available space is 8.1 GiB. This pass performed no external cleanup.
- Use an Xcode session that can open `JumpLab.xcworkspace` and where `xcrun simctl list devices available` succeeds. Rerun the build gate and scan the linked app. Boot an available iPhone simulator, start Metro, run the README smoke command, record XCTest passes, skips and attachment names from `.cache/LaunchSmoke.xcresult`, then stop Metro and shut down the simulator.
- Install Supabase CLI, Docker or a compatible container runtime with a working Docker CLI, and psql. Follow [Backend](BACKEND.md) to start and reset an explicitly disposable loopback instance. Run the SQL limits check, compare generated types and run both real-client suites against that instance.
- Obtain authorized read access to hosted Supabase Auth configuration in a separate verification pass to inspect signup and recovery limits, redirects, SMTP and provider retention.
- Supply an Apple signing team and a provisioned iPhone with Developer Mode. Install the bundled Release build following [README](../README.md), record the device workflow outcomes and use Instruments to measure latency and peak memory over repeated runs.
- Place consented original clips in `fixtures/media/` and annotations in `fixtures/manifest.json`. Include all three jump types, multiple events in a repeated clip, timing variants and expected rejections. Run `npm run evaluate:video` and record coverage and error results.

## Historical verification

### Round 7, stage S1

I explicitly opened and read `claude.md/CLAUDE.md` before any other project work. Every later architect, engineer, reviewer and revision pass must explicitly open and read that file first, then read the linked guide for each area under work or review. Its companion `.claude/CLAUDE.md` imports it.

Iteration 2 ran on 2026-11-20 MST from `ca28d3e`. The published parent for the round is `7382f40`. The Mac runs arm64 macOS 15.7.3 (24G419), Xcode 26.3 (17C529), Swift 6.2.4, Node 24.21.0, npm 12.2.0 and CocoaPods 1.17.0. Output is in the repository's ignored `.cache/round7-s1-iter2-*` logs and JSON audit reports. Commands ran at the repository root unless shown otherwise.

The iteration 1 orchestrator reached compilation. Its first compiler error was `expo-modules-jsi/apple/Sources/ExpoModulesJSI/Runtime/Values/JavaScriptObject.swift:946:36: error: sending 'slot' risks causing data races`. This is the dependency regression that rejected the Expo 58.0.26 fallback. The initial orchestrator ENOSPC report came from a separate build. The local workspace and CoreSimulator failures below came from this engineer session. The focused compiler comparison reproduced the orchestrator error on 58.0.23 and compiled 58.0.16 successfully without patching either package or relaxing concurrency checks. The selected lock restores the Expo 58.0.16 native tree and updates node-forge. A complete simulator link still needs confirmation.

| Command | Exit | Observed result |
| --- | ---: | --- |
| `sw_vers`, `uname -m`, `xcodebuild -version`, `node --version`, `npm --version`, `pod --version`, `swift --version` | 0 each | Reported the toolchain above. |
| `df -h /`, `df -h "$PWD"`, before work and after the first clean install | 0 each | Initially both showed 9.8 GiB available. The follow-up showed 9.9 GiB. Root capacity was 66% and workspace Data volume capacity 95% in both readings. This run recorded no ENOSPC. |
| `du -sh .cache ios/Pods node_modules`, before work | 0 | 396 MiB, 1.4 GiB and 818 MiB, respectively. |
| `npm run check:dependencies` on iteration 1's Expo 58.0.26 tree | 1 | Three moderate package findings from one minimatch advisory. |
| `npm audit --omit=dev --json` on a local copy of the `7382f40` manifests | 1 | Nine affected packages, six moderate and three high. |
| `npm view` on Expo 58 patches, their CLI/Core dependency ranges, and available glob, Zod and minimatch versions | 0 each | Confirmed the compatible Forge range and the constraints described below. |
| `npm pack expo-modules-jsi@58.0.<patch>` for 16, 17, 19, 20, 21, 22 and 23, then inspect `JavaScriptObject.swift` | 0 for each pack | The error site is present in 21, 22 and 23. Versions 16, 17, 19 and 20 lack that code. |
| `python3 .cache/round7-s1-iter2-jsi-compile.py 23` and `python3 .cache/round7-s1-iter2-jsi-compile.py 16` | 1 and 0 | Compiled each registry tarball's complete Swift target with `xcrun swiftc -c`, Swift 6, package concurrency features, C++ interop, installed React Native/CocoaPods headers and the iOS simulator SDK. Version 23 reproduced the exact diagnostic. Version 16 emitted an arm64 simulator object. This compares compilation of the dependency. |
| `npm update node-forge glob minimatch @expo/fingerprint --package-lock-only --cache ../npm --fetch-retries=0` in a baseline probe, then `npm audit --omit=dev --json` | 0 and 1 | Forge was patched. The additional changes left glob, minimatch and Zod vulnerable and added an affected Expo node to the audit, so the probe was discarded. |
| `npm update node-forge --package-lock-only --cache ../npm --fetch-retries=0` in a separate baseline copy, then deep equality and scope checks | 0 each | npm generated the version, tarball URL and integrity for node-forge. Retained the parent lock's key ordering and confirmed deep equality with npm's full output. `git diff --exit-code 7382f40 -- package.json` passed. |
| Read-only `node -e` count of lock entries with `resolved` and no `integrity` | 0 | Published parent 53, iteration 1 entry 32, selected tree before and after install 53. All are optional platform entries. npm's generated lock still lacks integrity for those entries. |
| Remove generated root `node_modules`, `test ! -e node_modules`, then `npm ci --fetch-retries=0 --cache .cache/npm` | 0 each | Clean install added 1,019 packages. npm blocked two optional install scripts, `@parcel/watcher` and `unrs-resolver`. The install audit includes dev dependencies and reported 26 findings. |
| `git diff --no-index --exit-code .cache/round7-s1-iter2-final/ordered-lock.json package-lock.json`, `shasum -a 256 package-lock.json`, and absence checks for `modules/jump-analysis/{node_modules,package-lock.json}` | 0 each | The dependency lock stayed byte-identical to its pre-install snapshot. Before and after SHA-256 was `ac5d69f120b3119a4d5bf0087ead778325140ad7f348f21622d9f666b8595315`. Both nested paths remained absent. |
| `npm run check:dependencies` on the selected tree and `npm ls glob minimatch zod node-forge --omit=dev --all` | 1 and 0 | Eight affected package nodes from three residual tooling advisories detailed below. Node-forge is absent from the findings. |
| `npm run -s typecheck`, `npm run -s lint` | 0 each | TypeScript and focused source checks passed. |
| `npm run test:unit`, `npm run test:ui` | 0 each | Unit 51 passed. UI 53 passed across five suites. Both recorded zero failures and zero skips. |
| `npx --no-install expo config --type public --json > /dev/null` | 0 | Resolved the public Expo configuration. |
| `EXPO_NO_TELEMETRY=1 npx --no-install expo export --platform ios --output-dir .cache/round7-ios-export` | 0 | Metro processed 719 modules and exported the Hermes bundle and metadata. |
| Expo iOS export with `--dump-sourcemap` and a read-only source path check | 0 each | 714 mapped sources. No glob, minimatch, Zod or Forge source modules. Of the audited Expo parent packages, the export includes only the CLI's Metro require bootstrap. |
| `node scripts/check-secrets.mjs .cache/round7-ios-export`, `npm run check:secrets` | 0 each | Zero pattern findings. The first invocation covered source, reachable Git patches and two exported assets. The default invocation covered source and history. |
| `COCOAPODS_DISABLE_STATS=true EXPO_NO_TELEMETRY=1 pod install --project-directory=ios --no-repo-update`, with `CP_HOME_DIR="$PWD/.cache/cocoapods-home"` and `COCOAPODS_SKIP_CACHE=1` | 0 | Installed 102 pods from 103 dependencies after restoring the baseline. ExpoModulesCore resolved to 58.0.23 and ExpoModulesJSI to 58.0.16. |
| `cmp ios/Pods/Manifest.lock ios/Podfile.lock`, `git diff --exit-code 7382f40 -- ios/Podfile.lock`, `shasum ios/Podfile` and lock checksum comparison | 0 each | The installed manifest and tracked lock are byte-identical. The tracked lock stays at the published parent's version. Podfile SHA-1 matches `PODFILE CHECKSUM` at `412c7a2cb4b1f83736c98325eb2a40bf1ee91a23`. |
| `cd ios && xcodebuild -workspace JumpLab.xcworkspace -scheme JumpLab -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath "$PWD/../.cache/DerivedData" CODE_SIGNING_ALLOWED=NO -quiet build` | 66 | Local first service failure was `CoreSimulatorService connection became invalid`, followed by `Operation not permitted` opening its log. Xcode stopped with `'JumpLab.xcworkspace' is not a workspace file` before compilation. |
| `npm run build:ios:simulator` with the same local CocoaPods settings | 66 | CocoaPods succeeded again. Xcode reported the CoreSimulator connection failure and exited at workspace loading. |
| `xmllint --noout ios/JumpLab.xcworkspace/contents.xcworkspacedata`, `plutil -lint ios/JumpLab.xcodeproj/project.pbxproj ios/Pods/Pods.xcodeproj/project.pbxproj` | 0 each | The workspace XML and both project files passed syntax checks. |
| `xcrun simctl list devices available` | 1 | Failed to locate the device set with `NSPOSIXErrorDomain Code=61 "Connection refused"`. |
| `npm run test:native` | 0 | 11 synthetic Swift transition checks and 10 host timing, media and file checks passed. No athlete footage. |
| `supabase --version`, `docker info`, `psql --version` | 127 each | All three commands were absent. |
| `npm run check:database-types`, `npm run test:integration`, `npm run test:security` with `JUMPLAB_TEST_DISPOSABLE` unset | 2 each | Disposable-environment guards stopped all three commands. Zero live assertions and zero type comparisons. |
| `npm run evaluate:video` | 2 | Zero annotated clips. No accuracy observations. |
| `npm run check:docs`, `git diff --check`, `git diff --check 7382f40` | 0 each | Documented paths, commands and 38 IDs found. No whitespace errors. |
| Linked `JumpLab.app` pattern scan, Metro launch smoke and screenshot review | not run | Local Xcode did not link the app and the simulator device set was unavailable. No XCTest pass or skip counts or screenshot attachments. |
| Disposable stack start and reset, `supabase/tests/limits.sql`, live generated types and live backend assertions | not run | Supabase CLI, Docker and psql are absent. No non-loopback project was contacted. |

All nine S1 JS, export and repository regressions passed. The unit and UI suites ran 104 tests with zero failures or skips. The dependency-only compiler comparison independently tests the native regression. It does not substitute for the app build gate.

### Audit and lockfile reconciliation

Relative to `7382f40`, the only changed package is `node-forge`, 1.4.0 → 1.4.3. The parent manifest and native dependency versions were restored from the rejected iteration 1 fallback. The direct Expo pin moved back from 58.0.26 to 58.0.16, ExpoModulesCore from 58.1.0 to 58.0.23, and ExpoModulesJSI from 58.0.23 to 58.0.16. CocoaPods refreshed the generated project and manifest. The tracked Pods lock already describes the restored tree.

The production audit moved from nine to eight affected packages relative to the published parent. The selected tree has six moderate and two high package findings. The earlier full audit-fix and broad targeted-update candidates on the 58.0.16 manifest changed native Expo packages, including Font, Constants and LogBox. The newest available fallback patches, Expo 58.0.24 through 58.0.26, require ExpoModulesCore 58.1.0 and resolve ExpoModulesJSI 58.0.23 with the reproduced compile error. The remaining advisories have no fix in the retained consumers' dependency ranges that preserves the permitted native tree. The fresh export's source map establishes the JS scope below. The linked binary scan remains outstanding.

| Residual advisory | Production dependency path and scope | Compatibility limit |
| --- | --- | --- |
| [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), high | `expo → @expo/cli@58.1.13 → zod@3.25.76`. Node CLI tooling. Zod is absent from the iOS export. | CLI requires `^3.25.76`, while the advisory fix starts at 4.6.6. The first SDK 58 CLI release without Zod, 58.1.18, requires native LogBox `^58.0.14` versus the published tree's 58.0.12. The newer fallback that removed Zod fails the native compile. |
| [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4), moderate | `expo → @expo/{cli,config,config-plugins,metro-config,fingerprint} → glob@13.0.6`. Node build tooling. Glob is absent from the iOS export. | Patched glob starts at 14.0.2, outside the consumers' 13.x ranges. The targeted 13.0.7 update still reports this advisory. Moving to the tooling release that removes glob changed native dependencies and the newest SDK fallback failed compilation. |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), moderate | `expo → @expo/fingerprint@0.21.5 → minimatch@10.2.6`, plus the audited glob paths to the same version. Node tooling. Minimatch is absent from the iOS export. | Patched minimatch starts at 11.0.1. Fingerprint 0.21.5 and the latest 0.21.10 use 10.x constraints. npm's forced downgrade is outside SDK 58. |

### Current acceptance status

| ID | Status | Evidence and next verification |
| --- | --- | --- |
| JL-001 | Blocked (working Xcode workspace session → link the restored native tree) | Clean install, typecheck and focused JSI compilation passed. The local gate exited 66 before the app compiled. The iteration 1 orchestrator's Swift error was reproduced and removed in the focused dependency comparison. |
| JL-002 | Local pass | S1 stayed within the configured workflow. All original IDs and their outstanding verification steps are carried forward here. |
| JL-003 | Blocked (consented annotated originals → trace production picker and detector events) | No production athlete-clip observation in S1. |
| JL-004 | Local pass | The change restores the published native tree and patches one transitive Node tooling dependency. No app behavior changed. |
| JL-005 | Blocked (working simulator and disposable account → run system picker coverage) | Component tests passed with mocked import. Native picker and FPS prefill remain to be exercised. |
| JL-006 | Local pass | Host timing tests passed for CFR, VFR, mapped timing and ambiguous timelines. Production timing variants still need footage. |
| JL-007 | Blocked (annotated clips for all three types → verify tracking and repeated segmentation) | Synthetic native transitions passed. No real segmentation data was collected. |
| JL-008 | Blocked (annotated unsuitable clips → exercise production rejection and retry) | Host and component tests cover rejection and retry logic. Real rejection outcomes remain unobserved. |
| JL-009 | Local pass | Unit tests verified the height calculation and boundaries. Component tests passed. |
| JL-010 | Unverified | Unit tests passed for uncertainty, summaries and compatible comparisons. Verify rendered charts and a backend round trip. |
| JL-011 | Blocked (annotated fixtures → run production evaluator and report errors) | Fixture and matcher tests passed. The production evaluator exited 2 with zero annotated clips. |
| JL-012 | Unverified | Host-native cancellation and resource limit checks passed. Capture installed-app interruption, repeated use and outgoing traffic. |
| JL-013 | Unverified | Profile and conflict behavior have component and SQLite coverage. Verify onboarding and persistent edits on iOS with local Auth. |
| JL-014 | Local pass | Host deterministic program and complete prescription tests passed. |
| JL-015 | Blocked (disposable loopback Supabase → verify parity and rollback) | Host planning scenarios passed. Live profile/plan behavior remains unverified. |
| JL-016 | Local pass | Host progression, spacing, deload and final-day rollover tests passed. |
| JL-017 | Unverified | Host pain, fatigue and history guards passed. Verify saved adaptation reason and rule version on an applied backend. |
| JL-018 | Unverified | Host SQLite reopen and logging tests passed. Verify process termination during workout logging and result saving in the installed app. |
| JL-019 | Unverified | Host pending-write and retry tests passed. Verify offline cold launch, analysis and reconnection in the installed app. |
| JL-020 | Blocked (disposable loopback Supabase → exercise concurrent writes and account switching) | Host erase, retry and acknowledgement tests passed. Live idempotency and conflict behavior remain unverified. |
| JL-021 | Unverified | Host-native file tests passed. Exercise provider interruption and result reopening on iOS. |
| JL-022 | Blocked (Supabase CLI, container runtime and psql → apply migrations and compare generated types) | No applied schema or generated-type comparison in S1. |
| JL-023 | Unverified | Host redirect and mocked account tests passed. Verify signup, recovery, refresh and revoked tokens with iOS and local Auth. |
| JL-024 | Blocked (disposable loopback Supabase → run anonymous and two-account permissions matrix) | Zero live permissions assertions in S1. |
| JL-025 | Blocked (disposable backend and linked simulator app → validate RPC boundaries and scan the app) | Fresh export and source/history pattern scan passed. |
| JL-026 | Blocked (disposable backend and hosted Auth configuration access → run quota suites and inspect hosted controls) | No SQL or live client quota assertions in S1. |
| JL-027 | Blocked (disposable backend and installed app → verify deletion, old tokens and restart) | No live deletion assertions in S1. |
| JL-028 | Unverified | Focused lint and pattern scan passed. Seeded runtime logs, traffic and actual provider retention remain unverified. |
| JL-029 | Blocked (linked simulator app → render navigation, history and charts) | UI component tests passed. No rendered captures in S1. |
| JL-030 | Blocked (working simulator and signed iPhone → render accessibility states and test assistive technology) | Component assertions passed. Smoke rendering and device VoiceOver are outstanding. |
| JL-031 | Unverified | Mocked UI error, retry and recovery tests passed. Verify failures and recovery on installed iOS. |
| JL-032 | Unverified | No latency, memory or responsiveness measurements in S1. |
| JL-033 | Blocked (disposable loopback Supabase → run live integration and security suites) | 51 unit, 53 UI and 21 synthetic native checks passed. Live client assertions remain outstanding. |
| JL-034 | Blocked (working Xcode workspace and simulator session → rerun the build gate and launch smoke) | Clean dependencies and CocoaPods passed. Iteration 1 failed with the JSI Swift data-race diagnostic. The restored JSI target compiled independently. The current local gate exited 66 with `'JumpLab.xcworkspace' is not a workspace file` and `simctl` exited 1 with connection refused. No link or launch was verified. |
| JL-035 | Failed | Clean install, docs and the fresh export scan passed. The audit exited 1 with three documented tooling advisories and no linked app was available for the binary scan. |
| JL-036 | Blocked (Apple signing team, provisioned iPhone with Developer Mode and consented clips → install and verify device flows) | Record device, OS, build and actual picker, offline, interruption, persistence and accessibility outcomes. |
| JL-037 | Blocked (Apple signing team, provisioned iPhone with Developer Mode, consented clips and Instruments → collect repeated device performance traces) | No device latency, peak memory or thermal observations. |
| JL-038 | Local pass | The report maps all 38 IDs to observed evidence or an outstanding verification step. Independent review is pending. |

### External prerequisites

- Both filesystems showed 9.9 GiB free after the first clean install. Bring available host storage to about 15 GB or more before a full build, and measure it again with `df -h /` and `df -h "$PWD"`. This is build headroom, separate from the observed Swift regression and the local workspace failure.
- Rerun the required gate for the restored dependency tree in the orchestrator's Xcode session, which reached compilation on iteration 1. For launch smoke, use a session where `xcrun simctl list devices available` succeeds, boot an iPhone simulator, start Metro and run the README smoke command. Record XCTest pass and skip counts and screenshot names.
- Install Supabase CLI, a compatible container runtime and `psql`. Follow [Backend](BACKEND.md) to start and reset an explicitly disposable loopback stack, run the SQL limits check, compare generated types and execute both real-client suites.
- Obtain authorized read access to hosted Supabase Auth configuration for a separate verification of signup and recovery limits, redirects, SMTP and provider retention.
- Provide an Apple development signing team and an iPhone provisioned with Developer Mode. Install the bundled Release build, record the manual workflows and capture repeated analysis latency and peak memory with Instruments.
- Put consented originals in `fixtures/media/` and matching annotations in `fixtures/manifest.json`. Include the three jump types, multiple events in a repeated clip, timing variants and expected rejections. Run `npm run evaluate:video` and record coverage and reference errors.


### Round 6, stage S1

I explicitly opened and read `claude.md/CLAUDE.md` before any other project work. For every subsequent engineer, reviewer and revision pass, explicitly open and read that file first, then read the linked guide for the area under review and this handoff.

Iteration 2 ran from `cd76c1f` on November 19, 2026 (MST). The arm64 Mac ran macOS 15.7.3 (24G419), Xcode 26.3 (17C529), Swift 6.2.4, CocoaPods 1.17.0, Ruby 4.0.9, Node v24.21.0 and npm 12.2.0. Commands ran from the repository root unless shown otherwise.

| Command | Exit | Observed result |
| --- | ---: | --- |
| `sw_vers`, `xcodebuild -version`, `node --version`, `npm --version`, `pod --version`, `swift --version`, `ruby --version` | 0 each | Reported the versions above. |
| `cmake --version` | 127 | CMake absent. CocoaPods used prebuilts. |
| `test ! -e modules/jump-analysis/node_modules && test ! -e modules/jump-analysis/package-lock.json` | 0 | Both paths were absent at entry and stayed absent after the root install, Expo config/export and CocoaPods. |
| `npm ci --cache .cache/npm --fetch-retries=0` | 0 | Added 1,019 packages and audited 1,020. npm blocked the optional `@parcel/watcher` and `unrs-resolver` install scripts. Including development dependencies, the install audit reported 24 moderate and three high vulnerabilities. No offline retry was needed. |
| `git diff --exit-code c4f9deb -- package-lock.json` | 0 | The root npm lockfile is unchanged from the baseline. |
| `npm run build:ios:simulator` | 66 | CocoaPods completed with 102 pods from 103 Podfile dependencies. Xcode then reported `'ios/JumpLab.xcworkspace' is not a workspace file.` CoreSimulator refused the connection. |
| `COCOAPODS_SKIP_CACHE=1 CP_HOME_DIR="$PWD/.cache/cocoapods-home" COCOAPODS_SKIP_SEARCH=1 npm run build:ios:simulator` | 66 | Same result with a repository-local CocoaPods home. No trunk shard failure or source fallback was observed in iteration 2. |
| `COCOAPODS_DISABLE_STATS=true EXPO_NO_TELEMETRY=1 pod install --project-directory=ios --no-repo-update` | 0 | Standalone CocoaPods setup completed. |
| `xmllint --noout ios/JumpLab.xcworkspace/contents.xcworkspacedata`, `test -f ios/Pods/Pods.xcodeproj/project.pbxproj`, `cmp ios/Pods/Manifest.lock ios/Podfile.lock`, `shasum ios/Podfile` | 0 each | Workspace descriptor parses, Pods project exists and installed manifest matches the tracked lock. The computed and recorded Podfile checksum is `412c7a2cb4b1f83736c98325eb2a40bf1ee91a23`. |
| In `ios/`, `xcodebuild -workspace JumpLab.xcworkspace -scheme JumpLab -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath "$PWD/../.cache/DerivedData" CODE_SIGNING_ALLOWED=NO -quiet build` | 66 | Gate failed at `'JumpLab.xcworkspace' is not a workspace file.` Used a writable repository-local DerivedData path. |
| `xcodebuild -list -workspace "$PWD/ios/JumpLab.xcworkspace" -disableAutomaticPackageResolution` and the same listing against a minimal workspace created under `.cache/` | 66 each | Xcode rejected both workspace paths. |
| In `ios/`, `xcodebuild -list -project JumpLab.xcodeproj -disableAutomaticPackageResolution` | 0 | Listed the JumpLab scheme in the standalone project. |
| `xcrun simctl list devices available` | 1 | Reproduced before and after the build. CoreSimulatorService connection invalid, POSIX code 61 `Connection refused`. |
| `sh -n scripts/smoke-ios.sh` | 0 | POSIX shell syntax passed. |
| `JUMPLAB_SIMULATOR_UDID=round6-preflight sh scripts/smoke-ios.sh` | 2 | Missing executable preflight named the build command. No boot, Metro or simulator XCTest ran. No test counts or screenshot attachments exist. |
| `node --test tests/smoke-ios.test.ts` | 1 before fix, 0 after | The new test reproduced a directory being accepted as the app executable. All four smoke-script tests passed after the regular-file check. |
| `npm run -s typecheck`, `npm run -s lint`, `npx --no-install expo config --type public --json > /dev/null` | 0 each | TypeScript and Expo config resolved. Focused lint found zero failures. Expo telemetry was disabled. |
| `npm run test:unit` | 0 | 51 passed, zero skipped. |
| `npm run test:ui` | 0 | 53 passed across five suites, zero skipped. Component and store suites use mocks where applicable. |
| `npm run test:native` | 0 | 11 synthetic transition checks and 10 macOS media, timing and receipt checks passed. No athlete clip was analyzed. |
| `npm run check:docs`, `git diff --check` | 0 each | Documented commands, paths and all 38 IDs present. No whitespace errors. |
| `npm run evaluate:video` | 2 | Zero annotated clips or accuracy observations. |
| `npm_config_cache="$PWD/.cache/npm" npm_config_fetch_retries=0 npm run check:dependencies` | 1 | The advisory service reported nine production dependency vulnerabilities, six moderate and three high. |
| `EXPO_NO_TELEMETRY=1 npx --no-install expo export --platform ios --output-dir .cache/ios-export` | 0 | Exported a 719-module Hermes iOS bundle and its metadata. |
| `npm run check:secrets` | 0 | Zero pattern matches in source, reachable Git patches and two fresh iOS export assets. Debug simulator builds use Metro and contain no `main.jsbundle`. The export supplies the JavaScript evidence. A linked simulator app and runtime traffic or logs were unavailable for inspection. |
| `supabase --version`, `docker info`, `psql --version` | 127 each | CLI, container runtime command and SQL client absent from PATH. Stack startup, migration reset and `supabase/tests/limits.sql` were not run. |
| `env -u JUMPLAB_TEST_DISPOSABLE npm run test:integration`, `env -u JUMPLAB_TEST_DISPOSABLE npm run test:security` | 2 each | The disposable-environment guard stopped both before any network requests. Zero live assertions. |
| `JUMPLAB_TEST_DISPOSABLE=YES npm run check:database-types` | 2 | The missing CLI guard stopped before a connection or type generation. Schema drift remains unknown. |
| `curl -fILsS --max-time 8 <official documentation URL> -o /dev/null` | 0 each | The Expo development-build, Supabase Auth rate-limit and Apple accessibility URLs in the README responded. |

Iteration 1 removed the ignored nested install and module lockfile. No project command exercised in either iteration recreated them. The artifacts appear to come from workspace setup or a prior install inside the module. Their exact origin was unobserved. The build guard still exits 3 if it finds a nested module install.

The tracked CocoaPods lock was retained from the successful iteration 1 install, including its generated ExpoModulesCore spec checksum. A session that can open the workspace and reach CoreSimulator is still needed. The workspace listing failure reproduced on a minimal workspace, so the current results do not isolate the workspace-loading cause. Retry the gate in that session, boot an available iPhone simulator, start `CI=1 npx expo start --dev-client --port 8081`, and run `JUMPLAB_SIMULATOR_UDID=<udid> sh scripts/smoke-ios.sh`. Record XCTest pass/skip counts and screenshot attachments from `.cache/LaunchSmoke.xcresult`, then stop Metro. The picker test needs a disposable local account. Any simulator results establish build and launch coverage only.

The audit reports high-severity advisories for `node-forge` and `zod` and moderate advisories for `glob` and `minimatch`, with affected transitive Expo packages included in npm's total. Review Expo-compatible updates and the 53 optional lock entries missing integrity metadata, then repeat the install, audit, native build and export. No dependency versions changed during this stage.

#### Current acceptance status

| ID | Status | Evidence and next verification |
| --- | --- | --- |
| JL-001 | Blocked (working CoreSimulator session → rerun simulator link) | Clean root install, typecheck and CocoaPods installation succeeded. Native link is outstanding. |
| JL-002 | Local pass | Stage handoff carries all 38 IDs and records independent review and external verification as pending. Project-only changes. |
| JL-003 | Blocked (consented original clips → trace a real production run) | The documented picker, native analyzer and estimator path has no observed real-clip result. |
| JL-004 | Local pass | Scoped app, local Vision/AVFoundation and existing Supabase metadata paths. No added packages or services in this stage. |
| JL-005 | Blocked (working CoreSimulator and disposable test account → run picker XCTest) | Component tests cover guidance, import and cancellation with mocks. Native picker and actual FPS prefill remain unobserved. |
| JL-006 | Local pass | Unit timing and native edit/retiming checks passed. Retimed production inputs with unresolved capture timelines remain unsupported. |
| JL-007 | Blocked (annotated clips for three jump types → evaluate production tracking and segmentation) | Synthetic standing, running, repeated, noise and track loss checks passed. |
| JL-008 | Blocked (annotated unsuitable footage → run production rejection and retry) | Host checks cover ambiguous athletes, hidden feet, noise, camera displacement and missing transition evidence. |
| JL-009 | Local pass | Host tests verify flight-time height, units and bounds. Analyze explains center-of-mass and posture limits. |
| JL-010 | Unverified | Host tests cover summaries, timing provenance and compatible chart series. Verify rendered charts and a backend round trip. |
| JL-011 | Blocked (annotated fixture media → run the production evaluator) | Empty manifest exited 2. The host regression rejects rejection-only coverage and requires multiple matched repeated events. |
| JL-012 | Unverified | Incremental native decode and bounded media paths exercised by host failure checks. Verify interruption, repetition and outgoing traffic on an installed app. |
| JL-013 | Unverified | Profile, optional inputs and paired edit behavior have component and host SQLite coverage. Verify profile persistence and edit effects on iOS with two local test sessions. |
| JL-014 | Local pass | Versioned deterministic generation and complete prescription unit tests passed. |
| JL-015 | Blocked (disposable loopback Supabase → run plan parity and rollback checks) | Scheduling, equipment, impact and budget scenarios passed locally. Live RPC assertions did not run. |
| JL-016 | Local pass | Host adaptation, recovery spacing, conservative progression and final-day rollover checks passed. Experimental jump estimates stay out of training signals. |
| JL-017 | Unverified | Host tests cover pain and fatigue guards, history preservation and reproducibility. Verify persisted rule version and change reason on an applied backend. |
| JL-018 | Unverified | Host SQLite restart and prescribed-set tests passed. Installed-app termination during workout logging and result saving remains untested. |
| JL-019 | Unverified | Host tests cover durable pending writes, plan dependencies and retry recovery. Verify offline cold launch, native analysis and reconnection on iOS. |
| JL-020 | Blocked (disposable loopback Supabase → run concurrent client writes and account-switch checks) | Host tests cover account scoping, interrupted erasure and SQLite acknowledgement. Live idempotency and conflicts remain unverified. |
| JL-021 | Unverified | Host media checks cover missing copies and corrupt receipts. Verify picker provider interruptions, cleanup and reopening on iOS. |
| JL-022 | Blocked (Supabase CLI and container runtime → apply migrations and compare generated types) | Four tracked migrations and provisional types. No applied-schema evidence or type-drift comparison. |
| JL-023 | Unverified | PKCE, secure storage and mocked lifecycle paths exist. Verify signup, confirmation, recovery, foreground refresh and revoked tokens with local Auth and iOS. |
| JL-024 | Blocked (disposable loopback Supabase → run anonymous and two-account permission matrix) | RLS, live-account checks, grants and scoped profile identity are in source. No live permission assertions ran. |
| JL-025 | Blocked (disposable backend and linked simulator app → run boundary checks and scan linked assets) | Limited export and source/history scan found zero matches. Workout timestamp and canonical profile protections have existing RPC regressions pending execution. |
| JL-026 | Blocked (disposable backend and hosted Auth access → run quota checks and inspect hosted controls) | SQL and client quota cases were not executed. Local declarations are available for review. |
| JL-027 | Blocked (disposable loopback Supabase and installed app → verify deletion and restart) | Existing tests cover old tokens and residual rows once run against a live stack. Installed app cleanup is unverified. |
| JL-028 | Unverified | Pattern scan and focused source lint passed. Seeded runtime logs, outgoing traffic and actual provider retention await verification. |
| JL-029 | Blocked (linked simulator app → render navigation, history and progress) | Component checks passed. No screenshot captures from this run. |
| JL-030 | Blocked (working simulator and signed iPhone → run accessibility layout and assistive-technology checks) | Component semantics and targets passed. No large-text/dark rendering, physical VoiceOver or focus observations. |
| JL-031 | Unverified | Mocked UI tests cover analysis failure and retry, navigation, offline queue and interrupted erasure. Confirm on installed iOS. |
| JL-032 | Unverified | Production signposts and evaluator instrumentation exist. Zero simulator or device latency, peak-memory or responsiveness measurements. |
| JL-033 | Blocked (disposable loopback Supabase → run live validation suites) | 51 unit tests, 53 component tests and 21 native host checks passed. Zero live backend assertions. |
| JL-034 | Blocked (working CoreSimulator session → build, launch and repeat XCTest smoke) | Clean install succeeded and CocoaPods generated the matching manifest. Xcode failed with exit 66. |
| JL-035 | Failed | Docs and export scan passed. The advisory gate returned exit 1 with nine vulnerabilities. Review compatible upstream updates and repeat the checks. |
| JL-036 | Blocked (Apple signing team, provisioned iPhone and consented clips → install and record on-device flows) | Zero physical-device observations. Record device/OS/build, clip details and picker, offline, interruption, workout and accessibility outcomes. |
| JL-037 | Blocked (signed iPhone build, consented clips and Instruments → measure repeated device analysis runs) | Zero physical latency, peak memory or thermal observations. Use the protocol in Measurement. |
| JL-038 | Local pass | This handoff records current command outcomes, test boundaries and prerequisites by criterion. Independent review is pending. |

#### External prerequisites

- Add consented annotated originals for standing, running and repeated jumps, timing variants and rejection cases to `fixtures/media/` and `fixtures/manifest.json`. Run the evaluator and record sample counts, errors and missing coverage.
- Provide an Apple development team or signing identity and a provisioned iPhone with Developer Mode. Install the bundled Release build and collect the JL-036 and JL-037 records.
- Use an Xcode session with working CoreSimulator and sufficient writable disk space for DerivedData. Keep npm, the CocoaPods CDN and React Native's Maven endpoint reachable. GitHub and CMake are required if Hermes falls back to a source build.
- Provide the Supabase CLI, compatible container runtime and `psql`. Follow [backend setup](BACKEND.md) to start and reset a disposable loopback stack, apply migrations, run the SQL limits check, review generated types and execute both backend suites.
- Obtain access to inspect hosted Supabase Auth limits, redirects and retention separately. Use live official Expo, Apple and Supabase documentation for final platform and configuration review. Public documentation access was available in this round.

### Round 6, stage S1, iteration 1 command evidence

Verified from `c4f9deb` on November 19, 2026 (MST). The arm64 Mac ran macOS 15.7.3 (24G419), Xcode 26.3 (17C529), Swift 6.2.4, CocoaPods 1.17.0, Ruby 4.0.9, Node v24.21.0 and npm 12.2.0. Commands started in the repository root except where shown.

| Command | Exit | Observed result |
| --- | ---: | --- |
| `sw_vers`, `xcodebuild -version`, `node --version`, `npm --version`, `pod --version`, `swift --version`, `ruby --version`, `uname -m` | 0 each | Reported the versions and architecture above. |
| `cmake --version` | 127 | CMake was absent. CocoaPods used the supported prebuilts on the successful run. |
| `ls -ld modules/jump-analysis/node_modules modules/jump-analysis/node_modules/react-native modules/jump-analysis/package-lock.json` | 0 | Both ignored install artifacts were present, with a second copy of React Native. |
| `find modules/jump-analysis/node_modules -depth -delete && unlink modules/jump-analysis/package-lock.json` | 0 | Removed the two ignored paths. |
| `npm ci --cache .cache/npm --fetch-retries=0` | 0 | Clean online install added 1,019 packages and audited 1,020. The install audit reported 24 moderate and three high vulnerabilities including dev dependencies. npm blocked install scripts for `@parcel/watcher` and `unrs-resolver`. No offline retry was needed. |
| `test ! -e modules/jump-analysis/node_modules && test ! -e modules/jump-analysis/package-lock.json`, `git diff --exit-code -- package-lock.json` | 0 each | Both ignored artifacts stayed absent after root install, Expo config/export and CocoaPods. npm left the lock unchanged. |
| `npm run build:ios:simulator` | 1 | CocoaPods reached dependency installation, then got `Errno::EPERM` opening the default user cache's `Pods/VERSION`. Xcode was not reached. |
| In `ios`: `CP_CACHE_DIR="$PWD/../.cache/cocoapods-cache" CP_HOME_DIR="$PWD/../.cache/cocoapods-home" TMPDIR="$PWD/../.cache/tmp" COCOAPODS_DISABLE_STATS=true EXPO_NO_TELEMETRY=1 pod install --no-repo-update --verbose` | 130 | Trunk bootstrap fetched `CocoaPods-version.yml` from `cdn.cocoapods.org`. The log showed no pod shard request. The download for `ReactNativeDependencies (0.88.0)` from `repo.reactnative.dev` succeeded, then `tar` reported `No space left on device` extracting `ReactNativeDependenciesHeaders.xcframework`. Interrupted the stalled command after the error. |
| `COCOAPODS_SKIP_CACHE=1 CP_HOME_DIR="$PWD/.cache/cocoapods-home" COCOAPODS_SKIP_SEARCH=1 npm run build:ios:simulator` | 66 | After freeing the two caches created by this run, CocoaPods installed 102 pods from 103 Podfile dependencies. Xcode then reported `'ios/JumpLab.xcworkspace' is not a workspace file.` and CoreSimulator reported `Connection refused`. |
| `COCOAPODS_SKIP_CACHE=1 CP_HOME_DIR="$PWD/.cache/cocoapods-home" COCOAPODS_DISABLE_STATS=true COCOAPODS_SKIP_SEARCH=1 EXPO_NO_TELEMETRY=1 pod install --project-directory=ios --no-repo-update` | 0 | Independently repeated the successful CocoaPods step. It retained the generated lock. |
| `cd ios && xcodebuild -workspace JumpLab.xcworkspace -scheme JumpLab -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath "$PWD/../.cache/DerivedData" CODE_SIGNING_ALLOWED=NO -quiet build` | 66 | The gate command reported `'JumpLab.xcworkspace' is not a workspace file.` even though `contents.xcworkspacedata` exists. Used repository-local DerivedData. |
| `xcrun simctl list devices available` | 1 | Repeated alongside the gate. CoreSimulatorService connection became invalid and failed with POSIX code 61, `Connection refused`. |
| `cmp ios/Pods/Manifest.lock ios/Podfile.lock`, `shasum ios/Podfile`, `test -f ios/JumpLab.xcworkspace/contents.xcworkspacedata` | 0 each | CocoaPods lock and installed manifest match. The checksum is `412c7a2cb4b1f83736c98325eb2a40bf1ee91a23` in both the computed hash and lock. The workspace descriptor exists. |
| `JUMPLAB_SIMULATOR_UDID=round6-preflight sh scripts/smoke-ios.sh` | 2 | Missing binary preflight named the build command. No simulator boot, Metro, install, launch or XCTest ran. No pass/skip counts or screenshot attachments exist for this round. |
| `sh -n scripts/smoke-ios.sh` | 0 | Shell syntax passed. |
| `npm run -s typecheck`, `npm run -s lint`, `npx --no-install expo config --type public --json > /dev/null` | 0 each | TypeScript and Expo config resolved. The focused source check had zero failures. |
| `npm run test:unit` | 0 | 50 passed, zero skipped. Three new smoke-script tests cover the missing executable, a shut-down simulator and replacement of the result bundle on the second run using stubbed simulator commands. |
| `node --test smoke-ios.test.ts` in an isolated scratch directory with the `c4f9deb` smoke script | 1 | Expected regression control. All three new tests failed against the baseline script. |
| `npm run test:ui` | 0 | 53 passed across five suites, zero skipped. Tests use component and store boundaries with mocks where applicable. |
| `npm run test:native` | 0 | 11 synthetic transition checks and 10 host media, timing and receipt checks printed PASS. No athlete clips were analyzed. |
| `npm run check:docs`, `git diff --check` | 0 each | Documented scripts, paths and IDs present. No whitespace errors. |
| `npm run evaluate:video` | 2 | Zero annotated clips, zero accuracy observations. |
| `npm_config_cache="$PWD/.cache/npm" npm_config_fetch_retries=0 npm run check:dependencies` | 1 | npm reached the registry advisory service and reported nine vulnerabilities, six moderate and three high, in the production dependency tree. |
| `EXPO_NO_TELEMETRY=1 npx --no-install expo export --platform ios --output-dir .cache/ios-export` | 0 | Produced a 719-module Hermes iOS bundle and export metadata. |
| `npm run check:secrets` | 0 | Zero matches in source, reachable Git patches and two fresh export files. Debug simulator builds load JavaScript from Metro and contain no `main.jsbundle`. This export supplies the JavaScript evidence. No linked app was available to scan. |
| `supabase --version`, `docker info`, `psql --version` | 127 each | CLI, container tooling and SQL client absent from PATH. Stack startup, migration reset and `supabase/tests/limits.sql` were not run. |
| `env -u JUMPLAB_TEST_DISPOSABLE npm run test:integration`, `env -u JUMPLAB_TEST_DISPOSABLE npm run test:security` | 2 each | Disposable-environment guard stopped before network requests. Zero live assertions. |
| `JUMPLAB_TEST_DISPOSABLE=YES npm run check:database-types` | 2 | Missing CLI guard stopped before connecting or generating types. Drift remains unknown. |
| `curl -ILsS --max-time 8 <official documentation URL> -o /dev/null` | 0 each | Expo development-build, Supabase Auth rate-limit and Apple accessibility endpoints responded from the Mac. See the official references in the README. |

The nested install was present at workspace entry. Root `npm ci`, Expo config/export and CocoaPods did not recreate it, which points to workspace setup or an earlier install inside the module. Its exact origin was not observed. The build script still rejects a nested `node_modules` with exit 3.

CocoaPods generated one tracked lockfile change, the `ExpoModulesCore` spec checksum. It kept the upstream `hermes-v260318099.0.2` tag from React Native's `.hermesv1version`; the pod installation used checksum-verified prebuilt Hermes 260318099.0.4. The truncated run's disk exhaustion and the default cache restriction were recovered without changing the Podfile. For the remaining Xcode failure, run the gate in an Xcode session where `xcrun simctl list devices available` succeeds, then boot an available iPhone simulator, start `CI=1 npx expo start --dev-client --port 8081`, and run `JUMPLAB_SIMULATOR_UDID=<udid> sh scripts/smoke-ios.sh`. Record XCTest pass/skip counts and screenshot attachments in `.cache/LaunchSmoke.xcresult`, then stop Metro. The picker test is expected to skip unless pointed at a disposable local account.

The production audit identifies Expo tooling paths involving `node-forge` and `zod` (high) and `glob` and `minimatch` (moderate), with transitive Expo packages included in npm's total. Review Expo-compatible upgrades for those paths, refresh the 53 optional lock entries missing integrity metadata with npm, and rerun the audit, native build and export. The Round 6 pattern scan is limited to the bytes it inspected. No runtime traffic or seeded logs were captured.

## Round 5, stage S1, iteration 4 on November 19

Verified from `2a13d41` on macOS 15.7.3 (24G419), Xcode 26.3 (17C529), Node v24.21.0 and npm 12.2.0. Commands started in the JumpLab root unless shown otherwise.

| Command | Exit | Observed result |
| --- | ---: | --- |
| `sw_vers && xcodebuild -version && node --version && npm --version` | 0 | Reported the host and toolchain versions above. |
| `test ! -e modules/jump-analysis/node_modules && test ! -e modules/jump-analysis/package-lock.json && git check-ignore modules/jump-analysis/package-lock.json` | 0 | Nested artifacts absent and nested lockfile path ignored. |
| `cd . && npm run -s typecheck` | 0 | TypeScript passed. |
| `cd . && npm run -s lint` | 0 | Zero source check failures. |
| `cd . && npx --no-install expo config --type public --json > /dev/null` | 0 | Expo public configuration resolved. |
| `cd . && npm run test:unit` | 0 | 47 passed, zero skipped. |
| `cd . && npm run test:ui` | 0 | 53 passed across five suites, with mock transport and native modules where applicable. |
| `cd . && npm run test:native` | 0 | macOS synthetic detector, timing, media and receipt checks passed. |
| `cd . && npm run check:docs` | 0 | Documented paths and all 38 criterion IDs found. |
| `cd . && npm run check:secrets` | 0 | Zero pattern matches across source, reachable Git patches and 155 existing client assets. |
| `xcrun simctl list devices available` | 1 | CoreSimulator connection refused. |
| `cd ios && xcodebuild -workspace JumpLab.xcworkspace -scheme JumpLab -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath ~/agentloop/derived/e177760763b1 CODE_SIGNING_ALLOWED=NO -quiet build` | 66 | CoreSimulator connection became invalid. Xcode reported “JumpLab.xcworkspace is not a workspace file.” |
| `cd . && npm run build:ios:simulator` | 1 | CocoaPods stopped before Xcode with “Couldn't resolve host name” for `cdn.cocoapods.org/all_pods_versions_a_9_3.txt`. |
| `test -f ios/JumpLab.xcworkspace/contents.xcworkspacedata` | 0 | Workspace descriptor exists. |
| `supabase --version`, `docker info`, `psql --version` | 127 each | Commands unavailable on PATH. |
| `node --check scripts/backend-test.mjs` | 0 | Backend suite parsed. |
| `npm run test:integration`, `npm run test:security` | 2 each | Disposable-environment guard stopped both suites before any assertions. |
| `cd . && npm run evaluate:video` | 2 | Zero annotated clips. Real-video accuracy remains unverified. |
| `git diff --check` | 0 | No whitespace errors. |

- **JL-013 and JL-019.** Routine profile edits wait when a saved workout still depends on the queued plan, even for completed workouts and earlier dates. The transactional guard leaves the original publication and workout queued. “A completed workout keeps its unpublished plan across a blocked edit, restart and reconnect” reopens the SQLite file, acknowledges the dependency and confirms exactly one workout dispatch using simulated transport. A pain edit pauses training on the iPhone immediately. “A pain edit pauses training immediately while the original plan and completed workout sync” verifies that the original wire payload survives an in-flight edit and that the pause can sync on the next refresh. A terminal rejection preserves the pair for review and the app prompts the user to save the pain pause again.
- **JL-031 and R5-03.** Today and Progress share the cached prescription’s publication check. The error and conflict component cases continue a retryable draft, record a terminal outcome through Settings, and verify that the saved log stays visible in Progress without a logging action in either view.
- **JL-015, R5-02 and R5-03.** Live parity and rollback still require a disposable Supabase stack with the migrations applied. The backend test commands made zero live assertions. Simulator launch remains outstanding. Real athlete accuracy and physical-device behavior remain unverified.

## Round 5, stage S1, iteration 3

Verified from `4da83d4` on 2026-11-19 (MST). Commands ran in the JumpLab root unless shown otherwise. Earlier logs are historical.

| Command | Exit | Observed result |
| --- | ---: | --- |
| `test ! -e modules/jump-analysis/node_modules && test ! -e modules/jump-analysis/package-lock.json && git check-ignore modules/jump-analysis/package-lock.json` | 0 | Both generated paths were absent. The nested lockfile path is ignored. |
| `npm run -s typecheck` | 0 | TypeScript passed. |
| `npm run -s lint` | 0 | Zero source check failures. |
| `npx --no-install expo config --type public --json > /dev/null` | 0 | Expo public configuration resolved. |
| `npm run test:unit` | 0 | 46 passed, zero skipped. |
| `npm run test:ui` | 0 | 50 passed across five suites, with mock transport and native modules where applicable. |
| `npm run test:native` | 0 | macOS synthetic transition, timing, media and receipt checks passed. |
| `npm run check:docs` | 0 | Documented paths and all 38 criterion IDs found. |
| `npm run check:secrets` | 0 | Zero pattern matches across source, reachable Git patches and 155 existing client assets. |
| `xcrun simctl list devices available` | 1 | CoreSimulator refused the connection. |
| `cd ios && xcodebuild -workspace JumpLab.xcworkspace -scheme JumpLab -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath "$PWD/../.cache/DerivedData" CODE_SIGNING_ALLOWED=NO -quiet build` | 66 | CoreSimulator connection invalid. Xcode reported “JumpLab.xcworkspace is not a workspace file.” The repository-local DerivedData path kept build writes in JumpLab. |
| `npm run build:ios:simulator` | 1 | CocoaPods could not resolve `cdn.cocoapods.org` while fetching `all_pods_versions_a_9_3.txt`. |
| `supabase --version`, `docker info`, `psql --version` | 127 each | Commands unavailable on PATH. |
| `node --check scripts/backend-test.mjs` | 0 | Backend test script parsed. |
| `npm run test:integration`, `npm run test:security` | 2 each | Disposable-environment guard stopped both suites before any assertions. |
| `npm run evaluate:video` | 2 | Zero annotated clips. Real-video accuracy remains unverified. |
| `git diff --check` | 0 | No whitespace errors. |

- JL-013, JL-015 and JL-031. “Interrupted initial workout history defers a Monday-to-Friday edit even after restart” reproduces partial hydration before a profile edit and checks that the queued replacement starts the following week. Each edit checks workout history afresh, including after restart. A failed download reserves the rest of the current week and allows recovery from possible same-day work. “Scheduling history rejects an interrupted workout page and retries through the last page” exercises production store pagination and SQLite against mocked transport. The Friday budget cases check both cached and freshly downloaded completions.
- JL-013 and JL-019. The routine edit UI case saves a body-weight change, resumes the previous prescription in Today, and completes the workout with the same IDs and logged set. The pain and no-impact cases keep the logged work in history and block resuming it. The unpublished-plan case keeps the current workout reachable by deferring replacement until its prescription can sync.
- R5-02 and R5-03. The shared parity and paired rollback tests are present. Live results require a disposable local Supabase CLI and container runtime with migrations applied. Simulator launch evidence requires a successful build and access to CoreSimulator. No consented athlete clips or signed iPhone run were available.

## Round 5, stage S1, iteration 2

Verified from `025469a` on 2026-11-19 (MST). Commands start in the JumpLab root unless the command changes directories. Earlier logs below are historical.

| Command | Exit | Observed result |
| --- | ---: | --- |
| `test ! -e modules/jump-analysis/node_modules && test ! -e modules/jump-analysis/package-lock.json && git check-ignore modules/jump-analysis/package-lock.json` | 0 | Both generated paths were absent. The nested lockfile path is ignored. |
| `mkdir modules/jump-analysis/node_modules && (trap 'rmdir modules/jump-analysis/node_modules' EXIT; sh scripts/build-ios.sh)` | 3 | The guard printed the nested path and duplicate React Native warning, then exited before CocoaPods. |
| `cd . && npm run -s typecheck` | 0 | TypeScript passed. |
| `cd . && npm run -s lint` | 0 | Zero source check failures. |
| `cd . && npx --no-install expo config --type public --json > /dev/null` | 0 | Expo public configuration resolved. |
| `cd . && npm run test:unit` | 0 | 46 passed, zero skipped. |
| `cd . && npm run test:ui` | 0 | 43 passed across five suites using native and Auth mocks where applicable. |
| `cd . && npm run test:native` | 0 | macOS synthetic transition, timing, media and receipt checks passed. |
| `cd . && npm run check:docs` | 0 | Documented paths and all 38 criterion IDs found. |
| `cd . && npm run check:secrets` | 0 | Zero pattern matches across source, reachable Git patches and 155 existing client assets. |
| `xcrun simctl list devices available` | 1 | CoreSimulator refused the connection. |
| `cd ios && xcodebuild -workspace JumpLab.xcworkspace -scheme JumpLab -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath ~/agentloop/derived/e177760763b1 CODE_SIGNING_ALLOWED=NO -quiet build` | 66 | CoreSimulator connection invalid. Xcode reported “JumpLab.xcworkspace is not a workspace file.” The workspace file exists. The prior independent build passed. |
| `cd ios && xcodebuild -workspace JumpLab.xcworkspace -scheme JumpLab -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath "$PWD/../.cache/DerivedData" CODE_SIGNING_ALLOWED=NO -quiet build` | 66 | Using repository-local DerivedData produced the same errors. |
| `cd . && npm run build:ios:simulator` | 1 | CocoaPods stopped at `cdn.cocoapods.org/all_pods_versions_a_9_3.txt` with “Couldn't resolve host name.” Xcode was not reached. |
| `supabase --version`, `docker info`, `psql --version` | 127 each | Commands unavailable on PATH. |
| `node --check scripts/backend-test.mjs` | 0 | Backend test script parsed. |
| `cd . && npm run test:integration`, `cd . && npm run test:security` | 2 each | Disposable-environment guard stopped both suites. Zero live assertions. |
| `cd . && npm run evaluate:video` | 2 | Zero consented annotated clips. Real-video accuracy remains unverified. |
| `git diff --check` | 0 | No whitespace errors. |

- JL-013 and JL-015. “Editing Monday availability to Friday after completing a workout respects a 25-minute weekly budget” verifies that a completed 25-minute Monday workout stays in history and the replacement begins the following Friday. The 50-minute case keeps the replacement on the current Friday. Replacement counts prescribed minutes in the current local Monday–Sunday week. If the plan would exceed the remaining budget, the entire replacement moves to the following week so its normal session count and progression are preserved. This check uses available account history.
- JL-016 and R5-02. “Unidentified, old or duplicated workout feedback cannot escalate loads” checks holds for missing, duplicate, differently cased and previously used identities. The successful increase records three distinct workout UUIDs. The backend parity fixture uses those UUIDs and asserts that the rollover payload includes them. Pain and fatigue still pause training with incomplete feedback.
- JL-019. “An independent jump syncs behind 60 workouts waiting on conflicting plans” runs production SQLite queue selection and acknowledgement. The jump is acknowledged and the 60 workouts remain intact. The conflict-resolution tests also verify that a workout can sync in the same batch after its pending parent is acknowledged.
- JL-031. “Picker rejection explains restricted access or unsupported media and allows retry” checks the import hint and FPS prefill on retry. “Failed password login protects private cached work and a successful retry reopens it” checks that the failed login leaves the private cache locked and that the correct account can reopen it.

R5-02 and R5-03 still need live evidence from a disposable Supabase stack with the migrations applied. No iPhone installation, real athlete clip run, or physical-device measurement was performed.

## Round 5, stage S1, current checkout

Verified from `2a1b51d` on 2026-11-19 (MST). The Mac reported macOS 15.7.3 (24G419), Xcode 26.3 (17C529), Swift 6.2.4, CocoaPods 1.17.0, Node v24.21.0 and npm 12.2.0. Commands started in the JumpLab root. The direct Xcode command changes into `ios`.

| Command | Exit | Observed result |
| --- | ---: | --- |
| `find modules/jump-analysis/node_modules -depth -delete && unlink modules/jump-analysis/package-lock.json` | 0 | Removed the regenerated module dependencies and lockfile. |
| `test ! -e modules/jump-analysis/node_modules && test ! -e modules/jump-analysis/package-lock.json && git check-ignore modules/jump-analysis/package-lock.json` | 0 | Both paths were absent and the nested lockfile path was ignored. |
| `mkdir modules/jump-analysis/node_modules && (trap 'rmdir modules/jump-analysis/node_modules' EXIT; sh scripts/build-ios.sh)` | 3 | Printed “Nested module install found at modules/jump-analysis/node_modules; remove it (duplicate react-native breaks autolinking).” |
| `node --version`, `npm --version`, `sw_vers`, `xcodebuild -version`, `pod --version`, `swift --version` | 0 each | Reported the toolchain versions above. |
| `cd . && npm run -s typecheck` | 0 | TypeScript passed. |
| `cd . && npm run -s lint` | 0 | Zero source check failures. |
| `cd . && npx --no-install expo config --type public --json > /dev/null` | 0 | Expo public configuration resolved. |
| `cd . && npm run test:unit` | 0 | 45 passed, zero skipped. |
| `cd . && npm run test:ui` | 0 | 39 passed across five suites. |
| `cd . && npm run check:docs` | 0 | Documented paths and all 38 criterion IDs found. |
| `cd . && npm run test:native` | 0 | macOS synthetic detector, timing, media and receipt tests passed. |
| `xcrun simctl list devices available` | 1 | CoreSimulator connection refused. |
| `cd ios && xcodebuild -workspace JumpLab.xcworkspace -scheme JumpLab -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath ~/agentloop/derived/e177760763b1 CODE_SIGNING_ALLOWED=NO -quiet build` | 66 | CoreSimulator connection invalid. Xcode also reported “JumpLab.xcworkspace is not a workspace file.” |
| `cd . && npm run build:ios:simulator` | 1 | CocoaPods could not resolve `cdn.cocoapods.org` while fetching `all_pods_versions_a_9_3.txt`. Xcode was not reached. The previously tracked `ios/Podfile.lock` is present. |
| `cd . && npm run check:secrets` | 0 | Zero pattern matches in source, reachable Git patches and 155 existing simulator asset files. |
| `node scripts/check-secrets.mjs .cache/DerivedData/Build/Products/Debug-iphonesimulator/JumpLab.app` | 0 | The existing app directory was scanned twice by the script. Its `Info.plist` exists and `main.jsbundle` is absent. Current bundled JavaScript still needs scanning after a successful build. |
| `npm run check:dependencies -- --fetch-retries=0` | 1 | The advisory request failed with `getaddrinfo ENOTFOUND registry.npmjs.org`. |
| `supabase --version`, `docker info`, `psql --version`, `cmake --version` | 127 each | Commands unavailable on PATH. |
| `cd . && npm run test:integration`, `cd . && npm run test:security` | 2 each | Disposable-backend guard stopped both commands. Zero live assertions. |
| `cd . && npm run evaluate:video` | 2 | Zero consented annotated clips. Real-world accuracy remains unverified. |
| `git diff --check` | 0 | No whitespace errors. |

- **JL-015, JL-016 and R5-02.** Replaying 100 synthetic rollovers with the previous adapter produced a 686.86 kg squat target. The database and workout logger accept loads through 500 kg. The adapter now caps increases at that existing storage limit. “Repeated load increases stay within the server and workout logging range” verifies the new boundary and successful prescribed-set validation. The shared maximum-input profile also goes through the disposable parity suite’s generation, hold, increase and deload cases.
- **JL-013, JL-019 and R5-03.** “A rejected profile_plan RPC leaves a single terminal pair and no active draft” exercises the store and SQLite with a simulated server `22023`. It verifies a single RPC for both records, no second dispatch on retry, and no active rejected draft. The live rollback suite now checks all saved profile answers and confirms that the replacement adaptation row is absent alongside the plan and prescriptions. Run the parity and rollback suites after applying the migrations on disposable local Supabase.
- **JL-020 and JL-023.** “A pending sign-out blocks account B until device erasure completes” exercises the store against host SQLite across the erase boundary. Account B cannot open while the intent exists and opens with no A records or pending writes after erasure. The app restart and incoming-link component tests also passed. Native Keychain interruption remains unverified.
- **JL-011, JL-016, JL-024 and JL-025.** The rejection-only evaluator gate and final-day rollover regressions passed locally. Canonical profile identity, lost-ack replays and timestamp rejection cases are covered in the disposable integration suite. That suite still needs a local Supabase CLI and container runtime, applied migrations and local test credentials. The TypeScript database contract remains provisional until generated from the applied schema.

Clean installation, new simulator link and launch, and generated database types are stage S2 work. Physical iPhone installation, device measurements and real-video accuracy remain open. Earlier iteration logs below are historical evidence.

## Round 5, stage S1, iteration 4

Ran from `8172bf0` on 2026-11-18 (MST) with macOS 15.7.3 (24G419), Xcode 26.3 (17C529), Node v24.21.0 and npm 12.2.0. All commands started in the JumpLab repository root. The direct simulator build uses the repository's writable DerivedData directory.

| Command | Exit | Observed result |
| --- | ---: | --- |
| `test ! -e modules/jump-analysis/node_modules && test ! -e modules/jump-analysis/package-lock.json && git check-ignore modules/jump-analysis/package-lock.json` | 0 | Both nested install artifacts were absent. The lockfile path is ignored. |
| `cd . && npm run -s typecheck` | 0 | TypeScript passed. |
| `cd . && npm run -s lint` | 0 | Zero focused source check failures. |
| `cd . && npx --no-install expo config --type public --json > /dev/null` | 0 | Expo public configuration resolved. |
| `cd . && npm run test:unit` | 0 | 44 passed, zero skipped. Includes the local terminal error and inactive plan regression for rejected pairs. |
| `cd . && npm run test:ui` | 0 | 37 passed across five suites. |
| `npm run test:ui -- tests/app.ui.test.tsx -t 'leaving Analyze cancels pending analysis'` | 0 | The focused navigation regression passed. The name filter excluded the other 17 tests in that file. |
| `cd . && npm run check:docs` | 0 | Documented paths and all 38 criterion IDs found. |
| `cd . && npm run check:secrets` | 0 | Zero pattern matches across source, reachable Git patches and 155 existing client assets. |
| `cd . && npm run test:native` | 0 | macOS synthetic detector, media and receipt tests passed. |
| `cd ios && xcodebuild -workspace JumpLab.xcworkspace -scheme JumpLab -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath "$PWD/../.cache/DerivedData" CODE_SIGNING_ALLOWED=NO -quiet build` | 66 | CoreSimulator connection invalid. Xcode reported “JumpLab.xcworkspace is not a workspace file.” The orchestrator previously passed its separately executed build. |
| `cd . && npm run build:ios:simulator` | 1 | CocoaPods stopped at `cdn.cocoapods.org/all_pods_versions_a_9_3.txt` with “Couldn't resolve host name.” The script did not reach Xcode. |
| `xcrun simctl list devices available` | 1 | CoreSimulator returned “Connection refused.” |
| `supabase --version`, `docker info`, `psql --version` | 127 each | All three commands were unavailable on PATH. |
| `npm run test:integration`, `npm run test:security` | 2 each | Both stopped at the disposable-backend guard. Zero real client assertions ran. |
| `cd . && npm run evaluate:video` | 2 | Zero consented annotated clips. Real-video accuracy remains unverified. |
| `git diff --check` | 0 | No whitespace errors. |

JL-031 now has an app-level regression named “leaving Analyze cancels pending analysis and allows a new import without losing saved estimates.” It changes tabs while the mocked native promise is pending, checks cancellation and disposal of the imported clip, settles the promise as cancelled, and checks that the existing Progress estimate remains visible with zero new commits. Returning to Analyze imports a second clip with its own FPS and confirmation state. Physical iOS interruption and recovery remain unverified.

JL-015 and R5-03 still need a Supabase CLI, a compatible container runtime and a disposable local stack. Apply the migrations and rerun the integration suite to observe generated and adapted plan acceptance, tampering rejection, rollback of profile and prescription writes, and quota consumption. The backend guard produced zero live assertions in this run.

## Round 5, stage S1, iteration 3

Ran from `f1adb39` on 2026-11-18 (MST) with macOS 15.7.3 (24G419), Xcode 26.3 (17C529), Node v24.21.0 and npm 12.2.0. Commands started in the JumpLab root. The direct Xcode command uses the repository's DerivedData directory.

| Command | Exit | Observed result |
| --- | ---: | --- |
| `test ! -e modules/jump-analysis/node_modules && test ! -e modules/jump-analysis/package-lock.json && git check-ignore modules/jump-analysis/package-lock.json` | 0 | Both generated artifacts remain absent. The nested lockfile path is ignored. |
| `cd . && npm run -s typecheck` | 0 | TypeScript passed. |
| `cd . && npm run -s lint` | 0 | Zero focused source check failures. |
| `cd . && npx --no-install expo config --type public --json > /dev/null` | 0 | Expo public configuration resolved. |
| `cd . && npm run test:unit` | 0 | 44 passed, zero skipped. |
| `cd . && npm run test:ui` | 0 | 36 passed across five suites. |
| `cd . && npm run test:native` | 0 | macOS synthetic detector, media and receipt tests passed. |
| `cd . && npm run check:docs` | 0 | Documented paths and all 38 criterion IDs found. |
| `cd . && npm run check:secrets` | 0 | Zero pattern matches across source, reachable Git patches and 155 existing client assets. |
| `cd ios && xcodebuild -workspace JumpLab.xcworkspace -scheme JumpLab -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath "$PWD/../.cache/DerivedData" CODE_SIGNING_ALLOWED=NO -quiet build` | 66 | CoreSimulator connection invalid. Xcode reported “JumpLab.xcworkspace is not a workspace file.” |
| `cd . && npm run build:ios:simulator` | 1 | CocoaPods stopped at `cdn.cocoapods.org/all_pods_versions_a_9_3.txt` with “Couldn't resolve host name.” |
| `xcrun simctl list devices available` | 1 | CoreSimulator returned “Connection refused.” |
| `supabase --version`, `docker info`, `psql --version` | 127 each | All three commands were unavailable on PATH. |
| `cd . && npm run test:integration`, `cd . && npm run test:security` | 2 each | Both stopped at the disposable-backend guard. Zero real client assertions ran. |
| `cd . && npm run evaluate:video` | 2 | Zero annotated clips. Real-video accuracy remains unverified. |
| `git diff --check` | 0 | No whitespace errors. |

The sync queue used local plan revision and queue state to decide whether a workout could sync. A second profile edit could remove the only local reference to an in-flight pair after the server had committed it. The queue now checks the exact prescription under the signed-in account when local publication is uncertain. A failed or incomplete lookup leaves the workout retryable. A successful empty result preserves it as local history. SQLite schema version 3 reopens workouts previously marked unpublished so the next sync can verify them.

“A workout syncs once when a second profile edit supersedes a published plan whose acknowledgement was lost” exercises the production store with SQLite and simulated server responses. The profile-conflict test covers a successfully checked, unpublished prescription. “The queue upgrade reopens only workouts previously marked as unpublished” covers upgrades and preserves unrelated terminal errors. These checks advance JL-019 and JL-031. JL-015 and R5-03 still require a disposable Supabase CLI and container runtime to run the parity and paired rollback assertions. No real-video or device observations were added.

## Round 5, stage S1, iteration 2

Ran from `06bd060` on 2026-11-18 (MST). The host reported macOS 15.7.3 (24G419), Xcode 26.3 (17C529), Node v24.21.0 and npm 12.2.0. Commands below started in the JumpLab repository root.

| Command | Exit | Observed result |
| --- | ---: | --- |
| `sw_vers && xcodebuild -version && node --version && npm --version` | 0 | Confirmed the tool versions above. |
| `test ! -e modules/jump-analysis/node_modules && test ! -e modules/jump-analysis/package-lock.json && git check-ignore modules/jump-analysis/package-lock.json` | 0 | Both nested install artifacts remained absent. The nested lockfile path is ignored. |
| `cd . && npm run -s typecheck` | 0 | TypeScript passed. |
| `cd . && npm run -s lint` | 0 | Zero focused source check failures. |
| `cd . && npx --no-install expo config --type public --json > /dev/null` | 0 | Expo public configuration resolved. |
| `cd . && npm run test:unit` | 0 | 43 passed, zero skipped. |
| `cd . && npm run test:ui` | 0 | 35 passed across five suites. |
| `cd . && npm run test:native` | 0 | macOS synthetic detector, media and receipt checks passed. |
| `cd . && npm run check:docs` | 0 | Documented paths and all 38 criterion IDs found. |
| `cd . && npm run check:secrets` | 0 | Zero pattern matches in source, 155 pre-existing client asset files and reachable Git patches. |
| `plutil -lint ios/JumpLab/Info.plist ios/JumpLab.xcodeproj/project.pbxproj` | 0 | Both files passed syntax checks. |
| `cd ios && xcodebuild -workspace JumpLab.xcworkspace -scheme JumpLab -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath ~/agentloop/derived/e177760763b1 CODE_SIGNING_ALLOWED=NO -quiet build` | 66 | CoreSimulator connection invalid. Xcode reported “JumpLab.xcworkspace is not a workspace file.” |
| `TMPDIR="$PWD/.cache/tmp" xcodebuild -workspace "$PWD/ios/JumpLab.xcworkspace" -scheme JumpLab -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath "$PWD/.cache/DerivedData" CODE_SIGNING_ALLOWED=NO -quiet build` | 66 | The absolute workspace path and writable DerivedData path yielded the same workspace error. |
| `cd . && npm run build:ios:simulator` | 1 | CocoaPods could not resolve `cdn.cocoapods.org` for `all_pods_versions_a_9_3.txt`. The script stopped before Xcode. |
| `xcrun simctl list devices available` | 1 | CoreSimulator returned “Connection refused.” Launch smoke and screenshots require a working simulator service and a rebuilt app. |
| `TMPDIR="$PWD/.cache/tmp" xcrun --sdk iphonesimulator swiftc -typecheck -D DEBUG -target arm64-apple-ios16.4-simulator -sdk "$(xcrun --sdk iphonesimulator --show-sdk-path)" -module-cache-path "$PWD/.cache/swift-ios" -F "$PWD/.cache/DerivedData/Build/Products/Debug-iphonesimulator/XCFrameworkIntermediates/ExpoModulesCore" -F "$PWD/.cache/DerivedData/Build/Products/Debug-iphonesimulator/XCFrameworkIntermediates/ExpoModulesJSI" modules/jump-analysis/ios/*.swift` | 0 | All native module Swift sources, including the Expo bridge, type-checked against the simulator SDK and existing Expo frameworks. |
| `supabase --version`, `docker info`, `psql --version` | 127 each | Each command was unavailable on PATH. |
| `cd . && npm run test:integration`, `cd . && npm run test:security` | 2 each | Both stopped at the disposable-backend guard. Zero real client assertions ran. |
| `cd . && npm run evaluate:video` | 2 | “UNVERIFIED: no annotated real clips.” Zero clips evaluated. |
| `git diff --check` | 0 | No whitespace errors. |

| Reviewer finding | Fix and evidence |
| --- | --- |
| Profile and plan publication (JL-013, JL-015, JL-019, R5-02, R5-03) | Migration `202611190001_fix_profile_plan_extraction.sql` extracts the nested profile before removing server-controlled keys. The disposable suite covers valid paired publication, concurrent exact replay, pain-only publication and replay, and rollback with quota consumption. Run the migrations and both backend suites with a disposable local Supabase CLI and container runtime to verify the server paths. |
| Saved profile revision race (JL-004, JL-019, JL-031) | Keeping the saved profile fetches a matching plan and confirms the revision before settling the pair in one SQLite transaction. “Keeping the saved profile cannot activate an earlier plan after a concurrent pain pause” exercises a pause arriving during the plan read and a successful retry that installs the pause. |
| Unreadable analysis receipt (JL-021, JL-031) | Native Swift distinguishes readable corruption from failed file reads and rechecks corruption before removing the current account’s receipt. The macOS file test covers malformed JSON, non-object and incomplete receipts, a valid replacement and an I/O failure. UI tests cover discard followed by a new analysis and retry after temporary read failure. A host SQLite test confirms that saved measurements and their pending writes survive recovery. |

Iteration 1’s simulator build predates these Swift edits. Its CocoaPods project, workspace, privacy manifest and lockfile were already present when iteration 2 began. The simulator-target type check covers the current Swift code. A fresh linked build and launch still require the orchestrator or a Mac session with working CocoaPods and CoreSimulator access. Device and real-video measurements remain unverified.

## Round 5, stage S1, iteration 1

Verified from `18bbe2e` on 2026-11-18 (MST), macOS 15.7.3 (24G419), Xcode 26.3 (17C529), Node v24.21.0 and npm 12.2.0. Commands below ran from the JumpLab repository root.

| Command | Exit | Observed result |
| --- | ---: | --- |
| `python3 -c 'from pathlib import Path; from shutil import rmtree; p = Path("modules/jump-analysis"); rmtree(p / "node_modules"); (p / "package-lock.json").unlink()'` | 0 | Removed both generated artifacts from the local module. |
| `test ! -e modules/jump-analysis/node_modules && test ! -e modules/jump-analysis/package-lock.json && git check-ignore modules/jump-analysis/package-lock.json` | 0 | Both artifacts were absent and the nested lockfile path was ignored. |
| `mkdir modules/jump-analysis/node_modules && (trap 'rmdir modules/jump-analysis/node_modules' EXIT; sh scripts/build-ios.sh)` | 3 | Guard reported “Nested module install found at modules/jump-analysis/node_modules; remove it (duplicate react-native breaks autolinking).” The probe directory was removed. |
| `cd . && npm run -s typecheck` | 0 | TypeScript passed. |
| `cd . && npm run -s lint` | 0 | Zero focused source check failures. |
| `cd . && npx --no-install expo config --type public --json > /dev/null` | 0 | Expo resolved its public configuration. |
| `cd . && npm run test:unit` | 0 | 43 passed, zero skipped. |
| `cd . && npm run test:ui` | 0 | 31 passed in five suites. |
| `cd . && npm run test:native` | 0 | macOS detector, timing and file/media checks passed with synthetic inputs. |
| `cd . && npm run check:secrets` | 0 | Zero pattern matches in source and reachable Git patches. Zero client asset files scanned. |
| `supabase --version`, `docker info`, `psql --version` | 127 each | Each command was unavailable on PATH. |
| `cd . && npm run test:integration`, `cd . && npm run test:security` | 2 each | Disposable backend guard stopped both suites. Zero real client assertions ran. Start a disposable local Supabase and apply migrations before running them. |
| `cd . && npm run evaluate:video` | 2 | “UNVERIFIED: no annotated real clips.” The sample count was zero. |
| `cd . && npm run check:docs` | 0 | Commands, paths and all 38 IDs were found. |
| `git diff --check` | 0 | No whitespace errors. |

### Reconciliation

| Finding | Stage S1 evidence |
| --- | --- |
| R5-01 nested install | Removed the duplicate module install and added an early exit in `scripts/build-ios.sh`. The guard probe returned 3 before CocoaPods. |
| JL-013, JL-019 and JL-031 profile conflict recovery | `src/data/store.ts` now fetches the saved plan before settling “Keep saved version” and confirms the cache has an acknowledged plan for that profile revision when training is active. The store test “conflicting profile and plan stay together when keeping the remote version” injects a download failure, checks that the conflict is retained and then recovers it. Its local-choice counterpart verifies the pair is retried as one RPC. |
| JL-019 discarded plan selection | `selectActivePlan` in `src/core/queue.ts` requires an unpublished standalone draft to have a sendable plan entry. “An unpublished standalone plan cannot become active after discarding its conflict” covers the case where an abandoned draft still references the current profile revision. |
| R5-03 paired rollback | “A rejected profile and replacement share one error and the unpublished plan cannot become active” passed with host SQLite. The disposable backend test submits a structurally valid replacement that violates the profile’s impact constraint and checks the retained profile revision, absent plan and prescription rows, and consumed quota. Backend execution remains blocked. |
| R5-02 and JL-015 parity | Shared training fixtures drive generation and hold, increase and deload rollovers. The backend test also checks exact rollover replay after a newer profile publication and separately tampers with practice adjacency, impact, load and weekly time. Host training scenarios passed. Server acceptance and rejection assertions remain blocked. |
| JL-020 and JL-023 interrupted sign-out | Confirmed the SQLite erase intent survives restart and blocks owner access, and the app resumes cleanup before opening another account. The UI test “an incoming account link cannot exchange a code during a pending sign-out erase” passed. No installed-device evidence. |
| JL-016 and JL-018 final-day rollover | “Rollover preserves the final scheduled workout until it completes or its day ends” covered unstarted, in-progress, completed and next-day cases. Today’s final-day UI test passed. |
| JL-011 evaluator gate | “Rejection-only coverage cannot pass and repeated coverage requires multiple matched events” passed. The production evaluator exited 2 with zero clips. Sample accuracy remains unverified. |
| JL-022, JL-024 and JL-025 backend boundary | Source inspection confirmed canonical profile identity and the timestamp validator. The backend assertions require B’s first revision after A’s forged ID, the app timestamp format, rejection of non-finite, impossible, non-UTC, loose and out-of-range dates, and consistent completion timestamps. Applied schema and generated types still require local Supabase. |

The clean install, simulator link and launch, dependency audit, built-app scan and database type regeneration are stage S2 work. A signed physical install, device measurements and consented original footage remain outstanding. The previous round’s results follow as historical evidence.

## Round 4 implementation handoff (historical)

Updated 2026-11-18 in the isolated implementation checkout following Astra’s review of `a5b903c`. The historical checks below were not carried forward as round 5 passes.

### Executed checks (historical)

| Check | Observed result |
| --- | --- |
| Fresh Apple-silicon install in an empty workspace directory using the current lock and `npm ci --offline --cache ../npm --no-audit --no-fund` | Exit 0. Installed 1,019 packages. npm blocked two optional install scripts and used available packaged binaries. |
| `npm run typecheck` and `npm run lint` | Exit 0. |
| `npm run test:unit` | Exit 0. 41 passed, including real host SQLite restart and erase intent, paired plan acknowledgement, final-day rollover, summary values and rejection-only evaluator coverage. |
| `npm run test:ui` | Exit 0. 30 passed across five suites. Covers mocked sign-out interruption and retry, the final-day Today flow, and production store code using host SQLite and simulated conflict responses. |
| `npm run test:native` | Exit 0 on macOS. Synthetic transition, edit-list and camera-stability checks plus media rejection and cleanup checks. |
| Swift standalone engine typecheck with `-target arm64-apple-ios16.4-simulator` and the simulator SDK | Exit 0 with a workspace-local temporary directory. Covers the analyzer and detector source. The Expo bridge and linked app require the full native build. |
| `npm run check:docs`, `git diff --check` and iOS plist/project syntax | Exit 0. |
| iOS JavaScript export and `npm run check:secrets -- .cache/ios-export-final` | Export exit 0 with 719 modules. Pattern scan exit 0 with zero matches across source, two exported assets and reachable Git patches. |
| `npm run build:ios:simulator` | Exit 1 at CocoaPods. Hermes retrieval could not resolve github.com and the source fallback requires absent CMake. No resolved Podfile.lock, simulator app or launch result. CoreSimulator refused connections (exit 1). CoreDeviceService timed out before listing devices (exit 1). |
| `npm run check:dependencies -- --fetch-retries=0` | Exit 1. The registry advisory endpoint could not resolve. Cached install success establishes dependency resolution for this host. Advisory status remains unknown and 53 optional platform entries need upstream integrity metadata. The local npm cache had no registry keys for those entries. |
| Official Apple Vision and Supabase Auth documentation requests | Both exited 6 due to DNS. Current live guidance remains open. |
| `npm run test:integration`, `npm run test:security` and `npm run check:database-types` | Each exit 2. Disposable local Supabase, CLI, Docker, psql and test credentials were unavailable. No migrations applied, generated types compared, or real client assertions run. |
| `npm run evaluate:video` | Exit 2. Zero consented annotated athlete clips. Error rates, latency, memory, and thermal observations are unavailable. |

Host toolchain and exact setup commands are in [README](../README.md). The real-video and profiler protocols are in [Measurement](MEASUREMENT.md). Backend setup, configuration, and real-client checks are in [Backend](BACKEND.md).

### Acceptance evidence (historical)

**Local pass** identifies a completed host check. **Failed** records an executed failing check. **Blocked** names a missing prerequisite. **Unverified** identifies a remaining verification step. Real-video sample size was zero. Device validation and physical performance measurements remain outstanding.

| ID | Status | Evidence and remaining verification |
| --- | --- | --- |
| JL-001 | Blocked | Pinned React Native/TypeScript and Expo native module, iOS project, and Supabase sources. Fresh cached npm install and typecheck pass. Native dependency retrieval, CocoaPods lock and simulator link require a network-enabled macOS host with CMake. |
| JL-002 | Local pass | Sol's handoff responds to Astra's findings through the existing workflow. Independent review remains with Astra. |
| JL-003 | Unverified | Production path runs PHPicker, AVAssetReader, Vision, contact transitions and timestamp-based estimates. Supply original athlete footage and trace accepted events. Feasibility-first milestone ordering remains unproven. |
| JL-004 | Local pass | Native platform inference and scoped metadata writes. New events retain compact provenance and chart hydration uses a projected view. Inspect applied view and real traffic after backend setup. |
| JL-005 | Unverified | Guidance, picker cancellation, three jump modes and FPS confirmation exercise mocked component paths. Run the system picker with a built app and disposable account. |
| JL-006 | Local pass | Native same-speed source cut, target gap, retiming and nonzero-origin segment tests. TS tests cover original CFR/VFR and verified mappings. Unsupported native mappings reject. Real timing variants remain open. |
| JL-007 | Unverified | Native synthetic running contact, actual repeated-mode paths, ordered jumps, trailing partial, noise and track loss pass. Validate against footage of all three movement types and athlete changes. |
| JL-008 | Unverified | Native transient pose failures and camera instability reject in synthetic tests. All estimates remain experimental and excluded from training. Record real false-rejection/false-acceptance outcomes and retry behavior. |
| JL-009 | Local pass | Known airtime, invalid inputs, boundary and SI unit tests. Result labels and posture assumptions are in Analyze and Measurement. |
| JL-010 | Unverified | Host tests verify summary count, mean and best, compact provenance, timing ranges, compatibility and bounded date-scoped SQLite reads. Inspect the rendered chart and a backend round trip. |
| JL-011 | Blocked | The evaluator invokes production Swift and TS. The gate now requires matched accepted references, including multi-jump repeated footage. Rejection-only and empty tests cover both failure paths. Supply consented clips and annotations to measure real accuracy. |
| JL-012 | Unverified | Native detached incremental decode and resource limits. The host suite checks specific cancellation, missing/oversized media and camera failures. Measure interruption and cleanup on iPhone and capture runtime traffic. |
| JL-013 | Unverified | Profile UI, validation and program changes exercise host mocks. Paired queue tests preserve consistent conflict choices. Run profile edits and regeneration across two sessions on local Supabase and iOS. |
| JL-014 | Local pass | Reproducible versioned plans with complete exercise prescriptions in training tests. |
| JL-015 | Blocked (disposable Supabase CLI and container runtime → run backend parity) | Host personalization scenarios pass. Run `npm run test:integration` after applying the migrations to exercise generated and adapted plans, tampered plans and the two-client conflicts. |
| JL-016 | Local pass | Adaptation boundaries and final-day rollover pass in host tests. Today retains unstarted or partially completed final-day work. Missing sessions are left on their original dates. Real jump trends are excluded pending validation. |
| JL-017 | Unverified | Pain and fatigue guards and completed-history immutability pass locally. Today can display the saved reason. Verify persisted adaptation reason and rule version on an applied backend. |
| JL-018 | Unverified | SQLite restart tests and prescribed logging assertions pass on the host. Today retains final-day access. Process termination during logging and result saving remains untested on iOS. |
| JL-019 | Unverified | Host tests cover SQLite restart, held dependent writes, lost plan acknowledgement after a superseding edit, failed lookup retry and recovery of misclassified workouts. Offline cold launch and reconnection require an installed iOS app and a local backend. |
| JL-020 | Unverified | Account-bound dispatch and stable retry keys. Durable sign-out and A/B UI simulations pass. Run real lost-acknowledgement, concurrent RPC and account-switch flows. |
| JL-021 | Unverified | Native missing/corrupt/oversized local input tests and cleanup pass on macOS. Verify provider references, interruptions and cleanup/reopen on iOS. |
| JL-022 | Blocked | Three versioned migrations and provisional TypeScript definitions with FK relationships. Apply migrations on disposable Postgres, replace the provisional definitions with Supabase CLI output and pass check:database-types. |
| JL-023 | Unverified | Keychain and PKCE code parsing are implemented. Mocked tests cover restart after interrupted erase and prevent signing out a newer account. Verify real signup, recovery, foreground refresh and revocation on iOS. |
| JL-024 | Blocked | RLS, security-invoker view and authenticated canonical profile identity are in source. Apply all migrations and run the anonymous/A/B permission matrix including the profile collision regression. |
| JL-025 | Blocked | The migration derives profile IDs, validates workout timestamps and restricts private function execution. Pattern scan of source/history and exported client assets passed. SQL behavior and linked binary still require verification. |
| JL-026 | Blocked | Existing trusted quota limiter and local Auth settings. Run disposable SQL/client boundary and concurrency suites. Hosted configuration remains unverified. |
| JL-027 | Blocked | Cascading schema, scoped local erase and pending deletion switch regression. Live suite includes residual row cleanup inventory, old-token retry and refresh rejection. Run with disposable Auth and verify device restart. |
| JL-028 | Unverified | Privacy/retention docs, no content logs in app source and limited pattern scan. Capture seeded flows and verify provider retention against actual project settings. |
| JL-029 | Unverified | Today, Analyze, Progress and Settings use real app state and honest empty states. UI tests preserve final-day access. Simulator rendering and HIG review require a linked build. |
| JL-030 | Unverified | Component light/dark contrast, roles, scalable text and target-size tests pass. Render at accessibility text sizes and inspect physical VoiceOver behavior. |
| JL-031 | Unverified | Mocked UI covers leaving Analyze with native work pending, cancellation and cleanup, saved Progress and a subsequent import. Mocked UI and host SQLite also cover interrupted erase, account switching and prescription lookup retry. Test interruption and recovery on iOS. |
| JL-032 | Unverified | Bounded compact chart reads and production analysis signposts are in source. No latency, memory, responsiveness or thermal observations were recorded. |
| JL-033 | Blocked | Host unit, native and UI/store checks passed, including dependent writes and sign-out interruptions. Real database security and persistence assertions require a disposable backend. |
| JL-034 | Failed | Fresh cached install passed. CocoaPods exited 1 before Xcode build. Complete native install with network/CMake, retain Podfile.lock and run simulator build and smoke on a host with CoreSimulator access. |
| JL-035 | Failed | Setup/docs and scoped pattern scan passed. Dependency audit failed registry DNS. Restore registry access, recover optional integrity metadata, rerun audit and complete the native setup and binary checks. |
| JL-036 | Blocked | CoreDeviceService timed out, and a signed app, provisioned iPhone and suitable recordings were unavailable. Install the bundled app on the target device and record picker, offline, interruption, persistence and VoiceOver outcomes. |
| JL-037 | Blocked | A signed build, identified iPhone, consented clips and Instruments are required. Record latency, peak memory, responsiveness, failures and thermal state across repeated runs. |
| JL-038 | Local pass | This handoff maps every criterion to host checks, missing measurements or the next verification step. Independent reconciliation remains with Astra. |
