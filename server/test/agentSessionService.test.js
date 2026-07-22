import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';

// Point per-user state at a throwaway dir before importing (module reads config).
process.env.DATA_DIR = mkdtempSync(join(os.tmpdir(), 'ado-agentsvc-'));

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
