import { config } from '../config.js';
import { currentConfig, currentUser } from '../lib/context.js';
import {
  adoGet,
  adoSend,
  buildApiUrl,
  buildWebUrl,
  definitionWebUrl,
  gitUrl,
  projectForDefinition,
} from '../lib/adoClient.js';

// Distinct projects to probe for builds/definitions: the monitored projects plus
// any project owning a tracked pipeline, plus the org default. Used to fan out
// build queries and to resolve a build's/definition's project by id.
function pipelineProjects() {
  const cfg = currentConfig();
  const set = new Set();
  for (const p of cfg?.projects || []) if (p.name) set.add(p.name);
  for (const p of cfg?.pipelines || []) if (p.project) set.add(p.project);
  set.add(cfg?.project || config.project);
  return [...set];
}

/**
 * Resolve which project owns a build id (needed because the Build API is
 * project-scoped but a run-detail URL only carries the build id). Tries the
 * optional hint first, then each distinct pipeline project. Returns the raw
 * build too so callers don't have to re-fetch it.
 */
async function resolveBuild(buildId, hint) {
  const projects = pipelineProjects();
  const ordered = hint && projects.includes(hint) ? [hint, ...projects.filter((p) => p !== hint)] : projects;
  let lastErr = null;
  for (const project of ordered) {
    try {
      const build = await adoGet(buildApiUrl(`builds/${buildId}`, project), { query: { 'api-version': '7.1' }, cache: false });
      return { project, build };
    } catch (err) {
      if (err?.status === 404) { lastErr = err; continue; }
      throw err;
    }
  }
  const e = new Error(`Build ${buildId} was not found in any tracked project.`);
  e.status = lastErr?.status || 404;
  throw e;
}

// ---- status mapping ----
// A build has status: none|inProgress|completed|cancelling|postponed|notStarted
// and (when completed) result: succeeded|partiallySucceeded|failed|canceled.
export function runStatus(build) {
  if (!build) return 'Unknown';
  if (build.status === 'inProgress') return 'Running';
  if (build.status === 'notStarted' || build.status === 'postponed') return 'Queued';
  if (build.status === 'cancelling') return 'Cancelling';
  if (build.status === 'completed') {
    return {
      succeeded: 'Succeeded',
      partiallySucceeded: 'Partial',
      failed: 'Failed',
      canceled: 'Canceled',
    }[build.result] || 'Completed';
  }
  return 'Queued';
}

const REASON_LABEL = {
  manual: 'Manual',
  pullRequest: 'Pull request',
  individualCI: 'CI',
  batchedCI: 'CI',
  schedule: 'Scheduled',
  buildCompletion: 'Chained',
  resourceTrigger: 'Resource',
};

function branchShort(ref) {
  if (!ref) return '';
  return ref.replace('refs/heads/', '').replace(/^refs\/pull\/(\d+)\/merge$/, 'PR #$1');
}

function durationMs(build) {
  const start = build.startTime ? new Date(build.startTime).getTime() : null;
  const end = build.finishTime ? new Date(build.finishTime).getTime() : (build.status === 'inProgress' ? Date.now() : null);
  if (start && end) return Math.max(0, end - start);
  return null;
}

/** Map a raw build into the dashboard run shape. */
export function mapRun(build) {
  const me = currentUser();
  const project = build.project?.name || null;
  return {
    id: build.id,
    buildNumber: build.buildNumber,
    definitionId: build.definition?.id,
    definitionName: build.definition?.name,
    repo: build.repository?.name || build.definition?.repository?.name || null,
    project,
    status: runStatus(build),
    rawStatus: build.status,
    result: build.result || null,
    reason: build.reason,
    reasonLabel: REASON_LABEL[build.reason] || build.reason,
    branch: branchShort(build.sourceBranch),
    sourceBranch: build.sourceBranch,
    sourceVersion: build.sourceVersion || null,
    queueTime: build.queueTime || null,
    startTime: build.startTime || null,
    finishTime: build.finishTime || null,
    durationMs: durationMs(build),
    requestedFor: build.requestedFor?.displayName || null,
    requestedForId: build.requestedFor?.id || null,
    mine: build.requestedFor?.id === me?.id,
    webUrl: buildWebUrl(build.id, project),
  };
}

// ---- definitions ----
async function fetchDefinition(definitionId, project) {
  return adoGet(buildApiUrl(`definitions/${definitionId}`, project), { query: { 'api-version': '7.1' } });
}

