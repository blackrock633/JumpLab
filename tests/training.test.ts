import test from 'node:test';
import assert from 'node:assert/strict';
import { adapt, canPrepareNextWeek, completedPrescription, futureProfile, generate, kg, validateLog, validateProfile } from '../src/core/training.ts';
import { comfortableWorkouts, feasibleProfiles, good, infeasibleProfiles, profile } from './fixtures/profiles.ts';
test('same normalized profile/rules produce identical complete prescriptions', () => {
  assert.deepEqual(generate(profile), generate(feasibleProfiles.reorderedDays));
  for (const s of generate(profile).sessions) for (const e of s.exercises) {
    assert.ok(e.instructions && e.effort && e.restSeconds > 0 && e.reps > 0 && e.sets > 0);
  }
  assert.equal(kg(100, 'lb'), 45.359237);
});
test('scenario table changes actual schedule, equipment, volume and movements', () => {
  const base = generate(profile);
  assert.equal(base.sessions.length, 2);
  assert.equal(generate(feasibleProfiles.oneSession).sessions.length, 1);
  assert.ok(generate(feasibleProfiles.dumbbells).sessions[0]!.exercises.some(e => e.name === 'Goblet squat'));
  assert.equal(generate(feasibleProfiles.barbell).sessions[0]!.exercises[0]!.loadKg, 32);
  assert.ok(generate(feasibleProfiles.noImpact).sessions.every(s => !s.exercises.some(e => e.id === 'jump')));
  assert.ok(generate(feasibleProfiles.noLoadedSquats).sessions[0]!.exercises.some(e => e.name === 'Chair squat' && e.loadKg === null));
  assert.ok(generate(feasibleProfiles.running).sessions[0]!.exercises.some(e => /two-step/.test(e.name)));
  assert.ok(generate(feasibleProfiles.repeated).sessions[0]!.exercises.some(e => e.id === 'jump' && e.reps === 5));
  assert.equal(generate(feasibleProfiles.trained).sessions[0]!.exercises[0]!.sets, 3);
  assert.ok(generate(feasibleProfiles.practice).sessions.every(s => Math.abs(s.day - 1) >= 2));
});
test('infeasible inputs and pain return actionable explanations', () => {
  for (const p of infeasibleProfiles) assert.throws(() => generate(p));
  for (const p of [{ ...profile, weightKg: NaN }, { ...profile, days: [7] }, { ...profile, days: [1, 1] }, { ...profile, startHour: 24 }, { ...profile, knownSquatKg: -1 }]) assert.throws(() => validateProfile(p));
});
test('adaptation holds missing/noisy observations; capped load only after 3 comfortable sessions', () => {
  const plan = generate(feasibleProfiles.progression);
  assert.deepEqual(adapt(plan, [], null).plan.sessions.map(s => s.exercises), plan.sessions.map(s => s.exercises));
  const next = adapt(plan, comfortableWorkouts, null);
  assert.equal(next.plan.sessions[0]!.exercises[0]!.loadKg, 41);
  assert.equal(next.plan.sessions[0]!.exercises[1]!.sets, plan.sessions[0]!.exercises[1]!.sets);
  const noisy = adapt(plan, [good], { validated: false, typeCompatible: true, count: 1, changeFraction: 0.5 });
  assert.equal(noisy.plan.sessions[0]!.exercises[0]!.loadKg, 40);
  const incompatible = adapt(plan, comfortableWorkouts, { validated: true, typeCompatible: false, count: 3, changeFraction: -0.2 });
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
test('unidentified, old or duplicated workout feedback cannot escalate loads', () => {
  const plan = generate(feasibleProfiles.progression);
  const observations = comfortableWorkouts;
  const progressed = adapt(plan, observations, null).plan;
  assert.equal(progressed.sessions[0]!.exercises[0]!.loadKg, 41);
  assert.deepEqual(progressed.usedObservationIds, observations.map(o => o.id));
  assert.equal(adapt(progressed, observations, null).plan.sessions[0]!.exercises[0]!.loadKg, 41);
  assert.equal(adapt(plan, [observations[0]!, observations[0]!, observations[0]!], null).plan.sessions[0]!.exercises[0]!.loadKg, 40);
  assert.equal(adapt(plan, [good, good, good], null).plan.sessions[0]!.exercises[0]!.loadKg, 40);
  assert.equal(adapt(plan, [observations[0]!, observations[1]!, good], null).plan.sessions[0]!.exercises[0]!.loadKg, 40);
  assert.equal(adapt(plan, [observations[0]!, observations[1]!, { ...observations[0]!, id: observations[0]!.id.toUpperCase() }], null).plan.sessions[0]!.exercises[0]!.loadKg, 40);
  assert.throws(() => adapt(plan, [{ ...good, effort: NaN }], null), /feedback/);
});
test('repeated load increases stay within the server and workout logging range', () => {
  let plan = generate(feasibleProfiles.maximumKnownSquat);
  for (let week = 0; week < 100; week++) {
    const feedback = [0, 1, 2].map(index => ({ ...good, id: `week-${week}-${index}` }));
    plan = adapt(plan, feedback, null).plan;
  }
  const session = plan.sessions[0]!;
  assert.equal(session.exercises[0]!.loadKg, 500);
  validateLog(session, [{ exerciseId: 'squat', index: 0, reps: 6, loadKg: 500, done: true }]);
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
  const session = generate(feasibleProfiles.progression).sessions[0]!;
  const logs = session.exercises.flatMap(e => Array.from({ length: e.sets }, (_, index) => ({ exerciseId: e.id, index, reps: e.reps, loadKg: e.loadKg, done: true })));
  assert.equal(completedPrescription(session, logs), true);
  assert.equal(completedPrescription(session, logs.slice(1)), false);
  for (const edit of [{ reps: 0 }, { loadKg: 20 }, { loadKg: null }, { done: false }]) {
    assert.equal(completedPrescription(session, logs.map((s, i) => i === 0 ? { ...s, ...edit } : s)), false);
  }
});

test('overdue programs resume on spaced schedule after actual completion', () => {
  const plan = generate(feasibleProfiles.overdue);
  const next = adapt(plan, [], null, { notBefore: '2026-11-20', deloadIds: [] }).plan;
  assert.deepEqual(next.sessions.map(s => s.scheduledOn), ['2026-11-23', '2026-11-25']);
  assert.deepEqual(next.sessions.map(s => s.day), plan.sessions.map(s => s.day));
});

test('deload volume restoration requires fresh, complete and explicitly comfortable work', () => {
  const plan = generate(profile, 4);
  const schedule = { notBefore: '2026-12-07', deloadIds: ['deload'] };
  for (const feedback of [
    { ...good, id: 'old-week' },
    { ...good, id: 'deload', completed: false },
    { ...good, id: 'deload', effort: null },
    { ...good, id: 'deload', recovery: null },
  ]) {
    assert.equal(adapt(plan, [feedback], null, schedule).plan.sessions[0]!.exercises[0]!.sets, 1);
  }
  const restored = adapt(plan, [{ ...good, id: 'deload' }], null, schedule);
  assert.equal(restored.plan.sessions[0]!.exercises[0]!.sets, 2);
  assert.deepEqual(restored.plan.usedObservationIds, ['deload']);
});

test('rollover preserves the final scheduled workout until it completes or its day ends', () => {
  const sessions = [{ scheduledOn: '2026-11-16', id: 'earlier' }, { scheduledOn: '2026-11-18', id: 'final' }];
  const logs = new Map<string, { completed: boolean }>();
  const done = (session: typeof sessions[number]) => logs.get(session.id)?.completed === true;
  const finalDay = new Date(2026, 10, 18, 9);
  assert.equal(canPrepareNextWeek(sessions, done, finalDay), false);
  logs.set('final', { completed: false });
  assert.equal(canPrepareNextWeek(sessions, done, finalDay), false);
  logs.set('final', { completed: true });
  assert.equal(canPrepareNextWeek(sessions, done, finalDay), true);
  assert.equal(canPrepareNextWeek(sessions, done, new Date(2026, 10, 17, 23)), false);
  logs.delete('final');
  assert.equal(canPrepareNextWeek(sessions, done, new Date(2026, 10, 19, 0)), true);
});
