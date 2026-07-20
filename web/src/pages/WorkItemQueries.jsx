import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useConfig } from '../lib/AppContext.jsx';
import { useAsync } from '../lib/useAsync.js';
import { api } from '../lib/api.js';
import { Loading, ErrorBox, Empty } from '../components/ui.jsx';
import { WorkItemTable } from '../components/WorkItemTable.jsx';
import { WorkItemFilterBar } from '../components/WorkItemFilterBar.jsx';
import { applyWorkItemFilterSort, deriveWorkItemOptions } from '../lib/workItemFilters.js';
import { Pager } from '../components/ui.jsx';
import { ListFilter, Settings } from '../components/icons.jsx';

const EMPTY_FILTERS = { types: [], states: [], categories: [], assignees: [], areas: [], iterations: [], tags: [], projects: [], priorities: [], search: '', timeRange: 'all' };

export function WorkItemQueries() {
  const config = useConfig();
  const queries = config.workItemSavedQueries || [];
  const [queryId, setQueryId] = useState(queries[0]?.id || '');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState({ key: 'changedDate', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const density = config.uiPrefs?.density || 'comfortable';
  const multiProject = (config.workItemProjects?.length || 0) > 1;

  const { data, loading, error, refetch, revalidating } = useAsync(
    () => (queryId ? api.wiRunQuery(queryId) : Promise.resolve([])),
    [queryId],
    { pollMs: 120000, cacheKey: queryId ? `wi:query:${queryId}` : undefined }
  );
  const types = useAsync(() => api.wiTypes(), [], { pollMs: 300000, cacheKey: 'wi:types' });
  const typeColors = useMemo(() => Object.fromEntries((types.data || []).map((t) => [t.name, t.color])), [types.data]);

  const items = useMemo(() => data || [], [data]);
  const options = useMemo(() => deriveWorkItemOptions(items), [items]);
  const shown = useMemo(() => applyWorkItemFilterSort(items, filters, sort), [items, filters, sort]);
  const totalPages = Math.max(1, Math.ceil(shown.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const paged = useMemo(() => shown.slice((curPage - 1) * pageSize, curPage * pageSize), [shown, curPage, pageSize]);
  useEffect(() => { setPage(1); }, [filters, sort, queryId, pageSize]);

  if (queries.length === 0) {
    return (
      <Empty
        Icon={ListFilter}
        label="No saved queries configured"
        action={<Link className="btn sm" to="/settings"><Settings size={14} /> Add saved ADO query IDs in Settings</Link>}
      />
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <h2 className="section-title"><ListFilter size={20} /> Saved Queries</h2>
          <div style={{ color: 'var(--text-muted)', marginTop: -8 }}>Run one of your saved Azure DevOps work-item queries.</div>
        </div>
        <select value={queryId} onChange={(e) => setQueryId(e.target.value)} style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, minWidth: 220 }}>
          {queries.map((q) => <option key={q.id} value={q.id}>{q.name}{q.project ? ` · ${q.project}` : ''}</option>)}
        </select>
      </div>

      <WorkItemFilterBar
        filters={filters}
        setFilters={setFilters}
        sort={sort}
        setSort={setSort}
        options={options}
        total={items.length}
        shown={shown.length}
        onRefresh={async () => { await api.refresh(); refetch(); }}
        multiProject={multiProject}
        revalidating={revalidating}
      />

      {loading ? (
        <Loading label="Running your saved query…" />
      ) : error ? (
        <ErrorBox error={error} onRetry={refetch} />
      ) : shown.length === 0 ? (
        <Empty Icon={ListFilter} label={items.length === 0 ? 'This query returned no work items' : 'No work items match your filters'} />
      ) : (
        <>
          <WorkItemTable items={paged} sort={sort} setSort={setSort} typeColors={typeColors} density={density} multiProject={multiProject} />
          <Pager page={curPage} pageSize={pageSize} total={shown.length} onPage={setPage} onPageSize={setPageSize} />
        </>
      )}
    </div>
  );
}
