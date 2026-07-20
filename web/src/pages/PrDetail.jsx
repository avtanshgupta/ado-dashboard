import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useConfig } from '../lib/AppContext.jsx';
import { useAsync } from '../lib/useAsync.js';
import { api } from '../lib/api.js';
import { Loading, ErrorBox, StateBadge, ReviewBadge, PipelineBadge, PopBadge, PartialBadge, Avatar, Markdown, Modal, TimeAgo, useToast, RefreshingTag } from '../components/ui.jsx';
import { MergeModal, RequeueModal } from '../components/actions.jsx';
import { ReviewerManager } from '../components/ReviewerManager.jsx';
import { WorkItemManager } from '../components/WorkItemManager.jsx';
import { DiffView } from '../components/DiffView.jsx';
import { TemplateMenu } from '../components/TemplateMenu.jsx';
import { fmtDate, repoShort, isGateInFlight, canRerunGate } from '../lib/format.js';
import {
  ArrowLeft, GitMerge, RefreshCw, Zap, X, FilePenLine, Trash2, RotateCcw,
  ExternalLink, Lock, Tag, GitBranch, ChevronRight, MessageSquare, Download,
  Star, UserPlus, Eye,
} from '../components/icons.jsx';

const VOTES = [
  { v: 10, label: 'Approve', cls: 'primary' },
  { v: 5, label: 'Approve w/ suggestions', cls: '' },
  { v: -5, label: 'Wait for author', cls: '' },
  { v: -10, label: 'Reject', cls: 'danger' },
  { v: 0, label: 'Reset', cls: 'ghost' },
];
const buildBadge = (s) => ({ approved: 'Succeeded', rejected: 'Failed', running: 'Running', queued: 'Queued', expired: 'Expired' }[s] || 'None');

/** D3 — render a PR as shareable Markdown for chat/email. */
function prToMarkdown(pr) {
  const reviewers = (pr.review?.reviewers || []).map((r) => `${r.displayName} (${r.voteLabel})`).join(', ') || '—';
  const workItems = (pr.workItems || []).map((w) => `#${w.id} ${w.title}`).join(', ') || '—';
  const lines = [
    `## ${pr.title} (!${pr.id})`,
    '',
    `- **Repo:** ${pr.repo}`,
    `- **State:** ${pr.state} · **Review:** ${pr.reviewStatus} · **Pipeline:** ${pr.pipeline?.overall || 'None'}`,
    `- **Author:** ${pr.createdBy?.displayName || '—'}`,
    `- **Branch:** \`${pr.sourceBranch}\` → \`${pr.targetBranch}\``,
    `- **Reviewers:** ${reviewers}`,
    `- **Work items:** ${workItems}`,
    `- **Link:** ${pr.webUrl}`,
  ];
  if (pr.description) lines.push('', '### Description', '', pr.description);
  return lines.join('\n');
}

