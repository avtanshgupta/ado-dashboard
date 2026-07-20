import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prState, reviewStatus, mergeability, pipelineStatus, proofOfPresence } from '../src/lib/mappers.js';

const buildEval = (over = {}) => ({
  configuration: { type: { displayName: 'Build' }, isEnabled: true, isBlocking: true, settings: { displayName: 'CI Gate' } },
  status: 'approved',
  context: {},
  ...over,
});

test('prState maps status + draft flag', () => {
  assert.equal(prState({ status: 'completed' }), 'Merged');
  assert.equal(prState({ status: 'abandoned' }), 'Closed');
  assert.equal(prState({ status: 'active', isDraft: true }), 'Draft');
  assert.equal(prState({ status: 'active' }), 'Open');
});

test('reviewStatus: no reviewers is Not Approved', () => {
  const r = reviewStatus({ reviewers: [], createdBy: { id: 'me' } });
  assert.equal(r.status, 'Not Approved');
  assert.equal(r.approvals, 0);
});

test('reviewStatus: an approval with no policy is Approved', () => {
  const r = reviewStatus({ createdBy: { id: 'me' }, reviewers: [{ id: 'a', vote: 10 }] });
  assert.equal(r.status, 'Approved');
  assert.equal(r.approvals, 1);
});

test('reviewStatus: a rejection wins over approvals', () => {
  const r = reviewStatus({ createdBy: { id: 'me' }, reviewers: [{ id: 'a', vote: 10 }, { id: 'b', vote: -10 }] });
  assert.equal(r.status, 'Changes Requested');
  assert.equal(r.rejections, 1);
});

test('reviewStatus: waiting for author', () => {
  const r = reviewStatus({ createdBy: { id: 'me' }, reviewers: [{ id: 'a', vote: -5 }] });
  assert.equal(r.status, 'Waiting for Author');
});

test('reviewStatus: policy requiring 2 approvers, only 1 given → Partially Approved', () => {
  const evals = [{
    configuration: { type: { displayName: 'Minimum number of reviewers' }, isEnabled: true, isBlocking: true, settings: { minimumApproverCount: 2 } },
    status: 'rejected',
  }];
  const r = reviewStatus({ createdBy: { id: 'me' }, reviewers: [{ id: 'a', vote: 10 }] }, evals);
  assert.equal(r.status, 'Partially Approved');
  assert.equal(r.required, 2);
});

test('mergeability: active + no blockers + no conflict → canMerge', () => {
  const m = mergeability([buildEval()], { status: 'active', isDraft: false, mergeStatus: 'succeeded' });
  assert.equal(m.canMerge, true);
  assert.equal(m.blockers.length, 0);
});

test('mergeability: a non-approved blocking policy blocks merge', () => {
  const m = mergeability([buildEval({ status: 'rejected' })], { status: 'active', isDraft: false, mergeStatus: 'succeeded' });
  assert.equal(m.canMerge, false);
  assert.equal(m.blockers.length, 1);
});

test('mergeability: draft is never mergeable', () => {
  const m = mergeability([buildEval()], { status: 'active', isDraft: true, mergeStatus: 'succeeded' });
  assert.equal(m.canMerge, false);
});

test('pipelineStatus: all mandatory builds approved → Succeeded', () => {
  const p = pipelineStatus([buildEval(), buildEval()]);
  assert.equal(p.overall, 'Succeeded');
  assert.equal(p.mandatoryOnly, true);
});

test('pipelineStatus: a rejected build → Failed', () => {
  const p = pipelineStatus([buildEval({ status: 'rejected' })]);
  assert.equal(p.overall, 'Failed');
});

test('pipelineStatus: an expired build → Expired', () => {
  const p = pipelineStatus([buildEval({ context: { isExpired: true } })]);
  assert.equal(p.overall, 'Expired');
});

test('pipelineStatus: no build policies → None', () => {
  assert.equal(pipelineStatus([]).overall, 'None');
});

test('proofOfPresence maps approval to a signed-off label', () => {
  const pop = proofOfPresence([{ configuration: { type: { displayName: 'Proof Of Presence' } }, status: 'approved' }]);
  assert.equal(pop.ok, true);
  assert.equal(pop.label, 'Signed off');
  assert.equal(proofOfPresence([]), null);
});
