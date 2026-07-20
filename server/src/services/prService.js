import { currentConfig, currentUser } from '../lib/context.js';
import { adoGet, gitUrl, policyUrl, witUrl, projectForRepo } from '../lib/adoClient.js';
import { buildActionCenter, applyActionOverlay, itemSignature } from '../lib/prPriority.js';
import { buildPrAnalytics } from '../lib/prAnalytics.js';
import { buildStandup } from '../lib/standup.js';
import { getScopedOverlay, pruneScopedOverlay, listFollows, isFollowing } from '../lib/userState.js';
import {
  prState,
  reviewStatus,
  myReview,
  summarizeThreads,
  pipelineStatus,
  proofOfPresence,
  mergeability,
  prWebUrl,
} from '../lib/mappers.js';

// ---- raw fetchers ----
// ADO returns PRs newest-first in pages; loop with $skip until a short page
// (fewer than requested) proves we've reached the end, or we hit `max`. This
// replaces the previous single-call fetch that silently truncated at $top, so
// large repos/authors no longer drop PRs (and counts) off the end (C13).
const PR_PAGE = 200;

async function fetchPRs(repo, criteria, max = 100) {
  const out = [];
  let skip = 0;
  while (out.length < max) {
    const want = Math.min(PR_PAGE, max - out.length);
    const query = { '$top': want, '$skip': skip };
    for (const [k, v] of Object.entries(criteria)) {
      query[`searchCriteria.${k}`] = v;
    }
    let data;
    try {
      data = await adoGet(gitUrl(repo, 'pullrequests'), { query });
    } catch (err) {
      // F2 — repos are project-scoped but the repo list is a per-user union, so
      // after switching the active project a configured repo may not exist here.
      // Treat "repository not found" as an empty result instead of failing the
      // whole list, so switching projects degrades gracefully.
      if (err && err.status === 404) break;
      throw err;
    }
    const page = data.value || [];
    for (const pr of page) out.push({ ...pr, _repo: repo });
    if (page.length < want) break; // short page → end of results
    skip += page.length;
  }
  return out;
}

// Shared fetch of all active PRs in a repo (cached; reused by team + assigned).
// Paged to completion (bounded) so busy repos aren't silently truncated.
async function fetchActivePRs(repo) {
  return fetchPRs(repo, { status: 'active' }, 2000);
}

function reviewerGroupName(reviewer) {
  for (const field of [reviewer.displayName, reviewer.uniqueName]) {
    if (field && field.includes('\\')) {
      return field.split('\\').pop().trim().toLowerCase();
    }
  }
  return (reviewer.displayName || '').trim().toLowerCase();
}

