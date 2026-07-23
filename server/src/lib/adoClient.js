import { AsyncResource } from 'node:async_hooks';
import { config, apiVersion } from '../config.js';
import { currentAuthHeader, currentUser, currentConfig } from './context.js';

// ---- tiny concurrency limiter (context-preserving) ----
function createLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      // Preserve the calling request's AsyncLocalStorage context even though
      // the task may run later from a different task's continuation.
      queue.push({ fn: AsyncResource.bind(fn), resolve, reject });
      next();
    });
}
export const limit = createLimiter(config.fetchConcurrency || 8);

// ---- short-TTL GET cache (scoped per user) ----
const cache = new Map(); // key -> { value, expires }
const userCounts = new Map(); // uid -> number of cached entries (for per-user fairness)
const TTL = (config.cacheTtlSeconds || 45) * 1000;
// Hard cap so the cache can't grow unbounded (e.g. many users / many URLs).
// Map preserves insertion order, so eviction is FIFO once over the cap.
const MAX_CACHE_ENTRIES = 5000;
// No single user may hold more than this many entries, so one heavy user can't
// evict everyone else's cache out from under them (A5).
const MAX_PER_USER = 1500;

function userKey(url) {
  const uid = currentUser()?.id || 'anon';
  return `${uid}::${url}`;
}
/** The owning user id encoded at the front of a cache key. */
function uidOf(key) {
  const i = key.indexOf('::');
  return i === -1 ? 'anon' : key.slice(0, i);
}
/** Single deletion path so per-user counts stay in sync with the cache Map. */
function cacheDelete(key) {
  if (!cache.has(key)) return;
  cache.delete(key);
  const uid = uidOf(key);
  const n = (userCounts.get(uid) || 1) - 1;
  if (n <= 0) userCounts.delete(uid);
  else userCounts.set(uid, n);
}
/** Evict a single user's oldest entry (first insertion-ordered key they own). */
function evictOldestForUser(uid) {
  for (const k of cache.keys()) {
    if (uidOf(k) === uid) {
      cacheDelete(k);
      return;
    }
  }
}
function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (hit) cacheDelete(key);
  return undefined;
}
function cacheSet(key, value) {
  // Refresh insertion order on re-set so hot keys survive FIFO eviction.
  if (cache.has(key)) cacheDelete(key);
  cache.set(key, { value, expires: Date.now() + TTL });
  const uid = uidOf(key);
  userCounts.set(uid, (userCounts.get(uid) || 0) + 1);
  // Per-user fairness cap first, then the global cap.
  while ((userCounts.get(uid) || 0) > MAX_PER_USER) evictOldestForUser(uid);
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cacheDelete(oldest);
  }
}
export function clearCache() {
  // Clear only the current user's cached entries.
  const uid = currentUser()?.id || 'anon';
  const prefix = `${uid}::`;
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cacheDelete(k);
}

// ---- URL helpers (multi-org aware) ----
// The DEFAULT org base (used for identity/access checks and as a fallback). Each
// project carries its own org base (currentConfig().projectOrgMap), so data can
// be fetched from whichever organization owns the project.
const ORG = config.organizationUrl.replace(/\/$/, '');

// The default project (org-level fallback). Repos and pipelines carry their own
// project so repos/pipelines from every project can appear in the same lists.
function defaultProject() {
  return currentConfig()?.project || config.project;
}
function enc(project) {
  return encodeURIComponent(project || defaultProject());
}

/** Org base URL that owns a project (multi-org). Falls back to the default org. */
export function orgBaseForProject(project) {
  const cfg = currentConfig();
  return cfg?.projectOrgMap?.get(String(project || '').toLowerCase()) || ORG;
}

/**
 * Resolve the { project, projectId, org } that owns a repository. Repos are
 * tracked with their project + org (see userConfig.repoProjects); anything
 * unknown falls back to the org default project / default org.
 */
export function projectForRepo(repo) {
  const cfg = currentConfig();
  const hit = cfg?.repoProjectMap?.get(String(repo || '').toLowerCase());
  const project = hit?.project || cfg?.project || config.project;
  const org = hit?.org || cfg?.projectOrgMap?.get(String(project).toLowerCase()) || ORG;
  return {
    project,
    projectId: hit?.projectId || cfg?.projectId || config.projectId,
    org,
  };
}

/** Resolve the project name that owns a pipeline definition. */
export function projectForDefinition(definitionId) {
  const cfg = currentConfig();
  return cfg?.pipelineProjectMap?.get(String(definitionId)) || defaultProject();
}

export function gitUrl(repo, subpath = '') {
  const { project, org } = projectForRepo(repo);
  const tail = subpath ? `/${subpath}` : '';
  return `${org}/${enc(project)}/_apis/git/repositories/${encodeURIComponent(repo)}${tail}`;
}
export function policyUrl(subpath, project) {
  return `${orgBaseForProject(project)}/${enc(project)}/_apis/policy/${subpath}`;
}
export function buildApiUrl(subpath, project) {
  return `${orgBaseForProject(project)}/${enc(project)}/_apis/build/${subpath}`;
}
/** Work Item Tracking API URL (project-scoped, org-aware). */
export function witUrl(subpath, project) {
  return `${orgBaseForProject(project)}/${enc(project)}/_apis/wit/${subpath}`;
}
/** Web URL for a build/pipeline run. */
export function buildWebUrl(buildId, project) {
  return `${orgBaseForProject(project)}/${enc(project)}/_build/results?buildId=${buildId}&view=results`;
}
/** Web URL for a pipeline definition. */
export function definitionWebUrl(definitionId, project) {
  return `${orgBaseForProject(project)}/${enc(project)}/_build?definitionId=${definitionId}`;
}
/** Org-level URL on the DEFAULT org (identity, access, default-org projects). */
export function orgUrl(subpath) {
  return `${ORG}/${subpath}`;
}
/** Org-level URL on a specific org base (multi-org work-item hydration, etc.). */
export function orgApiUrl(orgBase, subpath) {
  return `${(orgBase || ORG).replace(/\/$/, '')}/${subpath}`;
}

