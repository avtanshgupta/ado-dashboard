const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection via the OWASP "custom request header" pattern.
 *
 * State-changing requests must carry an `X-Requested-With` header. Browsers
 * cannot set custom headers on cross-origin requests without a CORS preflight,
 * which our origin policy won't grant to untrusted sites — so a malicious page
 * can't forge an authenticated merge/vote/requeue using the session cookie.
 * (Combined with the session cookie's sameSite=lax, this is defense-in-depth.)
 *
 * Mounted only on the app API routes, so `/api/auth/*` (session establishment,
 * incl. the curl-based token-pusher helper) is unaffected.
 */
export function csrfGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.get('x-requested-with')) return next();
  return res.status(403).json({
    error: 'Request blocked: missing X-Requested-With header (CSRF protection).',
    status: 403,
    code: 'csrf',
  });
}
