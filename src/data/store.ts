import * as SQLite from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';
import { supabase } from './auth';
import type { Json } from './database.types';
import { drain, type Pending, type WriteKind, type Outcome } from '../core/queue';
import { initialize, assertOwner, changeAccount, putLocal, putBatch, type DiskRow } from './local';

export type LocalRecord<T = unknown> = { id: string; owner: string; kind: WriteKind; payload: T; revision: number };
let dbPromise: Promise<SQLite.SQLiteDatabase> | undefined;
async function database() {
  dbPromise ??= (async () => {
    const db = await SQLite.openDatabaseAsync('jumplab.db');
    await initialize(db);
    return db;
  })();
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
    await changeAccount(db, owner);
  });
}
export async function records<T>(owner: string, kind: WriteKind): Promise<LocalRecord<T>[]> {
  return serial(async () => {
    const db = await database(); await assertOwner(db, owner);
    const rows = await db.getAllAsync<DiskRow>('SELECT id,owner,kind,payload,revision FROM records WHERE owner=? AND kind=? ORDER BY julianday(created_at) DESC,rowid DESC LIMIT 500', owner, kind);
    return rows.map(r => ({ ...r, payload: JSON.parse(r.payload) as T }));
  });
}
export async function pending(owner: string): Promise<Pending[]> {
  const db = await database(); await assertOwner(db, owner);
  return (await db.getAllAsync<{ value: string }>('SELECT value FROM pending WHERE owner=? ORDER BY rowid LIMIT 100', owner)).map(r => JSON.parse(r.value) as Pending);
}
export async function resolveConflict(owner: string, id: string, choice: 'remote' | 'local') {
  return serial(async () => {
    const db = await database(); await assertOwner(db, owner);
    const queued = (await pending(owner)).find(w => w.id === id);
    if (!queued || queued.state !== 'conflict') throw Error('This conflict is no longer pending. Refresh to review it.');
    const auth = (await supabase.auth.getSession()).data.session;
    if (auth?.user.id !== owner) throw Error('Sign in to this account before resolving a conflict.');
    const { data, error } = await supabase.from(tables[queued.kind]).select('id,user_id,revision,data').eq('id', id).eq('user_id', owner).maybeSingle();
    if (error || !data) throw Error('Could not load the saved version. Your local work is preserved.');
    if (choice === 'local' && (queued.kind === 'jump' || queued.kind === 'plan')) throw Error('Saved measurements and plans are immutable. Keep the saved version or retain this local conflict for support.');
    await db.withExclusiveTransactionAsync(async tx => {
      if (choice === 'remote') {
        await tx.runAsync('UPDATE records SET payload=?,revision=? WHERE id=? AND owner=?', JSON.stringify(data.data), data.revision, id, owner);
        await tx.runAsync('DELETE FROM pending WHERE id=? AND owner=?', id, owner);
      } else {
        await tx.runAsync('UPDATE records SET revision=? WHERE id=? AND owner=?', data.revision, id, owner);
        await tx.runAsync('UPDATE pending SET value=? WHERE id=? AND owner=?', JSON.stringify({ ...queued, revision: data.revision, state: 'pending', message: undefined }), id, owner);
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
export async function sync(owner: string) {
  return serial(async () => {
    const db = await database(); await assertOwner(db, owner);
    await drain(owner, await pending(owner), async w => {
      const session = (await supabase.auth.getSession()).data.session;
      if (session?.user.id !== owner) return 'unauthorized';
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 15_000);
      let response;
      try {
        response = await supabase.rpc('save_record', { kind: w.kind, record_id: w.id, expected_revision: w.revision, payload: w.payload as Json }).abortSignal(controller.signal);
      } finally { clearTimeout(deadline); }
      const { data, error } = response;
      if (!error && Number.isInteger(data)) {
        await db.runAsync('UPDATE records SET revision=? WHERE id=? AND owner=?', data!, w.id, owner);
        return 'ok';
      }
      if (!error) return 'transient';
      if (error.code === 'P0001') return error.message === 'mutation_quota' ? 'rate-limited' : 'invalid';
      return ({ '40001': 'conflict', '28000': 'unauthorized', 'PGRST301': 'unauthorized', '23505': 'conflict', '22023': 'invalid', '22P02': 'invalid', '23503': 'invalid', '23514': 'invalid', '42501': 'invalid' } as Record<string, Outcome>)[error.code] ?? 'transient';
    }, async (id, next) => {
      if (next) await db.runAsync('UPDATE pending SET value=? WHERE id=? AND owner=?', JSON.stringify(next), id, owner);
      else await db.runAsync('DELETE FROM pending WHERE id=? AND owner=?', id, owner);
    });
  });
}
const tables = { profile: 'profiles', plan: 'plans', workout: 'workouts', jump: 'jump_results' } as const;
export async function hydrate(owner: string) {
  // One bounded page per domain, no per-session queries. Local pending edits win until explicitly resolved.
  return serial(async () => {
    const db = await database(); await assertOwner(db, owner);
    for (const kind of ['profile', 'plan', 'workout', 'jump'] as const) {
      const { data, error } = await supabase.from(tables[kind]).select('id,user_id,revision,data,created_at').eq('user_id', owner).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(kind === 'profile' ? 1 : 100);
      if (error) throw Error('Could not refresh. Your saved local work is available.');
      for (const row of [...(data ?? [])].reverse()) {
        if (row.user_id !== owner) throw Error('Account mismatch.');
        if (await db.getFirstAsync('SELECT id FROM pending WHERE id=?', row.id)) continue;
        await db.runAsync('INSERT INTO records(id,owner,kind,payload,revision,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,created_at=excluded.created_at', row.id, owner, kind, JSON.stringify(row.data), row.revision, row.created_at);
      }
    }
  });
}
