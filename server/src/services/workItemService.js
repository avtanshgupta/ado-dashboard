import { config, apiVersion } from '../config.js';
import { currentConfig } from '../lib/context.js';
import { adoGet, adoQuery, adoSend, witUrl, orgApiUrl, orgBaseForProject } from '../lib/adoClient.js';
import { buildWiql, chunkIds, LIST_FIELDS, iterationNodeToPath } from '../lib/workItemQuery.js';
import { shapeSummary, shapeDetail, shapeComment, shapeHistory } from '../lib/workItemShape.js';
import { buildWorkItemAnalytics } from '../lib/workItemAnalytics.js';
import { parseQueryRef } from '../lib/workItemLinks.js';

const COMMENTS_API = '7.1-preview.3';
const MAX_IDS = 1000; // safety cap on hydrated items per list
const DEFAULT_ORG = config.organizationUrl.replace(/\/$/, '');

function enc(project) {
  return encodeURIComponent(project);
}

function witWebUrl(project, id) {
  return `${orgBaseForProject(project)}/${enc(project || currentConfig().project)}/_workitems/edit/${id}`;
}

/** The monitored projects to fan work-item queries across ({ name, id, org }). */
function wiProjects() {
  const list = currentConfig().workItemProjects || [];
  if (list.length) return list;
  return [{ name: config.project, id: config.projectId, org: DEFAULT_ORG }];
}

/** Distinct org bases across monitored projects (for org-level, id-only lookups). */
function orgBasesToTry() {
  const set = new Set();
  for (const p of wiProjects()) set.add(p.org || DEFAULT_ORG);
  set.add(DEFAULT_ORG);
  return [...set];
}

/**
 * Fetch a single work item by id when the owning org isn't known up front (e.g.
 * opening /work-item/:id or a ⌘K jump). Probes each monitored org base until the
 * id resolves. Returns { orgBase, raw }.
 */
async function getWorkItemRaw(id, { expand, fields } = {}) {
  const query = { 'api-version': apiVersion };
  if (expand) query.$expand = expand;
  if (fields) query.fields = fields;
  let lastErr = null;
  for (const orgBase of orgBasesToTry()) {
    try {
      const raw = await adoGet(orgApiUrl(orgBase, `_apis/wit/workitems/${id}`), { query, cache: false });
      return { orgBase, raw };
    } catch (err) {
      if (err && err.status === 404) { lastErr = err; continue; }
      throw err;
    }
  }
  const e = new Error(`Work item #${id} was not found in your monitored organizations.`);
  e.status = lastErr?.status || 404;
  throw e;
}

/** Map a parsed PR ArtifactLink to a linkable shape (ADO web URL via GUIDs). */
function makeResolvePr(orgBase) {
  return (pr) => ({
    ...pr,
    url: `${orgBase || DEFAULT_ORG}/${encodeURIComponent(pr.projectId)}/_git/${encodeURIComponent(pr.repoId)}/pullrequest/${pr.prId}`,
  });
}

// ---- raw query + hydrate ----

/** Run a WIQL string against one project; returns ordered work-item ids. */
async function wiqlIds(project, wiql) {
  try {
    const res = await adoQuery(witUrl('wiql', project), { query: wiql }, { query: { 'api-version': apiVersion } });
    return (res.workItems || []).map((w) => w.id);
  } catch (err) {
    // A project the user can't access (or that no longer exists) shouldn't fail
    // the whole union — degrade to empty, like prService treats 404 repos.
    if (err && (err.status === 404 || err.status === 400 || err.status === 401 || err.status === 403)) return [];
    throw err;
  }
}

/** Hydrate ids that all belong to one org into list-row summaries (chunked ≤200). */
async function hydrateOrg(orgBase, ids) {
  const capped = ids.slice(0, MAX_IDS);
  const chunks = chunkIds(capped, 200);
  const pages = await Promise.all(
    chunks.map((chunk) =>
      adoGet(orgApiUrl(orgBase, '_apis/wit/workitems'), {
        query: { ids: chunk.join(','), fields: LIST_FIELDS.join(','), 'api-version': apiVersion },
      })
        .then((r) => r.value || [])
        .catch(() => [])
    )
  );
  const now = Date.now();
  return pages.flat().map((raw) => shapeSummary(raw, { now, webUrl: witWebUrl }));
}

