// Mapping helpers: Azure DevOps raw values -> dashboard-friendly summaries.

export const VOTE = {
  10: 'Approved',
  5: 'Approved with suggestions',
  0: 'No vote',
  '-5': 'Waiting for author',
  '-10': 'Rejected',
};

export function prState(pr) {
  // status: active | completed | abandoned ; isDraft flag
  if (pr.status === 'completed') return 'Merged';
  if (pr.status === 'abandoned') return 'Closed';
  if (pr.isDraft) return 'Draft';
  return 'Open';
}

function isGroup(reviewer) {
  // Container/group reviewers (e.g. "[TEAM FOUNDATION]\...") have isContainer true.
  return reviewer.isContainer === true;
}

/**
 * Derive an overall review status from the reviewer votes AND the branch
 * policies that say how many approvals are required.
 *
 * Approval ladder (the 3 states the UI cares about):
 *   - 'Approved'          → every required approval is present
 *   - 'Partially Approved'→ at least one approval, but not all that are required
 *   - 'Not Approved'      → no approvals yet
 * Plus two override states for explicit negative votes:
 *   - 'Changes Requested' → someone rejected (vote -10)
 *   - 'Waiting for Author'→ someone is waiting on the author (vote -5)
 *
 * `evaluations` (policy evaluations) is optional. When present we use the
 * "Minimum number of reviewers" / "Required reviewers" policies — including how
 * many approvers each needs and whether Azure DevOps currently considers them
 * satisfied — which is the only reliable way to know a PR needs e.g. 2 approvals
 * rather than 1. Without it we fall back to the reviewer votes alone.
 */
const APPROVAL_POLICY_TYPES = new Set(['Minimum number of reviewers', 'Required reviewers']);

export function reviewStatus(pr, evaluations) {
  const reviewers = (pr.reviewers || []).filter((r) => r.id !== pr.createdBy?.id);
  const votes = reviewers.map((r) => Number(r.vote));

  const approvals = votes.filter((v) => v > 0).length;
  const rejections = votes.filter((v) => v === -10).length;
  const waiting = votes.filter((v) => v === -5).length;

  // Blocking approval-gating policies that actually apply to this PR.
  const approvalPolicies = (evaluations || []).filter(
    (e) =>
      APPROVAL_POLICY_TYPES.has(e.configuration?.type?.displayName) &&
      e.configuration?.isEnabled !== false &&
      e.configuration?.isBlocking !== false &&
      e.status !== 'notApplicable'
  );
  const havePolicyInfo = approvalPolicies.length > 0;
  // Azure DevOps' own verdict: are all required approvals present?
  const allPoliciesApproved =
    havePolicyInfo && approvalPolicies.every((e) => e.status === 'approved');

  // Representative "approvals required" number (for display / tooltip).
  const policyCounts = approvalPolicies
    .map((e) => Number(e.configuration?.settings?.minimumApproverCount) || 0)
    .filter((n) => n > 0);
  const requiredReviewers = reviewers.filter((r) => r.isRequired).length;
  const required = policyCounts.length
    ? Math.max(...policyCounts)
    : requiredReviewers || 1;

  const requiredMet = havePolicyInfo ? allPoliciesApproved : approvals >= required;

  let status;
  if (rejections > 0) status = 'Changes Requested';
  else if (requiredMet && approvals > 0) status = 'Approved';
  else if (waiting > 0) status = 'Waiting for Author';
  else if (approvals > 0) status = 'Partially Approved';
  else status = 'Not Approved';

  return {
    status,
    approvals,
    rejections,
    waiting,
    required,
    requiredMet,
    reviewers: reviewers.map((r) => ({
      id: r.id,
      displayName: r.displayName,
      uniqueName: r.uniqueName,
      vote: Number(r.vote),
      voteLabel: VOTE[String(r.vote)] || 'No vote',
      isRequired: !!r.isRequired,
      isGroup: isGroup(r),
    })),
  };
}

/**
 * The current user's own review state on a PR, derived from their reviewer vote.
 * `reviewed` is true once they have cast any vote (approve / reject / waiting).
 */
export function myReview(pr, meId) {
  const mine = (pr.reviewers || []).find((r) => r.id === meId);
  const vote = mine ? Number(mine.vote) : 0;
  return {
    isReviewer: !!mine,
    vote,
    voteLabel: VOTE[String(vote)] || 'No vote',
    reviewed: vote !== 0,
  };
}

/** Classify a PR thread for comment counting. */
export function classifyThread(thread) {
  const comments = (thread.comments || []).filter((c) => !c.isDeleted);
  const textComments = comments.filter((c) => c.commentType !== 'system');
  return {
    id: thread.id,
    isSystem: textComments.length === 0,
    status: thread.status || null, // active|fixed|wontFix|closed|byDesign|pending|null
    isActive: thread.status === 'active',
    isResolved: ['fixed', 'closed', 'wontFix', 'byDesign'].includes(
      thread.status
    ),
    commentCount: textComments.length,
    participants: [
      ...new Set(
        comments
          .map((c) => c.author?.displayName)
          .filter(Boolean)
      ),
    ],
    comments: textComments.map((c) => ({
      author: c.author?.displayName,
      content: c.content || '', // raw markdown — rendered + sanitized client-side
      date: c.publishedDate,
    })),
    context: thread.threadContext
      ? {
          filePath: thread.threadContext.filePath,
          line: thread.threadContext.rightFileStart?.line || thread.threadContext.leftFileStart?.line,
        }
      : null,
    lastUpdated: thread.lastUpdatedDate || thread.publishedDate,
  };
}

