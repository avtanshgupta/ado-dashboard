import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CHECKLIST, normalizeChecklist, allChecked, composeReviewSummary } from '../src/lib/reviewChecklist.js';

test('normalizeChecklist falls back to the default set for bad input', () => {
  assert.deepEqual(normalizeChecklist(null), DEFAULT_CHECKLIST);
  assert.deepEqual(normalizeChecklist([]), DEFAULT_CHECKLIST);
  assert.deepEqual(normalizeChecklist([{ label: '   ' }]), DEFAULT_CHECKLIST);
});

test('normalizeChecklist trims, derives ids, and de-dupes', () => {
  const out = normalizeChecklist([{ label: ' Tests pass ' }, { label: 'Tests pass' }, { id: 'x', label: 'Custom' }]);
  assert.equal(out[0].label, 'Tests pass');
  assert.equal(out[0].id, 'tests-pass');
  assert.equal(out.filter((i) => i.id === 'tests-pass').length, 1); // deduped by derived id
  assert.equal(out[1].id, 'x');
});

test('allChecked is true only when every item id is ticked', () => {
  const items = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
  assert.equal(allChecked(items, ['a', 'b']), true);
  assert.equal(allChecked(items, new Set(['a'])), false);
  assert.equal(allChecked([], []), false); // empty checklist is never "all checked"
});

test('composeReviewSummary renders GitHub-style task list with a tally', () => {
  const items = [{ id: 'a', label: 'Tests added' }, { id: 'b', label: 'Docs updated' }];
  const md = composeReviewSummary(items, new Set(['a']));
  assert.match(md, /### Review checklist/);
  assert.match(md, /- \[x\] Tests added/);
  assert.match(md, /- \[ \] Docs updated/);
  assert.match(md, /_1 of 2 items checked\._/);
});

test('composeReviewSummary accepts an array and a custom title', () => {
  const md = composeReviewSummary([{ id: 'a', label: 'A' }], ['a'], { title: 'My review' });
  assert.match(md, /### My review/);
  assert.match(md, /_1 of 1 items checked\._/);
});
