/**
 * Derive lightweight observability stats from the per-user audit trail (C5):
 * per-route request counts, error rate, and latency percentiles. Pure and
 * dependency-free so it is unit-testable; the audit entries are the
 * `{ method, path, status, ok, ms, t }` records written by the audit middleware.
 */

/**
 * Collapse a concrete request path into a route template so different ids group
 * together: all-digit segments and the repo segment after `/prs/` become
 * placeholders (e.g. /api/prs/My.Repo/123/merge → /api/prs/:repo/:id/merge).
 */
export function normalizeRoute(path) {
  const clean = String(path || '').split('?')[0];
  const segs = clean.split('/');
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (!s) continue;
    if (/^\d+$/.test(s)) segs[i] = ':id';
    else if (segs[i - 1] === 'prs' && s !== ':id') segs[i] = ':repo';
    else if (segs[i - 1] === 'runs' && s !== ':id') segs[i] = ':id';
  }
  return segs.join('/') || '/';
}

/** Nearest-rank percentile of an already-sorted ascending numeric array. */
export function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  const idx = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[idx];
}

function statsFor(latencies) {
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] || 0,
  };
}

/**
 * Aggregate audit entries into overall + per-route stats. Routes are sorted by
 * request count (busiest first). `topRoutes` caps the returned route list.
 */
export function buildAuditStats(entries, { topRoutes = 20 } = {}) {
  const list = Array.isArray(entries) ? entries.filter((e) => e && typeof e.ms === 'number') : [];
  const overallLat = [];
  let errors = 0;
  const byRoute = new Map();

  for (const e of list) {
    overallLat.push(e.ms);
    if (e.ok === false || (typeof e.status === 'number' && e.status >= 400)) errors += 1;
    const key = `${e.method} ${normalizeRoute(e.path)}`;
    let r = byRoute.get(key);
    if (!r) {
      r = { route: normalizeRoute(e.path), method: e.method || 'GET', count: 0, errors: 0, latencies: [] };
      byRoute.set(key, r);
    }
    r.count += 1;
    r.latencies.push(e.ms);
    if (e.ok === false || (typeof e.status === 'number' && e.status >= 400)) r.errors += 1;
  }

  const routes = [...byRoute.values()]
    .map((r) => {
      const s = statsFor(r.latencies);
      return { route: r.route, method: r.method, count: r.count, errors: r.errors, ...s };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, topRoutes);

  const overall = statsFor(overallLat);
  return {
    total: list.length,
    errors,
    errorRate: list.length ? +(errors / list.length).toFixed(4) : 0,
    ...overall,
    routes,
  };
}
