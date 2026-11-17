import test from 'node:test';
import assert from 'node:assert/strict';
import { drain, settle, type Pending } from '../src/core/queue.ts';
import { recoveryCode } from '../src/core/auth-link.ts';
const write: Pending = { id: 'stable-id', owner: 'A', kind: 'workout', revision: 0, payload: { sets: [] }, state: 'pending', attempts: 0 };
test('retry survives serialization/restart with stable id and explicit outcomes', () => {
  assert.equal(settle(write, 'ok'), null);
  const retry = settle(write, 'transient')!;
  assert.deepEqual(JSON.parse(JSON.stringify(retry)), retry);
  assert.equal(retry.id, write.id); assert.equal(retry.attempts, 1); assert.equal(retry.state, 'retry');
  assert.equal(settle(write, 'conflict')!.state, 'conflict'); assert.equal(settle(write, 'invalid')!.state, 'error');
  assert.match(settle(write, 'unauthorized')!.message!, /Sign in/);
});
test('queue halts on network/auth failure; never replays another account', async () => {
  const sent: string[] = [], saved: unknown[] = [];
  await drain('A', [write, { ...write, id: 'second' }], async w => { sent.push(w.id); throw Error('offline'); }, async (_, next) => { saved.push(next); });
  assert.deepEqual(sent, ['stable-id']); assert.equal(saved.length, 1);
  await assert.rejects(drain('B', [write], async () => { assert.fail('must not send'); }, async () => {}), /Account mismatch/);
  await drain('A', [{ ...write, state: 'conflict' }, { ...write, state: 'error' }], async () => { assert.fail('must not retry terminal states'); }, async () => {});
});
test('authentication redirects require exact origin/path and a PKCE code', () => {
  assert.equal(recoveryCode('jumplab://auth/callback?code=abcdefghijklmnop123'), 'abcdefghijklmnop123');
  for (const link of ['https://auth/callback?code=abcdefghijklmnop', 'jumplab://evil/callback?code=abcdefghijklmnop', 'jumplab://auth/other?code=abcdefghijklmnop', 'jumplab://auth/callback#access_token=secret', 'jumplab://auth/callback?code=short', 'jumplab://auth/callback?code=abcdefghijklmnop&next=evil', 'jumplab://auth/callback?code=abcdefghijklmnop&code=abcdefghijklmnop']) assert.throws(() => recoveryCode(link));
});
test('server quota preserves a retry and stops further writes without a polling loop', async () => {
  const sent: string[] = [], saved: Pending[] = [];
  await drain('A', [write, { ...write, id: 'next' }], async w => { sent.push(w.id); return 'rate-limited'; }, async (_, next) => { if (next) saved.push(next); });
  assert.deepEqual(sent, ['stable-id']); assert.equal(saved[0]!.state, 'retry'); assert.match(saved[0]!.message!, /quota window/);
});
