import { test } from 'node:test';
import assert from 'node:assert/strict';

// A fixed 32-byte key (64 hex). Set BEFORE any encrypt/decrypt call; crypto.js
// resolves the key lazily, so setting it here (after the hoisted import) is fine.
process.env.TOKEN_ENC_KEY = 'a'.repeat(64);

const { encryptSecret, decryptSecret, isEncrypted } = await import('../src/lib/crypto.js');

test('round-trips a secret through encrypt/decrypt', () => {
  const secret = 'eyJ0.header.payload.signature-ish-token';
  const enc = encryptSecret(secret);
  assert.ok(isEncrypted(enc), 'payload should be tagged as encrypted');
  assert.ok(!enc.includes(secret), 'ciphertext must not contain the plaintext');
  assert.equal(decryptSecret(enc), secret);
});

test('produces a fresh IV each time (ciphertext differs)', () => {
  const a = encryptSecret('same');
  const b = encryptSecret('same');
  assert.notEqual(a, b);
  assert.equal(decryptSecret(a), 'same');
  assert.equal(decryptSecret(b), 'same');
});

test('rejects tampered ciphertext (GCM auth)', () => {
  const enc = encryptSecret('tamper-me');
  const parts = enc.split(':');
  // Flip a byte in the ciphertext segment.
  const ct = Buffer.from(parts[3], 'base64');
  ct[0] ^= 0xff;
  parts[3] = ct.toString('base64');
  assert.equal(decryptSecret(parts.join(':')), null);
});

test('isEncrypted only matches the versioned payload', () => {
  assert.equal(isEncrypted('plain'), false);
  assert.equal(isEncrypted(''), false);
  assert.equal(isEncrypted(null), false);
  assert.equal(isEncrypted(encryptSecret('x')), true);
});

test('decryptSecret returns null for non-payloads', () => {
  assert.equal(decryptSecret('not-encrypted'), null);
  assert.equal(decryptSecret('v1:bad:payload'), null);
});