/** Summarize threads into comment counts + participants. */
export function summarizeThreads(threads, _meId) {
  const classified = (threads || [])
    .map(classifyThread)
    .filter((t) => !t.isSystem);
  const active = classified.filter((t) => t.isActive);
  const resolved = classified.filter((t) => t.isResolved);
  const participants = new Set();
  for (const t of classified) t.participants.forEach((p) => participants.add(p));
  return {
    total: classified.length,
    active: active.length,
    resolved: resolved.length,
    pending: classified.length - active.length - resolved.length,
    participants: [...participants],
    threads: classified,
  };
}

const BUILD_POLICY = 'Build';

/**
 * Reduce policy evaluations into a pipeline status + per-build list.
 * Only the **mandatory (blocking) build policies** — the CI runs that actually
 * gate the PR (e.g. "CI Gate", "PR gate", "CI for Linux") — drive the overall
 * status and the pipelines list. Non-blocking checks (PoliCheck, optional
 * nightly, etc.) are excluded. If a repo has no blocking build policies we fall
 * back to all builds so the card isn't empty.
 */
export function pipelineStatus(evaluations) {
  const allBuilds = (evaluations || [])
    .filter(
      (e) =>
        e.configuration?.type?.displayName === BUILD_POLICY &&
        e.configuration?.isEnabled !== false
    )
    .map((e) => {
      const isExpired = !!e.context?.isExpired;
      return {
        evaluationId: e.evaluationId,
        name: e.configuration?.settings?.displayName || 'Build',
        status: e.status, // approved|running|queued|rejected|notApplicable|notSubmitted
        // An expired build ran against an old iteration and must be re-run, so it
        // is not a valid "queued/approved" — surface it as its own state.
        effectiveStatus: isExpired ? 'expired' : e.status,
        isExpired,
        isBlocking: !!e.configuration?.isBlocking,
        buildId: e.context?.buildId || null,
        buildDefinitionId: e.configuration?.settings?.buildDefinitionId || null,
      };
    });

  const mandatory = allBuilds.filter((b) => b.isBlocking);
  const mandatoryOnly = mandatory.length > 0;
  // List + overall consider mandatory builds; fall back to all if none gate the PR.
  const builds = mandatoryOnly ? mandatory : allBuilds;

  const statuses = builds.map((b) => b.effectiveStatus);
  let overall = 'None';
  if (statuses.includes('rejected')) overall = 'Failed';
  else if (statuses.includes('expired')) overall = 'Expired';
  else if (statuses.includes('running')) overall = 'Running';
  else if (statuses.includes('queued') || statuses.includes('notSubmitted'))
    overall = 'Queued';
  else if (builds.length > 0 && statuses.every((s) => s === 'approved'))
    overall = 'Succeeded';
  else if (builds.length > 0) overall = 'Pending';

  return { overall, builds, mandatoryOnly, total: allBuilds.length };
}

/** Extract the Proof Of Presence policy status, if present. */
export function proofOfPresence(evaluations) {
  const e = (evaluations || []).find(
    (x) => x.configuration?.type?.displayName === 'Proof Of Presence'
  );
  if (!e) return null;
  const labelMap = {
    approved: 'Signed off',
    rejected: 'Not signed off',
    queued: 'Pending',
    running: 'Pending',
    notApplicable: 'N/A',
  };
  return { status: e.status, label: labelMap[e.status] || e.status, ok: e.status === 'approved' };
}

/**
 * Determine whether a PR can be completed: it must be active, not a draft, have
 * no merge conflicts, and every blocking+enabled policy must be approved.
 */
export function mergeability(evaluations, pr) {
  const blocking = (evaluations || []).filter(
    (e) => e.configuration?.isBlocking && e.configuration?.isEnabled
  );
  const blockers = blocking
    .filter((e) => e.status !== 'approved')
    .map((e) => ({
      name: e.configuration?.settings?.displayName || e.configuration?.type?.displayName,
      type: e.configuration?.type?.displayName,
      status: e.context?.isExpired ? 'expired' : e.status,
    }));
  const policiesGreen = blockers.length === 0;
  const noConflicts = !pr.mergeStatus || pr.mergeStatus === 'succeeded';
  const canMerge =
    pr.status === 'active' && !pr.isDraft && noConflicts && policiesGreen;
  return {
    canMerge,
    policiesGreen,
    noConflicts,
    blockingTotal: blocking.length,
    blockingApproved: blocking.length - blockers.length,
    blockers,
  };
}

/** Web URL for a pull request. */
export function prWebUrl(orgUrl, project, repo, prId) {
  return `${orgUrl.replace(/\/$/, '')}/${encodeURIComponent(
    project
  )}/_git/${encodeURIComponent(repo)}/pullrequest/${prId}`;
}
