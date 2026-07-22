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
const HISTORY_CAP = 30;                     // bounded per-session status log

function computeStatus(session, now, staleMs = DEFAULT_STALE_MS, endedMs = DEFAULT_ENDED_MS) {
  if (session.status === 'ended') return 'ended';
  const elapsed = now - new Date(session.lastHeartbeat).getTime();
  if (elapsed > endedMs) return 'ended';
  if (elapsed > staleMs) return 'stale';
  return session.status === 'idle' ? 'idle' : 'active';
}

function formatDuration(ms) {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.round((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

/** Attach computed status + derived timing/flags to a stored session. */
function enrichSession(session, now, opts = {}) {
  const { staleMs, endedMs, longRunningMs } = opts;
  const computedStatus = computeStatus(session, now, staleMs, endedMs);
  const runtimeMs = now - new Date(session.startTime).getTime();
  return {
    ...session,
    status: computedStatus,
    runtimeMs,
    runtime: formatDuration(runtimeMs),
    // "Long-running" flags a live session whose runtime exceeds the user's
    // configured threshold (Settings → Agents → long-running hours).
    longRunning: computedStatus !== 'ended' && longRunningMs != null && runtimeMs > longRunningMs,
    lastHeartbeatAgo: formatDuration(now - new Date(session.lastHeartbeat).getTime()),
  };
}

function pushHistory(session, entry) {
  if (!Array.isArray(session.history)) session.history = [];
  session.history.push(entry);
  if (session.history.length > HISTORY_CAP) session.history = session.history.slice(-HISTORY_CAP);
}

/**
 * Upsert a session heartbeat. If a session with the same machineId + sessionId
 * exists, refresh it; otherwise create a new one. Records reporter-status
 * transitions and merges reporter metadata (version/model/pid…).
 */
export function heartbeat(userId, data) {
  const store = loadSessions(userId);
  const nowIso = new Date().toISOString();
  const existing = store.sessions.find(
    (s) => s.machineId === data.machineId && s.sessionId === data.sessionId && s.status !== 'ended'
  );
  const reportedStatus = data.status || 'active';

  if (existing) {
    existing.lastHeartbeat = nowIso;
    existing.heartbeatCount = (existing.heartbeatCount || 1) + 1;
    if (data.repo) existing.repo = data.repo;
    if (data.branch) existing.branch = data.branch;
    if (data.cwd) existing.cwd = data.cwd;
    if (data.agentType) existing.agentType = data.agentType;
    if (data.metadata && typeof data.metadata === 'object') {
      existing.metadata = { ...(existing.metadata || {}), ...data.metadata };
    }
    if (data.status && data.status !== existing.status) {
      existing.status = data.status;
      pushHistory(existing, { t: nowIso, status: data.status });
    }
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
    status: reportedStatus,
    agentType: data.agentType || 'copilot-cli',
    startTime: nowIso,
    lastHeartbeat: nowIso,
    heartbeatCount: 1,
    metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : {},
    history: [{ t: nowIso, status: reportedStatus }],
  };
  store.sessions.push(session);
  saveSessions(userId, store);
  return session;
}

/** Get all sessions for a user with computed status, newest heartbeat first. */
export function getSessions(userId, opts = {}) {
  const store = loadSessions(userId);
  const now = Date.now();
  return store.sessions
    .map((s) => enrichSession(s, now, opts))
    .sort((a, b) => new Date(b.lastHeartbeat) - new Date(a.lastHeartbeat));
}

/** A single enriched session by id (for the detail drawer), or null. */
export function getSessionById(userId, id, opts = {}) {
  const store = loadSessions(userId);
  const s = store.sessions.find((x) => x.id === id);
  return s ? enrichSession(s, Date.now(), opts) : null;
}

/** Roll a machine's session statuses up into a single machine-level status. */
function machineStatus(sessions) {
  if (sessions.some((s) => s.status === 'active')) return 'active';
  if (sessions.some((s) => s.status === 'idle')) return 'idle';
  if (sessions.some((s) => s.status === 'stale')) return 'stale';
  return 'ended';
}

/** Get sessions grouped by machine, with custom name, machine status + last-seen. */
export function getSessionsByMachine(userId, opts = {}) {
  const store = loadSessions(userId);
  const labels = store.machineLabels || {};
  const now = Date.now();
  const sessions = store.sessions
    .map((s) => enrichSession(s, now, opts))
    .sort((a, b) => new Date(b.lastHeartbeat) - new Date(a.lastHeartbeat));

  const grouped = {};
  for (const s of sessions) {
    const mid = s.machineId;
    if (!grouped[mid]) {
      const label = labels[mid] || '';
      grouped[mid] = {
        machineId: mid,
        machineName: s.machineName, // reporter-provided hostname
        label, // user-set custom name (may be '')
        name: label || s.machineName || mid, // resolved display name
        sessions: [],
      };
    }
    grouped[mid].sessions.push(s);
  }

  const groups = Object.values(grouped);
  for (const g of groups) {
    g.status = machineStatus(g.sessions);
    g.online = g.status === 'active' || g.status === 'idle';
    g.longRunning = g.sessions.some((s) => s.longRunning);
    g.lastSeen = g.sessions[0].lastHeartbeat; // newest (sessions already sorted)
    g.lastSeenAgo = formatDuration(now - new Date(g.lastSeen).getTime());
  }
  // Live machines first, then by most-recent activity.
  return groups.sort(
    (a, b) => Number(b.online) - Number(a.online) || new Date(b.lastSeen) - new Date(a.lastSeen)
  );
}

/** The per-user map of machineId → custom display name. */
export function getMachineLabels(userId) {
  const store = loadSessions(userId);
  return store.machineLabels && typeof store.machineLabels === 'object' ? store.machineLabels : {};
}

/**
 * Set (or clear) a custom display name for a machine. A blank label removes the
 * override, reverting to the reporter-provided hostname. Returns { machineId, label }.
 */
export function setMachineLabel(userId, machineId, label) {
  const mid = String(machineId || '').trim();
  if (!mid) {
    const e = new Error('machineId is required');
    e.status = 400;
    throw e;
  }
  const clean = String(label || '').trim().slice(0, 80);
  const store = loadSessions(userId);
  if (!store.machineLabels || typeof store.machineLabels !== 'object') store.machineLabels = {};
  if (clean) store.machineLabels[mid] = clean;
  else delete store.machineLabels[mid];
  saveSessions(userId, store);
  return { machineId: mid, label: clean };
}

/**
 * Remove a machine from the dashboard: drop all of its sessions and any custom
 * label. If the machine is still reporting, it reappears on its next heartbeat.
 * Returns { machineId, removed } where `removed` is the session count deleted.
 */
export function removeMachine(userId, machineId) {
  const mid = String(machineId || '').trim();
  if (!mid) {
    const e = new Error('machineId is required');
    e.status = 400;
    throw e;
  }
  const store = loadSessions(userId);
  const before = store.sessions.length;
  store.sessions = store.sessions.filter((s) => s.machineId !== mid);
  const removed = before - store.sessions.length;
  if (store.machineLabels && mid in store.machineLabels) delete store.machineLabels[mid];
  saveSessions(userId, store);
  return { machineId: mid, removed };
}

/** Mark a session as ended. */
export function endSession(userId, sessionId) {
  const store = loadSessions(userId);
  const session = store.sessions.find((s) => s.id === sessionId);
  if (session) {
    session.status = 'ended';
    pushHistory(session, { t: new Date().toISOString(), status: 'ended' });
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

/** Remove every ended session immediately (computed-ended included). */
export function clearEndedSessions(userId, opts = {}) {
  const store = loadSessions(userId);
  const now = Date.now();
  const before = store.sessions.length;
  store.sessions = store.sessions.filter(
    (s) => computeStatus(s, now, opts.staleMs, opts.endedMs) !== 'ended'
  );
  const removed = before - store.sessions.length;
  if (removed) saveSessions(userId, store);
  return removed;
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

/**
 * A richer roll-up for the Agents overview: machine counts (online/offline),
 * status breakdown, long-running count, busiest repos, longest-running session,
 * and last activity.
 */
export function getOverview(userId, opts = {}) {
  const store = loadSessions(userId);
  const labels = store.machineLabels || {};
  const now = Date.now();
  const sessions = store.sessions.map((s) => enrichSession(s, now, opts));

  const byStatus = (st) => sessions.filter((s) => s.status === st).length;
  const machineIds = new Set(sessions.map((s) => s.machineId));
  const onlineMachines = new Set(
    sessions.filter((s) => s.status === 'active' || s.status === 'idle').map((s) => s.machineId)
  );
  const live = sessions.filter((s) => s.status !== 'ended');

  const repoCounts = {};
  for (const s of live) {
    if (s.repo) repoCounts[s.repo] = (repoCounts[s.repo] || 0) + 1;
  }
  const topRepos = Object.entries(repoCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([repo, count]) => ({ repo, count }));

  const longest = live.reduce((max, s) => (s.runtimeMs > (max?.runtimeMs ?? -1) ? s : max), null);
  const longestRunning = longest
    ? {
        name: labels[longest.machineId] || longest.machineName || longest.machineId,
        repo: longest.repo || '',
        runtime: longest.runtime,
      }
    : null;

  const lastHeartbeatMs = sessions.reduce(
    (m, s) => Math.max(m, new Date(s.lastHeartbeat).getTime() || 0),
    0
  );

  return {
    totalMachines: machineIds.size,
    machinesOnline: onlineMachines.size,
    machinesOffline: machineIds.size - onlineMachines.size,
    totalSessions: sessions.length,
    liveSessions: live.length,
    active: byStatus('active'),
    idle: byStatus('idle'),
    stale: byStatus('stale'),
    ended: byStatus('ended'),
    longRunning: sessions.filter((s) => s.longRunning).length,
    topRepos,
    longestRunning,
    lastActivityAgo: lastHeartbeatMs ? formatDuration(now - lastHeartbeatMs) : null,
  };
}

/**
 * Usage analytics across all retained sessions: total agent-hours, per-machine
 * uptime, busiest hour-of-day, recent daily activity, and per-repo counts.
 */
export function getAnalytics(userId, opts = {}) {
  const store = loadSessions(userId);
  const labels = store.machineLabels || {};
  const now = Date.now();
  const sessions = store.sessions.map((s) => enrichSession(s, now, opts));

  const durationMs = (s) => {
    const start = new Date(s.startTime).getTime();
    const end = s.status === 'ended' ? new Date(s.lastHeartbeat).getTime() : now;
    return Math.max(0, end - start);
  };
  const totalMs = sessions.reduce((a, s) => a + durationMs(s), 0);

  const perMachineMap = {};
  for (const s of sessions) {
    const m =
      perMachineMap[s.machineId] ||
      (perMachineMap[s.machineId] = {
        machineId: s.machineId,
        name: labels[s.machineId] || s.machineName || s.machineId,
        sessions: 0,
        ms: 0,
        lastSeenMs: 0,
      });
    m.sessions += 1;
    m.ms += durationMs(s);
    m.lastSeenMs = Math.max(m.lastSeenMs, new Date(s.lastHeartbeat).getTime());
  }
  const perMachine = Object.values(perMachineMap)
    .map((m) => ({
      machineId: m.machineId,
      name: m.name,
      sessions: m.sessions,
      agentHours: +(m.ms / 3_600_000).toFixed(1),
      lastSeenAgo: m.lastSeenMs ? formatDuration(now - m.lastSeenMs) : null,
    }))
    .sort((a, b) => b.agentHours - a.agentHours);

  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
  for (const s of sessions) byHour[new Date(s.startTime).getHours()].count += 1;

  const dayMap = {};
  for (const s of sessions) {
    const day = new Date(s.startTime).toISOString().slice(0, 10);
    dayMap[day] = (dayMap[day] || 0) + 1;
  }
  const byDay = Object.entries(dayMap)
    .sort()
    .slice(-14)
    .map(([day, count]) => ({ day, count }));

  const repoMap = {};
  for (const s of sessions) if (s.repo) repoMap[s.repo] = (repoMap[s.repo] || 0) + 1;
  const perRepo = Object.entries(repoMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([repo, count]) => ({ repo, count }));

  return {
    totalSessions: sessions.length,
    agentHours: +(totalMs / 3_600_000).toFixed(1),
    perMachine,
    byHour,
    byDay,
    perRepo,
  };
}
