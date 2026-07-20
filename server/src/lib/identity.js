import { config } from '../config.js';

const ORG = config.organizationUrl.replace(/\/$/, '');

/**
 * Resolve an Azure DevOps identity from an Authorization header
 * (e.g. `Bearer <access-token>`), using the org connectionData endpoint.
 * Throws an Error with `.status` on failure.
 */
export async function resolveIdentityFromAuth(authHeader) {
  const res = await fetch(`${ORG}/_apis/connectionData?api-version=7.1-preview`, {
    headers: { Authorization: authHeader, Accept: 'application/json' },
  });
  if (!res.ok) {
    const e = new Error(`Azure DevOps returned ${res.status} while resolving your identity.`);
    e.status = res.status === 203 ? 401 : res.status;
    throw e;
  }
  const data = await res.json();
  const u = data.authenticatedUser;
  if (!u || !u.id || u.id === '00000000-0000-0000-0000-000000000000') {
    const e = new Error('Could not resolve a signed-in user from that token.');
    e.status = 401;
    throw e;
  }
  return {
    id: u.id,
    displayName: u.providerDisplayName || u.customDisplayName || 'User',
    uniqueName: u.properties?.Account?.['$value'] || u.providerDisplayName || '',
    imageUrl: `${ORG}/_api/_common/identityImage?id=${u.id}`,
  };
}
