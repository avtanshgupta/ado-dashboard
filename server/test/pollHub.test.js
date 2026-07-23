import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PollRegistry } from '../src/lib/pollHub.js';

test('first client for a user signals start; subsequent ones do not', () => {
  const r = new PollRegistry();
  const a = r.add('u1', { id: 'a' });
  assert.equal(a.isFirst, true);
  assert.equal(a.size, 1);
  const b = r.add('u1', { id: 'b' });
  assert.equal(b.isFirst, false);
  assert.equal(b.size, 2);
});

test('removing the last client for a user signals stop', () => {
  const r = new PollRegistry();
  const ca = { id: 'a' };
  const cb = { id: 'b' };
  r.add('u1', ca);
  r.add('u1', cb);
  const first = r.remove('u1', ca);
  assert.equal(first.isEmpty, false);
  assert.equal(first.size, 1);
  const second = r.remove('u1', cb);
  assert.equal(second.isEmpty, true);
  assert.equal(second.size, 0);
});

test('loops are isolated per user', () => {
  const r = new PollRegistry();
  assert.equal(r.add('u1', {}).isFirst, true);
  assert.equal(r.add('u2', {}).isFirst, true, 'each user starts its own loop');
  assert.equal(r.userCount(), 2);
  assert.equal(r.size('u1'), 1);
});

test('clients() returns the fan-out set for a user only', () => {
  const r = new PollRegistry();
  const a = { id: 'a' };
  const b = { id: 'b' };
  const c = { id: 'c' };
  r.add('u1', a);
  r.add('u1', b);
  r.add('u2', c);
  const u1 = r.clients('u1');
  assert.equal(u1.length, 2);
  assert.ok(u1.includes(a) && u1.includes(b));
  assert.deepEqual(r.clients('u2'), [c]);
  assert.deepEqual(r.clients('nobody'), []);
});

test('removing an unknown client is safe and reports empty', () => {
  const r = new PollRegistry();
  const res = r.remove('ghost', {});
  assert.equal(res.isEmpty, true);
  assert.equal(res.size, 0);
  assert.equal(r.userCount(), 0);
});

test('a user is dropped from the registry once empty, then can restart', () => {
  const r = new PollRegistry();
  const a = {};
  r.add('u1', a);
  r.remove('u1', a);
  assert.equal(r.userCount(), 0);
  // Reconnecting after teardown is a fresh "first" client again.
  assert.equal(r.add('u1', {}).isFirst, true);
});
