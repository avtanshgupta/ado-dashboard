import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useConfig } from '../lib/AppContext.jsx';
import { useAsync } from '../lib/useAsync.js';
import { api } from '../lib/api.js';
import { Loading, ErrorBox, Empty, ReviewBadge, PipelineBadge, Avatar, TimeAgo, IdleTag, useToast, Modal } from '../components/ui.jsx';
import { MergeModal } from '../components/actions.jsx';
import { repoShort } from '../lib/format.js';
import {
  Zap, TriangleAlert, Eye, GitMerge, Clock, FilePenLine, Hourglass,
  PartyPopper, RefreshCw, MessageSquare, ChevronRight, Download, XCircle,
} from '../components/icons.jsx';

// Category presentation: order here is the display order (most urgent first).
const CATEGORY_META = {
  fix: { label: 'Needs fixing', Icon: TriangleAlert, color: 'var(--red)', hint: 'Changes requested, failing CI, or conflicts on your PRs' },
  review: { label: 'Awaiting your review', Icon: Eye, color: 'var(--blue, #0969da)', hint: "PRs where you're a reviewer and haven't voted" },
  merge: { label: 'Ready to merge', Icon: GitMerge, color: 'var(--green, #1f883d)', hint: 'Your PRs with every gate green' },
  stale: { label: 'Going stale', Icon: Clock, color: 'var(--yellow, #9a6700)', hint: 'Open PRs with no recent activity' },
  draft: { label: 'Drafts', Icon: FilePenLine, color: 'var(--purple, #8250df)', hint: 'Publish when ready for review' },
  waiting: { label: 'Waiting on others', Icon: Hourglass, color: 'var(--text-subtle)', hint: 'In review or CI running — no action needed yet' },
};
const ORDER = ['fix', 'review', 'merge', 'stale', 'draft', 'waiting'];