// Labels of the current user's configured reviewer-groups present on a PR.
function matchReviewerGroups(reviewers) {
  const map = currentConfig().groupNameToLabel;
  const labels = [];
  for (const r of reviewers || []) {
    const label = map.get(reviewerGroupName(r));
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

async function fetchThreads(repo, prId) {
  const data = await adoGet(gitUrl(repo, `pullRequests/${prId}/threads`));
  return data.value || [];
}

async function fetchCommitsCount(repo, prId) {
  const data = await adoGet(gitUrl(repo, `pullRequests/${prId}/commits`), {
    query: { '$top': 1000 },
  });
  return data.count ?? (data.value || []).length;
}

async function fetchFilesCount(repo, prId) {
  const iters = await adoGet(gitUrl(repo, `pullRequests/${prId}/iterations`));
  const list = iters.value || [];
  if (!list.length) return 0;
  const last = list[list.length - 1].id;
  const changes = await adoGet(
    gitUrl(repo, `pullRequests/${prId}/iterations/${last}/changes`),
    { query: { '$top': 2000 } }
  );
  const entries = changes.changeEntries || [];
  return entries.filter((c) => c.item && c.item.gitObjectType !== 'tree').length;
}

// The PR list/get APIs don't return labels inline — they must be fetched per PR
// from the dedicated labels endpoint. Called as one parallel task inside enrich(),
// so it adds request volume (bounded by the limiter + cache) but ~no wall-clock.
async function fetchLabels(repo, prId) {
  const data = await adoGet(gitUrl(repo, `pullRequests/${prId}/labels`));
  return (data.value || [])
    .filter((l) => l.active !== false)
    .map((l) => l.name)
    .filter(Boolean);
}

// Linked work items: PR endpoint returns id refs; batch-fetch titles/type/state.
async function fetchWorkItems(repo, prId) {
  const { project, org } = projectForRepo(repo);
  const refs = await adoGet(gitUrl(repo, `pullRequests/${prId}/workitems`), { query: { 'api-version': '7.1' } });
  const ids = (refs.value || []).map((r) => r.id).filter(Boolean);
  if (!ids.length) return [];
  const wi = await adoGet(witUrl('workitems', project), {
    query: { ids: ids.join(','), fields: 'System.Title,System.WorkItemType,System.State', 'api-version': '7.1' },
  });
  return (wi.value || []).map((w) => ({
    id: w.id,
    title: w.fields?.['System.Title'] || `Work item ${w.id}`,
    type: w.fields?.['System.WorkItemType'] || null,
    state: w.fields?.['System.State'] || null,
    url: `${org}/${encodeURIComponent(project)}/_workitems/edit/${w.id}`,
  }));
}

async function fetchPolicies(repo, prId) {
  const { project, projectId } = projectForRepo(repo);
  const artifactId = `vstfs:///CodeReview/CodeReviewId/${projectId}/${prId}`;
  const data = await adoGet(policyUrl('evaluations', project), {
    query: { artifactId, 'api-version': '7.1-preview' },
  });
  return data.value || [];
}

// ---- base mapping (no extra API calls) ----
function baseShape(pr) {
  const review = reviewStatus(pr);
  return {
    id: pr.pullRequestId,
    repo: pr._repo,
    title: pr.title,
    description: pr.description || '',
    state: prState(pr),
    status: pr.status,
    isDraft: !!pr.isDraft,
    createdBy: {
      id: pr.createdBy?.id,
      displayName: pr.createdBy?.displayName,
      uniqueName: pr.createdBy?.uniqueName,
      imageUrl: pr.createdBy?.imageUrl,
    },
    creationDate: pr.creationDate,
    closedDate: pr.closedDate || null,
    sourceBranch: (pr.sourceRefName || '').replace('refs/heads/', ''),
    targetBranch: (pr.targetRefName || '').replace('refs/heads/', ''),
    mergeStatus: pr.mergeStatus || null,
    lastMergeSourceCommit: pr.lastMergeSourceCommit?.commitId || null,
    isMergeQueued: pr.mergeStatus === 'queued',
    autoComplete: {
      isSet: !!pr.autoCompleteSetBy?.id,
      setBy: pr.autoCompleteSetBy?.displayName || null,
    },
    reviewStatus: review.status,
    review,
    webUrl: prWebUrl(projectForRepo(pr._repo).org, projectForRepo(pr._repo).project, pr._repo, pr.pullRequestId),
    labels: (pr.labels || []).map((l) => l.name),
  };
}

// ---- full enrichment (extra API calls, bounded by the limiter) ----
async function enrich(pr, opts = {}) {
  const me = currentUser();
  const base = baseShape(pr);
  base.myReview = myReview(pr, me.id);
  // Historical (merged/abandoned) PRs aren't actionable — skip the costly
  // per-PR calls unless explicitly forced (e.g. the detail view).
  const active = pr.status === 'active';
  const o = active || opts.force ? opts : { threads: false, pipeline: false, commits: false, files: false, labels: false };

  // Track per-PR enrichment failures instead of swallowing them, so the UI can
  // flag partial data and the server logs a diagnosable warning. On failure a
  // task resolves to null (distinct from a genuine empty result).
  const failed = [];
  const guard = (label, promise) =>
    promise.catch((e) => {
      failed.push(label);
      console.warn(`[enrich] ${pr._repo}#${pr.pullRequestId} ${label} failed: ${e.message}`);
      return null;
    });

  const tasks = {};
  if (o.threads !== false) tasks.threads = guard('comments', fetchThreads(pr._repo, pr.pullRequestId));
  if (o.pipeline !== false) tasks.policies = guard('pipeline', fetchPolicies(pr._repo, pr.pullRequestId));
  if (o.commits !== false) tasks.commits = guard('commits', fetchCommitsCount(pr._repo, pr.pullRequestId));
  if (o.files !== false) tasks.files = guard('files', fetchFilesCount(pr._repo, pr.pullRequestId));
  if (o.labels !== false) tasks.labels = guard('labels', fetchLabels(pr._repo, pr.pullRequestId));

  const keys = Object.keys(tasks);
  const results = await Promise.all(keys.map((k) => tasks[k]));
  const out = Object.fromEntries(keys.map((k, i) => [k, results[i]]));

  if (out.threads) {
    const summary = summarizeThreads(out.threads, me.id);
    base.comments = {
      active: summary.active,
      resolved: summary.resolved,
      total: summary.total,
      participants: summary.participants,
    };
    base.activeComments = summary.active;
    const lastThread = summary.threads.map((t) => t.lastUpdated).filter(Boolean).sort().pop();
    base.lastActivity = lastThread && lastThread > base.creationDate ? lastThread : base.creationDate;
  } else {
    base.lastActivity = pr.closedDate || base.creationDate;
  }
  if (out.policies) {
    base.pipeline = pipelineStatus(out.policies);
    base.pop = proofOfPresence(out.policies);
    base.merge = mergeability(out.policies, pr);
    base.canMerge = base.merge.canMerge;
    // Recompute the review status now that we know how many approvals the
    // branch policies require (base shape only had the reviewer votes).
    const review = reviewStatus(pr, out.policies);
    base.review = review;
    base.reviewStatus = review.status;
  } else {
    base.canMerge = false;
  }
  if (out.commits !== undefined) base.commitCount = out.commits;
  if (out.files !== undefined) base.fileCount = out.files;
  if (out.labels != null) base.labels = out.labels;
  if (failed.length) base.partial = failed;
  return base;
}

async function enrichAll(prs, opts) {
  return Promise.all(prs.map((pr) => enrich(pr, opts)));
}

// List views need review + comments + pipeline (+pop/merge) + labels; not commits/files.
const LIST_OPTS = { commits: false, files: false };

// ---- public: category listings ----
export async function listCreated({ status = 'active' } = {}) {
  const cfg = currentConfig();
  const me = currentUser();
  const lists = await Promise.all(
    cfg.repositories.map((repo) => fetchPRs(repo, { creatorId: me.id, status }, 300))
  );
  return enrichAll(lists.flat(), LIST_OPTS);
}

/**
 * PRs assigned for my review, split by scope:
 *   - 'me'   → I am a direct reviewer.
 *   - 'team' → one of my configured review-group aliases is a reviewer, and I am
 *              NOT a direct reviewer (so the two scopes never overlap).
 */
export async function listAssigned({ scope = 'me' } = {}) {
  const cfg = currentConfig();
  const me = currentUser();
  const perRepo = await Promise.all(
    cfg.repositories.map(async (repo) => {
      if (scope === 'team') {
        const active = await fetchActivePRs(repo);
        const out = [];
        for (const pr of active) {
          if (pr.createdBy?.id === me.id) continue;
          const isMe = (pr.reviewers || []).some((r) => r.id === me.id);
          const groups = matchReviewerGroups(pr.reviewers);
          if (groups.length > 0 && !isMe) out.push({ pr, isMe, groups });
        }
        return out;
      }
      // scope === 'me': directly-assigned PRs only.
      const mine = await fetchPRs(repo, { reviewerId: me.id, status: 'active' }, 300);
      return mine
        .filter((pr) => pr.createdBy?.id !== me.id)
        .map((pr) => ({ pr, isMe: true, groups: matchReviewerGroups(pr.reviewers) }));
    })
  );
  const items = perRepo.flat();
  const enriched = await enrichAll(items.map((x) => x.pr), LIST_OPTS);
  const metaById = new Map(items.map((x) => [x.pr.pullRequestId, x]));
  for (const pr of enriched) {
    const m = metaById.get(pr.id);
    pr.assignedVia = { me: m.isMe, groups: m.groups };
  }
  return enriched;
}

export async function listTeam() {
  const cfg = currentConfig();
  const lists = await Promise.all(cfg.repositories.map((repo) => fetchActivePRs(repo)));
  const prs = lists
    .flat()
    .filter((pr) => cfg.teamSet.has((pr.createdBy?.uniqueName || '').toLowerCase()));
  return enrichAll(prs, LIST_OPTS);
}

// ---- public: overview (Open/Draft/Closed per category within a time window) ----
export async function getOverview({ months } = {}) {
  const cfg = currentConfig();
  const me = currentUser();
  const win = Number(months) || cfg.defaultTimeRangeMonths || 6;
  const cut = new Date();
  cut.setMonth(cut.getMonth() - win);
  const cutoffMs = cut.getTime();

  const closedWithinWindow = (pr) =>
    pr.closedDate ? new Date(pr.closedDate).getTime() >= cutoffMs : false;
  // Active PRs (Open/Draft) are current regardless of when they were opened, so
  // they are NOT windowed by creation date (G32 — the old code dropped
  // still-open PRs created before the window). Terminal PRs (Closed/Merged)
  // count only if they closed within the window, which is the throughput signal
  // surfaced as the Merged series (E26).
  const bucket = (prs) => {
    const c = { Open: 0, Draft: 0, Closed: 0, Merged: 0 };
    for (const pr of prs) {
      const st = prState(pr);
      if ((st === 'Closed' || st === 'Merged') && !closedWithinWindow(pr)) continue;
      c[st] = (c[st] || 0) + 1;
    }
    return c;
  };

  const perRepo = await Promise.all(
    cfg.repositories.map(async (repo) => {
      const [mine, assignedDirect, allRecent] = await Promise.all([
        fetchPRs(repo, { creatorId: me.id, status: 'all' }, 300),
        fetchPRs(repo, { reviewerId: me.id, status: 'all' }, 300),
        fetchPRs(repo, { status: 'all' }, 800),
      ]);
      // Direct: I'm a reviewer (exclude my own PRs).
      const assignedMe = assignedDirect.filter((p) => p.createdBy?.id !== me.id);
      const directIds = new Set(assignedMe.map((p) => p.pullRequestId));
      // Team alias: a configured group is a reviewer, and I'm not a direct reviewer.
      const assignedTeam = allRecent.filter(
        (pr) =>
          pr.status === 'active' &&
          pr.createdBy?.id !== me.id &&
          !directIds.has(pr.pullRequestId) &&
          (pr.reviewers || []).every((r) => r.id !== me.id) &&
          matchReviewerGroups(pr.reviewers).length > 0
      );
      const teamPrs = allRecent.filter(
        (pr) =>
          pr.createdBy?.id !== me.id &&
          cfg.teamSet.has((pr.createdBy?.uniqueName || '').toLowerCase())
      );
      return {
        repo,
        webUrl: `${projectForRepo(repo).org}/${encodeURIComponent(projectForRepo(repo).project)}/_git/${encodeURIComponent(repo)}`,
        my: bucket(mine),
        assignedMe: bucket(assignedMe),
        assignedTeam: bucket(assignedTeam),
        team: bucket(teamPrs),
      };
    })
  );

  const sum = (key) =>
    perRepo.reduce(
      (a, r) => ({
        Open: a.Open + r[key].Open,
        Draft: a.Draft + r[key].Draft,
        Closed: a.Closed + r[key].Closed,
        Merged: a.Merged + r[key].Merged,
      }),
      { Open: 0, Draft: 0, Closed: 0, Merged: 0 }
    );

  return {
    months: win,
    perRepo,
    my: sum('my'),
    assignedMe: sum('assignedMe'),
    assignedTeam: sum('assignedTeam'),
    team: sum('team'),
  };
}

/**
 * Project-level summary for the main Overview: build success rate, open-PR
 * counts, review workload, a pipeline-status breakdown and recent activity.
 * Build metrics are derived from my active PRs' gating pipelines (the builds
 * that actually matter to me); a full Pipelines view is coming later.
 *
 * Kept deliberately light: only my own + directly-assigned PRs are enriched
 * (pipeline/threads). Team & team-alias open counts come from raw active PRs
 * (one cached call per repo, no per-PR enrichment) so the landing page is fast.
 */
export async function getProjectSummary() {
  const cfg = currentConfig();
  const me = currentUser();
  const staleDays = cfg.slaDays || 7;
  const weekAgoMs = Date.now() - 7 * 86400000;

  const [created, assignedMe, teamCounts, mergedByRepo] = await Promise.all([
    listCreated({ status: 'active' }),
    listAssigned({ scope: 'me' }),
    countTeamOpen(),
    // Cheap, parallel: my recently-completed PRs (for "merged this week"). No
    // per-PR enrichment — raw list only.
    Promise.all(cfg.repositories.map((repo) => fetchPRs(repo, { creatorId: me.id, status: 'completed' }, 100))),
  ]);

  // Pipeline breakdown across my active PRs' gating pipelines.
  const pipelineBreakdown = { Succeeded: 0, Failed: 0, Running: 0, Queued: 0, Expired: 0, Pending: 0, None: 0 };
  for (const p of created) {
    const o = p.pipeline?.overall || 'None';
    pipelineBreakdown[o] = (pipelineBreakdown[o] || 0) + 1;
  }
  // Build success rate = succeeded / (succeeded + failed) among terminal states.
  const succeeded = pipelineBreakdown.Succeeded;
  const failed = pipelineBreakdown.Failed;
  const terminal = succeeded + failed;
  const buildSuccessRate = terminal ? Math.round((100 * succeeded) / terminal) : null;

  // Prioritized "needs your attention" — reuse the Action Center engine over the
  // already-enriched created + assigned lists (pure, no extra ADO calls).
  const ac = buildActionCenter(created, assignedMe, { staleDays });
  const priority = {
    counts: ac.counts,
    top: ac.items.slice(0, 6),
  };

  // Personal velocity: my PRs merged in the last 7 days.
  const mergedThisWeek = mergedByRepo
    .flat()
    .filter((p) => p.status === 'completed' && p.closedDate && new Date(p.closedDate).getTime() >= weekAgoMs)
    .length;

  // Recent activity: newest-touched PRs across mine + assigned-to-me.
  const recent = [...created, ...assignedMe]
    .filter((p) => p.lastActivity)
    .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity))
    .slice(0, 10)
    .map((p) => ({
      id: p.id,
      repo: p.repo,
      title: p.title,
      state: p.state,
      reviewStatus: p.reviewStatus,
      review: p.review,
      pipeline: p.pipeline?.overall || 'None',
      lastActivity: p.lastActivity,
      webUrl: p.webUrl,
      author: p.createdBy?.displayName,
      mine: p.createdBy?.id === me.id,
    }));

  const openPrs = {
    mine: created.length,
    assignedMe: assignedMe.length,
    assignedTeam: teamCounts.assignedTeam,
    team: teamCounts.team,
  };

  return {
    generatedAt: new Date().toISOString(),
    me: { displayName: me.displayName },
    openPrs,
    totalOpen: openPrs.mine + openPrs.assignedMe + openPrs.assignedTeam + openPrs.team,
    awaitingMyReview: assignedMe.filter((p) => !p.myReview?.reviewed).length,
    readyToMerge: priority.counts.merge || 0,
    needsFix: priority.counts.fix || 0,
    stale: priority.counts.stale || 0,
    actionable: (priority.counts.fix || 0) + (priority.counts.review || 0) + (priority.counts.merge || 0) + (priority.counts.stale || 0),
    mergedThisWeek,
    buildSuccessRate,
    buildSampleSize: terminal,
    activePipelines: created.filter((p) => (p.pipeline?.overall || 'None') !== 'None').length,
    pipelineBreakdown,
    priority,
    recent,
  };
}

