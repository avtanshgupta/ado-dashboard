// Small shared work-item presentational bits: type / state / priority badges and
// the state-category color scale. Kept together so the table, overview and detail
// views render work items consistently.
import { categoryOf } from '../lib/workItemFilters.js';
import { Flag } from './icons.jsx';

// State-category → color, echoing the app's status palette (green/blue/amber/red).
const CATEGORY_COLOR = {
  Proposed: '#6e7781',
  InProgress: '#0969da',
  Resolved: '#8250df',
  Completed: '#1f883d',
  Removed: '#cf222e',
};

export function categoryColor(state, category) {
  return CATEGORY_COLOR[category || categoryOf(state)] || '#6e7781';
}

// Curated, high-contrast colors per common work-item type (ADO's own type colors
// are often too light to read). Falls back to a valid ADO color, then neutral.
const TYPE_COLOR = {
  bug: '#cf222e',
  task: '#0969da',
  'user story': '#8250df',
  'product backlog item': '#8250df',
  feature: '#8250df',
  epic: '#bc4c00',
  issue: '#bf8700',
  impediment: '#cf222e',
  'test case': '#1f883d',
  'test plan': '#1f883d',
  'test suite': '#1f883d',
  requirement: '#0a7ea4',
  'change request': '#0a7ea4',
  risk: '#cf222e',
  'code review request': '#0969da',
};

function typeColor(type, adoColor) {
  const hit = TYPE_COLOR[String(type || '').toLowerCase()];
  if (hit) return hit;
  const hex = String(adoColor || '').replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex}` : '#57606a';
}

/** Work-item type as compact, colored, formatted text (not a pill). */
export function WiTypeBadge({ type, color }) {
  if (!type) return null;
  const c = typeColor(type, color);
  return (
    <span className="wi-type" style={{ color: c, fontWeight: 600, fontSize: 12.5, whiteSpace: 'nowrap' }} title={type}>
      {type}
    </span>
  );
}

/** State pill, colored by the state's coarse category. */
export function WiStateBadge({ state, category }) {
  if (!state) return <span className="badge review-Pending">—</span>;
  const c = categoryColor(state, category);
  return (
    <span className="badge" style={{ color: c, borderColor: c, background: 'transparent' }} title={`State: ${state}`}>
      {state}
    </span>
  );
}

const PRIORITY_COLOR = { 1: '#cf222e', 2: '#bc4c00', 3: '#9a6700', 4: '#6e7781' };

export function PriorityBadge({ priority }) {
  if (priority == null || priority === '') return null;
  const c = PRIORITY_COLOR[priority] || '#6e7781';
  return (
    <span className="badge" style={{ color: c, borderColor: c, background: 'transparent' }} title={`Priority ${priority}`}>
      <Flag size={11} /> P{priority}
    </span>
  );
}

export function SeverityBadge({ severity }) {
  if (!severity) return null;
  return <span className="badge repo" title={`Severity: ${severity}`}>{String(severity).replace(/^\d+\s*-\s*/, '')}</span>;
}
