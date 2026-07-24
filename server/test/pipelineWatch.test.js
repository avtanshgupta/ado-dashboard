import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPipelineAlerts } from '../src/lib/pipelineWatch.js';

const def = (id, runId, result) => ({
  definitionId: id,
  name: `P${id}`,
  webUrl: `https://ado/def/${id}`,
  lastRun: runId == null ? null : { id: runId, result, webUrl: `https://ado/run/${runId}` },
});

test('first observation only baselines a watched pipeline (no alert)', () => {
  const { alerts, snapshot } = detectPipelineAlerts({}, [def(1, 100, 'failed')], [1]);
  assert.deepEqual(alerts, []);
  assert.deepEqual(snapshot, { 1: { runId: 100, result: 'failed' } });
});

test('emits an alert on a new failed run for a watched pipeline', () => {
  const prev = { 1: { runId: 100, result: 'succeeded' } };
  const { alerts, snapshot } = detectPipelineAlerts(prev, [def(1, 101, 'failed')], [1]);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].definitionId, 1);
  assert.equal(alerts[0].runId, 101);
  assert.equal(alerts[0].webUrl, 'https://ado/run/101');
  assert.deepEqual(snapshot[1], { runId: 101, result: 'failed' });
});

test('does not alert when the same run is still the latest', () => {
  const prev = { 1: { runId: 101, result: 'failed' } };
  const { alerts } = detectPipelineAlerts(prev, [def(1, 101, 'failed')], [1]);
  assert.deepEqual(alerts, []);
});

test('does not alert on a new successful run', () => {
  const prev = { 1: { runId: 100, result: 'failed' } };
  const { alerts } = detectPipelineAlerts(prev, [def(1, 101, 'succeeded')], [1]);
  assert.deepEqual(alerts, []);
});

test('ignores pipelines that are not watched', () => {
  const prev = { 2: { runId: 200, result: 'succeeded' } };
  const { alerts, snapshot } = detectPipelineAlerts(prev, [def(2, 201, 'failed')], [1]);
  assert.deepEqual(alerts, []);
  assert.deepEqual(snapshot, {}); // unwatched pipelines aren't tracked
});

test('treats canceled runs as failures and accepts a Set of watched ids', () => {
  const prev = { 3: { runId: 300, result: 'succeeded' } };
  const { alerts } = detectPipelineAlerts(prev, [def(3, 301, 'canceled')], new Set([3]));
  assert.equal(alerts.length, 1);
});

test('skips definitions with no last run', () => {
  const { alerts, snapshot } = detectPipelineAlerts({}, [def(1, null)], [1]);
  assert.deepEqual(alerts, []);
  assert.deepEqual(snapshot, {});
});
