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

The setup key is privileged and used only in the Node test process to create/clean isolated users. Permission assertions use anonymous/A/B client tokens, not setup credentials. The app reads **only** `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The integration script refuses non-loopback or non-HTTP targets and missing explicit disposable acknowledgment. `test:security` currently runs the same backend suite, not an independent penetration test. SQL reset/bounded-storage checks supplement the client concurrency tests; privileged SQL assertions do not prove RLS.

## Schema and access

Public tables: profiles, jump_results, plans, prescriptions, workouts and adaptations. Each exposed table has RLS and a least-privilege authenticated SELECT policy with JWT ownership plus live-account checks. Anonymous users receive no table grants. Public clients have **no direct INSERT/UPDATE/DELETE grants**. No public views exist. Mutations use `save_record` and `delete_account`; both are security-definer functions with empty search paths, fully qualified relations and explicit grants. Private validators/limiter functions are not executable by public clients. There is no dynamic SQL. Ownership is assigned from `auth.uid()`; JSON `user_id` cannot change row ownership. FK references bind prescriptions/workouts/plans/adaptations to the same owner. Deleting auth.users cascades data and limiter state.

Canonical height/load/body-weight units are meters/kg, airtime seconds. The database validates types, ranges, event timing/formula, template IDs, set counts, references and uniqueness. A profile is unique per account, workouts unique per account/prescription, record UUIDs primary keys. Profile/workout edits use expected revision; stale divergent edits conflict (`40001`). Identical payload retries return the existing revision, including lost acknowledgments and concurrent requests. Measurements/plans are immutable; an updated plan receives new prescription IDs and preserves earlier history. Explicit workout corrections are allowed, but automatic adaptation writes a new plan only. Payload size is capped at 256 KiB.

Client fetches one bounded page per domain with only required columns, no per-session query loop: profile 1, others 100; local display is bounded to 500/domain. Current history intentionally retains a bounded recent page; there is no full archive pagination UI yet. Indexes cover owner/date and owner/plan relations. JSON prescription payloads keep the schema small, but generated types do not validate runtime JSON; SQL validators and TypeScript rules both matter.

Local record+pending writes commit in SQLite transactions. Repeated-jump results and profile/future-plan changes save as groups. Queue retries are explicit from Settings, ordered, bounded to 100 pending rows per drain, and stop on transient/auth failure. Conflict/error states preserve local data. Users can choose remote/local for editable profiles/workouts; immutable jump/plan conflicts cannot silently overwrite server data. Acknowledgments update revisions before queue removal; a crash between them causes a safe identical-payload retry. Account changes serialize with writes and erase prior private state. An expired session can continue cached work, but syncing requires the same account.

## Abuse controls and Auth configuration

The private limiter holds **one row per live account** and locks it for fixed UTC minute/day windows. Limit: 60 successful RPC mutations/minute and 1,000/day; successful idempotent retries count. The row lock also serializes account mutations. Rejected SQL transactions roll back counter changes, so this is not an IP/request-attempt throttle. Failed requests must additionally be bounded by gateway/Auth protections. Direct writes have no grant and cannot bypass the mutation limiter. `delete_account` also uses this limit; an exhausted account must wait for its quota window. No unbounded per-request records are created. The SQL test checks resets/day limits/storage/deletion; REST tests check concurrent accepted/rejected requests and alternate write routes.

`supabase/config.toml` declares signup/email confirmations, refresh-token rotation, 900-second access tokens, exact redirect allowlisting, one-email/minute per-user cooldown, two emails/hour, and Auth endpoint limits. **These local declarations do not prove hosted enforcement.** For a real project, inspect current Supabase Auth limits and SMTP settings; enable supported bot/CAPTCHA controls for public signup/recovery as appropriate, verify password minimum at the server (the app uses 12 characters), confirm reverse-proxy/gateway request limits and run real quota tests, including concurrent/reset/alternate routes. CAPTCHA UI/integration and hosted enforcement are not delivered/verified here. No standalone paid limiting service is required or provisioned. Operational abuse protection remains blocked until actual configuration can be inspected/tested.

Auth uses PKCE, exact `jumplab://auth/callback` allowlisting, Keychain storage and foreground/background token-refresh lifecycle. Links must have the exact scheme/host/path, one bounded code parameter, no userinfo/port/fragment/other query parameters; access tokens in fragments are rejected. Signup confirmation and recovery should be opened on the same iPhone that started PKCE. Custom URL schemes cannot prove exclusive app ownership; PKCE protects code redemption, and universal links would require a controlled domain/association before adding them. Current official guidance must be rechecked when accessible. Cold-start, expired/revoked tokens, email delivery/recovery and remote session invalidation still require real Auth/device testing.
