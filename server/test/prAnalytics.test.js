import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  median, mean, percentile, weekKey, throughputByWeek, cycleTimeStats,
  openAging, buildPrAnalytics,
} from '../src/lib/prAnalytics.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

test('median / mean / percentile', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(mean([2, 4]), 3);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
  assert.equal(median([]), null);
});

test('weekKey anchors to Monday (UTC)', () => {
  // 2026-07-15 is a Wednesday → Monday 2026-07-13.
  assert.equal(weekKey('2026-07-15T10:00:00Z'), '2026-07-13');
});

test('throughputByWeek seeds empty weeks and counts merges', () => {
  const now = Date.parse('2026-07-15T00:00:00Z');
  const merged = [
    { closedDate: '2026-07-14T00:00:00Z' }, // this week
    { closedDate: '2026-07-13T00:00:00Z' }, // same (Monday)
    { closedDate: '2026-07-06T00:00:00Z' }, // prior week
  ];
  const t = throughputByWeek(merged, now, 4);
  assert.equal(t.total, 3);
  assert.equal(t.perWeek.length, 4);
  const thisWeek = t.perWeek.find((w) => w.week === '2026-07-13');
  assert.equal(thisWeek.count, 2);
});

test('cycleTimeStats computes median/avg hours', () => {
  const merged = [
    { creationDate: '2026-07-01T00:00:00Z', closedDate: '2026-07-01T10:00:00Z' }, // 10h
    { creationDate: '2026-07-01T00:00:00Z', closedDate: '2026-07-01T20:00:00Z' }, // 20h
  ];
  const s = cycleTimeStats(merged);
  assert.equal(s.count, 2);
  assert.equal(s.medianHours, 15);
  assert.equal(s.avgHours, 15);
});

test('openAging buckets by age and flags SLA breaches', () => {
  const now = Date.parse('2026-07-15T00:00:00Z');
  const open = [
    { id: 1, repo: 'R', title: 'fresh', creationDate: new Date(now - 2 * HOUR).toISOString(), lastActivity: new Date(now - 2 * HOUR).toISOString() },
    { id: 2, repo: 'R', title: 'stale', creationDate: new Date(now - 20 * DAY).toISOString(), lastActivity: new Date(now - 10 * DAY).toISOString() },
  ];
  const a = openAging(open, now, 7);
  assert.equal(a.total, 2);
  assert.equal(a.buckets[0].count, 1); // "< 1 day"
  assert.equal(a.breachingSla.length, 1); // stale idle 10d >= 7
  assert.equal(a.breachingSla[0].id, 2);
  assert.equal(a.oldest[0].id, 2);
});

test('buildPrAnalytics is scoped to the current user only', () => {
  const now = Date.parse('2026-07-15T00:00:00Z');
  const prA = { id: 1, repo: 'R', title: 'mine', createdBy: { id: 'me' }, creationDate: new Date(now - DAY).toISOString(), review: { reviewers: [] } };
  const prTeam = { id: 9, repo: 'R', title: 'teammate', createdBy: { id: 'other' }, creationDate: new Date(now - DAY).toISOString(), review: { reviewers: [] } };
  const open = [prA, prA, prTeam]; // duplicate mine → collapses to 1; teammate → excluded
  const merged = [
    { id: 2, repo: 'R', createdBy: { id: 'me' }, creationDate: new Date(now - 3 * DAY).toISOString(), closedDate: new Date(now - DAY).toISOString() },
    { id: 3, repo: 'R', createdBy: { id: 'other' }, creationDate: new Date(now - 5 * DAY).toISOString(), closedDate: new Date(now - DAY).toISOString() },
  ];
  const abandoned = [{ id: 4, repo: 'R', createdBy: { id: 'me' }, creationDate: new Date(now - 4 * DAY).toISOString(), closedDate: new Date(now - 2 * DAY).toISOString() }];
  // Review queue: PRs assigned to me — one I haven't voted on, one I approved.
  const reviewQueue = [
    { id: 20, repo: 'R', title: 'needs me', createdBy: { id: 'other', displayName: 'Other' }, lastActivity: new Date(now - 2 * DAY).toISOString(), myReview: { reviewed: false, vote: 0 } },
    { id: 21, repo: 'R', title: 'i approved', createdBy: { id: 'other' }, myReview: { reviewed: true, vote: 10 } },
  ];
  const a = buildPrAnalytics({ open, merged, abandoned, reviewQueue, meId: 'me', meName: 'Me' }, { now, slaDays: 7 });

  assert.equal(a.scope, 'mine');
  // Only my authored open PR counts (teammate + duplicate excluded).
  assert.equal(a.totals.open, 1);
  assert.equal(a.mine.open, 1);
  // Only my merged/abandoned count (the 'other' merge is excluded).
  assert.equal(a.totals.merged, 1);
  assert.equal(a.throughput.total, 1);
  assert.equal(a.mine.merged, 1);
  assert.equal(a.mine.abandoned, 1);
  assert.equal(a.mine.mergeRate, 50); // 1 merged of (1 merged + 1 abandoned)
  // Review section reflects only my review activity.
  assert.equal(a.review.awaitingCount, 1);
  assert.equal(a.review.awaiting[0].id, 20);
  assert.equal(a.review.approvalsGiven, 1);
  // No cross-user aggregate leaks into the payload.
  assert.equal(a.reviewerWorkload, undefined);
});

test('buildPrAnalytics byRepo counts only my PRs', () => {
  const now = Date.parse('2026-07-15T00:00:00Z');
  const open = [
    { id: 1, repo: 'Linux', createdBy: { id: 'me' }, creationDate: new Date(now - DAY).toISOString() },
    { id: 2, repo: 'Linux', createdBy: { id: 'other' }, creationDate: new Date(now - DAY).toISOString() },
  ];
  const a = buildPrAnalytics({ open, merged: [], abandoned: [], meId: 'me' }, { now });
  const linux = a.byRepo.find((r) => r.repo === 'Linux');
  assert.equal(linux.open, 1); // teammate's PR excluded
});
