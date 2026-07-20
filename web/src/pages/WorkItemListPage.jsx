import { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useConfig } from '../lib/AppContext.jsx';
import { useAsync } from '../lib/useAsync.js';
import { api } from '../lib/api.js';
import { Loading, ErrorBox, Empty, Pager } from '../components/ui.jsx';
import { WorkItemFilterBar } from '../components/WorkItemFilterBar.jsx';
import { WorkItemTable } from '../components/WorkItemTable.jsx';
import { SavedViews } from '../components/SavedViews.jsx';
import { applyWorkItemFilterSort, deriveWorkItemOptions } from '../lib/workItemFilters.js';
import { Eye, ClipboardList, Users, Bell, CalendarClock, Settings } from '../components/icons.jsx';

const VARIANTS = {
  assigned: { Icon: Eye, title: 'Work Items Assigned to Me', desc: 'Every work item where you are the assignee, across all configured projects.', fetch: () => api.wiList('assigned'), exportTab: 'assigned' },
  created: { Icon: ClipboardList, title: 'Work Items I Created', desc: 'Work items you opened, across all configured projects.', fetch: () => api.wiList('created'), exportTab: 'created' },
  team: { Icon: Users, title: 'Team Work Items', desc: 'Work items assigned to your configured team members.', fetch: () => api.wiList('team'), exportTab: 'team' },
  following: { Icon: Bell, title: 'Following / Mentioned', desc: 'Work items whose discussion mentions you (@mentions and comment participation).', fetch: () => api.wiList('following'), exportTab: 'following' },
  sprint: { Icon: CalendarClock, title: 'Current Sprint', desc: 'Work items in the active iteration.', fetch: null, sprint: true },
};

const PREFS_KEY = 'ado-wi-list-prefs';
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; }
}
function savePrefs(prefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

const EMPTY_FILTERS = { types: [], states: [], categories: [], assignees: [], areas: [], iterations: [], tags: [], projects: [], priorities: [], search: '', timeRange: 'all' };

export function WorkItemListPage({ variant }) {
  const cfg = VARIANTS[variant];
  const config = useConfig();
  const navigate = useNavigate();
  const [sprintScope, setSprintScope] = useState('mine');
  const [filters, setFilters] = useState(() => {
    const saved = loadPrefs();
    return { ...EMPTY_FILTERS, timeRange: saved.timeRange || 'all', categories: saved.categories || [] };
  });
  const [sort, setSort] = useState(() => loadPrefs().sort || { key: 'changedDate', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => loadPrefs().pageSize || 25);

  const density = config.uiPrefs?.density || 'comfortable';
  const multiProject = (config.workItemProjects?.length || 0) > 1;

  useEffect(() => { savePrefs({ timeRange: filters.timeRange, categories: filters.categories, sort, pageSize }); }, [filters.timeRange, filters.categories, sort, pageSize]);
  useEffect(() => { setPage(1); }, [filters, sort, variant, pageSize]);
  // Tab-specific facet selections shouldn't leak across tabs.
  useEffect(() => {
    setFilters((f) => ({ ...EMPTY_FILTERS, timeRange: f.timeRange, categories: f.categories }));
  }, [variant]);

  const fetchFn = cfg.sprint ? () => api.wiSprint(sprintScope) : cfg.fetch;
  const { data, loading, error, refetch, revalidating } = useAsync(
    fetchFn,
    [variant, cfg.sprint ? sprintScope : null],
    { pollMs: 90000, cacheKey: `wi:list:${variant}:${cfg.sprint ? sprintScope : ''}` }
  );
  const types = useAsync(() => api.wiTypes(), [], { pollMs: 300000, cacheKey: 'wi:types' });
  const typeColors = useMemo(() => Object.fromEntries((types.data || []).map((t) => [t.name, t.color])), [types.data]);

  const items = useMemo(() => data || [], [data]);
  const options = useMemo(() => deriveWorkItemOptions(items), [items]);
  const shown = useMemo(() => applyWorkItemFilterSort(items, filters, sort), [items, filters, sort]);
  const totalPages = Math.max(1, Math.ceil(shown.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const paged = useMemo(() => shown.slice((curPage - 1) * pageSize, curPage * pageSize), [shown, curPage, pageSize]);

  // Keyboard navigation: j/k move a cursor, o/Enter open.
  const [focusIdx, setFocusIdx] = useState(-1);
  useEffect(() => { setFocusIdx(-1); }, [variant, curPage]);
  useEffect(() => {
    function onKey(e) {
      const tag = (e.target.tagName || '').toLowerCase();
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
      if (!paged.length) return;
      if (e.key === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setFocusIdx((i) => Math.min(paged.length - 1, i + 1)); }
      else if (e.key === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setFocusIdx((i) => Math.max(0, (i < 0 ? 0 : i) - 1)); }
      else if (e.key === 'o' || e.key === 'Enter') { const wi = paged[focusIdx]; if (wi) navigate(`/work-item/${wi.id}`); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [paged, focusIdx, navigate]);
  const focusedKey = focusIdx >= 0 && paged[focusIdx] ? String(paged[focusIdx].id) : null;

  async function handleRefresh() { await api.refresh(); refetch(); }

  return (
    <div>
      <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <h2 className="section-title"><cfg.Icon size={20} /> {cfg.title}</h2>
          <div style={{ color: 'var(--text-muted)', marginTop: -8 }}>{cfg.desc}</div>
        </div>
        {cfg.sprint && (
          <select value={sprintScope} onChange={(e) => setSprintScope(e.target.value)} style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
            <option value="mine">Assigned to me</option>
            <option value="all">Everyone in the sprint</option>
          </select>
        )}
      </div>

      <WorkItemFilterBar
        filters={filters}
        setFilters={setFilters}
        sort={sort}
        setSort={setSort}
        options={options}
        total={items.length}
        shown={shown.length}
        onRefresh={handleRefresh}
        exportTab={cfg.exportTab}
        multiProject={multiProject}
        revalidating={revalidating}
      />
      <div className="filter-bar no-print" style={{ paddingTop: 0 }}>
        <SavedViews
          variant={`wi:${variant}`}
          filters={filters}
          sort={sort}
          onApply={({ filters: f, sort: s }) => { setFilters((cur) => ({ ...cur, ...f })); if (s) setSort(s); }}
        />
      </div>

      {loading ? (
        <Loading label="Fetching work items across your projects…" />
      ) : error ? (
        <ErrorBox error={error} onRetry={refetch} />
      ) : shown.length === 0 ? (
        <Empty
          Icon={cfg.Icon}
          label={items.length === 0 ? 'No work items found' : 'No work items match your filters'}
          action={items.length === 0 ? <Link className="btn sm" to="/settings"><Settings size={14} /> Configure projects &amp; team in Settings</Link> : null}
        />
      ) : (
        <>
          <WorkItemTable items={paged} sort={sort} setSort={setSort} typeColors={typeColors} density={density} focusedKey={focusedKey} multiProject={multiProject} />
          <Pager page={curPage} pageSize={pageSize} total={shown.length} onPage={setPage} onPageSize={setPageSize} />
        </>
      )}
    </div>
  );
}
