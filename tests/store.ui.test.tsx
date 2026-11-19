import type { LocalDB } from '../src/data/local';
import * as store from '../src/data/store';
import { accountClient } from '../src/data/auth';
import { selectActivePlan } from '../src/core/queue';
import Native from '../modules/jump-analysis/src';

jest.mock('../modules/jump-analysis/src', () => ({
  __esModule: true, default: { setAccount: jest.fn().mockResolvedValue(true), recoverAnalysis: jest.fn() },
}));
jest.mock('expo-crypto', () => ({ randomUUID: () => 'generated' }));
jest.mock('../src/data/auth', () => ({ accountClient: jest.fn() }));
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => {
    const { DatabaseSync } = jest.requireActual<typeof import('node:sqlite')>('node:sqlite');
    const raw = new DatabaseSync(':memory:');
    const db: LocalDB = {
      async execAsync(sql) { raw.exec(sql); },
      async runAsync(sql, ...params) { return raw.prepare(sql).run(...params); },
      async getFirstAsync<T>(sql: string, ...params: (string | number | null)[]) { return (raw.prepare(sql).get(...params) as T) ?? null; },
      async getAllAsync<T>(sql: string, ...params: (string | number | null)[]) { return raw.prepare(sql).all(...params) as T[]; },
      async withExclusiveTransactionAsync(work) {
        raw.exec('BEGIN IMMEDIATE');
        try { await work(db); raw.exec('COMMIT'); }
        catch (error) { raw.exec('ROLLBACK'); throw error; }
      },
    };
    return db;
  },
}));

test('a stalled profile refresh leaves local workout saves responsive and protects pending work on account switch', async () => {
  await store.switchAccount('A');
  let start!: () => void, respond!: (response: { data: []; error: null }) => void;
  const started = new Promise<void>(resolve => { start = resolve; });
  const response = new Promise<{ data: []; error: null }>(resolve => { respond = resolve; });
  const request = { select: () => request, eq: () => request, order: () => request, limit: () => request, abortSignal: () => { start(); return response; } };
  jest.mocked(accountClient).mockResolvedValue({ client: { from: () => request }, isCurrent: () => true } as never);
  const refreshing = store.hydrate('A', 'profile');
  try {
    await started;
    await store.save('A', 'workout', { sets: [5] }, 'workout');
    expect(await store.pending('A')).toEqual([expect.objectContaining({ state: 'pending', id: 'workout' })]);
    await expect(store.switchAccount('B')).rejects.toBeInstanceOf(store.UnsyncedAccount);
    await expect(store.records('B', 'workout')).rejects.toThrow('Account changed');
  } finally {
    respond({ data: [], error: null });
    await refreshing;
  }
  expect(await store.records('A', 'workout')).toEqual([expect.objectContaining({ payload: { sets: [5] } })]);
  await store.switchAccount('B', true);
  expect(await store.records('B', 'workout')).toEqual([]);
  expect(await store.pending('B')).toEqual([]);
});

