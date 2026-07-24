import { STATE_OPTIONS, SORT_OPTIONS, TIME_RANGES } from '../lib/filters.js';
import { api } from '../lib/api.js';
import { MultiSelect } from './MultiSelect.jsx';
import { RefreshingTag, Freshness } from './ui.jsx';
import { Tag, ArrowUp, ArrowDown, RefreshCw, Download, Printer } from './icons.jsx';

export function FilterBar({
  repositories,
  filters,
  setFilters,
  sort,
  setSort,
  total,
  shown,
  exportCategory,
  exportStatus,
  onRefresh,
  showStateFilter = true,
  labels = [],
  extra = null,
  revalidating = false,
  updatedAt = null,
}) {
  const toggle = (key) => (val) =>
    setFilters((f) => {
      const cur = f[key] || [];
      return { ...f, [key]: cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val] };
    });
  const clear = (key) => () => setFilters((f) => ({ ...f, [key]: [] }));

  return (
    <div className="filter-bar no-print">
      <div className="search" style={{ position: 'relative', minWidth: 220, flex: '0 1 280px' }}>
        <input
          placeholder="Filter by title, branch, author…"
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          style={{ width: '100%', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
        />
      </div>

      <MultiSelect
        label="Repositories"
        allLabel="All repositories"
        options={repositories}
        selected={filters.repos}
        onToggle={toggle('repos')}
        onClear={clear('repos')}
        minWidth={260}
      />

      {labels.length > 0 && (
        <MultiSelect
          label="Labels"
          options={labels}
          selected={filters.labels || []}
          onToggle={toggle('labels')}
          onClear={clear('labels')}
          icon={Tag}
        />
      )}

      {showStateFilter && (
        <MultiSelect
          label="States"
          allLabel="All states"
          options={STATE_OPTIONS}
          selected={filters.states}
          onToggle={toggle('states')}
          onClear={clear('states')}
          minWidth={160}
        />
      )}

      <select
        value={filters.timeRange || 'all'}
        onChange={(e) => setFilters((f) => ({ ...f, timeRange: e.target.value }))}
        title="Only show PRs updated within this period"
      >
        {TIME_RANGES.map((r) => (
          <option key={r.key} value={r.key}>
            {r.label}
          </option>
        ))}
      </select>

      <select value={sort.key} onChange={(e) => setSort((s) => ({ ...s, key: e.target.value }))}>
        {SORT_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            Sort: {o.label}
          </option>
        ))}
      </select>
      <button
        className="btn sm"
        onClick={() => setSort((s) => ({ ...s, dir: s.dir === 'asc' ? 'desc' : 'asc' }))}
        title="Toggle sort direction"
      >
        {sort.dir === 'asc' ? <><ArrowUp size={13} /> Asc</> : <><ArrowDown size={13} /> Desc</>}
      </button>

      {extra}

      <div className="grow" />
      <RefreshingTag show={revalidating} />
      <Freshness updatedAt={updatedAt} revalidating={revalidating} />
      <span className="result-count">
        {shown} of {total}
      </span>
      {onRefresh && (
        <button className="btn sm" onClick={onRefresh} title="Refresh data">
          <RefreshCw size={14} /> Refresh
        </button>
      )}
      {exportCategory && (
        <a className="btn sm" href={api.exportUrl(exportCategory, exportStatus)} title="Export CSV">
          <Download size={14} /> CSV
        </a>
      )}
      <button className="btn sm" onClick={() => window.print()} title="Print / Save as PDF">
        <Printer size={14} /> PDF
      </button>
    </div>
  );
}
