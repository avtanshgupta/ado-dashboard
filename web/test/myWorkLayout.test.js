import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MY_WORK_WIDGETS, resolveLayout, toSaved, moveWidget, toggleWidget } from '../src/lib/myWorkLayout.js';

test('resolveLayout returns all widgets visible for an empty save', () => {
  const l = resolveLayout(null);
  assert.equal(l.length, MY_WORK_WIDGETS.length);
  assert.ok(l.every((w) => w.hidden === false));
  assert.ok(l.every((w) => typeof w.title === 'string'));
});

test('resolveLayout honors saved order and hidden flags', () => {
  const saved = [{ id: 'agents', hidden: false }, { id: 'myPrs', hidden: true }];
  const l = resolveLayout(saved);
  assert.equal(l[0].id, 'agents');
  assert.equal(l[1].id, 'myPrs');
  assert.equal(l[1].hidden, true);
  // Remaining catalogue widgets are appended (visible).
  assert.equal(l.length, MY_WORK_WIDGETS.length);
  assert.ok(l.slice(2).every((w) => !w.hidden));
});

test('resolveLayout drops unknown ids and de-dupes', () => {
  const l = resolveLayout([{ id: 'nope' }, { id: 'agents' }, { id: 'agents' }]);
  assert.equal(l.filter((w) => w.id === 'agents').length, 1);
  assert.equal(l.find((w) => w.id === 'nope'), undefined);
  assert.equal(l.length, MY_WORK_WIDGETS.length);
});

test('toSaved round-trips through resolveLayout', () => {
  const saved = toSaved(resolveLayout([{ id: 'agents', hidden: true }]));
  assert.deepEqual(saved[0], { id: 'agents', hidden: true });
  assert.equal(saved.length, MY_WORK_WIDGETS.length);
});

test('moveWidget swaps neighbors and is a no-op at the edges', () => {
  const l = resolveLayout(null);
  const moved = moveWidget(l, 0, 1);
  assert.equal(moved[0].id, l[1].id);
  assert.equal(moved[1].id, l[0].id);
  assert.equal(moveWidget(l, 0, -1), l); // can't move first up
  assert.equal(moveWidget(l, l.length - 1, 1), l); // can't move last down
});

test('toggleWidget flips only the targeted widget', () => {
  const l = resolveLayout(null);
  const t = toggleWidget(l, 'pipelines');
  assert.equal(t.find((w) => w.id === 'pipelines').hidden, true);
  assert.ok(t.filter((w) => w.hidden).length === 1);
});