/**
 * Count open PRs from team members and from my team-alias review groups, using
 * only raw active PRs (no per-PR enrichment) so it stays cheap.
 */
async function countTeamOpen() {
  const cfg = currentConfig();
  const me = currentUser();
  const lists = await Promise.all(cfg.repositories.map((repo) => fetchActivePRs(repo)));
  const all = lists.flat();
  let team = 0;
  let assignedTeam = 0;
  for (const pr of all) {
    if (pr.createdBy?.id === me.id) continue;
    if (cfg.teamSet.has((pr.createdBy?.uniqueName || '').toLowerCase())) team += 1;
    const iAmReviewer = (pr.reviewers || []).some((r) => r.id === me.id);
    if (!iAmReviewer && matchReviewerGroups(pr.reviewers).length > 0) assignedTeam += 1;
  }
  return { team, assignedTeam };
}

/**
 * Action Center: a single prioritized, actionable view of everything needing the
 * current user's attention — their authored PRs that need fixing/merging, and
 * PRs awaiting their review — ranked by urgency (see lib/prPriority.js). Reuses
 * the already-enriched created + directly-assigned lists (cached), so it adds no
 * extra ADO calls beyond those two category fetches.
 */
export async function getActionCenter({ staleDays } = {}) {
  const cfg = currentConfig();
  const [created, assigned] = await Promise.all([
    listCreated({ status: 'active' }),
    listAssigned({ scope: 'me' }),
  ]);
  const days = Number(staleDays);
  const payload = buildActionCenter(created, assigned, {
    staleDays: Number.isInteger(days) && days > 0 ? days : (cfg.slaDays || 7),
  });
  // Apply the user's personal snooze/dismiss/follow overlay (E3), scoped to the
  // active project. First prune stale dismissals + expired snoozes so a dismissal
  // can't permanently hide a later recurrence of the same state.
  const sigByKey = new Map(payload.items.map((it) => [`${it.repo}#${it.id}`, itemSignature(it)]));
  pruneScopedOverlay(sigByKey);
  return applyActionOverlay(payload, getScopedOverlay());
}

