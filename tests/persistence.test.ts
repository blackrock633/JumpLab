import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { initialize, assertOwner, changeAccount, markSignOut, progressSeriesLimit, workoutPlanState, putLocal, putBatch, readPending, recentJumpRows, mergeRemote, reconcileWrite, type LocalDB } from '../src/data/local.ts';
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
  mkdirSync('.cache/tests', { recursive: true });
  const folder = mkdtempSync('.cache/tests/restart-'), file = folder + '/records.sqlite';
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
  await changeAccount(connection.db, null); connection.close(); rmSync(folder, { recursive: true });
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
  assert.equal(rows.length, progressSeriesLimit + 1);
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

test('native measurement UUID stays unique through save, acknowledge, hydrate and disk restart', async () => {
  mkdirSync('.cache', { recursive: true });
  const folder = mkdtempSync('.cache/jump-'), file = folder + '/records.sqlite';
  const uppercase = 'AABBCCDD-AABB-CCDD-AABB-AABBCCDDEEFF', id = uppercase.toLowerCase();
  const createdAt = new Date().toISOString();
  const payload = { id: uppercase, createdAt, heightM: 0.2 };
  let connection = adapter(file);
  try {
    await initialize(connection.db); await changeAccount(connection.db, 'A');
    await putLocal(connection.db, 'A', 'jump', payload, uppercase);
    const [sent] = await readPending(connection.db, 'A');
    assert.equal(sent!.id, id);
    await reconcileWrite(connection.db, sent!, null, 1);
    await mergeRemote(connection.db, 'A', 'jump', [{ id, user_id: 'A', data: payload, revision: 1, created_at: createdAt }]);
    connection.close(); connection = adapter(file); await initialize(connection.db);
    await putLocal(connection.db, 'A', 'jump', payload, uppercase);
    assert.deepEqual((await recentJumpRows(connection.db, 'A')).map(row => [row.id, JSON.parse(row.payload).id]), [[id, id]]);
    assert.deepEqual(await readPending(connection.db, 'A'), []);
  } finally { connection.close(); rmSync(folder, { recursive: true }); }
});

test('legacy split identity reconciles pending writes without changing the original wire payload', async () => {
  const { db, close } = adapter(':memory:'); await initialize(db); await changeAccount(db, 'A');
  const payload = { id: 'ABC', createdAt: new Date().toISOString() };
  await db.runAsync("INSERT INTO records(id,owner,kind,payload,revision) VALUES('ABC','A','jump',?,0),('abc','A','jump',?,1)", JSON.stringify(payload), JSON.stringify(payload));
  await db.runAsync("INSERT INTO pending(id,owner,value) VALUES('ABC','A',?)", JSON.stringify({ id: 'ABC', owner: 'A', kind: 'jump', payload, revision: 0, state: 'pending', attempts: 0 }));
  await db.execAsync('PRAGMA user_version=0;');
  await initialize(db);
  assert.deepEqual((await recentJumpRows(db, 'A')).map(row => [row.id, JSON.parse(row.payload).id, row.revision]), [['abc', 'abc', 1]]);
  const [pending] = await readPending(db, 'A');
  assert.equal(pending!.id, 'abc');
  assert.deepEqual(pending!.payload, payload);
  close();
});

test('a slow acknowledgement and an older hydration snapshot preserve newer local workout edits', async () => {
  const { db, close } = adapter(':memory:'); await initialize(db); await changeAccount(db, 'A');
  await putLocal(db, 'A', 'workout', { reps: 3 }, 'w');
  const [sent] = await readPending(db, 'A');
  await putLocal(db, 'A', 'workout', { reps: 5 }, 'w');
  await reconcileWrite(db, sent!, null, 1);
  const [newer] = await readPending(db, 'A');
  assert.equal(newer!.revision, 1);
  assert.deepEqual(newer!.payload, { reps: 5 });
  await reconcileWrite(db, newer!, null, 2);
  await mergeRemote(db, 'A', 'workout', [{ id: 'w', user_id: 'A', data: { reps: 3 }, revision: 1, created_at: new Date().toISOString() }]);
  const saved = await db.getFirstAsync("SELECT payload,revision FROM records WHERE id='w'");
  assert.deepEqual({ ...saved as object }, { payload: '{"reps":5}', revision: 2 });
  close();
});

test('profile drafts and their prescriptions have one durable queue entry with atomic acknowledgement', async () => {
  const { db, close } = adapter(':memory:');
  await initialize(db); await changeAccount(db, 'A');
  const draft = (id: string, equipment: string) => putBatch(db, 'A', [
    { kind: 'profile', id: 'A', payload: { equipment } },
    { kind: 'plan', id, payload: { sessions: [{ prescriptionId: id + '-prescription' }] } },
  ]);
  await draft('plan-one', 'barbell');
  await putLocal(db, 'A', 'workout', { prescriptionId: 'plan-one-prescription' }, 'log');
  const [sent, log] = await readPending(db, 'A', true);
  assert.equal(sent!.replacement?.id, 'plan-one');
  assert.equal(await workoutPlanState(db, log!), 'waiting');
  await draft('plan-two', 'none');
  await reconcileWrite(db, sent!, null, 1);
  const [next, updatedLog] = await readPending(db, 'A', true);
  assert.equal(next!.revision, 1);
  assert.equal(next!.replacement?.id, 'plan-two');
  assert.equal(await workoutPlanState(db, updatedLog!), 'ready');
  assert.equal((await db.getFirstAsync<{ revision: number }>("SELECT revision FROM records WHERE id='plan-one'"))?.revision, 1);
  await assert.rejects(putLocal(db, 'A', 'plan', { profileRevision: 1 }, 'standalone'), /Sync the current profile/);
  close();
});

test('a confirmed erase stays locked across restart until the durable intent is cleared', async () => {
  mkdirSync('.cache/tests', { recursive: true });
  const folder = mkdtempSync('.cache/tests/signout-'), file = folder + '/records.sqlite';
  let connection = adapter(file);
  try {
    await initialize(connection.db); await changeAccount(connection.db, 'A');
    await putLocal(connection.db, 'A', 'workout', { sets: [5] }, 'private');
    await markSignOut(connection.db, 'A');
    connection.close(); connection = adapter(file); await initialize(connection.db);
    await assert.rejects(assertOwner(connection.db, 'A'), /Account changed/);
    await assert.rejects(putLocal(connection.db, 'A', 'workout', {}, 'new'), /Account changed/);
    await changeAccount(connection.db, null); connection.close();
    connection = adapter(file); await initialize(connection.db);
    assert.equal((await connection.db.getFirstAsync<{ owner: string }>('SELECT owner FROM sign_out'))?.owner, 'A');
    assert.deepEqual(await readPending(connection.db, 'A'), []);
    assert.deepEqual(await connection.db.getAllAsync('SELECT id FROM records'), []);
  } finally { connection.close(); rmSync(folder, { recursive: true }); }
});

test('legacy independent plan writes remain local for review after the queue upgrade', async () => {
  const { db, close } = adapter(':memory:');
  await initialize(db); await changeAccount(db, 'A');
  await db.execAsync('PRAGMA user_version=1');
  await db.runAsync('INSERT INTO pending(id,owner,value) VALUES(?,?,?)', 'legacy', 'A',
    JSON.stringify({ id: 'legacy', owner: 'A', kind: 'plan', state: 'pending', payload: {} }));
  await initialize(db);
  assert.deepEqual(await readPending(db, 'A', true), []);
  assert.match((await readPending(db, 'A'))[0]!.message!, /Edit your profile/);
  close();
});
