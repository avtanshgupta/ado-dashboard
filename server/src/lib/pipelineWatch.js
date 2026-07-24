/**
 * Pipeline "watch" alerting (B4). Pure detection so it is unit-testable: given
 * the previous per-definition snapshot and the current pipeline definitions
 * (each with a `lastRun`), emit an alert when a *watched* pipeline has a NEW run
 * (different run id) whose result is a failure. The first observation of a
 * pipeline only baselines it (no alert), so enabling a watch never back-fires on
 * an already-failed run.
 */

/** True when a run result string represents a failure. */
function isFailure(result) {
  const r = String(result || '').toLowerCase();
  return r === 'failed' || r === 'canceled' || r === 'cancelled';
}

/**
 * @param prevSnap  { [definitionId]: { runId, result } } from the last poll
 * @param defs      [{ definitionId, name, webUrl, lastRun: { id, result, webUrl } }]
 * @param watched   Set|array of watched definitionIds
 * @returns { alerts: [{ definitionId, name, runId, result, webUrl }], snapshot }
 */
export function detectPipelineAlerts(prevSnap, defs, watched) {
  const watchedSet = watched instanceof Set ? watched : new Set((watched || []).map(Number));
  const prev = prevSnap && typeof prevSnap === 'object' ? prevSnap : {};
  const snapshot = {};
  const alerts = [];

  for (const def of defs || []) {
    const did = Number(def?.definitionId);
    if (!Number.isFinite(did) || !watchedSet.has(did)) continue;
    const run = def.lastRun;
    if (!run || run.id == null) continue;

    snapshot[did] = { runId: run.id, result: run.result };
    const before = prev[did];
    // Baseline the first time we see this pipeline — don't alert on history.
    if (!before) continue;
    if (run.id !== before.runId && isFailure(run.result)) {
      alerts.push({
        definitionId: did,
        name: def.name || `Pipeline ${did}`,
        runId: run.id,
        result: run.result,
        webUrl: run.webUrl || def.webUrl || '',
      });
    }
  }
  return { alerts, snapshot };
}
