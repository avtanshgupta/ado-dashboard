// Pure shaping for Azure DevOps work items. No I/O — turns raw work-item field
// bags (from the WIT batch/get APIs) into the summary + detail shapes the API
// exposes, and parses relations (parent/child/related + linked PRs). Kept pure
// so the mapping is deterministic and unit-testable.

const F = {
  type: 'System.WorkItemType',
  title: 'System.Title',
  state: 'System.State',
  reason: 'System.Reason',
  assignedTo: 'System.AssignedTo',
  createdBy: 'System.CreatedBy',
  changedBy: 'System.ChangedBy',
  createdDate: 'System.CreatedDate',
  changedDate: 'System.ChangedDate',
  areaPath: 'System.AreaPath',
  iterationPath: 'System.IterationPath',
  teamProject: 'System.TeamProject',
  tags: 'System.Tags',
  priority: 'Microsoft.VSTS.Common.Priority',
  severity: 'Microsoft.VSTS.Common.Severity',
  storyPoints: 'Microsoft.VSTS.Scheduling.StoryPoints',
  effort: 'Microsoft.VSTS.Scheduling.Effort',
  description: 'System.Description',
  reproSteps: 'Microsoft.VSTS.TCM.ReproSteps',
  systemInfo: 'Microsoft.VSTS.TCM.SystemInfo',
  acceptanceCriteria: 'Microsoft.VSTS.Common.AcceptanceCriteria',
  boardColumn: 'System.BoardColumn',
};

const DAY_MS = 86400000;

/** Normalize an ADO identity ref into a compact { displayName, uniqueName, imageUrl }. */
export function shapeIdentity(v) {
  if (!v) return null;
  if (typeof v === 'string') return { displayName: v, uniqueName: v, imageUrl: null };
  return {
    displayName: v.displayName || v.uniqueName || 'Unknown',
    uniqueName: v.uniqueName || v.displayName || '',
    imageUrl: v._links?.avatar?.href || v.imageUrl || null,
  };
}

/** Split System.Tags ("a; b; c") into a trimmed, non-empty array. */
export function parseTags(tags) {
  if (!tags) return [];
  return String(tags)
    .split(';')
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Tail segment of a tree path (Project\Area\Sub → Sub). */
export function shortPath(path) {
  if (!path) return '';
  const parts = String(path).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || String(path);
}

const wholeDays = (from, to) => {
  if (!from) return null;
  const t = new Date(from).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((to - t) / DAY_MS));
};

/**
 * A relation is a PR ArtifactLink of the form
 *   vstfs:///Git/PullRequestId/{projectId}%2F{repoId}%2F{prId}
 * Returns { projectId, repoId, prId } or null.
 */
export function parsePullRequestArtifact(url) {
  if (!url) return null;
  const m = /vstfs:\/{3}Git\/PullRequestId\/([^/]+)$/i.exec(String(url));
  if (!m) return null;
  const parts = decodeURIComponent(m[1]).split('/');
  if (parts.length < 3) return null;
  const prId = Number(parts[parts.length - 1]);
  if (!Number.isInteger(prId) || prId <= 0) return null;
  return { projectId: parts[0], repoId: parts[1], prId };
}

const REL_BUCKET = {
  'System.LinkTypes.Hierarchy-Reverse': 'parent',
  'System.LinkTypes.Hierarchy-Forward': 'children',
  'System.LinkTypes.Related': 'related',
  'System.LinkTypes.Dependency-Predecessor': 'predecessors',
  'System.LinkTypes.Dependency-Forward': 'successors',
  'System.LinkTypes.Dependency-Reverse': 'predecessors',
};

/** Work item id embedded at the end of a workItems relation URL. */
function relatedWorkItemId(url) {
  const m = /workItems\/(\d+)$/i.exec(String(url || ''));
  return m ? Number(m[1]) : null;
}

/** Group a work item's relations into typed buckets (pure). */
export function shapeRelations(relations = []) {
  const out = {
    parent: null,
    children: [],
    related: [],
    predecessors: [],
    successors: [],
    pullRequests: [],
    attachments: [],
    hyperlinks: [],
  };
  for (const r of relations || []) {
    const rel = r.rel || '';
    if (rel === 'ArtifactLink') {
      const pr = parsePullRequestArtifact(r.url);
      if (pr) out.pullRequests.push(pr);
      continue;
    }
    if (rel === 'AttachedFile') {
      out.attachments.push({ name: r.attributes?.name || 'attachment', url: r.url, size: r.attributes?.resourceSize ?? null });
      continue;
    }
    if (rel === 'Hyperlink') {
      out.hyperlinks.push({ url: r.url, comment: r.attributes?.comment || '' });
      continue;
    }
    const bucket = REL_BUCKET[rel];
    if (!bucket) continue;
    const id = relatedWorkItemId(r.url);
    if (!id) continue;
    if (bucket === 'parent') out.parent = id;
    else out[bucket].push(id);
  }
  return out;
}

