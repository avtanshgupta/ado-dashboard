import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';

// Point per-user state at a throwaway dir before importing (module reads config).
const DATA_DIR = mkdtempSync(join(os.tmpdir(), 'ado-agentkeys-'));
process.env.DATA_DIR = DATA_DIR;

const { generateApiKey, listApiKeys, getApiKeyStatus, revokeApiKey, resolveUserIdByApiKey } =
  await import('../src/lib/agentApiKeys.js');
const { agentApiKeyAuth } = await import('../src/middleware/agentApiKeyAuth.js');
const { currentUser } = await import('../src/lib/context.js');

const UID = 'user-abc';

test('generate returns a named, prefixed key resolvable to the user', () => {
  const { apiKey, keyId, label, prefix, createdAt } = generateApiKey(UID, 'build-box');
  assert.match(apiKey, /^adok_[A-Za-z0-9_-]+$/);
  assert.ok(apiKey.startsWith(prefix));
  assert.equal(label, 'build-box');
  assert.ok(keyId && Date.parse(createdAt));
  assert.equal(resolveUserIdByApiKey(apiKey), UID);
});

test('multiple keys coexist — generating does not revoke the others', () => {
  const a = generateApiKey('multi', 'one');
  const b = generateApiKey('multi', 'two');
  assert.notEqual(a.apiKey, b.apiKey);
  assert.equal(resolveUserIdByApiKey(a.apiKey), 'multi');
  assert.equal(resolveUserIdByApiKey(b.apiKey), 'multi');
  const keys = listApiKeys('multi');
  assert.equal(keys.length, 2);
  assert.deepEqual(keys.map((k) => k.label).sort(), ['one', 'two']);
  assert.equal(getApiKeyStatus('multi').count, 2);
});

test('a blank label defaults to "reporter"', () => {
  assert.equal(generateApiKey('blank', '   ').label, 'reporter');
});

test('the plaintext key is never written to disk (only its hash)', () => {
  const { apiKey } = generateApiKey('disk-user', 'x');
  const raw = readFileSync(join(DATA_DIR, 'agents', 'apikeys.json'), 'utf8');
  assert.equal(raw.includes(apiKey), false); // stored as sha-256 hash
});

test('revoke removes only the targeted key', () => {
  const a = generateApiKey('rev', 'keep');
  const b = generateApiKey('rev', 'drop');
  assert.equal(revokeApiKey('rev', b.keyId), true);
  assert.equal(resolveUserIdByApiKey(b.apiKey), null);
  assert.equal(resolveUserIdByApiKey(a.apiKey), 'rev'); // sibling still valid
  assert.equal(listApiKeys('rev').length, 1);
  assert.equal(revokeApiKey('rev', 'nonexistent'), false);
});

test('resolve records a last-used timestamp', () => {
  const { apiKey, keyId } = generateApiKey('used', 'x');
  assert.equal(listApiKeys('used').find((k) => k.keyId === keyId).lastUsedAt, null);
  resolveUserIdByApiKey(apiKey);
  assert.ok(listApiKeys('used').find((k) => k.keyId === keyId).lastUsedAt);
});

test('unknown / malformed keys resolve to null', () => {
  assert.equal(resolveUserIdByApiKey('adok_not-a-real-key'), null);
  assert.equal(resolveUserIdByApiKey(''), null);
  assert.equal(resolveUserIdByApiKey(null), null);
});

test('middleware: a valid Bearer key establishes the user context', () => {
  const { apiKey } = generateApiKey('mw-user', 'x');
  const req = { headers: { authorization: `Bearer ${apiKey}` } };
  let seenUserId = null;
  agentApiKeyAuth(req, fakeRes(), () => { seenUserId = currentUser()?.id; });
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
