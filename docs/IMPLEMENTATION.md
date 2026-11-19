# JumpLab implementation handoff

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

## Round 4 implementation handoff

Updated 2026-11-18 in the isolated implementation checkout following Astra’s review of `a5b903c`. The historical checks below were not carried forward as round 5 passes.

## Executed checks

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

## Acceptance evidence

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
