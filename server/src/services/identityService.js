import { adoSend, orgUrl } from '../lib/adoClient.js';

function shortLabel(name) {
  return name.replace(/^MDE\s+Linux\s+/i, '').replace(/\s+Team$/i, ' Team').trim() || name;
}

/** Resolve an alias/email to its Azure DevOps group (or user) display name. */
export async function resolveGroup(alias) {
  if (!alias || !alias.trim()) {
    const e = new Error('Alias is required');
    e.status = 400;
    throw e;
  }
  const data = await adoSend(
    'POST',
    orgUrl('_apis/IdentityPicker/Identities'),
    {
      query: alias.trim(),
      identityTypes: ['group', 'user'],
      operationScopes: ['ims', 'source'],
      properties: ['DisplayName', 'Mail', 'SubjectDescriptor'],
    },
    { query: { 'api-version': '5.0-preview.1' } }
  );
  const ids = data?.results?.[0]?.identities || [];
  if (!ids.length) {
    const e = new Error(`No Azure DevOps group/user matched "${alias}"`);
    e.status = 404;
    throw e;
  }
  const name = ids[0].displayName;
  return { alias: alias.trim(), name, label: shortLabel(name) };
}

/**
 * Search Azure DevOps users/groups for adding as PR reviewers. Returns a small
 * candidate list with the identity's local id (the GUID PR reviewers use).
 */
export async function searchIdentities(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const data = await adoSend(
    'POST',
    orgUrl('_apis/IdentityPicker/Identities'),
    {
      query: q,
      identityTypes: ['user', 'group'],
      operationScopes: ['ims', 'source'],
      properties: ['DisplayName', 'Mail', 'SignInAddress', 'SubjectDescriptor'],
    },
    { query: { 'api-version': '5.0-preview.1' } }
  );
  const ids = data?.results?.[0]?.identities || [];
  return ids
    .map((i) => ({
      id: i.localId || i.originId || i.entityId || null,
      displayName: i.displayName || i.mail || 'Unknown',
      mail: i.mail || i.signInAddress || null,
      isGroup: i.entityType === 'Group',
    }))
    .filter((i) => i.id)
    .slice(0, 10);
}
