import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';

/**
 * Symmetric encryption for secrets stored at rest (Azure access tokens in the
 * vault). AES-256-GCM (authenticated) with a 32-byte key resolved lazily:
 *
 *   1. `TOKEN_ENC_KEY` env — 64 hex chars or 44-char base64 (32 bytes). Preferred
 *      for hosted deployments: the key lives outside the data dir (e.g. sourced
 *      from Key Vault), so a leaked `auth.json` alone is useless.
 *   2. Otherwise a per-install keyfile `<dataDir>/.token-key` (0600), generated
 *      once. This still separates the key from the data file and means tokens are
 *      never written in cleartext even with zero configuration.
 *
 * Payload format: `v1:<iv b64>:<authTag b64>:<ciphertext b64>`.
 */

const PREFIX = 'v1:';
let cachedKey = null;

function decodeEnvKey(raw) {
  const s = String(raw).trim();
  // hex (64 chars) or base64 (decodes to 32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex');
  const b = Buffer.from(s, 'base64');
  if (b.length === 32) return b;
  throw new Error('TOKEN_ENC_KEY must be 32 bytes (64 hex chars or base64).');
}

function resolveKey() {
  if (cachedKey) return cachedKey;
  if (process.env.TOKEN_ENC_KEY) {
    cachedKey = decodeEnvKey(process.env.TOKEN_ENC_KEY);
    return cachedKey;
  }
  const dir = config.dataDir;
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const keyPath = join(dir, '.token-key');
  if (existsSync(keyPath)) {
    cachedKey = Buffer.from(readFileSync(keyPath, 'utf8').trim(), 'hex');
    if (cachedKey.length !== 32) throw new Error('Corrupt token key file.');
    return cachedKey;
  }
  cachedKey = randomBytes(32);
  writeFileSync(keyPath, cachedKey.toString('hex'), { mode: 0o600 });
  return cachedKey;
}

/** Encrypt a UTF-8 string. Returns the versioned payload string. */
export function encryptSecret(plaintext) {
  const key = resolveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/** True if a value looks like an encryptSecret() payload. */
export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Decrypt a payload produced by encryptSecret(). Returns the plaintext, or null
 * if the payload is malformed / fails authentication (tampered or wrong key).
 */
export function decryptSecret(payload) {
  if (!isEncrypted(payload)) return null;
  try {
    const [, ivB64, tagB64, ctB64] = payload.split(':');
    const key = resolveKey();
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]);
    return pt.toString('utf8');
  } catch {
    return null;
  }
}
