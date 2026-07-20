import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useConfig } from '../lib/AppContext.jsx';
import { useAsync } from '../lib/useAsync.js';
import { api } from '../lib/api.js';
import { Loading, ErrorBox, ReviewBadge, IdleTag } from '../components/ui.jsx';
import { ThroughputChart, AgingChart } from '../components/Charts.jsx';
import { repoShort, STATE_COLORS } from '../lib/format.js';
import {
  LayoutList, FolderGit2, GitPullRequestArrow, Eye, UserCheck, Users,
  GitMerge, Clock, TriangleAlert, RefreshCw,
} from '../components/icons.jsx';

const MONTH_OPTIONS = [
  { v: 1, label: '1 month' },
  { v: 3, label: '3 months' },
  { v: 6, label: '6 months' },
  { v: 12, label: '1 year' },
  { v: 24, label: '2 years' },
];

/** Human hours → "3.4h" / "2.1d". */
function fmtHours(h) {
  if (h == null) return '—';
  if (h < 48) return `${h}h`;
  return `${Math.round((h / 24) * 10) / 10}d`;
}

function StateCounts({ counts }) {
  return (
    <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
      {['Open', 'Draft', 'Closed', 'Merged'].map((s) => (
        <div key={s} style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: STATE_COLORS[s] }}>{counts[s] ?? 0}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.3 }}>{s}</div>
        </div>
      ))}
    </div>
  );
}

