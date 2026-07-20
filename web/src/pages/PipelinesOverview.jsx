import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useConfig } from '../lib/AppContext.jsx';
import { useAsync } from '../lib/useAsync.js';
import { api } from '../lib/api.js';
import { Loading, ErrorBox, Empty, RunStatusBadge } from '../components/ui.jsx';
import { PipelineTrendChart } from '../components/Charts.jsx';
import { repoShort, timeAgo, fmtDuration } from '../lib/format.js';
import {
  LayoutDashboard, Play, Activity, RefreshCw, CheckCircle2, GitBranch,
  LineChart, Dices, Inbox,
} from '../components/icons.jsx';

const RANGES = [
  { v: 1, label: '1 month' },
  { v: 3, label: '3 months' },
  { v: 6, label: '6 months' },
  { v: 12, label: '1 year' },
];

function RunRow({ r }) {
  return (
    <tr>
      <td className="pr-title-cell">
        <Link className="title-link" to={`/pipelines/run/${r.id}`}>{r.definitionName}</Link>
        <div className="meta">
          <span>#{r.id}</span>
          <span title={r.sourceBranch} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><GitBranch size={12} /> {r.branch}</span>
          <span>{r.reasonLabel}</span>
        </div>
      </td>
      <td><span className="badge repo">{repoShort(r.repo)}</span></td>
      <td><RunStatusBadge status={r.status} /></td>
      <td className="muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{fmtDuration(r.durationMs)}</td>
      <td className="muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }} title={r.queueTime}>{timeAgo(r.startTime || r.queueTime)}</td>
      <td style={{ textAlign: 'right' }}>
        <Link className="btn sm" to={`/pipelines/run/${r.id}`}>Details</Link>
      </td>
    </tr>
  );
}

