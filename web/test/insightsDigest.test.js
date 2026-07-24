import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtHours, fmtPct, pipelineHealth, buildDigest } from '../src/lib/insightsDigest.js';

test('fmtHours renders hours and days compactly', () => {
  assert.equal(fmtHours(5), '5h');
  assert.equal(fmtHours(23), '23h');
  assert.equal(fmtHours(36), '1.5d');
  assert.equal(fmtHours(null), '—');
  assert.equal(fmtHours(undefined), '—');
});

test('fmtPct renders whole-number percentages', () => {
  assert.equal(fmtPct(0.9), '90%');
  assert.equal(fmtPct(1), '100%');
  assert.equal(fmtPct(null), '—');
});

test('pipelineHealth de-dupes by id and computes pass rate', () => {
  const ov = {
    active: [{ id: 1, result: 'Failed' }],
    recent: [{ id: 1, result: 'Failed' }, { id: 2, result: 'Succeeded' }, { id: 3, result: 'Succeeded' }],
  };
  const h = pipelineHealth(ov);
  assert.equal(h.failed, 1); // id 1 counted once
  assert.equal(h.succeeded, 2);
  assert.equal(h.passRate, 2 / 3);
});

test('pipelineHealth returns null passRate when there are no finished runs', () => {
  assert.equal(pipelineHealth({ active: [], recent: [] }).passRate, null);
  assert.equal(pipelineHealth(null).passRate, null);
});

test('buildDigest assembles headline stats from all areas', () => {
  const d = buildDigest({
    prAnalytics: { totals: { merged: 38, open: 5 }, cycleTime: { medianHours: 24.3 } },
    wiOverview: { openCount: 219, completedCount: 348 },
    pipelineOverview: { recent: [{ id: 1, result: 'Succeeded' }, { id: 2, result: 'Failed' }] },
    agentAnalytics: { agentHours: 12, totalSessions: 4 },
  });
  const by = Object.fromEntries(d.stats.map((s) => [s.key, s.display]));
  assert.equal(by.prMerged, '38');
  assert.equal(by.cycle, '1.0d'); // 24.3h → 1.0d
  assert.equal(by.wiClosed, '348');
  assert.equal(by.passRate, '50%');
  assert.equal(by.agentHours, '12');
  assert.ok(d.highlights.some((h) => /merged/.test(h)));
});

test('buildDigest tolerates entirely missing inputs', () => {
  const d = buildDigest();
  assert.equal(d.stats.length, 5);
  assert.equal(d.stats.find((s) => s.key === 'prMerged').display, '0');
  assert.equal(d.stats.find((s) => s.key === 'cycle').display, '—');
  assert.deepEqual(d.highlights, ['No cross-area activity to report yet.']);
});
