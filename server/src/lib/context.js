import { AsyncLocalStorage } from 'node:async_hooks';

// Per-request context: { authHeader, user, userConfig }
export const als = new AsyncLocalStorage();

export function getCtx() {
  return als.getStore() || null;
}

export function runWithCtx(store, fn) {
  return als.run(store, fn);
}

/** The authenticated user's identity for the current request. */
export function currentUser() {
  return getCtx()?.user || null;
}

/** The effective (per-user) configuration for the current request. */
export function currentConfig() {
  return getCtx()?.userConfig || null;
}

/** The Authorization header to use for ADO calls in the current request. */
export function currentAuthHeader() {
  return getCtx()?.authHeader || null;
}

/**
 * Record a per-request "partial failure" — one data source (e.g. a repo or
 * project) that failed while others succeeded, so the request can still return
 * useful data. Collected on the request context and surfaced to the client as an
 * `X-Partial-Errors` header. A no-op when there is no active request context
 * (e.g. in unit tests), so callers never need to guard.
 */
export function recordPartial(source, message) {
  const ctx = getCtx();
  if (!ctx) return;
  if (!ctx.partials) ctx.partials = [];
  // Cap so a storm of failures can't bloat the header.
  if (ctx.partials.length < 50) {
    ctx.partials.push({ source: String(source || 'unknown'), message: String(message || 'Failed to load') });
  }
}

/** The partial failures recorded during the current request (may be empty). */
export function getPartials() {
  return getCtx()?.partials || [];
}
