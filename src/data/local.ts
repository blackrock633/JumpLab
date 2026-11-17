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
    CREATE TABLE IF NOT EXISTS account(singleton INTEGER PRIMARY KEY CHECK(singleton=1), owner TEXT NOT NULL);`);
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(records)');
  if (!columns.some(c => c.name === 'created_at')) {
    await db.execAsync("ALTER TABLE records ADD COLUMN created_at TEXT NOT NULL DEFAULT ''; UPDATE records SET created_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');");
  }
}
export async function assertOwner(db: LocalDB, owner: string) {
  if ((await db.getFirstAsync<{ owner: string }>('SELECT owner FROM account WHERE singleton=1'))?.owner !== owner) throw Error('Account changed. Reopen this screen.');
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
  await putBatch(db, owner, [{ kind, payload, id }]);
  return id;
}
// Measurements from one clip and profile/plan updates commit together, including their queue entries.
export async function putBatch(db: LocalDB, owner: string, values: { kind: WriteKind; payload: unknown; id: string }[]) {
  if (!values.length || values.length > 100 || new Set(values.map(v => v.id)).size !== values.length) throw Error('Invalid local save batch.');
  await assertOwner(db, owner);
  await db.withExclusiveTransactionAsync(async tx => {
    await assertOwner(tx, owner);
    for (const { id, kind, payload } of values) {
      const row = await tx.getFirstAsync<DiskRow>('SELECT id,owner,kind,payload,revision FROM records WHERE id=? AND owner=?', id, owner);
      const queued: Pending = { id, owner, kind, revision: row?.revision ?? 0, payload, state: 'pending', attempts: 0 };
      if (row && row.kind !== kind) throw Error('Record kind mismatch.');
      await tx.runAsync('INSERT INTO records(id,owner,kind,payload,revision) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload', id, owner, kind, JSON.stringify(payload), queued.revision);
      await tx.runAsync('INSERT INTO pending(id,owner,value) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value', id, owner, JSON.stringify(queued));
    }
  });
}
