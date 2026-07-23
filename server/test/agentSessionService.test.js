import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, rmSync } from 'node:fs';

// Point per-user state at a throwaway dir before importing (module reads config).
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '.test-data', `agentSessionService-${process.pid}`);
rmSync(DATA_DIR, { recursive: true, force: true });
mkdirSync(DATA_DIR, { recursive: true });
process.env.DATA_DIR = DATA_DIR;

const svc = await import('../src/services/agentSessionService.js');

const UID = 'svc-user';

test('heartbeat + grouping resolves the reporter hostname by default', () => {
  svc.heartbeat(UID, { machineId: 'vm-1', machineName: 'vm-1', sessionId: 's1', repo: 'repoA', branch: 'main', status: 'active' });
  const groups = svc.getSessionsByMachine(UID);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].machineId, 'vm-1');
  assert.equal(groups[0].name, 'vm-1'); // reporter hostname
  assert.equal(groups[0].label, ''); // no custom name yet
  assert.equal(groups[0].sessions.length, 1);
});

test('setMachineLabel overrides the display name; blank clears it', () => {
  const r = svc.setMachineLabel(UID, 'vm-1', '  Build Box  ');
  assert.deepEqual(r, { machineId: 'vm-1', label: 'Build Box' }); // trimmed
  assert.equal(svc.getMachineLabels(UID)['vm-1'], 'Build Box');
  assert.equal(svc.getSessionsByMachine(UID)[0].name, 'Build Box');
  assert.equal(svc.getSessionsByMachine(UID)[0].label, 'Build Box');
  // Clearing reverts to the reporter hostname.
  svc.setMachineLabel(UID, 'vm-1', '');
  assert.equal(svc.getSessionsByMachine(UID)[0].name, 'vm-1');
  assert.equal('vm-1' in svc.getMachineLabels(UID), false);
});

test('setMachineLabel requires a machineId', () => {
  assert.throws(() => svc.setMachineLabel(UID, '', 'x'), /machineId is required/);
});

test('removeMachine drops all sessions for a machine and its label', () => {
  const U = 'rm-user';
  svc.heartbeat(U, { machineId: 'gone', machineName: 'gone', sessionId: 'a', repo: 'r', status: 'active' });
  svc.heartbeat(U, { machineId: 'gone', machineName: 'gone', sessionId: 'b', repo: 'r', status: 'active' });
  svc.heartbeat(U, { machineId: 'stay', machineName: 'stay', sessionId: 'c', repo: 'r', status: 'active' });
  svc.setMachineLabel(U, 'gone', 'Doomed Box');

  const res = svc.removeMachine(U, 'gone');
  assert.deepEqual(res, { machineId: 'gone', removed: 2 });
  const groups = svc.getSessionsByMachine(U);
  assert.deepEqual(groups.map((g) => g.machineId), ['stay']); // only the other machine remains
  assert.equal('gone' in svc.getMachineLabels(U), false); // label cleared too
});

test('removeMachine requires a machineId', () => {
  assert.throws(() => svc.removeMachine(UID, ''), /machineId is required/);
});

test('longRunning flag is set when runtime exceeds the threshold', () => {
  const U = 'lr-user';
  svc.heartbeat(U, { machineId: 'm', machineName: 'm', sessionId: 's', repo: 'r', status: 'active' });
  // No threshold given → never long-running.
  assert.equal(svc.getSessions(U)[0].longRunning, false);
  // A huge threshold → not yet; a threshold below the (>=0) runtime → long-running.
  assert.equal(svc.getSessions(U, { longRunningMs: 60 * 60 * 1000 })[0].longRunning, false);
  assert.equal(svc.getSessions(U, { longRunningMs: -1 })[0].longRunning, true);
  assert.equal(svc.getOverview(U, { longRunningMs: -1 }).longRunning, 1);
});

test('heartbeat merges metadata, counts beats, and records status transitions', () => {
  const U = 'meta-user';
  svc.heartbeat(U, { machineId: 'm', sessionId: 's', status: 'active', metadata: { version: '1.2.3' } });
  svc.heartbeat(U, { machineId: 'm', sessionId: 's', status: 'idle', metadata: { pid: '42' } });
  const s = svc.getSessions(U)[0];
  assert.equal(s.heartbeatCount, 2);
  assert.deepEqual(s.metadata, { version: '1.2.3', pid: '42' }); // merged
  assert.deepEqual(s.history.map((h) => h.status), ['active', 'idle']); // transition recorded
});

test('heartbeat status ended closes an existing live session and records history', () => {
  const U = 'ended-heartbeat-user';
  svc.heartbeat(U, { machineId: 'm', sessionId: 's', status: 'active', metadata: { version: '1.2.3' } });
  svc.heartbeat(U, { machineId: 'm', sessionId: 's', status: 'ended', metadata: { endedByReporter: true } });
  const s = svc.getSessions(U)[0];
  assert.equal(s.status, 'ended');
  assert.equal(s.heartbeatCount, 2);
  assert.deepEqual(s.history.map((h) => h.status), ['active', 'ended']);
  assert.deepEqual(s.metadata, { version: '1.2.3', endedByReporter: true });
});

