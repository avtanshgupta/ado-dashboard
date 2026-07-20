import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';

// Point state at a throwaway dir and set a key BEFORE importing sessions.js
// (its module-load calls load()/persist()).
process.env.DATA_DIR = mkdtempSync(join(os.tmpdir(), 'ado-sessions-'));
process.env.TOKEN_ENC_KEY = 'b'.repeat(64);

const { isSessionExpired, decodeTokenExpiry } = await import('../src/lib/sessions.js');

const DAY = 24 * 60 * 60 * 1000;

test('a fresh session is not expired', () => {
  const now = Date.now();
  assert.equal(isSessionExpired({ createdAt: now, lastSeen: now }, now), false);
});

test('a session past the absolute TTL is expired', () => {
  const now = Date.now();
  assert.equal(isSessionExpired({ createdAt: now - 8 * DAY, lastSeen: now }, now), true);
});

test('an idle session is expired even if recently created', () => {
  const now = Date.now();
  assert.equal(isSessionExpired({ createdAt: now - 1 * DAY, lastSeen: now - 3 * DAY }, now), true);
});

test('a null session is treated as expired', () => {
  assert.equal(isSessionExpired(null), true);
});

test('decodeTokenExpiry reads the exp claim (ms epoch)', () => {
  const expSecs = Math.floor(Date.now() / 1000) + 3600;
  const payload = Buffer.from(JSON.stringify({ exp: expSecs })).toString('base64url');
  const jwt = `header.${payload}.sig`;
  assert.equal(decodeTokenExpiry(jwt), expSecs * 1000);
});

test('decodeTokenExpiry returns null for a non-JWT', () => {
  assert.equal(decodeTokenExpiry('not-a-jwt'), null);
});
