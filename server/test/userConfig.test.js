import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';

// Point per-user state at a throwaway dir before importing (module reads config).
process.env.DATA_DIR = mkdtempSync(join(os.tmpdir(), 'ado-userconfig-'));

const { loadUserConfig, saveUserConfig } = await import('../src/lib/userConfig.js');

const UID = 'test-user-1';

test('fresh config seeds the new preference keys', () => {
  const c = loadUserConfig(UID);
  assert.deepEqual(c.commentTemplates, []);
  assert.deepEqual(c.savedViews, []);
  assert.deepEqual(c.chatWebhooks, []);
  assert.deepEqual(c.mutedRepos, []);
  assert.equal(c.uiPrefs.density, 'comfortable');
  assert.equal(c.slaDays, 7);
  assert.equal(c.notificationPrefs.digest, 'off');
});

test('saves and normalizes comment templates (assigns ids)', () => {
  const saved = saveUserConfig(UID, {
    commentTemplates: [{ name: '  LGTM ', body: 'Looks good to me!' }],
  });
  assert.equal(saved.commentTemplates.length, 1);
  assert.equal(saved.commentTemplates[0].name, 'LGTM');
  assert.match(saved.commentTemplates[0].id, /^[a-z0-9]+$/);
});

test('rejects a template missing a body', () => {
  assert.throws(() => saveUserConfig(UID, { commentTemplates: [{ name: 'x' }] }), /body (is required|must be a string)/);
});

test('digest pref accepts enum values and rejects others', () => {
  const ok = saveUserConfig(UID, { notificationPrefs: { digest: 'weekly' } });
  assert.equal(ok.notificationPrefs.digest, 'weekly');
  assert.throws(() => saveUserConfig(UID, { notificationPrefs: { digest: 'hourly' } }), /digest must be one of/);
});

test('chat webhooks require an https url', () => {
  assert.throws(
    () => saveUserConfig(UID, { chatWebhooks: [{ type: 'slack', url: 'http://insecure' }] }),
    /must be an https url/i
  );
  const ok = saveUserConfig(UID, { chatWebhooks: [{ type: 'teams', url: 'https://outlook.office.com/hook/abc' }] });
  assert.equal(ok.chatWebhooks[0].type, 'teams');
  assert.match(ok.chatWebhooks[0].id, /^[a-z0-9]+$/);
});

test('slaDays is clamped to an integer range', () => {
  assert.throws(() => saveUserConfig(UID, { slaDays: 0 }), /between 1 and 90/);
  assert.throws(() => saveUserConfig(UID, { slaDays: 200 }), /between 1 and 90/);
  assert.equal(saveUserConfig(UID, { slaDays: 14 }).slaDays, 14);
});

test('uiPrefs density merges and validates', () => {
  const ok = saveUserConfig(UID, { uiPrefs: { density: 'compact' } });
  assert.equal(ok.uiPrefs.density, 'compact');
  assert.throws(() => saveUserConfig(UID, { uiPrefs: { density: 'tiny' } }), /density must be one of/);
});

test('uiPrefs.onboarded seeds false and coerces to boolean, preserving density', () => {
  const fresh = loadUserConfig('onboarding-user');
  assert.equal(fresh.uiPrefs.onboarded, false);
  const set = saveUserConfig('onboarding-user', { uiPrefs: { onboarded: 'yes' } });
  assert.equal(set.uiPrefs.onboarded, true); // coerced to boolean
  assert.equal(set.uiPrefs.density, 'comfortable'); // partial patch keeps density
});

test('saved views persist filters and sort as objects', () => {
  const ok = saveUserConfig(UID, {
    savedViews: [{ name: 'My open', variant: 'created', filters: { states: ['Open'] }, sort: { key: 'title', dir: 'asc' } }],
  });
  assert.equal(ok.savedViews[0].name, 'My open');
  assert.deepEqual(ok.savedViews[0].filters, { states: ['Open'] });
  assert.deepEqual(ok.savedViews[0].sort, { key: 'title', dir: 'asc' });
});

test('repoProjects seeds empty and records a repo → project mapping', () => {
  const c = loadUserConfig('proj-seed-user');
  assert.deepEqual(c.repoProjects, {});
  const ok = saveUserConfig('proj-seed-user', {
    repositories: ['MyRepo'],
    repoProjects: { MyRepo: { project: 'Some Project', projectId: 'abc-123' } },
  });
  // Keyed lowercase for case-insensitive lookup.
  assert.deepEqual(ok.repoProjects, { myrepo: { project: 'Some Project', projectId: 'abc-123' } });
});

test('repoProjects requires a project name and prunes entries for removed repos', () => {
  assert.throws(
    () => saveUserConfig(UID, { repoProjects: { X: { projectId: 'z' } } }),
    /project is required/
  );
  // Adding a repo+mapping then removing the repo drops the orphaned mapping.
  saveUserConfig('prune-user', { repositories: ['A', 'B'], repoProjects: { A: { project: 'PA' }, B: { project: 'PB' } } });
  const pruned = saveUserConfig('prune-user', { repositories: ['A'] });
  assert.deepEqual(Object.keys(pruned.repoProjects), ['a']);
});

test('pipelines persist an optional project and projectId', () => {
  const ok = saveUserConfig(UID, {
    pipelines: [{ definitionId: 42, name: 'CI', repo: 'R', project: 'ProjX', projectId: 'pid-9' }],
  });
  assert.equal(ok.pipelines[0].project, 'ProjX');
  assert.equal(ok.pipelines[0].projectId, 'pid-9');
});
