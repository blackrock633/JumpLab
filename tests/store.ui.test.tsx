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