async function fetchLatestRun(definitionId, project) {
  const data = await adoGet(buildApiUrl('builds', project), {
    query: { definitions: definitionId, '$top': 1, queryOrder: 'queueTimeDescending', 'api-version': '7.1' },
  });
  return (data.value || [])[0] || null;
}

/** Configured pipelines with live metadata + last run. */
export async function listDefinitions({ withLatest = true } = {}) {
  const cfg = currentConfig();
  const pipelines = cfg.pipelines || [];
  return Promise.all(
    pipelines.map(async (pl) => {
      const project = pl.project || cfg.project;
      const [def, latest] = await Promise.all([
        fetchDefinition(pl.definitionId, project).catch(() => null),
        withLatest ? fetchLatestRun(pl.definitionId, project).catch(() => null) : Promise.resolve(null),
      ]);
      return {
        definitionId: pl.definitionId,
        repo: pl.repo || def?.repository?.name || null,
        project: def?.project?.name || project,
        name: def?.name || pl.name || `Pipeline ${pl.definitionId}`,
        label: pl.label || null,
        defaultBranch: def?.repository?.defaultBranch || null,
        queueStatus: def?.queueStatus || 'enabled',
        webUrl: definitionWebUrl(pl.definitionId, project),
        lastRun: latest ? mapRun(latest) : null,
      };
    })
  );
}

// ---- runs ----

/**
 * Resolve a pipeline definition from a plain id or an ADO build URL
 * (…/_build?definitionId=NNN). Returns id + name + repo + project for
 * auto-populating. A project in the URL is honored; a bare id is probed across
 * the tracked projects (build/definition ids are org-unique).
 */
export async function resolveDefinition(ref) {
  const raw = String(ref || '').trim();
  const m = raw.match(/definitionId=(\d+)/i);
  const id = m ? Number(m[1]) : null;
  if (!id) {
    const e = new Error('Paste a pipeline URL containing definitionId=NNN (adding by bare id is no longer supported).');
    e.status = 400;
    throw e;
  }
  // Prefer a project named in the URL, then fall back to probing tracked projects.
  const urlProject = parseProjectFromBuildUrl(raw);
  const candidates = urlProject ? [urlProject, ...pipelineProjects().filter((p) => p !== urlProject)] : pipelineProjects();
  let def = null;
  let project = null;
  for (const p of candidates) {
    const d = await fetchDefinition(id, p).catch(() => null);
    if (d && d.id) { def = d; project = d.project?.name || p; break; }
  }
  if (!def || !def.id) {
    const e = new Error(`Pipeline ${id} not found or not accessible.`);
    e.status = 404;
    throw e;
  }
  const cfg = currentConfig();
  if (cfg?.projectSet?.size && project && !cfg.projectSet.has(String(project).toLowerCase())) {
    const e = new Error(`Pipeline ${id} is in project “${project}”, which isn't one of your monitored projects. Add the project first.`);
    e.status = 400;
    throw e;
  }
  return {
    definitionId: def.id,
    name: def.name,
    repo: def.repository?.name || null,
    project,
    projectId: def.project?.id || '',
    defaultBranch: def.repository?.defaultBranch || null,
  };
}

// Extract the project segment from an ADO pipeline/build URL, if present.
function parseProjectFromBuildUrl(raw) {
  try {
    const u = new URL(raw);
    const seg = u.pathname.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
    const bi = seg.indexOf('_build');
    if (bi >= 1) return seg[bi - 1];
  } catch {
    /* not a URL */
  }
  return null;
}

function timeWindowQuery(months) {  const m = Number(months);
  if (!m || m <= 0) return {};
  const d = new Date();
  d.setMonth(d.getMonth() - m);
  return { minTime: d.toISOString() };
}