/** Add a new top-level comment (starts a discussion thread) on the PR. */
function NewCommentBox({ repo, id, onChanged }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      await api.addComment(repo, id, content);
      toast.success('Comment posted');
      setText('');
      onChanged?.(true);
    } catch (e) {
      toast.error(`Comment failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="comment-compose no-print" style={{ marginBottom: 12 }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a comment… (Markdown supported)"
        rows={2}
        style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, resize: 'vertical', fontSize: 13 }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6, gap: 8 }}>
        <TemplateMenu size="sm" onPick={(body) => setText((t) => (t.trim() ? `${t}\n\n${body}` : body))} />
        <button className="btn sm primary" disabled={busy || !text.trim()} onClick={submit}>
          {busy ? 'Posting…' : 'Comment'}
        </button>
      </div>
    </div>
  );
}

/** Per-thread reply box + resolve/reactivate controls. */
function ThreadActions({ repo, id, thread, onChanged }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function reply() {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    try {
      await api.replyToThread(repo, id, thread.id, content);
      toast.success('Reply posted');
      setText('');
      onChanged?.(true);
    } catch (e) {
      toast.error(`Reply failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status, label) {
    setBusy(true);
    try {
      await api.setThreadStatus(repo, id, thread.id, status);
      toast.success(label);
      onChanged?.(true);
    } catch (e) {
      toast.error(`Update failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="thread-actions no-print" style={{ marginTop: 8 }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Reply… (Markdown supported)"
        rows={2}
        style={{ width: '100%', padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 6, resize: 'vertical', fontSize: 13 }}
      />
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
        {thread.isActive ? (
          <button className="btn sm" disabled={busy} onClick={() => setStatus('fixed', 'Thread resolved')}>Resolve</button>
        ) : thread.isResolved ? (
          <button className="btn sm" disabled={busy} onClick={() => setStatus('active', 'Thread reactivated')}>Reactivate</button>
        ) : null}
        <button className="btn sm primary" disabled={busy || !text.trim()} onClick={reply}>
          {busy ? 'Posting…' : 'Reply'}
        </button>
      </div>
    </div>
  );
}


export function PrDetail() {
  const { repo, id } = useParams();
  const navigate = useNavigate();
  const config = useConfig();
  const toast = useToast();
  const { data: pr, loading, error, refetch, revalidating } = useAsync(() => api.detail(repo, id), [repo, id], { cacheKey: `pr:detail:${repo}:${id}` });
  const [merge, setMerge] = useState(false);
  const [requeue, setRequeue] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [settingAC, setSettingAC] = useState(false);
  const [threadFilter, setThreadFilter] = useState('open');
  const [leftTab, setLeftTab] = useState('conversation'); // conversation | files (A1)
  const [expanded, setExpanded] = useState(() => new Set());
  const [busyLifecycle, setBusyLifecycle] = useState(false);
  const [confirmAbandon, setConfirmAbandon] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);

  // Sync follow state from the loaded PR.
  useEffect(() => { if (pr) setFollowing(!!pr.isFollowed); }, [pr]);

  if (loading && !pr) return <Loading label="Loading pull request…" />;
  if (error) return <ErrorBox error={error} onRetry={refetch} />;

  // PoP, re-trigger gates, and merge are author-only actions.
  const isMine = pr.createdBy?.id === config.me.id;
  const iAmReviewer = (pr.review?.reviewers || []).some((r) => r.id === config.me.id);

  async function toggleFollow() {
    setFollowBusy(true);
    try {
      if (following) { await api.unfollow(repo, id); setFollowing(false); toast.success('Unfollowed'); }
      else { await api.follow(repo, id); setFollowing(true); toast.success('Following — see the Action Center'); }
    } catch (e) {
      toast.error(`Follow failed: ${e.message}`);
    } finally {
      setFollowBusy(false);
    }
  }

  async function toggleSelfReviewer() {
    setFollowBusy(true);
    try {
      if (iAmReviewer) { await api.removeReviewer(repo, id, config.me.id); toast.success('Removed yourself as reviewer'); }
      else { await api.addReviewer(repo, id, config.me.id, false); toast.success('Added yourself as a reviewer'); }
      refetch(true);
    } catch (e) {
      toast.error(`Reviewer update failed: ${e.message}`);
    } finally {
      setFollowBusy(false);
    }
  }

  async function vote(v) {
    try {
      await api.vote(repo, id, v);
      toast.success('Vote updated');
      refetch(true);
    } catch (e) {
      toast.error(`Vote failed: ${e.message}`);
    }
  }

  async function publish() {
    setPublishing(true);
    try {
      await api.publish(repo, id);
      toast.success('Pull request published');
      refetch(true);
    } catch (e) {
      toast.error(`Publish failed: ${e.message}`);
    } finally {
      setPublishing(false);
    }
  }

  async function toggleAutoComplete(enable) {
    setSettingAC(true);
    try {
      await api.setAutoComplete(repo, id, enable);
      toast.success(enable ? 'Auto-complete enabled (squash · delete branch)' : 'Auto-complete cancelled');
      refetch(true);
    } catch (e) {
      toast.error(`Auto-complete ${enable ? 'set' : 'cancel'} failed: ${e.message}`);
    } finally {
      setSettingAC(false);
    }
  }

  async function doAbandon() {
    setBusyLifecycle(true);
    try {
      await api.abandon(repo, id);
      toast.success('Pull request abandoned');
      setConfirmAbandon(false);
      refetch(true);
    } catch (e) {
      toast.error(`Abandon failed: ${e.message}`);
    } finally {
      setBusyLifecycle(false);
    }
  }

  async function doReactivate() {
    setBusyLifecycle(true);
    try {
      await api.reactivate(repo, id);
      toast.success('Pull request reactivated');
      refetch(true);
    } catch (e) {
      toast.error(`Reactivate failed: ${e.message}`);
    } finally {
      setBusyLifecycle(false);
    }
  }

  async function convertToDraft() {
    setBusyLifecycle(true);
    try {
      await api.setDraft(repo, id, true);
      toast.success('Converted to draft');
      refetch(true);
    } catch (e) {
      toast.error(`Convert to draft failed: ${e.message}`);
    } finally {
      setBusyLifecycle(false);
    }
  }

  function toggle(tid) {
    setExpanded((s) => {
      const n = new Set(s);
      n.has(tid) ? n.delete(tid) : n.add(tid);
      return n;
    });
  }

  const allThreads = (pr.threads || []).filter((t) => t.commentCount > 0);
  const visibleThreads = allThreads.filter((t) =>
    threadFilter === 'open' ? t.isActive : threadFilter === 'resolved' ? t.isResolved : true
  );
  const blockers = pr.merge?.blockers || [];
  const blockerText = blockers.map((b) => `${b.name || b.type} (${b.status})`).join('\n');

  return (
    <div>
      {isMine && pr.state === 'Draft' && (
        <div className="publish-banner no-print">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <FilePenLine size={16} /> This pull request is a <strong>draft</strong> — reviewers aren't notified and it
            can't be merged until you publish it.
          </span>
          <button className="btn primary" disabled={publishing} onClick={publish}>
            {publishing ? 'Publishing…' : 'Publish pull request'}
          </button>
        </div>
      )}

      <button onClick={() => navigate(-1)} className="btn sm no-print" style={{ marginBottom: 14 }}><ArrowLeft size={14} /> Back</button>

      <div className="detail-header">
        <div style={{ flex: 1 }}>
          <h1>{pr.title} <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>!{pr.id}</span> <RefreshingTag show={revalidating} /></h1>
          <div className="detail-sub">
            <StateBadge state={pr.state} />
            <span className="badge repo">{repoShort(pr.repo)}</span>
            <ReviewBadge status={pr.reviewStatus} review={pr.review} />
            <PipelineBadge status={pr.pipeline?.overall} />
            {isMine && pr.pop && <PopBadge pop={pr.pop} />}
            <span><Avatar name={pr.createdBy?.displayName} imageUrl={pr.createdBy?.imageUrl} size={18} /> {pr.createdBy?.displayName}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><GitBranch size={14} /> {pr.sourceBranch} → {pr.targetBranch}</span>
            {pr.labels?.length > 0 && pr.labels.map((l) => (
              <span key={l} className="badge pr-label"><Tag size={12} /> {l}</span>
            ))}
            {pr.partial?.length > 0 && <PartialBadge parts={pr.partial} />}
          </div>
        </div>
        <div className="row-actions no-print" style={{ flexWrap: 'wrap' }}>
          {isMine && (pr.canMerge ? (
            <button className="btn primary" onClick={() => setMerge(true)}><GitMerge size={14} /> Merge</button>
          ) : pr.state === 'Open' ? (
            <button className="btn" disabled title={`Blocked by:\n${blockerText}`}><Lock size={14} /> Merge blocked</button>
          ) : null)}
          {isMine && (pr.pipeline?.builds?.length || 0) > 0 && (
            <button
              className="btn accent"
              disabled={!canRerunGate(pr)}
              onClick={() => setRequeue(true)}
              title={canRerunGate(pr) ? undefined : 'Gates are already running — nothing to re-trigger'}
            >
              <RefreshCw size={14} /> Re-run gate
            </button>
          )}
          {isMine && pr.state === 'Open' && (
            pr.autoComplete?.isSet ? (
              <button
                className="btn"
                disabled={settingAC}
                onClick={() => toggleAutoComplete(false)}
                title="Auto-complete is enabled — click to cancel"
              >
                {settingAC ? 'Cancelling…' : <><X size={14} /> Cancel auto-complete</>}
              </button>
            ) : (
              <button
                className="btn accent"
                disabled={settingAC}
                onClick={() => toggleAutoComplete(true)}
                title="Auto-complete: squash merge, delete source branch, no additional required checks"
              >
                {settingAC ? 'Setting…' : <><Zap size={14} /> Set auto-complete</>}
              </button>
            )
          )}
          {isMine && pr.state === 'Open' && (
            <button className="btn" disabled={busyLifecycle} onClick={convertToDraft} title="Convert this PR back to a draft">
              <FilePenLine size={14} /> Convert to draft
            </button>
          )}
          {isMine && (pr.state === 'Open' || pr.state === 'Draft') && (
            <button className="btn danger" disabled={busyLifecycle} onClick={() => setConfirmAbandon(true)} title="Abandon (close without merging)">
              <Trash2 size={14} /> Abandon
            </button>
          )}
          {isMine && pr.state === 'Closed' && (
            <button className="btn accent" disabled={busyLifecycle} onClick={doReactivate} title="Reactivate this abandoned PR">
              <RotateCcw size={14} /> Reactivate
            </button>
          )}
          <a className="btn" href={pr.webUrl} target="_blank" rel="noreferrer">Open in ADO <ExternalLink size={13} /></a>
          <button
            className="btn"
            title="Copy a Markdown summary of this PR for chat/email"
            onClick={async () => {
              const md = prToMarkdown(pr);
              try {
                await navigator.clipboard.writeText(md);
                toast.success('PR summary copied as Markdown');
              } catch {
                toast.error('Copy failed — your browser blocked clipboard access');
              }
            }}
          >
            <Download size={13} /> Copy as Markdown
          </button>
          <button className={`btn ${following ? 'accent' : ''}`} disabled={followBusy} onClick={toggleFollow} title={following ? 'Stop following this PR' : 'Follow this PR (shows in your Action Center)'}>
            <Star size={13} /> {following ? 'Following' : 'Follow'}
          </button>
          {!isMine && (
            <button className="btn" disabled={followBusy} onClick={toggleSelfReviewer} title={iAmReviewer ? 'Remove yourself as a reviewer' : 'Add yourself as a reviewer'}>
              {iAmReviewer ? <><Eye size={13} /> Leave review</> : <><UserPlus size={13} /> Review this</>}
            </button>
          )}
        </div>
      </div>

      <div className="detail-grid">
        <div>
          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <h3>Description</h3>
            <div className="desc-box">
              {pr.description ? <Markdown text={pr.description} /> : <span className="muted">No description provided.</span>}
            </div>
          </div>

          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <h3>
              {pr.pipeline?.mandatoryOnly ? 'Gating pipelines' : 'Pipelines'} ({pr.pipeline?.builds?.length || 0})
            </h3>
            {(pr.pipeline?.builds || []).length === 0 && <div className="muted">No build pipelines on this PR.</div>}
            {(pr.pipeline?.builds || []).map((b) => (
              <div key={b.evaluationId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border-muted)' }}>
                <PipelineBadge status={buildBadge(b.effectiveStatus || b.status)} />
                <span style={{ flex: 1 }}>
                  {b.name}
                  {b.isBlocking && <span title="Required / mandatory" style={{ color: 'var(--red)', marginLeft: 4 }}>*</span>}
                  {b.isExpired && <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>(stale — needs re-run)</span>}
                </span>
                {isMine && (
                  <button className="btn sm" disabled={isGateInFlight(b)} title={isGateInFlight(b) ? 'Already running — can’t re-trigger until it completes' : undefined} onClick={async () => {
                    try { await api.requeue(repo, id, b.evaluationId); toast.success(`Re-queued ${b.name}`); setTimeout(() => refetch(true), 1500); }
                    catch (e) { toast.error(`Re-run failed: ${e.message}`); }
                  }}><RefreshCw size={13} /> Re-run</button>
                )}
              </div>
            ))}
            {pr.pipeline?.mandatoryOnly && (
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                Showing the gating pipelines (e.g. CI Gate, PR Gate) that block this PR. <span style={{ color: 'var(--red)' }}>*</span> = mandatory.
              </div>
            )}
          </div>

          <div className="detail-tabs no-print" style={{ marginBottom: 16 }}>
            <button className={`detail-tab ${leftTab === 'conversation' ? 'active' : ''}`} onClick={() => setLeftTab('conversation')}>
              <MessageSquare size={14} /> Conversation
            </button>
            <button className={`detail-tab ${leftTab === 'files' ? 'active' : ''}`} onClick={() => setLeftTab('files')}>
              <FilePenLine size={14} /> Files changed
            </button>
          </div>

          {leftTab === 'files' && (
            <div className="card card-pad" style={{ marginBottom: 16 }}>
              <DiffView repo={repo} id={id} threads={pr.threads || []} onPosted={() => refetch(true)} />
            </div>
          )}

          <div className="card card-pad" style={{ marginBottom: 16, display: leftTab === 'conversation' ? 'block' : 'none' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Comments & discussions</h3>
              <select value={threadFilter} onChange={(e) => setThreadFilter(e.target.value)}
                style={{ padding: '5px 9px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}>
                <option value="open">Open ({allThreads.filter((t) => t.isActive).length})</option>
                <option value="resolved">Resolved ({allThreads.filter((t) => t.isResolved).length})</option>
                <option value="all">All ({allThreads.length})</option>
              </select>
            </div>
            {pr.comments?.participants?.length > 0 && (
              <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>Participants: {pr.comments.participants.join(', ')}</div>
            )}
            <NewCommentBox repo={repo} id={id} onChanged={refetch} />
            {visibleThreads.length === 0 && <div className="muted">No {threadFilter === 'all' ? '' : threadFilter} discussions.</div>}
            {visibleThreads.map((t) => {
              const isOpen = expanded.has(t.id);
              return (
                <div
                  key={t.id}
                  className={`thread clickable ${t.isActive ? 'active' : t.isResolved ? 'resolved' : ''}`}
                  onClick={() => toggle(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggle(t.id);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-expanded={isOpen}
                >
                  <div className="thread-head">
                    <span className={`chev ${isOpen ? 'open' : ''}`}><ChevronRight size={13} /></span>
                    <span className={`badge ${t.isActive ? 'count-pill has' : 'pipe-Succeeded'}`}>{t.status || 'comment'}</span>
                    <span>{t.participants.join(', ')}</span>
                    {t.context?.filePath && <span className="ctx">{t.context.filePath}{t.context.line ? `:${t.context.line}` : ''}</span>}
                    <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5 }}><MessageSquare size={13} /> {t.commentCount} · <TimeAgo date={t.lastUpdated} /></span>
                  </div>
                  {isOpen && (
                    <div className="thread-body" onClick={(e) => e.stopPropagation()}>
                      {t.comments.map((c, i) => (
                        <div className="comment" key={i}>
                          <span className="c-author">{c.author}</span>
                          <span className="c-time">{fmtDate(c.date)}</span>
                          <div className="c-body"><Markdown text={c.content} /></div>
                        </div>
                      ))}
                      <ThreadActions repo={repo} id={id} thread={t} onChanged={refetch} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="card card-pad">
            <h3>Timeline ({pr.timeline?.length || 0} events)</h3>
            <div className="timeline">
              {(pr.timeline || []).map((e, i) => (
                <div key={i} className={`tl-item ${e.type}`}>
                  <span className="tl-dot" />
                  <div className="tl-head"><span className="tl-actor">{e.actor || 'System'}</span> <span className="tl-time">· {fmtDate(e.date)}</span></div>
                  <div className="tl-text">{e.text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <h3>Details</h3>
            <div className="kv"><span className="k">State</span><span className="v"><StateBadge state={pr.state} /></span></div>
            <div className="kv"><span className="k">Review</span><span className="v"><ReviewBadge status={pr.reviewStatus} review={pr.review} /></span></div>
            <div className="kv"><span className="k">Approvals</span><span className="v">{pr.review?.approvals ?? 0} of {pr.review?.required ?? '—'} required</span></div>
            <div className="kv"><span className="k">Pipeline</span><span className="v"><PipelineBadge status={pr.pipeline?.overall} /></span></div>
            {isMine && pr.pop && <div className="kv"><span className="k">Proof of Presence</span><span className="v"><PopBadge pop={pr.pop} /></span></div>}
            {isMine && <div className="kv"><span className="k">Mergeable</span><span className="v">{pr.canMerge ? <span className="badge pipe-Succeeded">Yes</span> : <span className="badge pipe-Failed">No</span>}</span></div>}
            {pr.state === 'Open' && (
              <div className="kv"><span className="k">Auto-complete</span><span className="v">{pr.autoComplete?.isSet ? <span className="badge pipe-Succeeded" title={pr.autoComplete.setBy ? `Set by ${pr.autoComplete.setBy}` : undefined}><Zap size={12} /> On</span> : <span className="badge review-Pending">Off</span>}</span></div>
            )}
            <div className="kv"><span className="k">Commits</span><span className="v">{pr.commitCount ?? '—'}</span></div>
            <div className="kv"><span className="k">Files changed</span><span className="v">{pr.fileCount ?? '—'}</span></div>
            <div className="kv"><span className="k">Active comments</span><span className="v">{pr.comments?.active ?? 0}</span></div>
            <div className="kv"><span className="k">Resolved</span><span className="v">{pr.comments?.resolved ?? 0}</span></div>
            <div className="kv"><span className="k">Created</span><span className="v"><TimeAgo date={pr.creationDate} /></span></div>
            <div className="kv"><span className="k">Last activity</span><span className="v"><TimeAgo date={pr.lastActivity} /></span></div>
          </div>

          {isMine && !pr.canMerge && pr.state === 'Open' && blockers.length > 0 && (
            <div className="card card-pad" style={{ marginBottom: 16 }}>
              <h3><Lock size={16} /> Merge blocked by</h3>
              {blockers.map((b, i) => (
                <div className="kv" key={i}>
                  <span className="k">{b.name || b.type}</span>
                  <span className="v"><span className={`badge ${b.status === 'rejected' ? 'pipe-Failed' : b.status === 'expired' ? 'pipe-Expired' : 'pipe-Queued'}`}>{b.status}</span></span>
                </div>
              ))}
            </div>
          )}

          <ReviewerManager pr={pr} canManage={isMine && pr.state !== 'Merged'} onChanged={refetch} />

          <WorkItemManager pr={pr} canManage={isMine && pr.state !== 'Merged'} onChanged={refetch} />

          {!isMine && (
            <div className="card card-pad no-print">
              <h3>Cast your vote</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {VOTES.map((v) => <button key={v.v} className={`btn ${v.cls}`} onClick={() => vote(v.v)}>{v.label}</button>)}
              </div>
            </div>
          )}
        </div>
      </div>

      {merge && <MergeModal pr={pr} onClose={() => setMerge(false)} onDone={refetch} />}
      {requeue && <RequeueModal pr={pr} onClose={() => setRequeue(false)} onDone={refetch} />}
      {confirmAbandon && (
        <Modal
          title={`Abandon pull request !${pr.id}?`}
          onClose={() => setConfirmAbandon(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmAbandon(false)} disabled={busyLifecycle}>Cancel</button>
              <button className="btn danger" onClick={doAbandon} disabled={busyLifecycle}>
                {busyLifecycle ? 'Abandoning…' : 'Abandon PR'}
              </button>
            </>
          }
        >
          <div>
            This closes <strong>{pr.title}</strong> without merging. You can reactivate it later from this page. Continue?
          </div>
        </Modal>
      )}
    </div>
  );
}
