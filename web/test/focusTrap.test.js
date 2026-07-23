import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTrappedFocusIndex } from '../src/components/focusTrap.js';
import { errorStateFromError, haveResetKeysChanged } from '../src/components/errorBoundaryState.js';

test('focus trap cycles forward and backward', () => {
  assert.equal(getTrappedFocusIndex(2, 3), 0);
  assert.equal(getTrappedFocusIndex(0, 3, true), 2);
  assert.equal(getTrappedFocusIndex(1, 3), 2);
  assert.equal(getTrappedFocusIndex(1, 3, true), 0);
});

test('focus trap handles missing focus and empty lists', () => {
  assert.equal(getTrappedFocusIndex(-1, 3), 0);
  assert.equal(getTrappedFocusIndex(-1, 3, true), 2);
  assert.equal(getTrappedFocusIndex(0, 0), -1);
});

test('error boundary helpers reset only when route keys change', () => {
  const err = new Error('boom');
  assert.deepEqual(errorStateFromError(err), { error: err });
  assert.equal(haveResetKeysChanged(['/a', 'q=1'], ['/a', 'q=1']), false);
  assert.equal(haveResetKeysChanged(['/a'], ['/b']), true);
  assert.equal(haveResetKeysChanged(['/a'], ['/a', 'q=1']), true);
});
