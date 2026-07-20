// Pure parsing of Azure DevOps work-item & query web links. No I/O — extracts
// the identifiers the resolvers need (query GUID, project, org base) from a
// pasted URL or a plain value, so parsing stays unit-testable.
import { orgBaseFromUrl } from './repoLink.js';

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function dec(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Project name from an ADO URL:
 *   https://dev.azure.com/{org}/{project}/...        → {project}
 *   https://{org}.visualstudio.com/{project}/...     → {project}
 *   https://{org}.visualstudio.com/DefaultCollection/{project}/... → {project}
 * Returns null when no project segment is present.
 */
export function projectFromAdoUrl(input) {
  let url;
  try {
    url = typeof input === 'string' ? new URL(input) : input;
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const seg = url.pathname.split('/').filter(Boolean).map(dec);
  if (host === 'dev.azure.com' || host === 'vssps.dev.azure.com') {
    return seg[1] || null; // /{org}/{project}/...
  }
  if (/\.visualstudio\.com$/.test(host)) {
    if (seg[0] && seg[0].toLowerCase() === 'defaultcollection') return seg[1] || null;
    return seg[0] || null;
  }
  return null;
}

/** Extract a query GUID (+ optional project & org base) from a query URL or a bare GUID. */
export function parseQueryRef(ref) {
  const raw = String(ref || '').trim();
  if (!raw) return null;
  if (new RegExp(`^${GUID.source}$`, 'i').test(raw)) return { guid: raw.toLowerCase(), project: null, org: null };
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const m = raw.match(GUID);
  if (!m) return null;
  return { guid: m[0].toLowerCase(), project: projectFromAdoUrl(u), org: orgBaseFromUrl(u) };
}