/**
 * Shape a raw work item (fields bag) into the list-row summary.
 * `webBase` builds the ADO edit URL; pass a function (project, id) => url.
 */
export function shapeSummary(raw, { now = Date.now(), webUrl } = {}) {
  const f = raw.fields || {};
  const project = f[F.teamProject] || null;
  const parentId = parentFromRelations(raw.relations);
  return {
    id: raw.id,
    project,
    url: typeof webUrl === 'function' ? webUrl(project, raw.id) : raw.url || null,
    type: f[F.type] || null,
    title: f[F.title] || `Work item ${raw.id}`,
    state: f[F.state] || null,
    reason: f[F.reason] || null,
    assignedTo: shapeIdentity(f[F.assignedTo]),
    createdBy: shapeIdentity(f[F.createdBy]),
    createdDate: f[F.createdDate] || null,
    changedDate: f[F.changedDate] || null,
    areaPath: f[F.areaPath] || null,
    iterationPath: f[F.iterationPath] || null,
    tags: parseTags(f[F.tags]),
    priority: f[F.priority] ?? null,
    severity: f[F.severity] ?? null,
    storyPoints: f[F.storyPoints] ?? null,
    effort: f[F.effort] ?? null,
    boardColumn: f[F.boardColumn] || null,
    parentId,
    ageDays: wholeDays(f[F.createdDate], now),
    idleDays: wholeDays(f[F.changedDate], now),
  };
}

function parentFromRelations(relations) {
  for (const r of relations || []) {
    if (r.rel === 'System.LinkTypes.Hierarchy-Reverse') {
      const id = relatedWorkItemId(r.url);
      if (id) return id;
    }
  }
  return null;
}

/** Shape a fully-expanded work item into the detail payload. */
export function shapeDetail(raw, { now = Date.now(), webUrl, resolvePr } = {}) {
  const f = raw.fields || {};
  const summary = shapeSummary(raw, { now, webUrl });
  const rels = shapeRelations(raw.relations);
  const pullRequests = rels.pullRequests.map((pr) =>
    typeof resolvePr === 'function' ? resolvePr(pr) : { ...pr, url: null }
  );
  return {
    ...summary,
    changedBy: shapeIdentity(f[F.changedBy]),
    rev: raw.rev ?? null,
    description: f[F.description] || '',
    reproSteps: f[F.reproSteps] || '',
    systemInfo: f[F.systemInfo] || '',
    acceptanceCriteria: f[F.acceptanceCriteria] || '',
    relations: { ...rels, pullRequests },
  };
}

/** Shape a work item comment (comments API). */
export function shapeComment(raw) {
  return {
    id: raw.id,
    text: raw.text || '',
    createdBy: shapeIdentity(raw.createdBy),
    createdDate: raw.createdDate || raw.modifiedDate || null,
    modifiedDate: raw.modifiedDate || null,
  };
}

// Fields worth surfacing in the revision history timeline (ref → label).
const HISTORY_FIELDS = {
  'System.State': 'State',
  'System.AssignedTo': 'Assignee',
  'System.Title': 'Title',
  'System.Reason': 'Reason',
  'System.IterationPath': 'Iteration',
  'System.AreaPath': 'Area',
  'System.Tags': 'Tags',
  'Microsoft.VSTS.Common.Priority': 'Priority',
  'Microsoft.VSTS.Common.Severity': 'Severity',
  'Microsoft.VSTS.Scheduling.StoryPoints': 'Story points',
};

function historyValue(v) {
  if (v == null) return '';
  if (typeof v === 'object') return v.displayName || v.uniqueName || '';
  return String(v);
}

/**
 * Shape a single work-item update (revisions/updates API) into a compact
 * timeline entry: who, when, and the notable field changes (old → new). Returns
 * null when the update carries no notable field change (e.g. link-only edits).
 */
export function shapeUpdate(raw) {
  const fields = raw.fields || {};
  const changes = [];
  for (const [ref, label] of Object.entries(HISTORY_FIELDS)) {
    const ch = fields[ref];
    if (!ch) continue;
    const from = historyValue(ch.oldValue);
    const to = historyValue(ch.newValue);
    if (from === to) continue;
    changes.push({ field: label, from, to });
  }
  const commentAdded = Boolean(fields['System.History']?.newValue);
  if (!changes.length && !commentAdded) return null;
  return {
    id: raw.id ?? raw.rev ?? null,
    rev: raw.rev ?? null,
    by: shapeIdentity(raw.revisedBy || fields['System.ChangedBy']?.newValue),
    date: raw.revisedDate || fields['System.ChangedDate']?.newValue || null,
    changes,
    commentAdded,
  };
}

/** Shape an updates list newest-first, dropping empty entries. */
export function shapeHistory(updates = []) {
  return (updates || [])
    .map(shapeUpdate)
    .filter(Boolean)
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}
