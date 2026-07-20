import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWiql, escapeWiql, chunkIds, LIST_FIELDS } from '../src/lib/workItemQuery.js';

test('buildWiql: assigned-to-me excludes Removed and orders by ChangedDate desc', () => {
  const q = buildWiql({ project: 'Windows Defender', assignedToMe: true });
  assert.match(q, /\[System\.TeamProject\] = 'Windows Defender'/);
  assert.match(q, /\[System\.AssignedTo\] = @Me/);
  assert.match(q, /\[System\.State\] <> 'Removed'/);
  assert.match(q, /ORDER BY \[System\.ChangedDate\] DESC$/);
});

test('buildWiql: created-by-me', () => {
  const q = buildWiql({ project: 'P', createdByMe: true });
  assert.match(q, /\[System\.CreatedBy\] = @Me/);
});

test('buildWiql: team members become an IN clause', () => {
  const q = buildWiql({ project: 'P', assignedTo: ['a@x.com', 'b@x.com'] });
  assert.match(q, /\[System\.AssignedTo\] IN \('a@x\.com', 'b@x\.com'\)/);
});

test('buildWiql: types + states filters', () => {
  const q = buildWiql({ project: 'P', types: ['Bug', 'Task'], states: ['Active'] });
  assert.match(q, /\[System\.WorkItemType\] IN \('Bug', 'Task'\)/);
  assert.match(q, /\[System\.State\] IN \('Active'\)/);
});

test('buildWiql: area paths OR-combined with UNDER', () => {
  const q = buildWiql({ project: 'P', areaPaths: ['P\\Team\\A', 'P\\Team\\B'] });
  assert.match(q, /\(\[System\.AreaPath\] UNDER 'P\\Team\\A' OR \[System\.AreaPath\] UNDER 'P\\Team\\B'\)/);
});

test('buildWiql: single area path is not wrapped in parens', () => {
  const q = buildWiql({ project: 'P', areaPaths: ['P\\Team\\A'] });
  assert.match(q, /\[System\.AreaPath\] UNDER 'P\\Team\\A'/);
  assert.doesNotMatch(q, /\(\[System\.AreaPath\]/);
});

test('buildWiql: iterationUnder + changedSinceDays + tags + mentionsMe', () => {
  const q = buildWiql({
    project: 'P',
    iterationUnder: 'P\\Sprint 1',
    changedSinceDays: 30,
    tags: ['Regression'],
    mentionsMe: true,
  });
  assert.match(q, /\[System\.IterationPath\] UNDER 'P\\Sprint 1'/);
  assert.match(q, /\[System\.ChangedDate\] >= @Today - 30/);
  assert.match(q, /\[System\.Tags\] CONTAINS 'Regression'/);
  assert.match(q, /\[System\.History\] CONTAINS @Me/);
});

test('buildWiql: excludeStates can be overridden to none', () => {
  const q = buildWiql({ project: 'P', excludeStates: [] });
  assert.doesNotMatch(q, /<> 'Removed'/);
});

test('buildWiql: custom order asc', () => {
  const q = buildWiql({ project: 'P', orderBy: { field: 'System.CreatedDate', dir: 'ASC' } });
  assert.match(q, /ORDER BY \[System\.CreatedDate\] ASC$/);
});

test('escapeWiql: doubles single quotes', () => {
  assert.equal(escapeWiql("O'Brien"), "O''Brien");
  assert.equal(escapeWiql(null), '');
});

test('buildWiql: injection attempt via project is neutralized', () => {
  const q = buildWiql({ project: "P' OR '1'='1" });
  assert.match(q, /\[System\.TeamProject\] = 'P'' OR ''1''=''1'/);
});

test('chunkIds: dedupes, filters invalid, chunks by size', () => {
  assert.deepEqual(chunkIds([1, 2, 2, 3, -1, 0, 'x']), [[1, 2, 3]]);
  assert.deepEqual(chunkIds([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunkIds([]), []);
});

test('LIST_FIELDS includes the core system fields', () => {
  for (const f of ['System.Id', 'System.Title', 'System.State', 'System.AssignedTo']) {
    assert.ok(LIST_FIELDS.includes(f), `${f} present`);
  }
});

test('iterationNodeToPath: strips leading slash and the Iteration segment', async () => {
  const { iterationNodeToPath } = await import('../src/lib/workItemQuery.js');
  assert.equal(iterationNodeToPath('\\WD\\Iteration\\Q3\\Sprint 1'), 'WD\\Q3\\Sprint 1');
  assert.equal(iterationNodeToPath('\\WD\\Iteration\\Sprint 1'), 'WD\\Sprint 1');
  assert.equal(iterationNodeToPath('WD\\Sprint 1'), 'WD\\Sprint 1');
  assert.equal(iterationNodeToPath(''), '');
});
