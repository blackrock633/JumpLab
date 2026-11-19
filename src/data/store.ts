import Native, { type AnalysisReceipt } from '../../modules/jump-analysis/src';
import { acceptedMeasurements } from '../core/measurement';
import * as SQLite from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';
import { accountClient } from './auth';
import type { Json } from './database.types';
import { drain, type Pending, type WriteKind, type Outcome } from '../core/queue';
import { initialize, assertOwner, changeAccount, putLocal, putBatch, type DiskRow, recentJumpRows, readPending, readPendingStatus, mergeRemote, mergeRemoteRows, reconcileWrite, workoutPlanState, markSignOut, type RemoteRow } from './local';

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
export class UnsyncedAccount extends Error {}
export async function switchAccount(owner: string, discard = false) {
  return serial(async () => {
    const db = await database();
    if (await signOutStatus()) throw Error('Finish erasing the previous sign-in before opening an account.');
    const previous = await cachedAccount();
    const preserve = previous !== owner && !discard ? previous : null;
    if (preserve && await db.getFirstAsync('SELECT 1 FROM pending WHERE owner=? LIMIT 1', preserve)) {
      throw new UnsyncedAccount('Another account has unsynced work on this iPhone.');
    }
    if (!await Native.setAccount(owner, preserve)) throw new UnsyncedAccount('Another account has unsynced work on this iPhone.');
    await changeAccount(db, owner);
  });
}
export async function eraseLocalAccount(owner: string) {
  return serial(async () => {
    const db = await database();
    const previous = await cachedAccount();
    if (previous && previous !== owner) return;
    await Native.setAccount(null, null);
    await changeAccount(db, null);
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
export type PendingStatus = Omit<Pending, 'payload' | 'replacement'> & { replacement?: { id: string } };
export async function pending(owner: string): Promise<PendingStatus[]> {
  return serial(async () => {
    const db = await database(); await assertOwner(db, owner);
    return readPendingStatus(db, owner);
  });
}
export async function resolveConflict(owner: string, id: string, choice: 'remote' | 'local') {
  const db = await database();
  const found = await serial(async () => {
    await assertOwner(db, owner);
    return db.getFirstAsync<{ value: string }>('SELECT value FROM pending WHERE owner=? AND id=?', owner, id);
  });
  const queued: Pending | null = found ? JSON.parse(found.value) : null;
  if (!queued || queued.state !== 'conflict') throw Error('This conflict is no longer pending. Refresh to review it.');
  const { client, isCurrent } = await accountClient(owner);
  let query = client.from(tables[queued.kind]).select('id,user_id,revision,data').eq('user_id', owner);
  if (queued.kind !== 'profile') query = query.eq('id', id);
  const { data, error } = await query.maybeSingle();
  if (!isCurrent() || error || (!data && (queued.kind !== 'plan' || choice !== 'remote'))) {
    throw Error('Could not load the saved version. Your local work is preserved.');
  }
  if (choice === 'local' && (queued.kind === 'jump' || queued.kind === 'plan')) throw Error('Saved measurements and plans are immutable. Keep the saved version or retain this local conflict for support.');
  const keepRemoteProfile = choice === 'remote' && queued.kind === 'profile';
  const savedProfile = keepRemoteProfile ? data?.data as { planBinding?: boolean; pain?: boolean } | null : null;
  let savedPlan: RemoteRow | null = null;
  if (data && savedProfile && !savedProfile.pain) {
    const plans = client.from('plans').select('id,user_id,revision,data,created_at').eq('user_id', owner);
    const matching = savedProfile.planBinding
      ? plans.filter('data->>profileRevision', 'eq', String(data.revision))
      : plans.or('data->>profileRevision.is.null,data->>profileRevision.eq.' + data.revision);
    const result = await matching.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1).maybeSingle();
    if (!isCurrent() || result.error || (savedProfile.planBinding && !result.data)) {
      throw Error('Could not load the saved training plan. Your local work is preserved.');
    }
    savedPlan = result.data;
    // The plan and profile are separate reads. Retain the conflict if the
    // profile advanced while reading the plan, including a new pain pause.
    const latest = await client.from('profiles').select('revision').eq('user_id', owner).eq('id', data.id).maybeSingle();
    if (!isCurrent() || latest.error || latest.data?.revision !== data.revision) {
      throw Error('Could not confirm the saved profile is still current. Review the conflict again. Your local work is preserved.');
    }
  }
  await serial(() => db.withExclusiveTransactionAsync(async tx => {
    await assertOwner(tx, owner);
    const latest = await tx.getFirstAsync<{ value: string }>('SELECT value FROM pending WHERE owner=? AND id=?', owner, id);
    if (!isCurrent() || latest?.value !== found?.value) throw Error('The local record changed. Review it again.');
    if (savedPlan) await mergeRemoteRows(tx, owner, 'plan', [savedPlan]);
    if (data && savedProfile?.planBinding && !savedProfile.pain) {
      if (!await tx.getFirstAsync(
        "SELECT 1 FROM records WHERE owner=? AND kind='plan' AND revision>0 AND json_extract(payload,'$.profileRevision')=? LIMIT 1",
        owner, data.revision,
      )) throw Error('Could not load the saved training plan. Your local work is preserved.');
    }
    if (!data) {
      // A plan built under an obsolete profile revision was never published.
      // Keep its local prescription available to open existing workout history.
      await tx.runAsync('DELETE FROM pending WHERE id=? AND owner=?', id, owner);
      return;
    }
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
  }));
  if (choice === 'remote' && queued.kind === 'plan') await hydrate(owner);
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
export class CorruptAnalysis extends Error {
  constructor() { super('Previous analysis data is damaged. Open Analyze to discard it and import again.'); }
}
export async function commitAnalysis(owner: string, receipt: AnalysisReceipt) {
  let results;
  try {
    results = acceptedMeasurements(receipt.analysis, receipt.ids, receipt.type, receipt.fps, receipt.confirmed, receipt.createdAt,
      receipt.analysis.detectorVersion !== 3);
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
  const receipt = await Native.recoverAnalysis(owner).catch(() => {
    throw Error('Could not read the previous analysis. Unlock this iPhone and retry saving.');
  });
  if (!receipt) return null;
  if ('status' in receipt) throw new CorruptAnalysis();
  return commitAnalysis(owner, receipt);
}
let syncing = false;
export async function sync(owner: string) {
  if (syncing) throw Error('Sync is already in progress. Try again shortly.');
  syncing = true;
  try { await syncPending(owner); } finally { syncing = false; }
}
async function syncPending(owner: string) {
  const db = await database();
  const writes = await serial(async () => {
    await assertOwner(db, owner);
    return readPending(db, owner, true);
  });
  if (!writes.length) return;
  const { client, isCurrent } = await accountClient(owner);
  let acknowledged: number | undefined;
  await drain(owner, writes, async w => {
    acknowledged = undefined;
    if (!isCurrent()) return 'unauthorized';
    const planState = await serial(async () => {
      await assertOwner(db, owner);
      const pending = await db.getFirstAsync<{ value: string }>('SELECT value FROM pending WHERE id=? AND owner=?', w.id, owner);
      return pending?.value === JSON.stringify(w) ? workoutPlanState(db, w) : 'waiting';
    });
    if (planState === 'waiting') return 'deferred';
    if (!isCurrent()) return 'unauthorized';
    const binding = w.kind === 'profile' && (w.payload as { planBinding?: boolean } | null)?.planBinding === true;
    const args = {
      kind: binding ? 'profile_plan' : w.kind,
      record_id: w.id, expected_revision: w.revision,
      payload: (binding ? { profile: w.payload, replacement: w.replacement ?? null } : w.payload) as Json,
    };
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 15_000);
    let response;
    try {
      if (typeof planState === 'object') {
        const { verifyPrescription } = planState;
        const { data, error, status } = await client.from('prescriptions').select('id')
          .eq('user_id', owner).eq('id', verifyPrescription).limit(1).abortSignal(controller.signal);
        if (!isCurrent() || status === 401) return 'unauthorized';
        if (error || !Array.isArray(data)) return 'transient';
        if (data.length === 0) return 'unpublished-plan';
        if (data[0]?.id !== verifyPrescription.toLowerCase()) return 'transient';
      }
      response = await client.rpc('save_record', args).abortSignal(controller.signal);
    } finally { clearTimeout(deadline); }
    if (!isCurrent()) return 'unauthorized';
    const { data, error } = response;
    const body = data && typeof data === 'object' && !Array.isArray(data) ? data : null;
    const revision = body?.revision;
    if (!error && typeof revision === 'number' && Number.isInteger(revision) && revision > 0) {
      acknowledged = revision;
      return 'ok';
    }
    if (error?.code === 'P0001' && error.message === 'mutation_quota') return 'rate-limited';
    const code = error?.code ?? (typeof body?.code === 'string' ? body.code : '');
    if (code.startsWith('22')) return 'invalid';
    return ({ '40001': 'conflict', '28000': 'unauthorized', 'PGRST301': 'unauthorized', '23505': 'conflict',
      '23503': 'invalid', '23514': 'invalid', '42501': 'invalid', 'P0001': 'invalid' } as Record<string, Outcome>)[code] ?? 'transient';
  }, async (_id, next, sent) => {
    await serial(async () => {
      if (isCurrent()) await reconcileWrite(db, sent, next, acknowledged);
    });
  });
}
const tables = { profile: 'profiles', plan: 'plans', workout: 'workouts', jump: 'jump_results' } as const;
export async function hydrate(owner: string, profileOnly = false) {
  const db = await database(); await serial(() => assertOwner(db, owner));
  const { client, isCurrent } = await accountClient(owner);
  for (const kind of profileOnly ? ['profile'] as const : ['profile', 'plan', 'workout', 'jump'] as const) {
    const limit = kind === 'profile' ? 1 : 100;
    const since = new Date(Date.now() - 90 * 86400000).toISOString();
    let cursor: { created_at: string; id: string } | undefined;
    for (;;) {
      const columns = 'id,user_id,revision,data,created_at';
      const selected = kind === 'jump' ? client.from('jump_history').select(columns) : client.from(tables[kind]).select(columns);
      let query = selected.eq('user_id', owner);
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
      const rows = data.map(row => {
        const { id, user_id, revision, created_at } = row;
        if (!id || !user_id || !revision || !created_at) throw Error('Invalid saved record.');
        return { id, user_id, revision, created_at, data: row.data };
      });
      await serial(async () => {
        if (!isCurrent()) throw Error('Account changed during refresh.');
        await mergeRemote(db, owner, kind, rows);
      });
      if (kind !== 'jump' || data.length < limit) break;
      const last = rows.at(-1)!;
      // The cursor comes from Postgres and must be a timestamp and UUID
      // before it is interpolated into PostgREST's filter grammar.
      if (!/^[0-9T:Z.+ -]+$/.test(last.created_at) || !Number.isFinite(Date.parse(last.created_at)) ||
        !/^[a-f0-9-]{36}$/i.test(last.id)) throw Error('Could not read the next page of measurements.');
      cursor = last;
    }
  }
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

export async function signOutStatus() {
  return (await database()).getFirstAsync<{ owner: string }>('SELECT owner FROM sign_out WHERE singleton=1');
}
export async function beginSignOut(owner: string) {
  await serial(async () => markSignOut(await database(), owner));
}
export async function clearSignOut(owner: string) {
  await serial(async () => { await (await database()).runAsync('DELETE FROM sign_out WHERE owner=?', owner); });
}