/** Runs across configured pipelines requested by the current user (overview). */
export async function myActiveRuns({ months } = {}) {
  const cfg = currentConfig();
  const me = currentUser();
  const pipelines = cfg.pipelines || [];
  if (!pipelines.length) return { active: [], recent: [] };

  // Builds are project-scoped, so group definitions by their project and query
  // each project, then merge — this is what lets runs from every project share
  // one list.
  const byProject = new Map();
  for (const p of pipelines) {
    const proj = p.project || cfg.project;
    if (!byProject.has(proj)) byProject.set(proj, []);
    byProject.get(proj).push(p.definitionId);
  }

  const win = timeWindowQuery(months);
  const perProject = await Promise.all(
    [...byProject.entries()].map(async ([project, ids]) => {
      const defIds = ids.join(',');
      const [inProgress, recentMine] = await Promise.all([
        adoGet(buildApiUrl('builds', project), {
          query: { definitions: defIds, statusFilter: 'inProgress,notStarted', '$top': 100, queryOrder: 'queueTimeDescending', 'api-version': '7.1' },
        }).catch(() => ({ value: [] })),
        adoGet(buildApiUrl('builds', project), {
          query: { definitions: defIds, requestedFor: me.id, '$top': 50, queryOrder: 'queueTimeDescending', 'api-version': '7.1', ...win },
        }).catch(() => ({ value: [] })),
      ]);
      return { inProgress: inProgress.value || [], recentMine: recentMine.value || [] };
    })
  );

  const allInProgress = perProject.flatMap((r) => r.inProgress);
  const allRecent = perProject.flatMap((r) => r.recentMine);

  const active = allInProgress
    .filter((b) => b.requestedFor?.id === me.id)
    .map(mapRun)
    .sort((a, b) => new Date(b.queueTime || 0) - new Date(a.queueTime || 0));
  const activeIds = new Set(active.map((r) => r.id));
  const recent = allRecent
    .map(mapRun)
    .filter((r) => !activeIds.has(r.id))
    .sort((a, b) => new Date(b.queueTime || 0) - new Date(a.queueTime || 0))
    .slice(0, 25);
  return { active, recent };
}

/** Paged runs for a single pipeline definition, requested by the current user. */
export async function listRuns({ definitionId, months, status, mine = true } = {}) {
  const me = currentUser();
  const project = projectForDefinition(definitionId);
  const win = timeWindowQuery(months);
  const query = {
    definitions: definitionId,
    '$top': 200,
    queryOrder: 'queueTimeDescending',
    'api-version': '7.1',
    ...win,
  };
  // Default to only my runs (runs I requested — manual + PR-triggered by me).
  if (mine && me?.id) query.requestedFor = me.id;
  if (status && status !== 'all') {
    // status: inProgress | completed | notStarted etc.
    query.statusFilter = status;
  }
  const data = await adoGet(buildApiUrl('builds', project), { query });
  return (data.value || []).map(mapRun);
}

// ---- analytics ----
function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function isoWeekKey(dateStr) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  // Group by the week's Monday (local) — good enough for a trend view.
  const day = (d.getDay() + 6) % 7; // 0 = Monday
  const monday = new Date(d);
  monday.setDate(d.getDate() - day);
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

/**
 * Aggregate analytics for one pipeline over a time window: status breakdown,
 * success rate, mean/median duration, a weekly pass/fail trend, and flaky
 * detection (the same commit producing both a success and a failure).
 * Scoped to the current user's OWN runs of the pipeline (runs they requested —
 * manual + PR-triggered by them) so analytics never reflect everyone's activity.
 */
export async function pipelineAnalytics({ definitionId, months } = {}) {
  if (!definitionId) {
    const e = new Error('definitionId is required'); e.status = 400; throw e;
  }
  const runs = await listRuns({ definitionId, months, mine: true });

  const byStatus = {};
  for (const r of runs) byStatus[r.status] = (byStatus[r.status] || 0) + 1;

  const succeeded = byStatus.Succeeded || 0;
  const failed = byStatus.Failed || 0;
  const partial = byStatus.Partial || 0;
  const terminal = succeeded + failed;
  const successRate = terminal ? Math.round((100 * succeeded) / terminal) : null;

  const durations = runs
    .filter((r) => (r.status === 'Succeeded' || r.status === 'Failed' || r.status === 'Partial') && r.durationMs != null)
    .map((r) => r.durationMs);
  const meanDurationMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;
  const medianDurationMs = median(durations);

  // Weekly trend (ascending by week).
  const weeks = new Map();
  for (const r of runs) {
    const k = isoWeekKey(r.queueTime || r.startTime);
    if (!k) continue;
    if (!weeks.has(k)) weeks.set(k, { period: k, success: 0, fail: 0, other: 0, total: 0 });
    const w = weeks.get(k);
    w.total += 1;
    if (r.status === 'Succeeded') w.success += 1;
    else if (r.status === 'Failed') w.fail += 1;
    else w.other += 1;
  }
  const trend = [...weeks.values()]
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((w) => ({ ...w, rate: w.success + w.fail ? Math.round((100 * w.success) / (w.success + w.fail)) : null }));

  // Flaky = a single commit (sourceVersion) that both succeeded and failed.
  const byCommit = new Map();
  for (const r of runs) {
    if (!r.sourceVersion) continue;
    if (!byCommit.has(r.sourceVersion)) byCommit.set(r.sourceVersion, { commit: r.sourceVersion, branch: r.branch, pass: 0, fail: 0, runs: [] });
    const c = byCommit.get(r.sourceVersion);
    if (r.status === 'Succeeded') c.pass += 1;
    else if (r.status === 'Failed') c.fail += 1;
    if (c.runs.length < 6) c.runs.push({ id: r.id, status: r.status });
  }
  const flaky = [...byCommit.values()]
    .filter((c) => c.pass > 0 && c.fail > 0)
    .map((c) => ({ commit: c.commit.slice(0, 8), branch: c.branch, pass: c.pass, fail: c.fail, runs: c.runs }))
    .slice(0, 20);

  return {
    definitionId: Number(definitionId),
    total: runs.length,
    byStatus,
    successRate,
    sampleSize: terminal,
    partial,
    meanDurationMs,
    medianDurationMs,
    trend,
    flaky,
    flakyCount: flaky.length,
  };
}

