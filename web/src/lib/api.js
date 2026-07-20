const BASE = '/api';

async function req(path, { method = 'GET', body } = {}) {
  const init = { method, headers: { 'X-Requested-With': 'XMLHttpRequest' }, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg = (data && data.error) || res.statusText;
    const err = new Error(msg);
    err.status = res.status;
    err.code = data && data.code;
    err.details = data && data.details;
    // Let the app surface a re-paste prompt without losing the current view.
    if (res.status === 401 && err.code && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ado-auth-expired', { detail: { code: err.code } }));
    }
    throw err;
  }
  return data;
}

export const api = {
  // auth (token-paste sessions)
  me: () => req('/auth/me'),
  login: (token) => req('/auth/login', { method: 'POST', body: { token } }),
  pushToken: (token) => req('/auth/token', { method: 'POST', body: { token } }),
  logout: () => req('/auth/logout', { method: 'POST' }),

  // config (per-user)
  config: () => req('/config'),
  updateConfig: (patch) => req('/config', { method: 'PUT', body: patch }),
  projects: () => req('/projects'),
  repoResolve: (ref) => req(`/repos/resolve?ref=${encodeURIComponent(ref)}`),
  projectResolve: (ref) => req(`/projects/resolve?ref=${encodeURIComponent(ref)}`),
  resolveGroup: (alias) => req('/resolve-group', { method: 'POST', body: { alias } }),

  // data
  overview: (months) => req(`/overview${months ? `?months=${months}` : ''}`),
  summary: () => req('/summary'),
  actionCenter: (staleDays) => req(`/action-center${staleDays ? `?staleDays=${staleDays}` : ''}`),
  prAnalytics: (months) => req(`/pr-analytics${months ? `?months=${months}` : ''}`),
  standup: (sinceHours) => req(`/standup${sinceHours ? `?sinceHours=${sinceHours}` : ''}`),
  standupIcsUrl: (sinceHours) => `${BASE}/standup.ics${sinceHours ? `?sinceHours=${sinceHours}` : ''}`,

  // personal overlay: follow / snooze / dismiss (E3)
  userState: () => req('/user-state'),
  follows: () => req('/follows'),
  follow: (repo, id) => req('/follows', { method: 'POST', body: { repo, id } }),
  unfollow: (repo, id) => req(`/follows/${encodeURIComponent(repo)}/${id}`, { method: 'DELETE' }),
  snooze: (repo, id, hours) => req('/action-center/snooze', { method: 'POST', body: { repo, id, hours } }),
  unsnooze: (repo, id) => req(`/action-center/snooze/${encodeURIComponent(repo)}/${id}`, { method: 'DELETE' }),
  dismiss: (repo, id, sig) => req('/action-center/dismiss', { method: 'POST', body: { repo, id, sig } }),
  undismiss: (repo, id) => req(`/action-center/dismiss/${encodeURIComponent(repo)}/${id}`, { method: 'DELETE' }),
  created: (status) => req(`/prs/created${status ? `?status=${status}` : ''}`),
  assigned: (scope = 'me') => req(`/prs/assigned?scope=${scope}`),
  team: () => req('/prs/team'),
  detail: (repo, id) => req(`/prs/${encodeURIComponent(repo)}/${id}`),
  createPr: (body) => req('/prs', { method: 'POST', body }),
  linkWorkItem: (repo, id, workItemId) => req(`/prs/${encodeURIComponent(repo)}/${id}/workitems`, { method: 'POST', body: { workItemId } }),
  unlinkWorkItem: (repo, id, witId) => req(`/prs/${encodeURIComponent(repo)}/${id}/workitems/${witId}`, { method: 'DELETE' }),

  // work items (WI)
  wiList: (tab) => req(`/workitems/${tab}`),
  wiSprint: (scope) => req(`/workitems/sprint${scope ? `?scope=${scope}` : ''}`),
  wiOverview: () => req('/workitems/overview'),
  wiSummary: () => req('/workitems/summary'),
  wiTypes: () => req('/workitems/types'),
  wiRunQuery: (queryId) => req(`/workitems/queries/${encodeURIComponent(queryId)}/run`),
  wiResolveQuery: (ref) => req(`/workitems/queries/resolve?ref=${encodeURIComponent(ref)}`),
  wiDetail: (id) => req(`/workitems/${id}`),
  wiCreate: (body) => req('/workitems', { method: 'POST', body }),
  wiUpdate: (id, fields, rev) => req(`/workitems/${id}`, { method: 'PATCH', body: { fields, rev } }),
  wiAddComment: (id, text) => req(`/workitems/${id}/comments`, { method: 'POST', body: { text } }),
  wiAddLink: (id, targetId, rel) => req(`/workitems/${id}/links`, { method: 'POST', body: { targetId, rel } }),
  wiRemoveLink: (id, body) => req(`/workitems/${id}/links/remove`, { method: 'POST', body }),
  wiExportUrl: (tab) => `${BASE}/workitems/export.csv?tab=${encodeURIComponent(tab)}`,

  // actions
  merge: (repo, id, options) => req(`/prs/${encodeURIComponent(repo)}/${id}/merge`, { method: 'POST', body: options }),
  publish: (repo, id) => req(`/prs/${encodeURIComponent(repo)}/${id}/publish`, { method: 'POST' }),
  setAutoComplete: (repo, id, enable) => req(`/prs/${encodeURIComponent(repo)}/${id}/autocomplete`, { method: 'POST', body: { enable } }),
  requeue: (repo, id, evaluationId) => req(`/prs/${encodeURIComponent(repo)}/${id}/requeue`, { method: 'POST', body: { evaluationId } }),
  vote: (repo, id, vote) => req(`/prs/${encodeURIComponent(repo)}/${id}/vote`, { method: 'POST', body: { vote } }),
  refresh: () => req('/refresh', { method: 'POST' }),

  // reviewer management + lifecycle
  searchIdentities: (query) => req(`/identities?query=${encodeURIComponent(query)}`),
  addReviewer: (repo, id, reviewerId, isRequired) => req(`/prs/${encodeURIComponent(repo)}/${id}/reviewers`, { method: 'POST', body: { reviewerId, isRequired } }),
  setReviewerRequired: (repo, id, reviewerId, isRequired) => req(`/prs/${encodeURIComponent(repo)}/${id}/reviewers/${reviewerId}`, { method: 'PATCH', body: { isRequired } }),
  removeReviewer: (repo, id, reviewerId) => req(`/prs/${encodeURIComponent(repo)}/${id}/reviewers/${reviewerId}`, { method: 'DELETE' }),
  abandon: (repo, id) => req(`/prs/${encodeURIComponent(repo)}/${id}/abandon`, { method: 'POST' }),
  reactivate: (repo, id) => req(`/prs/${encodeURIComponent(repo)}/${id}/reactivate`, { method: 'POST' }),
  setDraft: (repo, id, isDraft) => req(`/prs/${encodeURIComponent(repo)}/${id}/draft`, { method: 'POST', body: { isDraft } }),

  // discussion threads (comment / reply / resolve)
  addComment: (repo, id, content) => req(`/prs/${encodeURIComponent(repo)}/${id}/threads`, { method: 'POST', body: { content } }),
  addInlineComment: (repo, id, filePath, line, content) => req(`/prs/${encodeURIComponent(repo)}/${id}/threads/inline`, { method: 'POST', body: { filePath, line, content } }),
  submitReview: (repo, id, comments) => req(`/prs/${encodeURIComponent(repo)}/${id}/threads/batch`, { method: 'POST', body: { comments } }),
  replyToThread: (repo, id, threadId, content, parentCommentId) => req(`/prs/${encodeURIComponent(repo)}/${id}/threads/${threadId}/comments`, { method: 'POST', body: { content, parentCommentId } }),
  setThreadStatus: (repo, id, threadId, status) => req(`/prs/${encodeURIComponent(repo)}/${id}/threads/${threadId}`, { method: 'PATCH', body: { status } }),

  // inline code diff (A1)
  prDiffFiles: (repo, id) => req(`/prs/${encodeURIComponent(repo)}/${id}/diff`),
  prFileDiff: (repo, id, path, changeType, originalPath) => req(`/prs/${encodeURIComponent(repo)}/${id}/diff?path=${encodeURIComponent(path)}${changeType ? `&changeType=${encodeURIComponent(changeType)}` : ''}${originalPath ? `&originalPath=${encodeURIComponent(originalPath)}` : ''}`),

  // pipelines
  pipelineDefs: (latest = true) => req(`/pipelines${latest ? '' : '?latest=false'}`),
  pipelineResolve: (ref) => req(`/pipelines/resolve?ref=${encodeURIComponent(ref)}`),
  pipelineOverview: (months) => req(`/pipelines/overview${months ? `?months=${months}` : ''}`),
  pipelineAnalytics: (definitionId, months) => req(`/pipelines/${definitionId}/analytics${months ? `?months=${months}` : ''}`),
  pipelineBranches: (repo, mine = true, filter = '') => req(`/pipelines/branches/${encodeURIComponent(repo)}?mine=${mine}${filter ? `&filter=${encodeURIComponent(filter)}` : ''}`),
  pipelineRuns: (definitionId, { months, status } = {}) => req(`/pipelines/${definitionId}/runs?${new URLSearchParams({ ...(months ? { months } : {}), ...(status ? { status } : {}) })}`),
  pipelineRunDetail: (buildId, project) => req(`/pipelines/runs/${buildId}${project ? `?project=${encodeURIComponent(project)}` : ''}`),
  pipelineRunLog: (buildId, logId, tail = 200, project) => req(`/pipelines/runs/${buildId}/logs/${logId}?tail=${tail}${project ? `&project=${encodeURIComponent(project)}` : ''}`),
  pipelineQueue: (definitionId, body) => req(`/pipelines/${definitionId}/queue`, { method: 'POST', body }),
  pipelineRetry: (buildId, project) => req(`/pipelines/runs/${buildId}/retry`, { method: 'POST', body: project ? { project } : undefined }),
  pipelineRetryFailed: (buildId, project) => req(`/pipelines/runs/${buildId}/retry-failed`, { method: 'POST', body: project ? { project } : undefined }),
  pipelineExportUrl: (definitionId, { months, status } = {}) => `${BASE}/pipelines/${definitionId}/export.csv?${new URLSearchParams({ ...(months ? { months } : {}), ...(status ? { status } : {}) })}`,

  // notifications
  notifications: (unreadOnly) => req(`/notifications${unreadOnly ? '?unreadOnly=true' : ''}`),
  poll: () => req('/notifications/poll', { method: 'POST' }),
  markRead: (ids) => req('/notifications/read', { method: 'POST', body: { ids } }),
  getPrefs: () => req('/notifications/preferences'),
  setPrefs: (prefs) => req('/notifications/preferences', { method: 'PUT', body: prefs }),

  exportUrl: (category, status) => `${BASE}/export.csv?category=${category}${status ? `&status=${status}` : ''}`,

  // Agent sessions (Copilot CLI visibility)
  agentSessions: () => req('/agents/sessions'),
  agentSessionsGrouped: () => req('/agents/sessions/grouped'),
  agentSummary: () => req('/agents/summary'),
  agentEnd: (id) => req(`/agents/sessions/${id}`, { method: 'DELETE' }),
  agentPrune: () => req('/agents/prune', { method: 'POST' }),
};
