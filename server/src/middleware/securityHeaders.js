import { config } from '../config.js';

/**
 * Baseline security response headers (hand-rolled to avoid a helmet dependency,
 * matching the project's minimal-dep convention).
 *
 * The SPA bundles all scripts (no inline <script>), so `script-src 'self'` holds;
 * React uses inline element styles, so `style-src` allows 'unsafe-inline'. ADO
 * identity avatars load directly from the org over HTTPS, so `img-src` allows
 * https:. The API is same-origin, so `connect-src 'self'` is sufficient. HSTS is
 * only meaningful over TLS, so it's emitted only when cookies are marked secure.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(_req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (config.cookieSecure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}
