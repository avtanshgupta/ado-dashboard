import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config, defaults, groupNameToLabel } from '../config.js';
import { writeJsonAtomic } from './atomicFile.js';

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
  email: false,
  browserPush: false, // C2 — desktop/browser notifications
  chat: false, // D1 — Slack/Teams webhook fan-out
  digest: 'off', // C3 — 'off' | 'daily' | 'weekly' summary email
};

// C3 digest cadence is the one non-boolean notification pref.
const NOTIF_PREF_ENUMS = { digest: new Set(['off', 'daily', 'weekly']) };

export const DEFAULT_UI_PREFS = {
  density: 'comfortable', // E5 — 'comfortable' | 'compact' table rows
  onboarded: false, // first-run guided tour: true once the user finishes/skips it
};
const UI_PREF_ENUMS = { density: new Set(['comfortable', 'compact']) };
const UI_PREF_BOOLS = new Set(['onboarded']);

export const DEFAULT_SLA_DAYS = 7; // B4 — idle days before a PR is "breaching SLA"

/** Short opaque id for user-created records (templates, saved views, webhooks). */
function rid() {
  return Math.random().toString(36).slice(2, 10);
}

function seed() {
  return {
    repositories: [...defaults.repositories],
    repoProjects: {}, // repoNameLower -> { project, projectId } for cross-project repos
    team: [...defaults.team],
    reviewerGroups: defaults.reviewerGroups.map((g) => ({ ...g })),
    defaultTimeRangeMonths: defaults.defaultTimeRangeMonths,
    pipelines: defaults.pipelines.map((p) => ({ ...p })),
    notificationPrefs: { ...DEFAULT_NOTIF_PREFS },
    commentTemplates: [], // A4
    savedViews: [], // E1
    chatWebhooks: [], // D1
    mutedRepos: [], // C4
    uiPrefs: { ...DEFAULT_UI_PREFS }, // E5
    slaDays: DEFAULT_SLA_DAYS, // B4
  };
}

/** Normalize a stored repoProjects map: { repoNameLower: { project, projectId } }. */
function normalizeRepoProjects(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out = {};
  for (const [name, meta] of Object.entries(v)) {
    if (!name || !meta || typeof meta !== 'object') continue;
    const project = typeof meta.project === 'string' ? meta.project.trim() : '';
    if (!project) continue;
    const projectId = typeof meta.projectId === 'string' ? meta.projectId.trim() : '';
    out[String(name).toLowerCase()] = { project, projectId };
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
    repositories: stored.repositories || [...defaults.repositories],
    repoProjects: normalizeRepoProjects(stored.repoProjects),
    team: stored.team || [...defaults.team],
    reviewerGroups: stored.reviewerGroups || defaults.reviewerGroups.map((g) => ({ ...g })),
    defaultTimeRangeMonths: stored.defaultTimeRangeMonths || defaults.defaultTimeRangeMonths,
    pipelines: stored.pipelines || defaults.pipelines.map((p) => ({ ...p })),
    notificationPrefs: { ...DEFAULT_NOTIF_PREFS, ...(stored.notificationPrefs || {}) },
    commentTemplates: Array.isArray(stored.commentTemplates) ? stored.commentTemplates : [],
    savedViews: Array.isArray(stored.savedViews) ? stored.savedViews : [],
    chatWebhooks: Array.isArray(stored.chatWebhooks) ? stored.chatWebhooks : [],
    mutedRepos: Array.isArray(stored.mutedRepos) ? stored.mutedRepos : [],
    uiPrefs: { ...DEFAULT_UI_PREFS, ...(stored.uiPrefs || {}) },
    slaDays: Number.isInteger(stored.slaDays) ? stored.slaDays : DEFAULT_SLA_DAYS,
  };
}

const ALLOWED_KEYS = [
  'repositories', 'repoProjects', 'team', 'reviewerGroups', 'defaultTimeRangeMonths', 'pipelines', 'notificationPrefs',
  'commentTemplates', 'savedViews', 'chatWebhooks', 'mutedRepos', 'uiPrefs', 'slaDays',
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
      out[String(name).toLowerCase()] = { project, projectId };
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
  if (partial.chatWebhooks !== undefined) clean.chatWebhooks = validateWebhooks(partial.chatWebhooks);
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

/** D1 — outbound chat webhooks: [{ id, type, url, name }]. */
function validateWebhooks(val) {
  if (!Array.isArray(val)) throw badRequest('chatWebhooks must be an array.');
  if (val.length > 20) throw badRequest('Too many chat webhooks (max 20).');
  return val.map((w, i) => {
    if (!w || typeof w !== 'object') throw badRequest(`chatWebhooks[${i}] must be an object.`);
    const type = w.type === 'teams' ? 'teams' : 'slack';
    const url = requireString(w.url, `chatWebhooks[${i}].url`, { max: 2000 });
    if (!/^https:\/\//i.test(url)) throw badRequest(`chatWebhooks[${i}].url must be an https URL.`);
    return {
      id: typeof w.id === 'string' && w.id.trim() ? w.id.trim() : rid(),
      type,
      url,
      name: typeof w.name === 'string' && w.name.trim() ? w.name.trim().slice(0, 80) : (type === 'teams' ? 'Teams' : 'Slack'),
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
  return {
    organizationUrl: config.organizationUrl,
    project: config.project, // org default (fallback for repos with no project)
    projectId: config.projectId,
    me: user,
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
    chatWebhooks: uc.chatWebhooks || [],
    mutedRepos: uc.mutedRepos || [],
    mutedRepoSet: new Set((uc.mutedRepos || []).map((r) => r.toLowerCase())),
    uiPrefs: uc.uiPrefs || { ...DEFAULT_UI_PREFS },
    slaDays: uc.slaDays || DEFAULT_SLA_DAYS,
    raw: uc,
  };
}