test('scheduling history rejects an interrupted workout page and retries through the last page', async () => {
  await store.switchAccount('A', true);
  const created = '2026-11-16T17:00:00.000Z';
  const firstPage = Array.from({ length: 100 }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(200 - i).padStart(12, '0')}`,
    user_id: 'A', revision: 1, created_at: created, data: { updatedAt: created },
  }));
  const last = { ...firstPage[0]!, id: '00000000-0000-4000-8000-000000000001' };
  const request = {
    select: jest.fn(() => request), eq: jest.fn(() => request), gte: jest.fn(() => request),
    or: jest.fn(() => request), order: jest.fn(() => request), limit: jest.fn(() => request),
    abortSignal: jest.fn()
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'interrupted' } })
      .mockResolvedValueOnce({ data: firstPage, error: null })
      .mockResolvedValueOnce({ data: [last], error: null }),
  };
  const from = jest.fn(() => request);
  jest.mocked(accountClient).mockResolvedValue({ client: { from }, isCurrent: () => true } as never);
  const cutoff = '2026-11-10T00:00:00.000Z';
  await expect(store.hydrate('A', 'workout', cutoff)).rejects.toThrow('Could not refresh');
  await expect(store.hydrate('A', 'workout', cutoff)).resolves.toEqual([...firstPage, last]);
  expect(from.mock.calls).toEqual([['workouts'], ['workouts'], ['workouts'], ['workouts']]);
  expect(request.gte).toHaveBeenCalledWith('updated_at', cutoff);
  expect(request.or).toHaveBeenCalledTimes(2);
  expect(await store.records('A', 'workout', cutoff)).toHaveLength(101);
});

test('a rejected profile_plan RPC leaves a single terminal pair and no active draft', async () => {
  await store.eraseLocalAccount('B');
  await store.switchAccount('A', true);
  const profile = { limitation: 'no-impact' };
  const replacement = { id: 'rejected-plan', payload: { profileRevision: 1, sessions: [] } };
  const rpc = jest.fn(() => ({ abortSignal: async () => ({ data: { code: '22023' }, error: null }) }));
  jest.mocked(accountClient).mockResolvedValue({ client: { rpc }, isCurrent: () => true } as never);

  await store.saveBatch('A', [
    { kind: 'profile', id: 'A', payload: profile },
    { kind: 'plan', ...replacement },
  ]);
  await store.sync('A');
  await store.sync('A');

  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith('save_record', {
    kind: 'profile_plan', record_id: 'A', expected_revision: 0,
    payload: { profile: { ...profile, planBinding: true }, replacement },
  });
  const queue = await store.pending('A');
  expect(queue).toEqual([
    expect.objectContaining({ id: 'A', kind: 'profile', state: 'error', replacement: { id: replacement.id } }),
  ]);
  const [savedProfile] = await store.records<{ planBinding?: boolean }>('A', 'profile');
  const plans = await store.records<{ profileRevision?: number }>('A', 'plan');
  expect(plans).toEqual([expect.objectContaining({ id: replacement.id, revision: 0 })]);
  expect(selectActivePlan(plans, savedProfile, queue)).toBeUndefined();
});

test('a pending sign-out blocks account B until device erasure completes', async () => {
  await store.switchAccount('A', true);
  await store.save('A', 'workout', { sets: [5] }, 'private-log');
  await store.beginSignOut('A');

  await expect(store.records('A', 'workout')).rejects.toThrow('Account changed');
  await expect(store.switchAccount('B', true)).rejects.toThrow('Finish erasing');
  await store.eraseLocalAccount('A');
  expect(await store.signOutStatus()).toEqual({ owner: 'A' });
  await expect(store.switchAccount('B', true)).rejects.toThrow('Finish erasing');

  await store.clearSignOut('A');
  await store.switchAccount('B');
  expect(await store.records('B', 'workout')).toEqual([]);
  expect(await store.pending('B')).toEqual([]);
  await expect(store.records('A', 'workout')).rejects.toThrow('Account changed');
});

test.each(['remote', 'local'] as const)('conflicting profile and plan stay together when keeping the %s version', async choice => {
  await store.eraseLocalAccount('A');
  await store.switchAccount('A', true);
  const localProfile = { equipment: 'barbell', limitation: 'none' };
  const localPlan = { sessions: [{ prescriptionId: 'draft-prescription' }] };
  const remoteProfile = { equipment: 'none', limitation: 'no-impact', planBinding: true };
  const date = new Date().toISOString();
  const profileRow = { id: 'A', user_id: 'A', revision: 2, data: remoteProfile, created_at: date };
  const remotePlan = { id: 'saved-plan', user_id: 'A', revision: 1, data: { profileRevision: 2 }, created_at: date };
  const rpc = jest.fn((_name, args) => ({ abortSignal: async () => ({
    error: null, data: args.expected_revision === 2 || args.kind !== 'profile_plan' ? { revision: 3 } : { code: '40001' },
  }) }));
  let plansAvailable = choice !== 'remote';
  const lookup = jest.fn(async () => ({ data: [], error: null, status: 200 }));
  const from = (table: string) => {
    const request = { select: () => request, eq: () => request, order: () => request, limit: () => request, filter: () => request,
      abortSignal: lookup,
      maybeSingle: async () => table === 'plans' && !plansAvailable ? { error: { code: 'unavailable' }, data: null } :
        { error: null, data: table === 'plans' ? remotePlan : profileRow } };
    return request;
  };
  jest.mocked(accountClient).mockResolvedValue({ client: { from, rpc }, isCurrent: () => true } as never);
  await store.saveBatch('A', [{ id: 'A', kind: 'profile', payload: localProfile }, { id: 'draft', kind: 'plan', payload: localPlan }]);
  await store.save('A', 'workout', { prescriptionId: 'draft-prescription' }, 'local-log');
  await store.sync('A');
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc).toHaveBeenCalledWith('save_record', expect.objectContaining({ kind: 'profile_plan',
    payload: { profile: { ...localProfile, planBinding: true }, replacement: { id: 'draft', payload: localPlan } },
  }));
  expect(await store.pending('A')).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'A', state: 'conflict', replacement: { id: 'draft' } }),
    expect.objectContaining({ id: 'local-log', state: 'pending' }),
  ]));
  if (choice === 'remote') {
    await expect(store.resolveConflict('A', 'A', choice)).rejects.toThrow('Could not load the saved training plan');
    expect(await store.pending('A')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'A', state: 'conflict', replacement: { id: 'draft' } }),
    ]));
    expect(await store.records('A', 'profile')).toEqual([expect.objectContaining({ payload: { ...localProfile, planBinding: true } })]);
    plansAvailable = true;
  }
  await store.resolveConflict('A', 'A', choice);
  await store.sync('A');
  if (choice === 'remote') {
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(await store.records('A', 'profile')).toEqual([expect.objectContaining({ payload: remoteProfile })]);
    expect(await store.records('A', 'plan')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'draft', revision: 0 }), expect.objectContaining({ id: 'saved-plan', revision: 1 }),
    ]));
    expect(await store.pending('A')).toEqual([expect.objectContaining({ id: 'local-log', state: 'error', message: expect.stringContaining('local history') })]);
  } else {
    expect(rpc).toHaveBeenNthCalledWith(2, 'save_record', expect.objectContaining({ kind: 'profile_plan', expected_revision: 2 }));
    expect(rpc).toHaveBeenNthCalledWith(3, 'save_record', expect.objectContaining({ kind: 'workout', record_id: 'local-log' }));
    expect(await store.records('A', 'plan')).toEqual([expect.objectContaining({ id: 'draft', revision: 1, payload: { ...localPlan, profileRevision: 3 } })]);
    expect(await store.pending('A')).toEqual([]);
  }
});

test('a workout queued after supersession syncs once if the first plan was published and its acknowledgement was lost', async () => {
  await store.eraseLocalAccount('A');
  await store.switchAccount('A', true);
  const draft = (id: string, equipment: string) => store.saveBatch('A', [
    { id: 'A', kind: 'profile', payload: { equipment } },
    { id, kind: 'plan', payload: { sessions: [{ prescriptionId: id + '-prescription' }] } },
  ]);
  const workout = { prescriptionId: 'first-prescription', sets: [{ reps: 5 }] };
  const published = new Set<string>();
  const remoteWorkouts = new Map<string, unknown>();
  const rpc = jest.fn((_name, args) => ({ abortSignal: async () => {
    if (args.kind === 'profile_plan') {
      if (args.payload.replacement.id === 'first') {
        published.add('first-prescription');
        throw Error('Lost acknowledgement after commit');
      }
      return { data: { code: '40001' }, error: null };
    }
    expect(args.kind).toBe('workout');
    expect(published.has(args.payload.prescriptionId)).toBe(true);
    remoteWorkouts.set(args.record_id, args.payload);
    return { data: { revision: 1 }, error: null };
  } }));
  const filters = jest.fn((_column: string, _value: string) => prescriptions);
  const lookup = jest.fn()
    .mockResolvedValueOnce({ data: null, error: { code: '503' }, status: 503 })
    .mockResolvedValueOnce({ data: null, error: null, status: 200 })
    .mockImplementation(async () => ({
      data: [...published].map(id => ({ id })), error: null, status: 200,
    }));
  const prescriptions = { select: () => prescriptions, eq: filters, limit: () => prescriptions, abortSignal: lookup };
  const from = jest.fn((table: string) => {
    expect(table).toBe('prescriptions');
    return prescriptions;
  });
  jest.mocked(accountClient).mockResolvedValue({ client: { from, rpc }, isCurrent: () => true } as never);

  await draft('first', 'barbell');
  await store.sync('A');
  expect(published.has('first-prescription')).toBe(true);
  expect(from).not.toHaveBeenCalled();
  expect(await store.records('A', 'plan')).toEqual([expect.objectContaining({ id: 'first', revision: 0 })]);
  await draft('second', 'none');
  await store.save('A', 'workout', workout, 'first-log');

  for (let attempt = 0; attempt < 2; attempt++) {
    await store.sync('A');
    expect(await store.pending('A')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'A', state: 'conflict', replacement: { id: 'second' } }),
      expect.objectContaining({ id: 'first-log', state: 'retry' }),
    ]));
    expect(remoteWorkouts.size).toBe(0);
  }
  await store.sync('A');
  await store.sync('A');
  expect(from.mock.calls).toEqual([['prescriptions'], ['prescriptions'], ['prescriptions']]);
  expect(filters.mock.calls).toEqual(Array.from({ length: 3 }, () => [
    ['user_id', 'A'], ['id', 'first-prescription'],
  ]).flat());
  expect(rpc.mock.calls.filter(([, args]) => args.kind === 'workout')).toEqual([
    ['save_record', expect.objectContaining({ record_id: 'first-log', expected_revision: 0, payload: workout })],
  ]);
  expect([...remoteWorkouts]).toEqual([['first-log', workout]]);
  expect(await store.pending('A')).toEqual([expect.objectContaining({ id: 'A', state: 'conflict' })]);
  expect(await store.records('A', 'workout')).toEqual([expect.objectContaining({ id: 'first-log', revision: 1, payload: workout })]);
});

test('a pain edit pauses training immediately while the original plan and completed workout sync', async () => {
  await store.eraseLocalAccount('A');
  await store.switchAccount('A', true);
  const profile = { pain: false, equipment: 'barbell' };
  const pause = { pain: true, equipment: 'none' };
  const replacement = { id: 'plan', payload: { sessions: [{ prescriptionId: 'prescription' }] } };
  const workout = { prescriptionId: 'prescription', completed: true, sets: [{ done: true, reps: 5 }] };
  await store.saveBatch('A', [{ id: 'A', kind: 'profile', payload: profile }, { kind: 'plan', ...replacement }]);
  await store.save('A', 'workout', workout, 'completion');
  let finish!: () => void, dispatch!: () => void;
  const dispatched = new Promise<void>(resolve => { dispatch = resolve; });
  const firstResponse = new Promise<void>(resolve => { finish = resolve; });
  const rpc = jest.fn((_name, args) => ({ abortSignal: async () => {
    if (args.payload.replacement) { dispatch(); await firstResponse; }
    return { data: { revision: args.expected_revision + 1 }, error: null };
  } }));
  jest.mocked(accountClient).mockResolvedValue({ client: { rpc }, isCurrent: () => true } as never);
  const publishing = store.sync('A');
  await dispatched;
  try {
    await store.saveBatch('A', [{ id: 'A', kind: 'profile', payload: pause }]);
    expect(await store.records('A', 'profile')).toEqual([expect.objectContaining({ payload: { ...pause, planBinding: true } })]);
    expect(await store.pending('A')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'A', replacement: { id: 'plan' } }),
      expect.objectContaining({ id: 'completion', state: 'pending' }),
    ]));
  } finally { finish(); await publishing; }
  expect(await store.pending('A')).toEqual([expect.objectContaining({ id: 'A', revision: 1, state: 'pending' })]);
  await store.sync('A');
  expect(rpc.mock.calls).toEqual([
    ['save_record', { kind: 'profile_plan', record_id: 'A', expected_revision: 0,
      payload: { profile: { ...profile, planBinding: true }, replacement } }],
    ['save_record', { kind: 'workout', record_id: 'completion', expected_revision: 0, payload: workout }],
    ['save_record', { kind: 'profile_plan', record_id: 'A', expected_revision: 1,
      payload: { profile: { ...pause, planBinding: true }, replacement: null } }],
  ]);
  expect(await store.pending('A')).toEqual([]);
});

test('keeping the saved profile cannot activate an earlier plan after a concurrent pain pause', async () => {
  await store.eraseLocalAccount('A');
  await store.switchAccount('A', true);
  const draft = { pain: false, planBinding: true };
  const original = { id: 'A', user_id: 'A', revision: 2, data: draft };
  const paused = { ...original, revision: 3, data: { ...draft, pain: true } };
  let saved = original;
  const plan = { id: 'saved-plan', user_id: 'A', revision: 1, data: { profileRevision: 2 }, created_at: new Date().toISOString() };
  const filter = jest.fn(() => request);
  const request = {
    select: () => request, eq: () => request, order: () => request, limit: () => request, filter,
    maybeSingle: async () => {
      saved = paused;
      return { error: null, data: plan };
    },
  };
  const from = jest.fn((table: string) => {
    if (table === 'plans') return request;
    expect(table).toBe('profiles');
    const profiles = { select: () => profiles, eq: () => profiles, maybeSingle: async () => ({ error: null, data: saved }) };
    return profiles;
  });
  const rpc = () => ({ abortSignal: async () => ({ error: null, data: { code: '40001' } }) });
  jest.mocked(accountClient).mockResolvedValue({ client: { from, rpc }, isCurrent: () => true } as never);
  await store.saveBatch('A', [{ id: 'A', kind: 'profile', payload: draft }, { id: 'draft', kind: 'plan', payload: {} }]);
  await store.sync('A');
  await expect(store.resolveConflict('A', 'A', 'remote')).rejects.toThrow('saved profile is still current');
  expect(from.mock.calls.map(([table]) => table)).toEqual(['profiles', 'plans', 'profiles']);
  expect(filter).toHaveBeenCalledWith('data->>profileRevision', 'eq', '2');
  const queue = await store.pending('A');
  expect(queue).toEqual([expect.objectContaining({ state: 'conflict' })]);
  const plans = await store.records<{ profileRevision?: number }>('A', 'plan');
  expect(plans.map(record => record.id)).toEqual(['draft']);
  expect(selectActivePlan(plans, (await store.records<typeof draft>('A', 'profile'))[0], queue)).toBeUndefined();

  await store.resolveConflict('A', 'A', 'remote');
  expect(await store.pending('A')).toEqual([]);
  expect(await store.records('A', 'profile')).toEqual([expect.objectContaining({ revision: 3, payload: paused.data })]);
  expect(from.mock.calls.at(-1)).toEqual(['profiles']);
});

test('a corrupt recovery receipt leaves previously saved measurements and pending writes intact', async () => {
  await store.eraseLocalAccount('A');
  await store.switchAccount('A', true);
  await store.save('A', 'jump', { createdAt: new Date().toISOString(), heightM: 0.32 }, 'saved-jump');
  jest.mocked(Native.recoverAnalysis).mockResolvedValueOnce({ status: 'corrupt' });
  await expect(store.recoverAnalysis('A')).rejects.toBeInstanceOf(store.CorruptAnalysis);
  jest.mocked(Native.recoverAnalysis).mockResolvedValueOnce(null);
  await expect(store.recoverAnalysis('A')).resolves.toBeNull();
  expect(await store.records('A', 'jump')).toEqual([expect.objectContaining({ id: 'saved-jump' })]);
  expect(await store.pending('A')).toEqual([expect.objectContaining({ id: 'saved-jump', state: 'pending' })]);
});
