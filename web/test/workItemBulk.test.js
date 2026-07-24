import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTag, tagsToField, tagFieldWithAdded, summarize } from '../src/lib/workItemBulk.js';

test('addTag appends a new tag and trims it', () => {
  assert.deepEqual(addTag(['a', 'b'], '  c '), ['a', 'b', 'c']);
});

test('addTag de-duplicates case-insensitively, keeping existing casing', () => {
  assert.deepEqual(addTag(['Regression'], 'regression'), ['Regression']);
  assert.deepEqual(addTag(['Regression'], 'REGRESSION'), ['Regression']);
});

test('addTag ignores blank tags and tolerates a missing list', () => {
  assert.deepEqual(addTag(['a'], '   '), ['a']);
  assert.deepEqual(addTag(undefined, 'x'), ['x']);
  assert.deepEqual(addTag(null, ''), []);
});

test('tagsToField serializes to the ADO semicolon format and drops blanks', () => {
  assert.equal(tagsToField(['a', ' b ', '', 'c']), 'a; b; c');
  assert.equal(tagsToField([]), '');
});

test('tagFieldWithAdded returns the new field string when the tag is added', () => {
  assert.equal(tagFieldWithAdded(['a'], 'b'), 'a; b');
  assert.equal(tagFieldWithAdded([], 'first'), 'first');
});

test('tagFieldWithAdded returns null for a no-op (already present or blank)', () => {
  assert.equal(tagFieldWithAdded(['a', 'b'], 'a'), null);
  assert.equal(tagFieldWithAdded(['a'], '  '), null);
});

test('summarize tallies ok/failed/total', () => {
  assert.deepEqual(summarize([{ ok: true }, { ok: false }, { ok: true }]), { ok: 2, failed: 1, total: 3 });
  assert.deepEqual(summarize([]), { ok: 0, failed: 0, total: 0 });
});
