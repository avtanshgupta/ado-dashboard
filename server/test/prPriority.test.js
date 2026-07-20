import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  daysSince,
  idleDays,
  ageDays,
  classifyMine,
  classifyAssigned,
  buildActionCenter,
} from '../src/lib/prPriority.js';

const NOW = Date.parse('2026-07-18T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(NOW - n * DAY).toISOString();

const mine = (over = {}) => ({
  id: 1,
  repo: 'WD.Client.Linux',
  title: 'PR',
  state: 'Open',
  reviewStatus: 'Not Approved',
  pipeline: { overall: 'Succeeded' },
  canMerge: false,
  creationDate: daysAgo(2),
  lastActivity: daysAgo(1),
  createdBy: { displayName: 'Me' },
  webUrl: 'http://x',
  ...over,
});

test('daysSince computes whole days and handles bad input', () => {
  assert.equal(daysSince(daysAgo(3), NOW), 3);
  assert.equal(daysSince(null, NOW), null);
  assert.equal(daysSince('not-a-date', NOW), null);
});

test('idleDays falls back to creationDate; ageDays uses creationDate', () => {
  assert.equal(idleDays({ lastActivity: daysAgo(4), creationDate: daysAgo(9) }, NOW), 4);
  assert.equal(idleDays({ creationDate: daysAgo(9) }, NOW), 9);
  assert.equal(ageDays({ creationDate: daysAgo(9), lastActivity: daysAgo(1) }, NOW), 9);
});

test('classifyMine: draft → draft bucket', () => {
  const c = classifyMine(mine({ state: 'Draft' }), NOW);
  assert.equal(c.category, 'draft');
});

test('classifyMine: merged/closed → no action', () => {
  assert.equal(classifyMine(mine({ state: 'Merged' }), NOW), null);
  assert.equal(classifyMine(mine({ state: 'Closed' }), NOW), null);
});

test('classifyMine: changes requested is highest-priority fix', () => {
  const c = classifyMine(mine({ reviewStatus: 'Changes Requested' }), NOW);
  assert.equal(c.category, 'fix');
  assert.equal(c.priority, 95);
});

test('classifyMine: failed CI → fix', () => {
  const c = classifyMine(mine({ pipeline: { overall: 'Failed' } }), NOW);
  assert.equal(c.category, 'fix');
  assert.equal(c.priority, 92);
});

test('classifyMine: merge conflict → fix', () => {
  const c = classifyMine(mine({ merge: { noConflicts: false } }), NOW);
  assert.equal(c.category, 'fix');
  assert.equal(c.priority, 88);
});

test('classifyMine: mergeable → merge', () => {
  const c = classifyMine(mine({ canMerge: true }), NOW);
  assert.equal(c.category, 'merge');
  assert.equal(c.priority, 85);
});

test('classifyMine: expired CI → fix (lower than merge)', () => {
  const c = classifyMine(mine({ pipeline: { overall: 'Expired' } }), NOW);
  assert.equal(c.category, 'fix');
  assert.equal(c.priority, 72);
});

test('classifyMine: idle open PR → stale', () => {
  const c = classifyMine(mine({ lastActivity: daysAgo(10), pipeline: { overall: 'Queued' } }), NOW, { staleDays: 7 });
  assert.equal(c.category, 'stale');
});

test('classifyMine: fresh open PR waiting on reviewers → waiting', () => {
  const c = classifyMine(mine({ lastActivity: daysAgo(1) }), NOW);
  assert.equal(c.category, 'waiting');
  assert.equal(c.priority, 20);
});

test('classifyAssigned: not yet reviewed → review, climbs with idle', () => {
  const fresh = classifyAssigned(mine({ myReview: { reviewed: false }, lastActivity: daysAgo(0) }), NOW);
  assert.equal(fresh.category, 'review');
  assert.equal(fresh.priority, 60);
  const old = classifyAssigned(mine({ myReview: { reviewed: false }, lastActivity: daysAgo(10) }), NOW);
  assert.equal(old.priority, 70);
});

test('classifyAssigned: already reviewed → no action', () => {
  assert.equal(classifyAssigned(mine({ myReview: { reviewed: true, vote: 10 } }), NOW), null);
});

test('buildActionCenter: sorts by priority, groups, and counts', () => {
  const created = [
    mine({ id: 1, canMerge: true }), // merge 85
    mine({ id: 2, reviewStatus: 'Changes Requested' }), // fix 95
    mine({ id: 3, lastActivity: daysAgo(1) }), // waiting 20
  ];
  const assigned = [
    mine({ id: 4, myReview: { reviewed: false }, lastActivity: daysAgo(10) }), // review 70
    mine({ id: 5, myReview: { reviewed: true, vote: 10 } }), // dropped
  ];
  const ac = buildActionCenter(created, assigned, { now: NOW });
  // sorted desc by priority: fix(95,id2) > merge(85,id1) > review(70,id4) > waiting(20,id3)
  assert.deepEqual(ac.items.map((i) => i.id), [2, 1, 4, 3]);
  assert.deepEqual(ac.items.map((i) => i.priority), [95, 85, 70, 20]);
  assert.equal(ac.counts.fix, 1);
  assert.equal(ac.counts.merge, 1);
  assert.equal(ac.counts.review, 1);
  assert.equal(ac.counts.waiting, 1);
  assert.equal(ac.counts.total, 4);
  assert.equal(ac.groups.fix[0].id, 2);
});

// ---- E3 overlay: snooze / dismiss / follow ----
import { applyActionOverlay, itemSignature } from '../src/lib/prPriority.js';

function acPayload() {
  return {
    items: [
      { id: 1, repo: 'R', category: 'fix', reason: 'CI pipeline failed', priority: 92 },
      { id: 2, repo: 'R', category: 'review', reason: 'Awaiting your review', priority: 60 },
      { id: 3, repo: 'R', category: 'merge', reason: 'All checks green — ready to merge', priority: 85 },
    ],
    groups: {}, counts: {},
  };
}

test('applyActionOverlay drops snoozed items until they expire', () => {
  const now = Date.now();
  const out = applyActionOverlay(acPayload(), { snoozes: { 'R#2': new Date(now + 3600e3).toISOString() } }, now);
  assert.ok(!out.items.find((i) => i.id === 2), 'snoozed item is hidden');
  assert.equal(out.counts.snoozed, 1);
  assert.equal(out.items.length, 2);
  // An expired snooze does not hide the item.
  const out2 = applyActionOverlay(acPayload(), { snoozes: { 'R#2': new Date(now - 1000).toISOString() } }, now);
  assert.ok(out2.items.find((i) => i.id === 2));
});

test('applyActionOverlay drops dismissed items only while signature matches', () => {
  const item = { id: 1, repo: 'R', category: 'fix', reason: 'CI pipeline failed' };
  const sig = itemSignature(item);
  const out = applyActionOverlay(acPayload(), { dismissals: { 'R#1': sig } });
  assert.ok(!out.items.find((i) => i.id === 1), 'dismissed while sig matches');
  assert.equal(out.counts.dismissed, 1);
  // If the reason changes, the stale dismissal no longer matches → item returns.
  const out2 = applyActionOverlay(acPayload(), { dismissals: { 'R#1': 'fix|old reason' } });
  assert.ok(out2.items.find((i) => i.id === 1));
});

test('applyActionOverlay tags followed items and rebuilds counts', () => {
  const out = applyActionOverlay(acPayload(), { follows: new Set(['R#3']) });
  assert.equal(out.items.find((i) => i.id === 3).followed, true);
  assert.equal(out.items.find((i) => i.id === 1).followed, false);
  assert.equal(out.counts.fix, 1);
  assert.equal(out.counts.merge, 1);
  assert.equal(out.counts.total, 3);
});
