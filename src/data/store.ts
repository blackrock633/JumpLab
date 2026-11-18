import Native, { type AnalysisReceipt } from '../../modules/jump-analysis/src';
import { acceptedMeasurements } from '../core/measurement';
import * as SQLite from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';
import { accountClient } from './auth';
import type { Json } from './database.types';
import { drain, type Pending, type WriteKind, type Outcome } from '../core/queue';
import { initialize, assertOwner, changeAccount, putLocal, putBatch, type DiskRow, recentJumpRows, readPending, readPendingStatus } from './local';

export type LocalRecord<T = unknown> = { id: string; owner: string; kind: WriteKind; payload: T; revision: number };
let dbPromise: Promise<SQLite.SQLiteDatabase> | undefined;
async function database() {
  dbPromise ??= (async () => {
    const db = await SQLite.openDatabaseAsync('jumplab.db');
    try { await initialize(db); } catch (error) { await db.closeAsync().catch(() => {}); throw error; }
    return db;
  })().catch(error => { dbPromise = undefined; throw error; });
  return dbPromise;
}
export async function cachedAccount(): Promise<string | null> {
  const db = await database();
  return (await db.getFirstAsync<{ owner: string }>('SELECT owner FROM account WHERE singleton=1'))?.owner ?? null;
}
// A small local serial critical section prevents an acknowledgement racing a local edit.
let tail: Promise<unknown> = Promise.resolve();
function serial<T>(work: () => Promise<T>): Promise<T> { const next = tail.then(work, work); tail = next.catch(() => {}); return next; }
export async function switchAccount(owner: string | null) {
  return serial(async () => {
    const db = await database();
    await Native.setAccount(owner);
    await changeAccount(db, owner);
  });
}
export async function records<T>(owner: string, kind: WriteKind): Promise<LocalRecord<T>[]> {
  return serial(async () => {
    const db = await database(); await assertOwner(db, owner);
    const rows = kind === 'jump'
      ? await recentJumpRows(db, owner)
      : await db.getAllAsync<DiskRow>('SELECT id,owner,kind,payload,revision FROM records WHERE owner=? AND kind=? ORDER BY julianday(created_at) DESC,rowid DESC LIMIT 100', owner, kind);
    return rows.map(r => ({ ...r, payload: JSON.parse(r.payload) as T }));
  });
}
export type PendingStatus = Omit<Pending, 'payload'>;
export async function pending(owner: string): Promise<PendingStatus[]> {
  return serial(async () => {
    const db = await database(); await assertOwner(db, owner);
    return readPendingStatus(db, owner);
  });
}
export async function resolveConflict(owner: string, id: string, choice: 'remote' | 'local') {
  return serial(async () => {
    const db = await database(); await assertOwner(db, owner);
    const found = await db.getFirstAsync<{ value: string }>('SELECT value FROM pending WHERE owner=? AND id=?', owner, id);
    const queued: Pending | null = found ? JSON.parse(found.value) : null;
    if (!queued || queued.state !== 'conflict') throw Error('This conflict is no longer pending. Refresh to review it.');
    const { client, isCurrent } = await accountClient(owner);
    let query = client.from(tables[queued.kind]).select('id,user_id,revision,data').eq('user_id', owner);
    if (queued.kind !== 'profile') query = query.eq('id', id);
    const { data, error } = await query.maybeSingle();
    if (!isCurrent() || error || !data) throw Error('Could not load the saved version. Your local work is preserved.');
    if (choice === 'local' && (queued.kind === 'jump' || queued.kind === 'plan')) throw Error('Saved measurements and plans are immutable. Keep the saved version or retain this local conflict for support.');
    await db.withExclusiveTransactionAsync(async tx => {
      if (data.id !== id) {
        await tx.runAsync('DELETE FROM records WHERE id=? AND owner=?', data.id, owner);
        await tx.runAsync('UPDATE records SET id=? WHERE id=? AND owner=?', data.id, id, owner);
      }
      if (choice === 'remote') {
        await tx.runAsync('UPDATE records SET payload=?,revision=? WHERE id=? AND owner=?', JSON.stringify(data.data), data.revision, data.id, owner);
        await tx.runAsync('DELETE FROM pending WHERE id=? AND owner=?', id, owner);
      } else {
        await tx.runAsync('UPDATE records SET revision=? WHERE id=? AND owner=?', data.revision, data.id, owner);
        await tx.runAsync('UPDATE pending SET id=?,value=? WHERE id=? AND owner=?', data.id, JSON.stringify({ ...queued, id: data.id, revision: data.revision, state: 'pending', message: undefined }), id, owner);
      }
    });
  });
}
export async function save(owner: string, kind: WriteKind, payload: unknown, id = randomUUID()): Promise<string> {
  return serial(async () => {
    const db = await database(); await assertOwner(db, owner);
    return putLocal(db, owner, kind, payload, id);
  });
}
export async function saveBatch(owner: string, values: { kind: WriteKind; payload: unknown; id: string }[]) {
  return serial(async () => putBatch(await database(), owner, values));
}
export class RejectedAnalysis extends Error {}
export async function commitAnalysis(owner: string, receipt: AnalysisReceipt) {
  let results;
  try {
    results = acceptedMeasurements(receipt.analysis, receipt.ids, receipt.type, receipt.fps, receipt.confirmed, receipt.createdAt);
  } catch (error) {
    await Native.finishAnalysis(owner, receipt.id);
    throw new RejectedAnalysis(error instanceof Error ? error.message : 'Unsupported jump evidence.');
  }
  try {
    await saveBatch(owner, results.map(result => ({ kind: 'jump', payload: result, id: result.id })));
    await Native.finishAnalysis(owner, receipt.id);
    return results;
  } catch {
    throw Error('Could not finish saving the estimates. Retry saving here or reopen JumpLab to recover them.');
  }
}
export async function recoverAnalysis(owner: string) {
  const receipt = await Native.recoverAnalysis(owner);
  if (!receipt) return null;
  return commitAnalysis(owner, receipt);
}
export async function sync(owner: string) {
  return serial(async () => {
    const db = await database(); await assertOwner(db, owner);
    const writes = await readPending(db, owner, true);
    if (!writes.length) return;
    const { client, isCurrent } = await accountClient(owner);
    await drain(owner, writes, async w => {
      if (!isCurrent()) return 'unauthorized';
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 15_000);
      let response;
      try {
        response = await client.rpc('save_record', { kind: w.kind, record_id: w.id, expected_revision: w.revision, payload: w.payload as Json }).abortSignal(controller.signal);
      } finally { clearTimeout(deadline); }
      if (!isCurrent()) return 'unauthorized';
      const { data, error } = response;
      const body = data && typeof data === 'object' && !Array.isArray(data) ? data : null;
      const revision = body?.revision;
      if (!error && typeof revision === 'number' && Number.isInteger(revision) && revision > 0) {
        await db.runAsync('UPDATE records SET revision=? WHERE id=? AND owner=?', revision, w.id, owner);
        return 'ok';
      }
      if (error?.code === 'P0001' && error.message === 'mutation_quota') return 'rate-limited';
      const code = error?.code ?? (typeof body?.code === 'string' ? body.code : '');
      if (code.startsWith('22')) return 'invalid';
      return ({ '40001': 'conflict', '28000': 'unauthorized', 'PGRST301': 'unauthorized', '23505': 'conflict',
        '23503': 'invalid', '23514': 'invalid', '42501': 'invalid', 'P0001': 'invalid' } as Record<string, Outcome>)[code] ?? 'transient';
    }, async (id, next) => {
      if (next) await db.runAsync('UPDATE pending SET value=? WHERE id=? AND owner=?', JSON.stringify(next), id, owner);
      else await db.runAsync('DELETE FROM pending WHERE id=? AND owner=?', id, owner);
    });
  });
}
const tables = { profile: 'profiles', plan: 'plans', workout: 'workouts', jump: 'jump_results' } as const;
export async function hydrate(owner: string, profileOnly = false) {
  return serial(async () => {
    const db = await database(); await assertOwner(db, owner);
    const { client, isCurrent } = await accountClient(owner);
    for (const kind of profileOnly ? ['profile'] as const : ['profile', 'plan', 'workout', 'jump'] as const) {
      const limit = kind === 'profile' ? 1 : 100;
      const since = new Date(Date.now() - 90 * 86400000).toISOString();
      let cursor: { created_at: string; id: string } | undefined;
      for (;;) {
        let query = client.from(tables[kind]).select('id,user_id,revision,data,created_at').eq('user_id', owner);
        if (kind === 'jump') query = query.gte('created_at', since);
        if (cursor) {
          const { created_at: date, id } = cursor;
          query = query.or('created_at.lt.' + date + ',and(created_at.eq.' + date + ',id.lt.' + id + ')');
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15_000);
        const request = query.order('created_at', { ascending: false }).order('id', { ascending: false })
          .limit(limit).abortSignal(controller.signal);
        const { data, error } = await Promise.resolve(request).finally(() => clearTimeout(timeout));
        if (!isCurrent() || error || !data) throw Error('Could not refresh. Your saved local work is available.');
        await db.withExclusiveTransactionAsync(async tx => {
          for (const row of data) {
            if (row.user_id !== owner) throw Error('Account mismatch.');
            await tx.runAsync(`INSERT INTO records(id,owner,kind,payload,revision,created_at)
              SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM pending WHERE id=? OR (owner=? AND ?='profile' AND json_extract(value,'$.kind')='profile'))
              ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,created_at=excluded.created_at WHERE records.owner=excluded.owner`,
              row.id, owner, kind, JSON.stringify(row.data), row.revision, row.created_at, row.id, owner, kind);
          }
        });
        if (kind !== 'jump' || data.length < limit) break;
        const last = data.at(-1)!;
        // The cursor comes from Postgres and must be a timestamp and UUID
        // before it is interpolated into PostgREST's filter grammar.
        if (!/^[0-9T:Z.+ -]+$/.test(last.created_at) || !Number.isFinite(Date.parse(last.created_at)) ||
          !/^[a-f0-9-]{36}$/i.test(last.id)) throw Error('Could not read the next page of measurements.');
        cursor = last;
      }
    }
  });
}

