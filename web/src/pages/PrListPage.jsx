import { useState, useMemo, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useConfig } from '../lib/AppContext.jsx';
import { useAsync } from '../lib/useAsync.js';
import { api } from '../lib/api.js';
import { Loading, ErrorBox, Empty, Pager } from '../components/ui.jsx';
import { FilterBar } from '../components/FilterBar.jsx';
import { PrTable } from '../components/PrTable.jsx';
import { BulkActionsBar } from '../components/BulkActionsBar.jsx';
import { SavedViews } from '../components/SavedViews.jsx';
import { applyFilterSort } from '../lib/filters.js';
import { GitPullRequestArrow, Eye, UserCheck, Users, Settings } from '../components/icons.jsx';

const VARIANTS = {
  created: {
    Icon: GitPullRequestArrow,
    title: 'Pull Requests I Have Created',
    desc: 'PRs you authored across all repositories. Merge or re-trigger pipelines inline.',
    fetch: (status) => api.created(status),
    exportCategory: 'created',
    showStateFilter: true,
    emptyIcon: GitPullRequestArrow,
    historyByState: true,
  },
  assigned: {
    Icon: Eye,
    title: 'Pull Requests Assigned to Me',
    desc: 'Active PRs where you are a direct reviewer.',
    fetch: () => api.assigned('me'),
    exportCategory: 'assigned',
    showStateFilter: true,
    emptyIcon: Eye,
  },
  assignedTeam: {
    Icon: UserCheck,
    title: 'Assigned to My Team Aliases',
    desc: 'Active PRs where one of your review-group aliases (TP Team, eBPF Core, Installer Team) is a reviewer, but you are not directly assigned.',
    fetch: () => api.assigned('team'),
    exportCategory: 'assignedTeam',
    showStateFilter: true,
    emptyIcon: UserCheck,
  },
  team: {
    Icon: Users,
    title: 'Authored By Team',
    desc: 'Active PRs from your team across all repositories.',
    fetch: () => api.team(),
    exportCategory: 'team',
    showStateFilter: true,
    emptyIcon: Users,
  },
};

const PREFS_KEY = 'ado-pr-list-prefs';
function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}
function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage disabled/full — non-fatal */
  }
}

