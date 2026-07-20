/**
 * Agent Session Service — manages Copilot CLI session heartbeats and status.
 * Sessions are persisted per-user in JSON files. Status is computed from
 * heartbeat age (no background daemon needed).
 */
import { randomUUID } from 'node:crypto';
import { loadSessions, saveSessions } from '../lib/agentStore.js';

// Default thresholds (overridable per-user via settings)
const DEFAULT_STALE_MS = 5 * 60 * 1000;    // 5 minutes
const DEFAULT_ENDED_MS = 30 * 60 * 1000;   // 30 minutes
const DEFAULT_PRUNE_MS = 24 * 60 * 60 * 1000; // 24 hours

function computeStatus(session, now, staleMs = DEFAULT_STALE_MS, endedMs = DEFAULT_ENDED_MS) {
  if (session.status === 'ended') return 'ended';
  const elapsed = now - new Date(session.lastHeartbeat).getTime();
  if (elapsed > endedMs) return 'ended';
  if (elapsed > staleMs) return 'stale';
  return session.status === 'idle' ? 'idle' : 'active';
}

function enrichSession(session, now, staleMs, endedMs) {
  const computedStatus = computeStatus(session, now, staleMs, endedMs);
  const runtime = now - new Date(session.startTime).getTime();
  return {
    ...session,
    status: computedStatus,
    runtimeMs: runtime,
    runtime: formatDuration(runtime),
    lastHeartbeatAgo: formatDuration(now - new Date(session.lastHeartbeat).getTime()),
  };
}

function formatDuration(ms) {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

/**
 * Upsert a session heartbeat. If a session with the same machineId + sessionId
 * exists, update its lastHeartbeat and metadata. Otherwise create a new session.
 */
export function heartbeat(userId, data) {
  const store = loadSessions(userId);
  const now = new Date().toISOString();
  const existing = store.sessions.find(
    (s) => s.machineId === data.machineId && s.sessionId === data.sessionId && s.status !== 'ended'
  );

  if (existing) {
    existing.lastHeartbeat = now;
    if (data.repo) existing.repo = data.repo;
    if (data.branch) existing.branch = data.branch;
    if (data.cwd) existing.cwd = data.cwd;
    if (data.agentType) existing.agentType = data.agentType;
    if (data.status) existing.status = data.status;
    saveSessions(userId, store);
    return existing;
  }

  const session = {
    id: `sess-${randomUUID().slice(0, 8)}`,
    userId,
    machineId: data.machineId || 'unknown',
    machineName: data.machineName || data.machineId || 'unknown',
    sessionId: data.sessionId || randomUUID().slice(0, 8),
    repo: data.repo || '',
    branch: data.branch || '',
    cwd: data.cwd || '',
    status: data.status || 'active',
    agentType: data.agentType || 'copilot-cli',
    startTime: now,
    lastHeartbeat: now,
    metadata: data.metadata || {},
  };
  store.sessions.push(session);
  saveSessions(userId, store);
  return session;
}

/** Get all sessions for a user with computed status. */
export function getSessions(userId, { staleMs, endedMs } = {}) {
  const store = loadSessions(userId);
  const now = Date.now();
  return store.sessions
    .map((s) => enrichSession(s, now, staleMs, endedMs))
    .sort((a, b) => new Date(b.lastHeartbeat) - new Date(a.lastHeartbeat));
}

/** Get sessions grouped by machine. */
export function getSessionsByMachine(userId, opts = {}) {
  const sessions = getSessions(userId, opts);
  const grouped = {};
  for (const s of sessions) {
    const key = s.machineName || s.machineId;
    if (!grouped[key]) grouped[key] = { machine: key, machineId: s.machineId, sessions: [] };
    grouped[key].sessions.push(s);
  }
  return Object.values(grouped);
}

/** Mark a session as ended. */
export function endSession(userId, sessionId) {
  const store = loadSessions(userId);
  const session = store.sessions.find((s) => s.id === sessionId);
  if (session) {
    session.status = 'ended';
    saveSessions(userId, store);
  }
  return session;
}

/** Prune old ended sessions (older than pruneMs). */
export function pruneSessions(userId, pruneMs = DEFAULT_PRUNE_MS) {
  const store = loadSessions(userId);
  const cutoff = Date.now() - pruneMs;
  const before = store.sessions.length;
  store.sessions = store.sessions.filter((s) => {
    if (s.status !== 'ended') return true;
    return new Date(s.lastHeartbeat).getTime() > cutoff;
  });
  if (store.sessions.length < before) saveSessions(userId, store);
  return before - store.sessions.length;
}

/** Summary counts by status. */
export function getSummary(userId, opts = {}) {
  const sessions = getSessions(userId, opts);
  return {
    total: sessions.length,
    active: sessions.filter((s) => s.status === 'active').length,
    idle: sessions.filter((s) => s.status === 'idle').length,
    stale: sessions.filter((s) => s.status === 'stale').length,
    ended: sessions.filter((s) => s.status === 'ended').length,
  };
}
