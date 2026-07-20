import { adoGet, adoSend, gitUrl, policyUrl, witUrl, projectForRepo } from '../lib/adoClient.js';

/**
 * Complete (merge) a pull request.
 * options: { mergeStrategy, deleteSourceBranch, bypassPolicy, bypassReason }
 */
export async function mergePr(repo, prId, options = {}) {
  const pr = await adoGet(gitUrl(repo, `pullRequests/${prId}`), { cache: false });
  if (pr.status !== 'active') {
    const e = new Error(`Pull request is ${pr.status}, cannot merge.`);
    e.status = 409;
    throw e;
  }
  const body = {
    status: 'completed',
    lastMergeSourceCommit: {
      commitId: pr.lastMergeSourceCommit?.commitId,
    },
    completionOptions: {
      mergeStrategy: options.mergeStrategy || 'squash',
      deleteSourceBranch: options.deleteSourceBranch ?? false,
      bypassPolicy: options.bypassPolicy ?? false,
      ...(options.bypassPolicy
        ? { bypassReason: options.bypassReason || 'Merged from dashboard' }
        : {}),
    },
  };
  return adoSend('PATCH', gitUrl(repo, `pullRequests/${prId}`), body);
}

/** Publish a draft pull request (clears the draft flag). */
export async function publishPr(repo, prId) {
  const pr = await adoGet(gitUrl(repo, `pullRequests/${prId}`), { cache: false });
  if (pr.status !== 'active') {
    const e = new Error(`Pull request is ${pr.status}, cannot publish.`);
    e.status = 409;
    throw e;
  }
  if (!pr.isDraft) {
    const e = new Error('Pull request is already published.');
    e.status = 409;
    throw e;
  }
  return adoSend('PATCH', gitUrl(repo, `pullRequests/${prId}`), { isDraft: false });
}

/**
 * Enable or cancel auto-complete on a pull request.
 *   enable=true  → set auto-complete (squash merge, delete source branch, and no
 *                  extra completion side-effects) as the given user.
 *   enable=false → cancel auto-complete (clear autoCompleteSetBy).
 * Azure DevOps enables auto-complete when `autoCompleteSetBy` is a real user id
 * and cancels it when that id is the empty GUID.
 */
const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';

export async function setAutoComplete(repo, prId, userId, enable) {
  const pr = await adoGet(gitUrl(repo, `pullRequests/${prId}`), { cache: false });
  if (pr.status !== 'active') {
    const e = new Error(`Pull request is ${pr.status}, cannot change auto-complete.`);
    e.status = 409;
    throw e;
  }
  if (enable && pr.isDraft) {
    const e = new Error('Publish the draft before enabling auto-complete.');
    e.status = 409;
    throw e;
  }
  const body = enable
    ? {
        autoCompleteSetBy: { id: userId },
        completionOptions: {
          mergeStrategy: 'squash',
          deleteSourceBranch: true,
          // No additional required checks / side-effects.
          transitionWorkItems: false,
          bypassPolicy: false,
        },
      }
    : { autoCompleteSetBy: { id: EMPTY_GUID } };
  return adoSend('PATCH', gitUrl(repo, `pullRequests/${prId}`), body);
}

/** Re-queue a build policy evaluation (re-trigger pipeline). */
export async function requeuePipeline(repo, prId, evaluationId) {
  const { project } = projectForRepo(repo);
  // Guard: never re-trigger a gate that is already running/queued. Expired gates
  // report a queued status but must stay re-runnable, so allow those through.
  const ev = await adoGet(policyUrl(`evaluations/${evaluationId}`, project), {
    query: { 'api-version': '7.1-preview.1' },
    cache: false,
  }).catch(() => null);
  if (ev && !ev.context?.isExpired && (ev.status === 'running' || ev.status === 'queued')) {
    const e = new Error('This gate is already running — re-trigger is not allowed until it completes.');
    e.status = 409;
    throw e;
  }
  return adoSend(
    'PATCH',
    policyUrl(`evaluations/${evaluationId}`, project),
    undefined,
    { query: { 'api-version': '7.1-preview.1' } }
  );
}

/** Set the current user's vote on a PR (approve / reject / wait). */
export async function setVote(repo, prId, reviewerId, vote) {
  return adoSend(
    'PUT',
    gitUrl(repo, `pullRequests/${prId}/reviewers/${reviewerId}`),
    { vote }
  );
}

// ---- reviewer management ----

/** Add a reviewer (optional-required) to a PR. */
export async function addReviewer(repo, prId, reviewerId, isRequired = false) {
  if (!reviewerId) {
    const e = new Error('reviewerId is required'); e.status = 400; throw e;
  }
  return adoSend(
    'PUT',
    gitUrl(repo, `pullRequests/${prId}/reviewers/${reviewerId}`),
    { vote: 0, isRequired: !!isRequired }
  );
}

