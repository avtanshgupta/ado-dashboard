import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverRoot = join(__dirname, '..');

// Minimal .env loader (avoids an extra dependency).
function loadDotEnv() {
  const envPath = join(serverRoot, '.env');
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv();

const appConfig = JSON.parse(readFileSync(join(serverRoot, 'config', 'app.config.json'), 'utf8'));

// Defaults used to seed the user's personal config on first run.
export const defaults = {
  repositories: appConfig.repositories,
  team: appConfig.team,
  reviewerGroups: appConfig.reviewerGroups || [],
  defaultTimeRangeMonths: appConfig.defaultTimeRangeMonths || 6,
  pipelines: appConfig.pipelines || [],
};

export const config = {
  // ---- org-level constants ----
  organizationUrl: appConfig.organizationUrl,
  project: appConfig.project,
  projectId: appConfig.projectId,
  // Optional multi-project support (F2). Defaults to the single configured
  // project so behaviour is unchanged unless `projects` is set in app.config.
  projects:
    Array.isArray(appConfig.projects) && appConfig.projects.length
      ? appConfig.projects.map((p) => ({ name: p.name, id: p.id || '' }))
      : [{ name: appConfig.project, id: appConfig.projectId }],
  adoResourceId: appConfig.adoResourceId,
  defaults,
  // ---- infra ----
  port: Number(process.env.PORT || 4000),
  serverRoot,
  // Where user/session/notification state is written. On Azure this must point
  // at persistent storage (e.g. /home/data) so deploys & restarts don't wipe
  // logins. Defaults to <server>/data for local dev.
  dataDir: process.env.DATA_DIR || join(serverRoot, 'data'),
  fetchConcurrency: appConfig.fetchConcurrency || 8,
  cacheTtlSeconds: appConfig.cacheTtlSeconds || 45,
  // ---- auth (token-paste sessions) ----
  cookieName: process.env.COOKIE_NAME || 'ado_sid',
  cookieSecure: String(process.env.COOKIE_SECURE || 'false') === 'true',
  // The one and only login gate: the signed-in user must be a member of this
  // Azure DevOps / AAD group (checked live via the IdentityPicker). Override with
  // ALLOWED_GROUP; set it empty to disable the gate (open to anyone in the org).
  allowedGroupAlias:
    process.env.ALLOWED_GROUP !== undefined ? process.env.ALLOWED_GROUP.trim() : 'mdelinux@microsoft.com',
  // On Azure there is no `az` CLI; set DISABLE_AZ_FALLBACK=true so the server
  // never attempts the local fallback and goes straight to token-paste login.
  disableAzFallback: String(process.env.DISABLE_AZ_FALLBACK || 'false') === 'true',
  email: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false') === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.NOTIFY_EMAIL_FROM || process.env.SMTP_USER || '',
    enabled: Boolean(process.env.SMTP_HOST),
  },
};

/** Build the reviewer-group name→label map for a user's config. */
export function groupNameToLabel(reviewerGroups = []) {
  return new Map(reviewerGroups.map((g) => [g.name.toLowerCase(), g.label || g.name]));
}

export const apiVersion = '7.1';
export const apiVersionPreview = '7.1-preview';
