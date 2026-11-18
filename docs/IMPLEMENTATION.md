# Sol implementation handoff

Updated 2026-11-18 after Astra requested changes. The work is in the current isolated checkout, based on the implementation Astra reviewed. Astra retains independent verification and approval. No workflow records, launcher settings, review outputs, or requirements were edited.

## Executed checks

| Check | Observed result |
| --- | --- |
| Fresh Apple-silicon install in an empty workspace directory using the current lock and `npm ci --offline --cache ../npm --no-audit --no-fund` | Exit 0. Installed 1,019 packages. npm blocked two optional install scripts and used available packaged binaries. |
| `npm run typecheck` and `npm run lint` | Exit 0. |
| `npm run test:unit` | Exit 0. 36 passed, including SQLite disk restart, casing upgrade and stale acknowledgement tests. |
| `npm run test:ui` | Exit 0. 22 passed. Includes mocked app flows and production store code with host SQLite and a stalled mock request. |
| `npm run test:native` | Exit 0 on macOS. Synthetic transition, edit-list and camera-stability checks plus media rejection and cleanup checks. |
| Swift standalone engine typecheck with `-target arm64-apple-ios16.4-simulator` and the simulator SDK | Exit 0 with a workspace-local temporary directory. Covers the analyzer and detector source. The Expo bridge and linked app require the full native build. |
| `npm run check:docs` and `git diff --check` | Exit 0. |
| iOS JavaScript export and `npm run check:secrets -- .cache/ios-export-sol` | Export exit 0 with 719 modules. Pattern scan exit 0 with zero matches across source, two exported assets and reachable Git patches. |
| `npm run build:ios:simulator` | Exit 1 at CocoaPods. Hermes retrieval could not resolve github.com and the source fallback requires absent CMake. No resolved Podfile.lock, simulator app or launch result. The CoreSimulator device query separately failed with service connection refused. |
| `npm run check:dependencies -- --cache .cache/npm --fetch-retries=0 --fetch-timeout=10000` | Exit 1. The registry advisory endpoint could not resolve. Cached install success establishes dependency resolution for this host. Advisory status remains unknown and 53 optional platform entries need upstream integrity metadata. The local npm cache had no registry keys for those entries. |
| Official Apple Vision and Supabase Auth documentation requests | Both exited 6 due to DNS. Current live guidance remains open. |
| `npm run test:integration` and `npm run test:security` | Each exit 2. No disposable loopback Supabase, CLI/Docker/psql, or test credentials were available. No real client authorization or rate-limit assertions ran. |
| `npm run evaluate:video` | Exit 2. Zero consented annotated athlete clips. Error rates, latency, memory, and thermal observations are unavailable. |

Host toolchain and exact setup commands are in [README](../README.md). The real-video and profiler protocols are in [Measurement](MEASUREMENT.md). Backend setup, configuration, and real-client checks are in [Backend](BACKEND.md).

## Acceptance evidence

**Local pass** identifies a completed check within the available host scope. **Failed** records an executed failing check. **Blocked** names an unavailable external prerequisite. **Unverified** identifies evidence still needed before independent acceptance. There is no device validation or measured real-video accuracy in this handoff.