function CategoryCard({ title, Icon, counts, to, accent }) {
  return (
    <Link to={to} className="card card-pad" style={{ textDecoration: 'none', color: 'inherit', borderTop: `3px solid ${accent}` }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong style={{ fontSize: 15, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon size={16} /> {title}</strong>
        <span style={{ color: 'var(--text-subtle)' }}>→</span>
      </div>
      <StateCounts counts={counts} />
    </Link>
  );
}

function Stat({ label, value, sub, accent }) {
  return (
    <div className="card card-pad metric-card">
      <div className="metric-value" style={accent ? { color: accent } : undefined}>{value}</div>
      <div className="metric-label">{label}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}

export function Overview() {
  const config = useConfig();
  const [months, setMonths] = useState(config.defaultTimeRangeMonths || 6);
  // One page: operational category counts (overview) + my personal analytics.
  const overview = useAsync(() => api.overview(months), [months], { pollMs: 60000 });
  const analytics = useAsync(() => api.prAnalytics(months), [months]);

  if (overview.loading && !overview.data) return <Loading label="Loading pull requests…" />;
  if (overview.error) return <ErrorBox error={overview.error} onRetry={overview.refetch} />;

  const data = overview.data;
  const a = analytics.data;

  function refresh() {
    overview.refetch(true);
    analytics.refetch(true);
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 className="section-title" style={{ margin: 0 }}><LayoutList size={20} /> Pull Requests</h2>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>Your workload at a glance, plus your personal PR analytics.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="muted" style={{ fontSize: 13 }}>Last</span>
          <select value={months} onChange={(e) => setMonths(Number(e.target.value))}
            style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
            {MONTH_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
          </select>
          <button className="btn sm" onClick={refresh}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      {/* Category counts + navigation */}
      <div className="grid cols-4 page-section">
        <CategoryCard title="My Pull Requests" Icon={GitPullRequestArrow} counts={data.my} to="/pull-requests/created" accent="#0969da" />
        <CategoryCard title="Assigned to Me" Icon={Eye} counts={data.assignedMe} to="/pull-requests/assigned" accent="#bf8700" />
        <CategoryCard title="Assigned to Team" Icon={UserCheck} counts={data.assignedTeam} to="/pull-requests/assigned-team" accent="#bc4c00" />
        <CategoryCard title="Authored By Team" Icon={Users} counts={data.team} to="/pull-requests/team" accent="#8250df" />
      </div>

      {/* My personal analytics */}
      <h2 className="section-title" style={{ fontSize: 15 }}>My analytics <span className="muted" style={{ fontWeight: 400, fontSize: 12.5 }}>· your pull requests only</span></h2>
      {analytics.loading && !a ? (
        <Loading label="Crunching your PR analytics…" />
      ) : analytics.error ? (
        <ErrorBox error={analytics.error} onRetry={analytics.refetch} />
      ) : a ? (
        <>
          <div className="grid cols-4 page-section">
            <Stat label="My median cycle time" value={fmtHours(a.cycleTime.medianHours)} sub={`p75 ${fmtHours(a.cycleTime.p75Hours)} · p90 ${fmtHours(a.cycleTime.p90Hours)}`} accent="#0969da" />
            <Stat label="Merged (my PRs)" value={a.throughput.total} sub={`~${a.throughput.avgPerWeek}/week`} accent="#8250df" />
            <Stat label="My merge rate" value={a.mine.mergeRate == null ? '—' : `${a.mine.mergeRate}%`} sub={`${a.mine.merged} merged · ${a.mine.abandoned} abandoned`} accent="#1f883d" />
            <Stat label="Breaching SLA" value={a.openAging.breachingSla.length} sub={`open ${a.openAging.slaDays}d+ idle`} accent={a.openAging.breachingSla.length ? 'var(--red)' : 'var(--green)'} />
          </div>

          <div className="grid cols-2 page-section">
            <div className="card card-pad">
              <h3><GitMerge size={16} /> My merge throughput</h3>
              <ThroughputChart perWeek={a.throughput.perWeek} />
            </div>
            <div className="card card-pad">
              <h3><Clock size={16} /> My open PR aging</h3>
              <AgingChart buckets={a.openAging.buckets} />
            </div>
          </div>

          <div className="grid cols-2 page-section">
            <div className="card card-pad">
              <h3><Eye size={16} /> Awaiting my review ({a.review.awaitingCount})</h3>
              {a.review.awaiting.length === 0 ? (
                <div className="muted">Nothing is waiting on your review. You've given {a.review.approvalsGiven} approval{a.review.approvalsGiven === 1 ? '' : 's'} in open PRs.</div>
              ) : (
                <div className="table-wrap">
                  <table className="pr-table">
                    <thead><tr><th>Pull request</th><th>Author</th><th>Waiting</th></tr></thead>
                    <tbody>
                      {a.review.awaiting.map((pr) => (
                        <tr key={`${pr.repo}#${pr.id}`}>
                          <td className="pr-title-cell">
                            <Link className="title-link" to={`/pr/${encodeURIComponent(pr.repo)}/${pr.id}`}>{pr.title}</Link>
                            <div className="meta"><span className="badge repo">{repoShort(pr.repo)}</span><span>!{pr.id}</span></div>
                          </td>
                          <td className="muted" style={{ fontSize: 12.5 }}>{pr.author || '—'}</td>
                          <td><IdleTag days={pr.idleDays} threshold={1} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="card card-pad">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
                <h3 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <TriangleAlert size={16} style={{ color: 'var(--red)' }} /> My PRs breaching SLA
                  <span className="badge">{a.openAging.breachingSla.length}</span>
                </h3>
              </div>
              {a.openAging.breachingSla.length === 0 ? (
                <div className="muted">None of your PRs are breaching your {a.openAging.slaDays}-day SLA. 🎉</div>
              ) : (
                <div className="table-wrap">
                  <table className="pr-table">
                    <thead><tr><th>Pull request</th><th>Review</th><th>Idle</th></tr></thead>
                    <tbody>
                      {a.openAging.breachingSla.map((pr) => (
                        <tr key={`${pr.repo}#${pr.id}`}>
                          <td className="pr-title-cell">
                            <Link className="title-link" to={`/pr/${encodeURIComponent(pr.repo)}/${pr.id}`}>{pr.title}</Link>
                            <div className="meta"><span className="badge repo">{repoShort(pr.repo)}</span><span>!{pr.id}</span></div>
                          </td>
                          <td>{pr.reviewStatus ? <ReviewBadge status={pr.reviewStatus} /> : '—'}</td>
                          <td><IdleTag days={pr.idleDays} threshold={1} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}

      {/* Per-repository breakdown */}
      <div className="page-section">
        <h2 className="section-title"><FolderGit2 size={18} /> Repositories</h2>
        <div className="grid cols-4">
          {data.perRepo.map((r) => (
            <div className="card card-pad" key={r.repo}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>{repoShort(r.repo)}</strong>
                <a className="btn sm" href={r.webUrl} target="_blank" rel="noreferrer">Open ↗</a>
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: 12, margin: '4px 0 12px' }}>{r.repo}</div>
              <div className="kv"><span className="k">My open</span><span className="v">{r.my.Open + r.my.Draft}</span></div>
              <div className="kv"><span className="k">Assigned to me</span><span className="v">{r.assignedMe.Open + r.assignedMe.Draft}</span></div>
              <div className="kv"><span className="k">Assigned to team</span><span className="v">{r.assignedTeam.Open + r.assignedTeam.Draft}</span></div>
              <div className="kv"><span className="k">Team open</span><span className="v">{r.team.Open + r.team.Draft}</span></div>
              <div className="kv"><span className="k">My merged ({data.months}mo)</span><span className="v">{r.my.Merged}</span></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
