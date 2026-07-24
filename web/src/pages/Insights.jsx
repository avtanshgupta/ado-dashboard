import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../lib/useAsync.js';
import { api } from '../lib/api.js';
import { Loading, RefreshingTag } from '../components/ui.jsx';
import { ThroughputChart, WiThroughputChart } from '../components/Charts.jsx';
import { buildDigest } from '../lib/insightsDigest.js';
import { LineChart as LineChartIcon, RefreshCw, ChevronRight, GitPullRequest, ClipboardList } from '../components/icons.jsx';

/**
 * Cross-area Insights (B2): one page that unifies PR, work-item, pipeline and
 * agent analytics into a weekly digest plus the key trend charts. Each source
 * loads independently so one slow area doesn't block the rest.
 */
export function Insights() {
  const pr = useAsync(() => api.prAnalytics(), [], { pollMs: 180000, cacheKey: 'pr:analytics:' });
  const wi = useAsync(() => api.wiOverview(), [], { pollMs: 180000, cacheKey: 'wi:overview' });
  const pl = useAsync(() => api.pipelineOverview(), [], { pollMs: 180000, cacheKey: 'pl:overview:dash' });
  const ag = useAsync(() => api.agentAnalytics(), [], { pollMs: 180000, cacheKey: 'agents:analytics' });

  const digest = useMemo(
    () => buildDigest({ prAnalytics: pr.data, wiOverview: wi.data, pipelineOverview: pl.data, agentAnalytics: ag.data }),
    [pr.data, wi.data, pl.data, ag.data]
  );

  const anyLoading = (pr.loading && !pr.data) || (wi.loading && !wi.data);
  const revalidating = pr.revalidating || wi.revalidating || pl.revalidating || ag.revalidating;
  const refreshAll = () => { pr.refetch(true); wi.refetch(true); pl.refetch(true); ag.refetch(true); };

  return (
    <div>
      <div className="dash-head">
        <div>
          <h2 className="section-title" style={{ margin: 0 }}><LineChartIcon size={20} /> Insights</h2>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>A cross-area weekly digest across pull requests, work items, pipelines and agents.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <RefreshingTag show={revalidating} />
          <button className="btn sm" onClick={refreshAll}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      <div className="insights-stats">
        {digest.stats.map((s) => (
          <div className="insights-stat card" key={s.key}>
            <div className="insights-stat-value">{s.display}</div>
            <div className="insights-stat-label">{s.label}</div>
            <div className="insights-stat-sub muted">{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h3 className="settings-section-head">This period at a glance</h3>
        <ul className="insights-highlights">
          {digest.highlights.map((h, i) => <li key={i}>{h}</li>)}
        </ul>
      </div>

      {anyLoading ? (
        <Loading label="Loading cross-area analytics…" />
      ) : (
        <div className="insights-charts">
          <div className="card card-pad">
            <div className="insights-chart-head">
              <h3><GitPullRequest size={15} /> PR merge throughput</h3>
              <Link className="mywork-viewall" to="/pull-requests">Pull requests <ChevronRight size={13} /></Link>
            </div>
            <ThroughputChart perWeek={pr.data?.throughput?.perWeek} />
          </div>
          <div className="card card-pad">
            <div className="insights-chart-head">
              <h3><ClipboardList size={15} /> Work items created vs closed</h3>
              <Link className="mywork-viewall" to="/work-items">Work items <ChevronRight size={13} /></Link>
            </div>
            <WiThroughputChart throughput={wi.data?.throughput} />
          </div>
        </div>
      )}
    </div>
  );
}
