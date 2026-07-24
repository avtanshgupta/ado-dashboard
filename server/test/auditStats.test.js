import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoute, percentile, buildAuditStats } from '../src/lib/auditStats.js';

test('normalizeRoute collapses numeric ids and the repo segment', () => {
  assert.equal(normalizeRoute('/api/prs/My.Repo/123/merge'), '/api/prs/:repo/:id/merge');
  assert.equal(normalizeRoute('/api/workitems/98765'), '/api/workitems/:id');
  assert.equal(normalizeRoute('/api/pipelines/runs/555/retry'), '/api/pipelines/runs/:id/retry');
  assert.equal(normalizeRoute('/api/config'), '/api/config');
  assert.equal(normalizeRoute('/api/prs/My.Repo/1/reviewers/abc-guid'), '/api/prs/:repo/:id/reviewers/abc-guid');
});

test('percentile uses nearest-rank on a sorted array', () => {
  const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(s, 50), 5);
  assert.equal(percentile(s, 95), 10);
  assert.equal(percentile(s, 100), 10);
  assert.equal(percentile([], 50), 0);
});

test('buildAuditStats aggregates overall + per-route with error rate', () => {
  const entries = [
    { method: 'POST', path: '/api/prs/Repo/1/merge', status: 200, ok: true, ms: 100 },
    { method: 'POST', path: '/api/prs/Repo/2/merge', status: 200, ok: true, ms: 200 },
    { method: 'POST', path: '/api/prs/Repo/3/merge', status: 500, ok: false, ms: 300 },
    { method: 'PATCH', path: '/api/workitems/42', status: 200, ok: true, ms: 50 },
  ];
  const s = buildAuditStats(entries);
  assert.equal(s.total, 4);
  assert.equal(s.errors, 1);
  assert.equal(s.errorRate, 0.25);
  assert.equal(s.max, 300);
  // Two distinct route templates: merge (x3) and workitems (x1).
  assert.equal(s.routes.length, 2);
  const merge = s.routes.find((r) => r.route === '/api/prs/:repo/:id/merge');
  assert.equal(merge.count, 3);
  assert.equal(merge.errors, 1);
  assert.equal(merge.method, 'POST');
});

test('buildAuditStats sorts routes by count and caps with topRoutes', () => {
  const entries = [];
  for (let i = 0; i < 5; i++) entries.push({ method: 'GET', path: `/api/a/${i}`, ok: true, ms: 10 });
  for (let i = 0; i < 2; i++) entries.push({ method: 'GET', path: `/api/b/${i}`, ok: true, ms: 10 });
  const s = buildAuditStats(entries, { topRoutes: 1 });
  assert.equal(s.routes.length, 1);
  assert.equal(s.routes[0].route, '/api/a/:id'); // busiest first
  assert.equal(s.routes[0].count, 5);
});

test('buildAuditStats tolerates empty / malformed input', () => {
  assert.deepEqual(buildAuditStats([]).routes, []);
  assert.equal(buildAuditStats([]).errorRate, 0);
  assert.equal(buildAuditStats(undefined).total, 0);
  assert.equal(buildAuditStats([{ path: '/x' }]).total, 0); // no ms → skipped
});