/** Remove a reviewer from a PR. */
export async function removeReviewer(repo, prId, reviewerId) {
  if (!reviewerId) {
    const e = new Error('reviewerId is required'); e.status = 400; throw e;
  }
  return adoSend('DELETE', gitUrl(repo, `pullRequests/${prId}/reviewers/${reviewerId}`));
}

/** Toggle a reviewer's "required" flag, preserving their current vote. */
export async function setReviewerRequired(repo, prId, reviewerId, isRequired) {
  const cur = await adoGet(gitUrl(repo, `pullRequests/${prId}/reviewers/${reviewerId}`), { cache: false }).catch(() => null);
  const vote = cur ? Number(cur.vote) || 0 : 0;
  return adoSend(
    'PUT',
    gitUrl(repo, `pullRequests/${prId}/reviewers/${reviewerId}`),
    { vote, isRequired: !!isRequired }
  );
}

// ---- lifecycle (abandon / reactivate / draft) ----

async function patchStatus(repo, prId, body, guard) {
  const pr = await adoGet(gitUrl(repo, `pullRequests/${prId}`), { cache: false });
  guard(pr);
  return adoSend('PATCH', gitUrl(repo, `pullRequests/${prId}`), body);
}

/** Abandon (close) an active pull request. */
export async function abandonPr(repo, prId) {
  return patchStatus(repo, prId, { status: 'abandoned' }, (pr) => {
    if (pr.status !== 'active') {
      const e = new Error(`Pull request is ${pr.status}; only active PRs can be abandoned.`); e.status = 409; throw e;
    }
  });
}

/** Reactivate a previously abandoned pull request. */
export async function reactivatePr(repo, prId) {
  return patchStatus(repo, prId, { status: 'active' }, (pr) => {
    if (pr.status !== 'abandoned') {
      const e = new Error(`Pull request is ${pr.status}; only abandoned PRs can be reactivated.`); e.status = 409; throw e;
    }
  });
}

/** Convert an active published PR back to a draft. */
export async function setDraft(repo, prId, isDraft) {
  return patchStatus(repo, prId, { isDraft: !!isDraft }, (pr) => {
    if (pr.status !== 'active') {
      const e = new Error(`Pull request is ${pr.status}; cannot change draft state.`); e.status = 409; throw e;
    }
    if (!!isDraft === !!pr.isDraft) {
      const e = new Error(`Pull request is already ${pr.isDraft ? 'a draft' : 'published'}.`); e.status = 409; throw e;
    }
  });
}

/** Best-effort capability hints (the API still enforces real permissions). */
export function capabilities(pr) {
  return {
    canMerge: pr.status === 'active' && !pr.isDraft,
    canRequeue: true,
    canVote: true,
  };
}

// ---- comments / discussion threads ----

const THREAD_STATUSES = new Set(['active', 'fixed', 'wontFix', 'closed', 'byDesign', 'pending']);

function requireContent(content) {
  const text = String(content || '').trim();
  if (!text) {
    const e = new Error('Comment content is required.');
    e.status = 400;
    throw e;
  }
  return text;
}

/** Reply to (or add a comment on) an existing discussion thread. */
export async function addThreadComment(repo, prId, threadId, content, parentCommentId) {
  const text = requireContent(content);
  const body = {
    content: text,
    commentType: 'text',
    ...(parentCommentId ? { parentCommentId: Number(parentCommentId) } : {}),
  };
  return adoSend('POST', gitUrl(repo, `pullRequests/${prId}/threads/${threadId}/comments`), body, {
    query: { 'api-version': '7.1' },
  });
}

/** Set a thread's status (resolve / reactivate). */
export async function setThreadStatus(repo, prId, threadId, status) {
  if (!THREAD_STATUSES.has(status)) {
    const e = new Error(`Invalid thread status "${status}".`);
    e.status = 400;
    throw e;
  }
  return adoSend('PATCH', gitUrl(repo, `pullRequests/${prId}/threads/${threadId}`), { status }, {
    query: { 'api-version': '7.1' },
  });
}

/** Start a new top-level discussion thread on the PR (a general comment). */
export async function createThread(repo, prId, content) {
  const text = requireContent(content);
  return adoSend('POST', gitUrl(repo, `pullRequests/${prId}/threads`), {
    comments: [{ content: text, commentType: 'text' }],
    status: 'active',
  }, { query: { 'api-version': '7.1' } });
}

/**
 * Start a discussion thread anchored to a file + line in the PR diff (A1/A3).
 * `line` is a 1-based line number on the right (target) side of the diff.
 */
