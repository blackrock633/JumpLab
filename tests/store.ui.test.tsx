import type { LocalDB } from '../src/data/local';
import * as store from '../src/data/store';
import { accountClient } from '../src/data/auth';

jest.mock('../modules/jump-analysis/src', () => ({
  __esModule: true, default: { setAccount: jest.fn().mockResolvedValue(true) },
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
  const refreshing = store.hydrate('A', true);
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
  const from = (table: string) => {
    const request = { select: () => request, eq: () => request, order: () => request, limit: () => request, gte: () => request,
      maybeSingle: async () => ({ error: null, data: profileRow }),
      abortSignal: async () => ({ error: null, data: table === 'profiles' ? [profileRow] : table === 'plans' ? [remotePlan] : [] }) };
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
  await store.resolveConflict('A', 'A', choice);
  await store.sync('A');
  if (choice === 'remote') {
    expect(rpc).toHaveBeenCalledTimes(1);
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