export function PrListPage({ variant }) {
  const cfg = VARIANTS[variant];
  const config = useConfig();
  const navigate = useNavigate();
  const defaultRange = `${config.defaultTimeRangeMonths || 6}mo`;
  const [filters, setFilters] = useState(() => {
    const saved = loadPrefs();
    return {
      repos: saved.repos || [],
      states: saved.states || ['Open'], // default: Open only (drafts hidden unless selected)
      search: '', // free-text search is intentionally not persisted
      pipeline: '',
      review: '',
      timeRange: saved.timeRange || defaultRange,
      labels: [],
    };
  });
  const [sort, setSort] = useState(() => loadPrefs().sort || { key: 'lastActivity', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => loadPrefs().pageSize || 25);
  const [selected, setSelected] = useState(() => new Set()); // A2 — bulk selection (repo#id)

  const density = config.uiPrefs?.density || 'comfortable';

  // Persist the sticky filter/sort/page-size prefs (not the tab-specific labels
  // or the ephemeral free-text search) so they survive reloads.
  useEffect(() => {
    savePrefs({ repos: filters.repos, states: filters.states, timeRange: filters.timeRange, sort, pageSize });
  }, [filters.repos, filters.states, filters.timeRange, sort, pageSize]);

  // Labels are tab-specific — clear any selection when switching category so a
  // stale label from another tab can't silently hide every row.
  useEffect(() => {
    setFilters((f) => (f.labels.length ? { ...f, labels: [] } : f));
  }, [variant]);

  // Reset to the first page whenever the filtered result set changes.
  useEffect(() => {
    setPage(1);
  }, [filters, sort, variant, pageSize]);

  // For "created", the selected state decides whether to also fetch history.
  const activeOnly =
    filters.states.length > 0 && filters.states.every((s) => s === 'Open' || s === 'Draft');
  const fetchArg = variant === 'created' && cfg.historyByState && !activeOnly ? 'all' : undefined;

  const { data, loading, error, refetch, revalidating } = useAsync(
    () => cfg.fetch(fetchArg),
    [variant, fetchArg],
    { pollMs: 90000, cacheKey: `pr:list:${variant}:${fetchArg || 'active'}` }
  );

  const prs = useMemo(() => data || [], [data]);
  const shown = useMemo(() => applyFilterSort(prs, filters, sort), [prs, filters, sort]);
  const availableLabels = useMemo(() => {
    const set = new Set();
    for (const pr of prs) for (const l of pr.labels || []) set.add(l);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [prs]);
  const totalPages = Math.max(1, Math.ceil(shown.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const paged = useMemo(
    () => shown.slice((curPage - 1) * pageSize, curPage * pageSize),
    [shown, curPage, pageSize]
  );

  // A2 — bulk selection. Selection persists across pages (keyed by repo#id) and
  // is cleared when switching category. Bulk actions apply to selected + visible.
  const selectable = variant === 'created' || variant === 'assigned' || variant === 'assignedTeam';
  const selKey = (pr) => `${pr.repo}#${pr.id}`;
  useEffect(() => { setSelected(new Set()); }, [variant]);
  const toggleSelect = useCallback((pr) => {
    setSelected((s) => {
      const n = new Set(s);
      const k = `${pr.repo}#${pr.id}`;
      n.has(k) ? n.delete(k) : n.add(k);
      return n;
    });
  }, []);
  const toggleAll = useCallback((rows) => {
    setSelected((s) => {
      const keys = rows.map((pr) => `${pr.repo}#${pr.id}`);
      const allOn = keys.every((k) => s.has(k));
      const n = new Set(s);
      for (const k of keys) allOn ? n.delete(k) : n.add(k);
      return n;
    });
  }, []);
  const clearSelect = useCallback(() => setSelected(new Set()), []);
  const selectedPrs = useMemo(() => shown.filter((pr) => selected.has(selKey(pr))), [shown, selected]);

  // E2 — keyboard navigation: j/k move a cursor, o/Enter open, x select.
  const [focusIdx, setFocusIdx] = useState(-1);
  useEffect(() => { setFocusIdx(-1); }, [variant, curPage]);
  useEffect(() => {
    function onKey(e) {
      const tag = (e.target.tagName || '').toLowerCase();
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      if (!paged.length) return;
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusIdx((i) => Math.min(paged.length - 1, i + 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusIdx((i) => Math.max(0, (i < 0 ? 0 : i) - 1));
      } else if (e.key === 'o' || e.key === 'Enter') {
        const pr = paged[focusIdx];
        if (pr) navigate(`/pr/${encodeURIComponent(pr.repo)}/${pr.id}`);
      } else if (e.key === 'x' && selectable) {
        const pr = paged[focusIdx];
        if (pr) { e.preventDefault(); toggleSelect(pr); }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [paged, focusIdx, navigate, selectable, toggleSelect]);
  const focusedKey = focusIdx >= 0 && paged[focusIdx] ? selKey(paged[focusIdx]) : null;

  async function handleRefresh() {
    await api.refresh();
    refetch();
  }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <h2 className="section-title"><cfg.Icon size={20} /> {cfg.title}</h2>
        <div style={{ color: 'var(--text-muted)', marginTop: -8 }}>{cfg.desc}</div>
      </div>

      <FilterBar
        repositories={config.repositories}
        filters={filters}
        setFilters={setFilters}
        sort={sort}
        setSort={setSort}
        total={prs.length}
        shown={shown.length}
        exportCategory={cfg.exportCategory}
        exportStatus={fetchArg}
        onRefresh={handleRefresh}
        showStateFilter={cfg.showStateFilter}
        labels={availableLabels}
        revalidating={revalidating}
        extra={
          <SavedViews
            variant={variant}
            filters={filters}
            sort={sort}
            onApply={({ filters: f, sort: s }) => { setFilters((cur) => ({ ...cur, ...f })); if (s) setSort(s); }}
          />
        }
      />

      {loading ? (
        <Loading label="Fetching pull requests & enriching with comments, pipeline and review status…" />
      ) : error ? (
        <ErrorBox error={error} onRetry={refetch} />
      ) : shown.length === 0 ? (
        <Empty
          Icon={cfg.emptyIcon}
          label={prs.length === 0 ? 'No pull requests found' : 'No PRs match your filters'}
          action={
            prs.length === 0 ? (
              <Link className="btn sm" to="/settings"><Settings size={14} /> Adjust repositories &amp; team in Settings</Link>
            ) : null
          }
        />
      ) : (
        <>
          {selectable && (
            <BulkActionsBar
              variant={variant}
              selectedPrs={selectedPrs}
              onClear={clearSelect}
              onChanged={async () => { await api.refresh(); refetch(); }}
            />
          )}
          <PrTable
            prs={paged}
            variant={variant}
            sort={sort}
            setSort={setSort}
            onChanged={refetch}
            selectable={selectable}
            selected={selected}
            onToggleSelect={toggleSelect}
            onToggleAll={toggleAll}
            density={density}
            focusedKey={focusedKey}
          />
          <Pager page={curPage} pageSize={pageSize} total={shown.length} onPage={setPage} onPageSize={setPageSize} />
        </>
      )}
    </div>
  );
}
