import { Router } from 'express';
import { config } from '../config.js';
import { currentUser, currentConfig } from '../lib/context.js';
import { clearCache } from '../lib/adoClient.js';
import { saveUserConfig, effectiveConfig } from '../lib/userConfig.js';
import {
  listCreated,
  listAssigned,
  listTeam,
  getOverview,
  getProjectSummary,
  getPrDetail,
  getActionCenter,
  getPrAnalytics,
  getStandup,
  getFollowedPrs,
} from '../services/prService.js';
import { mergePr, publishPr, setAutoComplete, requeuePipeline, setVote, addReviewer, removeReviewer, setReviewerRequired, abandonPr, reactivatePr, setDraft, addThreadComment, setThreadStatus, createThread, createInlineThread, createPr, linkWorkItem, unlinkWorkItem } from '../services/actionsService.js';
import { poll, getNotifications, markRead } from '../services/notificationsService.js';
import { sseHandler } from '../services/streamService.js';
import { standupMarkdown, standupIcs } from '../lib/standup.js';
import { testWebhook } from '../services/chatService.js';
import { getState, addFollow, removeFollow, setSnooze, clearSnooze, setDismiss, clearDismiss } from '../lib/userState.js';
import { resolveGroup, searchIdentities } from '../services/identityService.js';
import { resolveRepoLink } from '../services/projectService.js';
import { getPrDiffFiles, getPrFileDiff } from '../services/diffService.js';
import {
  listDefinitions,
  resolveDefinition,
  myActiveRuns,
  listRuns,
  listBranches,
  getRunDetail,
  getRecordLog,
  queueRun,
  retryRun,
  retryFailedStages,
  pipelineAnalytics,
} from '../services/pipelineService.js';

const router = Router();

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    const status = err.status || 500;
    console.error(`[api] ${req.method} ${req.originalUrl} -> ${status}: ${err.message}`);
    res.status(status).json({ error: err.message, status, details: err.body || undefined });
  });

function buildConfigResponse(cfg) {
  return {
    me: cfg.me,
    organizationUrl: cfg.organizationUrl,
    project: cfg.project,
    repositories: cfg.repositories,
    repoProjects: cfg.repoProjects,
    team: cfg.team,
    reviewerGroups: cfg.reviewerGroups,
    defaultTimeRangeMonths: cfg.defaultTimeRangeMonths,
    pipelines: cfg.pipelines,
    notificationPrefs: cfg.notificationPrefs,
    commentTemplates: cfg.commentTemplates,
    savedViews: cfg.savedViews,
    chatWebhooks: cfg.chatWebhooks,
    mutedRepos: cfg.mutedRepos,
    uiPrefs: cfg.uiPrefs,
    slaDays: cfg.slaDays,
    emailEnabled: config.email.enabled,
    defaults: config.defaults,
  };
}

router.get('/config', wrap(async (_req, res) => res.json(buildConfigResponse(currentConfig()))));

// Resolve a repo URL (or plain name) → verified { repo, project, projectId, … }
// so a user can add a repo by pasting its link and start tracking it.
router.get('/repos/resolve', wrap(async (req, res) => res.json(await resolveRepoLink(req.query.ref))));

router.put(
  '/config',
  wrap(async (req, res) => {
    saveUserConfig(currentUser().id, req.body || {});
    clearCache();
    res.json(buildConfigResponse(effectiveConfig(currentUser())));
  })
);

router.post(
  '/resolve-group',
  wrap(async (req, res) => res.json(await resolveGroup((req.body || {}).alias)))
);

router.get('/overview', wrap(async (req, res) => res.json(await getOverview({ months: req.query.months }))));
router.get('/summary', wrap(async (_req, res) => res.json(await getProjectSummary())));
router.get('/action-center', wrap(async (req, res) => res.json(await getActionCenter({ staleDays: req.query.staleDays }))));