function PipelineHealthCard({ p }) {
  const last = p.lastRun;
  return (
    <div className="card card-pad">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
        <div>
          <strong style={{ fontSize: 14 }}>{p.name}</strong>
          <div className="muted" style={{ fontSize: 12 }}>{repoShort(p.repo)}</div>
        </div>
        {last ? <RunStatusBadge status={last.status} /> : <span className="muted">no runs</span>}
      </div>
      {last && (
        <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          <Link to={`/pipelines/run/${last.id}`}>#{last.id}</Link> · {last.branch} · {timeAgo(last.startTime || last.queueTime)}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
        <Link className="btn sm" to={`/pipelines/runs?def=${p.definitionId}`}>Runs</Link>
        <Link className="btn sm accent" to={`/pipelines/trigger?def=${p.definitionId}`}><Play size={13} /> Trigger</Link>
      </div>
    </div>
  );
}

function Metric({ label, value, sub, accent }) {
  return (
    <div className="card card-pad metric-card">
      <div className="metric-value" style={accent ? { color: accent } : undefined}>{value}</div>
      <div className="metric-label">{label}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}

/** Per-pipeline analytics deep-dive (your runs): success rate, duration, trend, flaky. */
function AnalyticsSection({ defs, months }) {
  const [definitionId, setDefinitionId] = useState('');
  useEffect(() => {
    if (!definitionId && defs.length) setDefinitionId(String(defs[0].definitionId));
  }, [defs, definitionId]);

  const analytics = useAsync(
    () => (definitionId ? api.pipelineAnalytics(definitionId, months) : Promise.resolve(null)),
    [definitionId, months],
    { pollMs: 60000 }
  );
  const a = analytics.data;
  const selected = defs.find((d) => String(d.definitionId) === String(definitionId));
  const rateColor = a?.successRate == null ? 'var(--text-subtle)' : a.successRate >= 80 ? 'var(--green)' : a.successRate >= 50 ? 'var(--yellow)' : 'var(--red)';

  if (defs.length === 0) return null;

  return (
    <div className="page-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <h3 className="section-title" style={{ fontSize: 15, margin: 0 }}>
          <LineChart size={16} /> My run analytics
          {selected && <span className="muted" style={{ fontWeight: 400, fontSize: 12.5 }}> · {selected.name}</span>}
        </h3>
        <select value={definitionId} onChange={(e) => setDefinitionId(e.target.value)} style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
          {defs.map((d) => <option key={d.definitionId} value={d.definitionId}>{d.name}</option>)}
        </select>
      </div>

      {analytics.loading && !a ? (
        <Loading label="Crunching your run history…" />
      ) : analytics.error ? (
        <ErrorBox error={analytics.error} onRetry={analytics.refetch} />
      ) : !a || a.total === 0 ? (
        <Empty Icon={Inbox} label="You have no runs for this pipeline in the selected window" />
      ) : (
        <>
          <div className="grid cols-4" style={{ marginBottom: 16 }}>
            <Metric label="Build success rate" value={a.successRate == null ? '—' : `${a.successRate}%`} sub={a.sampleSize ? `of ${a.sampleSize} completed run${a.sampleSize === 1 ? '' : 's'}` : 'no completed runs'} accent={rateColor} />
            <Metric label="My total runs" value={a.total} sub={`in the last ${months} month${months === 1 ? '' : 's'}`} accent="#0969da" />
            <Metric label="Mean duration" value={fmtDuration(a.meanDurationMs)} sub={`median ${fmtDuration(a.medianDurationMs)}`} accent="#8250df" />
            <Metric label="Flaky commits" value={a.flakyCount} sub="same commit passed & failed" accent={a.flakyCount ? 'var(--red)' : 'var(--green)'} />
          </div>

          <div className="grid cols-2" style={{ marginBottom: a.flaky.length > 0 ? 16 : 0 }}>
            <div className="card card-pad">
              <h3>Weekly pass / fail trend</h3>
              <PipelineTrendChart trend={a.trend} />
            </div>
            <div className="card card-pad">
              <h3>Status breakdown</h3>
              {Object.keys(a.byStatus).length === 0 ? (
                <div className="muted">No runs.</div>
              ) : (
                Object.entries(a.byStatus)
                  .sort((x, y) => y[1] - x[1])
                  .map(([status, count]) => (
                    <div key={status} className="kv">
                      <span className="k"><RunStatusBadge status={status} /></span>
                      <span className="v"><strong>{count}</strong></span>
                    </div>
                  ))
              )}
            </div>
          </div>

          {a.flaky.length > 0 && (
            <div>
              <h3 className="section-title" style={{ fontSize: 15 }}><Dices size={16} /> Flaky commits ({a.flakyCount})</h3>
              <div className="table-wrap">
                <table className="pr-table">
                  <thead><tr><th>Commit</th><th>Branch</th><th>Passed</th><th>Failed</th><th>Runs</th></tr></thead>
                  <tbody>
                    {a.flaky.map((f) => (
                      <tr key={f.commit}>
                        <td><code>{f.commit}</code></td>
                        <td title={f.branch} style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><GitBranch size={12} /> {f.branch}</td>
                        <td><span className="badge run-Succeeded">{f.pass}</span></td>
                        <td><span className="badge run-Failed">{f.fail}</span></td>
                        <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {f.runs.map((r) => <RunStatusBadge key={r.id} status={r.status} />)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function PipelinesOverview() {
  const config = useConfig();
  const [months, setMonths] = useState(config.defaultTimeRangeMonths || 6);
  const overview = useAsync(() => api.pipelineOverview(months), [months], { pollMs: 30000 });
  const defs = useAsync(() => api.pipelineDefs(true), [], { pollMs: 60000 });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 className="section-title" style={{ margin: 0 }}><LayoutDashboard size={20} /> Pipelines</h2>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>Your active runs, pipeline health, and your run analytics.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))} style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
            {RANGES.map((r) => <option key={r.v} value={r.v}>Last {r.label}</option>)}
          </select>
          <button className="btn sm" onClick={() => { overview.refetch(); defs.refetch(); }}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      <div className="page-section">
        <h3 className="section-title" style={{ fontSize: 15 }}><Play size={16} /> My active runs {overview.data ? `(${overview.data.active.length})` : ''}</h3>
        {overview.loading ? (
          <Loading label="Loading your runs…" />
        ) : overview.error ? (
          <ErrorBox error={overview.error} onRetry={overview.refetch} />
        ) : overview.data.active.length === 0 ? (
          <Empty Icon={CheckCircle2} label="No active runs right now" />
        ) : (
          <div className="table-wrap">
            <table className="pr-table">
              <thead><tr><th>Pipeline</th><th>Repo</th><th>Status</th><th>Duration</th><th>Started</th><th></th></tr></thead>
              <tbody>{overview.data.active.map((r) => <RunRow key={r.id} r={r} />)}</tbody>
            </table>
          </div>
        )}
      </div>

      <div className="page-section">
        <h3 className="section-title" style={{ fontSize: 15 }}><Activity size={16} /> Pipeline health</h3>
        {defs.loading ? (
          <Loading label="Loading pipelines…" />
        ) : defs.error ? (
          <ErrorBox error={defs.error} onRetry={defs.refetch} />
        ) : (defs.data || []).length === 0 ? (
          <Empty Icon={Activity} label="No pipelines configured — add some in Settings" />
        ) : (
          <div className="grid cols-3">
            {defs.data.map((p) => <PipelineHealthCard key={p.definitionId} p={p} />)}
          </div>
        )}
      </div>

      {!defs.loading && !defs.error && <AnalyticsSection defs={defs.data || []} months={months} />}
    </div>
  );
}
