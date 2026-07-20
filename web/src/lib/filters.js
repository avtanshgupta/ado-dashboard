export const STATE_OPTIONS = ['Open', 'Draft', 'Merged', 'Closed'];

export const TIME_RANGES = [
  { key: '1mo', label: 'Updated: 1 month', months: 1 },
  { key: '3mo', label: 'Updated: 3 months', months: 3 },
  { key: '6mo', label: 'Updated: 6 months', months: 6 },
  { key: '12mo', label: 'Updated: 1 year', months: 12 },
  { key: 'all', label: 'Updated: all time', months: null },
];

export function timeRangeCutoff(key) {
  const range = TIME_RANGES.find((r) => r.key === key);
  if (!range || range.months == null) return null;
  const d = new Date();
  d.setMonth(d.getMonth() - range.months);
  return d.getTime();
}

export const SORT_OPTIONS = [
  { key: 'lastActivity', label: 'Last updated' },
  { key: 'creationDate', label: 'Created date' },
  { key: 'title', label: 'Title' },
  { key: 'activeComments', label: 'Active comments' },
  { key: 'state', label: 'State' },
  { key: 'repo', label: 'Repository' },
  { key: 'reviewStatus', label: 'Review status' },
];

function getVal(pr, key) {
  switch (key) {
    case 'creationDate':
    case 'lastActivity':
      return new Date(pr[key] || pr.creationDate).getTime();
    case 'activeComments':
      return pr.activeComments ?? 0;
    case 'pipeline':
      return pr.pipeline?.overall || '';
    case 'pop': {
      // Sort by severity: not signed off → pending → signed off → none.
      const rank = { rejected: 0, queued: 1, running: 1, approved: 2 };
      return pr.pop ? rank[pr.pop.status] ?? 1.5 : 3;
    }
    case 'myReview': {
      // Surface action-needed first: not reviewed → waiting → rejected → approved.
      const rank = { '0': 0, '-5': 1, '-10': 2, '5': 3, '10': 4 };
      return rank[String(pr.myReview?.vote ?? 0)] ?? 0;
    }
    case 'title':
      return (pr.title || '').toLowerCase();
    default:
      return pr[key] ?? '';
  }
}

export function applyFilterSort(prs, filters, sort) {
  const { repos = [], states = [], search = '', pipeline = '', review = '', timeRange = 'all', labels = [] } = filters || {};
  const q = search.trim().toLowerCase();
  const cutoff = timeRangeCutoff(timeRange);
  let out = prs.filter((pr) => {
    if (repos.length && !repos.includes(pr.repo)) return false;
    if (states.length && !states.includes(pr.state)) return false;
    if (labels.length && !(pr.labels || []).some((l) => labels.includes(l))) return false;
    if (pipeline && (pr.pipeline?.overall || 'None') !== pipeline) return false;
    if (review && pr.reviewStatus !== review) return false;
    if (cutoff) {
      const updated = new Date(pr.lastActivity || pr.creationDate).getTime();
      if (updated < cutoff) return false;
    }
    if (q) {
      const hay = `${pr.title} ${pr.sourceBranch} ${pr.createdBy?.displayName} ${pr.id} ${pr.repo}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (sort?.key) {
    const dir = sort.dir === 'asc' ? 1 : -1;
    out = [...out].sort((a, b) => {
      const va = getVal(a, sort.key);
      const vb = getVal(b, sort.key);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }
  return out;
}

/** Global search across all categories. */
export function searchAll(buckets, q) {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const seen = new Set();
  const results = [];
  for (const [category, list] of Object.entries(buckets)) {
    for (const pr of list || []) {
      const key = `${pr.repo}#${pr.id}`;
      if (seen.has(key)) continue;
      const hay = `${pr.title} ${pr.sourceBranch} ${pr.createdBy?.displayName} ${pr.id} ${pr.repo}`.toLowerCase();
      if (hay.includes(query)) {
        seen.add(key);
        results.push({ ...pr, category });
      }
    }
  }
  return results.slice(0, 30);
}
