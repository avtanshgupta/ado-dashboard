/**
 * Per-user API keys for the Copilot session reporter.
 *
 * A headless reporter running on a VM (via cron) has no browser session, so it
 * authenticates its heartbeats with a long-lived per-user API key instead. Keys
 * are stored only as SHA-256 hashes in a reverse index (hash -> { userId, … }),
 * so a leaked `apikeys.json` can't be replayed as a usable credential. The plain
 * key is shown to the user exactly once, at generation time.
 *
 * One active key per user: generating a new key revokes the previous one.
 */
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { config } from '../config.js';
import { writeJsonAtomic } from './atomicFile.js';

const agentsDir = join(config.dataDir, 'agents');
const storePath = join(agentsDir, 'apikeys.json');

const KEY_PREFIX = 'adok_'; // identifies an ADO-dashboard key in logs/UI
const PREFIX_DISPLAY_LEN = KEY_PREFIX.length + 4; // e.g. "adok_9f3a"

function ensureDir() {
  if (!existsSync(agentsDir)) mkdirSync(agentsDir, { recursive: true });
}

function hashKey(key) {
  return createHash('sha256').update(String(key)).digest('hex');
}

/** Load the hash -> meta index (best-effort; a corrupt file reads as empty). */
function load() {
  ensureDir();
  if (!existsSync(storePath)) return {};
  try {
    const data = JSON.parse(readFileSync(storePath, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function save(index) {
  ensureDir();
  writeJsonAtomic(storePath, index, { mode: 0o600 });
}

function removeUserKeys(index, userId) {
  let changed = false;
  for (const [hash, meta] of Object.entries(index)) {
    if (meta && meta.userId === userId) {
      delete index[hash];
      changed = true;
    }
  }
  return changed;
}

/**
 * Mint a fresh API key for a user, revoking any previous one. Returns the plain
 * key (shown once) plus non-secret metadata; only the hash is persisted.
 */
export function generateApiKey(userId) {
  const index = load();
  removeUserKeys(index, userId);
  const apiKey = KEY_PREFIX + randomBytes(24).toString('base64url');
  const prefix = apiKey.slice(0, PREFIX_DISPLAY_LEN);
  const createdAt = new Date().toISOString();
  index[hashKey(apiKey)] = { userId, prefix, createdAt };
  save(index);
  return { apiKey, prefix, createdAt };
}

/** Non-secret status for the UI: whether a key exists, its display prefix + age. */
export function getApiKeyStatus(userId) {
  const index = load();
  for (const meta of Object.values(index)) {
    if (meta && meta.userId === userId) {
      return { hasKey: true, prefix: meta.prefix, createdAt: meta.createdAt };
    }
  }
  return { hasKey: false };
}

/** Revoke a user's key(s). Returns true if anything was removed. */
export function revokeApiKey(userId) {
  const index = load();
  const changed = removeUserKeys(index, userId);
  if (changed) save(index);
  return changed;
}

/** Resolve the userId that owns a presented API key, or null if unknown. */
export function resolveUserIdByApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') return null;
  const meta = load()[hashKey(apiKey)];
  return meta ? meta.userId : null;
}