/**
 * Enriched details for the PRs the user is following (E3), even ones they don't
 * author or review. Missing/closed PRs are dropped silently.
 */
export async function getFollowedPrs() {
  const follows = listFollows();
  if (!follows.length) return [];
  const results = await Promise.all(
    follows.map(async (f) => {
      try {
        const pr = await adoGet(gitUrl(f.repo, `pullRequests/${f.id}`));
        pr._repo = f.repo;
        const enriched = await enrich(pr, { ...LIST_OPTS, force: true });
        enriched.followedAt = f.addedAt;
        return enriched;
      } catch {
        return null;
      }
    })
  );
  return results.filter(Boolean);
}

/**
 * PR analytics (B1–B4): cycle time, throughput, open-PR aging + SLA breaches,
 * reviewer workload and personal stats. Reuses the enriched active lists
 * (cached) for the "open" set and pulls raw completed/abandoned PRs within the
 * window for throughput + cycle time (no per-PR enrichment — cheap).
 */
export async function getPrAnalytics({ months } = {}) {
  const cfg = currentConfig();
  const me = currentUser();
  const win = Number(months) || cfg.defaultTimeRangeMonths || 6;
  const cut = new Date();
  cut.setMonth(cut.getMonth() - win);
  const cutoffMs = cut.getTime();
  const withinWindow = (pr) => (pr.closedDate ? new Date(pr.closedDate).getTime() >= cutoffMs : false);
  const shapeClosed = (pr) => ({
    id: pr.pullRequestId,
    repo: pr._repo,
    title: pr.title,
    createdBy: { id: pr.createdBy?.id, displayName: pr.createdBy?.displayName },
    creationDate: pr.creationDate,
    closedDate: pr.closedDate || null,
    webUrl: prWebUrl(projectForRepo(pr._repo).org, projectForRepo(pr._repo).project, pr._repo, pr.pullRequestId),
  });

  const [created, assignedMe, closedLists] = await Promise.all([
    listCreated({ status: 'active' }),
    listAssigned({ scope: 'me' }),
    Promise.all(
      cfg.repositories.map(async (repo) => {
        // Only MY closed PRs — analytics are scoped to the current user.
        const [completed, abandoned] = await Promise.all([
          fetchPRs(repo, { creatorId: me.id, status: 'completed' }, 500),
          fetchPRs(repo, { creatorId: me.id, status: 'abandoned' }, 300),
        ]);
        return { completed, abandoned };
      })
    ),
  ]);

  const merged = closedLists.flatMap((r) => r.completed).filter(withinWindow).map(shapeClosed);
  const abandoned = closedLists.flatMap((r) => r.abandoned).filter(withinWindow).map(shapeClosed);
  const weeks = Math.max(4, Math.min(26, Math.round(win * 4.345)));

  return buildPrAnalytics(
    // open = my authored active PRs; reviewQueue = PRs assigned to me for review.
    { open: created, merged, abandoned, reviewQueue: assignedMe, meId: me.id, meName: me.displayName },
    { slaDays: cfg.slaDays || 7, weeks }
  );
}

