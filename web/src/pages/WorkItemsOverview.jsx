import { Link } from 'react-router-dom';
import { useConfig } from '../lib/AppContext.jsx';
import { useAsync } from '../lib/useAsync.js';
import { api } from '../lib/api.js';
import { Loading, ErrorBox, Empty, IdleTag, RefreshingTag } from '../components/ui.jsx';
import { WiDistributionChart, WiThroughputChart, WiAgingChart } from '../components/Charts.jsx';
import { WiTypeBadge, WiStateBadge } from '../components/workItemUi.jsx';
import { LayoutDashboard, RefreshCw, Inbox, ClipboardList, TriangleAlert, Settings } from '../components/icons.jsx';

function Metric({ label, value, sub, accent }) {
  return (
    <div className="card card-pad metric-card">
      <div className="metric-value" style={accent ? { color: accent } : undefined}>{value}</div>
      <div className="metric-label">{label}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}

const CAT_LABEL = { Proposed: 'Proposed', InProgress: 'In Progress', Resolved: 'Resolved', Completed: 'Completed', Removed: 'Removed' };

export function WorkItemsOverview() {
  const config = useConfig();
  const overview = useAsync(() => api.wiOverview(), [], { pollMs: 60000, cacheKey: 'wi:overview' });
  const a = overview.data;

  const hasScope = (config.workItemProjects?.length || 0) > 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 className="section-title" style={{ margin: 0 }}><LayoutDashboard size={20} /> Work Items</h2>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>A rollup of the work items you own, created, or that are on your team, across your monitored projects.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <RefreshingTag show={overview.revalidating} />
          <button className="btn sm" onClick={() => overview.refetch()}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      {overview.loading && !a ? (
        <Loading label="Aggregating your work items…" />
      ) : overview.error ? (
        <ErrorBox error={overview.error} onRetry={overview.refetch} />
      ) : !a || a.total === 0 ? (
        <Empty
          Icon={Inbox}
          label="No work items in your scope yet"
          action={<Link className="btn sm" to="/settings"><Settings size={14} /> Configure projects &amp; team in Settings</Link>}
        />
      ) : (
        <>
          <div className="grid cols-4" style={{ marginBottom: 16 }}>
            <Metric label="Open items" value={a.openCount} sub={`of ${a.total} in scope`} accent="#0969da" />
            <Metric label="Completed" value={a.completedCount} sub="terminal state" accent="#1f883d" />
            <Metric label="Unassigned (open)" value={a.unassignedCount} sub="need an owner" accent={a.unassignedCount ? 'var(--yellow)' : 'var(--green)'} />
            <Metric label="Breaching SLA" value={a.aging.breaching.length} sub={`idle ≥ ${a.slaDays}d`} accent={a.aging.breaching.length ? 'var(--red)' : 'var(--green)'} />
          </div>

          <div className="grid cols-2" style={{ marginBottom: 16 }}>
            <div className="card card-pad">
              <h3>By state category</h3>
              <WiDistributionChart data={a.byStateCategory.map((d) => ({ key: CAT_LABEL[d.key] || d.key, count: d.count }))} label="Items" />
            </div>
            <div className="card card-pad">
              <h3>By type</h3>
              <WiDistributionChart data={a.byType} label="Items" />
            </div>
          </div>

          <div className="grid cols-2" style={{ marginBottom: 16 }}>
            <div className="card card-pad">
              <h3>Created vs closed (weekly)</h3>
              <WiThroughputChart throughput={a.throughput} />
            </div>
            <div className="card card-pad">
              <h3>Open item age</h3>
              <WiAgingChart buckets={a.aging.buckets} />
            </div>
          </div>

          <div className="grid cols-2">
            <div className="card card-pad">
              <h3 className="section-title" style={{ fontSize: 15 }}><ClipboardList size={16} /> Top assignees</h3>
              {a.byAssignee.length === 0 ? <div className="muted">No data.</div> : (
                a.byAssignee.slice(0, 8).map((row) => (
                  <div key={row.key} className="kv">
                    <span className="k">{row.key}</span>
                    <span className="v"><strong>{row.count}</strong></span>
                  </div>
                ))
              )}
            </div>
            <div className="card card-pad">
              <h3 className="section-title" style={{ fontSize: 15 }}><TriangleAlert size={16} /> Oldest open items</h3>
              {a.aging.oldest.length === 0 ? <div className="muted">No open items.</div> : (
                <div className="table-wrap">
                  <table className="pr-table">
                    <thead><tr><th>Type</th><th>Item</th><th>State</th><th>Idle</th></tr></thead>
                    <tbody>
                      {a.aging.oldest.map((wi) => (
                        <tr key={wi.id}>
                          <td><WiTypeBadge type={wi.type} /></td>
                          <td className="pr-title-cell"><Link className="title-link" to={`/work-item/${wi.id}`}>{wi.title}</Link><div className="meta"><span>#{wi.id}</span></div></td>
                          <td><WiStateBadge state={wi.state} /></td>
                          <td><IdleTag days={wi.idleDays} threshold={config.slaDays || 7} /> <span className="muted" style={{ fontSize: 12 }}>{wi.ageDays}d old</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {!hasScope && (
        <div className="muted" style={{ marginTop: 16, fontSize: 13 }}>
          Tip: add <strong>projects</strong> and <strong>team members</strong> in <Link to="/settings">Settings</Link> to widen this rollup beyond your own items.
        </div>
      )}
    </div>
  );
}
