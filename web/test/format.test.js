import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  timeAgo,
  daysSinceDate,
  shortPath,
  repoShort,
  cleanVersion,
  fmtDuration,
  isGateInFlight,
  rerunnableBuilds,
  canRerunGate,
  fmtDate,
  fmtDateShort,
  setTimeZone,
  getTimeZone,
  DEFAULT_TIME_ZONE,
} from '../src/lib/format.js';

test('timeAgo produces coarse relative labels', () => {
  assert.equal(timeAgo(''), '');
  assert.equal(timeAgo(new Date(Date.now() - 5 * 1000).toISOString()), 'just now');
  assert.equal(timeAgo(new Date(Date.now() - 5 * 60 * 1000).toISOString()), '5m ago');
  assert.equal(timeAgo(new Date(Date.now() - 3 * 3600 * 1000).toISOString()), '3h ago');
  assert.equal(timeAgo(new Date(Date.now() - 2 * 86400 * 1000).toISOString()), '2d ago');
});

test('daysSinceDate clamps to >=0 and rejects bad input', () => {
  assert.equal(daysSinceDate(''), null);
  assert.equal(daysSinceDate('not-a-date'), null);
  assert.equal(daysSinceDate(new Date(Date.now() - 3 * 86400000).toISOString()), 3);
  // A future date floors to 0, never negative.
  assert.equal(daysSinceDate(new Date(Date.now() + 86400000).toISOString()), 0);
});

test('shortPath returns the tail segment of an ADO tree path', () => {
  assert.equal(shortPath('Project\\Area\\Sub'), 'Sub');
  assert.equal(shortPath('Project/Area/Sub'), 'Sub');
  assert.equal(shortPath(''), '');
});

test('repoShort maps known repos and passes through unknown ones', () => {
  assert.equal(repoShort('WD.Client.Linux'), 'Linux');
  assert.equal(repoShort('Some.Other.Repo'), 'Some.Other.Repo');
});

test('cleanVersion extracts a version token from noisy CLI output', () => {
  assert.equal(cleanVersion("GitHub Copilot CLI 1.0.74-1. Run 'copilot update'"), '1.0.74-1');
  assert.equal(cleanVersion('v2.3'), '2.3');
  assert.equal(cleanVersion(''), '');
});

test('fmtDuration formats ms and guards bad input', () => {
  assert.equal(fmtDuration(null), '—');
  assert.equal(fmtDuration(-5), '—');
  assert.equal(fmtDuration(5000), '5s');
  assert.equal(fmtDuration(65000), '1m 5s');
  assert.equal(fmtDuration(3_660_000), '1h 1m');
});

test('gate in-flight + rerunnable helpers', () => {
  assert.equal(isGateInFlight({ status: 'running' }), true);
  assert.equal(isGateInFlight({ status: 'queued' }), true);
  assert.equal(isGateInFlight({ effectiveStatus: 'expired', status: 'queued' }), false);
  assert.equal(isGateInFlight({ status: 'succeeded' }), false);

  const pr = { pipeline: { builds: [{ status: 'running' }, { status: 'succeeded' }, { effectiveStatus: 'expired', status: 'queued' }] } };
  assert.equal(rerunnableBuilds(pr).length, 2);
  assert.equal(canRerunGate(pr), true);
  assert.equal(canRerunGate({ pipeline: { builds: [{ status: 'running' }] } }), false);
});

test('default time zone is IST until changed', () => {
  assert.equal(DEFAULT_TIME_ZONE, 'Asia/Kolkata');
  assert.equal(getTimeZone(), 'Asia/Kolkata');
});

test('setTimeZone changes how fmtDate/fmtDateShort render an instant', () => {
  // A fixed UTC instant: 2024-01-01T00:30:00Z. In IST (+5:30) this is 06:00 on
  // Jan 1; in US Pacific (-8) it is 16:30 on Dec 31 — so the calendar day differs.
  const iso = '2024-01-01T00:30:00.000Z';

  setTimeZone('Asia/Kolkata');
  const istDate = fmtDate(iso);
  const istDay = fmtDateShort(iso);
  assert.match(istDate, /2024/);
  assert.match(istDay, /Jan 1, 2024/); // still Jan 1 in IST

  setTimeZone('America/Los_Angeles');
  const pstDay = fmtDateShort(iso);
  assert.match(pstDay, /Dec 31, 2023/); // rolled back a day in PST
  assert.notEqual(fmtDate(iso), istDate); // time-of-day differs from IST

  setTimeZone('Asia/Kolkata'); // restore default for other tests
});

test('setTimeZone ignores invalid zones (keeps the previous one)', () => {
  setTimeZone('Asia/Kolkata');
  setTimeZone('Not/AZone');
  assert.equal(getTimeZone(), 'Asia/Kolkata');
  setTimeZone('');
  assert.equal(getTimeZone(), 'Asia/Kolkata');
});

test('fmtDate/fmtDateShort return empty string for falsy input', () => {
  assert.equal(fmtDate(''), '');
  assert.equal(fmtDateShort(null), '');
});
