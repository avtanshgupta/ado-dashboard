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
  assert.deepEqual(c.mutedRepos, []);
  assert.equal(c.uiPrefs.density, 'comfortable');
  assert.equal(c.slaDays, 7);
  assert.equal(c.notificationPrefs.newComment, false);
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

test('notification prefs coerce to booleans and ignore unknown keys', () => {
  const ok = saveUserConfig(UID, { notificationPrefs: { newPr: 'yes', bogus: true } });
  assert.equal(ok.notificationPrefs.newPr, true);
  assert.equal('bogus' in ok.notificationPrefs, false);
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

test('projects seed from defaults, validate, dedupe, and default a url', () => {
  const fresh = loadUserConfig('proj-user');
  assert.ok(fresh.projects.length >= 1);
  assert.ok(fresh.projects.every((p) => p.name && p.url && p.org));
  const ok = saveUserConfig('proj-user', {
    projects: [
      { name: 'OS', id: 'os-id' },
      { name: ' OS ' },
      { name: 'AI Vuln Scanning', id: 'v-id', url: 'https://dev.azure.com/MSecProductSecurity/AI%20Vuln%20Scanning' },
    ],
  });
  assert.deepEqual(ok.projects.map((p) => p.name), ['OS', 'AI Vuln Scanning']); // deduped
  assert.match(ok.projects[0].url, /\/OS$/); // url defaulted from name
  assert.equal(ok.projects[0].org, 'https://microsoft.visualstudio.com'); // default org
  assert.equal(ok.projects[1].org, 'https://dev.azure.com/MSecProductSecurity'); // org parsed from url
  assert.throws(() => saveUserConfig('proj-user', { projects: [{ id: 'x' }] }), /name (is required|must be a string)/);
});

test('work item saved queries validate id and default name to id', () => {
  const ok = saveUserConfig('wi-user', {
    workItemSavedQueries: [{ id: 'guid-1', project: 'WD' }, { id: 'guid-2', name: 'My Bugs' }],
  });
  assert.equal(ok.workItemSavedQueries[0].id, 'guid-1');
  assert.equal(ok.workItemSavedQueries[0].name, 'guid-1'); // defaults to id
  assert.equal(ok.workItemSavedQueries[0].project, 'WD');
  assert.equal(ok.workItemSavedQueries[1].name, 'My Bugs');
  assert.throws(() => saveUserConfig('wi-user', { workItemSavedQueries: [{ name: 'no id' }] }), /id (is required|must be a string)/);
});

test('effectiveConfig scopes workItemProjects to the monitored projects (with org)', async () => {
  const { effectiveConfig } = await import('../src/lib/userConfig.js');
  saveUserConfig('wi-scope', {
    projects: [
      { name: 'Alpha', id: 'a1' },
      { name: 'Beta', id: 'b1', url: 'https://dev.azure.com/OtherOrg/Beta' },
    ],
  });
  const eff = effectiveConfig({ id: 'wi-scope', displayName: 'U' });
  assert.deepEqual(eff.workItemProjects.map((p) => p.name).sort(), ['Alpha', 'Beta']);
  assert.equal(eff.workItemProjects.find((p) => p.name === 'Alpha').id, 'a1');
  assert.ok(eff.projectSet.has('alpha'));
  // Org map routes each project to its organization.
  assert.equal(eff.projectOrgMap.get('alpha'), 'https://microsoft.visualstudio.com');
  assert.equal(eff.projectOrgMap.get('beta'), 'https://dev.azure.com/OtherOrg');
});
