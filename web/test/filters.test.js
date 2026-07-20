import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFilterSort, searchAll } from '../src/lib/filters.js';

const prs = [
  { id: 1, repo: 'WD.Client.Linux', title: 'Fix crash', state: 'Open', sourceBranch: 'user/a/fix', createdBy: { displayName: 'Ann' }, reviewStatus: 'Approved', lastActivity: '2026-06-01T00:00:00Z', creationDate: '2026-05-01T00:00:00Z' },
  { id: 2, repo: 'WD.Client.Mac', title: 'Add feature', state: 'Draft', sourceBranch: 'user/b/feat', createdBy: { displayName: 'Bob' }, reviewStatus: 'Not Approved', lastActivity: '2026-06-02T00:00:00Z', creationDate: '2026-05-02T00:00:00Z' },
  { id: 3, repo: 'WD.Client.Linux', title: 'Refactor core', state: 'Merged', sourceBranch: 'user/a/ref', createdBy: { displayName: 'Ann' }, reviewStatus: 'Approved', lastActivity: '2026-06-03T00:00:00Z', creationDate: '2026-05-03T00:00:00Z' },
];

const base = { repos: [], states: [], search: '', pipeline: '', review: '', timeRange: 'all', labels: [] };

test('filters by state', () => {
  const out = applyFilterSort(prs, { ...base, states: ['Open'] }, {});
  assert.deepEqual(out.map((p) => p.id), [1]);
});

test('filters by repo', () => {
  const out = applyFilterSort(prs, { ...base, repos: ['WD.Client.Linux'] }, {});
  assert.deepEqual(out.map((p) => p.id).sort(), [1, 3]);
});

test('free-text search matches title/author/branch', () => {
  assert.deepEqual(applyFilterSort(prs, { ...base, search: 'feature' }, {}).map((p) => p.id), [2]);
  assert.deepEqual(applyFilterSort(prs, { ...base, search: 'Ann' }, {}).map((p) => p.id).sort(), [1, 3]);
});

test('sorts by title ascending', () => {
  const out = applyFilterSort(prs, base, { key: 'title', dir: 'asc' });
  assert.deepEqual(out.map((p) => p.title), ['Add feature', 'Fix crash', 'Refactor core']);
});

test('searchAll dedupes across buckets and matches query', () => {
  const res = searchAll({ created: [prs[0]], team: [prs[0], prs[1]] }, 'user/');
  assert.equal(res.length, 2);
});