// ---- personal overlay: follow / snooze / dismiss (E3) ----
router.get('/user-state', wrap(async (_req, res) => res.json(getState())));
router.get('/follows', wrap(async (_req, res) => res.json(await getFollowedPrs())));
router.post('/follows', wrap(async (req, res) => {
  const { repo, id } = req.body || {};
  if (!repo || !id) { const e = new Error('repo and id are required'); e.status = 400; throw e; }
  res.json(addFollow(repo, id));
}));
router.delete('/follows/:repo/:id', wrap(async (req, res) => res.json(removeFollow(req.params.repo, req.params.id))));
router.post('/action-center/snooze', wrap(async (req, res) => {
  const { repo, id, hours } = req.body || {};
  if (!repo || !id) { const e = new Error('repo and id are required'); e.status = 400; throw e; }
  const h = Number(hours) > 0 ? Number(hours) : 24;
  res.json(setSnooze(repo, id, new Date(Date.now() + h * 3600 * 1000).toISOString()));
}));
router.delete('/action-center/snooze/:repo/:id', wrap(async (req, res) => res.json(clearSnooze(req.params.repo, req.params.id))));
router.post('/action-center/dismiss', wrap(async (req, res) => {
  const { repo, id, sig } = req.body || {};
  if (!repo || !id) { const e = new Error('repo and id are required'); e.status = 400; throw e; }
  res.json(setDismiss(repo, id, sig));
}));
router.delete('/action-center/dismiss/:repo/:id', wrap(async (req, res) => res.json(clearDismiss(req.params.repo, req.params.id))));
router.get('/pr-analytics', wrap(async (req, res) => res.json(await getPrAnalytics({ months: req.query.months }))));

// ---- stand-up summary (D2) ----
router.get('/standup', wrap(async (req, res) => {
  const s = await getStandup({ sinceHours: req.query.sinceHours });
  res.json({ ...s, markdown: standupMarkdown(s) });
}));
router.get('/standup.ics', wrap(async (req, res) => {
  const s = await getStandup({ sinceHours: req.query.sinceHours });
  res.setHeader('Content-Type', 'text/calendar');
  res.setHeader('Content-Disposition', `attachment; filename="pr-standup-${new Date().toISOString().slice(0, 10)}.ics"`);
  res.send(standupIcs(s));
}));

