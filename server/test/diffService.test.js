import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFileDiff } from '../src/services/diffService.js';

test('computes additions and deletions with running line numbers', () => {
  const oldStr = 'line1\nline2\nline3\n';
  const newStr = 'line1\nline2 changed\nline3\nline4\n';
  const d = computeFileDiff('a.txt', oldStr, newStr);
  assert.equal(d.additions, 2); // "line2 changed" + "line4"
  assert.equal(d.deletions, 1); // original "line2"
  assert.ok(d.hunks.length >= 1);
  const lines = d.hunks.flatMap((h) => h.lines);
  const add = lines.find((l) => l.type === 'add' && l.text === 'line4');
  assert.ok(add, 'line4 should be an added line');
  assert.equal(typeof add.newNo, 'number');
  const ctx = lines.find((l) => l.type === 'context' && l.text === 'line1');
  assert.equal(ctx.oldNo, 1);
  assert.equal(ctx.newNo, 1);
});

test('a pure addition has no deletions', () => {
  const d = computeFileDiff('new.txt', '', 'hello\nworld\n', 'add');
  assert.equal(d.deletions, 0);
  assert.equal(d.additions, 2);
  assert.equal(d.changeType, 'add');
});

test('identical content yields no hunks', () => {
  const d = computeFileDiff('same.txt', 'x\ny\n', 'x\ny\n');
  assert.equal(d.hunks.length, 0);
  assert.equal(d.additions, 0);
  assert.equal(d.deletions, 0);
});
