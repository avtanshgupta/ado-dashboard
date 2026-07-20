import { config } from '../config.js';

/**
 * Single access gate: the authenticated user must be a member of the configured
 * Azure DevOps / AAD group (default `mdelinux@microsoft.com`).
 *
 * The group is an AAD group that isn't necessarily materialized in the org's
 * identity graph, so we can't use the Graph/Identities membership APIs. Instead
 * we use the IdentityPicker, which queries AAD directly:
 *   1. Resolve the group alias -> its picker `entityId` (stable; cached).
 *   2. Query the user's UPN scoped by `filterByAncestorEntityIds=[groupEntityId]`
 *      — the picker only returns the user if they are a (transitive) member.
 *
 * Results are cached per user with a short TTL, and reused stale if a later
 * refresh call fails, so a transient AAD/ADO hiccup doesn't lock everyone out.
 */

const ORG = config.organizationUrl.replace(/\/$/, '');
const GROUP_ALIAS = config.allowedGroupAlias;
const PICKER_URL = `${ORG}/_apis/IdentityPicker/Identities?api-version=5.0-preview.1`;

const GROUP_TTL_MS = 6 * 60 * 60 * 1000; // group entityId is stable
const MEMBER_TTL_MS = 15 * 60 * 1000; // re-check membership at most every 15 min
const MEMBER_STALE_MS = 24 * 60 * 60 * 1000; // reuse a cached result up to 24h on errors

let groupCache = null; // { entityId, expires }
const memberCache = new Map(); // userKey -> { allowed, expires, at }

const lc = (s) => String(s || '').trim().toLowerCase();

async function pickerQuery(authHeader, body) {
  const res = await fetch(PICKER_URL, {
    method: 'POST',
    headers: { Authorization: authHeader, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.status === 203) {
    const e = new Error('Your Azure DevOps session is invalid or expired.');
    e.status = 401;
    throw e;
  }
  if (!res.ok) {
    const e = new Error(`Azure DevOps identity lookup failed (${res.status}).`);
    e.status = res.status === 401 ? 401 : 502;
    throw e;
  }
  // ADO prefixes JSON with a UTF-8 BOM; strip it before parsing.
  const text = (await res.text()).replace(/^\uFEFF/, '');
  const data = text ? JSON.parse(text) : {};
  return (data.results && data.results[0] && data.results[0].identities) || [];
}

/** Resolve the configured group alias to its IdentityPicker entityId (cached). */
async function resolveGroupEntityId(authHeader) {
  if (groupCache && groupCache.expires > Date.now()) return groupCache.entityId;
  const identities = await pickerQuery(authHeader, {
    query: GROUP_ALIAS,
    identityTypes: ['group', 'user'],
    operationScopes: ['ims', 'source'],
    properties: ['DisplayName', 'Mail'],
  });
  const group =
    identities.find((i) => i.entityType === 'Group' && lc(i.mail) === lc(GROUP_ALIAS)) ||
    identities.find((i) => i.entityType === 'Group') ||
    identities.find((i) => lc(i.mail) === lc(GROUP_ALIAS));
  if (!group || !group.entityId) {
    const e = new Error(`Access group "${GROUP_ALIAS}" could not be resolved in Azure DevOps.`);
    e.status = 500;
    throw e;
  }
  groupCache = { entityId: group.entityId, expires: Date.now() + GROUP_TTL_MS };
  return groupCache.entityId;
}

function userKey(user) {
  return lc(user?.id) || lc(user?.uniqueName) || 'anon';
}

/** Does an IdentityPicker result actually correspond to this user? */
function matchesUser(identities, user) {
  const upn = lc(user?.uniqueName);
  const id = lc(user?.id);
  return identities.some((i) => {
    if (id && (lc(i.localId) === id || lc(i.originId) === id)) return true;
    if (upn && (lc(i.mail) === upn || lc(i.signInAddress) === upn)) return true;
    return false;
  });
}

/** Live membership check against the allowed group (no cache). */
async function queryMembership(authHeader, user) {
  const groupEntityId = await resolveGroupEntityId(authHeader);
  const q = user?.uniqueName || user?.displayName;
  if (!q) return false;
  const identities = await pickerQuery(authHeader, {
    query: q,
    identityTypes: ['user'],
    operationScopes: ['ims', 'source'],
    filterByAncestorEntityIds: [groupEntityId],
    properties: ['DisplayName', 'Mail', 'SignInAddress'],
  });
  return matchesUser(identities, user);
}

/**
 * Whether the user may use this dashboard: a member of the configured group.
 * Requires the user's own Authorization header (the check runs as the user).
 * Cached per user (positive and negative) with a short TTL; on a lookup error a
 * recent cached result is reused so transient failures don't lock users out.
 */
export async function isAllowed(authHeader, user) {
  if (!GROUP_ALIAS) return true; // no group configured => open (explicit opt-out)
  if (!user || !authHeader) return false;
  const key = userKey(user);
  const now = Date.now();
  const cached = memberCache.get(key);
  if (cached && cached.expires > now) return cached.allowed;

  try {
    const allowed = await queryMembership(authHeader, user);
    memberCache.set(key, { allowed, expires: now + MEMBER_TTL_MS, at: now });
    return allowed;
  } catch (err) {
    // Reuse a recent cached decision on transient errors; otherwise fail closed.
    if (cached && now - cached.at < MEMBER_STALE_MS) return cached.allowed;
    throw err;
  }
}

/** Forget a cached membership decision (e.g. on logout). */
export function forgetMembership(user) {
  memberCache.delete(userKey(user));
}
