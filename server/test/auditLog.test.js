import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, existsSync, readFileSync, appendFileSync } from 'node:fs';

// Point per-user state at a throwaway dir before importing (module reads config).
const DATA_DIR = mkdtempSync(join(os.tmpdir(), 'ado-audit-'));
process.env.DATA_DIR = DATA_DIR;

const { appendAudit, readAudit } = await import('../src/lib/auditLog.js');

const UID = 'user-audit-1';

test('appendAudit writes a JSONL line and readAudit returns it', () => {
  appendAudit(UID, { method: 'POST', path: '/api/prs/repo/1/merge', status: 200, ok: true });
  const entries = readAudit(UID);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].method, 'POST');
  assert.equal(entries[0].path, '/api/prs/repo/1/merge');
  assert.equal(entries[0].ok, true);
  assert.ok(entries[0].t, 'a timestamp is added automatically');
});

test('readAudit returns newest first and respects the limit', () => {
  const uid = 'user-audit-order';
  for (let i = 0; i < 5; i++) appendAudit(uid, { method: 'PATCH', path: `/api/x/${i}`, status: 200, ok: true });
  const all = readAudit(uid);
  assert.equal(all.length, 5);
  assert.equal(all[0].path, '/api/x/4', 'newest entry is first');
  assert.equal(all[4].path, '/api/x/0');
  const limited = readAudit(uid, { limit: 2 });
  assert.equal(limited.length, 2);
  assert.equal(limited[0].path, '/api/x/4');
});

test('audit records carry no token/secret fields', () => {
  const uid = 'user-audit-safe';
  appendAudit(uid, { method: 'DELETE', path: '/api/prs/repo/9/reviewers/abc', status: 403, ok: false, ms: 12 });
  const raw = readFileSync(join(DATA_DIR, 'audit', `${uid}.jsonl`), 'utf8');
  assert.doesNotMatch(raw, /authorization|bearer|token|password|secret/i);
  const [entry] = readAudit(uid);
  assert.equal(entry.ok, false);
  assert.equal(entry.status, 403);
});

test('readAudit is empty and safe for an unknown user', () => {
  assert.deepEqual(readAudit('nobody-here'), []);
});

test('malformed lines are skipped, valid ones still returned', () => {
  const uid = 'user-audit-corrupt';
  appendAudit(uid, { method: 'POST', path: '/api/ok', status: 200, ok: true });
  // Corrupt the file with a junk line, then append another good one.
  const file = join(DATA_DIR, 'audit', `${uid}.jsonl`);
  appendFileSync(file, 'this is not json\n');
  appendAudit(uid, { method: 'POST', path: '/api/ok2', status: 201, ok: true });
  const entries = readAudit(uid);
  assert.equal(entries.length, 2);
  assert.ok(existsSync(file));
});
