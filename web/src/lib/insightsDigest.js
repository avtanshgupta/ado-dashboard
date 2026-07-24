// Pure cross-area "weekly digest" summary (B2). Given already-fetched analytics
// from each area, produce a single set of headline stats + highlights. Tolerates
// any input being null/partial so the Insights page degrades gracefully.

/** Format a duration in hours as a compact "5h" / "1.3d" string. */
export function fmtHours(h) {
  if (h == null || !Number.isFinite(h)) return '—';
  if (h < 24) return `${Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

/** Format a 0..1 ratio as a whole-number percentage. */
export function fmtPct(r) {
  if (r == null || !Number.isFinite(r)) return '—';
  return `${Math.round(r * 100)}%`;
}

/** De-duplicated recent pipeline runs → { failed, succeeded, passRate }. */
export function pipelineHealth(pipelineOverview) {
  const all = [...(pipelineOverview?.active || []), ...(pipelineOverview?.recent || [])];
  const seen = new Set();
  let failed = 0;
  let succeeded = 0;
  for (const r of all) {
    if (r == null || seen.has(r.id)) continue;
    seen.add(r.id);
    const res = String(r.result || '').toLowerCase();
    if (res === 'failed') failed += 1;
    else if (res === 'succeeded') succeeded += 1;
  }
  const done = failed + succeeded;
  return { failed, succeeded, passRate: done ? succeeded / done : null };
}

/**
 * Build the cross-area digest. Inputs (any may be null):
 *   prAnalytics      — GET /api/pr-analytics
 *   wiOverview       — GET /api/workitems/overview
 *   pipelineOverview — GET /api/pipelines/overview
 *   agentAnalytics   — GET /api/agents/analytics
 * Returns { stats: [{ key, label, display, sub }], highlights: string[] }.
 */
export function buildDigest({ prAnalytics, wiOverview, pipelineOverview, agentAnalytics } = {}) {
  const prMerged = prAnalytics?.totals?.merged ?? 0;
  const prOpen = prAnalytics?.totals?.open ?? 0;
  const cycleMedian = prAnalytics?.cycleTime?.medianHours ?? null;

  const wiOpen = wiOverview?.openCount ?? 0;
  const wiClosed = wiOverview?.completedCount ?? 0;

  const { failed, passRate } = pipelineHealth(pipelineOverview);

  const agentHours = agentAnalytics?.agentHours ?? 0;
  const agentSessions = agentAnalytics?.totalSessions ?? 0;

  const stats = [
    { key: 'prMerged', label: 'PRs merged', display: String(prMerged), sub: `${prOpen} open` },
    { key: 'cycle', label: 'Median PR cycle', display: fmtHours(cycleMedian), sub: 'merge time' },
    { key: 'wiClosed', label: 'Work items closed', display: String(wiClosed), sub: `${wiOpen} open` },
    { key: 'passRate', label: 'Pipeline pass rate', display: fmtPct(passRate), sub: `${failed} failing` },
    { key: 'agentHours', label: 'Agent hours', display: String(agentHours), sub: `${agentSessions} sessions` },
  ];

  const highlights = [];
  if (prMerged > 0) highlights.push(`${prMerged} pull request${prMerged === 1 ? '' : 's'} merged.`);
  if (wiClosed > 0) highlights.push(`${wiClosed} work item${wiClosed === 1 ? '' : 's'} closed.`);
  if (failed > 0) highlights.push(`${failed} pipeline run${failed === 1 ? '' : 's'} failing — worth a look.`);
  if (cycleMedian != null && cycleMedian > 0) highlights.push(`Median PR merge time is ${fmtHours(cycleMedian)}.`);
  if (agentHours > 0) highlights.push(`${agentHours} agent-hour${agentHours === 1 ? '' : 's'} across ${agentSessions} session${agentSessions === 1 ? '' : 's'}.`);
  if (highlights.length === 0) highlights.push('No cross-area activity to report yet.');

  return { stats, highlights, generatedAt: new Date().toISOString() };
}
