// Client-side stale-while-revalidate cache. Holds the last successful payload
// for a key so revisiting a page can render instantly while fresh data loads in
// the background. In-memory for the session, mirrored to sessionStorage (best
// effort) so a full page reload still shows the last data immediately.
//
// sessionStorage (not localStorage) is deliberate: it is per-tab and clears when
// the tab closes, so cached data can't linger across users sharing a device.

const NS = 'ado-swr-v1';
const MAX_ENTRIES = 60;

let mem = null;

function load() {
  if (mem) return mem;
  try {
    mem = JSON.parse(sessionStorage.getItem(NS)) || {};
  } catch {
    mem = {};
  }
  return mem;
}

function persist() {
  const m = load();
  const keys = Object.keys(m);
  if (keys.length > MAX_ENTRIES) {
    keys.sort((a, b) => (m[a].ts || 0) - (m[b].ts || 0));
    for (const k of keys.slice(0, keys.length - MAX_ENTRIES)) delete m[k];
  }
  try {
    sessionStorage.setItem(NS, JSON.stringify(m));
  } catch {
    // Quota exceeded (large lists) — drop half the oldest entries and retry once.
    try {
      const ks = Object.keys(m).sort((a, b) => (m[a].ts || 0) - (m[b].ts || 0));
      for (const k of ks.slice(0, Math.ceil(ks.length / 2))) delete m[k];
      sessionStorage.setItem(NS, JSON.stringify(m));
    } catch {
      /* give up on persistence; in-memory cache still works this session */
    }
  }
}

/** Cached payload for a key, or undefined when absent. */
export function cacheGet(key) {
  if (!key) return undefined;
  const hit = load()[key];
  return hit ? hit.data : undefined;
}

/** Store a payload for a key (timestamped for FIFO eviction). */
export function cacheSet(key, data) {
  if (!key) return;
  const m = load();
  m[key] = { data, ts: Date.now() };
  persist();
}

/** Wipe the whole cache (call on sign-out so no data survives a user switch). */
export function cacheClear() {
  mem = {};
  try {
    sessionStorage.removeItem(NS);
  } catch {
    /* ignore */
  }
}

/** Remove one cached key. Returns true if it existed. */
export function cacheInvalidate(key) {
  if (!key) return false;
  const m = load();
  if (!(key in m)) return false;
  delete m[key];
  persist();
  return true;
}

/**
 * Remove every cached key that starts with `prefix`. Used for mutation-aware
 * invalidation: after a write, the client drops the stale list/overview payloads
 * it derived from the old state so the next render fetches fresh data instead of
 * flashing a pre-mutation snapshot. Returns the number of entries removed.
 */
export function cacheInvalidatePrefix(prefix) {
  if (!prefix) return 0;
  const m = load();
  let n = 0;
  for (const k of Object.keys(m)) {
    if (k.startsWith(prefix)) {
      delete m[k];
      n += 1;
    }
  }
  if (n) persist();
  return n;
}

/** Snapshot of the current cache keys (mainly for tests / debugging). */
export function cacheKeys() {
  return Object.keys(load());
}
