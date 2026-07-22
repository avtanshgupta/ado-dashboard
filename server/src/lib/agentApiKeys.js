/**
 * Per-user API keys for the Copilot session reporter.
 *
 * A headless reporter running on a VM (via cron) has no browser session, so it
 * authenticates its heartbeats with a long-lived per-user API key. Keys are
 * stored only as SHA-256 hashes in a reverse index (hash -> meta), so a leaked
 * `apikeys.json` can't be replayed as a usable credential. The plain key is shown
 * to the user exactly once, at generation time.
 *
 * Users may hold several **named** keys (one per machine/fleet) — revoking or
 * rotating one no longer invalidates every other reporter. Each key tracks a
 * label, creation time and last-used time.
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
const MAX_KEYS_PER_USER = 20;
const LAST_USED_THROTTLE_MS = 60 * 1000; // avoid a disk write on every heartbeat

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

// Stable id for a key. New keys carry an explicit keyId; legacy entries (from the
// single-key era) fall back to a hash-derived id so they remain revocable.
function keyIdFor(hash, meta) {
  return meta.keyId || hash.slice(0, 12);
}

function publicView(hash, meta) {
  return {
    keyId: keyIdFor(hash, meta),
    label: meta.label || 'reporter',
    prefix: meta.prefix,
    createdAt: meta.createdAt,
    lastUsedAt: meta.lastUsedAt || null,
  };
}

/**
 * Mint a fresh, named API key for a user (previous keys are kept). Returns the
 * plain key (shown once) plus non-secret metadata; only the hash is persisted.
 */
export function generateApiKey(userId, label) {
  const index = load();
  const mine = Object.values(index).filter((m) => m && m.userId === userId);
  if (mine.length >= MAX_KEYS_PER_USER) {
    const e = new Error(`You already have ${MAX_KEYS_PER_USER} API keys. Revoke one before creating another.`);
    e.status = 400;
    throw e;
  }
  const apiKey = KEY_PREFIX + randomBytes(24).toString('base64url');
  const prefix = apiKey.slice(0, PREFIX_DISPLAY_LEN);
  const createdAt = new Date().toISOString();
  const keyId = randomBytes(6).toString('hex');
  const cleanLabel = String(label || '').trim().slice(0, 60) || 'reporter';
  index[hashKey(apiKey)] = { userId, keyId, label: cleanLabel, prefix, createdAt, lastUsedAt: null };
  save(index);
  return { apiKey, keyId, label: cleanLabel, prefix, createdAt };
}

/** List a user's keys (non-secret), oldest first. */
export function listApiKeys(userId) {
  const index = load();
  return Object.entries(index)
    .filter(([, m]) => m && m.userId === userId)
    .map(([hash, m]) => publicView(hash, m))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

/** Lightweight status for the no-key banner: whether any key exists + how many. */
export function getApiKeyStatus(userId) {
  const keys = listApiKeys(userId);
  return { hasKey: keys.length > 0, count: keys.length };
}

/** Revoke one of a user's keys by keyId. Returns true if a key was removed. */
export function revokeApiKey(userId, keyId) {
  const index = load();
  let removed = false;
  for (const [hash, m] of Object.entries(index)) {
    if (m && m.userId === userId && keyIdFor(hash, m) === String(keyId)) {
      delete index[hash];
      removed = true;
    }
  }
  if (removed) save(index);
  return removed;
}

/**
 * Resolve the userId that owns a presented API key (or null), recording a
 * throttled last-used timestamp so the UI can show which keys are active.
 */
export function resolveUserIdByApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') return null;
  const index = load();
  const meta = index[hashKey(apiKey)];
  if (!meta) return null;
  const now = Date.now();
  const last = meta.lastUsedAt ? new Date(meta.lastUsedAt).getTime() : 0;
  if (now - last > LAST_USED_THROTTLE_MS) {
    meta.lastUsedAt = new Date(now).toISOString();
    try {
      save(index);
    } catch {
      /* best-effort last-used bookkeeping */
    }
  }
  return meta.userId;
}
