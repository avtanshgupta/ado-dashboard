import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';

// digestService reads config.dataDir at import; point it somewhere throwaway.
process.env.DATA_DIR = mkdtempSync(join(os.tmpdir(), 'ado-digest-'));

const { isDigestDue, buildDigestText } = await import('../src/services/digestService.js');

const DAY = 86400000;

test('isDigestDue respects cadence + last sent', () => {
  const now = Date.now();
  assert.equal(isDigestDue('off', null, now), false);
  assert.equal(isDigestDue('daily', null, now), true); // never sent → due
  assert.equal(isDigestDue('daily', now - 2 * 3600 * 1000, now), false); // 2h ago
  assert.equal(isDigestDue('daily', now - 25 * 3600 * 1000, now), true); // >24h
  assert.equal(isDigestDue('weekly', now - 3 * DAY, now), false);
  assert.equal(isDigestDue('weekly', now - 8 * DAY, now), true);
});

test('buildDigestText groups by repo and filters by time', () => {
  const now = Date.now();
  const items = [
    { repo: 'Linux', message: 'new comment', timestamp: new Date(now - 1000).toISOString(), webUrl: 'http://x/1' },
    { repo: 'Mac', message: 'pipeline failed', timestamp: new Date(now - 2000).toISOString() },
    { repo: 'Linux', message: 'old one', timestamp: new Date(now - 10 * DAY).toISOString() },
  ];
  const text = buildDigestText(items, now - DAY, { cadence: 'daily' });
  assert.match(text, /2 updates/);
  assert.match(text, /\[Linux\]/);
  assert.match(text, /\[Mac\]/);
  assert.ok(!text.includes('old one'), 'items outside the window are excluded');
});

test('buildDigestText returns null when nothing is recent', () => {
  assert.equal(buildDigestText([], Date.now() - DAY), null);
});
