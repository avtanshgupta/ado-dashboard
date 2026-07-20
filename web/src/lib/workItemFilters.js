// Pure client-side filter + sort for work items. No React — mirrors filters.js
// (PR filters) so behaviour is deterministic and unit-testable. Options are
// derived from the loaded rows on the page (types/states/assignees/areas/
// iterations/tags), matching how PR labels are discovered.

import { timeRangeCutoff } from './filters.js';

// Coarse category → the states that map to it, used by the quick category chips.
export const STATE_CATEGORY_OPTIONS = ['Proposed', 'InProgress', 'Resolved', 'Completed'];

const STATE_CATEGORY = {
  new: 'Proposed', proposed: 'Proposed', approved: 'Proposed',
  active: 'InProgress', committed: 'InProgress', 'in progress': 'InProgress', doing: 'InProgress',
  resolved: 'Resolved', 'code review': 'Resolved', testing: 'Resolved',
  closed: 'Completed', done: 'Completed', completed: 'Completed',
  removed: 'Removed',
};

export function categoryOf(state) {
  return STATE_CATEGORY[String(state || '').toLowerCase()] || 'InProgress';
}

export const WI_SORT_OPTIONS = [
  { key: 'changedDate', label: 'Last updated' },
  { key: 'createdDate', label: 'Created date' },
  { key: 'title', label: 'Title' },
  { key: 'id', label: 'ID' },
  { key: 'state', label: 'State' },
  { key: 'type', label: 'Type' },
  { key: 'assignedTo', label: 'Assignee' },
  { key: 'priority', label: 'Priority' },
  { key: 'severity', label: 'Severity' },
  { key: 'storyPoints', label: 'Story points' },
];

function getVal(wi, key) {
  switch (key) {
    case 'createdDate':
    case 'changedDate':
      return new Date(wi[key] || wi.createdDate || 0).getTime();
    case 'title':
      return (wi.title || '').toLowerCase();
    case 'assignedTo':
      return (wi.assignedTo?.displayName || '~').toLowerCase(); // unassigned sorts last (asc)
    case 'type':
    case 'state':
      return (wi[key] || '').toLowerCase();
    case 'priority':
      return wi.priority == null ? Infinity : Number(wi.priority); // no priority sorts last (asc)
    case 'severity':
      return (wi.severity || '').toString().toLowerCase();
    case 'storyPoints':
      return wi.storyPoints == null && wi.effort == null ? -1 : Number(wi.storyPoints ?? wi.effort);
    case 'id':
      return Number(wi.id) || 0;
    default:
      return wi[key] ?? '';
  }
}

const EMPTY = { types: [], states: [], categories: [], assignees: [], areas: [], iterations: [], tags: [], projects: [], priorities: [], search: '', timeRange: 'all' };

export function applyWorkItemFilterSort(items, filters, sort) {
  const f = { ...EMPTY, ...(filters || {}) };
  const q = f.search.trim().toLowerCase();
  const cutoff = timeRangeCutoff(f.timeRange);

  let out = (items || []).filter((wi) => {
    if (f.types.length && !f.types.includes(wi.type)) return false;
    if (f.states.length && !f.states.includes(wi.state)) return false;
    if (f.categories.length && !f.categories.includes(categoryOf(wi.state))) return false;
    if (f.assignees.length) {
      const who = wi.assignedTo?.displayName || 'Unassigned';
      if (!f.assignees.includes(who)) return false;
    }
    if (f.areas.length && !f.areas.includes(wi.areaPath)) return false;
    if (f.iterations.length && !f.iterations.includes(wi.iterationPath)) return false;
    if (f.projects.length && !f.projects.includes(wi.project)) return false;
    if (f.priorities.length && !f.priorities.includes(String(wi.priority))) return false;
    if (f.tags.length && !(wi.tags || []).some((t) => f.tags.includes(t))) return false;
    if (cutoff) {
      const updated = new Date(wi.changedDate || wi.createdDate || 0).getTime();
      if (updated < cutoff) return false;
    }
    if (q) {
      const hay = `${wi.title} ${wi.id} ${wi.type} ${wi.state} ${wi.assignedTo?.displayName || ''} ${(wi.tags || []).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  if (sort?.key) {
    const dir = sort.dir === 'asc' ? 1 : -1;
    out = [...out].sort((a, b) => {
      const va = getVal(a, sort.key);
      const vb = getVal(b, sort.key);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }
  return out;
}

/** Collect the distinct filter-option values present in a set of rows. */
export function deriveWorkItemOptions(items) {
  const uniq = (arr) => [...new Set(arr.filter((v) => v != null && v !== ''))];
  return {
    types: uniq((items || []).map((w) => w.type)).sort((a, b) => a.localeCompare(b)),
    states: uniq((items || []).map((w) => w.state)).sort((a, b) => a.localeCompare(b)),
    assignees: uniq((items || []).map((w) => w.assignedTo?.displayName || 'Unassigned')).sort((a, b) => a.localeCompare(b)),
    areas: uniq((items || []).map((w) => w.areaPath)).sort((a, b) => a.localeCompare(b)),
    iterations: uniq((items || []).map((w) => w.iterationPath)).sort((a, b) => a.localeCompare(b)),
    tags: uniq((items || []).flatMap((w) => w.tags || [])).sort((a, b) => a.localeCompare(b)),
    projects: uniq((items || []).map((w) => w.project)).sort((a, b) => a.localeCompare(b)),
    priorities: uniq((items || []).map((w) => (w.priority == null ? null : String(w.priority)))).sort(),
  };
}
