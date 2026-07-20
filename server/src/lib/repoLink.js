// Pure parsing of Azure DevOps repository links → { org, project, repo }.
// Kept dependency-free and side-effect-free so it can be unit-tested in isolation
// (same pattern as prPriority / mappers).

/** Decode a URL path segment, tolerating malformed escapes. */
function dec(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Extract the organization name from a configured org URL.
 *   https://dev.azure.com/{org}      → {org}
 *   https://{org}.visualstudio.com   → {org}
 */
export function orgFromUrl(orgUrl) {
  try {
    const u = new URL(orgUrl);
    const host = u.hostname.toLowerCase();
    if (host === 'dev.azure.com') {
      const seg = u.pathname.split('/').filter(Boolean);
      return (seg[0] || '').toLowerCase();
    }
    const vs = host.match(/^(.+)\.visualstudio\.com$/);
    if (vs) return vs[1].toLowerCase();
  } catch {
    /* not a URL */
  }
  return '';
}

/**
 * Extract the organization BASE URL from any Azure DevOps URL:
 *   https://dev.azure.com/{org}/{project}/...   → https://dev.azure.com/{org}
 *   https://{org}.visualstudio.com/{project}/... → https://{org}.visualstudio.com
 * Returns null if the host isn't a recognized ADO host.
 */
export function orgBaseFromUrl(input) {
  let u;
  try {
    u = new URL(String(input || '').trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host === 'dev.azure.com' || host === 'vssps.dev.azure.com') {
    const org = u.pathname.split('/').filter(Boolean)[0];
    return org ? `https://dev.azure.com/${dec(org)}` : null;
  }
  if (/\.visualstudio\.com$/.test(host)) return `https://${host}`;
  return null;
}

/**
 * Parse an Azure DevOps repository URL into { org, project, repo }.
 * Returns null if the input is not a recognizable ADO repo link.
 *
 * Supported shapes (query/hash and trailing paths are ignored):
 *   https://dev.azure.com/{org}/{project}/_git/{repo}
 *   https://{org}.visualstudio.com/{project}/_git/{repo}
 *   https://{org}.visualstudio.com/DefaultCollection/{project}/_git/{repo}
 *   https://{org}@dev.azure.com/{org}/{project}/_git/{repo}   (clone URL)
 *   git@ssh.dev.azure.com:v3/{org}/{project}/{repo}           (SSH clone)
 * Project and repo segments may be URL-encoded (e.g. "Windows%20Defender").
 */
export function parseRepoUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  // SSH clone form: git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
  const ssh = raw.match(/^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (ssh) {
    return { org: dec(ssh[1]), project: dec(ssh[2]), repo: dec(ssh[3]) };
  }

  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  const host = u.hostname.toLowerCase();
  const seg = u.pathname.split('/').filter(Boolean).map(dec);
  const gi = seg.indexOf('_git');
  if (gi < 0) return null; // not a git repo link

  let org = '';
  if (host === 'dev.azure.com' || host === 'vssps.dev.azure.com') {
    // /{org}/{project}/_git/{repo}  → org is the first segment, project precedes _git.
    org = seg[0] || '';
    if (gi < 2) return null;
  } else if (/\.visualstudio\.com$/.test(host)) {
    org = host.replace(/\.visualstudio\.com$/, '');
    if (gi < 1) return null; // need at least a project before _git
  } else {
    return null;
  }

  const project = seg[gi - 1];
  const repo = (seg[gi + 1] || '').replace(/\.git$/i, '');
  if (!org || !project || !repo) return null;
  return { org, project, repo };
}