function ActionItem({ item, onMerge, onSnooze, onDismiss }) {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  return (
    <div className="ac-item card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', marginBottom: 8 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Link className="title-link" to={`/pr/${encodeURIComponent(item.repo)}/${item.id}`} style={{ fontWeight: 600 }}>
            {item.title}
          </Link>
          <span className="badge repo">{repoShort(item.repo)}</span>
          <span style={{ color: 'var(--text-subtle)', fontSize: 12 }}>!{item.id}</span>
          {item.followed && <span className="badge" style={{ color: 'var(--accent)' }} title="You're following this PR">★ following</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
          <span className="ac-reason" style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{item.reason}</span>
          <IdleTag days={item.idleDays} threshold={1} />
          {item.source === 'assigned' && item.author && (
            <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Avatar name={item.author} size={16} /> {item.author}
            </span>
          )}
          {item.reviewStatus && <ReviewBadge status={item.reviewStatus} review={{ approvals: item.approvals, required: item.required }} />}
          {item.pipeline && item.pipeline !== 'None' && <PipelineBadge status={item.pipeline} />}
          {item.activeComments > 0 && (
            <span className="badge count-pill has" title={`${item.activeComments} active comment(s)`}><MessageSquare size={11} /> {item.activeComments}</span>
          )}
        </div>
      </div>
      <div className="row-actions" style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
        {item.category === 'merge' && (
          <button className="btn sm primary" onClick={() => onMerge(item)} title="Merge this pull request"><GitMerge size={13} /> Merge</button>
        )}
        <Link className="btn sm" to={`/pr/${encodeURIComponent(item.repo)}/${item.id}`}>
          {item.category === 'review' ? 'Review' : item.category === 'fix' ? 'Fix' : 'Open'} <ChevronRight size={13} />
        </Link>
        <div style={{ position: 'relative' }}>
          <button className="btn sm ghost" title="Snooze" onClick={() => setSnoozeOpen((o) => !o)}><Clock size={13} /></button>
          {snoozeOpen && (
            <div className="dropdown-menu" style={{ right: 0, minWidth: 130 }}>
              {[['1 day', 24], ['3 days', 72], ['1 week', 168]].map(([label, h]) => (
                <button key={h} type="button" className="dd-item" onClick={() => { setSnoozeOpen(false); onSnooze(item, h); }}>{label}</button>
              ))}
            </div>
          )}
        </div>
        <button className="btn sm ghost" title="Dismiss (reappears if it changes)" onClick={() => onDismiss(item)}><XCircle size={13} /></button>
      </div>
    </div>
  );
}

function FollowingSection() {
  const { data, loading, refetch } = useAsync(() => api.follows(), []);
  const toast = useToast();
  if (loading) return null;
  const list = data || [];
  if (!list.length) return null;
  async function unfollow(pr) {
    try { await api.unfollow(pr.repo, pr.id); toast.success('Unfollowed'); refetch(); }
    catch (e) { toast.error(`Unfollow failed: ${e.message}`); }
  }
  return (
    <section className="page-section">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
        <h3 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={{ color: 'var(--accent)' }}>★</span> Following
          <span className="badge">{list.length}</span>
        </h3>
        <span className="muted" style={{ fontSize: 12 }}>PRs you're watching (even if not assigned)</span>
      </div>
      {list.map((pr) => (
        <div key={`${pr.repo}#${pr.id}`} className="ac-item card" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', marginBottom: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Link className="title-link" to={`/pr/${encodeURIComponent(pr.repo)}/${pr.id}`} style={{ fontWeight: 600 }}>{pr.title}</Link>
              <span className="badge repo">{repoShort(pr.repo)}</span>
              <span style={{ color: 'var(--text-subtle)', fontSize: 12 }}>!{pr.id}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' }}>
              <ReviewBadge status={pr.reviewStatus} review={pr.review} />
              {pr.pipeline?.overall && pr.pipeline.overall !== 'None' && <PipelineBadge status={pr.pipeline.overall} />}
              <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Avatar name={pr.createdBy?.displayName} size={16} /> {pr.createdBy?.displayName}</span>
              <TimeAgo date={pr.lastActivity} prefix="· " />
            </div>
          </div>
          <div className="row-actions" style={{ display: 'flex', gap: 6 }}>
            <Link className="btn sm" to={`/pr/${encodeURIComponent(pr.repo)}/${pr.id}`}>Open <ChevronRight size={13} /></Link>
            <button className="btn sm ghost" onClick={() => unfollow(pr)} title="Unfollow">Unfollow</button>
          </div>
        </div>
      ))}
    </section>
  );
}

/** D2 — Stand-up modal: fetch a summary, show Markdown, copy or download ICS. */
function StandupModal({ onClose }) {
  const toast = useToast();
  const { data, loading, error } = useAsync(() => api.standup(), []);
  return (
    <Modal title="Daily stand-up" onClose={onClose} footer={
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <a className="btn sm" href={api.standupIcsUrl()} download>Download reminder (.ics)</a>
        <button className="btn sm primary" disabled={!data} onClick={async () => {
          try { await navigator.clipboard.writeText(data.markdown); toast.success('Stand-up copied as Markdown'); }
          catch { toast.error('Copy failed — clipboard blocked'); }
        }}>Copy Markdown</button>
        <button className="btn sm" onClick={onClose}>Close</button>
      </div>
    }>
      {loading && <Loading label="Building your stand-up…" />}
      {error && <ErrorBox error={error} />}
      {data && (
        <textarea
          readOnly
          value={data.markdown}
          style={{ width: '100%', minHeight: 280, fontFamily: 'ui-monospace, monospace', fontSize: 12.5, padding: 10, border: '1px solid var(--border)', borderRadius: 6 }}
        />
      )}
    </Modal>
  );
}

export function ActionCenter() {
  useConfig();
  const toast = useToast();
  const { data, loading, error, refetch } = useAsync(() => api.actionCenter(), [], { pollMs: 90000 });
  const [mergeTarget, setMergeTarget] = useState(null);
  const [showStandup, setShowStandup] = useState(false);

  if (loading && !data) return <Loading label="Gathering what needs your attention…" />;
  if (error) return <ErrorBox error={error} onRetry={refetch} />;

  const { counts, groups } = data;
  const actionable = (counts.fix || 0) + (counts.review || 0) + (counts.merge || 0) + (counts.stale || 0);

  async function snoozeItem(item, hours) {
    try { await api.snooze(item.repo, item.id, hours); toast.success(`Snoozed for ${hours >= 168 ? '1 week' : hours >= 72 ? '3 days' : '1 day'}`); refetch(true); }
    catch (e) { toast.error(`Snooze failed: ${e.message}`); }
  }
  async function dismissItem(item) {
    try { await api.dismiss(item.repo, item.id, `${item.category}|${item.reason}`); toast.success('Dismissed — will reappear if it changes'); refetch(true); }
    catch (e) { toast.error(`Dismiss failed: ${e.message}`); }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h2 className="section-title" style={{ margin: 0 }}><Zap size={20} /> Action Center</h2>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>Everything that needs you, ranked by urgency across all your repositories.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn sm" onClick={() => setShowStandup(true)}><Download size={14} /> Stand-up</button>
          <button className="btn sm" onClick={() => refetch(true)}><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      {/* summary chips */}
      <div className="ac-summary no-print" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '12px 0 18px' }}>
        {ORDER.filter((c) => counts[c] > 0).map((c) => {
          const m = CATEGORY_META[c];
          return (
            <a key={c} href={`#ac-${c}`} className="card" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '8px 12px', textDecoration: 'none', color: 'inherit' }}>
              <m.Icon size={16} style={{ color: m.color }} />
              <strong>{counts[c]}</strong>
              <span className="muted" style={{ fontSize: 12.5 }}>{m.label}</span>
            </a>
          );
        })}
      </div>

      {actionable === 0 && (counts.total || 0) === 0 && (
        <Empty Icon={PartyPopper} label="You're all caught up — nothing needs your attention right now. 🎉" />
      )}

      {ORDER.map((cat) => {
        const list = groups[cat] || [];
        if (list.length === 0) return null;
        const m = CATEGORY_META[cat];
        return (
          <section key={cat} id={`ac-${cat}`} className="page-section" style={{ scrollMarginTop: 80 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
              <h3 style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <m.Icon size={17} style={{ color: m.color }} /> {m.label}
                <span className="badge" style={{ marginLeft: 2 }}>{list.length}</span>
              </h3>
              <span className="muted" style={{ fontSize: 12 }}>{m.hint}</span>
            </div>
            {list.map((item) => (
              <ActionItem key={`${item.repo}#${item.id}`} item={item} onMerge={setMergeTarget} onSnooze={snoozeItem} onDismiss={dismissItem} />
            ))}
          </section>
        );
      })}

      <FollowingSection />

      {data.generatedAt && (
        <div className="muted" style={{ fontSize: 12, marginTop: 16 }}>
          Updated <TimeAgo date={data.generatedAt} /> · items refresh automatically.
        </div>
      )}

      {mergeTarget && (
        <MergeModal
          pr={mergeTarget}
          onClose={() => setMergeTarget(null)}
          onDone={() => { setMergeTarget(null); toast.success('Merge started'); refetch(true); }}
        />
      )}
      {showStandup && <StandupModal onClose={() => setShowStandup(false)} />}
    </div>
  );
}
