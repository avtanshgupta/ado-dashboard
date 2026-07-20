import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildWorkItemAnalytics,
  stateCategory,
  isOpenCategory,
  throughputByWeek,
  aging,
  weekKey,
} from '../src/lib/workItemAnalytics.js';

test('stateCategory: maps common states, defaults to InProgress', () => {
  assert.equal(stateCategory('New'), 'Proposed');
  assert.equal(stateCategory('Active'), 'InProgress');
  assert.equal(stateCategory('Resolved'), 'Resolved');
  assert.equal(stateCategory('Closed'), 'Completed');
  assert.equal(stateCategory('Removed'), 'Removed');
  assert.equal(stateCategory('Whatever'), 'InProgress');
  assert.equal(stateCategory('X', 'Completed'), 'Completed'); // override wins
});

test('isOpenCategory', () => {
  assert.ok(isOpenCategory('Proposed'));
  assert.ok(isOpenCategory('InProgress'));
  assert.ok(isOpenCategory('Resolved'));
  assert.ok(!isOpenCategory('Completed'));
  assert.ok(!isOpenCategory('Removed'));
});

test('weekKey: Monday-anchored', () => {
  // 2026-07-15 is a Wednesday → Monday is 2026-07-13
  assert.equal(weekKey('2026-07-15T10:00:00Z'), '2026-07-13');
});

const NOW = Date.parse('2026-07-20T00:00:00Z');
const iso = (daysAgo) => new Date(NOW - daysAgo * 86400000).toISOString();

const items = [
  { id: 1, type: 'Bug', state: 'Active', assignedTo: { displayName: 'Ann' }, createdDate: iso(10), changedDate: iso(2), ageDays: 10, idleDays: 2, priority: 1, storyPoints: 3 },
  { id: 2, type: 'Bug', state: 'New', assignedTo: null, createdDate: iso(3), changedDate: iso(1), ageDays: 3, idleDays: 1, priority: 2 },
  { id: 3, type: 'Task', state: 'Closed', assignedTo: { displayName: 'Ann' }, createdDate: iso(20), changedDate: iso(5), ageDays: 20, idleDays: 5 },
  { id: 4, type: 'User Story', state: 'Resolved', assignedTo: { displayName: 'Bob' }, createdDate: iso(9), changedDate: iso(9), ageDays: 9, idleDays: 9, storyPoints: 8 },
];

test('buildWorkItemAnalytics: distributions and counts', () => {
  const a = buildWorkItemAnalytics(items, { now: NOW, slaDays: 7 });
  assert.equal(a.total, 4);
  assert.equal(a.openCount, 3); // items 1,2,4 open; 3 closed
  assert.equal(a.completedCount, 1);
  assert.equal(a.unassignedCount, 1); // item 2

  const typeMap = Object.fromEntries(a.byType.map((t) => [t.key, t.count]));
  assert.deepEqual(typeMap, { Bug: 2, Task: 1, 'User Story': 1 });

  const catMap = Object.fromEntries(a.byStateCategory.map((t) => [t.key, t.count]));
  assert.equal(catMap.InProgress, 1); // Active
  assert.equal(catMap.Proposed, 1); // New
  assert.equal(catMap.Resolved, 1);
  assert.equal(catMap.Completed, 1);

  const assignee = Object.fromEntries(a.byAssignee.map((t) => [t.key, t.count]));
  assert.equal(assignee.Ann, 2);
  assert.equal(assignee.Unassigned, 1);

  // open story points: item1 (3) + item4 (8) = 11 (item2 has none, item3 closed)
  assert.equal(a.openStoryPoints, 11);
});

test('buildWorkItemAnalytics: aging + SLA breaches on open items', () => {
  const a = buildWorkItemAnalytics(items, { now: NOW, slaDays: 7 });
  // open items idleDays: item1=2, item2=1, item4=9 → one breach (item4)
  assert.equal(a.aging.breaching.length, 1);
  assert.equal(a.aging.breaching[0].id, 4);
  const bucketTotal = a.aging.buckets.reduce((s, b) => s + b.count, 0);
  assert.equal(bucketTotal, 3); // three open items placed in buckets
});

test('throughputByWeek: seeds weeks and counts created/closed', () => {
  const t = throughputByWeek(items.map((it) => ({ ...it, _category: it.state === 'Closed' ? 'Completed' : 'InProgress' })), NOW, 6);
  assert.equal(t.length, 6);
  const totalCreated = t.reduce((s, w) => s + w.created, 0);
  // items created within the last 6 weeks (all four are within ~20 days)
  assert.equal(totalCreated, 4);
});

test('categoryFor override drives categorization', () => {
  const a = buildWorkItemAnalytics(
    [{ id: 9, type: 'Bug', state: 'Custom', assignedTo: null, createdDate: iso(1), changedDate: iso(1), ageDays: 1, idleDays: 1 }],
    { now: NOW, categoryFor: () => 'Completed' }
  );
  assert.equal(a.completedCount, 1);
  assert.equal(a.openCount, 0);
});
