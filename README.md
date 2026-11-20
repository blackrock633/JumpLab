# JumpLab

An iOS React Native/TypeScript app for individual jump training and **experimental, unvalidated** flight-time estimates. AVFoundation decodes imported video and Apple Vision estimates poses locally. Videos and frames have no upload path. The app uses deterministic training rules and Supabase Auth/Postgres for metadata.

This is an implementation handoff, **not an approved release**. Round 6 verified a clean JavaScript install, host test suites and an iOS JavaScript export. Simulator build and launch, a disposable backend, real athlete footage and a signed physical iPhone run remain outstanding. See [implementation and verification notes](docs/IMPLEMENTATION.md), [measurement limits](docs/MEASUREMENT.md), [training rules](docs/TRAINING.md), [backend setup](docs/BACKEND.md), and [privacy](docs/PRIVACY.md).

## Toolchain and dependencies

The checked-in manifests pin Expo SDK 58.0.16, React Native 0.88.0, React 19.3.0, TypeScript 6.0.3, Supabase JS 2.118.0, SecureStore 58.0.2, SQLite 58.0.13, Crypto 58.0.7, and safe-area-context 5.10.1. Node 24.x is required (observed 24.21.0, npm 12.2.0). Use macOS, full Xcode with command-line tools, an installed iOS simulator runtime, Ruby/CocoaPods, and CMake for the native source fallback. Xcode 26.3 (17C529) and CocoaPods are present here; CMake is absent. The project targets iOS 16.4+. This version combination still needs a successful clean iOS build before it can be called supported.

Expo supplies local native-module linking, app lifecycle, Keychain, SQLite, and random UUIDs. The small local Expo module uses platform PHPicker, AVFoundation and Vision; no third-party inference model or inference service is required. React Native safe-area-context handles insets. No Expo Go support: **build the native app**. Expo tooling is local; EAS, deployment and publishing are not required. The repository's `ios` project is authoritative; do not overwrite it with prebuild without preserving its custom module and UI-test configuration.

## Install and run

```sh
npm ci
cp .env.example .env
# Fill only the public Supabase URL and publishable key for your configured project.
npm run build:ios:simulator
npm run start
# In a second terminal, with an installed simulator runtime:
npm run ios
```

A clean root `npm ci --cache .cache/npm --fetch-retries=0` installed 1,019 packages on Apple silicon. npm 12 blocked two optional install scripts. The host checks passed with the installed packages, and 53 optional entries still lack integrity metadata. Install JavaScript dependencies from the repository root to give Expo autolinking a single copy of React Native. The tracked `ios/Podfile.lock` records the native dependencies. Retain any lock changes written by a successful CocoaPods run. Native setup needs access to the CocoaPods CDN and prebuilt artifacts, plus GitHub and CMake if React Native falls back to building Hermes from source.

CocoaPods resolved and installed 102 pods in Round 6, and the installed manifest matches the tracked lockfile. For a restricted session without writable user caches, give CocoaPods a repository-local home and disable the duplicate download cache with `CP_HOME_DIR="$PWD/.cache/cocoapods-home" COCOAPODS_SKIP_CACHE=1 npm run build:ios:simulator`. Xcode exited 66 and reported that it could not open the workspace. CoreSimulator separately refused connections. Retry the build in an Xcode session that can open the workspace and reach CoreSimulator.

`npm run build:ios:simulator` runs CocoaPods and builds the Debug simulator workspace into `.cache/DerivedData`, with signing disabled. It exits on the first failure. For XCTest smoke coverage, boot an available iPhone simulator, then start Metro with `CI=1 npx expo start --dev-client --port 8081`. In a second terminal, set `JUMPLAB_SIMULATOR_UDID` to the booted simulator's actual UDID and run:

```sh
sh scripts/smoke-ios.sh
```

This installs locally to that simulator and runs the cold-launch and large-text dark-mode tests. It exits **2** if the Debug app executable is missing or unusable, or the selected simulator is unavailable or shut down. Each XCTest run replaces `.cache/LaunchSmoke.xcresult`, which contains the screenshot attachments. Stop Metro when finished. For the optional system-picker cancellation test, build against the disposable local backend and set the Xcode test-runner environment variables `TEST_RUNNER_JUMPLAB_UI_TEST_EMAIL` and `TEST_RUNNER_JUMPLAB_UI_TEST_PASSWORD` to a confirmed disposable test account. The picker test explicitly skips if those values are absent. CoreSimulator refused connections in Round 6, so launch and screenshot results remain outstanding.

## Checks

```sh
npm run typecheck
npm run lint
npm run test:unit
npm run test:native
npm run test:ui
npm run test:integration
npm run test:security
npm run check:database-types
npm run evaluate:video
npm run check:dependencies
npm run check:secrets
npm run check:docs
```

Unit tests use Node's TypeScript stripping and real SQLite transactions. Native tests compile the shared Swift detector and analyzer on macOS; these are not iPhone tests. UI tests use Jest/React Native Testing Library and mock native import/analysis; they prove UI behavior only. `lint` is a focused syntax/log-sink/polling check, not a full ESLint ruleset. Integration and security scripts use real HTTP clients against an explicitly disposable loopback Supabase; absent configuration exits **2**, not success. Evaluation with no real clips also exits **2**. `check:dependencies` uses npm's advisory service. Round 8 confirmed six moderate and two high production findings on the retained dependency tree after rejecting a CLI update that also upgraded native packages. See the [audit handoff](docs/IMPLEMENTATION.md#round-8-high-severity-audit-remediation). The limited secret pattern check covered source, history and the fresh iOS export. Runtime traffic, logs and the linked app still need inspection.

## Local iPhone installation

After clean dependencies and CocoaPods succeed, open `ios/JumpLab.xcworkspace` in Xcode. Select JumpLab, set your own unique bundle identifier and development team in Signing & Capabilities, connect/trust your iPhone, enable Developer Mode, select it as the run destination and build/run. Xcode manages your local provisioning profile; do not place signing secrets in this repo. A personal development team can be used subject to Apple's provisioning limits; do not purchase services for this task. Use a Release configuration with bundled JavaScript for offline device testing; a Debug app loading Metro cannot establish offline cold-launch behavior.

Test local original recordings for standing, running and repeated jumps; cancel analysis, background the app, restart a partly logged workout, exercise airplane mode, VoiceOver, accessibility text sizes and both appearances. Record the actual device model, iOS version, bundle version/build, installation method, clip characteristics and observed outcomes. No signing/device/footage evidence exists yet. Simulator or macOS tests cannot replace those checks.

## Official references

Use these official guides for setup and verification. On 2026-11-19, the Expo, Supabase and Apple documentation endpoints responded from the Mac. Verification of hosted settings and a full release review of the guidance are still pending. [Expo local modules](https://docs.expo.dev/modules/get-started/), [native development builds](https://docs.expo.dev/develop/development-builds/introduction/), [Supabase React Native Auth](https://supabase.com/docs/guides/auth/quickstarts/react-native), [native auth deep links](https://supabase.com/docs/guides/auth/native-mobile-deep-linking), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits), [Apple Vision](https://developer.apple.com/documentation/vision/vndetecthumanbodyposerequest), and [Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility).
