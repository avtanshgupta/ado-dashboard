import { AsyncLocalStorage } from 'node:async_hooks';

// Per-request context: { authHeader, user, userConfig, graphToken }
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

/** The Microsoft Graph bearer token for the current request (To Do, Planner). */
export function currentGraphToken() {
  return getCtx()?.graphToken || null;
}