| ID | Status | Evidence and remaining verification |
| --- | --- | --- |
| JL-001 | Blocked | Pinned React Native/TypeScript and Expo native module, iOS project, and Supabase sources. Fresh cached npm install and typecheck pass. Native dependency retrieval, CocoaPods lock and simulator link require a network-enabled macOS host with CMake. |
| JL-002 | Local pass | Sol's handoff responds to Astra's findings through the existing workflow. Independent review remains with Astra. |
| JL-003 | Unverified | Production path runs PHPicker, AVAssetReader, Vision, contact transitions and timestamp-based estimates. Supply original athlete footage and trace accepted events. Feasibility-first milestone ordering remains unproven. |
| JL-004 | Local pass | Native platform inference and scoped metadata writes. New events retain compact provenance and chart hydration uses a projected view. Inspect applied view and real traffic after backend setup. |
| JL-005 | Unverified | Guidance, picker/cancel, three jump modes and FPS confirmation exercise component paths. Run the system picker and automation with a signed build and disposable account. |
| JL-006 | Local pass | Native same-speed source cut, target gap, retiming and nonzero-origin segment tests. TS tests cover original CFR/VFR and verified mappings. Unsupported native mappings reject. Real timing variants remain open. |
| JL-007 | Unverified | Native synthetic running contact, actual repeated-mode paths, ordered jumps, trailing partial, noise and track loss pass. Validate against footage of all three movement types and athlete changes. |
| JL-008 | Unverified | Native transient pose failures and camera instability reject in synthetic tests. All estimates remain experimental and excluded from training. Record real false-rejection/false-acceptance outcomes and retry behavior. |
| JL-009 | Local pass | Known airtime, invalid inputs, boundary and SI unit tests. Result labels and posture assumptions are in Analyze and Measurement. |
| JL-010 | Local pass | Compact provenance, range/rounding, summary and compatibility tests. UUID replay/ack/hydration/restart yields one chart record. Inspect rendered chart and server persistence in the installed app. |
| JL-011 | Blocked | Schema-aligned fixture validator, matcher and production native evaluator. Zero real clips and exit 2. Supply recordings, annotations and reference uncertainty. |
| JL-012 | Unverified | Native detached incremental decode, resource limits and per-frame release. Cancellation flag and failure cleanup tested on macOS. Run on iPhone and capture network during repeated runs and interruption. |
| JL-013 | Unverified | Profile UI and validation tests exercise budget, equipment, units and optional inputs. Verify persisted profile edits and regeneration on iOS with Supabase. |
| JL-014 | Local pass | Reproducible versioned plans with complete exercise prescriptions in training tests. |
| JL-015 | Local pass | Scenario tests vary constraints. App regression opens and logs Wednesday after the prescribed Monday workout. Applied-backend checks remain separate. |
| JL-016 | Local pass | Adaptation boundaries and actual second-session eligibility pass locally. Current sessions follow prescribed days. Replacement plans retain their conservative recovery floor. |
| JL-017 | Unverified | Pain/fatigue guard, completed-history immutability and rule tests pass. Verify the explanation persisted with the future plan on a live backend. |
| JL-018 | Local pass | Production SQLite transaction/reopen and immutable analysis receipt tests. Component logging saves the prescribed workout. iOS termination and reopening remain unverified. |
| JL-019 | Unverified | Terminal auth loss preserves locked pending work. Mocked session and real host SQLite tests cover isolation, disk restart, stalled refresh and queue edit handling. Verify offline iOS session restoration and reconnection. |
| JL-020 | Unverified | Client uses account-bound dispatch and revision-aware acknowledgements. Host tests cover canonical IDs, lost-ack retry state, stale data and confirmed account replacement. Run concurrent real RPCs and installed-app account switching. |
| JL-021 | Unverified | Native missing/corrupt/oversized local input tests and cleanup pass on macOS. Verify provider references, interruptions and cleanup/reopen on iOS. |
| JL-022 | Blocked | Two migrations, projected chart view, checked-in schema-derived contract and client inventory test. Run local database reset, generated type comparison, constraint tests and query inspection. |
| JL-023 | Unverified | Keychain, PKCE parser, Auth lifecycle, offline identity binding and deletion recovery paths. Run real signup/recovery, token revocation, foreground/background and callback flows on the installed app. |
| JL-024 | Blocked | Table RLS plus security-invoker chart view. Apply migrations and execute the real anonymous/A/B matrix including direct view writes. |
| JL-025 | Blocked | Trusted timestamp validation and malformed timestamp RPC cases added. Limited source, history and JS asset secret scan passed. Apply SQL and inspect final linked app and live validation outcomes. |
| JL-026 | Blocked | Existing trusted quota limiter and local Auth settings. Run disposable SQL/client boundary and concurrency suites. Hosted configuration remains unverified. |
| JL-027 | Blocked | Cascading schema, scoped local erase and pending deletion switch regression. Live suite includes residual row cleanup inventory, old-token retry and refresh rejection. Run with disposable Auth and verify device restart. |
| JL-028 | Unverified | Privacy/retention docs, no content logs in app source and limited pattern scan. Capture seeded flows and verify provider retention against actual project settings. |
| JL-029 | Unverified | App shows data-bound Today, Analyze, Progress and Settings. Scheduling and chart duplicate fixes tested. Inspect rendered simulator screens against Apple HIG. |
| JL-030 | Unverified | Component light/dark contrast, roles, scalable text and target-size tests pass. Render at accessibility text sizes and inspect physical VoiceOver behavior. |
| JL-031 | Unverified | Mocked UI exercises failed analysis, menu recovery, terminal auth loss, A/B isolation and pending deletion sign-out. Verify actual interruption and retry behavior on iOS. |
| JL-032 | Unverified | Network waits are outside the local save lock and stalled refresh regression passed. Production analysis has an Instruments signpost and host telemetry fields. No measured clip latency, memory or device responsiveness. |
| JL-033 | Local pass | Host unit, native and UI/store suites ran. The backend and real-video commands surfaced missing prerequisites with exit 2. |
| JL-034 | Failed | Fresh cached install passed. CocoaPods exited 1 before Xcode build. Complete native install with network/CMake, retain Podfile.lock and run simulator build and smoke on a host with CoreSimulator access. |
| JL-035 | Failed | Setup/docs and scoped pattern scan passed. Dependency audit failed registry DNS. Restore registry access, recover optional integrity metadata, rerun audit and complete the native setup and binary checks. |
| JL-036 | Blocked | A provisioned physical iPhone, signing permission and suitable recorded jumps are needed. Follow README installation and record model, iOS, build, recordings and observed behavior. |
| JL-037 | Blocked | Requires the same physical iPhone and consented clips plus Instruments. Record repeated run latency, peak memory, responsiveness, failures, interruptions and thermal behavior. |
| JL-038 | Local pass | This handoff maps all IDs to observed local evidence and open verification. Astra must independently reconcile the changes and evidence. |
