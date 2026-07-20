import { useState, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useConfig } from '../lib/AppContext.jsx';
import { useAsync } from '../lib/useAsync.js';
import { api } from '../lib/api.js';
import { Loading, ErrorBox, Empty, RunStatusBadge, TimeAgo } from '../components/ui.jsx';
import { fmtDate, fmtDuration } from '../lib/format.js';
import { History, RefreshCw, Download, ExternalLink, ArrowUp, ArrowDown, GitBranch, Inbox } from '../components/icons.jsx';

const TIME_RANGES = [
  { key: 1, label: '1 month' },
  { key: 3, label: '3 months' },
  { key: 6, label: '6 months' },
  { key: 12, label: '1 year' },
];
const STATUS_FILTERS = ['All', 'Running', 'Queued', 'Succeeded', 'Failed', 'Partial', 'Canceled'];

function Th({ label, k, sort, setSort, align }) {
  const active = sort.key === k;
  const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  const apply = () => setSort((s) => ({ key: k, dir: s.key === k && s.dir === 'desc' ? 'asc' : 'desc' }));
  return (
    <th
      onClick={apply}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          apply();
        }
      }}
      tabIndex={0}
      aria-sort={ariaSort}
      title={`Sort by ${label}`}
      style={align ? { textAlign: align } : undefined}
    >
      {label}{active && <span className="sort-ind">{sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}</span>}
    </th>
  );
}

export function PipelineRuns() {
  const config = useConfig();
  const [params, setParams] = useSearchParams();
  const defs = useAsync(() => api.pipelineDefs(false), [], { cacheKey: 'pl:defs:short' });

  const defParam = params.get('def') || '';
  const [months, setMonths] = useState(config.defaultTimeRangeMonths || 6);
  const [statusFilter, setStatusFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState({ key: 'queueTime', dir: 'desc' });

  // Default to first definition once loaded.
  const definitionId = defParam || (defs.data && defs.data[0]?.definitionId) || '';
  function setDefinitionId(id) { setParams(id ? { def: id } : {}); }

  const runs = useAsync(
    () => (definitionId ? api.pipelineRuns(definitionId, { months }) : Promise.resolve([])),
    [definitionId, months],
    { pollMs: 30000, cacheKey: definitionId ? `pl:runs:${definitionId}:${months}` : undefined }
  );

  const shown = useMemo(() => {
    let list = runs.data || [];
    if (statusFilter !== 'All') list = list.filter((r) => r.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((r) => `${r.id} ${r.buildNumber} ${r.branch} ${r.requestedFor}`.toLowerCase().includes(q));
    const dir = sort.dir === 'asc' ? 1 : -1;
    const val = (r) => {
      switch (sort.key) {
        case 'queueTime': case 'startTime': case 'finishTime': return new Date(r[sort.key] || 0).getTime();
        case 'durationMs': return r.durationMs ?? -1;
        case 'status': return r.status;
        case 'branch': return r.branch || '';
        default: return r[sort.key] ?? '';
      }
    };
    return [...list].sort((a, b) => { const va = val(a), vb = val(b); return va < vb ? -1 * dir : va > vb ? 1 * dir : 0; });
  }, [runs.data, statusFilter, search, sort]);

  return (
    <div>
      <h2 className="section-title"><History size={20} /> My pipeline runs</h2>

      <div className="filter-bar no-print">
        <select value={definitionId} onChange={(e) => setDefinitionId(e.target.value)}>
          {(defs.data || []).map((d) => <option key={d.definitionId} value={d.definitionId}>{d.name}</option>)}
        </select>
        <select value={months} onChange={(e) => setMonths(Number(e.target.value))} title="Time window">
          {TIME_RANGES.map((r) => <option key={r.key} value={r.key}>Last {r.label}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          placeholder="Search id, build #, branch, author…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, minWidth: 220 }}
        />
        <div className="grow" />
        <span className="result-count">{shown.length}{runs.data ? ` of ${runs.data.length}` : ''}</span>
        <button className="btn sm" onClick={() => runs.refetch()}><RefreshCw size={14} /> Refresh</button>
        {definitionId && <a className="btn sm" href={api.pipelineExportUrl(definitionId, { months })}><Download size={14} /> CSV</a>}
      </div>

      {runs.loading ? (
        <Loading label="Loading runs…" />
      ) : runs.error ? (
        <ErrorBox error={runs.error} onRetry={runs.refetch} />
      ) : shown.length === 0 ? (
        <Empty Icon={Inbox} label={(runs.data || []).length === 0 ? 'No runs in this window' : 'No runs match your filters'} />
      ) : (
        <div className="table-wrap">
          <table className="pr-table">
            <thead>
              <tr>
                <Th label="Run" k="id" sort={sort} setSort={setSort} />
                <Th label="Status" k="status" sort={sort} setSort={setSort} />
                <Th label="Trigger" k="reasonLabel" sort={sort} setSort={setSort} />
                <Th label="Branch" k="branch" sort={sort} setSort={setSort} />
                <Th label="Duration" k="durationMs" sort={sort} setSort={setSort} />
                <Th label="Queued" k="queueTime" sort={sort} setSort={setSort} />
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id}>
                  <td className="pr-title-cell">
                    <Link className="title-link" to={`/pipelines/run/${r.id}`}>#{r.id}</Link>
                    <div className="meta"><span>{r.buildNumber}</span><span>{r.requestedFor}</span></div>
                  </td>
                  <td><RunStatusBadge status={r.status} /></td>
                  <td>{r.reasonLabel}</td>
                  <td title={r.sourceBranch} style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><GitBranch size={12} /> {r.branch}</td>
                  <td className="muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{fmtDuration(r.durationMs)}</td>
                  <td className="muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }} title={fmtDate(r.queueTime)}><TimeAgo date={r.queueTime} /></td>
                  <td>
                    <div className="row-actions">
                      <Link className="btn sm" to={`/pipelines/run/${r.id}`}>Details</Link>
                      <a className="btn sm" href={r.webUrl} target="_blank" rel="noreferrer">ADO <ExternalLink size={12} /></a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
