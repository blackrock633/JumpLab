# Sol implementation handoff

Updated 2026-11-18 in the isolated implementation checkout following Astra’s review of `a5b903c`. This report records implementation evidence for Astra’s independent verification.

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
| JL-015 | Unverified | Personalization scenarios pass on the host. The linked migration binds plans to accepted profile revisions and checks key constraints. Apply the migration and run the two-client incompatible-plan tests. |
| JL-016 | Local pass | Adaptation boundaries and final-day rollover pass in host tests. Today retains unstarted or partially completed final-day work. Missing sessions are left on their original dates. Real jump trends are excluded pending validation. |
| JL-017 | Unverified | Pain and fatigue guards and completed-history immutability pass locally. Today can display the saved reason. Verify persisted adaptation reason and rule version on an applied backend. |
| JL-018 | Unverified | SQLite restart tests and prescribed logging assertions pass on the host. Today retains final-day access. Process termination during logging and result saving remains untested on iOS. |
| JL-019 | Unverified | Host tests exercise cached plan loading, SQLite restart, paired publication, conflict, and held dependent workout writes. Offline cold launch and reconnection require an installed iOS app and local backend. |
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
| JL-031 | Unverified | Mocked UI and real host SQLite cover failure before erase intent, interrupted receipt and Auth cleanup, retry, and account switching. Test iOS interruption and recovery. |
| JL-032 | Unverified | Bounded compact chart reads and production analysis signposts are in source. No latency, memory, responsiveness or thermal observations were recorded. |
| JL-033 | Blocked | Host unit, native and UI/store checks passed, including dependent writes and sign-out interruptions. Real database security and persistence assertions require a disposable backend. |
| JL-034 | Failed | Fresh cached install passed. CocoaPods exited 1 before Xcode build. Complete native install with network/CMake, retain Podfile.lock and run simulator build and smoke on a host with CoreSimulator access. |
| JL-035 | Failed | Setup/docs and scoped pattern scan passed. Dependency audit failed registry DNS. Restore registry access, recover optional integrity metadata, rerun audit and complete the native setup and binary checks. |
| JL-036 | Blocked | CoreDeviceService timed out, and a signed app, provisioned iPhone and suitable recordings were unavailable. Install the bundled app on the target device and record picker, offline, interruption, persistence and VoiceOver outcomes. |
| JL-037 | Blocked | A signed build, identified iPhone, consented clips and Instruments are required. Record latency, peak memory, responsiveness, failures and thermal state across repeated runs. |
| JL-038 | Local pass | This handoff maps every criterion to host checks, missing measurements or the next verification step. Independent reconciliation remains with Astra. |