/**
 * Fan a scoped WIQL across the monitored projects (which may span organizations),
 * then hydrate each org's ids from that org and merge — newest first.
 */
async function runScoped(baseOpts) {
  const projects = wiProjects();
  const perProject = await Promise.all(
    projects.map(async (p) => ({ org: p.org || DEFAULT_ORG, ids: await wiqlIds(p.name, buildWiql({ ...baseOpts, project: p.name })) }))
  );
  const byOrg = new Map();
  for (const { org, ids } of perProject) {
    if (!byOrg.has(org)) byOrg.set(org, new Set());
    const set = byOrg.get(org);
    for (const id of ids) set.add(id);
  }
  const lists = await Promise.all([...byOrg.entries()].map(([org, set]) => hydrateOrg(org, [...set])));
  const items = lists.flat();
  items.sort((a, b) => new Date(b.changedDate || 0) - new Date(a.changedDate || 0));
  return items;
}

// The default "changed within" window (months) → days, for area/team-scoped
// queries which would otherwise be unbounded on a busy project.
function windowDays() {
  const months = currentConfig().defaultTimeRangeMonths || 6;
  return months * 31;
}

// ---- public: list tabs ----

export async function listAssigned() {
  return runScoped({ assignedToMe: true });
}

export async function listCreated() {
  return runScoped({ createdByMe: true });
}

export async function listTeam() {
  const team = currentConfig().team || [];
  if (!team.length) return [];
  return runScoped({ assignedTo: team, changedSinceDays: windowDays() });
}

export async function listFollowing() {
  // "Following / @mentioned" — items whose discussion history mentions me
  // (covers @mentions and comment participation), bounded to the window.
  return runScoped({ mentionsMe: true, changedSinceDays: windowDays() });
}

/**
 * Resolve current-sprint iteration paths for a project. Prefers the team
 * iterations API (its `path` is already in IterationPath format); falls back to
 * classification nodes whose date range spans now.
 */
async function currentIterationPaths(project) {
  const paths = new Set();
  // 1) Default team's current iteration(s).
  try {
    const team = `${project} Team`;
    const res = await adoGet(`${orgBaseForProject(project)}/${enc(project)}/${enc(team)}/_apis/work/teamsettings/iterations`, {
      query: { '$timeframe': 'current', 'api-version': apiVersion },
    });
    for (const it of res.value || []) if (it.path) paths.add(it.path);
  } catch {
    /* no default team / no access — fall through */
  }
  if (paths.size) return [...paths];
  // 2) Classification nodes dated to now.
  try {
    const res = await adoGet(witUrl('classificationnodes/iterations', project), { query: { '$depth': 10, 'api-version': apiVersion } });
    const now = Date.now();
    const walk = (node) => {
      const start = node.attributes?.startDate ? Date.parse(node.attributes.startDate) : null;
      const finish = node.attributes?.finishDate ? Date.parse(node.attributes.finishDate) : null;
      if (start != null && finish != null && start <= now && now <= finish) {
        const p = iterationNodeToPath(node.path || `\\${node.name}`);
        if (p) paths.add(p);
      }
      for (const c of node.children || []) walk(c);
    };
    walk(res);
  } catch {
    /* ignore */
  }
  return [...paths];
}

export async function listSprint({ scope = 'mine' } = {}) {
  const projects = wiProjects();
  const me = scope !== 'all';
  const perProject = await Promise.all(
    projects.map(async (p) => {
      const paths = await currentIterationPaths(p.name);
      if (!paths.length) return { org: p.org || DEFAULT_ORG, ids: [] };
      // One WIQL per iteration path (UNDER), assignee-scoped to me unless scope=all.
      const nested = await Promise.all(
        paths.map((path) => wiqlIds(p.name, buildWiql({ project: p.name, iterationUnder: path, assignedToMe: me })))
      );
      return { org: p.org || DEFAULT_ORG, ids: nested.flat() };
    })
  );
  const byOrg = new Map();
  for (const { org, ids } of perProject) {
    if (!byOrg.has(org)) byOrg.set(org, new Set());
    for (const id of ids) byOrg.get(org).add(id);
  }
  const lists = await Promise.all([...byOrg.entries()].map(([org, set]) => hydrateOrg(org, [...set])));
  const items = lists.flat();
  items.sort((a, b) => new Date(b.changedDate || 0) - new Date(a.changedDate || 0));
  return items;
}