// ---- branches (for triggering) ----
export async function listBranches({ repo, filter, mineOnly = false } = {}) {
  const me = currentUser();
  const q = { 'api-version': '7.1', '$top': 200 };
  // "user/<alias>/" is the convention for personal branches here.
  const alias = (me.uniqueName || '').split('@')[0];
  if (mineOnly && alias) q.filter = `heads/user/${alias}`;
  else if (filter) q.filter = `heads/${filter}`;
  else q.filter = 'heads/';
  const data = await adoGet(gitUrl(repo, 'refs'), { query: q, cache: false });
  return (data.value || [])
    .map((r) => r.name.replace('refs/heads/', ''))
    .sort();
}

// ---- run detail (timeline: stages / jobs / steps) ----
function mapRecord(r) {
  return {
    id: r.id,
    parentId: r.parentId || null,
    identifier: r.identifier || null, // stage refName (used to retry a stage)
    type: r.type, // Stage | Phase | Job | Task | Checkpoint
    name: r.name,
    order: r.order ?? 0,
    state: r.state, // pending | inProgress | completed
    result: r.result || null, // succeeded | failed | skipped | canceled | abandoned | ...
    startTime: r.startTime || null,
    finishTime: r.finishTime || null,
    durationMs:
      r.startTime && r.finishTime
        ? Math.max(0, new Date(r.finishTime).getTime() - new Date(r.startTime).getTime())
        : null,
    errorCount: r.errorCount || 0,
    warningCount: r.warningCount || 0,
    log: r.log?.id || null,
    workerName: r.workerName || null,
  };
}

export async function getRunDetail(buildId, projectHint) {
  const { project, build } = await resolveBuild(buildId, projectHint);
  const timeline = await adoGet(buildApiUrl(`builds/${buildId}/timeline`, project), { query: { 'api-version': '7.1' }, cache: false }).catch(() => ({ records: [] }));
  const run = mapRun(build);

  const records = (timeline.records || []).map(mapRecord);
  const byId = new Map(records.map((r) => [r.id, r]));
  // Build the stage → job → task tree.
  const stages = records.filter((r) => r.type === 'Stage').sort((a, b) => a.order - b.order);
  const childrenOf = (pid) => records.filter((r) => r.parentId === pid).sort((a, b) => a.order - b.order);

  const tree = stages.map((stage) => {
    // A stage's phases contain jobs; collapse phase→job to just jobs.
    const phases = childrenOf(stage.id).filter((r) => r.type === 'Phase');
    const jobs = phases.flatMap((ph) => childrenOf(ph.id).filter((r) => r.type === 'Job'));
    // Also handle stages whose direct children are jobs (no phase records surfaced).
    const directJobs = childrenOf(stage.id).filter((r) => r.type === 'Job');
    const allJobs = [...jobs, ...directJobs];
    return {
      ...stage,
      jobs: allJobs.map((job) => ({
        ...job,
        tasks: childrenOf(job.id).filter((r) => r.type === 'Task'),
      })),
    };
  });

  // Failed leaf records (tasks) + their owning stage/job, for a quick "what failed" view.
  const failed = records
    .filter((r) => r.result === 'failed' && (r.type === 'Task' || r.type === 'Job'))
    .map((r) => {
      // Walk up to the owning stage.
      let cur = r;
      let stageName = null;
      let jobName = r.type === 'Job' ? r.name : null;
      while (cur?.parentId && byId.has(cur.parentId)) {
        cur = byId.get(cur.parentId);
        if (cur.type === 'Job' && !jobName) jobName = cur.name;
        if (cur.type === 'Stage') { stageName = cur.name; break; }
      }
      return {
        id: r.id,
        type: r.type,
        name: r.name,
        stage: stageName,
        job: jobName,
        errorCount: r.errorCount,
        log: r.log,
        startTime: r.startTime,
        finishTime: r.finishTime,
      };
    });

  // Stages that failed (or were canceled) — retryable targets.
  const failedStages = stages
    .filter((s) => s.result === 'failed' || s.result === 'canceled')
    .map((s) => ({ id: s.id, identifier: s.identifier, name: s.name, result: s.result }));

  const isRunning = build.status === 'inProgress' || build.status === 'notStarted' || build.status === 'postponed';

  return {
    run,
    stages: tree,
    failed,
    failedStages,
    hasTimeline: records.length > 0,
    isRunning,
    canRerun: !isRunning,
    canRerunFailed: !isRunning && failedStages.some((s) => s.identifier),
  };
}

