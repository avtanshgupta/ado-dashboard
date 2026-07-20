import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyWorkItemFilterSort, deriveWorkItemOptions, categoryOf } from '../src/lib/workItemFilters.js';

const items = [
  { id: 1, type: 'Bug', title: 'Crash on start', state: 'Active', assignedTo: { displayName: 'Ann' }, areaPath: 'WD\\Linux', iterationPath: 'WD\\S1', project: 'WD', tags: ['Regression'], priority: 1, storyPoints: 3, createdDate: '2026-05-01T00:00:00Z', changedDate: '2026-06-01T00:00:00Z' },
  { id: 2, type: 'Task', title: 'Add telemetry', state: 'New', assignedTo: null, areaPath: 'WD\\Mac', iterationPath: 'WD\\S1', project: 'WD', tags: [], priority: 2, createdDate: '2026-05-02T00:00:00Z', changedDate: '2026-06-02T00:00:00Z' },
  { id: 3, type: 'Bug', title: 'Fix leak', state: 'Closed', assignedTo: { displayName: 'Bob' }, areaPath: 'WD\\Linux', iterationPath: 'WD\\S2', project: 'WD', tags: ['Regression', 'Security'], priority: 1, storyPoints: 8, createdDate: '2026-05-03T00:00:00Z', changedDate: '2026-06-03T00:00:00Z' },
];

const base = { types: [], states: [], categories: [], assignees: [], areas: [], iterations: [], tags: [], projects: [], priorities: [], search: '', timeRange: 'all' };

test('categoryOf maps states to coarse categories', () => {
  assert.equal(categoryOf('Active'), 'InProgress');
  assert.equal(categoryOf('New'), 'Proposed');
  assert.equal(categoryOf('Closed'), 'Completed');
  assert.equal(categoryOf('Resolved'), 'Resolved');
});

test('filters by type', () => {
  const out = applyWorkItemFilterSort(items, { ...base, types: ['Bug'] }, {});
  assert.deepEqual(out.map((w) => w.id).sort(), [1, 3]);
});

test('filters by state', () => {
  assert.deepEqual(applyWorkItemFilterSort(items, { ...base, states: ['New'] }, {}).map((w) => w.id), [2]);
});

test('filters by state category (InProgress excludes closed/new)', () => {
  assert.deepEqual(applyWorkItemFilterSort(items, { ...base, categories: ['InProgress'] }, {}).map((w) => w.id), [1]);
});

test('filters by assignee, mapping null to Unassigned', () => {
  assert.deepEqual(applyWorkItemFilterSort(items, { ...base, assignees: ['Unassigned'] }, {}).map((w) => w.id), [2]);
  assert.deepEqual(applyWorkItemFilterSort(items, { ...base, assignees: ['Ann'] }, {}).map((w) => w.id), [1]);
});

test('filters by area path and tags', () => {
  assert.deepEqual(applyWorkItemFilterSort(items, { ...base, areas: ['WD\\Linux'] }, {}).map((w) => w.id).sort(), [1, 3]);
  assert.deepEqual(applyWorkItemFilterSort(items, { ...base, tags: ['Security'] }, {}).map((w) => w.id), [3]);
});

test('filters by priority (as string)', () => {
  assert.deepEqual(applyWorkItemFilterSort(items, { ...base, priorities: ['1'] }, {}).map((w) => w.id).sort(), [1, 3]);
});

test('free-text search matches title/type/assignee/tag/id', () => {
  assert.deepEqual(applyWorkItemFilterSort(items, { ...base, search: 'leak' }, {}).map((w) => w.id), [3]);
  assert.deepEqual(applyWorkItemFilterSort(items, { ...base, search: 'ann' }, {}).map((w) => w.id), [1]);
  assert.deepEqual(applyWorkItemFilterSort(items, { ...base, search: 'regression' }, {}).map((w) => w.id).sort(), [1, 3]);
});

test('sorts by title ascending', () => {
  const out = applyWorkItemFilterSort(items, base, { key: 'title', dir: 'asc' });
  assert.deepEqual(out.map((w) => w.title), ['Add telemetry', 'Crash on start', 'Fix leak']);
});

test('sorts by id descending', () => {
  const out = applyWorkItemFilterSort(items, base, { key: 'id', dir: 'desc' });
  assert.deepEqual(out.map((w) => w.id), [3, 2, 1]);
});

test('sorts by priority ascending puts no-priority last', () => {
  const withNone = [...items, { id: 4, type: 'Epic', title: 'Roadmap', state: 'New', priority: null, createdDate: '2026-05-04T00:00:00Z', changedDate: '2026-06-04T00:00:00Z' }];
  const out = applyWorkItemFilterSort(withNone, base, { key: 'priority', dir: 'asc' });
  assert.equal(out[out.length - 1].id, 4);
});

test('deriveWorkItemOptions collects distinct facets', () => {
  const opts = deriveWorkItemOptions(items);
  assert.deepEqual(opts.types, ['Bug', 'Task']);
  assert.ok(opts.assignees.includes('Unassigned'));
  assert.deepEqual(opts.tags, ['Regression', 'Security']);
  assert.deepEqual(opts.areas, ['WD\\Linux', 'WD\\Mac']);
});