export async function runSavedQuery(queryId) {
  if (!queryId) { const e = new Error('A saved query id is required.'); e.status = 400; throw e; }
  const saved = (currentConfig().workItemSavedQueries || []).find((q) => q.id === queryId);
  const project = saved?.project || wiProjects()[0]?.name;
  // Prefer the query's stored org (it may live in a different org than the
  // monitored projects); fall back to the project→org map.
  const orgBase = saved?.org || orgBaseForProject(project);
  const res = await adoGet(orgApiUrl(orgBase, `${enc(project)}/_apis/wit/wiql/${encodeURIComponent(queryId)}`), { query: { 'api-version': apiVersion }, cache: false });
  const ids = (res.workItems || []).map((w) => w.id);
  return hydrateOrg(orgBase, ids);
}

// ---- link resolvers (add a saved query by pasting a web link) ----

/** Resolve a saved query by its ADO URL or GUID → { id, name, project, org, path }. */
export async function resolveSavedQuery(ref) {
  const parsed = parseQueryRef(ref);
  if (!parsed) { const e = new Error('Enter a query URL.'); e.status = 400; throw e; }
  if (!parsed.org || !parsed.project) { const e = new Error('Paste the full query URL (…/<project>/_queries/query/<guid>) — a bare id is not enough to locate the query.'); e.status = 400; throw e; }
  const project = parsed.project;
  const orgBase = parsed.org;
  let q;
  try {
    q = await adoGet(orgApiUrl(orgBase, `${enc(project)}/_apis/wit/queries/${parsed.guid}`), { query: { '$expand': 'minimal', 'api-version': apiVersion }, cache: false });
  } catch (err) {
    if (err && (err.status === 404 || err.status === 403)) { const e = new Error(`Query not found (or no access) in “${project}”. Paste the full query URL.`); e.status = err.status; throw e; }
    throw err;
  }
  if (q.isFolder) { const e = new Error('That link points to a query folder, not a query.'); e.status = 400; throw e; }
  return { id: q.id, name: q.name || 'Query', project, org: orgBase, path: q.path || null };
}

// ---- public: overview + landing summary ----

/** Gather a deduped "my world" set for analytics (assigned + created + team). */
async function gatherScope() {
  const cfg = currentConfig();
  const tasks = [runScoped({ assignedToMe: true }), runScoped({ createdByMe: true })];
  if ((cfg.team || []).length) tasks.push(runScoped({ assignedTo: cfg.team, changedSinceDays: windowDays() }));
  const lists = await Promise.all(tasks);
  const byId = new Map();
  for (const list of lists) for (const it of list) if (!byId.has(it.id)) byId.set(it.id, it);
  return [...byId.values()];
}

export async function getWorkItemsOverview() {
  const items = await gatherScope();
  const slaDays = currentConfig().slaDays || 7;
  return buildWorkItemAnalytics(items, { slaDays });
}

export async function getWorkItemsSummary() {
  const [assigned] = await Promise.all([listAssigned()]);
  const slaDays = currentConfig().slaDays || 7;
  const open = assigned.filter((it) => !['Closed', 'Done', 'Completed', 'Removed', 'Resolved'].includes(it.state));
  const breaching = assigned.filter((it) => (it.idleDays || 0) >= slaDays);
  const recentlyChanged = [...assigned].sort((a, b) => new Date(b.changedDate || 0) - new Date(a.changedDate || 0)).slice(0, 5);
  return {
    assignedTotal: assigned.length,
    assignedOpen: open.length,
    breaching: breaching.length,
    slaDays,
    recent: recentlyChanged,
  };
}

// ---- public: detail ----

