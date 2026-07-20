import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shapeIdentity,
  parseTags,
  shortPath,
  parsePullRequestArtifact,
  shapeRelations,
  shapeSummary,
  shapeDetail,
  shapeComment,
} from '../src/lib/workItemShape.js';

test('shapeIdentity: object → compact identity with avatar', () => {
  const id = shapeIdentity({ displayName: 'Ann Lee', uniqueName: 'ann@x.com', _links: { avatar: { href: 'http://a/img' } } });
  assert.deepEqual(id, { displayName: 'Ann Lee', uniqueName: 'ann@x.com', imageUrl: 'http://a/img' });
});

test('shapeIdentity: string and null', () => {
  assert.deepEqual(shapeIdentity('svc'), { displayName: 'svc', uniqueName: 'svc', imageUrl: null });
  assert.equal(shapeIdentity(null), null);
});

test('parseTags: splits, trims, drops empties', () => {
  assert.deepEqual(parseTags('Regression; Security ; '), ['Regression', 'Security']);
  assert.deepEqual(parseTags(''), []);
});

test('shortPath: tail segment of a tree path', () => {
  assert.equal(shortPath('WD\\Team\\Linux\\Core'), 'Core');
  assert.equal(shortPath('WD/Team/Mac'), 'Mac');
  assert.equal(shortPath(''), '');
});

test('parsePullRequestArtifact: parses project/repo/prId', () => {
  const url = 'vstfs:///Git/PullRequestId/2c8b%2Frepo-guid%2F12345';
  assert.deepEqual(parsePullRequestArtifact(url), { projectId: '2c8b', repoId: 'repo-guid', prId: 12345 });
});

test('parsePullRequestArtifact: rejects non-PR artifacts', () => {
  assert.equal(parsePullRequestArtifact('vstfs:///Build/Build/99'), null);
  assert.equal(parsePullRequestArtifact(null), null);
});

test('shapeRelations: buckets parent/children/related and PR links', () => {
  const rels = shapeRelations([
    { rel: 'System.LinkTypes.Hierarchy-Reverse', url: 'https://x/_apis/wit/workItems/10' },
    { rel: 'System.LinkTypes.Hierarchy-Forward', url: 'https://x/_apis/wit/workItems/20' },
    { rel: 'System.LinkTypes.Hierarchy-Forward', url: 'https://x/_apis/wit/workItems/21' },
    { rel: 'System.LinkTypes.Related', url: 'https://x/_apis/wit/workItems/30' },
    { rel: 'ArtifactLink', url: 'vstfs:///Git/PullRequestId/p%2Fr%2F777', attributes: { name: 'Pull Request' } },
    { rel: 'Hyperlink', url: 'https://docs', attributes: { comment: 'spec' } },
    { rel: 'AttachedFile', url: 'https://x/att', attributes: { name: 'log.txt', resourceSize: 12 } },
  ]);
  assert.equal(rels.parent, 10);
  assert.deepEqual(rels.children, [20, 21]);
  assert.deepEqual(rels.related, [30]);
  assert.deepEqual(rels.pullRequests, [{ projectId: 'p', repoId: 'r', prId: 777 }]);
  assert.equal(rels.hyperlinks.length, 1);
  assert.equal(rels.attachments[0].name, 'log.txt');
});

const RAW = {
  id: 42,
  rev: 7,
  url: 'https://ado/_apis/wit/workItems/42',
  fields: {
    'System.WorkItemType': 'Bug',
    'System.Title': 'Crash on start',
    'System.State': 'Active',
    'System.Reason': 'New',
    'System.TeamProject': 'Windows Defender',
    'System.AssignedTo': { displayName: 'Ann', uniqueName: 'ann@x.com' },
    'System.CreatedBy': { displayName: 'Bob', uniqueName: 'bob@x.com' },
    'System.CreatedDate': new Date(Date.now() - 5 * 86400000).toISOString(),
    'System.ChangedDate': new Date(Date.now() - 2 * 86400000).toISOString(),
    'System.AreaPath': 'WD\\Linux\\Core',
    'System.IterationPath': 'WD\\Sprint 3',
    'System.Tags': 'Regression; Security',
    'Microsoft.VSTS.Common.Priority': 1,
    'Microsoft.VSTS.Common.Severity': '2 - High',
    'Microsoft.VSTS.Scheduling.StoryPoints': 5,
    'System.Description': '<div>boom</div>',
    'Microsoft.VSTS.TCM.ReproSteps': '<ol><li>run</li></ol>',
  },
  relations: [
    { rel: 'System.LinkTypes.Hierarchy-Reverse', url: 'https://x/_apis/wit/workItems/1' },
    { rel: 'ArtifactLink', url: 'vstfs:///Git/PullRequestId/pid%2Frid%2F900', attributes: { name: 'Pull Request' } },
  ],
};