test('heartbeat preserves and merges optional safe reporter metrics', () => {
  const U = 'optional-metrics-user';
  svc.heartbeat(U, {
    machineId: 'm',
    sessionId: 's',
    status: 'active',
    metadata: { version: '1.2.3', uptimeSec: 90, agentCount: 2 },
  });
  svc.heartbeat(U, {
    machineId: 'm',
    sessionId: 's',
    status: 'active',
    metadata: { paneCount: 4, collector: 'tmux' },
  });
  const s = svc.getSessions(U)[0];
  assert.deepEqual(s.metadata, {
    version: '1.2.3',
    uptimeSec: 90,
    agentCount: 2,
    paneCount: 4,
    collector: 'tmux',
  });
});

test('getSessionById returns an enriched session or null', () => {
  const U = 'byid-user';
  const created = svc.heartbeat(U, { machineId: 'm', sessionId: 's', status: 'active' });
  const got = svc.getSessionById(U, created.id);
  assert.equal(got.id, created.id);
  assert.ok('runtime' in got && 'lastHeartbeatAgo' in got);
  assert.equal(svc.getSessionById(U, 'missing'), null);
});

test('clearEndedSessions removes computed-ended sessions immediately', () => {
  const U = 'clear-user';
  svc.heartbeat(U, { machineId: 'live', sessionId: 'a', status: 'active' });
  const gone = svc.heartbeat(U, { machineId: 'old', sessionId: 'b', status: 'active' });
  svc.endSession(U, gone.id); // mark ended
  const removed = svc.clearEndedSessions(U);
  assert.equal(removed, 1);
  assert.deepEqual(svc.getSessionsByMachine(U).map((g) => g.machineId), ['live']);
});

test('getAnalytics reports agent-hours, per-machine, per-repo and histograms', () => {
  const U = 'an-user';
  svc.heartbeat(U, { machineId: 'm1', sessionId: 'a', repo: 'repoX', status: 'active' });
  svc.heartbeat(U, { machineId: 'm2', sessionId: 'b', repo: 'repoY', status: 'active' });
  const a = svc.getAnalytics(U);
  assert.equal(a.totalSessions, 2);
  assert.equal(typeof a.agentHours, 'number');
  assert.equal(a.perMachine.length, 2);
  assert.equal(a.byHour.length, 24);
  assert.ok(a.perRepo.find((r) => r.repo === 'repoX'));
});

test('a custom label survives later heartbeats', () => {
  svc.setMachineLabel(UID, 'vm-1', 'Build Box');
  svc.heartbeat(UID, { machineId: 'vm-1', machineName: 'vm-1', sessionId: 's1', repo: 'repoA', status: 'active' });
  assert.equal(svc.getMachineLabels(UID)['vm-1'], 'Build Box'); // not wiped by the save
  assert.equal(svc.getSessionsByMachine(UID)[0].name, 'Build Box');
});

test('getOverview aggregates machines, status, repos and highlights', () => {
  const U = 'ov-user';
  svc.heartbeat(U, { machineId: 'm1', machineName: 'm1', sessionId: 'a', repo: 'repoX', status: 'active' });
  svc.heartbeat(U, { machineId: 'm1', machineName: 'm1', sessionId: 'b', repo: 'repoX', status: 'active' });
  svc.heartbeat(U, { machineId: 'm2', machineName: 'm2', sessionId: 'c', repo: 'repoY', status: 'idle' });
  const o = svc.getOverview(U);
  assert.equal(o.totalMachines, 2);
  assert.equal(o.machinesOnline, 2); // active + idle both count as online
  assert.equal(o.totalSessions, 3);
  assert.equal(o.liveSessions, 3);
  assert.equal(o.active, 2);
  assert.equal(o.idle, 1);
  assert.equal(o.topRepos[0].repo, 'repoX'); // busiest first
  assert.equal(o.topRepos[0].count, 2);
  assert.ok(o.longestRunning && o.longestRunning.name);
  assert.notEqual(o.lastActivityAgo, null);
});

test('getOverview is safe with no sessions', () => {
  const o = svc.getOverview('empty-user');
  assert.equal(o.totalMachines, 0);
  assert.equal(o.totalSessions, 0);
  assert.deepEqual(o.topRepos, []);
  assert.equal(o.longestRunning, null);
  assert.equal(o.lastActivityAgo, null);
});

test('getAnalytics buckets busiest hour + day in the requested time zone', () => {
  const U = 'tz-analytics-user';
  svc.heartbeat(U, { machineId: 'm', sessionId: 's', status: 'active' });
  const start = new Date(svc.getSessions(U)[0].startTime);
  for (const tz of ['UTC', 'Asia/Kolkata', 'America/New_York']) {
    const a = svc.getAnalytics(U, { tz });
    assert.equal(a.timezone, tz, 'echoes the requested zone');
    const expectedHour = Number(
      new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(start)
    ) % 24;
    const hourBucket = a.byHour.find((h) => h.count > 0);
    assert.ok(hourBucket, 'one hour bucket is populated');
    assert.equal(hourBucket.hour, expectedHour, `hour bucket matches ${tz}`);
    const expectedDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(start);
    assert.equal(a.byDay[0].day, expectedDay, `day bucket matches ${tz}`);
  }
});

test('getAnalytics falls back gracefully for an invalid time zone', () => {
  const U = 'tz-analytics-bad';
  svc.heartbeat(U, { machineId: 'm', sessionId: 's', status: 'active' });
  const a = svc.getAnalytics(U, { tz: 'Not/AZone' });
  // Never throws; still returns 24 hour buckets with exactly one populated.
  assert.equal(a.byHour.length, 24);
  assert.equal(a.byHour.filter((h) => h.count > 0).length, 1);
});
