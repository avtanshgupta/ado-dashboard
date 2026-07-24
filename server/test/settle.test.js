import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleAll, settleFlat } from '../src/lib/settle.js';

// recordPartial is a no-op without a request context, so these run standalone.

test('settleAll returns all fulfilled values when nothing fails', async () => {
  const { results, failed } = await settleAll([1, 2, 3], async (n) => n * 10, { label: 'num' });
  assert.deepEqual(results, [10, 20, 30]);
  assert.deepEqual(failed, []);
});

test('settleAll keeps successes and collects failures instead of throwing', async () => {
  const { results, failed } = await settleAll(
    ['ok1', 'bad', 'ok2'],
    async (k) => {
      if (k === 'bad') throw new Error('boom');
      return k.toUpperCase();
    },
    { label: 'repo' }
  );
  assert.deepEqual(results, ['OK1', 'OK2']); // only fulfilled values
  assert.equal(failed.length, 1);
  assert.equal(failed[0].key, 'bad');
  assert.match(failed[0].message, /boom/);
});

test('settleAll handles a non-Error rejection reason', async () => {
  const { failed } = await settleAll(['x'], async () => { throw 'plain string'; }, { label: 'repo' });
  assert.equal(failed[0].message, 'plain string');
});

test('settleFlat flattens array results and drops the failed one', async () => {
  const out = await settleFlat(
    ['a', 'b', 'c'],
    async (k) => {
      if (k === 'b') throw new Error('nope');
      return [k, k];
    },
    { label: 'repo' }
  );
  assert.deepEqual(out, ['a', 'a', 'c', 'c']);
});

test('settleAll with an empty key list returns empty results', async () => {
  const { results, failed } = await settleAll([], async (x) => x);
  assert.deepEqual(results, []);
  assert.deepEqual(failed, []);
});
