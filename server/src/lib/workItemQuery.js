// Pure WIQL (Work Item Query Language) builders + id helpers. No I/O — takes
// scope options and returns a WIQL string, so the query shapes are deterministic
// and unit-testable. Executed per-project by workItemService (fan-out across the
// configured project union, mirroring pipelineService's per-project fan-out).

// Fields hydrated for list rows (kept small — WIQL returns ids only, then we
// batch-hydrate exactly these). Detail views expand everything separately.
export const LIST_FIELDS = [
  'System.Id',
  'System.WorkItemType',
  'System.Title',
  'System.State',
  'System.Reason',
  'System.AssignedTo',
  'System.CreatedBy',
  'System.CreatedDate',
  'System.ChangedDate',
  'System.AreaPath',
  'System.IterationPath',
  'System.Tags',
  'Microsoft.VSTS.Common.Priority',
  'Microsoft.VSTS.Common.Severity',
  'Microsoft.VSTS.Scheduling.StoryPoints',
  'Microsoft.VSTS.Scheduling.Effort',
];

/** Escape a value for embedding inside single-quoted WIQL literals. */
export function escapeWiql(value) {
  return String(value == null ? '' : value).replace(/'/g, "''");
}

/** Quote + escape a single WIQL string literal. */
function lit(value) {
  return `'${escapeWiql(value)}'`;
}

/** Build an IN (...) clause for a field, or null when the list is empty. */
function inClause(field, values) {
  const list = (values || []).map((v) => String(v).trim()).filter(Boolean);
  if (!list.length) return null;
  return `[${field}] IN (${list.map(lit).join(', ')})`;
}

/** OR'd UNDER clauses for a set of tree paths (area/iteration), or null. */
function underAny(field, paths) {
  const list = (paths || []).map((p) => String(p).trim()).filter(Boolean);
  if (!list.length) return null;
  const ors = list.map((p) => `[${field}] UNDER ${lit(p)}`).join(' OR ');
  return list.length > 1 ? `(${ors})` : ors;
}

/**
 * Build a WIQL SELECT for one project scope.
 *
 * opts:
 *   project        - project name (bound as [System.TeamProject] =); required
 *   assignedToMe   - true → [System.AssignedTo] = @Me
 *   createdByMe    - true → [System.CreatedBy] = @Me
 *   assignedTo     - array of unique names/display names (IN)
 *   createdBy      - array (IN)
 *   types          - array of work item types (IN)
 *   states         - array of states to include (IN)
 *   excludeStates  - array of states to exclude (NOT IN); defaults to ['Removed']
 *   areaPaths      - array of area paths (UNDER, OR'd)
 *   iterationUnder - single iteration path (UNDER) for sprint scoping
 *   tags           - array of tags (each ANDed via CONTAINS on System.Tags)
 *   changedSinceDays - integer → [System.ChangedDate] >= @Today - N
 *   mentionsMe     - true → [System.History] CONTAINS @Me (for @mention scope)
 *   extra          - raw extra WHERE clause (already-safe), ANDed
 *   orderBy        - { field, dir } (default ChangedDate DESC)
 */
export function buildWiql(opts = {}) {
  const {
    project,
    assignedToMe = false,
    createdByMe = false,
    assignedTo,
    createdBy,
    types,
    states,
    excludeStates = ['Removed'],
    areaPaths,
    iterationUnder,
    tags,
    changedSinceDays,
    mentionsMe = false,
    extra,
    orderBy = { field: 'System.ChangedDate', dir: 'DESC' },
  } = opts;

  const where = [];
  if (project) where.push(`[System.TeamProject] = ${lit(project)}`);
  if (assignedToMe) where.push('[System.AssignedTo] = @Me');
  if (createdByMe) where.push('[System.CreatedBy] = @Me');
  if (mentionsMe) where.push('[System.History] CONTAINS @Me');

  const assignedIn = inClause('System.AssignedTo', assignedTo);
  if (assignedIn) where.push(assignedIn);
  const createdIn = inClause('System.CreatedBy', createdBy);
  if (createdIn) where.push(createdIn);
  const typeIn = inClause('System.WorkItemType', types);
  if (typeIn) where.push(typeIn);
  const stateIn = inClause('System.State', states);
  if (stateIn) where.push(stateIn);

  for (const s of excludeStates || []) {
    if (s) where.push(`[System.State] <> ${lit(s)}`);
  }

  const area = underAny('System.AreaPath', areaPaths);
  if (area) where.push(area);
  if (iterationUnder) where.push(`[System.IterationPath] UNDER ${lit(iterationUnder)}`);

  for (const t of tags || []) {
    if (t) where.push(`[System.Tags] CONTAINS ${lit(t)}`);
  }

  const n = Number(changedSinceDays);
  if (Number.isInteger(n) && n > 0) where.push(`[System.ChangedDate] >= @Today - ${n}`);

  if (extra && typeof extra === 'string' && extra.trim()) where.push(`(${extra.trim()})`);

  const field = orderBy?.field || 'System.ChangedDate';
  const dir = (orderBy?.dir || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return `SELECT [System.Id] FROM WorkItems ${whereClause} ORDER BY [${field}] ${dir}`.replace(/\s+/g, ' ').trim();
}

/** Split an id list into hydration-safe chunks (ADO batch cap ~200). */
export function chunkIds(ids, size = 200) {
  const clean = [...new Set((ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const out = [];
  for (let i = 0; i < clean.length; i += size) out.push(clean.slice(i, i + size));
  return out;
}

/**
 * Convert a classification-node iteration path to an IterationPath field value.
 * Node paths look like "\Project\Iteration\Q3\Sprint 1"; the field value is
 * "Project\Q3\Sprint 1" (leading slash dropped, the structure segment
 * "Iteration"/"Area" removed at position 2).
 */
export function iterationNodeToPath(nodePath) {
  const parts = String(nodePath || '').split('\\').filter(Boolean);
  if (parts.length >= 2 && /^(iteration|area)$/i.test(parts[1])) parts.splice(1, 1);
  return parts.join('\\');
}