export async function createInlineThread(repo, prId, { filePath, line, content }) {
  const text = requireContent(content);
  if (!filePath) { const e = new Error('filePath is required'); e.status = 400; throw e; }
  const ln = Number(line);
  if (!Number.isInteger(ln) || ln < 1) { const e = new Error('line must be a positive integer'); e.status = 400; throw e; }
  const path = filePath.startsWith('/') ? filePath : `/${filePath}`;
  return adoSend('POST', gitUrl(repo, `pullRequests/${prId}/threads`), {
    comments: [{ content: text, commentType: 'text' }],
    status: 'active',
    threadContext: {
      filePath: path,
      rightFileStart: { line: ln, offset: 1 },
      rightFileEnd: { line: ln, offset: 1 },
    },
  }, { query: { 'api-version': '7.1' } });
}
// ---- create PR (F1) ----

/**
 * Open a new pull request. Branches are plain names (no refs/heads/ prefix).
 * reviewerIds are ADO identity GUIDs (optional). Returns the created PR.
 */
export async function createPr(repo, { sourceBranch, targetBranch, title, description, isDraft, reviewerIds } = {}) {
  const src = String(sourceBranch || '').replace(/^refs\/heads\//, '').trim();
  const tgt = String(targetBranch || '').replace(/^refs\/heads\//, '').trim();
  const ttl = String(title || '').trim();
  if (!src || !tgt) { const e = new Error('Source and target branches are required.'); e.status = 400; throw e; }
  if (src === tgt) { const e = new Error('Source and target branches must differ.'); e.status = 400; throw e; }
  if (!ttl) { const e = new Error('A title is required.'); e.status = 400; throw e; }
  const body = {
    sourceRefName: `refs/heads/${src}`,
    targetRefName: `refs/heads/${tgt}`,
    title: ttl,
    description: String(description || ''),
    isDraft: !!isDraft,
    reviewers: (reviewerIds || []).filter(Boolean).map((id) => ({ id })),
  };
  return adoSend('POST', gitUrl(repo, 'pullrequests'), body, { query: { 'api-version': '7.1' } });
}

// ---- work item linking (F3) ----

/** The vstfs artifact URI for a PR (used as a work-item ArtifactLink target). */
function prArtifactUri(projectId, repoId, prId) {
  return `vstfs:///Git/PullRequestId/${projectId}%2F${repoId}%2F${prId}`;
}

async function repoId(repo) {
  const r = await adoGet(gitUrl(repo), { query: { 'api-version': '7.1' } });
  return r.id;
}

/** Link an existing work item to a PR via an ArtifactLink relation. */
export async function linkWorkItem(repo, prId, workItemId) {
  const id = Number(workItemId);
  if (!Number.isInteger(id) || id <= 0) { const e = new Error('A valid work item id is required.'); e.status = 400; throw e; }
  const { project, projectId } = projectForRepo(repo);
  const rid = await repoId(repo);
  const uri = prArtifactUri(projectId, rid, prId);
  const patch = [{
    op: 'add',
    path: '/relations/-',
    value: { rel: 'ArtifactLink', url: uri, attributes: { name: 'Pull Request' } },
  }];
  return adoSend('PATCH', witUrl(`workitems/${id}`, project), patch, { query: { 'api-version': '7.1' }, contentType: 'application/json-patch+json' });
}

/** Remove the ArtifactLink relation from a work item that points at this PR. */
export async function unlinkWorkItem(repo, prId, workItemId) {
  const id = Number(workItemId);
  if (!Number.isInteger(id) || id <= 0) { const e = new Error('A valid work item id is required.'); e.status = 400; throw e; }
  const { project, projectId } = projectForRepo(repo);
  const rid = await repoId(repo);
  const uri = prArtifactUri(projectId, rid, prId).toLowerCase();
  const wi = await adoGet(witUrl(`workitems/${id}`, project), { query: { '$expand': 'relations', 'api-version': '7.1' }, cache: false });
  const rels = wi.relations || [];
  const idx = rels.findIndex((r) => r.rel === 'ArtifactLink' && String(r.url || '').toLowerCase() === uri);
  if (idx === -1) { const e = new Error('That work item is not linked to this PR.'); e.status = 404; throw e; }
  // Guard the index-based removal against a concurrent edit: the `test` op makes
  // ADO reject the PATCH (409) if the work item's revision changed since we read it.
  const patch = [
    { op: 'test', path: '/rev', value: wi.rev },
    { op: 'remove', path: `/relations/${idx}` },
  ];
  return adoSend('PATCH', witUrl(`workitems/${id}`, project), patch, { query: { 'api-version': '7.1' }, contentType: 'application/json-patch+json' });
}