/**
 * Stand-up summary (D2): what I merged recently, what's in progress, what's
 * blocked, and what I still need to review. Reuses the enriched active lists
 * (cached) and my recently-merged PRs.
 */
export async function getStandup({ sinceHours } = {}) {
  const cfg = currentConfig();
  const me = currentUser();
  const hrs = Number(sinceHours);
  const since = Date.now() - (Number.isFinite(hrs) && hrs > 0 ? hrs : 24) * 3600 * 1000;
  const shapeClosed = (pr) => ({
    id: pr.pullRequestId,
    repo: pr._repo,
    title: pr.title,
    createdBy: { id: pr.createdBy?.id },
    closedDate: pr.closedDate || null,
    webUrl: prWebUrl(projectForRepo(pr._repo).org, projectForRepo(pr._repo).project, pr._repo, pr.pullRequestId),
  });

  const [created, assignedMe, mergedByRepo] = await Promise.all([
    listCreated({ status: 'active' }),
    listAssigned({ scope: 'me' }),
    Promise.all(cfg.repositories.map((repo) => fetchPRs(repo, { creatorId: me.id, status: 'completed' }, 100))),
  ]);
  const merged = mergedByRepo.flat().map(shapeClosed);
  return buildStandup({ created, assignedMe, merged }, { sinceMs: since });
}

