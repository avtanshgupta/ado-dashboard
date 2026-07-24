// Pure helpers for Work Item bulk actions. Kept dependency-free so the tag-merge
// logic (the only non-trivial part) is unit-testable without React or the API.

/** Normalize a tag for case-insensitive de-duplication. */
function norm(t) {
  return String(t || '').trim().toLowerCase();
}

/**
 * Add `tag` to an existing tag list, de-duplicating case-insensitively while
 * preserving the original casing/order of existing tags. Returns a new array.
 */
export function addTag(tags, tag) {
  const clean = String(tag || '').trim();
  const out = Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean) : [];
  if (!clean) return out;
  if (out.some((t) => norm(t) === norm(clean))) return out;
  return [...out, clean];
}

/** Serialize a tag array to the ADO `System.Tags` field format ("a; b; c"). */
export function tagsToField(tags) {
  return (Array.isArray(tags) ? tags : [])
    .map((t) => String(t).trim())
    .filter(Boolean)
    .join('; ');
}

/**
 * The System.Tags field value that adds `tag` to a work item whose current tags
 * are `existingTags`, or null when nothing would change (the tag is already
 * present or blank) so callers can skip a no-op write.
 */
export function tagFieldWithAdded(existingTags, tag) {
  const before = Array.isArray(existingTags) ? existingTags : [];
  const after = addTag(before, tag);
  if (after.length === before.length) return null;
  return tagsToField(after);
}

/** Summarize per-item outcomes into a { ok, failed, total } tally. */
export function summarize(results) {
  const ok = results.filter((r) => r && r.ok).length;
  return { ok, failed: results.length - ok, total: results.length };
}
