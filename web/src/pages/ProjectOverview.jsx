import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useConfig } from '../lib/AppContext.jsx';
import { useAsync } from '../lib/useAsync.js';
import { api } from '../lib/api.js';
import { Loading, ErrorBox, StateBadge, PipelineBadge, ReviewBadge, TimeAgo, IdleTag, Avatar, useToast } from '../components/ui.jsx';
import { MergeModal } from '../components/actions.jsx';
import { repoShort, PIPELINE_COLORS } from '../lib/format.js';
import {
  LayoutDashboard, Clock, Info, RefreshCw, GitPullRequestArrow, Eye, UserCheck, Users,
  Zap, GitMerge, TriangleAlert, FilePenLine, Hourglass, PartyPopper, ChevronRight, Plus, Play, CheckCircle2,
} from '../components/icons.jsx';

// Shared category presentation for the "needs your attention" items.
const CAT = {
  fix: { label: 'Fix', Icon: TriangleAlert, color: 'var(--red)' },
  review: { label: 'Review', Icon: Eye, color: '#0969da' },
  merge: { label: 'Merge', Icon: GitMerge, color: 'var(--green)' },
  stale: { label: 'Stale', Icon: Clock, color: '#9a6700' },
  draft: { label: 'Draft', Icon: FilePenLine, color: '#8250df' },
  waiting: { label: 'Waiting', Icon: Hourglass, color: 'var(--text-subtle)' },
};

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function Metric({ label, value, sub, accent, to, Icon }) {
  const inner = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {Icon && <Icon size={15} style={{ color: accent || 'var(--text-subtle)' }} />}
        <div className="metric-value" style={accent ? { color: accent } : undefined}>{value}</div>
      </div>
      <div className="metric-label">{label}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </>
  );
  return to ? (
    <Link to={to} className="card card-pad metric-card" style={{ textDecoration: 'none', color: 'inherit' }}>{inner}</Link>
  ) : (
    <div className="card card-pad metric-card">{inner}</div>
  );
}

function SuccessGauge({ rate, sample }) {
  const color = rate == null ? 'var(--text-subtle)' : rate >= 80 ? 'var(--green)' : rate >= 50 ? 'var(--yellow)' : 'var(--red)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ fontSize: 30, fontWeight: 700, color }}>{rate == null ? '—' : `${rate}%`}</div>
      <div className="muted" style={{ fontSize: 12.5 }}>
        build success rate<br />
        {sample ? `of ${sample} completed gating run${sample === 1 ? '' : 's'}` : 'no completed runs yet'}
      </div>
    </div>
  );
}

