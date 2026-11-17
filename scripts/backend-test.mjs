import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { generate } from '../src/core/training.ts';
import { measurement } from '../src/core/measurement.ts';
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
const rpc = (token, kind, id, payload, revision = 0) => request('/rest/v1/rpc/save_record', token, 'POST', { kind, record_id: id, expected_revision: revision, payload });
const created = [];
let assertions = 0;
function check(value, name) { assert.ok(value, name); assertions++; console.log(`PASS ${name}`); }
const profile = { goal: 'standing', experience: 'new', days: [1, 3], practiceDays: [], startHour: 17, weeklyMinutes: 60, sessionMinutes: 30, equipment: 'none', weightKg: 70, displayUnits: 'kg', knownSquatKg: null, limitation: 'none', pain: false, startDate: '2026-11-16' };
try {
  async function account() {
    const email = `jumplab-${randomUUID()}@example.test`, password = `${randomUUID()}Aa9!`;
    const setup = await request('/auth/v1/admin/users', setupKey, 'POST', { email, password, email_confirm: true }, true);
    if (!setup.ok || !setup.data?.id) throw Error('Test-account setup failed (details withheld to avoid credentials in logs).');
    created.push(setup.data.id);
    const login = await request('/auth/v1/token?grant_type=password', key, 'POST', { email, password });
    check(login.ok && login.data?.access_token, 'real client login');
    return { id: setup.data.id, token: login.data.access_token, refresh: login.data.refresh_token };
  }
  const a = await account(), b = await account();
  const source = await readFile('supabase/migrations/202611170001_jumplab.sql', 'utf8');
  const tables = [...source.matchAll(/create table public\.(\w+)/g)].map(m => m[1]);
  check(tables.length === 6, 'schema-enumerated public data tables');
  const pId = randomUUID();
  check((await rpc(a.token, 'profile', pId, profile)).data === 1, 'save owned profile');
  const forged = { ...profile, weightKg: 71, user_id: b.id };
  check((await rpc(a.token, 'profile', pId, forged, 1)).data === 2, 'forged JSON owner disregarded');
  const owned = await request('/rest/v1/profiles?select=id,user_id,revision,data', a.token);
  check(owned.ok && owned.data.length === 1 && owned.data[0].user_id === a.id, 'ownership derives from JWT');
  const duplicate = await Promise.all(Array.from({ length: 8 }, () => rpc(a.token, 'profile', pId, forged, 1)));
  check(duplicate.every(r => r.ok && r.data === 2), 'concurrent lost-ack retries are idempotent');
  check(!(await rpc(a.token, 'profile', pId, { ...profile, weightKg: 75 }, 0)).ok, 'stale edits conflict');
  for (const payload of [{ ...profile, weightKg: -1 }, { ...profile, weightKg: null }, { ...profile, days: [8] }, { ...profile, pain: null }, { ...profile, knownSquatKg: -1 }]) {
    const invalid = await rpc(b.token, 'profile', randomUUID(), payload);
    check(!invalid.ok && ['22023', '23514'].includes(invalid.data?.code), 'malformed profile rejected at validation boundary');
  }
  check(!(await rpc(a.token, 'workout', randomUUID(), { prescriptionId: randomUUID(), sets: [] })).ok, 'unprescribed workout rejected');
  check(!(await rpc(key, 'profile', randomUUID(), profile)).ok, 'anonymous RPC denied');
  const bProfile = randomUUID(); check((await rpc(b.token, 'profile', bProfile, profile)).ok, 'populate B profile');
  async function seedAll(token) {
    const planId = randomUUID(), plan = { ...generate(profile), changeReason: 'Isolated test fixture', sessions: generate(profile).sessions.map(s => ({ ...s, prescriptionId: randomUUID(), workoutId: randomUUID() })) };
    check((await rpc(token, 'plan', planId, plan)).ok, 'populate plan, prescriptions and adaptation');
    const s = plan.sessions[0];
    const workout = { prescriptionId: s.prescriptionId, completed: true, effort: 5, pain: false, recovery: 'good', completedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sets: s.exercises.flatMap(e => Array.from({ length: e.sets }, (_, index) => ({ exerciseId: e.id, index, reps: e.reps, loadKg: e.loadKg, done: true }))) };
    check((await rpc(token, 'workout', s.workoutId, workout)).ok, 'populate prescribed workout');
    const timestamps = Array.from({ length: 90 }, (_, i) => i / 60), id = randomUUID();
    const jump = measurement(id, 'standing', { takeoff: [timestamps[30], timestamps[31]], landing: [timestamps[54], timestamps[55]] }, { originalFPS: 60, playbackFPS: 60, kind: 'original', confirmedOriginal: true, mappings: [], timestamps }, new Date().toISOString());
    check((await rpc(token, 'jump', id, jump)).ok, 'populate experimental jump (synthetic backend fixture only)');
    const badJump = await rpc(token, 'jump', randomUUID(), { ...jump, trainingEligible: true });
    check(!badJump.ok && badJump.data?.code === '22023', 'forged training eligibility rejected');
    const badWorkout = await rpc(token, 'workout', randomUUID(), { ...workout, sets: [{ exerciseId: 'outside', index: 0, reps: 1, loadKg: null, done: true }] });
    check(!badWorkout.ok && badWorkout.data?.code === '22023', 'unrelated exercise rejected');
  }
  await seedAll(a.token); await seedAll(b.token);
  for (const table of tables) {
    const ownRows = await request(`/rest/v1/${table}?select=id,user_id&limit=10`, a.token);
    check(ownRows.ok && ownRows.data.length > 0 && ownRows.data.every(r => r.user_id === a.id), `${table}: populated owned read allowed`);
    for (const identity of [key, b.token]) {
      const select = await request(`/rest/v1/${table}?select=id,user_id&user_id=eq.${a.id}&limit=10`, identity);
      check(identity === key ? [401, 403].includes(select.status) : select.ok && Array.isArray(select.data) && select.data.length === 0, `${table}: anonymous/cross-account select denied`);
    }
    for (const identity of [key, a.token, b.token]) {
      for (const method of ['POST', 'PATCH', 'DELETE']) {
        const suffix = method === 'POST' ? '' : `?user_id=eq.${a.id}`;
        const body = method === 'POST' ? { id: randomUUID(), user_id: a.id, revision: 1, data: {} } : method === 'PATCH' ? { user_id: b.id } : undefined;
        const result = await request(`/rest/v1/${table}${suffix}`, identity, method, body);
        check([401, 403].includes(result.status), `${table}: direct ${method} denied for public clients`);
      }
    }
  }
  for (const functionName of ['limit_write', 'typed_fields', 'valid_jump']) check(!(await request(`/rest/v1/rpc/${functionName}`, a.token, 'POST', {})).ok, `private function ${functionName} unavailable`);
  const quota = await Promise.all(Array.from({ length: 70 }, () => rpc(a.token, 'profile', pId, forged, 2)));
  check(quota.some(r => r.ok) && quota.some(r => !r.ok && r.data?.message === 'mutation_quota'), 'concurrent quota enforced on idempotent RPC route');
  check(quota.filter(r => r.ok).length <= 60, 'no quota overshoot');
  // Quota reset/window and bounded storage are exercised with SQL setup in limits.sql.
  check((await request('/rest/v1/rpc/delete_account', b.token, 'POST', {})).ok, 'account deletion client RPC');
  for (const table of tables) {
    const result = await request(`/rest/v1/${table}?select=id&limit=10`, b.token);
    check([401, 403].includes(result.status) || result.ok && Array.isArray(result.data) && result.data.length === 0, `${table}: deleted token reads no data`);
  }
  check(!(await rpc(b.token, 'profile', randomUUID(), profile)).ok, 'old token cannot resurrect deleted account');
  check(!(await request('/auth/v1/token?grant_type=refresh_token', key, 'POST', { refresh_token: b.refresh })).ok, 'deleted refresh token rejected');
  console.log(`${assertions} real client assertions passed. Window-boundary, Auth quotas/configuration and device checks remain separate.`);
} catch (e) { console.error(e instanceof assert.AssertionError ? e.message : 'Backend test failed. Check disposable backend setup. Sensitive responses withheld.'); process.exitCode = 1; }
finally { for (const id of created) await request(`/auth/v1/admin/users/${id}`, setupKey, 'DELETE', undefined, true).catch(() => {}); }