/** Fetch a specific timeline record's log tail (for failed-step inspection). */
export async function getRecordLog(buildId, logId, { tailLines = 200, projectHint } = {}) {
  const project = projectHint && pipelineProjects().includes(projectHint)
    ? projectHint
    : (await resolveBuild(buildId, projectHint)).project;
  const url = buildApiUrl(`builds/${buildId}/logs/${logId}`, project);
  const data = await adoGet(url, { query: { 'api-version': '7.1' }, cache: false });
  // Log endpoint returns { value: [lines], count } or raw text depending on Accept.
  let lines = [];
  if (Array.isArray(data?.value)) lines = data.value;
  else if (typeof data === 'string') lines = data.split('\n');
  return { lines: lines.slice(-tailLines), total: lines.length };
}

// ---- trigger / rerun ----
export async function queueRun({ definitionId, branch, parameters } = {}) {
  if (!definitionId) {
    const e = new Error('definitionId is required'); e.status = 400; throw e;
  }
  const project = projectForDefinition(definitionId);
  const sourceBranch = branch
    ? (branch.startsWith('refs/') ? branch : `refs/heads/${branch}`)
    : undefined;
  const body = {
    definition: { id: Number(definitionId) },
    ...(sourceBranch ? { sourceBranch } : {}),
    ...(parameters && Object.keys(parameters).length ? { parameters: JSON.stringify(parameters) } : {}),
  };
  const build = await adoSend('POST', buildApiUrl('builds', project), body, { query: { 'api-version': '7.1' } });
  return mapRun(build);
}

function assertNotRunning(build, action) {
  if (build.status === 'inProgress' || build.status === 'notStarted' || build.status === 'postponed') {
    const e = new Error(`This run is still ${build.status === 'inProgress' ? 'running' : 'queued'} — ${action} is only available once it completes.`);
    e.status = 409;
    throw e;
  }
}

/** Re-run a build (queue a new run on the same definition + branch). */
export async function retryRun(buildId, projectHint) {
  const { build } = await resolveBuild(buildId, projectHint);
  assertNotRunning(build, 're-run');
  return queueRun({ definitionId: build.definition?.id, branch: build.sourceBranch });
}

/**
 * Re-run only the failed (or canceled) stages of a completed build, in place.
 * Uses the Build Stage Update API: PATCH .../stages/{refName} { state: 'retry' }.
 */
export async function retryFailedStages(buildId, projectHint) {
  const { project, build } = await resolveBuild(buildId, projectHint);
  const timeline = await adoGet(buildApiUrl(`builds/${buildId}/timeline`, project), { query: { 'api-version': '7.1' }, cache: false }).catch(() => ({ records: [] }));
  assertNotRunning(build, 're-run failed stages');

  const failedStages = (timeline.records || [])
    .filter((r) => r.type === 'Stage' && (r.result === 'failed' || r.result === 'canceled') && r.identifier);
  if (failedStages.length === 0) {
    const e = new Error('No failed stages to re-run on this build.');
    e.status = 409;
    throw e;
  }

  const results = [];
  for (const stage of failedStages) {
    try {
      await adoSend(
        'PATCH',
        buildApiUrl(`builds/${buildId}/stages/${encodeURIComponent(stage.identifier)}`, project),
        { state: 'retry', forceRetryAllJobs: false },
        { query: { 'api-version': '7.1-preview.1' } }
      );
      results.push({ stage: stage.name, ok: true });
    } catch (err) {
      results.push({ stage: stage.name, ok: false, error: err.message });
    }
  }
  const retried = results.filter((r) => r.ok).length;
  if (retried === 0) {
    const e = new Error(`Could not re-run any failed stage (${results[0]?.error || 'permission denied'}).`);
    e.status = 502;
    throw e;
  }
  return { buildId: Number(buildId), retried, stages: results };
}
