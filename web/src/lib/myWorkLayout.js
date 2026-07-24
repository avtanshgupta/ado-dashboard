// Pure helpers for the customizable "My Work" home (B1). The list of available
// widgets is defined here; the user's saved layout (order + hidden set) is merged
// against it so newly-added widgets appear and removed ones are dropped safely.

/** Canonical widget catalogue, in default display order. */
export const MY_WORK_WIDGETS = [
  { id: 'attention', title: 'Needs my attention' },
  { id: 'myPrs', title: 'My open pull requests' },
  { id: 'reviewPrs', title: 'Pull requests to review' },
  { id: 'atRiskWi', title: 'At-risk work items' },
  { id: 'pipelines', title: 'Failing pipelines' },
  { id: 'agents', title: 'Live agent sessions' },
];

const VALID_IDS = new Set(MY_WORK_WIDGETS.map((w) => w.id));

/**
 * Merge a saved layout with the widget catalogue. `saved` is an array of
 * `{ id, hidden }`. Returns an array of `{ id, title, hidden }` in the saved
 * order, dropping unknown ids and appending any catalogue widgets the save
 * doesn't mention (visible by default) so upgrades add new widgets automatically.
 */
export function resolveLayout(saved) {
  const savedList = Array.isArray(saved) ? saved.filter((w) => w && VALID_IDS.has(w.id)) : [];
  const seen = new Set();
  const out = [];
  for (const w of savedList) {
    if (seen.has(w.id)) continue;
    seen.add(w.id);
    const meta = MY_WORK_WIDGETS.find((m) => m.id === w.id);
    out.push({ id: w.id, title: meta.title, hidden: !!w.hidden });
  }
  for (const w of MY_WORK_WIDGETS) {
    if (!seen.has(w.id)) out.push({ id: w.id, title: w.title, hidden: false });
  }
  return out;
}

/** Serialize a resolved layout back to the minimal persisted form. */
export function toSaved(layout) {
  return (Array.isArray(layout) ? layout : [])
    .filter((w) => w && VALID_IDS.has(w.id))
    .map((w) => ({ id: w.id, hidden: !!w.hidden }));
}

/** Move the widget at `index` one slot up (dir=-1) or down (dir=+1). */
export function moveWidget(layout, index, dir) {
  const next = [...layout];
  const j = index + dir;
  if (index < 0 || index >= next.length || j < 0 || j >= next.length) return layout;
  [next[index], next[j]] = [next[j], next[index]];
  return next;
}

/** Toggle a widget's hidden flag by id. */
export function toggleWidget(layout, id) {
  return layout.map((w) => (w.id === id ? { ...w, hidden: !w.hidden } : w));
}