function buildUrl(url, query) {
  const u = new URL(url);
  if (!u.searchParams.has('api-version')) {
    u.searchParams.set('api-version', query?.['api-version'] || apiVersion);
  }
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      u.searchParams.set(k, String(v));
    }
  }
  return u.toString();
}

export class AdoError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'AdoError';
    this.status = status;
    this.body = body;
  }
}

// ---- retry / backoff ----
// Retry throttling (429) and transient gateway errors. Mutating requests are
// only retried on 429 (throttled → the request never executed, so it's safe);
// 5xx/network errors are NOT retried for non-GET to avoid double-submits.
const MAX_RETRIES = 4;
const RETRYABLE_GATEWAY = new Set([502, 503, 504]);
const MAX_BACKOFF_MS = 20000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Retry-After can be seconds or an HTTP date; clamp to a sane ceiling. */
function retryAfterMs(res) {
  const h = res.headers.get('retry-after');
  if (!h) return null;
  const secs = Number(h);
  if (Number.isFinite(secs)) return Math.min(secs * 1000, 60000);
  const when = Date.parse(h);
  if (!Number.isNaN(when)) return Math.max(0, Math.min(when - Date.now(), 60000));
  return null;
}

function backoffMs(attempt) {
  const base = Math.min(500 * 2 ** attempt, MAX_BACKOFF_MS);
  return base + Math.floor(Math.random() * 250); // full-ish jitter
}

async function rawFetch(method, url, { query, body, contentType } = {}) {
  const auth = currentAuthHeader();
  if (!auth) throw new AdoError('Not authenticated', 401, null);
  const finalUrl = buildUrl(url, query);
  const headers = {
    Authorization: auth,
    Accept: 'application/json',
  };
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = contentType || 'application/json';
    init.body = JSON.stringify(body);
  }

  const idempotent = method === 'GET';
  let lastNetworkErr = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res;
    try {
      res = await fetch(finalUrl, init);
    } catch (err) {
      // Network/transient error. Retry only for idempotent (GET) requests.
      lastNetworkErr = err;
      if (idempotent && attempt < MAX_RETRIES) {
        console.warn(`[ado] network error (attempt ${attempt + 1}/${MAX_RETRIES}) ${method} ${finalUrl}: ${err.message}`);
        await sleep(backoffMs(attempt));
        continue;
      }
      throw new AdoError(`Network error calling Azure DevOps: ${err.message}`, 0, null);
    }

    const throttled = res.status === 429;
    const gatewayGlitch = idempotent && RETRYABLE_GATEWAY.has(res.status);
    if ((throttled || gatewayGlitch) && attempt < MAX_RETRIES) {
      const wait = retryAfterMs(res) ?? backoffMs(attempt);
      console.warn(`[ado] ${res.status}${throttled ? ' throttled' : ''} — retrying in ${Math.round(wait)}ms (attempt ${attempt + 1}/${MAX_RETRIES}) ${method} ${finalUrl}`);
      await sleep(wait);
      continue;
    }

    if (res.status === 203) {
      // ADO returns 203 + sign-in HTML when the token is invalid/expired.
      throw new AdoError('Your Azure DevOps session is invalid or expired. Please sign in again.', 401, null);
    }
    const text = await res.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      const msg =
        (parsed && parsed.message) ||
        (typeof parsed === 'string' ? parsed.slice(0, 200) : res.statusText);
      throw new AdoError(msg, res.status, parsed);
    }
    return parsed;
  }

  // Exhausted retries.
  if (lastNetworkErr) throw new AdoError(`Network error calling Azure DevOps: ${lastNetworkErr.message}`, 0, null);
  throw new AdoError('Azure DevOps request failed after retries (throttled or unavailable).', 503, null);
}

/** GET with per-user caching. */
export async function adoGet(url, { query, cache: useCache = true } = {}) {
  const key = userKey(buildUrl(url, query));
  if (useCache) {
    const hit = cacheGet(key);
    if (hit !== undefined) return hit;
  }
  return limit(async () => {
    if (useCache) {
      const hit = cacheGet(key);
      if (hit !== undefined) return hit;
    }
    const value = await rawFetch('GET', url, { query });
    if (useCache) cacheSet(key, value);
    return value;
  });
}

/** Mutating request (PATCH/POST/PUT). Never cached; invalidates cache on success. */
export async function adoSend(method, url, body, { query, contentType } = {}) {
  return limit(async () => {
    const value = await rawFetch(method, url, { query, body, contentType });
    clearCache();
    return value;
  });
}

/**
 * Read-only POST (e.g. WIQL, work-item batch) with per-user caching. Unlike
 * adoSend it does NOT clear the cache — the endpoint only reads — so polling
 * these queries won't churn other cached GETs. Cache key includes the body.
 */
export async function adoQuery(url, body, { query, cache: useCache = true } = {}) {
  const key = userKey(`POST ${buildUrl(url, query)} ${JSON.stringify(body || {})}`);
  if (useCache) {
    const hit = cacheGet(key);
    if (hit !== undefined) return hit;
  }
  return limit(async () => {
    if (useCache) {
      const hit = cacheGet(key);
      if (hit !== undefined) return hit;
    }
    const value = await rawFetch('POST', url, { query, body });
    if (useCache) cacheSet(key, value);
    return value;
  });
}
