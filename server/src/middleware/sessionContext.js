import { config } from '../config.js';
import { runWithCtx } from '../lib/context.js';
import { effectiveConfig } from '../lib/userConfig.js';
import { readCookie } from '../lib/cookies.js';
import { getSession, getVaultToken, getGraphToken } from '../lib/sessions.js';
import { resolveIdentityFromAuth } from '../lib/identity.js';
import { isAllowed } from '../lib/access.js';
import { getAzToken, getAzGraphToken } from '../lib/tokenManager.js';

const COOKIE = config.cookieName;

// Cache the locally-resolved `az` identity (local dev: one user, rarely changes).
let azUser = null;
let azUserAt = 0;
async function resolveAzUser() {
  if (azUser && Date.now() - azUserAt < 60 * 60 * 1000) return azUser;
  const token = await getAzToken();
  const user = await resolveIdentityFromAuth(`Bearer ${token}`);
  azUser = user;
  azUserAt = Date.now();
  return user;
}

function unauth(res, status, code, message) {
  res.status(status).json({ error: message, status, code });
}

/**
 * Establish the per-request context for an authenticated user.
 *  1. A browser session cookie → the user's vaulted Azure token.
 *  2. Otherwise the host `az` CLI (local development).
 * Surfaces a machine-readable `code` (no_session / token_expired / forbidden)
 * so the SPA can show the right prompt without losing its place.
 */
export async function sessionContext(req, res, next) {
  try {
    const session = getSession(readCookie(req, COOKIE));
    let authHeader;
    let user;

    if (session) {
      const v = getVaultToken(session.userId);
      if (!v) return unauth(res, 401, 'no_session', 'Your session has no token. Paste a fresh Azure access token to continue.');
      if (v.expiresAt <= Date.now()) return unauth(res, 401, 'token_expired', 'Your Azure access token expired. Paste a fresh one to continue.');
      authHeader = `Bearer ${v.token}`;
      user = session.user;
    } else {
      // Local fallback: reuse the developer's `az login`.
      if (config.disableAzFallback) return unauth(res, 401, 'no_session', 'Sign in: paste an Azure DevOps access token.');
      try {
        user = await resolveAzUser();
        authHeader = `Bearer ${await getAzToken()}`;
      } catch {
        return unauth(res, 401, 'no_session', 'Sign in: paste an Azure DevOps access token.');
      }
    }

    // The one login gate: the user must be a member of the configured group.
    if (!(await isAllowed(authHeader, user))) {
      return unauth(res, 403, 'forbidden', `${user.uniqueName || user.displayName} isn't a member of ${config.allowedGroupAlias}.`);
    }

    runWithCtx({ authHeader, user, userConfig: effectiveConfig(user), graphToken: await resolveGraphToken(session, user) }, () => next());
  } catch (err) {
    const status = err.status || 500;
    if (status === 401) return unauth(res, 401, 'token_expired', err.message || 'Your Azure access token expired. Paste a fresh one to continue.');
    res.status(status).json({ error: err.message, status });
  }
}

/** Eagerly resolve the local `az` identity at startup (best-effort). */
export async function warmIdentity() {
  return resolveAzUser();
}

/**
 * Best-effort Graph token resolution for Microsoft To Do integration.
 * Returns the token string if available, null otherwise (planning features
 * will show a "Connect To Do" prompt). Never blocks authentication.
 */
async function resolveGraphToken(session, user) {
  try {
    if (session) {
      const gt = getGraphToken(session.userId);
      if (gt && gt.expiresAt > Date.now()) return gt.token;
      return null;
    }
    // Local dev: try `az account get-access-token --resource https://graph.microsoft.com`
    if (!config.disableAzFallback) {
      return await getAzGraphToken();
    }
  } catch {
    // Graph token is optional — planning features degrade gracefully.
  }
  return null;
}
