// Pure PR prioritization + aging logic for the Action Center.
// No I/O — takes already-enriched PR shapes (from prService) and classifies each
// into an actionable bucket with a priority score and a human reason. Kept pure
// so the ranking is deterministic and unit-testable.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days between an ISO timestamp and `now` (>=0), or null if unparseable. */
export function daysSince(iso, now = Date.now()) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY_MS));
}

/** Days since the PR last saw activity (falls back to creation). */
export function idleDays(pr, now = Date.now()) {
  return daysSince(pr.lastActivity || pr.creationDate, now);
}

/** Days since the PR was created. */
export function ageDays(pr, now = Date.now()) {
  return daysSince(pr.creationDate, now);
}

function waitingReason(pr) {
  const p = pr.pipeline?.overall;
  if (p === 'Running' || p === 'Queued') return 'CI in progress';
  if (pr.reviewStatus === 'Waiting for Author') return 'A reviewer is waiting on you';
  return 'Waiting on reviewers';
}

/**
 * Classify one of MY authored PRs into an action bucket, or null when no action
 * is needed (merged/closed). Priority bases are fixed for determinism; recency
 * is applied as a secondary sort key in buildActionCenter().
 *
 * fix (changes requested) 95 > fix (CI failed) 92 > fix (conflict) 88 >
 * merge 85 > fix (CI expired) 72 > stale 40 > draft 30 > waiting 20
 */
export function classifyMine(pr, now = Date.now(), { staleDays = 7 } = {}) {
  if (pr.state === 'Draft') {
    return { category: 'draft', reason: 'Draft — publish when ready for review', priority: 30 };
  }
  if (pr.state !== 'Open') return null; // Merged/Closed → nothing to do

  const idle = idleDays(pr, now) ?? 0;
  const pipeline = pr.pipeline?.overall;
  const conflict = pr.merge ? pr.merge.noConflicts === false : false;

  if (pr.reviewStatus === 'Changes Requested') {
    return { category: 'fix', reason: 'A reviewer requested changes', priority: 95 };
  }
  if (pipeline === 'Failed') {
    return { category: 'fix', reason: 'CI pipeline failed', priority: 92 };
  }
  if (conflict) {
    return { category: 'fix', reason: 'Merge conflict — needs a rebase', priority: 88 };
  }
  if (pr.canMerge) {
    return { category: 'merge', reason: 'All checks green — ready to merge', priority: 85 };
  }
  if (pipeline === 'Expired') {
    return { category: 'fix', reason: 'CI expired — re-run required', priority: 72 };
  }
  if (idle >= staleDays) {
    return { category: 'stale', reason: `No activity for ${idle} days`, priority: 40 };
  }
  return { category: 'waiting', reason: waitingReason(pr), priority: 20 };
}

/**
 * Classify a PR assigned to ME for review. Actionable only while I haven't voted;
 * priority climbs with idle time (the longer someone waits on me, the more urgent
 * — an old review request can outrank a fresh ready-to-merge).
 */
export function classifyAssigned(pr, now = Date.now()) {
  if (pr.state && pr.state !== 'Open') return null;
  if (pr.myReview?.reviewed) return null; // I've already cast my vote
  const idle = idleDays(pr, now) ?? 0;
  const reason = idle > 0 ? `Awaiting your review for ${idle} day${idle === 1 ? '' : 's'}` : 'Awaiting your review';
  return { category: 'review', reason, priority: 60 + Math.min(idle, 40) };
}

function shape(pr, cls, now, source) {
  return {
    id: pr.id,
    repo: pr.repo,
    title: pr.title,
    state: pr.state,
    category: cls.category,
    priority: cls.priority,
    reason: cls.reason,
    idleDays: idleDays(pr, now),
    ageDays: ageDays(pr, now),
    reviewStatus: pr.reviewStatus || null,
    pipeline: pr.pipeline?.overall || 'None',
    canMerge: !!pr.canMerge,
    sourceBranch: pr.sourceBranch || null,
    targetBranch: pr.targetBranch || null,
    activeComments: pr.activeComments ?? pr.comments?.active ?? 0,
    approvals: pr.review?.approvals ?? null,
    required: pr.review?.required ?? null,
    author: pr.createdBy?.displayName || null,
    myVote: pr.myReview?.vote ?? null,
    labels: pr.labels || [],
    webUrl: pr.webUrl,
    source, // 'mine' | 'assigned'
  };
}

const CATEGORIES = ['fix', 'review', 'merge', 'stale', 'draft', 'waiting'];

/**
 * Build the Action Center payload from enriched created + assigned PR lists.
 * Returns a flat priority-sorted `items` list, `groups` keyed by category, and
 * `counts` per category.
 */
export function buildActionCenter(created = [], assigned = [], { now = Date.now(), staleDays = 7 } = {}) {
  const items = [];
  for (const pr of created) {
    const cls = classifyMine(pr, now, { staleDays });
    if (cls) items.push(shape(pr, cls, now, 'mine'));
  }
  for (const pr of assigned) {
    const cls = classifyAssigned(pr, now);
    if (cls) items.push(shape(pr, cls, now, 'assigned'));
  }
  items.sort(
    (a, b) =>
      b.priority - a.priority ||
      (b.idleDays || 0) - (a.idleDays || 0) ||
      String(a.repo).localeCompare(String(b.repo)) ||
      a.id - b.id
  );

  const groups = {};
  const counts = { total: items.length };
  for (const cat of CATEGORIES) {
    groups[cat] = items.filter((i) => i.category === cat);
    counts[cat] = groups[cat].length;
  }

  return { generatedAt: new Date(now).toISOString(), staleDays, counts, groups, items };
}

/** Stable signature of an item's actionable state — a dismissal is auto-cleared
 *  when this changes (e.g. CI goes green, reviewer votes, PR merges). */
export function itemSignature(item) {
  return `${item.category}|${item.reason}`;
}

/**
 * Apply a user's personal overlay (E3) to an Action Center payload: drop snoozed
 * items (until the snooze expires), drop dismissed items whose signature still
 * matches, and tag followed items. Pure — rebuilds groups + counts from the kept
 * items. `snoozes`/`dismissals` are keyed by "repo#id"; `follows` is a Set of keys.
 */
export function applyActionOverlay(payload, { snoozes = {}, dismissals = {}, follows = new Set() } = {}, now = Date.now()) {
  const kept = [];
  let snoozed = 0;
  let dismissed = 0;
  for (const it of payload.items || []) {
    const k = `${it.repo}#${it.id}`;
    const until = snoozes[k] ? new Date(snoozes[k]).getTime() : 0;
    if (until > now) { snoozed += 1; continue; }
    const dsig = dismissals[k];
    if (dsig !== undefined && dsig === itemSignature(it)) { dismissed += 1; continue; }
    kept.push({ ...it, followed: follows.has ? follows.has(k) : !!follows[k] });
  }
  const groups = {};
  const counts = { total: kept.length, snoozed, dismissed };
  for (const cat of CATEGORIES) {
    groups[cat] = kept.filter((i) => i.category === cat);
    counts[cat] = groups[cat].length;
  }
  return { ...payload, items: kept, groups, counts };
}
