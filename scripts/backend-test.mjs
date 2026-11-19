import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { adapt, generate } from '../src/core/training.ts';
import { measurement } from '../src/core/measurement.ts';
import { comfortableWorkouts, feasibleProfiles, infeasibleProfiles } from '../tests/fixtures/profiles.ts';
const base = process.env.JUMPLAB_TEST_URL;
const key = process.env.JUMPLAB_TEST_PUBLIC_KEY;
const setupKey = process.env.JUMPLAB_TEST_SETUP_KEY;
if (process.env.JUMPLAB_TEST_DISPOSABLE !== 'YES' || !base || !key || !setupKey) {
  console.error('BLOCKED: start a disposable local Supabase, apply migrations, and set JUMPLAB_TEST_DISPOSABLE=YES, JUMPLAB_TEST_URL, JUMPLAB_TEST_PUBLIC_KEY, JUMPLAB_TEST_SETUP_KEY. No permissions were asserted.'); process.exit(2);
}
const u = new URL(base);
if (!['127.0.0.1', 'localhost'].includes(u.hostname) || u.protocol !== 'http:') throw Error('Tests only mutate an explicitly disposable loopback backend.');
async function request(path, token, method = 'GET', body, privilegedSetup = false) {
  const res = await fetch(`${base}${path}`, { method, headers: { apikey: privilegedSetup ? setupKey : key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const text = await res.text(); let data; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: res.status, ok: res.ok, data };
}
async function rpc(token, kind, id, payload, revision = 0) {
  const response = await request('/rest/v1/rpc/save_record', token, 'POST', { kind, record_id: id, expected_revision: revision, payload });
  if (!response.ok) return response;
  return response.data?.code ? { ...response, ok: false } : { ...response, data: response.data?.revision };
}
const created = [];
let assertions = 0;
function check(value, name) { assert.ok(value, name); assertions++; console.log(`PASS ${name}`); }
const profile = { goal: 'standing', experience: 'new', days: [1, 3], practiceDays: [], startHour: 17, weeklyMinutes: 60, sessionMinutes: 30, equipment: 'none', weightKg: 70, displayUnits: 'kg', knownSquatKg: null, limitation: 'none', pain: false, startDate: '2026-11-16' };
function buildPlan(plan, profileRevision, changeReason = 'Isolated test fixture') {
  return { ...plan, profileRevision, changeReason, sessions: plan.sessions.map(s => ({
    ...s, prescriptionId: randomUUID(), workoutId: randomUUID(),
  })) };
}
try {
  async function account() {
    const email = `jumplab-${randomUUID()}@example.test`, password = `${randomUUID()}Aa9!`;
    const setup = await request('/auth/v1/admin/users', setupKey, 'POST', { email, password, email_confirm: true }, true);
    if (!setup.ok || !setup.data?.id) throw Error('Test-account setup failed (details withheld to avoid credentials in logs).');
    created.push(setup.data.id);
    async function signIn() {
      const login = await request('/auth/v1/token?grant_type=password', key, 'POST', { email, password });
      check(login.ok && login.data?.access_token, 'real client login');
      return { token: login.data.access_token, refresh: login.data.refresh_token };
    }
    return { id: setup.data.id, email, signIn, ...await signIn() };
  }
  const a = await account(), b = await account();
  // The setup credential inventories the running PostgREST schema only. All
  // subsequent permission checks use anonymous or normal user credentials.
  const discovery = await request('/rest/v1/', setupKey, 'GET', undefined, true);
  const paths = Object.keys(discovery.data?.paths ?? {});
  const tables = paths.filter(path => /^\/[a-z_]+$/.test(path)).map(path => path.slice(1)).sort();
  check(discovery.ok && JSON.stringify(tables) === JSON.stringify(['adaptations','jump_history','jump_results','plans','prescriptions','profiles','workouts']), 'applied exposed relations match the security inventory');
  check(JSON.stringify(paths.filter(path => path.startsWith('/rpc/')).sort()) === JSON.stringify(['/rpc/active_account','/rpc/delete_account','/rpc/save_record']), 'applied exposed RPCs match the security inventory');
  const pId = a.id;
  check((await rpc(a.token, 'profile', b.id, profile)).data === 1, 'forged profile key is disregarded on first publication');
  const forged = { ...profile, weightKg: 71, user_id: b.id };
  check((await rpc(a.token, 'profile', pId, forged, 1)).data === 2, 'forged JSON owner disregarded');
  const owned = await request('/rest/v1/profiles?select=id,user_id,revision,data', a.token);
  check(owned.ok && owned.data.length === 1 && owned.data[0].user_id === a.id && owned.data[0].id === a.id, 'ownership derives from JWT');
  const duplicate = await Promise.all(Array.from({ length: 8 }, () => rpc(a.token, 'profile', pId, forged, 1)));
  check(duplicate.every(r => r.ok && r.data === 2), 'concurrent lost-ack retries are idempotent');
  check(!(await rpc(a.token, 'profile', pId, { ...profile, weightKg: 75 }, 0)).ok, 'stale edits conflict');
  for (const payload of [{ ...profile, weightKg: -1 }, { ...profile, weightKg: null }, { ...profile, days: [8] }, { ...profile, pain: null }, { ...profile, knownSquatKg: -1 }]) {
    const invalid = await rpc(b.token, 'profile', randomUUID(), payload);
    check(!invalid.ok && ['22023', '23514'].includes(invalid.data?.code), 'malformed profile rejected at validation boundary');
  }
  check(!(await rpc(a.token, 'workout', randomUUID(), { prescriptionId: randomUUID(), sets: [] })).ok, 'unprescribed workout rejected');
  check(!(await rpc(key, 'profile', randomUUID(), profile)).ok, 'anonymous RPC denied');
  check((await rpc(b.token, 'profile', b.id, profile)).data === 1, 'real owner can still create its first profile revision after the forged key');
  const savedB = await request('/rest/v1/profiles?select=id,user_id', b.token);
  check(savedB.ok && savedB.data.length === 1 && savedB.data[0].id === b.id, 'B retains its canonical profile key');
  const change = { ...profile, equipment: 'none', limitation: 'no-impact' };
  const acceptedPlan = { id: randomUUID(), payload: buildPlan(generate(change)) };
  const pair = { profile: change, replacement: acceptedPlan };
  const secondClient = await a.signIn();
  check((await rpc(a.token, 'profile_plan', pId, pair, 2)).data === 3, 'publish profile and its replacement plan atomically');
  const pairRetries = await Promise.all(Array.from({ length: 3 }, () => rpc(a.token, 'profile_plan', pId, pair, 2)));
  check(pairRetries.every(result => result.ok && result.data === 3), 'concurrent retries of an atomic publication reuse its revision');
  const stale = { ...profile, equipment: 'barbell' };
  const stalePlan = { id: randomUUID(), payload: buildPlan(generate(stale), 3) };
  const conflict = await rpc(secondClient.token, 'profile_plan', pId, { profile: stale, replacement: stalePlan }, 2);
  check(!conflict.ok && conflict.data?.code === '40001', 'the second client’s stale profile and replacement plan conflict');
  const independentlyStale = await rpc(a.token, 'plan', stalePlan.id, { ...stalePlan.payload, profileRevision: 2 });
  check(!independentlyStale.ok && independentlyStale.data?.code === '40001', 'an older profile revision cannot publish a standalone plan');
  const forgedBasis = await rpc(a.token, 'plan', stalePlan.id, stalePlan.payload);
  check(!forgedBasis.ok && forgedBasis.data?.code === '22023', 'an incompatible plan is rejected even with the current profile revision');
  const invalidPair = await rpc(a.token, 'profile_plan', pId, {
    profile: stale, replacement: { id: randomUUID(), payload: { ...stalePlan.payload, sessions: [] } },
  }, 3);
  check(!invalidPair.ok && invalidPair.data?.code === '22023', 'an invalid replacement rolls back the profile update');
  const [keptProfile, keptPlans] = await Promise.all([
    request('/rest/v1/profiles?select=id,revision,data', a.token),
    request('/rest/v1/plans?select=id,data', a.token),
  ]);
  check(keptProfile.ok && keptProfile.data[0].revision === 3 && keptProfile.data[0].data.limitation === 'no-impact',
    'failed proposals leave the accepted profile intact');
  check(keptPlans.ok && keptPlans.data.length === 1 && keptPlans.data[0].id === acceptedPlan.id &&
    keptPlans.data[0].data.profileRevision === 3 && keptPlans.data[0].data.sessions.every(s => s.exercises.every(e => e.id !== 'jump')),
    'the saved plan stays linked to the accepted equipment and impact constraints');
  async function seedAll(token, answers, profileRevision) {
    const planId = randomUUID(), plan = buildPlan(generate(answers), profileRevision);
    check((await rpc(token, 'plan', planId, plan)).ok, 'populate plan, prescriptions and adaptation');
    for (const invalid of [
      { ...plan.sessions[0], scheduledOn: '2026-02-31' },
      { ...plan.sessions[0], exercises: plan.sessions[0].exercises.map(e => ({ ...e, baseSets: 1e6 })) },
    ]) {
      const bad = await rpc(token, 'plan', randomUUID(), { ...plan, sessions: [invalid] });
      check(!bad.ok && ['22023', '22008'].includes(bad.data?.code), 'malformed nested plan rejected');
    }
    const s = plan.sessions[0];
    const workout = { prescriptionId: s.prescriptionId, completed: true, effort: 5, pain: false, recovery: 'good', completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sets: s.exercises.flatMap(e => Array.from({ length: e.sets }, (_, index) => ({ exerciseId: e.id, index, reps: e.reps, loadKg: e.loadKg, done: true }))) };
    check((await rpc(token, 'workout', s.workoutId, workout)).ok, 'populate prescribed workout');
    const timestamps = Array.from({ length: 90 }, (_, i) => i / 60), id = randomUUID();
    const jump = measurement(id, 'standing', { takeoff: [timestamps[30], timestamps[31]], landing: [timestamps[54], timestamps[55]] }, { originalFPS: 60, playbackFPS: 60, kind: 'original', confirmedOriginal: true, mappings: [], timestamps }, new Date().toISOString());
    check((await rpc(token, 'jump', id, jump)).ok, 'populate experimental jump (synthetic backend fixture only)');
    const duplicate = await Promise.all([
      ...Array.from({ length: 4 }, () => rpc(token, 'workout', s.workoutId, workout)),
      ...Array.from({ length: 4 }, () => rpc(token, 'jump', id, jump)),
    ]);
    check(duplicate.every(r => r.ok && r.data === 1), 'concurrent workout and jump replays preserve revision and identity');
    const badJump = await rpc(token, 'jump', id, { ...jump, trainingEligible: true });
    check(!badJump.ok && badJump.data?.code === '22023', 'forged training eligibility rejected');
    for (const createdAt of ['not a timestamp', 'infinity', '2026-02-31T12:00:00Z', '2999-01-01T00:00:00Z']) {
      const bad = await rpc(token, 'jump', id, { ...jump, createdAt });
      check(!bad.ok && bad.data?.code === '22023', 'unusable analysis timestamp rejected before idempotency check');
    }
    for (const [label, fields] of [
      ['infinity', { updatedAt: 'infinity' }],
      ['negative infinity', { completedAt: '-infinity' }],
      ['impossible date', { updatedAt: '2026-02-30T12:00:00Z' }],
      ['day outside month', { updatedAt: '2026-02-31T12:00:00Z' }],
      ['non-UTC offset', { updatedAt: '2026-11-18T12:00:00+01:00' }],
      ['loose format', { updatedAt: '2026-11-18 12:00:00Z' }],
      ['before 2000', { completedAt: '1999-12-31T23:59:59.999Z' }],
      ['old date', { completedAt: '1900-01-01T00:00:00Z' }],
      ['over a day in the future', { updatedAt: new Date(Date.now() + 2 * 86400000).toISOString() }],
      ['completed with null', { completedAt: null }],
      ['completed with a number', { completedAt: 10 }],
      ['incomplete with a number', { completed: false, completedAt: 10 }],
      ['incomplete with a string', { completed: false, completedAt: workout.completedAt }],
    ]) {
      const bad = await rpc(token, 'workout', s.workoutId, { ...workout, ...fields }, 1);
      check(!bad.ok && bad.data?.code === '22023', `reject workout timestamp: ${label}`);
    }
    const incomplete = { ...workout, completed: false, completedAt: null };
    check((await rpc(token, 'workout', s.workoutId, incomplete, 1)).data === 2, 'incomplete workout accepts an explicit null completion timestamp');
    const badWorkout = await rpc(token, 'workout', s.workoutId, { ...workout, sets: [{ exerciseId: 'outside', index: 0, reps: 1, loadKg: null, done: true }] });
    check(!badWorkout.ok && badWorkout.data?.code === '22023', 'unrelated exercise rejected');
    return { plan, jump, workout, planId };
  }
  const aData = await seedAll(a.token, change, 3);
  await seedAll(b.token, profile, 1);
  const painOnly = { profile: { ...change, pain: true }, replacement: null };
  check((await rpc(secondClient.token, 'profile_plan', pId, painOnly, 3)).data === 4, 'publish a pain pause without creating a replacement plan');
  check((await rpc(secondClient.token, 'profile_plan', pId, painOnly, 3)).data === 4, 'retry a pain-only publication after a lost acknowledgement');
  const [pausedProfile, plansAfterPause] = await Promise.all([
    request('/rest/v1/profiles?select=revision,data', a.token),
    request('/rest/v1/plans?select=id', a.token),
  ]);
  check(pausedProfile.ok && pausedProfile.data[0].revision === 4 && pausedProfile.data[0].data.pain === true &&
    pausedProfile.data[0].data.planBinding === true && !Object.hasOwn(pausedProfile.data[0].data, 'replacementPlanId'),
    'pain-only publication persists the pause and clears the replacement binding');
  check(plansAfterPause.ok && plansAfterPause.data.length === 2, 'pain-only publication leaves existing plans and adds none');
  const forgedWorkout = await rpc(b.token, 'workout', aData.plan.sessions[0].workoutId, aData.workout);
  check(!forgedWorkout.ok && forgedWorkout.data?.code === '22023', 'cross-account prescription rejected by the mutation RPC');
  check(!(await rpc(b.token, 'jump', aData.jump.id, aData.jump)).ok, 'cross-account duplicate measurement rejected');
  for (const table of tables) {
    const ownRows = await request(`/rest/v1/${table}?select=*&limit=10`, a.token);
    check(ownRows.ok && ownRows.data.length > 0 && ownRows.data.every(r => r.user_id === a.id), `${table}: populated owned read allowed`);
    for (const identity of [key, b.token]) {
      const select = await request(`/rest/v1/${table}?select=id,user_id&user_id=eq.${a.id}&limit=10`, identity);
      check(identity === key ? [401, 403].includes(select.status) : select.ok && Array.isArray(select.data) && select.data.length === 0, `${table}: anonymous/cross-account select denied`);
    }
    for (const identity of [key, a.token, b.token]) {
      for (const method of ['POST', 'PATCH', 'DELETE']) {
        const suffix = method === 'POST' ? '' : `?user_id=eq.${a.id}`;
        const { created_at: _created, updated_at: _updated, ...sample } = ownRows.data[0];
        const body = method === 'POST' ? { ...sample, id: randomUUID(), user_id: a.id } : method === 'PATCH' ? { user_id: b.id } : undefined;
        const result = await request(`/rest/v1/${table}${suffix}`, identity, method, body);
        check([401, 403].includes(result.status), `${table}: direct ${method} denied for public clients`);
      }
    }
  }
  for (const functionName of ['limit_write', 'typed_fields', 'valid_jump', 'valid_workout_timestamp', 'check_plan_profile', 'write_record', 'write_record_legacy']) check(!(await request(`/rest/v1/rpc/${functionName}`, a.token, 'POST', {})).ok, `private function ${functionName} unavailable`);
  for (const answers of infeasibleProfiles) assert.throws(() => generate(answers), 'infeasible scenario produces no plan to publish');
  const parity = await account();
  let profileRevision = 0;
  for (const [name, answers] of Object.entries(feasibleProfiles)) {
    const generated = generate(answers);
    const published = await rpc(parity.token, 'profile_plan', parity.id, {
      profile: answers, replacement: { id: randomUUID(), payload: buildPlan(generated) },
    }, profileRevision);
    check(published.ok && published.data === profileRevision + 1, `${name}: generated plan accepted with its profile`);
    profileRevision = published.data;
    let prior = generated;
    for (const [variant, feedback, reason] of [
      ['hold', [], /^Hold:/],
      ['increase', comfortableWorkouts, /^Three comfortable/],
      ['deload', [], /^Planned deload:/],
    ]) {
      const next = adapt(prior, feedback, null);
      assert.match(next.reason, reason, `${name}: adaptation exercises the ${variant} rule`);
      const payload = buildPlan(next.plan, profileRevision, next.reason);
      if (variant === 'increase') assert.deepEqual(payload.usedObservationIds, feedback.map(o => o.id));
      const planId = randomUUID();
      const rollover = await rpc(parity.token, 'plan', planId, payload);
      check(rollover.ok && rollover.data === 1, `${name}: ${variant} rollover accepted for the saved profile revision`);
      prior = next.plan;
      if (name === 'progression' && variant === 'deload') {
        const updated = { ...answers, weightKg: 71 };
        check((await rpc(parity.token, 'profile_plan', parity.id, {
          profile: updated, replacement: { id: randomUUID(), payload: buildPlan(generate(updated)) },
        }, profileRevision)).data === profileRevision + 1, 'publish a newer profile before retrying the old rollover');
        profileRevision++;
        check((await rpc(parity.token, 'plan', planId, payload)).data === 1, 'exact rollover replay survives a newer profile revision');
      }
    }
  }

  for (const [label, answers, tamper] of [
    ['practice-adjacent date', { ...feasibleProfiles.practice, days: [0, 1, 3, 5] }, plan => {
      Object.assign(plan.sessions[0], { day: 0, scheduledOn: '2026-11-22' });
    }],
    ['impact exercise under no-impact', feasibleProfiles.noImpact, plan => {
      plan.sessions[0].exercises.push(generate(feasibleProfiles.base).sessions[0].exercises.find(e => e.id === 'jump'));
    }],
    ['load without equipment', feasibleProfiles.base, plan => { plan.sessions[0].exercises[0].loadKg = 10; }],
    ['weekly minutes over budget', feasibleProfiles.oneSession, plan => {
      plan.sessions = buildPlan(generate(feasibleProfiles.base), 1).sessions;
    }],
  ]) {
    const client = await account();
    const generated = generate(answers);
    check((await rpc(client.token, 'profile_plan', client.id, {
      profile: answers, replacement: { id: randomUUID(), payload: buildPlan(generated) },
    })).data === 1, `${label}: untampered control accepted`);
    const payload = buildPlan(generated, 1);
    tamper(payload);
    const invalid = await rpc(client.token, 'plan', randomUUID(), payload);
    check(!invalid.ok && invalid.data?.code === '22023', `plan-profile mismatch rejected: ${label}`);
  }

  const rollback = await account();
  await waitForQuotaWindow();
  const rollbackBucket = Math.floor(Date.now() / 60000);
  check((await rpc(rollback.token, 'profile', rollback.id, profile)).data === 1, 'rollback account starts with saved profile revision 1');
  const rollbackId = randomUUID();
  const invalidReplacement = {
    profile: change, replacement: { id: rollbackId, payload: buildPlan(generate(profile)) },
  };
  const rejectedPair = await rpc(rollback.token, 'profile_plan', rollback.id, invalidReplacement, 1);
  check(!rejectedPair.ok && rejectedPair.data?.code === '22023', 'paired publication rejects a structurally valid replacement containing forbidden impact');
  const [profileAfter, plansAfter, prescriptionsAfter, adaptationsAfter] = await Promise.all([
    request('/rest/v1/profiles?select=revision,data', rollback.token),
    request(`/rest/v1/plans?select=id&id=eq.${rollbackId}`, rollback.token),
    request(`/rest/v1/prescriptions?select=id&plan_id=eq.${rollbackId}`, rollback.token),
    request(`/rest/v1/adaptations?select=id&plan_id=eq.${rollbackId}`, rollback.token),
  ]);
  check(profileAfter.ok && Array.isArray(profileAfter.data) && profileAfter.data.length === 1 &&
    profileAfter.data[0].revision === 1, 'paired rollback preserves original profile revision');
  check(isDeepStrictEqual(profileAfter.data[0].data, profile), 'paired rollback preserves all saved profile answers and binding');
  check(plansAfter.ok && plansAfter.data.length === 0, 'paired rollback leaves no replacement plan');
  check(prescriptionsAfter.ok && prescriptionsAfter.data.length === 0, 'paired rollback leaves no replacement prescriptions');
  check(adaptationsAfter.ok && adaptationsAfter.data.length === 0, 'paired rollback leaves no replacement adaptation reason');
  const rollbackQuota = await Promise.all(Array.from({ length: 59 }, () => rpc(rollback.token, 'plan', randomUUID(), {})));
  check(Math.floor(Date.now() / 60000) === rollbackBucket, 'paired rollback quota probe stayed in one window');
  check(rollbackQuota.filter(r => r.data?.code === '22023').length === 58 &&
    rollbackQuota.filter(r => r.data?.message === 'mutation_quota').length === 1, 'paired rollback consumes one mutation from the same quota window');

  // A fresh test identity isolates this burst from setup writes. Keep it inside
  // one window so a true reset cannot appear to be a concurrency overshoot.
  async function waitForQuotaWindow() {
    const elapsed = Date.now() % 60000;
    if (elapsed > 45000) await new Promise(resolve => setTimeout(resolve, 60000 - elapsed + 250));
  }
  const quotaAccount = await account();
  await waitForQuotaWindow();
  const startBucket = Math.floor(Date.now() / 60000);
  const quota = await Promise.all(Array.from({ length: 70 }, () => rpc(quotaAccount.token, 'plan', randomUUID(), {})));
  check(Math.floor(Date.now() / 60000) === startBucket, 'quota burst completed within one window');
  check(quota.filter(r => r.data?.code === '22023').length === 60, 'validation failures consume the fixed window concurrently');
  check(quota.filter(r => r.data?.message === 'mutation_quota').length === 10, 'mutation limiter rejects the remaining attempts');
  // Quota reset/window and bounded storage are exercised with SQL setup in limits.sql.
  check((await request('/rest/v1/rpc/delete_account', b.token, 'POST', {})).ok, 'account deletion client RPC');
  check((await request('/rest/v1/rpc/delete_account', b.token, 'POST', {})).ok, 'lost deletion acknowledgement can be retried with the same unexpired token');
  for (const table of tables) {
    const result = await request(`/rest/v1/${table}?select=id&limit=10`, b.token);
    check([401, 403].includes(result.status) || result.ok && Array.isArray(result.data) && result.data.length === 0, `${table}: deleted token reads no data`);
  }
  check(!(await rpc(b.token, 'profile', randomUUID(), profile)).ok, 'old token cannot resurrect deleted account');
  check(!(await request('/auth/v1/token?grant_type=refresh_token', key, 'POST', { refresh_token: b.refresh })).ok, 'deleted refresh token rejected');
  // Cleanup inventory separately checks physical removal using the isolated
  // test setup credential. The client-permission assertions above use JWTs.
  for (const table of tables.filter(table => table !== 'jump_history')) {
    const residual = await request(`/rest/v1/${table}?select=id&user_id=eq.${b.id}&limit=1`, setupKey, 'GET', undefined, true);
    check(residual.ok && Array.isArray(residual.data) && residual.data.length === 0, `${table}: no residual rows at cleanup`);
  }
  if (process.argv.includes('--security')) {
    // Local email capture only. The reserved addresses belong to no real users.
    const recoveryAccount = await account();
    const recovery = { email: recoveryAccount.email };
    const first = await request('/auth/v1/recover', key, 'POST', recovery);
    check(first.ok, 'first local recovery request accepted');
    const repeat = await request('/auth/v1/recover', key, 'POST', recovery);
    check(repeat.status === 429 && repeat.data?.error_code === 'over_email_send_rate_limit', 'recovery cooldown enforced server-side');
    const signup = () => request('/auth/v1/signup', key, 'POST', { email: 'jumplab-' + randomUUID() + '@example.test', password: randomUUID() + 'Aa9!' });
    const signups = await Promise.all([signup(), signup(), signup()]);
    for (const r of signups) {
      const id = r.data?.user?.id ?? r.data?.id;
      if (r.ok && id) created.push(id);
    }
    check(signups.some(r => r.status === 429 && r.data?.error_code === 'over_email_send_rate_limit'), 'server signup email quota reached');
  }
  assert.ok(assertions > 0, 'Backend suite must make real client assertions.');
  console.log(assertions + ' real client assertions passed. Hosted configuration and device checks remain separate.');
} catch (e) { console.error(e instanceof assert.AssertionError ? e.message : 'Backend test failed. Check disposable backend setup. Sensitive responses withheld.'); process.exitCode = 1; }
finally { for (const id of created) await request(`/auth/v1/admin/users/${id}`, setupKey, 'DELETE', undefined, true).catch(() => {}); }