export async function prescription<T>(owner: string, id: string) {
  const { client, isCurrent } = await accountClient(owner);
  const { data, error } = await client.from('prescriptions').select('data').eq('user_id', owner).eq('id', id).maybeSingle();
  if (!isCurrent() || error || !data) throw Error('Workout prescription unavailable. Reconnect and try again.');
  return data.data as T;
}

export type Deletion = { owner: string; confirmed: number };
export async function deletionStatus() {
  return (await database()).getFirstAsync<Deletion>('SELECT owner,confirmed FROM deletion WHERE singleton=1');
}
export async function confirmDeletion(owner: string) {
  const { client, isCurrent } = await accountClient(owner);
  const { error } = await client.rpc('delete_account');
  if (!isCurrent() || error) throw Error('Deletion could not be confirmed. Reconnect and retry.');
  await serial(async () => { await (await database()).runAsync('UPDATE deletion SET confirmed=1 WHERE owner=?', owner); });
}
export async function markDeletion(owner: string) {
  await serial(async () => {
    const db = await database(); await assertOwner(db, owner);
    await db.runAsync('INSERT INTO deletion(singleton,owner) VALUES(1,?) ON CONFLICT(singleton) DO NOTHING', owner);
  });
}
export async function clearDeletion(owner: string) {
  await serial(async () => { await (await database()).runAsync('DELETE FROM deletion WHERE owner=?', owner); });
}
