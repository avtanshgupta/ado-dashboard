// Pure work-item analytics aggregation for the Overview tab. No I/O — takes
// already-shaped work-item summaries and computes distributions (state category,
// type, assignee), aging buckets, weekly throughput, and SLA/idle breaches.
// Mirrors prAnalytics.js so the maths stays deterministic and unit-testable.

const DAY_MS = 86400000;

const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

export function mean(nums) {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** ISO week key (Mon-anchored) as YYYY-MM-DD of that week's Monday. */
export function weekKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = (d.getUTCDay() + 6) % 7; // 0 = Monday
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

// Map a raw state to a coarse category when the type's state metadata isn't
// handy. ADO's own categories are authoritative; this is the display fallback.
const STATE_CATEGORY = {
  new: 'Proposed',
  proposed: 'Proposed',
  approved: 'Proposed',
  active: 'InProgress',
  committed: 'InProgress',
  'in progress': 'InProgress',
  doing: 'InProgress',
  resolved: 'Resolved',
  'code review': 'Resolved',
  testing: 'Resolved',
  closed: 'Completed',
  done: 'Completed',
  completed: 'Completed',
  removed: 'Removed',
};

/** Coarse category for a state name (case-insensitive), defaulting to InProgress. */
export function stateCategory(state, override) {
  if (override) return override;
  return STATE_CATEGORY[String(state || '').toLowerCase()] || 'InProgress';
}

const CATEGORY_OPEN = new Set(['Proposed', 'InProgress', 'Resolved']);
export function isOpenCategory(cat) {
  return CATEGORY_OPEN.has(cat);
}

const AGE_BUCKETS = [
  { label: '< 1 day', max: 1 },
  { label: '1–3 days', max: 3 },
  { label: '3–7 days', max: 7 },
  { label: '1–2 weeks', max: 14 },
  { label: '2–4 weeks', max: 28 },
  { label: '> 4 weeks', max: Infinity },
];

function tally(items, keyFn) {
  const map = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (k == null || k === '') continue;
    map.set(k, (map.get(k) || 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

/** Weekly created vs closed counts across the last `weeks` weeks. */
export function throughputByWeek(items, now = Date.now(), weeks = 12) {
  const created = new Map();
  const closed = new Map();
  for (let i = weeks - 1; i >= 0; i--) {
    const wk = weekKey(new Date(now - i * 7 * DAY_MS).toISOString());
    if (wk) {
      created.set(wk, 0);
      closed.set(wk, 0);
    }
  }
  for (const it of items) {
    const cwk = weekKey(it.createdDate);
    if (cwk && created.has(cwk)) created.set(cwk, created.get(cwk) + 1);
    // "Closed" approximated by changedDate for items now in a terminal category.
    if (it._category === 'Completed' || it._category === 'Removed') {
      const dwk = weekKey(it.changedDate);
      if (dwk && closed.has(dwk)) closed.set(dwk, closed.get(dwk) + 1);
    }
  }
  return [...created.keys()].map((week) => ({ week, created: created.get(week), closed: closed.get(week) }));
}

/** Histogram of open items by age + the oldest few + idle/SLA breaches. */
export function aging(openItems, slaDays = 7) {
  const buckets = AGE_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  for (const it of openItems) {
    const a = it.ageDays ?? 0;
    const bi = AGE_BUCKETS.findIndex((b) => a < b.max);
    buckets[bi === -1 ? buckets.length - 1 : bi].count += 1;
  }
  const oldest = [...openItems].sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0)).slice(0, 8);
  const breaching = openItems
    .filter((it) => (it.idleDays || 0) >= slaDays)
    .sort((a, b) => (b.idleDays || 0) - (a.idleDays || 0));
  return { buckets, oldest, breaching, slaDays };
}

/**
 * Assemble the work-item Overview payload from a flat list of shaped summaries.
 * `categoryFor(item)` optionally resolves the authoritative state category
 * (from type metadata); falls back to the name-based heuristic.
 */
export function buildWorkItemAnalytics(items = [], { now = Date.now(), slaDays = 7, weeks = 12, categoryFor } = {}) {
  const enriched = items.map((it) => ({
    ...it,
    _category: stateCategory(it.state, typeof categoryFor === 'function' ? categoryFor(it) : undefined),
  }));

  const open = enriched.filter((it) => isOpenCategory(it._category));
  const completed = enriched.filter((it) => it._category === 'Completed');

  const byStateCategory = tally(enriched, (it) => it._category);
  const byState = tally(enriched, (it) => it.state);
  const byType = tally(enriched, (it) => it.type);
  const byAssignee = tally(enriched, (it) => it.assignedTo?.displayName || 'Unassigned');
  const byPriority = tally(
    enriched.filter((it) => it.priority != null),
    (it) => `P${it.priority}`
  );

  const points = open.map((it) => Number(it.storyPoints ?? it.effort)).filter((n) => Number.isFinite(n));

  return {
    generatedAt: new Date(now).toISOString(),
    slaDays,
    total: enriched.length,
    openCount: open.length,
    completedCount: completed.length,
    unassignedCount: open.filter((it) => !it.assignedTo).length,
    openStoryPoints: round1(points.reduce((a, b) => a + b, 0)),
    byStateCategory,
    byState,
    byType,
    byAssignee,
    byPriority,
    aging: aging(open, slaDays),
    throughput: throughputByWeek(enriched, now, weeks),
  };
}
