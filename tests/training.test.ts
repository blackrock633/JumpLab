import test from 'node:test';
import assert from 'node:assert/strict';
import { adapt, completedPrescription, futureProfile, generate, kg, validateLog, validateProfile, type Profile, type Feedback } from '../src/core/training.ts';
export const profile: Profile = { goal: 'standing', experience: 'new', days: [1, 3, 5], practiceDays: [], startHour: 17, weeklyMinutes: 90, sessionMinutes: 40, equipment: 'none', weightKg: 70, displayUnits: 'kg', knownSquatKg: null, limitation: 'none', pain: false, startDate: '2026-11-16' };
test('same normalized profile/rules produce identical complete prescriptions', () => {
  assert.deepEqual(generate(profile), generate({ ...profile, days: [5, 1, 3] }));
  for (const s of generate(profile).sessions) for (const e of s.exercises) {
    assert.ok(e.instructions && e.effort && e.restSeconds > 0 && e.reps > 0 && e.sets > 0);
  }
  assert.equal(kg(100, 'lb'), 45.359237);
});
test('scenario table changes actual schedule, equipment, volume and movements', () => {
  const base = generate(profile);
  assert.equal(base.sessions.length, 2);
  assert.equal(generate({ ...profile, weeklyMinutes: 25 }).sessions.length, 1);
  assert.ok(generate({ ...profile, equipment: 'dumbbells' }).sessions[0]!.exercises.some(e => e.name === 'Goblet squat'));
  assert.equal(generate({ ...profile, equipment: 'barbell', knownSquatKg: 80 }).sessions[0]!.exercises[0]!.loadKg, 32);
  assert.ok(generate({ ...profile, limitation: 'no-impact' }).sessions.every(s => !s.exercises.some(e => e.id === 'jump')));
  assert.ok(generate({ ...profile, equipment: 'barbell', limitation: 'no-loaded-squats' }).sessions[0]!.exercises.some(e => e.name === 'Chair squat' && e.loadKg === null));
  assert.ok(generate({ ...profile, goal: 'running' }).sessions[0]!.exercises.some(e => /two-step/.test(e.name)));
  assert.ok(generate({ ...profile, goal: 'repeated' }).sessions[0]!.exercises.some(e => e.id === 'jump' && e.reps === 5));
  assert.equal(generate({ ...profile, experience: 'trained' }).sessions[0]!.exercises[0]!.sets, 3);
  assert.ok(generate({ ...profile, practiceDays: [1] }).sessions.every(s => Math.abs(s.day - 1) >= 2));
});
test('infeasible inputs and pain return actionable explanations', () => {
  for (const p of [{ ...profile, days: [] }, { ...profile, practiceDays: [0, 1, 2, 3, 4, 5, 6] }, { ...profile, sessionMinutes: 10 }, { ...profile, weeklyMinutes: 20 }, { ...profile, pain: true }]) assert.throws(() => generate(p));
  for (const p of [{ ...profile, weightKg: NaN }, { ...profile, days: [7] }, { ...profile, days: [1, 1] }, { ...profile, startHour: 24 }, { ...profile, knownSquatKg: -1 }]) assert.throws(() => validateProfile(p));
});
const good: Feedback = { completed: true, effort: 5, recovery: 'good', pain: false };
test('adaptation holds missing/noisy observations; capped load only after 3 comfortable sessions', () => {
  const plan = generate({ ...profile, equipment: 'barbell', knownSquatKg: 100 });
  assert.deepEqual(adapt(plan, [], null).plan.sessions.map(s => s.exercises), plan.sessions.map(s => s.exercises));
  const next = adapt(plan, [good, good, good], null);
  assert.equal(next.plan.sessions[0]!.exercises[0]!.loadKg, 41);
  assert.equal(next.plan.sessions[0]!.exercises[1]!.sets, plan.sessions[0]!.exercises[1]!.sets);
  const noisy = adapt(plan, [good], { validated: false, typeCompatible: true, count: 1, changeFraction: 0.5 });
  assert.equal(noisy.plan.sessions[0]!.exercises[0]!.loadKg, 40);
  const incompatible = adapt(plan, [good, good, good], { validated: true, typeCompatible: false, count: 3, changeFraction: -0.2 });
  assert.equal(incompatible.plan.sessions[0]!.exercises[0]!.loadKg, 41);
});
test('pain/fatigue guards, deload, reductions and history immutability', () => {
  const plan = generate(profile), original = structuredClone(plan);
  for (const observation of [{ ...good, pain: true }, { ...good, recovery: 'fatigued' as const }]) {
    const change = adapt(plan, [good, good, observation], null);
    assert.ok(change.plan.sessions.every(s => s.exercises.every(e => e.sets === 0)));
    assert.match(change.reason, /Stop\/modify/);
  }
  assert.ok(adapt({ ...plan, week: 3 }, [good, good, good], null).plan.sessions[0]!.exercises[0]!.sets < 2);
  assert.ok(adapt(plan, [{ ...good, effort: 9 }, { ...good, effort: 10 }], null).plan.sessions[0]!.exercises[0]!.sets < 2);
  assert.deepEqual(plan, original);
  assert.deepEqual(adapt(plan, [good], null), adapt(plan, [good], null));
  assert.deepEqual(adapt(plan, [], null).plan.sessions.map(s => s.day), plan.sessions.map(s => s.day));
});
test('logging accepts only existing prescribed sets and validates limits', () => {
  const s = generate(profile).sessions[0]!;
  const valid = { exerciseId: 'squat', index: 0, reps: 6, loadKg: null, done: true };
  validateLog(s, [valid]);
  for (const logs of [[{ ...valid, exerciseId: 'outside-workout' }], [valid, valid], [{ ...valid, index: 20 }], [{ ...valid, reps: NaN }], [{ ...valid, loadKg: -1 }]]) assert.throws(() => validateLog(s, logs));
});
test('old or duplicated workout feedback cannot repeatedly escalate loads', () => {
  const plan = generate({ ...profile, equipment: 'barbell', knownSquatKg: 100 });
  const observations = ['a', 'b', 'c'].map(id => ({ ...good, id }));
  const progressed = adapt(plan, observations, null).plan;
  assert.equal(progressed.sessions[0]!.exercises[0]!.loadKg, 41);
  assert.equal(adapt(progressed, observations, null).plan.sessions[0]!.exercises[0]!.loadKg, 41);
  assert.equal(adapt(plan, [observations[0]!, observations[0]!, observations[0]!], null).plan.sessions[0]!.exercises[0]!.loadKg, 40);
  assert.throws(() => adapt(plan, [{ ...good, effort: NaN }], null), /feedback/);
});
test('profile replacement never backdates a plan or removes recovery after completed work', () => {
  const now = new Date(2026, 10, 17, 12);
  const completed = new Date(2026, 10, 16, 23).toISOString();
  assert.equal(futureProfile(profile, [null], now).startDate, '2026-11-17');
  const updated = futureProfile(profile, [completed], now);
  assert.equal(updated.startDate, '2026-11-19');
  assert.ok(generate(updated).sessions.every(s => s.scheduledOn >= '2026-11-19'));
});
test('progression requires actual prescribed reps, sets and applicable loads', () => {
  const session = generate({ ...profile, equipment: 'barbell', knownSquatKg: 100 }).sessions[0]!;
  const logs = session.exercises.flatMap(e => Array.from({ length: e.sets }, (_, index) => ({ exerciseId: e.id, index, reps: e.reps, loadKg: e.loadKg, done: true })));
  assert.equal(completedPrescription(session, logs), true);
  assert.equal(completedPrescription(session, logs.slice(1)), false);
  for (const edit of [{ reps: 0 }, { loadKg: 20 }, { loadKg: null }, { done: false }]) {
    assert.equal(completedPrescription(session, logs.map((s, i) => i === 0 ? { ...s, ...edit } : s)), false);
  }
});
