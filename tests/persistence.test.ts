import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, rmSync } from 'node:fs';
import { initialize, changeAccount, putLocal, putBatch, readPending, recentJumpRows, type LocalDB } from '../src/data/local.ts';
function adapter(file: string) {
  const raw = new DatabaseSync(file);
  const db: LocalDB = {
    async execAsync(s) { raw.exec(s); },
    async runAsync(s, ...p) { return raw.prepare(s).run(...p); },
    async getFirstAsync<T>(s: string, ...p: (string | number | null)[]) { return (raw.prepare(s).get(...p) as T) ?? null; },
    async getAllAsync<T>(s: string, ...p: (string | number | null)[]) { return raw.prepare(s).all(...p) as T[]; },
    async withExclusiveTransactionAsync(work) { raw.exec('BEGIN IMMEDIATE'); try { await work(db); raw.exec('COMMIT'); } catch (e) { raw.exec('ROLLBACK'); throw e; } },
  }; return { db, close: () => raw.close() };
}
test('production SQLite transactions retain workout/result and queue after reopening', async () => {
  mkdirSync('.cache/tests', { recursive: true }); const file = '.cache/tests/restart.sqlite'; rmSync(file, { force: true });
  let connection = adapter(file); await initialize(connection.db); await changeAccount(connection.db, 'A');
  await putLocal(connection.db, 'A', 'workout', { sets: [{ done: true }], completed: false }, 'w');
  await putLocal(connection.db, 'A', 'jump', { heightM: 0.2 }, 'j'); connection.close();
  connection = adapter(file); await initialize(connection.db); await changeAccount(connection.db, 'A');
  assert.equal((await connection.db.getAllAsync('SELECT id FROM records')).length, 2);
  assert.equal((await connection.db.getAllAsync('SELECT id FROM pending')).length, 2);
  await putLocal(connection.db, 'A', 'workout', { completed: true }, 'w');
  assert.equal((await connection.db.getAllAsync('SELECT id FROM records')).length, 2);
  assert.equal((await connection.db.getAllAsync('SELECT id FROM pending')).length, 2);
  await changeAccount(connection.db, 'B');
  assert.equal((await connection.db.getAllAsync('SELECT id FROM records')).length, 0);
  assert.equal((await connection.db.getAllAsync('SELECT id FROM pending')).length, 0);
  await assert.rejects(putLocal(connection.db, 'A', 'workout', {}, 'leak'), /Account changed/);
  await changeAccount(connection.db, null); connection.close();
});
test('failed queue insertion rolls back saved-work acknowledgement', async () => {
  const { db, close } = adapter(':memory:'); await initialize(db); await changeAccount(db, 'A');
  await db.execAsync("CREATE TRIGGER inject_failure BEFORE INSERT ON pending BEGIN SELECT RAISE(ABORT,'disk-full-simulation'); END;");
  await assert.rejects(putLocal(db, 'A', 'workout', { complete: true }, 'w'), /disk-full/);
  assert.equal((await db.getAllAsync('SELECT id FROM records')).length, 0); close();
});
test('repeated-jump results and their queue entries commit as one group or roll back', async () => {
  const { db, close } = adapter(':memory:'); await initialize(db); await changeAccount(db, 'A');
  await db.execAsync("CREATE TRIGGER fail_second BEFORE INSERT ON pending WHEN NEW.id='j2' BEGIN SELECT RAISE(ABORT,'disk-full-simulation'); END;");
  const values = ['j1', 'j2'].map(id => ({ id, kind: 'jump' as const, payload: { id } }));
  await assert.rejects(putBatch(db, 'A', values), /disk-full/);
  assert.equal((await db.getAllAsync('SELECT id FROM records')).length, 0);
  assert.equal((await db.getAllAsync('SELECT id FROM pending')).length, 0);
  await db.execAsync('DROP TRIGGER fail_second'); await putBatch(db, 'A', values);
  assert.equal((await db.getAllAsync('SELECT id FROM records')).length, 2);
  assert.equal((await db.getAllAsync('SELECT id FROM pending')).length, 2);
  await assert.rejects(putBatch(db, 'B', values), /Account changed/); close();
});

test('terminal writes cannot starve later sendable records', async () => {
  const { db, close } = adapter(':memory:'); await initialize(db); await changeAccount(db, 'A');
  for (let i = 0; i < 101; i++) {
    await db.runAsync('INSERT INTO pending(id,owner,value) VALUES(?,?,?)', String(i), 'A', JSON.stringify({ id: String(i), state: 'conflict' }));
  }
  await putLocal(db, 'A', 'workout', {}, 'send');
  assert.deepEqual((await readPending(db, 'A', true)).map(row => row.id), ['send']);
  assert.equal((await readPending(db, 'A')).length, 102);
  close();
});

test('date-scoped chart cache retains older in-range records and omits full frame traces', async () => {
  const { db, close } = adapter(':memory:'); await initialize(db); await changeAccount(db, 'A');
  const now = new Date();
  await putLocal(db, 'A', 'jump', { createdAt: now.toISOString(), type: 'running', timing: { timestamps: [1, 2], originalFPS: 60 } }, 'older');
  for (let i = 0; i < 501; i++) {
    await putLocal(db, 'A', 'jump', { createdAt: now.toISOString(), type: 'standing' }, 'newer-' + i);
  }
  await putLocal(db, 'A', 'jump', { createdAt: '2000-01-01T00:00:00Z', type: 'running' }, 'outdated');
  const rows = await recentJumpRows(db, 'A');
  assert.equal(rows.length, 502);
  assert.deepEqual(JSON.parse(rows.find(row => row.id === 'older')!.payload).timing, { originalFPS: 60 });
  close();
});

test('replaying a stable analysis receipt after SQLite commit does not requeue synced results', async () => {
  const { db, close } = adapter(':memory:'); await initialize(db); await changeAccount(db, 'A');
  const receipt = [{ kind: 'jump' as const, id: 'stable', payload: { airtime: 0.4 } }];
  await putBatch(db, 'A', receipt);
  await db.runAsync("UPDATE records SET revision=1 WHERE id='stable'");
  await db.runAsync("DELETE FROM pending WHERE id='stable'");
  await putBatch(db, 'A', receipt);
  assert.equal((await readPending(db, 'A')).length, 0);
  assert.equal((await db.getAllAsync('SELECT id FROM records')).length, 1);
  close();
});
