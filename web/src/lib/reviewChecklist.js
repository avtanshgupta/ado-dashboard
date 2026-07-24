// Guided PR review checklist (B6). The checklist items and the per-PR tick state
// live in localStorage (a reviewer aid), and a completed checklist can be posted
// as a Markdown comment via the existing PR comment endpoint. The item list and
// summary composition are pure so they can be unit-tested.

export const DEFAULT_CHECKLIST = [
  { id: 'builds', label: 'Builds and CI pass' },
  { id: 'tests', label: 'Tests added or updated' },
  { id: 'nosecrets', label: 'No secrets, keys or tokens committed' },
  { id: 'docs', label: 'Docs / comments updated where needed' },
  { id: 'scope', label: 'Change is scoped and focused' },
  { id: 'errors', label: 'Error handling and edge cases covered' },
];

const MAX_LABEL = 120;
const MAX_ITEMS = 30;

/** Sanitize a stored/edited checklist into a valid item array. */
export function normalizeChecklist(items) {
  if (!Array.isArray(items)) return [...DEFAULT_CHECKLIST];
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const label = String(it?.label || '').trim().slice(0, MAX_LABEL);
    if (!label) continue;
    const id = String(it?.id || label.toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, 40);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label });
    if (out.length >= MAX_ITEMS) break;
  }
  return out.length ? out : [...DEFAULT_CHECKLIST];
}

/** True when every checklist item id is present in the `checked` set/array. */
export function allChecked(items, checked) {
  const set = checked instanceof Set ? checked : new Set(checked || []);
  return items.length > 0 && items.every((it) => set.has(it.id));
}

/**
 * Compose a Markdown review summary from the checklist. `checked` is a Set (or
 * array) of ticked item ids. Returns a string suitable for posting as a comment.
 */
export function composeReviewSummary(items, checked, { title = 'Review checklist' } = {}) {
  const set = checked instanceof Set ? checked : new Set(checked || []);
  const lines = [`### ${title}`, ''];
  let done = 0;
  for (const it of items) {
    const on = set.has(it.id);
    if (on) done += 1;
    lines.push(`- [${on ? 'x' : ' '}] ${it.label}`);
  }
  lines.push('');
  lines.push(`_${done} of ${items.length} items checked._`);
  return lines.join('\n');
}