export async function getWorkItemDetail(id) {
  const wid = Number(id);
  if (!Number.isInteger(wid) || wid <= 0) { const e = new Error('A valid work item id is required.'); e.status = 400; throw e; }
  const { orgBase, raw } = await getWorkItemRaw(wid, { expand: 'all' });
  const detail = shapeDetail(raw, { webUrl: witWebUrl, resolvePr: makeResolvePr(orgBase) });
  const project = detail.project;

  // Comments + allowed states + history are auxiliary — never fail the detail if
  // they error (e.g. a preview API-version mismatch).
  const [comments, states, history] = await Promise.all([
    adoGet(witUrl(`workItems/${wid}/comments`, project), { query: { 'api-version': COMMENTS_API }, cache: false })
      .then((r) => (r.comments || []).map(shapeComment))
      .catch(() => []),
    detail.type
      ? adoGet(witUrl(`workitemtypes/${encodeURIComponent(detail.type)}/states`, project), { query: { 'api-version': apiVersion } })
          .then((r) => (r.value || []).map((s) => ({ name: s.name, category: s.category, color: s.color })))
          .catch(() => [])
      : Promise.resolve([]),
    adoGet(orgApiUrl(orgBase, `_apis/wit/workItems/${wid}/updates`), { query: { 'api-version': apiVersion, '$top': 200 }, cache: false })
      .then((r) => shapeHistory(r.value || []))
      .catch(() => []),
  ]);

  detail.comments = comments;
  detail.allowedStates = states;
  detail.history = history;
  return detail;
}

// ---- public: type metadata (for badges + create form) ----