// ---- public: lightweight snapshot for notifications ----
export async function snapshotState() {
  const cfg = currentConfig();
  const me = currentUser();
  const opts = { commits: false, files: false, labels: false };
  const tag = (arr, category) => arr.map((p) => ({ ...p, category }));
  const [created, assigned, team] = await Promise.all([
    (async () => {
      const lists = await Promise.all(
        cfg.repositories.map((repo) => fetchPRs(repo, { creatorId: me.id, status: 'active' }, 50))
      );
      return enrichAll(lists.flat(), opts);
    })(),
    (async () => {
      const lists = await Promise.all(
        cfg.repositories.map((repo) => fetchPRs(repo, { reviewerId: me.id, status: 'active' }, 50))
      );
      return enrichAll(lists.flat().filter((pr) => pr.createdBy?.id !== me.id), opts);
    })(),
    (async () => {
      const lists = await Promise.all(cfg.repositories.map((repo) => fetchActivePRs(repo)));
      const prs = lists.flat().filter((pr) => cfg.teamSet.has((pr.createdBy?.uniqueName || '').toLowerCase()));
      return enrichAll(prs, opts);
    })(),
  ]);
  return [...tag(created, 'created'), ...tag(assigned, 'assigned'), ...tag(team, 'team')];
}

// ---- public: single PR detail ----
export async function getPrDetail(repo, prId) {
  const me = currentUser();
  const pr = await adoGet(gitUrl(repo, `pullRequests/${prId}`));
  pr._repo = repo;
  const [enriched, threads, workItems] = await Promise.all([
    enrich(pr, { threads: false, force: true }),
    fetchThreads(repo, prId),
    fetchWorkItems(repo, prId).catch(() => []),
  ]);
  const summary = summarizeThreads(threads, me.id);
  enriched.comments = {
    active: summary.active,
    resolved: summary.resolved,
    pending: summary.pending,
    total: summary.total,
    participants: summary.participants,
  };
  enriched.activeComments = summary.active;
  enriched.threads = summary.threads;
  enriched.workItems = workItems;
  enriched.timeline = buildTimeline(threads, pr);
  // E3 — is the current user following this PR (in the active project)?
  enriched.isFollowed = isFollowing(repo, prId);
  return enriched;
}

function buildTimeline(threads, pr) {
  const events = [];
  events.push({
    type: 'created',
    date: pr.creationDate,
    actor: pr.createdBy?.displayName,
    text: 'created the pull request',
  });
  for (const t of threads || []) {
    for (const c of t.comments || []) {
      if (c.isDeleted) continue;
      const isSystem = c.commentType === 'system';
      events.push({
        type: isSystem ? 'system' : 'comment',
        date: c.publishedDate,
        actor: c.author?.displayName,
        threadId: t.id,
        threadStatus: t.status || null,
        text: stripHtml(c.content || ''),
      });
    }
    if (t.status) {
      events.push({
        type: 'thread-status',
        date: t.lastUpdatedDate,
        threadId: t.id,
        text: `thread marked ${t.status}`,
      });
    }
  }
  if (pr.closedDate) {
    events.push({
      type: pr.status === 'completed' ? 'merged' : 'closed',
      date: pr.closedDate,
      actor: pr.closedBy?.displayName,
      text: pr.status === 'completed' ? 'completed the pull request' : 'abandoned the pull request',
    });
  }
  return events.filter((e) => e.date).sort((a, b) => new Date(a.date) - new Date(b.date));
}

function stripHtml(s) {
  return String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}
