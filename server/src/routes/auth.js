import { Router } from 'express';
import { config } from '../config.js';
import { resolveIdentityFromAuth } from '../lib/identity.js';
import { isAllowed, forgetMembership } from '../lib/access.js';
import {
  decodeTokenExpiry,
  putToken,
  getVaultToken,
  createSession,
  rotateSession,
  getSession,
  destroySession,
} from '../lib/sessions.js';
import { readCookie } from '../lib/cookies.js';
import { getAzToken } from '../lib/tokenManager.js';
import { createRateLimit } from '../middleware/rateLimit.js';

const router = Router();
const COOKIE = config.cookieName;

// Throttle credential submission (brute-force defense) without touching the
// frequently-polled /me probe. Scoped to the token-accepting POST routes.
const authLimiter = createRateLimit({ windowMs: 5 * 60 * 1000, max: 60, name: 'auth' });

const cookieOpts = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.cookieSecure,
  path: '/',
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days; the *token* inside still expires
};

/** Validate a pasted access token, enforce the allow-list, and store it. */
async function acceptToken(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) {
    const e = new Error('No token provided.');
    e.status = 400;
    throw e;
  }
  if (token.split('.').length !== 3) {
    const e = new Error(
      "That doesn't look like an Azure access token (a JWT with three dot-separated parts). Copy the accessToken value from `az account get-access-token`."
    );
    e.status = 400;
    throw e;
  }
  const user = await resolveIdentityFromAuth(`Bearer ${token}`);
  if (!(await isAllowed(`Bearer ${token}`, user))) {
    const e = new Error(
      `This dashboard is restricted to members of ${config.allowedGroupAlias}. ${user.uniqueName || user.displayName} isn't a member.`
    );
    e.status = 403;
    throw e;
  }
  // Require a readable expiry: an Azure token always carries an `exp` claim, so a
  // token we can't decode is malformed — reject it rather than guessing a
  // lifetime that could keep a dead/forged token "valid" in the vault (G34).
  const expiresAt = decodeTokenExpiry(token);
  if (!expiresAt) {
    const e = new Error(
      "Couldn't read the token's expiry. Re-copy the accessToken value from `az account get-access-token` and try again."
    );
    e.status = 400;
    throw e;
  }
  putToken(user.id, token, expiresAt);
  return { user, expiresAt };
}

const fail = (res, e) => res.status(e.status || 500).json({ error: e.message, status: e.status || 500 });

// First sign-in: validate the token and start a browser session.
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { user, expiresAt } = await acceptToken((req.body || {}).token);
    const sid = createSession(user);
    res.cookie(COOKIE, sid, cookieOpts);
    res.json({ user, expiresAt });
  } catch (e) {
    fail(res, e);
  }
});

// Refresh the stored token for a user. Used by the re-paste banner AND the
// local token-pusher helper (which has no cookie — the token itself authorizes).
router.post('/token', authLimiter, async (req, res) => {
  try {
    const { user, expiresAt } = await acceptToken((req.body || {}).token);
    const oldSid = readCookie(req, COOKIE);
    const existing = getSession(oldSid);
    // Re-authenticating a live browser session → rotate the sid so a previously
    // captured cookie can't be replayed. No/foreign session (e.g. the headless
    // token-pusher) → just mint one; the pusher ignores the cookie.
    const sid =
      existing && existing.userId === user.id
        ? rotateSession(oldSid, user)
        : createSession(user);
    res.cookie(COOKIE, sid, cookieOpts);
    res.json({ user, expiresAt });
  } catch (e) {
    fail(res, e);
  }
});

router.post('/logout', (req, res) => {
  const sid = readCookie(req, COOKIE);
  const session = getSession(sid);
  if (session?.user) forgetMembership(session.user);
  destroySession(sid);
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

// Bootstrap probe. Always 200 with an `authenticated` flag so the SPA can
// decide between the login screen, the ready app, or the re-paste banner.
router.get('/me', async (req, res) => {
  const sid = readCookie(req, COOKIE);
  const session = getSession(sid);
  if (session) {
    const v = getVaultToken(session.userId);
    if (v && v.expiresAt > Date.now()) {
      return res.json({ authenticated: true, source: 'session', user: session.user, tokenExpiresAt: v.expiresAt });
    }
    return res.json({
      authenticated: false,
      reason: 'token_expired',
      user: session.user,
      tokenExpiresAt: v?.expiresAt || null,
    });
  }
  // No browser session — fall back to the host `az` CLI (local development).
  if (config.disableAzFallback) return res.json({ authenticated: false, reason: 'no_session' });
  try {
    const token = await getAzToken();
    const user = await resolveIdentityFromAuth(`Bearer ${token}`);
    if (!(await isAllowed(`Bearer ${token}`, user))) return res.json({ authenticated: false, reason: 'forbidden', user });
    return res.json({ authenticated: true, source: 'az', user });
  } catch {
    return res.json({ authenticated: false, reason: 'no_session' });
  }
});

export default router;
