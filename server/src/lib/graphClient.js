/**
 * Microsoft Graph API HTTP client.
 * Mirrors the adoClient.js pattern: per-user auth via AsyncLocalStorage context,
 * bounded concurrency, short-TTL cache, retry + backoff.
 */
import { AsyncResource } from 'node:async_hooks';
import { currentUser } from './context.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

// ---- concurrency limiter (same pattern as adoClient) ----
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
      .finally(() => { active--; next(); });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn: AsyncResource.bind(fn), resolve, reject });
      next();
    });
}
const limit = createLimiter(4);

// ---- short-TTL cache (per-user) ----
const cache = new Map();
const TTL = 30_000; // 30s
const MAX_ENTRIES = 2000;

function userKey(url) {
  const uid = currentUser()?.id || 'anon';
  return `graph::${uid}::${url}`;
}
function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (hit) cache.delete(key);
  return undefined;
}
function cacheSet(key, value) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, { value, expires: Date.now() + TTL });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}
export function clearGraphCache() {
  const uid = currentUser()?.id || 'anon';
  const prefix = `graph::${uid}::`;
  for (const k of cache.keys()) if (k.startsWith(prefix)) cache.delete(k);
}

// ---- error class ----
export class GraphError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'GraphError';
    this.status = status;
    this.body = body;
  }
}

// ---- retry helpers ----
const MAX_RETRIES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function backoffMs(attempt) {
  return Math.min(500 * 2 ** attempt, 10000) + Math.floor(Math.random() * 200);
}

// ---- Graph token retrieval ----
// The Graph token is stored alongside the ADO token in the context.
import { currentGraphToken } from './context.js';

// ---- core fetch ----
async function rawFetch(method, path, { body, query } = {}) {
  const token = currentGraphToken();
  if (!token) {
    throw new GraphError(
      'Microsoft Graph not connected. Please connect Microsoft To Do in Settings.',
      401,
      null
    );
  }

  let url = path.startsWith('http') ? path : `${GRAPH_BASE}${path}`;
  if (query) {
    const u = new URL(url);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    }
    url = u.toString();
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res;
    try {
      res = await fetch(url, init);
    } catch (err) {
      if (method === 'GET' && attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw new GraphError(`Network error calling Microsoft Graph: ${err.message}`, 0, null);
    }

    if (res.status === 429 && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('retry-after') || '2');
      await sleep(retryAfter * 1000);
      continue;
    }

    if (res.status === 204) return null;

    const text = await res.text();
    let parsed = null;
    if (text) {
      try { parsed = JSON.parse(text); } catch { parsed = text; }
    }

    if (!res.ok) {
      const msg = parsed?.error?.message || (typeof parsed === 'string' ? parsed.slice(0, 200) : res.statusText);
      throw new GraphError(msg, res.status, parsed);
    }
    return parsed;
  }

  throw new GraphError('Microsoft Graph request failed after retries.', 503, null);
}

/** GET with per-user cache. */
export async function graphGet(path, { query, useCache = true } = {}) {
  const cacheKey = userKey(`${path}${JSON.stringify(query || {})}`);
  if (useCache) {
    const hit = cacheGet(cacheKey);
    if (hit !== undefined) return hit;
  }
  return limit(async () => {
    if (useCache) {
      const hit = cacheGet(cacheKey);
      if (hit !== undefined) return hit;
    }
    const value = await rawFetch('GET', path, { query });
    if (useCache) cacheSet(cacheKey, value);
    return value;
  });
}

/** POST (create). */
export async function graphPost(path, body) {
  return limit(async () => {
    const value = await rawFetch('POST', path, { body });
    clearGraphCache();
    return value;
  });
}

/** PATCH (update). */
export async function graphPatch(path, body) {
  return limit(async () => {
    const value = await rawFetch('PATCH', path, { body });
    clearGraphCache();
    return value;
  });
}

/** DELETE. */
export async function graphDelete(path) {
  return limit(async () => {
    await rawFetch('DELETE', path);
    clearGraphCache();
  });
}
