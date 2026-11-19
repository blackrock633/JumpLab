import type { Pending, WriteKind } from '../core/queue';
export interface LocalDB {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: (string | number | null)[]): Promise<unknown>;
  getFirstAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T | null>;
  getAllAsync<T>(sql: string, ...params: (string | number | null)[]): Promise<T[]>;
  withExclusiveTransactionAsync(work: (tx: LocalDB) => Promise<void>): Promise<void>;
}
export type DiskRow = { id: string; owner: string; kind: WriteKind; payload: string; revision: number };
export async function initialize(db: LocalDB) {
  await db.execAsync(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;
    CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS records_owner_kind ON records(owner,kind);
    CREATE TABLE IF NOT EXISTS pending(id TEXT PRIMARY KEY, owner TEXT NOT NULL, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS account(singleton INTEGER PRIMARY KEY CHECK(singleton=1), owner TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sign_out(singleton INTEGER PRIMARY KEY CHECK(singleton=1), owner TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS deletion(singleton INTEGER PRIMARY KEY CHECK(singleton=1), owner TEXT NOT NULL, confirmed INTEGER NOT NULL DEFAULT 0);
  `);
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(records)');
  if (!columns.some(c => c.name === 'created_at')) {
    await db.execAsync("ALTER TABLE records ADD COLUMN created_at TEXT NOT NULL DEFAULT ''; UPDATE records SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');");
  }
  const version = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  if (version?.user_version === 0) await db.withExclusiveTransactionAsync(async tx => {
    const mixed = await tx.getAllAsync<DiskRow>("SELECT id,owner,kind,payload,revision FROM records WHERE kind='jump' AND id<>lower(id)");
    for (const row of mixed) {
      const id = row.id.toLowerCase();
      const existing = await tx.getFirstAsync<DiskRow>('SELECT id,owner,kind,payload,revision FROM records WHERE id=? AND owner=?', id, row.owner);
      const queued = await tx.getFirstAsync<{ value: string }>('SELECT value FROM pending WHERE id=? AND owner=?', row.id, row.owner);
      if (!existing || queued) {
        await tx.runAsync('UPDATE records SET id=?,payload=? WHERE id=? AND owner=?', id, JSON.stringify({ ...JSON.parse(row.payload), id }), existing ? id : row.id, row.owner);
      }
      if (queued) {
        // Preserve the legacy wire payload for lost-acknowledgment retries.
        await tx.runAsync('UPDATE OR IGNORE pending SET id=?,value=json_set(value,\'$.id\',?) WHERE id=? AND owner=?', id, id, row.id, row.owner);
      }
      await tx.runAsync('DELETE FROM pending WHERE id=? AND owner=?', row.id, row.owner);
      await tx.runAsync('DELETE FROM records WHERE id=? AND owner=?', row.id, row.owner);
    }
    await tx.runAsync(`UPDATE records SET payload=json_set(payload,'$.id',id)
      WHERE kind='jump' AND lower(json_extract(payload,'$.id'))=id AND json_extract(payload,'$.id')<>id`);
    await tx.execAsync('PRAGMA user_version=1;');
  });
  if ((version?.user_version ?? 0) < 2) await db.withExclusiveTransactionAsync(async tx => {
    // A legacy split write has no provable link to the profile used to build it.
    await tx.runAsync(`UPDATE pending SET value=json_set(value,'$.state','error','$.message',
      'This draft predates linked plan sync. Edit your profile to rebuild your plan; local workout history is preserved.')
      WHERE json_extract(value,'$.kind')='plan' AND json_extract(value,'$.payload.profileRevision') IS NULL`);
    await tx.execAsync('PRAGMA user_version=2;');
  });
  if ((version?.user_version ?? 0) < 3) await db.withExclusiveTransactionAsync(async tx => {
    // Older versions marked these terminal using only local publication state.
    await tx.runAsync(`UPDATE pending SET value=json_remove(json_set(value,'$.state','retry'),'$.message')
      WHERE json_extract(value,'$.kind')='workout' AND json_extract(value,'$.state')='error'
        AND json_extract(value,'$.message')=?`,
      'Its prescription was never published. This workout is preserved in local history.');
    await tx.execAsync('PRAGMA user_version=3;');
  });
}
export const progressSeriesLimit = 100;
export async function recentJumpRows(db: LocalDB, owner: string) {
  return db.getAllAsync<DiskRow>(`WITH ranked AS (
    SELECT id, row_number() OVER (
      PARTITION BY json_extract(payload,'$.type'), json_extract(payload,'$.method')
      ORDER BY julianday(json_extract(payload,'$.createdAt')) DESC,id DESC
    ) AS position
    FROM records WHERE owner=? AND kind='jump' AND julianday(json_extract(payload,'$.createdAt')) >= julianday('now','-90 days')
  ) SELECT r.id,r.owner,r.kind,json_remove(r.payload,'$.timing.timestamps') AS payload,r.revision
    FROM ranked JOIN records r ON r.id=ranked.id WHERE ranked.position<=?`, owner, progressSeriesLimit);
}
export async function readPending(db: LocalDB, owner: string, sendable = false): Promise<Pending[]> {
  // Queued parents can publish earlier in the same batch. Conflicted parents
  // require user action, so their workouts must not consume dispatch slots.
  const sql = sendable
    ? `SELECT w.value FROM pending w WHERE w.owner=?1 AND json_extract(w.value,'$.state') IN ('pending','retry')
        AND NOT COALESCE(json_extract(w.value,'$.kind')='workout' AND json_extract(w.value,'$.payload.prescriptionId') IN (
          SELECT json_extract(s.value,'$.prescriptionId') FROM pending q JOIN records r ON r.owner=q.owner
            AND (q.id=r.id OR json_extract(q.value,'$.replacement.id')=r.id)
          JOIN json_each(r.payload,'$.sessions') s
          WHERE q.owner=?1 AND r.kind='plan' AND r.revision<=0
            AND json_extract(q.value,'$.state')='conflict'
        ),0)
        ORDER BY CASE WHEN json_extract(w.value,'$.kind') IN ('profile','plan') THEN 0 ELSE 1 END,w.rowid LIMIT 60`
    : 'SELECT value FROM pending WHERE owner=? ORDER BY rowid';
  return (await db.getAllAsync<{ value: string }>(sql, owner)).map(r => JSON.parse(r.value) as Pending);
}
export async function readPendingStatus(db: LocalDB, owner: string): Promise<(Omit<Pending, 'payload' | 'replacement'> & { replacement?: { id: string } })[]> {
  const rows = await db.getAllAsync<{ value: string }>("SELECT json_remove(value,'$.payload','$.replacement.payload') AS value FROM pending WHERE owner=? ORDER BY rowid", owner);
  return rows.map(row => JSON.parse(row.value));
}
export async function assertOwner(db: LocalDB, owner: string) {
  if (await db.getFirstAsync('SELECT 1 FROM sign_out WHERE owner=?', owner) ||
    (await db.getFirstAsync<{ owner: string }>('SELECT owner FROM account WHERE singleton=1'))?.owner !== owner) throw Error('Account changed. Reopen this screen.');
}
export async function changeAccount(db: LocalDB, owner: string | null) {
  const old = await db.getFirstAsync<{ owner: string }>('SELECT owner FROM account WHERE singleton=1');
  if (old?.owner === owner) return;
  await db.withExclusiveTransactionAsync(async tx => {
    await tx.runAsync('DELETE FROM pending'); await tx.runAsync('DELETE FROM records'); await tx.runAsync('DELETE FROM account');
    if (owner) await tx.runAsync('INSERT INTO account(singleton,owner) VALUES(1,?)', owner);
  });
  await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE); VACUUM;');
}
export async function putLocal(db: LocalDB, owner: string, kind: WriteKind, payload: unknown, id: string) {
  if (kind === 'jump') id = id.toLowerCase();
  await putBatch(db, owner, [{ kind, payload, id }]);
  return id;
}
// Measurements from one clip and profile/plan updates commit together, including their queue entries.
export async function putBatch(db: LocalDB, owner: string, values: { kind: WriteKind; payload: unknown; id: string }[]) {
  values = values.map(value => {
    if (value.kind !== 'jump') return value;
    const id = value.id.toLowerCase();
    const payload = value.payload as { id?: string };
    return { ...value, id, payload: payload?.id ? { ...payload, id } : payload };
  });
  if (!values.length || values.length > 180 || new Set(values.map(v => v.id)).size !== values.length) throw Error('Invalid local save batch.');
  await assertOwner(db, owner);
  await db.withExclusiveTransactionAsync(async tx => {
    await assertOwner(tx, owner);

    const profile = values.find(value => value.kind === 'profile');
    const plan = profile && values.find(value => value.kind === 'plan');
    const replacement = plan ? { id: plan.id, payload: plan.payload } : undefined;
    for (const value of values) {
      const { id, kind } = value;
      let { payload } = value;
      if (kind === 'profile') payload = { ...payload as object, planBinding: true };
      if (kind === 'plan' && !profile) {
        if (await tx.getFirstAsync("SELECT 1 FROM pending WHERE owner=? AND json_extract(value,'$.kind')='profile'", owner)) {
          throw Error('Sync the current profile and plan before preparing another week.');
        }
        const basis = await tx.getFirstAsync<{ revision: number }>("SELECT revision FROM records WHERE owner=? AND kind='profile'", owner);
        if (!basis?.revision) throw Error('Sync the training profile before preparing another week.');
        if ((payload as { profileRevision?: number }).profileRevision !== basis.revision) {
          throw Error('The training profile changed. Refresh the plan before preparing another week.');
        }
      }
      const row = await tx.getFirstAsync<DiskRow>('SELECT id,owner,kind,payload,revision FROM records WHERE id=? AND owner=?', id, owner);
      const queued: Pending = { id, owner, kind, revision: row?.revision ?? 0, payload, state: 'pending', attempts: 0, ...(kind === 'profile' && replacement ? { replacement } : {}) };
      if (kind === 'jump' && row?.kind === kind) continue;
      if (row && row.kind !== kind) throw Error('Record kind mismatch.');
      await tx.runAsync('INSERT INTO records(id,owner,kind,payload,revision) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload', id, owner, kind, JSON.stringify(payload), queued.revision);
      if (plan?.id === id) continue; // This draft publishes in the profile transaction.
      await tx.runAsync('INSERT INTO pending(id,owner,value) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', id, owner, JSON.stringify(queued));
    }
  });
}

export type RemoteRow = { id: string; user_id: string; revision: number; data: unknown; created_at: string };
export async function mergeRemote(db: LocalDB, owner: string, kind: WriteKind, rows: RemoteRow[]) {
  await db.withExclusiveTransactionAsync(async tx => {
    await assertOwner(tx, owner);
    await mergeRemoteRows(tx, owner, kind, rows);
  });
}

export async function mergeRemoteRows(tx: LocalDB, owner: string, kind: WriteKind, rows: RemoteRow[]) {
  for (const row of rows) {
    if (row.user_id !== owner) throw Error('Account mismatch.');
    const id = row.id.toLowerCase();
    if (kind === 'profile') await tx.runAsync(`DELETE FROM records WHERE owner=? AND kind='profile' AND id<>?
      AND NOT EXISTS(SELECT 1 FROM pending WHERE owner=? AND json_extract(value,'$.kind')='profile')`, owner, id, owner);
    const payload = kind === 'jump' ? { ...(row.data as object), id } : row.data;
    await tx.runAsync(`INSERT INTO records(id,owner,kind,payload,revision,created_at)
      SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM pending WHERE id=? OR (owner=? AND ?='profile' AND json_extract(value,'$.kind')='profile'))
      ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,created_at=excluded.created_at
      WHERE records.owner=excluded.owner AND records.revision<=excluded.revision`,
      id, owner, kind, JSON.stringify(payload), row.revision, row.created_at, id, owner, kind);
  }
}
export async function reconcileWrite(db: LocalDB, sent: Pending, next: Pending | null, revision?: number) {
  await db.withExclusiveTransactionAsync(async tx => {
    await assertOwner(tx, sent.owner);
    const row = await tx.getFirstAsync<{ value: string }>('SELECT value FROM pending WHERE id=? AND owner=?', sent.id, sent.owner);
    if (revision !== undefined && sent.replacement) {
      // A newer edit may have superseded the draft while this request was in flight.
      await tx.runAsync(`UPDATE records SET revision=1,payload=json_set(payload,'$.profileRevision',?)
        WHERE id=? AND owner=? AND kind='plan'`, revision, sent.replacement.id, sent.owner);
    }
    if (!row) return;
    const current = JSON.parse(row.value) as Pending;
    const unchanged = JSON.stringify(current) === JSON.stringify(sent);
    if (revision !== undefined && current.revision === sent.revision) {
      await tx.runAsync('UPDATE records SET revision=? WHERE id=? AND owner=?', revision, sent.id, sent.owner);
      if (!unchanged) next = { ...current, revision };
    } else if (!unchanged) return;
    if (next) await tx.runAsync('UPDATE pending SET value=? WHERE id=? AND owner=?', JSON.stringify(next), sent.id, sent.owner);
    else await tx.runAsync('DELETE FROM pending WHERE id=? AND owner=?', sent.id, sent.owner);
  });
}

// Wait for queued plans, and verify superseded drafts whose acknowledgement may have been lost.
export async function workoutPlanState(db: LocalDB, write: Pending): Promise<'ready' | 'waiting' | { verifyPrescription: string }> {
  if (write.kind !== 'workout') return 'ready';
  const prescriptionId = (write.payload as { prescriptionId?: string } | null)?.prescriptionId;
  if (!prescriptionId) return 'ready'; // The RPC validates the workout shape.
  const plan = await db.getFirstAsync<{ id: string; revision: number }>(`SELECT r.id,r.revision FROM records r,
    json_each(r.payload,'$.sessions') s WHERE r.owner=? AND r.kind='plan' AND json_extract(s.value,'$.prescriptionId')=? LIMIT 1`,
    write.owner, prescriptionId);
  if (!plan || plan.revision > 0) return 'ready';
  const queued = await db.getFirstAsync(`SELECT 1 FROM pending WHERE owner=? AND
    ((id=? AND json_extract(value,'$.state') IN ('pending','retry','conflict')) OR
      (json_extract(value,'$.replacement.id')=? AND json_extract(value,'$.state') <> 'error'))
    LIMIT 1`, write.owner, plan.id, plan.id);
  return queued ? 'waiting' : { verifyPrescription: prescriptionId };
}

export async function markSignOut(db: LocalDB, owner: string) {
  await db.withExclusiveTransactionAsync(async tx => {
    await assertOwner(tx, owner);
    await tx.runAsync('INSERT INTO sign_out(singleton,owner) VALUES(1,?)', owner);
  });
}
