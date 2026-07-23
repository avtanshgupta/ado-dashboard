import { currentUser } from '../lib/context.js';
import { appendAudit } from '../lib/auditLog.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// High-frequency, low-value or non-mutating-in-spirit endpoints we don't audit:
// notification polling/reads, cache refresh, the SSE stream, and the personal
// follow/snooze/dismiss overlay. Everything else that changes state is recorded.
const SKIP = [
  /\/notifications\//,
  /\/refresh$/,
  /\/stream$/,
  /\/follows(\/|$)/,
  /\/action-center\/(snooze|dismiss)(\/|$)/,
];

/**
 * Records an audit entry for every state-changing API request (B2). Must be
 * mounted AFTER sessionContext so `currentUser()` is available. We capture the
 * user id synchronously (inside the request's AsyncLocalStorage context) and log
 * on `res.finish`, when the outcome status is known.
 */
export function auditLogger(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const user = currentUser();
  const userId = user?.id;
  const path = req.originalUrl.split('?')[0];
  if (!userId || SKIP.some((re) => re.test(path))) return next();

  const startedAt = Date.now();
  res.on('finish', () => {
    appendAudit(userId, {
      method: req.method,
      path,
      status: res.statusCode,
      ok: res.statusCode < 400,
      ms: Date.now() - startedAt,
    });
  });
  next();
}