test('shapeSummary: maps fields, derives ages, builds url', () => {
  const s = shapeSummary(RAW, { webUrl: (proj, id) => `web/${proj}/${id}` });
  assert.equal(s.id, 42);
  assert.equal(s.type, 'Bug');
  assert.equal(s.title, 'Crash on start');
  assert.equal(s.state, 'Active');
  assert.equal(s.project, 'Windows Defender');
  assert.equal(s.url, 'web/Windows Defender/42');
  assert.equal(s.assignedTo.displayName, 'Ann');
  assert.deepEqual(s.tags, ['Regression', 'Security']);
  assert.equal(s.priority, 1);
  assert.equal(s.storyPoints, 5);
  assert.equal(s.parentId, 1);
  assert.equal(s.ageDays, 5);
  assert.equal(s.idleDays, 2);
});

test('shapeDetail: adds rev, html bodies, resolved PR links', () => {
  const d = shapeDetail(RAW, {
    webUrl: (proj, id) => `web/${id}`,
    resolvePr: (pr) => ({ ...pr, repo: 'WD.Client.Linux', url: `pr/${pr.prId}` }),
  });
  assert.equal(d.rev, 7);
  assert.equal(d.description, '<div>boom</div>');
  assert.equal(d.reproSteps, '<ol><li>run</li></ol>');
  assert.equal(d.relations.pullRequests[0].prId, 900);
  assert.equal(d.relations.pullRequests[0].url, 'pr/900');
  assert.equal(d.relations.parent, 1);
});

test('shapeComment: compact comment shape', () => {
  const c = shapeComment({ id: 3, text: 'hi', createdBy: 'Ann', createdDate: '2026-01-01T00:00:00Z' });
  assert.equal(c.id, 3);
  assert.equal(c.text, 'hi');
  assert.equal(c.createdBy.displayName, 'Ann');
});

test('shapeUpdate: extracts notable field changes (state/assignee)', async () => {
  const { shapeUpdate } = await import('../src/lib/workItemShape.js');
  const u = shapeUpdate({
    id: 5, rev: 5, revisedDate: '2026-06-01T00:00:00Z', revisedBy: { displayName: 'Ann' },
    fields: {
      'System.State': { oldValue: 'New', newValue: 'Active' },
      'System.AssignedTo': { oldValue: null, newValue: { displayName: 'Bob' } },
      'System.ChangedDate': { oldValue: '...', newValue: '2026-06-01T00:00:00Z' },
    },
  });
  assert.equal(u.by.displayName, 'Ann');
  const state = u.changes.find((c) => c.field === 'State');
  assert.deepEqual(state, { field: 'State', from: 'New', to: 'Active' });
  const assignee = u.changes.find((c) => c.field === 'Assignee');
  assert.equal(assignee.to, 'Bob');
});

test('shapeUpdate: returns null for link-only / empty updates', async () => {
  const { shapeUpdate } = await import('../src/lib/workItemShape.js');
  assert.equal(shapeUpdate({ id: 1, rev: 1, fields: {} }), null);
  assert.equal(shapeUpdate({ id: 2, rev: 2, fields: { 'System.ChangedDate': { oldValue: 'a', newValue: 'b' } } }), null);
});

test('shapeUpdate: flags an added comment', async () => {
  const { shapeUpdate } = await import('../src/lib/workItemShape.js');
  const u = shapeUpdate({ id: 3, rev: 3, revisedDate: '2026-06-02T00:00:00Z', fields: { 'System.History': { newValue: 'looks good' } } });
  assert.equal(u.commentAdded, true);
});

test('shapeHistory: drops empties and sorts newest-first', async () => {
  const { shapeHistory } = await import('../src/lib/workItemShape.js');
  const h = shapeHistory([
    { id: 1, rev: 1, revisedDate: '2026-06-01T00:00:00Z', fields: { 'System.State': { oldValue: 'New', newValue: 'Active' } } },
    { id: 2, rev: 2, fields: {} },
    { id: 3, rev: 3, revisedDate: '2026-06-03T00:00:00Z', fields: { 'System.State': { oldValue: 'Active', newValue: 'Closed' } } },
  ]);
  assert.equal(h.length, 2);
  assert.equal(h[0].rev, 3); // newest first
});
