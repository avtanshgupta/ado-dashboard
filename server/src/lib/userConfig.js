import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config, defaults, groupNameToLabel } from '../config.js';
import { writeJsonAtomic } from './atomicFile.js';
import { orgBaseFromUrl } from './repoLink.js';

const DEFAULT_ORG = config.organizationUrl.replace(/\/$/, '');
/** Org base URL for a project url (fallback: the default org). */
function orgForUrl(url) {
  return orgBaseFromUrl(url) || DEFAULT_ORG;
}
function projectUrlFor(name) {
  return `${DEFAULT_ORG}/${encodeURIComponent(name)}`;
}

const usersDir = join(config.dataDir, 'users');

function ensureDir() {
  if (!existsSync(usersDir)) mkdirSync(usersDir, { recursive: true });
}

function safeId(userId) {
  return String(userId).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function filePath(userId) {
  return join(usersDir, `${safeId(userId)}.json`);
}

export const DEFAULT_NOTIF_PREFS = {
  newPr: false,
  newComment: false,
  reviewChange: false,
  pipelineFailed: false,
  pipelineSucceeded: false,
  prClosed: false,
  agentOffline: false, // a reporting machine went stale/offline
  agentLongRunning: false, // a session exceeded the long-running threshold
  browserPush: false, // C2 — desktop/browser notifications
};

const NOTIF_PREF_ENUMS = {};

export const DEFAULT_UI_PREFS = {
  density: 'comfortable', // E5 — 'comfortable' | 'compact' table rows
  onboarded: false, // first-run guided tour: true once the user finishes/skips it
};
const UI_PREF_ENUMS = { density: new Set(['comfortable', 'compact']) };
const UI_PREF_BOOLS = new Set(['onboarded']);

export const DEFAULT_SLA_DAYS = 7; // B4 — idle days before a PR is "breaching SLA"

// Copilot agent session thresholds (Settings → Agents). staleMinutes drives the
// heartbeat-age cutoff after which a session is shown as "stale".
export const DEFAULT_AGENT_PREFS = { staleMinutes: 5, longRunningHours: 4 };

/** Short opaque id for user-created records (templates, saved views). */
function rid() {
  return Math.random().toString(36).slice(2, 10);
}

function seed() {
  return {
    projects: defaults.projects.map((p) => ({ ...p })), // monitored ADO projects (scope for all data)
    repositories: [...defaults.repositories],
    repoProjects: {}, // repoNameLower -> { project, projectId } for cross-project repos
    team: [...defaults.team],
    reviewerGroups: defaults.reviewerGroups.map((g) => ({ ...g })),
    defaultTimeRangeMonths: defaults.defaultTimeRangeMonths,
    pipelines: defaults.pipelines.map((p) => ({ ...p })),
    notificationPrefs: { ...DEFAULT_NOTIF_PREFS },
    commentTemplates: [], // A4
    savedViews: [], // E1
    mutedRepos: [], // C4
    uiPrefs: { ...DEFAULT_UI_PREFS }, // E5
    slaDays: DEFAULT_SLA_DAYS, // B4
    workItemSavedQueries: [], // WI — saved ADO WIQL query ids to run in the Queries tab
    agents: { ...DEFAULT_AGENT_PREFS }, // Copilot agent session thresholds
  };
}

/** Normalize a stored projects list: [{ name, id, url, org }]. */
function normalizeProjects(v) {
  if (!Array.isArray(v)) return null;
  const seen = new Set();
  const out = [];
  for (const p of v) {
    const name = typeof p?.name === 'string' ? p.name.trim() : '';
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const url = typeof p.url === 'string' && p.url.trim() ? p.url.trim() : projectUrlFor(name);
    out.push({
      name,
      id: typeof p.id === 'string' ? p.id.trim() : '',
      url,
      org: typeof p.org === 'string' && p.org.trim() ? p.org.trim().replace(/\/$/, '') : orgForUrl(url),
    });
  }
  return out;
}

/** Normalize a stored repoProjects map: { repoNameLower: { project, projectId, org } }. */
function normalizeRepoProjects(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out = {};
  for (const [name, meta] of Object.entries(v)) {
    if (!name || !meta || typeof meta !== 'object') continue;
    const project = typeof meta.project === 'string' ? meta.project.trim() : '';
    if (!project) continue;
    const projectId = typeof meta.projectId === 'string' ? meta.projectId.trim() : '';
    const org = typeof meta.org === 'string' && meta.org.trim() ? meta.org.trim().replace(/\/$/, '') : '';
    out[String(name).toLowerCase()] = { project, projectId, ...(org ? { org } : {}) };
  }
  return out;
}

/** Load a user's stored config (seeding defaults on first use). */
export function loadUserConfig(userId) {
  ensureDir();
  const path = filePath(userId);
  if (!existsSync(path)) {
    const fresh = seed();
    writeJsonAtomic(path, fresh);
    return fresh;
  }
  const stored = JSON.parse(readFileSync(path, 'utf8'));
  // Spread stored first so unknown/forward-version keys survive a load→save
  // round-trip, then normalise the known keys (filling any missing from defaults).
  return {
    ...stored,
    projects: normalizeProjects(stored.projects) || defaults.projects.map((p) => ({ ...p })),
    repositories: stored.repositories || [...defaults.repositories],
    repoProjects: normalizeRepoProjects(stored.repoProjects),
    team: stored.team || [...defaults.team],
    reviewerGroups: stored.reviewerGroups || defaults.reviewerGroups.map((g) => ({ ...g })),
    defaultTimeRangeMonths: stored.defaultTimeRangeMonths || defaults.defaultTimeRangeMonths,
    pipelines: stored.pipelines || defaults.pipelines.map((p) => ({ ...p })),
    notificationPrefs: { ...DEFAULT_NOTIF_PREFS, ...(stored.notificationPrefs || {}) },
    commentTemplates: Array.isArray(stored.commentTemplates) ? stored.commentTemplates : [],
    savedViews: Array.isArray(stored.savedViews) ? stored.savedViews : [],
    mutedRepos: Array.isArray(stored.mutedRepos) ? stored.mutedRepos : [],
    uiPrefs: { ...DEFAULT_UI_PREFS, ...(stored.uiPrefs || {}) },
    slaDays: Number.isInteger(stored.slaDays) ? stored.slaDays : DEFAULT_SLA_DAYS,
    workItemSavedQueries: Array.isArray(stored.workItemSavedQueries) ? stored.workItemSavedQueries : [],
    agents: { ...DEFAULT_AGENT_PREFS, ...(stored.agents && typeof stored.agents === 'object' && !Array.isArray(stored.agents) ? stored.agents : {}) },
  };
}

const ALLOWED_KEYS = [
  'projects', 'repositories', 'repoProjects', 'team', 'reviewerGroups', 'defaultTimeRangeMonths', 'pipelines', 'notificationPrefs',
  'commentTemplates', 'savedViews', 'mutedRepos', 'uiPrefs', 'slaDays',
  'workItemSavedQueries', 'agents',
];

const KNOWN_PREF_KEYS = new Set(Object.keys(DEFAULT_NOTIF_PREFS));

function badRequest(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

function asStringArray(val, field) {
  if (!Array.isArray(val)) throw badRequest(`${field} must be an array.`);
  const out = [];
  for (const v of val) {
    if (typeof v !== 'string') throw badRequest(`${field} must contain only strings.`);
    const s = v.trim();
    if (s) out.push(s);
  }
  return [...new Set(out)];
}

/**
 * Validate + normalize an incoming config patch. Rejects malformed shapes with a
 * 400 (arbitrary/garbage values previously persisted unchecked and could break
 * fetches), trims strings, dedupes, and coerces numeric/boolean fields.
 */
function validateAndNormalize(partial) {
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
    throw badRequest('Config payload must be a JSON object.');
  }
  const clean = {};

  if (partial.repositories !== undefined) clean.repositories = asStringArray(partial.repositories, 'repositories');
  if (partial.repoProjects !== undefined) {
    const rp = partial.repoProjects;
    if (!rp || typeof rp !== 'object' || Array.isArray(rp)) throw badRequest('repoProjects must be an object.');
    const out = {};
    for (const [name, meta] of Object.entries(rp)) {
      if (!name || !meta || typeof meta !== 'object' || Array.isArray(meta)) throw badRequest('repoProjects entries must be { project, projectId } objects.');
      const project = typeof meta.project === 'string' ? meta.project.trim() : '';
      if (!project) throw badRequest(`repoProjects["${name}"].project is required.`);
      const projectId = typeof meta.projectId === 'string' ? meta.projectId.trim() : '';
      const org = typeof meta.org === 'string' && meta.org.trim() ? meta.org.trim().replace(/\/$/, '') : '';
      out[String(name).toLowerCase()] = { project, projectId, ...(org ? { org } : {}) };
    }
    clean.repoProjects = out;
  }
  if (partial.team !== undefined) clean.team = asStringArray(partial.team, 'team');

  if (partial.reviewerGroups !== undefined) {
    if (!Array.isArray(partial.reviewerGroups)) throw badRequest('reviewerGroups must be an array.');
    clean.reviewerGroups = partial.reviewerGroups.map((g, i) => {
      if (!g || typeof g !== 'object') throw badRequest(`reviewerGroups[${i}] must be an object.`);
      const name = typeof g.name === 'string' ? g.name.trim() : '';
      if (!name) throw badRequest(`reviewerGroups[${i}].name is required.`);
      return {
        name,
        label: typeof g.label === 'string' && g.label.trim() ? g.label.trim() : name,
        ...(typeof g.alias === 'string' && g.alias.trim() ? { alias: g.alias.trim() } : {}),
      };
    });
  }

  if (partial.defaultTimeRangeMonths !== undefined) {
    const n = Number(partial.defaultTimeRangeMonths);
    if (!Number.isInteger(n) || n < 1 || n > 24) {
      throw badRequest('defaultTimeRangeMonths must be an integer between 1 and 24.');
    }
    clean.defaultTimeRangeMonths = n;
  }

  if (partial.pipelines !== undefined) {
    if (!Array.isArray(partial.pipelines)) throw badRequest('pipelines must be an array.');
    clean.pipelines = partial.pipelines.map((p, i) => {
      if (!p || typeof p !== 'object') throw badRequest(`pipelines[${i}] must be an object.`);
      const definitionId = Number(p.definitionId);
      if (!Number.isInteger(definitionId) || definitionId <= 0) {
        throw badRequest(`pipelines[${i}].definitionId must be a positive integer.`);
      }
      return {
        definitionId,
        ...(typeof p.repo === 'string' && p.repo.trim() ? { repo: p.repo.trim() } : {}),
        ...(typeof p.name === 'string' && p.name.trim() ? { name: p.name.trim() } : {}),
        ...(typeof p.label === 'string' && p.label.trim() ? { label: p.label.trim() } : {}),
        ...(typeof p.project === 'string' && p.project.trim() ? { project: p.project.trim() } : {}),
        ...(typeof p.projectId === 'string' && p.projectId.trim() ? { projectId: p.projectId.trim() } : {}),
      };
    });
  }

  if (partial.notificationPrefs !== undefined) {
    const np = partial.notificationPrefs;
    if (!np || typeof np !== 'object' || Array.isArray(np)) throw badRequest('notificationPrefs must be an object.');
    const prefs = {};
    for (const [k, v] of Object.entries(np)) {
      if (!KNOWN_PREF_KEYS.has(k)) continue;
      if (NOTIF_PREF_ENUMS[k]) {
        if (!NOTIF_PREF_ENUMS[k].has(v)) throw badRequest(`notificationPrefs.${k} must be one of: ${[...NOTIF_PREF_ENUMS[k]].join(', ')}.`);
        prefs[k] = v;
      } else {
        prefs[k] = !!v;
      }
    }
    clean.notificationPrefs = prefs;
  }

  if (partial.commentTemplates !== undefined) clean.commentTemplates = validateTemplates(partial.commentTemplates);
  if (partial.savedViews !== undefined) clean.savedViews = validateSavedViews(partial.savedViews);
  if (partial.mutedRepos !== undefined) clean.mutedRepos = asStringArray(partial.mutedRepos, 'mutedRepos');

  if (partial.uiPrefs !== undefined) {
    const up = partial.uiPrefs;
    if (!up || typeof up !== 'object' || Array.isArray(up)) throw badRequest('uiPrefs must be an object.');
    const prefs = {};
    for (const [k, v] of Object.entries(up)) {
      if (!(k in DEFAULT_UI_PREFS)) continue;
      if (UI_PREF_BOOLS.has(k)) { prefs[k] = Boolean(v); continue; }
      if (UI_PREF_ENUMS[k] && !UI_PREF_ENUMS[k].has(v)) throw badRequest(`uiPrefs.${k} must be one of: ${[...UI_PREF_ENUMS[k]].join(', ')}.`);
      prefs[k] = v;
    }
    clean.uiPrefs = prefs;
  }

  if (partial.slaDays !== undefined) {
    const n = Number(partial.slaDays);
    if (!Number.isInteger(n) || n < 1 || n > 90) throw badRequest('slaDays must be an integer between 1 and 90.');
    clean.slaDays = n;
  }

  if (partial.projects !== undefined) clean.projects = validateProjects(partial.projects);
  if (partial.workItemSavedQueries !== undefined) clean.workItemSavedQueries = validateSavedQueries(partial.workItemSavedQueries);

  if (partial.agents !== undefined) {
    const a = partial.agents;
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw badRequest('agents must be an object.');
    const out = {};
    if (a.staleMinutes !== undefined) {
      const n = Number(a.staleMinutes);
      if (!Number.isInteger(n) || n < 1 || n > 60) throw badRequest('agents.staleMinutes must be an integer between 1 and 60.');
      out.staleMinutes = n;
    }
    if (a.longRunningHours !== undefined) {
      const n = Number(a.longRunningHours);
      if (!Number.isInteger(n) || n < 1 || n > 48) throw badRequest('agents.longRunningHours must be an integer between 1 and 48.');
      out.longRunningHours = n;
    }
    clean.agents = out;
  }

  return clean;
}

function requireString(val, field, { max = 4000 } = {}) {
  if (typeof val !== 'string') throw badRequest(`${field} must be a string.`);
  const s = val.trim();
  if (!s) throw badRequest(`${field} is required.`);
  if (s.length > max) throw badRequest(`${field} must be ${max} characters or fewer.`);
  return s;
}

/** A4 — reply snippets: [{ id, name, body }]. */
function validateTemplates(val) {
  if (!Array.isArray(val)) throw badRequest('commentTemplates must be an array.');
  if (val.length > 100) throw badRequest('Too many comment templates (max 100).');
  return val.map((t, i) => {
    if (!t || typeof t !== 'object') throw badRequest(`commentTemplates[${i}] must be an object.`);
    return {
      id: typeof t.id === 'string' && t.id.trim() ? t.id.trim() : rid(),
      name: requireString(t.name, `commentTemplates[${i}].name`, { max: 120 }),
      body: requireString(t.body, `commentTemplates[${i}].body`, { max: 8000 }),
    };
  });
}

/** E1 — saved filter/sort presets: [{ id, name, variant, filters, sort }]. */
function validateSavedViews(val) {
  if (!Array.isArray(val)) throw badRequest('savedViews must be an array.');
  if (val.length > 100) throw badRequest('Too many saved views (max 100).');
  const plainObj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
  return val.map((v, i) => {
    if (!v || typeof v !== 'object') throw badRequest(`savedViews[${i}] must be an object.`);
    return {
      id: typeof v.id === 'string' && v.id.trim() ? v.id.trim() : rid(),
      name: requireString(v.name, `savedViews[${i}].name`, { max: 120 }),
      variant: typeof v.variant === 'string' ? v.variant.slice(0, 40) : '',
      filters: plainObj(v.filters),
      sort: plainObj(v.sort),
    };
  });
}

/** Monitored ADO projects: [{ name, id, url, org }]. Data is scoped to these. */
function validateProjects(val) {
  if (!Array.isArray(val)) throw badRequest('projects must be an array.');
  if (val.length > 50) throw badRequest('Too many projects (max 50).');
  const seen = new Set();
  const out = [];
  for (const [i, p] of val.entries()) {
    if (!p || typeof p !== 'object') throw badRequest(`projects[${i}] must be an object.`);
    const name = requireString(p.name, `projects[${i}].name`, { max: 200 });
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const url = typeof p.url === 'string' && p.url.trim() ? p.url.trim() : projectUrlFor(name);
    out.push({
      name,
      id: typeof p.id === 'string' ? p.id.trim() : '',
      url,
      org: typeof p.org === 'string' && p.org.trim() ? p.org.trim().replace(/\/$/, '') : orgForUrl(url),
    });
  }
  return out;
}

/** WI — saved ADO WIQL queries to run in the Queries tab: [{ id, name, project, org }]. */
function validateSavedQueries(val) {
  if (!Array.isArray(val)) throw badRequest('workItemSavedQueries must be an array.');
  if (val.length > 50) throw badRequest('Too many saved queries (max 50).');
  return val.map((q, i) => {
    if (!q || typeof q !== 'object') throw badRequest(`workItemSavedQueries[${i}] must be an object.`);
    const id = requireString(q.id, `workItemSavedQueries[${i}].id`, { max: 200 });
    return {
      id,
      name: typeof q.name === 'string' && q.name.trim() ? q.name.trim().slice(0, 200) : id,
      ...(typeof q.project === 'string' && q.project.trim() ? { project: q.project.trim() } : {}),
      ...(typeof q.org === 'string' && q.org.trim() ? { org: q.org.trim().replace(/\/$/, '') } : {}),
    };
  });
}

export function saveUserConfig(userId, partial) {
  ensureDir();
  const cleaned = validateAndNormalize(partial || {});
  const current = loadUserConfig(userId);
  const next = { ...current };
  for (const key of ALLOWED_KEYS) {
    if (cleaned[key] === undefined) continue;
    if (key === 'notificationPrefs') next[key] = { ...current.notificationPrefs, ...cleaned[key] };
    else if (key === 'uiPrefs') next[key] = { ...current.uiPrefs, ...cleaned[key] };
    else if (key === 'agents') next[key] = { ...DEFAULT_AGENT_PREFS, ...current.agents, ...cleaned[key] };
    else if (key === 'repoProjects') next[key] = { ...current.repoProjects, ...cleaned[key] };
    else next[key] = cleaned[key];
  }
  // Prune repoProjects entries for repos no longer tracked, so the map can't grow
  // stale after a repo is removed.
  if (next.repositories && next.repoProjects) {
    const keep = new Set(next.repositories.map((r) => String(r).toLowerCase()));
    next.repoProjects = Object.fromEntries(
      Object.entries(next.repoProjects).filter(([name]) => keep.has(name))
    );
  }
  writeJsonAtomic(filePath(userId), next);
  return next;
}

/**
 * Build the effective per-request configuration: org constants + the user's
 * personal config + derived lookups + the user's identity as "me".
 */
export function effectiveConfig(user) {
  const uc = loadUserConfig(user.id);
  const team = (uc.team || []).map((t) => t.toLowerCase());
  const repoProjects = uc.repoProjects || {};
  // repoName(lower) -> { project, projectId }; repos/pipelines carry their own
  // project so lists aggregate across every project (no active-project switch).
  const repoProjectMap = new Map(Object.entries(repoProjects));
  const pipelines = uc.pipelines || [];
  const pipelineProjectMap = new Map();
  for (const p of pipelines) {
    if (p.definitionId && p.project) pipelineProjectMap.set(String(p.definitionId), p.project);
  }

  // Monitored projects define the scope for ALL data. Fall back to the org
  // defaults if a user somehow has none. Only names are needed to run WIQL (the
  // wiql/workitems APIs are name-scoped); ids help build web URLs.
  const projects = (uc.projects && uc.projects.length ? uc.projects : defaults.projects).map((p) => ({ ...p }));
  const projectSet = new Set(projects.map((p) => p.name.toLowerCase()));
  // project name(lower) -> org base URL, so ADO calls hit the right organization.
  const projectOrgMap = new Map();
  for (const p of projects) projectOrgMap.set(p.name.toLowerCase(), p.org || DEFAULT_ORG);

  return {
    organizationUrl: config.organizationUrl,
    project: config.project, // org default (fallback for repos with no project)
    projectId: config.projectId,
    me: user,
    projects,
    projectSet,
    projectOrgMap,
    repositories: uc.repositories,
    repoProjects,
    repoProjectMap,
    pipelineProjectMap,
    team,
    teamSet: new Set(team),
    reviewerGroups: uc.reviewerGroups,
    groupNameToLabel: groupNameToLabel(uc.reviewerGroups),
    defaultTimeRangeMonths: uc.defaultTimeRangeMonths,
    pipelines,
    notificationPrefs: uc.notificationPrefs,
    commentTemplates: uc.commentTemplates || [],
    savedViews: uc.savedViews || [],
    mutedRepos: uc.mutedRepos || [],
    mutedRepoSet: new Set((uc.mutedRepos || []).map((r) => r.toLowerCase())),
    uiPrefs: uc.uiPrefs || { ...DEFAULT_UI_PREFS },
    slaDays: uc.slaDays || DEFAULT_SLA_DAYS,
    agents: { ...DEFAULT_AGENT_PREFS, ...(uc.agents || {}) },
    workItemSavedQueries: uc.workItemSavedQueries || [],
    // WI is scoped to the monitored projects (name + id + org).
    workItemProjects: projects.map((p) => ({ name: p.name, id: p.id, org: p.org || DEFAULT_ORG })),
    raw: uc,
  };
}
