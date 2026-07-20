import { STATE_CATEGORY_OPTIONS, WI_SORT_OPTIONS } from '../lib/workItemFilters.js';
import { TIME_RANGES } from '../lib/filters.js';
import { api } from '../lib/api.js';
import { shortPath } from '../lib/format.js';
import { MultiSelect } from './MultiSelect.jsx';
import { RefreshingTag } from './ui.jsx';
import { ArrowUp, ArrowDown, RefreshCw, Download, Printer, ListFilter } from './icons.jsx';

export function WorkItemFilterBar({ filters, setFilters, sort, setSort, options, total, shown, onRefresh, exportTab, multiProject, revalidating }) {
  const toggle = (key) => (val) =>
    setFilters((f) => {
      const cur = f[key] || [];
      return { ...f, [key]: cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val] };
    });
  const clear = (key) => () => setFilters((f) => ({ ...f, [key]: [] }));
  const catLabel = (c) => (c === 'InProgress' ? 'In Progress' : c);

  return (
    <div className="filter-bar no-print" data-tour="list-filters">
      <div className="search" style={{ position: 'relative', minWidth: 200, flex: '0 1 260px' }}>
        <input
          placeholder="Filter by title, id, assignee, tag…"
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
        />
      </div>

      <MultiSelect label="State" options={STATE_CATEGORY_OPTIONS} selected={filters.categories} onToggle={toggle('categories')} onClear={clear('categories')} render={catLabel} minWidth={170} />
      <MultiSelect label="Types" options={options.types} selected={filters.types} onToggle={toggle('types')} onClear={clear('types')} />
      <MultiSelect label="Assignees" options={options.assignees} selected={filters.assignees} onToggle={toggle('assignees')} onClear={clear('assignees')} />
      <MultiSelect label="Areas" options={options.areas} selected={filters.areas} onToggle={toggle('areas')} onClear={clear('areas')} render={shortPath} />
      <MultiSelect label="Iterations" options={options.iterations} selected={filters.iterations} onToggle={toggle('iterations')} onClear={clear('iterations')} render={shortPath} />
      <MultiSelect label="Tags" options={options.tags} selected={filters.tags} onToggle={toggle('tags')} onClear={clear('tags')} />
      {options.priorities.length > 0 && (
        <MultiSelect label="Priority" options={options.priorities} selected={filters.priorities} onToggle={toggle('priorities')} onClear={clear('priorities')} render={(p) => `P${p}`} minWidth={140} />
      )}
      {multiProject && (
        <MultiSelect label="Projects" options={options.projects} selected={filters.projects} onToggle={toggle('projects')} onClear={clear('projects')} />
      )}

      <select value={filters.timeRange || 'all'} onChange={(e) => setFilters((f) => ({ ...f, timeRange: e.target.value }))} title="Only show items updated within this period">
        {TIME_RANGES.map((r) => <option key={r.key} value={r.key}>{r.label.replace('PRs', 'items')}</option>)}
      </select>

      <select value={sort.key} onChange={(e) => setSort((s) => ({ ...s, key: e.target.value }))}>
        {WI_SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>Sort: {o.label}</option>)}
      </select>
      <button className="btn sm" onClick={() => setSort((s) => ({ ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' }))} title="Toggle sort direction">
        {sort.dir === 'asc' ? <><ArrowUp size={13} /> Asc</> : <><ArrowDown size={13} /> Desc</>}
      </button>

      <div className="grow" />
      <RefreshingTag show={revalidating} />
      <span className="result-count"><ListFilter size={13} /> {shown} of {total}</span>
      {onRefresh && <button className="btn sm" onClick={onRefresh} title="Refresh data"><RefreshCw size={14} /> Refresh</button>}
      {exportTab && <a className="btn sm" href={api.wiExportUrl(exportTab)} title="Export CSV"><Download size={14} /> CSV</a>}
      <button className="btn sm" onClick={() => window.print()} title="Print / Save as PDF"><Printer size={14} /> PDF</button>
    </div>
  );
}
