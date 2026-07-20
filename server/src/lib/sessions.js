import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { writeJsonAtomic } from './atomicFile.js';
import { encryptSecret, decryptSecret, isEncrypted } from './crypto.js';

/**
 * Multi-user token store for the deployed dashboard.
 *
 *  - vault:    userId -> { token, expiresAt }   (the Azure access token to use)
 *  - sessions: sid    -> { userId, user, createdAt, lastSeen }
 *
 * A browser holds an opaque `sid` cookie; the actual short-lived Azure token
 * lives in the vault keyed by userId. Either a browser re-paste or the local
 * token-pusher helper refreshes the vault, and every session for that user
 * immediately benefits — so the browser rarely needs to paste again.
 *
 * Tokens are encrypted at rest (AES-256-GCM) so a leaked `auth.json` does not
 * expose usable Azure credentials. Sessions carry an absolute + idle TTL and are
 * pruned so a stolen `sid` cookie cannot be replayed indefinitely.
 */

const dataDir = config.dataDir;
const storePath = join(dataDir, 'auth.json');

// A stolen sid is only useful while the session lives; bound its lifetime.
const SESSION_ABSOLUTE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // hard cap since sign-in
const SESSION_IDLE_TTL_MS = 2 * 24 * 60 * 60 * 1000; // since last activity

const vault = new Map();
const sessions = new Map();

function persist() {
  try {
    // Encrypt each vault token so the on-disk file never holds a raw JWT.
    const encVault = {};
    for (const [userId, v] of vault) {
      if (!v) continue;
      encVault[userId] = { token: encryptSecret(v.token), expiresAt: v.expiresAt };
    }
    const data = { vault: encVault, sessions: Object.fromEntries(sessions) };
    writeJsonAtomic(storePath, data, { mode: 0o600 });
  } catch (e) {
    console.error('[sessions] failed to persist auth store:', e.message);
  }
}

function load() {
  if (!existsSync(storePath)) return;
  let migrated = false;
  try {
    const data = JSON.parse(readFileSync(storePath, 'utf8'));
    for (const [k, v] of Object.entries(data.vault || {})) {
      if (!v || !v.token) continue;
      if (isEncrypted(v.token)) {
        const token = decryptSecret(v.token);
        if (token) vault.set(k, { token, expiresAt: v.expiresAt });
        else migrated = true; // undecryptable (key rotated / tampered) -> drop
      } else {
        // Legacy plaintext token from an older build — accept once, then it gets
        // re-encrypted on the next persist().
        vault.set(k, { token: v.token, expiresAt: v.expiresAt });
        migrated = true;
      }
    }
    for (const [k, v] of Object.entries(data.sessions || {})) sessions.set(k, v);
  } catch (e) {
    console.error('[sessions] ignoring corrupt auth store:', e.message);
  }
  // Don't keep expired tokens/sessions sitting on disk/in memory across restarts.
  const prunedTokens = pruneExpiredTokens();
  const prunedSessions = pruneExpiredSessions();
  if (migrated || prunedTokens || prunedSessions) persist();
}

/** Drop vault entries whose token has already expired. Returns true if any went. */
function pruneExpiredTokens() {
  const now = Date.now();
  let changed = false;
  for (const [userId, v] of vault) {
    if (!v || (v.expiresAt && v.expiresAt <= now)) {
      vault.delete(userId);
      changed = true;
    }
  }
  return changed;
}

/** Whether a session has exceeded its absolute or idle lifetime. */
export function isSessionExpired(session, now = Date.now()) {
  if (!session) return true;
  const created = session.createdAt || 0;
  const seen = session.lastSeen || created;
  if (now - created > SESSION_ABSOLUTE_TTL_MS) return true;
  if (now - seen > SESSION_IDLE_TTL_MS) return true;
  return false;
}

/** Drop sessions past their TTL. Returns true if any went. */
function pruneExpiredSessions() {
  const now = Date.now();
  let changed = false;
  for (const [sid, s] of sessions) {
    if (isSessionExpired(s, now)) {
      sessions.delete(sid);
      changed = true;
    }
  }
  return changed;
}

load();

/** Decode the `exp` claim (ms epoch) from a JWT access token, or null. */
export function decodeTokenExpiry(token) {
  try {
    const payload = token.split('.')[1];
    const json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (json.exp) return Number(json.exp) * 1000;
  } catch {
    /* not a JWT */
  }
  return null;
}

export function putToken(userId, token, expiresAt) {
  vault.set(userId, { token, expiresAt });
  pruneExpiredTokens(); // opportunistically drop any other stale tokens
  persist();
}

export function getVaultToken(userId) {
  return vault.get(userId) || null;
}

// --- Microsoft Graph token vault (separate from ADO token) ---
const graphVault = new Map();

export function putGraphToken(userId, token, expiresAt) {
  graphVault.set(userId, { token, expiresAt });
}

export function getGraphToken(userId) {
  const entry = graphVault.get(userId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    graphVault.delete(userId);
    return null;
  }
  return entry;
}

export function createSession(user) {
  const sid = randomBytes(24).toString('hex');
  const now = Date.now();
  sessions.set(sid, { userId: user.id, user, createdAt: now, lastSeen: now });
  persist();
  return sid;
}

/**
 * Issue a fresh sid for a user and invalidate the old one. Called when a session
 * is re-authenticated (token refresh) so a previously-captured sid can't be
 * replayed after the user re-establishes trust.
 */
export function rotateSession(oldSid, user) {
  if (oldSid) sessions.delete(oldSid);
  return createSession(user);
}

export function getSession(sid) {
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (isSessionExpired(s)) {
    sessions.delete(sid);
    persist();
    return null;
  }
  s.lastSeen = Date.now(); // in-memory activity touch (persisted on next write)
  return s;
}

export function destroySession(sid) {
  if (sid && sessions.has(sid)) {
    sessions.delete(sid);
    persist();
  }
}
