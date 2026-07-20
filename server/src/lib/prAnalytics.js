// Pure PR analytics aggregation (B1–B4). No I/O — takes already-shaped PR lists
// and computes cycle-time, throughput, aging, reviewer-workload and personal
// stats. Kept pure so the maths is deterministic and unit-testable.

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function mean(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** p in [0,100]; nearest-rank on a copy. */
export function percentile(nums, p) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

/** ISO week key (Mon-anchored) as YYYY-MM-DD of that week's Monday. */
export function weekKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

/** Merged PRs → count per ISO week across the last `weeks` weeks. */
export function throughputByWeek(merged, now = Date.now(), weeks = 12) {
  const buckets = new Map();
  // Seed the last N weeks so gaps render as zero.
  for (let i = weeks - 1; i >= 0; i--) {
    const wk = weekKey(new Date(now - i * 7 * DAY_MS).toISOString());
    if (wk) buckets.set(wk, 0);
  }
  for (const pr of merged) {
    const wk = weekKey(pr.closedDate);
    if (wk && buckets.has(wk)) buckets.set(wk, buckets.get(wk) + 1);
  }
  const perWeek = [...buckets.entries()].map(([week, count]) => ({ week, count }));
  const total = merged.length;
  return { perWeek, total, avgPerWeek: round1(mean(perWeek.map((w) => w.count)) || 0) };
}

/** Cycle time (creation → close) stats for merged PRs, in hours. */
export function cycleTimeStats(merged) {
  const hours = [];
  for (const pr of merged) {
    if (!pr.creationDate || !pr.closedDate) continue;
    const h = (new Date(pr.closedDate).getTime() - new Date(pr.creationDate).getTime()) / HOUR_MS;
    if (h >= 0) hours.push(h);
  }
  return {
    count: hours.length,
    medianHours: round1(median(hours)),
    avgHours: round1(mean(hours)),
    p75Hours: round1(percentile(hours, 75)),
    p90Hours: round1(percentile(hours, 90)),
  };
}

const AGE_BUCKETS = [
  { label: '< 1 day', max: 1 },
  { label: '1–3 days', max: 3 },
  { label: '3–7 days', max: 7 },
  { label: '1–2 weeks', max: 14 },
  { label: '2–4 weeks', max: 28 },
  { label: '> 4 weeks', max: Infinity },
];

const ageDays = (pr, now) => (pr.creationDate ? Math.max(0, Math.floor((now - new Date(pr.creationDate).getTime()) / DAY_MS)) : 0);
const idleDays = (pr, now) => {
  const d = pr.lastActivity || pr.creationDate;
  return d ? Math.max(0, Math.floor((now - new Date(d).getTime()) / DAY_MS)) : 0;
};

/** Histogram of open PRs by age + the oldest few + SLA breaches (B4). */
export function openAging(openPrs, now = Date.now(), slaDays = 7) {
  const buckets = AGE_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  for (const pr of openPrs) {
    const a = ageDays(pr, now);
    const bi = AGE_BUCKETS.findIndex((b) => a < b.max);
    buckets[bi === -1 ? buckets.length - 1 : bi].count += 1;
  }
  const withIdle = openPrs.map((pr) => ({
    id: pr.id, repo: pr.repo, title: pr.title, webUrl: pr.webUrl,
    author: pr.createdBy?.displayName || null,
    ageDays: ageDays(pr, now), idleDays: idleDays(pr, now),
    reviewStatus: pr.reviewStatus || null,
  }));
  const oldest = [...withIdle].sort((a, b) => b.ageDays - a.ageDays).slice(0, 8);
  const breachingSla = withIdle
    .filter((p) => p.idleDays >= slaDays)
    .sort((a, b) => b.idleDays - a.idleDays);
  return { total: openPrs.length, buckets, oldest, breachingSla, slaDays };
}

/** Distribution of open PRs across repositories (open + merged-this-window). */
export function byRepo(openPrs, merged) {
  const map = new Map();
  const bump = (repo, key) => {
    if (!repo) return;
    const cur = map.get(repo) || { repo, open: 0, merged: 0 };
    cur[key] += 1;
    map.set(repo, cur);
  };
  for (const pr of openPrs) bump(pr.repo, 'open');
  for (const pr of merged) bump(pr.repo, 'merged');
  return [...map.values()].sort((a, b) => (b.open + b.merged) - (a.open + a.merged));
}

/**
 * Assemble the PR-analytics payload — scoped entirely to the current user (meId).
 * Cycle time, throughput, aging and by-repo are computed from the user's OWN
 * authored PRs; the review section reflects only the user's own review activity.
 * Never surfaces other people's aggregate stats.
 *   - open        : the user's authored open PRs (deduped)
 *   - merged      : the user's merged PRs within the window
 *   - abandoned   : the user's abandoned PRs within the window
 *   - reviewQueue : PRs assigned to the user for review (for the review section)
 */
export function buildPrAnalytics({ open = [], merged = [], abandoned = [], reviewQueue = [], meId = null, meName = null }, { now = Date.now(), slaDays = 7, weeks = 12 } = {}) {
  const isMine = (p) => meId == null || p.createdBy?.id === meId;

  // My authored open PRs (deduped by repo#id).
  const seen = new Set();
  const myOpen = [];
  for (const pr of open) {
    if (!isMine(pr)) continue;
    const k = `${pr.repo}#${pr.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    myOpen.push(pr);
  }
  const myMerged = merged.filter(isMine);
  const myAbandoned = abandoned.filter(isMine);
  const myMergeTotal = myMerged.length + myAbandoned.length;

  // My review queue: PRs assigned to me for review that I haven't voted on yet.
  const awaiting = reviewQueue.filter((p) => p.createdBy?.id !== meId && !p.myReview?.reviewed);
  const approvalsGiven = reviewQueue.filter((p) => (p.myReview?.vote ?? 0) > 0).length;
  const awaitingList = awaiting
    .map((p) => ({
      id: p.id,
      repo: p.repo,
      title: p.title,
      webUrl: p.webUrl,
      author: p.createdBy?.displayName || null,
      idleDays: idleDays(p, now),
      reviewStatus: p.reviewStatus || null,
    }))
    .sort((a, b) => (b.idleDays || 0) - (a.idleDays || 0));

  return {
    generatedAt: new Date(now).toISOString(),
    slaDays,
    scope: 'mine',
    throughput: throughputByWeek(myMerged, now, weeks),
    cycleTime: cycleTimeStats(myMerged),
    openAging: openAging(myOpen, now, slaDays),
    byRepo: byRepo(myOpen, myMerged),
    review: {
      awaitingCount: awaiting.length,
      approvalsGiven,
      awaiting: awaitingList.slice(0, 15),
    },
    totals: {
      open: myOpen.length,
      merged: myMerged.length,
      abandoned: myAbandoned.length,
    },
    mine: {
      name: meName,
      open: myOpen.length,
      merged: myMerged.length,
      abandoned: myAbandoned.length,
      mergeRate: myMergeTotal ? Math.round((100 * myMerged.length) / myMergeTotal) : null,
      medianCycleHours: cycleTimeStats(myMerged).medianHours,
      awaitingMyReview: awaiting.length,
      approvalsGiven,
    },
  };
}
