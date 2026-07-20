/**
 * Minimal in-memory fixed-window rate limiter (no external dependency).
 *
 * Keyed by client IP; each key gets `max` requests per `windowMs`. Intended to
 * blunt brute-force/abuse on auth and state-changing endpoints — not a
 * distributed quota system. On multi-instance hosting each process keeps its own
 * counters (acceptable for a defensive floor). Over-limit requests get a 429 with
 * a `Retry-After` header.
 */
export function createRateLimit({ windowMs = 60_000, max = 60, name = 'rate' } = {}) {
  const hits = new Map(); // key -> { count, resetAt }

  function sweep(now) {
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }

  // Derive a stable per-client key. Azure App Service appends the client port to
  // the forwarded address ("1.2.3.4:5678"), which would otherwise make every
  // request from one client look like a new IP; strip the trailing IPv4 port.
  function clientKey(req) {
    let ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const m = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(ip);
    if (m) ip = m[1];
    return ip;
  }

  return function rateLimit(req, res, next) {
    const now = Date.now();
    // Opportunistic cleanup so the map can't grow unbounded.
    if (hits.size > 5000) sweep(now);

    const key = `${name}:${clientKey(req)}`;
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;

    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({
        error: 'Too many requests — please slow down and try again shortly.',
        status: 429,
        code: 'rate_limited',
      });
    }
    return next();
  };
}