export async function getWorkItemTypes() {
  const projects = wiProjects();
  const perProject = await Promise.all(
    projects.map((p) =>
      adoGet(witUrl('workitemtypes', p.name), { query: { 'api-version': apiVersion } })
        .then((r) => r.value || [])
        .catch(() => [])
    )
  );
  const byName = new Map();
  for (const t of perProject.flat()) {
    if (!t.name || byName.has(t.name)) continue;
    byName.set(t.name, {
      name: t.name,
      color: t.color ? `#${String(t.color).replace(/^#/, '')}` : null,
      icon: t.icon?.id || null,
      states: (t.states || []).map((s) => ({ name: s.name, category: s.category, color: s.color })),
    });
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---- write actions ----

/** Build add/replace patch ops from a { refName: value } field map. */
function fieldOps(fields, op = 'add') {
  const ops = [];
  for (const [path, value] of Object.entries(fields || {})) {
    if (value === undefined) continue;
    ops.push({ op, path: `/fields/${path}`, value });
  }
  return ops;
}

/** Create a work item of `type` in `project` with the given field map. */
export async function createWorkItem(project, type, fields) {
  const proj = String(project || '').trim() || wiProjects()[0]?.name;
  const t = String(type || '').trim();
  if (!proj) { const e = new Error('A project is required.'); e.status = 400; throw e; }
  if (!t) { const e = new Error('A work item type is required.'); e.status = 400; throw e; }
  if (!fields || !String(fields['System.Title'] || '').trim()) { const e = new Error('A title is required.'); e.status = 400; throw e; }
  const patch = fieldOps(fields, 'add');
  const raw = await adoSend('POST', witUrl(`workitems/$${encodeURIComponent(t)}`, proj), patch, {
    query: { 'api-version': apiVersion },
    contentType: 'application/json-patch+json',
  });
  return shapeDetail(raw, { webUrl: witWebUrl, resolvePr: makeResolvePr(orgBaseForProject(proj)) });
}

/**
 * Update a work item's fields (state/assignee/tags/priority/etc.) via json-patch.
 * `fields` is a { refName: value } map. Optimistic concurrency: pass `rev` to
 * guard the write, or omit to fetch the current rev first.
 */
export async function updateWorkItem(id, fields, { rev } = {}) {
  const wid = Number(id);
  if (!Number.isInteger(wid) || wid <= 0) { const e = new Error('A valid work item id is required.'); e.status = 400; throw e; }
  if (!fields || !Object.keys(fields).length) { const e = new Error('No fields to update.'); e.status = 400; throw e; }
  const { orgBase, raw: cur } = await getWorkItemRaw(wid, { fields: 'System.TeamProject' });
  const project = cur.fields?.['System.TeamProject'];
  const currentRev = rev == null ? cur.rev : rev;
  const patch = [{ op: 'test', path: '/rev', value: currentRev }, ...fieldOps(fields, 'add')];
  const raw = await adoSend('PATCH', witUrl(`workitems/${wid}`, project), patch, {
    query: { 'api-version': apiVersion },
    contentType: 'application/json-patch+json',
  });
  return shapeDetail(raw, { webUrl: witWebUrl, resolvePr: makeResolvePr(orgBase) });
}

/** Add a discussion comment. */
export async function addWorkItemComment(id, text) {
  const wid = Number(id);
  const body = String(text || '').trim();
  if (!Number.isInteger(wid) || wid <= 0) { const e = new Error('A valid work item id is required.'); e.status = 400; throw e; }
  if (!body) { const e = new Error('Comment text is required.'); e.status = 400; throw e; }
  const { raw: cur } = await getWorkItemRaw(wid, { fields: 'System.TeamProject' });
  const project = cur.fields?.['System.TeamProject'];
  const res = await adoSend('POST', witUrl(`workItems/${wid}/comments`, project), { text: body }, { query: { 'api-version': COMMENTS_API } });
  return shapeComment(res);
}

const REL_TYPES = new Set([
  'System.LinkTypes.Related',
  'System.LinkTypes.Hierarchy-Forward',
  'System.LinkTypes.Hierarchy-Reverse',
  'System.LinkTypes.Dependency-Forward',
  'System.LinkTypes.Dependency-Reverse',
]);

/** Link this work item to another by relation type (both in the same org). */
export async function addWorkItemLink(id, targetId, rel = 'System.LinkTypes.Related') {
  const wid = Number(id);
  const tid = Number(targetId);
  if (!Number.isInteger(wid) || wid <= 0 || !Number.isInteger(tid) || tid <= 0) { const e = new Error('Valid work item ids are required.'); e.status = 400; throw e; }
  const relType = REL_TYPES.has(rel) ? rel : 'System.LinkTypes.Related';
  const { orgBase, raw: cur } = await getWorkItemRaw(wid, { fields: 'System.TeamProject' });
  const project = cur.fields?.['System.TeamProject'];
  const targetUrl = orgApiUrl(orgBase, `_apis/wit/workItems/${tid}`);
  const patch = [{ op: 'add', path: '/relations/-', value: { rel: relType, url: targetUrl } }];
  const raw = await adoSend('PATCH', witUrl(`workitems/${wid}`, project), patch, {
    query: { 'api-version': apiVersion },
    contentType: 'application/json-patch+json',
  });
  return shapeDetail(raw, { webUrl: witWebUrl, resolvePr: makeResolvePr(orgBase) });
}

/**
 * Remove a relation, identified by its exact url or by a linked work-item id
 * (matches a relation whose url ends with /workItems/{targetId}). Optimistic
 * concurrency via the rev test.
 */
export async function removeWorkItemRelation(id, { relationUrl, targetId } = {}) {
  const wid = Number(id);
  if (!Number.isInteger(wid) || wid <= 0) { const e = new Error('A valid work item id is required.'); e.status = 400; throw e; }
  const url = String(relationUrl || '').toLowerCase();
  const tid = Number(targetId);
  const hasTarget = Number.isInteger(tid) && tid > 0;
  if (!url && !hasTarget) { const e = new Error('A relation url or target work item id is required.'); e.status = 400; throw e; }
  const { orgBase, raw: cur } = await getWorkItemRaw(wid, { expand: 'relations' });
  const project = cur.fields?.['System.TeamProject'];
  const rels = cur.relations || [];
  const idx = rels.findIndex((r) => {
    const u = String(r.url || '').toLowerCase();
    if (url) return u === url;
    return new RegExp(`/workitems/${tid}$`, 'i').test(u);
  });
  if (idx === -1) { const e = new Error('That relation was not found on this work item.'); e.status = 404; throw e; }
  const patch = [{ op: 'test', path: '/rev', value: cur.rev }, { op: 'remove', path: `/relations/${idx}` }];
  const raw = await adoSend('PATCH', witUrl(`workitems/${wid}`, project), patch, {
    query: { 'api-version': apiVersion },
    contentType: 'application/json-patch+json',
  });
  return shapeDetail(raw, { webUrl: witWebUrl, resolvePr: makeResolvePr(orgBase) });
}
