import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionKey, matchSessionsToPrs, buildMachineTimeline } from '../src/lib/agentCorrelation.js';

test('sessionKey lowercases the repo, keeps the branch verbatim, and needs both', () => {
  assert.equal(sessionKey('RepoA', 'Feature/X'), 'repoa#Feature/X');
  assert.equal(sessionKey('', 'main'), null);
  assert.equal(sessionKey('repo', ''), null);
  assert.equal(sessionKey(null, null), null);
});

const pr = (over) => ({
  id: 1,
  repo: 'RepoA',
  sourceBranch: 'feature/x',
  title: 'Add thing',
  state: 'Active',
  category: 'created',
  reviewStatus: 'Waiting',
  pipeline: { overall: 'Succeeded' },
  createdBy: { displayName: 'Ada' },
  webUrl: 'https://ado/pr/1',
  ...over,
});

const group = (sessions) => ({ machineId: 'm', sessions });

test('matchSessionsToPrs matches live sessions to PRs by repo (case-insensitive) + branch', () => {
  const groups = [group([{ status: 'active', repo: 'repoa', branch: 'feature/x' }])];
  const { matches } = matchSessionsToPrs(groups, [pr()]);
  const m = matches['repoa#feature/x'];
  assert.ok(m, 'a match for the session key exists');
  assert.equal(m.count, 1);
  assert.equal(m.url, 'https://ado/pr/1');
  assert.equal(m.prs.length, 1);
  assert.deepEqual(m.prs[0], {
    id: 1,
    title: 'Add thing',
    category: 'created',
    state: 'Active',
    isDraft: false,
    reviewStatus: 'Waiting',
    pipeline: 'Succeeded',
    author: 'Ada',
    webUrl: 'https://ado/pr/1',
  });
});

test('matchSessionsToPrs ignores ended sessions and unmatched branches', () => {
  const groups = [
    group([
      { status: 'ended', repo: 'repoa', branch: 'feature/x' }, // ended → not wanted
      { status: 'active', repo: 'repob', branch: 'main' },
    ]),
  ];
  const prs = [pr(), pr({ id: 2, repo: 'repob', sourceBranch: 'other' })];
  const { matches } = matchSessionsToPrs(groups, prs);
  assert.deepEqual(Object.keys(matches), []); // repoa is ended; repob#main has no PR
});

test('matchSessionsToPrs dedupes multiple PRs on one branch, newest id first', () => {
  const groups = [group([{ status: 'idle', repo: 'repoa', branch: 'feature/x' }])];
  const prs = [
    pr({ id: 5, webUrl: 'https://ado/pr/5' }),
    pr({ id: 9, webUrl: 'https://ado/pr/9' }),
  ];
  const { matches } = matchSessionsToPrs(groups, prs);
  const m = matches['repoa#feature/x'];
  assert.equal(m.count, 2);
  assert.deepEqual(m.prs.map((p) => p.id), [9, 5]); // newest first
  assert.equal(m.url, 'https://ado/pr/9'); // url points at the first listed PR
});

test('matchSessionsToPrs returns an empty map when there are no live keyed sessions', () => {
  assert.deepEqual(matchSessionsToPrs([], [pr()]).matches, {});
  assert.deepEqual(matchSessionsToPrs([group([{ status: 'active', repo: 'r' }])], [pr()]).matches, {});
  assert.deepEqual(matchSessionsToPrs(undefined, undefined).matches, {});
});

test('buildMachineTimeline flattens session history newest-first with session labels', () => {
  const g = group([
    {
      sessionId: 's1',
      repo: 'repoa',
      branch: 'main',
      history: [
        { t: '2024-01-01T10:00:00Z', status: 'active' },
        { t: '2024-01-01T10:05:00Z', status: 'idle' },
      ],
    },
    {
      sessionId: 's2',
      repo: 'repob',
      branch: 'dev',
      history: [{ t: '2024-01-01T10:03:00Z', status: 'active' }],
    },
  ]);
  const tl = buildMachineTimeline(g);
  assert.deepEqual(
    tl.map((e) => [e.t, e.sessionId, e.status]),
    [
      ['2024-01-01T10:05:00Z', 's1', 'idle'],
      ['2024-01-01T10:03:00Z', 's2', 'active'],
      ['2024-01-01T10:00:00Z', 's1', 'active'],
    ]
  );
  assert.equal(tl[0].repo, 'repoa');
  assert.equal('ts' in tl[0], false); // internal sort key stripped
});

test('buildMachineTimeline drops unparseable timestamps and honors the cap', () => {
  const g = group([
    {
      sessionId: 's1',
      history: [
        { t: 'not-a-date', status: 'active' },
        { t: '2024-01-01T10:00:00Z', status: 'active' },
        { t: '2024-01-01T10:01:00Z', status: 'idle' },
      ],
    },
  ]);
  assert.equal(buildMachineTimeline(g).length, 2); // bad timestamp dropped
  assert.equal(buildMachineTimeline(g, { limit: 1 }).length, 1);
});

test('buildMachineTimeline falls back to the short id when sessionId is absent', () => {
  const g = group([{ id: 'sess-abcdef12', history: [{ t: '2024-01-01T00:00:00Z', status: 'active' }] }]);
  assert.equal(buildMachineTimeline(g)[0].sessionId, 'sess-abc');
});

test('buildMachineTimeline tolerates empty / missing input', () => {
  assert.deepEqual(buildMachineTimeline(undefined), []);
  assert.deepEqual(buildMachineTimeline({ sessions: [] }), []);
  assert.deepEqual(buildMachineTimeline({ sessions: [{ history: [] }] }), []);
});
