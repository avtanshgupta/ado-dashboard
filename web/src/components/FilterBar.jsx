import { useEffect, useRef, useState } from 'react';
import { STATE_OPTIONS, SORT_OPTIONS, TIME_RANGES } from '../lib/filters.js';
import { api } from '../lib/api.js';
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
}) {
  function toggleRepo(repo) {
    setFilters((f) => {
      const has = f.repos.includes(repo);
      return { ...f, repos: has ? f.repos.filter((r) => r !== repo) : [...f.repos, repo] };
    });
  }

  function toggleLabel(label) {
    setFilters((f) => {
      const cur = f.labels || [];
      const has = cur.includes(label);
      return { ...f, labels: has ? cur.filter((l) => l !== label) : [...cur, label] };
    });
  }

  const [repoMenuOpen, setRepoMenuOpen] = useState(false);
  const repoMenuRef = useRef(null);
  const [labelMenuOpen, setLabelMenuOpen] = useState(false);
  const labelMenuRef = useRef(null);

  useEffect(() => {
    function onClick(e) {
      if (repoMenuRef.current && !repoMenuRef.current.contains(e.target)) setRepoMenuOpen(false);
      if (labelMenuRef.current && !labelMenuRef.current.contains(e.target)) setLabelMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const repoLabel =
    filters.repos.length === 0
      ? 'All repositories'
      : filters.repos.length === 1
        ? filters.repos[0]
        : `${filters.repos.length} repositories`;

  const selectedLabels = filters.labels || [];
  const labelButtonText =
    selectedLabels.length === 0
      ? 'All labels'
      : selectedLabels.length === 1
        ? selectedLabels[0]
        : `${selectedLabels.length} labels`;

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

      <div className="dropdown" ref={repoMenuRef}>
        <button
          type="button"
          className="dropdown-toggle"
          onClick={() => setRepoMenuOpen((o) => !o)}
          title="Filter by repository"
        >
          {repoLabel}
        </button>
        {repoMenuOpen && (
          <div className="dropdown-menu" style={{ minWidth: 260 }}>
            <div className="dd-head">
              <span>Repositories</span>
              {filters.repos.length > 0 && (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => setFilters((f) => ({ ...f, repos: [] }))}
                >
                  Clear
                </button>
              )}
            </div>
            {repositories.map((repo) => (
              <label key={repo} className="dd-item" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={filters.repos.includes(repo)}
                  onChange={() => toggleRepo(repo)}
                />
                {repo}
              </label>
            ))}
          </div>
        )}
      </div>

      {labels.length > 0 && (
        <div className="dropdown" ref={labelMenuRef}>
          <button
            type="button"
            className="dropdown-toggle"
            onClick={() => setLabelMenuOpen((o) => !o)}
            title="Filter by label"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Tag size={14} /> {labelButtonText}
          </button>
          {labelMenuOpen && (
            <div className="dropdown-menu" style={{ minWidth: 220, maxHeight: 320, overflowY: 'auto' }}>
              <div className="dd-head">
                <span>Labels</span>
                {selectedLabels.length > 0 && (
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => setFilters((f) => ({ ...f, labels: [] }))}
                  >
                    Clear
                  </button>
                )}
              </div>
              {labels.map((label) => (
                <label key={label} className="dd-item" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selectedLabels.includes(label)}
                    onChange={() => toggleLabel(label)}
                  />
                  {label}
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      {showStateFilter && (
        <select
          value={filters.states[0] || ''}
          onChange={(e) =>
            setFilters((f) => ({ ...f, states: e.target.value ? [e.target.value] : [] }))
          }
        >
          <option value="">All states</option>
          {STATE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
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
