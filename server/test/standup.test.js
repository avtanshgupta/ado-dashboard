import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStandup, standupMarkdown, standupIcs } from '../src/lib/standup.js';

const now = Date.parse('2026-07-15T12:00:00Z');
const HOUR = 3600 * 1000;

const created = [
  { id: 1, repo: 'Linux', title: 'feature A', state: 'Open', reviewStatus: 'Not Approved', pipeline: { overall: 'Succeeded' } },
  { id: 2, repo: 'Mac', title: 'broken B', state: 'Open', reviewStatus: 'Changes Requested', pipeline: { overall: 'Failed' } },
  { id: 3, repo: 'Linux', title: 'draft C', state: 'Draft' },
];
const assignedMe = [
  { id: 9, repo: 'eBPF', title: 'review me', createdBy: { displayName: 'Alice' }, myReview: { reviewed: false } },
  { id: 10, repo: 'eBPF', title: 'already voted', myReview: { reviewed: true } },
];
const merged = [
  { id: 20, repo: 'Linux', title: 'shipped', closedDate: new Date(now - 3 * HOUR).toISOString() },
  { id: 21, repo: 'Linux', title: 'old', closedDate: new Date(now - 72 * HOUR).toISOString() },
];

test('buildStandup classifies done/in-progress/blocked/reviewing', () => {
  const s = buildStandup({ created, assignedMe, merged }, { now, sinceMs: now - 24 * HOUR });
  assert.equal(s.done.length, 1); // only the 3h-ago merge is within 24h
  assert.equal(s.done[0].id, 20);
  assert.equal(s.inProgress.length, 3); // all my open/draft
  assert.equal(s.blocked.length, 1); // "broken B" (changes requested + CI failed)
  assert.equal(s.blocked[0].why, 'changes requested');
  assert.equal(s.reviewing.length, 1); // only the un-voted one
  assert.equal(s.reviewing[0].id, 9);
});

test('standupMarkdown renders sections', () => {
  const s = buildStandup({ created, assignedMe, merged }, { now, sinceMs: now - 24 * HOUR });
  const md = standupMarkdown(s);
  assert.match(md, /## Stand-up/);
  assert.match(md, /Recently merged/);
  assert.match(md, /shipped/);
  assert.match(md, /Blocked/);
});

test('standupIcs produces a valid VEVENT', () => {
  const s = buildStandup({ created, assignedMe, merged }, { now, sinceMs: now - 24 * HOUR });
  const ics = standupIcs(s, { at: now + HOUR });
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /BEGIN:VEVENT/);
  assert.match(ics, /SUMMARY:PR stand-up/);
  assert.match(ics, /END:VCALENDAR/);
});