// ---- chat webhook test (D1) ----
router.post('/webhooks/test', wrap(async (req, res) => {
  const { url, type } = req.body || {};
  if (!url || !/^https:\/\//i.test(url)) { const e = new Error('An https webhook URL is required.'); e.status = 400; throw e; }
  await testWebhook({ url, type });
  res.json({ ok: true });
}));

router.get('/prs/created', wrap(async (req, res) => res.json(await listCreated({ status: req.query.status }))));
router.get('/prs/assigned', wrap(async (req, res) => res.json(await listAssigned({ scope: req.query.scope === 'team' ? 'team' : 'me' }))));
router.get('/prs/team', wrap(async (_req, res) => res.json(await listTeam())));

// ---- create PR (F1) ----
router.post('/prs', wrap(async (req, res) => {
  const { repo, sourceBranch, targetBranch, title, description, isDraft, reviewerIds } = req.body || {};
  if (!repo) { const e = new Error('repo is required'); e.status = 400; throw e; }
  res.json(await createPr(repo, { sourceBranch, targetBranch, title, description, isDraft, reviewerIds }));
}));

router.get('/prs/:repo/:id', wrap(async (req, res) => res.json(await getPrDetail(req.params.repo, req.params.id))));

// ---- inline code diff (A1) ----
router.get('/prs/:repo/:id/diff', wrap(async (req, res) => {
  if (req.query.path) res.json(await getPrFileDiff(req.params.repo, req.params.id, req.query.path, { changeType: req.query.changeType, originalPath: req.query.originalPath }));
  else res.json(await getPrDiffFiles(req.params.repo, req.params.id));
}));

router.post(
  '/prs/:repo/:id/merge',
  wrap(async (req, res) => res.json(await mergePr(req.params.repo, req.params.id, req.body || {})))
);

router.post(
  '/prs/:repo/:id/publish',
  wrap(async (req, res) => res.json(await publishPr(req.params.repo, req.params.id)))
);

router.post(
  '/prs/:repo/:id/autocomplete',
  wrap(async (req, res) => {
    const enable = (req.body || {}).enable !== false;
    res.json(await setAutoComplete(req.params.repo, req.params.id, currentUser().id, enable));
  })
);

router.post(
  '/prs/:repo/:id/requeue',
  wrap(async (req, res) => {
    const { evaluationId } = req.body || {};
    if (!evaluationId) {
      const e = new Error('evaluationId is required');
      e.status = 400;
      throw e;
    }
    res.json(await requeuePipeline(req.params.repo, req.params.id, evaluationId));
  })
);

router.post(
  '/prs/:repo/:id/vote',
  wrap(async (req, res) => {
    const { vote } = req.body || {};
    res.json(await setVote(req.params.repo, req.params.id, currentUser().id, vote));
  })
);

// ---- reviewer management ----
router.get('/identities', wrap(async (req, res) => res.json(await searchIdentities(req.query.query))));
router.post(
  '/prs/:repo/:id/reviewers',
  wrap(async (req, res) => {
    const { reviewerId, isRequired } = req.body || {};
    res.json(await addReviewer(req.params.repo, req.params.id, reviewerId, isRequired));
  })
);
router.patch(
  '/prs/:repo/:id/reviewers/:reviewerId',
  wrap(async (req, res) => {
    const { isRequired } = req.body || {};
    res.json(await setReviewerRequired(req.params.repo, req.params.id, req.params.reviewerId, isRequired));
  })
);
router.delete(
  '/prs/:repo/:id/reviewers/:reviewerId',
  wrap(async (req, res) => res.json(await removeReviewer(req.params.repo, req.params.id, req.params.reviewerId)))
);

// ---- lifecycle (abandon / reactivate / draft) ----
router.post('/prs/:repo/:id/abandon', wrap(async (req, res) => res.json(await abandonPr(req.params.repo, req.params.id))));
router.post('/prs/:repo/:id/reactivate', wrap(async (req, res) => res.json(await reactivatePr(req.params.repo, req.params.id))));
router.post(
  '/prs/:repo/:id/draft',
  wrap(async (req, res) => {
    const isDraft = (req.body || {}).isDraft !== false;
    res.json(await setDraft(req.params.repo, req.params.id, isDraft));
  })
);

// ---- discussion threads (comment / reply / resolve) ----
router.post(
  '/prs/:repo/:id/threads',
  wrap(async (req, res) => res.json(await createThread(req.params.repo, req.params.id, (req.body || {}).content)))
);
// Inline (file/line-anchored) comment — one at a time, or batched via /threads/batch.
router.post(
  '/prs/:repo/:id/threads/inline',
  wrap(async (req, res) => {
    const { filePath, line, content } = req.body || {};
    res.json(await createInlineThread(req.params.repo, req.params.id, { filePath, line, content }));
  })
);
// Batched "start a review" (A3): submit many staged comments in one call. Each
// item is a general or inline comment; results report per-item success/failure.
router.post(
  '/prs/:repo/:id/threads/batch',
  wrap(async (req, res) => {
    const comments = Array.isArray((req.body || {}).comments) ? req.body.comments : [];
    if (!comments.length) { const e = new Error('comments[] is required'); e.status = 400; throw e; }
    if (comments.length > 100) { const e = new Error('Too many comments in one batch (max 100).'); e.status = 400; throw e; }
    const results = [];
    for (const c of comments) {
      try {
        const created = c.filePath
          ? await createInlineThread(req.params.repo, req.params.id, { filePath: c.filePath, line: c.line, content: c.content })
          : await createThread(req.params.repo, req.params.id, c.content);
        results.push({ ok: true, threadId: created.id, filePath: c.filePath || null, line: c.line || null });
      } catch (err) {
        results.push({ ok: false, error: err.message, filePath: c.filePath || null, line: c.line || null });
      }
    }
    res.json({ posted: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results });
  })
);
router.post(
  '/prs/:repo/:id/threads/:threadId/comments',
  wrap(async (req, res) => {
    const { content, parentCommentId } = req.body || {};
    res.json(await addThreadComment(req.params.repo, req.params.id, req.params.threadId, content, parentCommentId));
  })
);
router.patch(
  '/prs/:repo/:id/threads/:threadId',
  wrap(async (req, res) => res.json(await setThreadStatus(req.params.repo, req.params.id, req.params.threadId, (req.body || {}).status)))
);

// ---- work item linking (F3) ----
router.post('/prs/:repo/:id/workitems', wrap(async (req, res) => {
  const { workItemId } = req.body || {};
  res.json(await linkWorkItem(req.params.repo, req.params.id, workItemId));
}));
router.delete('/prs/:repo/:id/workitems/:witId', wrap(async (req, res) =>
  res.json(await unlinkWorkItem(req.params.repo, req.params.id, req.params.witId))
));

// ---- pipelines ----
router.get('/pipelines', wrap(async (req, res) => res.json(await listDefinitions({ withLatest: req.query.latest !== 'false' }))));
router.get('/pipelines/resolve', wrap(async (req, res) => res.json(await resolveDefinition(req.query.ref))));
router.get('/pipelines/overview', wrap(async (req, res) => res.json(await myActiveRuns({ months: req.query.months }))));
router.get('/pipelines/:definitionId/analytics', wrap(async (req, res) => res.json(await pipelineAnalytics({ definitionId: req.params.definitionId, months: req.query.months }))));
router.get('/pipelines/branches/:repo', wrap(async (req, res) => res.json(await listBranches({ repo: req.params.repo, filter: req.query.filter, mineOnly: req.query.mine === 'true' }))));
router.get('/pipelines/runs/:buildId', wrap(async (req, res) => res.json(await getRunDetail(req.params.buildId, req.query.project))));
router.get('/pipelines/runs/:buildId/logs/:logId', wrap(async (req, res) => res.json(await getRecordLog(req.params.buildId, req.params.logId, { tailLines: Number(req.query.tail) || 200, projectHint: req.query.project }))));
router.get('/pipelines/:definitionId/runs', wrap(async (req, res) => res.json(await listRuns({ definitionId: req.params.definitionId, months: req.query.months, status: req.query.status }))));
router.post('/pipelines/:definitionId/queue', wrap(async (req, res) => {
  const { branch, parameters } = req.body || {};
  res.json(await queueRun({ definitionId: req.params.definitionId, branch, parameters }));
}));
router.post('/pipelines/runs/:buildId/retry', wrap(async (req, res) => res.json(await retryRun(req.params.buildId, (req.body || {}).project))));
router.post('/pipelines/runs/:buildId/retry-failed', wrap(async (req, res) => res.json(await retryFailedStages(req.params.buildId, (req.body || {}).project))));

// ---- pipeline runs CSV export ----
router.get('/pipelines/:definitionId/export.csv', wrap(async (req, res) => {
  const runs = await listRuns({ definitionId: req.params.definitionId, months: req.query.months, status: req.query.status });
  const cols = ['id', 'buildNumber', 'definitionName', 'repo', 'status', 'result', 'reasonLabel', 'branch', 'requestedFor', 'queueTime', 'startTime', 'finishTime', 'durationMs', 'webUrl'];
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = runs.map((r) => cols.map((c) => esc(r[c])).join(','));
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="pipeline-${req.params.definitionId}-runs-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send([cols.join(','), ...rows].join('\n'));
}));

// ---- notifications ----
router.get('/stream', sseHandler); // C1 — Server-Sent Events live updates
router.get('/notifications', wrap(async (req, res) => res.json(getNotifications({ unreadOnly: req.query.unreadOnly === 'true' }))));
router.post('/notifications/poll', wrap(async (_req, res) => res.json(await poll())));
router.post('/notifications/read', wrap(async (req, res) => res.json(markRead((req.body && req.body.ids) || []))));
router.get('/notifications/preferences', wrap(async (_req, res) => res.json(currentConfig().notificationPrefs)));
router.put(
  '/notifications/preferences',
  wrap(async (req, res) => {
    const updated = saveUserConfig(currentUser().id, { notificationPrefs: req.body || {} });
    res.json(updated.notificationPrefs);
  })
);

// ---- utility ----
router.post('/refresh', wrap(async (_req, res) => {
  clearCache();
  res.json({ ok: true });
}));

// ---- CSV export ----
router.get(
  '/export.csv',
  wrap(async (req, res) => {
    const category = req.query.category || 'created';
    const data =
      category === 'assigned'
        ? await listAssigned({ scope: 'me' })
        : category === 'assignedTeam'
        ? await listAssigned({ scope: 'team' })
        : category === 'team'
        ? await listTeam()
        : await listCreated({ status: req.query.status });
    const csv = toCsv(data);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="ado-prs-${category}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  })
);

function toCsv(prs) {
  const cols = ['id', 'repo', 'title', 'state', 'reviewStatus', 'activeComments', 'pipeline', 'pop', 'labels', 'canMerge', 'commitCount', 'fileCount', 'author', 'creationDate', 'lastActivity', 'webUrl'];
  const escape = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = prs.map((p) =>
    [p.id, p.repo, p.title, p.state, p.reviewStatus, p.activeComments ?? '', p.pipeline?.overall ?? '', p.pop?.label ?? '', (p.labels || []).join('; '), p.canMerge ? 'yes' : 'no', p.commitCount ?? '', p.fileCount ?? '', p.createdBy?.displayName ?? '', p.creationDate, p.lastActivity ?? '', p.webUrl]
      .map(escape)
      .join(',')
  );
  return [cols.join(','), ...rows].join('\n');
}

export default router;
