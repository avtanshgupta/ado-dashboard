import express from 'express';
import cors from 'cors';
import dns from 'node:dns';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import apiRouter from './routes/api.js';
import authRouter from './routes/auth.js';
import agentsRouter, { heartbeatRouter } from './routes/agents.js';
import { sessionContext, warmIdentity } from './middleware/sessionContext.js';
import { csrfGuard } from './middleware/csrf.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { auditLogger } from './middleware/auditLog.js';
import { createRateLimit } from './middleware/rateLimit.js';

// Prefer IPv4 in DNS resolution — some networks (incl. local dev machines) time
// out on IPv6 routes to dev.azure.com/*.visualstudio.com, which surfaces as
// "fetch failed / Connect Timeout Error". Harmless everywhere else.
dns.setDefaultResultOrder('ipv4first');

const app = express();

// When hosted behind a TLS-terminating proxy (Azure App Service), trust the
// first hop so `req.ip` (rate limiting) and secure cookies resolve correctly.
if (config.cookieSecure) app.set('trust proxy', 1);

// Baseline security headers (CSP, nosniff, frame-deny, HSTS-when-secure) on every
// response, including the served SPA.
app.use(securityHeaders);


// The SPA is served same-origin (prod) or via the Vite proxy (dev), so CORS is
// only exercised by cross-origin callers. Restrict it to configured origins
// (ALLOWED_ORIGINS, comma-separated) or localhost in dev — no wildcard.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const localhostOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
app.use(
  cors({
    origin(origin, cb) {
      // No Origin header = same-origin / curl / server-to-server → allow.
      if (!origin) return cb(null, true);
      const ok = allowedOrigins.length ? allowedOrigins.includes(origin) : localhostOrigin.test(origin);
      return cb(null, ok);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Defensive rate limit on state-changing API calls (B1): blunts runaway loops
// and abuse without throttling normal browsing. GETs are unaffected; the ceiling
// is generous enough for bulk actions across many selected PRs.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const mutationLimiter = createRateLimit({ windowMs: 60_000, max: 300, name: 'api-mutation' });
const mutationGuard = (req, res, next) => (SAFE_METHODS.has(req.method) ? next() : mutationLimiter(req, res, next));

// Auth endpoints are public (they establish or refresh the session) and are
// intentionally exempt from the CSRF header check (the token authorizes them).
app.use('/api/auth', authRouter);

// Reporter heartbeat is authenticated by a per-user API key (headless VMs with
// no browser session). It MUST be mounted before the '/api' session-guarded
// mount below: that mount's path ('/api') is a prefix of '/api/agents/heartbeat',
// so its sessionContext would otherwise reject the cookieless reporter with 401.
app.use('/api/agents/heartbeat', csrfGuard, heartbeatRouter);

// Every /api request runs in an authenticated session context, and any
// state-changing call must carry the CSRF header, is rate-limited, and audited.
app.use('/api', csrfGuard, mutationGuard, sessionContext, auditLogger, apiRouter);

// Agent session routes (also behind session context + CSRF + limit + audit).
app.use('/api/agents', csrfGuard, mutationGuard, sessionContext, auditLogger, agentsRouter);

// Serve the built frontend when present (production / single-process mode).
const webDist = join(config.serverRoot, '..', 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(join(webDist, 'index.html'));
  });
}

app.listen(config.port, () => {
  console.log(`\n  ADO PR Dashboard (multi-user) on http://localhost:${config.port}`);
  if (existsSync(webDist)) console.log('  Serving UI from web/dist');
  console.log('');
  // Only probe the local `az` CLI when the local fallback is actually enabled;
  // hosted deployments (DISABLE_AZ_FALLBACK=true) never use it.
  if (config.disableAzFallback) {
    console.log('  Local `az` fallback disabled — users sign in by pasting an Azure token.\n');
    return;
  }
  warmIdentity()
    .then((u) => console.log(`  Local az identity: ${u.displayName} <${u.uniqueName}>\n`))
    .catch(() => console.log('  No local `az` session — sign in from the web UI by pasting an Azure token.\n'));
});