# Minimal Supabase backend

No project has been deployed or configured by this implementation. Use an explicitly disposable local Supabase with Docker and a supported Supabase CLI for verification. Those tools/services/credentials were unavailable here.

```sh
supabase start
supabase db reset
supabase gen types typescript --local > .cache/database.generated.ts
# Compare the generated schema contract with src/data/database.types.ts.
# The current types are handwritten/schema-derived, not verified generated output.
# Set JUMPLAB_TEST_DATABASE_URL from the disposable local CLI status, then:
psql "$JUMPLAB_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/limits.sql
```

Read the actual local CLI status before setting the SQL connection variable. Create `.cache` first if needed. Never point these tests at an unidentified hosted database. The migration is versioned in `supabase/migrations/202611170001_jumplab.sql`. Inspect reset output and compare generated types; do not claim schema/type parity from TypeScript compilation alone. A separate real-client test suite requires:

```sh
export JUMPLAB_TEST_DISPOSABLE=YES
export JUMPLAB_TEST_URL=http://127.0.0.1:54321
# Obtain these only from your disposable local CLI status; never commit values:
export JUMPLAB_TEST_PUBLIC_KEY=LOCAL_TEST_PUBLIC_KEY
export JUMPLAB_TEST_SETUP_KEY=LOCAL_TEST_SETUP_KEY
npm run test:integration
npm run test:security
```

The setup key is privileged and used only in the Node test process to create/clean isolated users and inventory the exposed local schema. Permission assertions use anonymous/A/B client tokens, not setup credentials. The app reads **only** `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The integration script refuses non-loopback or non-HTTP targets and missing explicit disposable acknowledgment. `test:security` runs the same real-client database assertions plus local email signup/recovery quota checks. Use a fresh local Auth rate-limit window and the configured Inbucket email capture. SQL reset/bounded-storage checks supplement the client concurrency tests; privileged SQL assertions do not prove RLS.

## Schema and access

Public tables: profiles, jump_results, plans, prescriptions, workouts and adaptations. Each exposed table has RLS and a least-privilege authenticated SELECT policy with JWT ownership plus live-account checks. Anonymous users receive no table grants. Public clients have **no direct INSERT/UPDATE/DELETE grants**. No public views exist. Mutations use `save_record` and `delete_account`; both are security-definer functions with empty search paths, fully qualified relations and explicit grants. Private validators/limiter functions are not executable by public clients. There is no dynamic SQL. Ownership is assigned from `auth.uid()`; JSON `user_id` cannot change row ownership. FK references bind prescriptions/workouts/plans/adaptations to the same owner. Deleting auth.users cascades data and limiter state.

Canonical height/load/body-weight units are meters/kg, airtime seconds. The database validates types, ranges, event timing/formula, template IDs, set counts, references and uniqueness. A profile is unique per account, workouts unique per account/prescription, record UUIDs primary keys. Profile/workout edits use expected revision; stale divergent edits conflict (`40001`). Identical payload retries return the existing revision, including lost acknowledgments and concurrent requests. Measurements/plans are immutable; an updated plan receives new prescription IDs and preserves earlier history. Explicit workout corrections are allowed, but automatic adaptation writes a new plan only. Payload size is capped at 256 KiB.

The account profile is fetched before onboarding if the cache has no profile. A connection failure preserves an explicit unknown state. New profiles use the account UUID as the record ID, and conflicts for existing profiles resolve against the account's canonical row. Remote jump hydration pages over the 90-day ingestion window. The chart filters by analysis date, jump type and method and omits full timestamps from its SQLite projection. Plans and workouts have one bounded recent page each. When a workout refers to an older plan, the app can request the selected prescription by ID. Indexes cover owner/date and owner/plan relations. There is no full workout archive UI.

Local record and pending changes commit in one SQLite transaction. Repeated results and profile/plan updates save as groups. Settings offers explicit retry. Each action selects up to 60 sendable writes so conflicts and errors cannot block the queue. A retry stops on transient, quota or authentication errors. The RPC returns either a revision or a stable SQL error code. Conflicts preserve local data until the user chooses a version. Measurement and plan conflicts cannot overwrite the server version. A crash after updating a revision and before removing its queue entry causes an identical-payload retry. Each dispatch uses the bearer captured for the verified owner. An account change invalidates the dispatch and its acknowledgment for local purposes. An already-dispatched request can complete under its original identity. Account changes erase prior private state.

## Abuse controls and Auth configuration

The private limiter locks one row per live account, samples the clock after acquiring the lock, and advances fixed UTC minute and day windows monotonically. The quota is 60 admitted mutation attempts per minute and 1,000 per day. Idempotent retries and application validation or conflict errors consume quota. Requests rejected before RPC entry and unexpected transaction failures need gateway controls. Both mutation RPCs use the limiter for active accounts, and direct writes have no grant. The isolated SQL test covers resets, monotonicity, limits, storage and account deletion. The real-client suite covers concurrent invalid attempts, authorization, idempotency and post-deletion access.

`supabase/config.toml` declares signup/email confirmations, refresh-token rotation, 900-second access tokens, exact redirect allowlisting, one-email/minute per-user cooldown, two emails/hour, and Auth endpoint limits. **These local declarations do not prove hosted enforcement.** For a real project, inspect current Supabase Auth limits and SMTP settings; enable supported bot/CAPTCHA controls for public signup/recovery as appropriate, verify password minimum at the server (the app uses 12 characters), confirm reverse-proxy/gateway request limits and run real quota tests, including concurrent/reset/alternate routes. CAPTCHA UI/integration and hosted enforcement are not delivered/verified here. No standalone paid limiting service is required or provisioned. Operational abuse protection remains blocked until actual configuration can be inspected/tested.

Auth uses PKCE, exact `jumplab://auth/callback` allowlisting, Keychain storage and foreground/background token-refresh lifecycle. Links must have the exact scheme/host/path, one bounded code parameter, no userinfo/port/fragment/other query parameters; access tokens in fragments are rejected. Signup confirmation and recovery should be opened on the same iPhone that started PKCE. Custom URL schemes cannot prove exclusive app ownership; PKCE protects code redemption, and universal links would require a controlled domain/association before adding them. Current official guidance must be rechecked when accessible. Cold-start, expired/revoked tokens, email delivery/recovery and remote session invalidation still require real Auth/device testing.