function PipelineBar({ breakdown }) {
  const order = ['Succeeded', 'Failed', 'Queued', 'Running', 'Expired', 'Pending'];
  const entries = order.map((k) => [k, breakdown[k] || 0]).filter(([, v]) => v > 0);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  if (!total) return <div className="muted">No gating pipelines on your active PRs.</div>;
  return (
    <div>
      <div className="stack-bar" style={{ display: 'flex', height: 22, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border-muted)' }}>
        {entries.map(([k, v]) => (
          <div key={k} title={`${k}: ${v}`} style={{ width: `${(100 * v) / total}%`, background: PIPELINE_COLORS[k] || '#8c959f' }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 10 }}>
        {entries.map(([k, v]) => (
          <span key={k} style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: PIPELINE_COLORS[k] || '#8c959f', display: 'inline-block' }} />
            {k} <strong>{v}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function AttentionItem({ item, onMerge }) {
  const m = CAT[item.category] || CAT.waiting;
  return (
    <div className="attn-item">
      <span className="attn-cat" style={{ color: m.color }} title={m.label}><m.Icon size={16} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Link className="title-link" to={`/pr/${encodeURIComponent(item.repo)}/${item.id}`} style={{ fontWeight: 600 }}>{item.title}</Link>
          <span className="badge repo">{repoShort(item.repo)}</span>
          <span className="muted" style={{ fontSize: 12 }}>!{item.id}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 3, flexWrap: 'wrap' }}>
          <span className="muted" style={{ fontSize: 12.5 }}>{item.reason}</span>
          <IdleTag days={item.idleDays} threshold={1} />
          {item.source === 'assigned' && item.author && (
            <span className="muted" style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}><Avatar name={item.author} size={15} /> {item.author}</span>
          )}
        </div>
      </div>
      <div className="row-actions" style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        {item.category === 'merge' && (
          <button className="btn sm primary" onClick={() => onMerge(item)}><GitMerge size={13} /> Merge</button>
        )}
        <Link className="btn sm" to={`/pr/${encodeURIComponent(item.repo)}/${item.id}`}>
          {item.category === 'review' ? 'Review' : item.category === 'fix' ? 'Fix' : 'Open'} <ChevronRight size={13} />
        </Link>
      </div>
    </div>
  );
}

export function ProjectOverview() {
  const config = useConfig();
  const toast = useToast();
  const { data, loading, error, refetch } = useAsync(() => api.summary(), [], { pollMs: 90000 });
  const [mergeTarget, setMergeTarget] = useState(null);

  if (loading && !data) return <Loading label="Loading your dashboard…" />;
  if (error) return <ErrorBox error={error} onRetry={refetch} />;

  const firstName = (data.me?.displayName || config.me.displayName || '').split(' ')[0];
  const top = data.priority?.top || [];
  const summaryLine = data.actionable > 0
    ? `You have ${data.actionable} thing${data.actionable === 1 ? '' : 's'} needing your attention.`
    : "You're all caught up — nothing needs your attention right now. 🎉";

  return (
    <div>
      <div className="dash-head">
        <div>
          <h2 className="section-title" style={{ margin: 0 }}><LayoutDashboard size={20} /> {greeting()}, {firstName}</h2>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{summaryLine}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Link className="btn sm" to="/pull-requests/new"><Plus size={14} /> New PR</Link>
          <Link className="btn sm" to="/pipelines/trigger"><Play size={14} /> Trigger</Link>
          <Link className="btn sm accent" to="/action-center"><Zap size={14} /> Action Center</Link>
          <button className="btn sm" onClick={() => refetch(true)}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      {(!config.repositories || config.repositories.length === 0) && (
        <div className="publish-banner no-print" style={{ marginBottom: 16 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Info size={16} /> No repositories are configured yet — add the repos you want to track to populate this dashboard.
          </span>
          <Link className="btn primary" to="/settings">Go to Settings</Link>
        </div>
      )}

      <div className="grid cols-4 page-section">
        <Metric label="Needs my attention" value={data.actionable} sub="fix · review · merge · stale" accent={data.actionable ? 'var(--red)' : 'var(--green)'} to="/action-center" Icon={Zap} />
        <Metric label="Ready to merge" value={data.readyToMerge} sub="all gates green" accent="#1f883d" to="/pull-requests/created" Icon={GitMerge} />
        <Metric label="Awaiting my review" value={data.awaitingMyReview} sub="not yet voted" accent="#bf8700" to="/pull-requests/assigned" Icon={Eye} />
        <Metric label="Merged this week" value={data.mergedThisWeek} sub="your throughput" accent="#8250df" Icon={CheckCircle2} />
      </div>

      {/* Needs your attention */}
      <div className="page-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
          <h2 className="section-title" style={{ margin: 0 }}><Zap size={18} /> Needs your attention</h2>
          {top.length > 0 && <Link to="/action-center" className="btn sm">Open Action Center →</Link>}
        </div>
        {top.length === 0 ? (
          <div className="card card-pad" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)' }}>
            <PartyPopper size={20} style={{ color: 'var(--green)' }} /> {summaryLine}
          </div>
        ) : (
          <div className="card" style={{ padding: 6 }}>
            {top.map((item) => <AttentionItem key={`${item.repo}#${item.id}`} item={item} onMerge={setMergeTarget} />)}
          </div>
        )}
      </div>

      <div className="grid cols-2 page-section">
        <div className="card card-pad">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0 }}>My pipeline status</h3>
            <SuccessGauge rate={data.buildSuccessRate} sample={data.buildSampleSize} />
          </div>
          <PipelineBar breakdown={data.pipelineBreakdown} />
        </div>
        <div className="card card-pad">
          <h3>Open PRs by category</h3>
          {[
            { k: 'mine', Icon: GitPullRequestArrow, label: 'My Pull Requests', to: '/pull-requests/created' },
            { k: 'assignedMe', Icon: Eye, label: 'Assigned to Me', to: '/pull-requests/assigned' },
            { k: 'assignedTeam', Icon: UserCheck, label: 'Assigned to Team', to: '/pull-requests/assigned-team' },
            { k: 'team', Icon: Users, label: 'Authored By Team', to: '/pull-requests/team' },
          ].map((row) => (
            <Link key={row.k} to={row.to} className="kv" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="k" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><row.Icon size={15} /> {row.label}</span>
              <span className="v"><strong>{data.openPrs[row.k]}</strong></span>
            </Link>
          ))}
          <div className="kv" style={{ borderTop: '1px solid var(--border-muted)', marginTop: 4, paddingTop: 8 }}>
            <span className="k" style={{ fontWeight: 600 }}>Total open</span>
            <span className="v"><strong>{data.totalOpen}</strong></span>
          </div>
        </div>
      </div>

      <div className="page-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 className="section-title"><Clock size={18} /> Recent activity</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {data.generatedAt && <span className="muted" style={{ fontSize: 12 }}>updated <TimeAgo date={data.generatedAt} /></span>}
            <Link to="/pull-requests" className="btn sm">All pull requests →</Link>
          </div>
        </div>
        {data.recent.length === 0 ? (
          <div className="muted">No recent activity.</div>
        ) : (
          <div className="table-wrap">
            <table className="pr-table">
              <thead>
                <tr>
                  <th>Pull request</th>
                  <th>Repo</th>
                  <th>State</th>
                  <th>Pipeline</th>
                  <th>Review</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((pr) => (
                  <tr key={`${pr.repo}#${pr.id}`}>
                    <td className="pr-title-cell">
                      <Link className="title-link" to={`/pr/${encodeURIComponent(pr.repo)}/${pr.id}`}>{pr.title}</Link>
                      <div className="meta"><span>!{pr.id}</span><span>{pr.mine ? 'you' : pr.author}</span></div>
                    </td>
                    <td><span className="badge repo">{repoShort(pr.repo)}</span></td>
                    <td><StateBadge state={pr.state} /></td>
                    <td><PipelineBadge status={pr.pipeline} /></td>
                    <td><ReviewBadge status={pr.reviewStatus} review={pr.review} /></td>
                    <td className="muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}><TimeAgo date={pr.lastActivity} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {mergeTarget && (
        <MergeModal
          pr={mergeTarget}
          onClose={() => setMergeTarget(null)}
          onDone={() => { setMergeTarget(null); toast.success('Merge started'); refetch(true); }}
        />
      )}
    </div>
  );
}
