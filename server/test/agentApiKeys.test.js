import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';

// Point per-user state at a throwaway dir before importing (module reads config).
const DATA_DIR = mkdtempSync(join(os.tmpdir(), 'ado-agentkeys-'));
process.env.DATA_DIR = DATA_DIR;

const { generateApiKey, getApiKeyStatus, revokeApiKey, resolveUserIdByApiKey } =
  await import('../src/lib/agentApiKeys.js');
const { agentApiKeyAuth } = await import('../src/middleware/agentApiKeyAuth.js');
const { currentUser } = await import('../src/lib/context.js');

const UID = 'user-abc';

test('generate returns a prefixed key + non-secret metadata, resolvable to the user', () => {
  const { apiKey, prefix, createdAt } = generateApiKey(UID);
  assert.match(apiKey, /^adok_[A-Za-z0-9_-]+$/);
  assert.ok(apiKey.startsWith(prefix));
  assert.ok(Date.parse(createdAt));
  assert.equal(resolveUserIdByApiKey(apiKey), UID);

  const status = getApiKeyStatus(UID);
  assert.equal(status.hasKey, true);
  assert.equal(status.prefix, prefix);
});

test('the plaintext key is never written to disk (only its hash)', () => {
  const { apiKey } = generateApiKey('disk-user');
  const raw = readFileSync(join(DATA_DIR, 'agents', 'apikeys.json'), 'utf8');
  assert.equal(raw.includes(apiKey), false); // stored as sha-256 hash, not plaintext
  assert.equal(resolveUserIdByApiKey(apiKey), 'disk-user');
});

test('regenerating replaces the previous key (one active key per user)', () => {
  const first = generateApiKey('rotate-user');
  assert.equal(resolveUserIdByApiKey(first.apiKey), 'rotate-user');
  const second = generateApiKey('rotate-user');
  assert.notEqual(second.apiKey, first.apiKey);
  assert.equal(resolveUserIdByApiKey(first.apiKey), null); // old key no longer works
  assert.equal(resolveUserIdByApiKey(second.apiKey), 'rotate-user');
});

test('revoke removes the key; status + resolution reflect it', () => {
  const { apiKey } = generateApiKey('revoke-user');
  assert.equal(revokeApiKey('revoke-user'), true);
  assert.equal(getApiKeyStatus('revoke-user').hasKey, false);
  assert.equal(resolveUserIdByApiKey(apiKey), null);
  assert.equal(revokeApiKey('revoke-user'), false); // idempotent
});

test('unknown / malformed keys resolve to null', () => {
  assert.equal(resolveUserIdByApiKey('adok_not-a-real-key'), null);
  assert.equal(resolveUserIdByApiKey(''), null);
  assert.equal(resolveUserIdByApiKey(null), null);
});

test('middleware: a valid Bearer key establishes the user context', () => {
  const { apiKey } = generateApiKey('mw-user');
  const req = { headers: { authorization: `Bearer ${apiKey}` } };
  let seenUserId = null;
  const next = () => { seenUserId = currentUser()?.id; };
  agentApiKeyAuth(req, fakeRes(), next);
  assert.equal(seenUserId, 'mw-user');
});

test('middleware: missing / invalid keys are rejected with 401 + code', () => {
  const missing = fakeRes();
  agentApiKeyAuth({ headers: {} }, missing, () => assert.fail('next should not run'));
  assert.equal(missing.statusCode, 401);
  assert.equal(missing.body.code, 'no_api_key');

  const invalid = fakeRes();
  agentApiKeyAuth({ headers: { authorization: 'Bearer adok_bogus' } }, invalid, () => assert.fail('next should not run'));
  assert.equal(invalid.statusCode, 401);
  assert.equal(invalid.body.code, 'invalid_api_key');
});

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}
