import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAsync } from '../lib/useAsync.js';
import { api } from '../lib/api.js';
import { Loading, ErrorBox, Avatar, SafeHtml, TimeAgo, useToast, RefreshingTag } from '../components/ui.jsx';
import { WiTypeBadge, WiStateBadge, PriorityBadge, SeverityBadge, categoryColor } from '../components/workItemUi.jsx';
import { shortPath } from '../lib/format.js';
import { ArrowLeft, ExternalLink, SquarePen, Check, X, Plus, Tag, Link2, GitPullRequest, Layers, MessageSquare, History } from '../components/icons.jsx';

/** Identity typeahead → picks a user (or clears to unassign). */
function AssigneePicker({ current, onPick, busy }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const timer = useRef(null);
  useEffect(() => {
    function onClick(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);
  useEffect(() => {
    if (!q || q.trim().length < 2) { setResults([]); return undefined; }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { setResults(await api.searchIdentities(q.trim())); setOpen(true); } catch { setResults([]); }
    }, 300);
    return () => clearTimeout(timer.current);
  }, [q]);
  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        {current ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Avatar name={current.displayName} imageUrl={current.imageUrl} size={20} /> {current.displayName}
          </span>
        ) : <span className="muted">Unassigned</span>}
        {current && <button className="btn xs ghost" disabled={busy} title="Unassign" onClick={() => onPick(null)}><X size={12} /></button>}
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        placeholder="Reassign — type a name or email…"
        style={{ width: '100%', padding: '6px 9px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}
      />
      {open && results.length > 0 && (
        <div className="dropdown-menu" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 30, maxHeight: 240, overflowY: 'auto' }}>
          {results.filter((r) => !r.isGroup).map((idn) => (
            <button key={idn.id} className="dd-item" style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer' }}
              disabled={busy} onClick={() => { onPick(idn.mail || idn.uniqueName || idn.displayName); setQ(''); setOpen(false); }}>
              <Avatar name={idn.displayName} size={18} />
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{idn.displayName}{idn.mail && <span className="muted" style={{ fontSize: 11 }}> · {idn.mail}</span>}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TagEditor({ tags, onChange, busy }) {
  const [draft, setDraft] = useState('');
  const add = () => { const t = draft.trim(); if (t && !tags.includes(t)) { onChange([...tags, t]); setDraft(''); } };
  return (
    <div>
      <div className="label-row" style={{ marginBottom: 6 }}>
        {tags.length === 0 && <span className="muted" style={{ fontSize: 12 }}>No tags</span>}
        {tags.map((t) => (
          <span key={t} className="badge pr-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Tag size={10} /> {t}
            <button className="btn xs ghost" disabled={busy} title="Remove tag" onClick={() => onChange(tags.filter((x) => x !== t))} style={{ padding: 0, marginLeft: 2 }}><X size={10} /></button>
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} placeholder="Add tag…" style={{ flex: 1, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
        <button className="btn sm" disabled={busy || !draft.trim()} onClick={add}><Plus size={12} /></button>
      </div>
    </div>
  );
}

function Discussion({ id, comments, onChanged }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  async function post() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try { await api.wiAddComment(id, body); toast.success('Comment added'); setText(''); onChanged?.(); }
    catch (e) { toast.error(`Comment failed: ${e.message}`); }
    finally { setBusy(false); }
  }
  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <h3 className="section-title" style={{ fontSize: 15 }}><MessageSquare size={16} /> Discussion ({comments.length})</h3>
      {comments.length === 0 && <div className="muted" style={{ fontSize: 13 }}>No comments yet.</div>}
      {comments.map((c) => (
        <div key={c.id} style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Avatar name={c.createdBy?.displayName} imageUrl={c.createdBy?.imageUrl} size={18} />
            <strong style={{ fontSize: 13 }}>{c.createdBy?.displayName}</strong>
            <TimeAgo date={c.createdDate} className="muted" />
          </div>
          <SafeHtml html={c.text} />
        </div>
      ))}
      <div style={{ marginTop: 10 }}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Add a comment…" rows={3} style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, resize: 'vertical' }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
          <button className="btn sm primary" disabled={busy || !text.trim()} onClick={post}><MessageSquare size={13} /> Comment</button>
        </div>
      </div>
    </div>
  );
}

function RelationList({ label, ids, Icon, onUnlink, busy }) {
  if (!ids || ids.length === 0) return null;
  return (
    <div className="kv">
      <span className="k" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon size={14} /> {label}</span>
      <span className="v" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {ids.map((wid) => (
          <span key={wid} className="badge repo" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Link to={`/work-item/${wid}`} style={{ color: 'inherit', textDecoration: 'none' }}>#{wid}</Link>
            {onUnlink && <button className="btn xs ghost" style={{ padding: 0 }} disabled={busy} title="Unlink" onClick={() => onUnlink(wid)}><X size={10} /></button>}
          </span>
        ))}
      </span>
    </div>
  );
}

export function WorkItemDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { data: wi, loading, error, refetch, revalidating } = useAsync(() => api.wiDetail(id), [id], { cacheKey: `wi:detail:${id}` });
  const [busy, setBusy] = useState(false);
  const [editTitle, setEditTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [linkDraft, setLinkDraft] = useState('');

  async function update(fields, msg) {
    setBusy(true);
    try {
      await api.wiUpdate(id, fields, wi?.rev);
      if (msg) toast.success(msg);
      await refetch();
    } catch (e) {
      toast.error(`Update failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function linkItem() {
    const target = linkDraft.trim().replace(/^#/, '');
    if (!/^\d+$/.test(target)) { toast.error('Enter a numeric work item id'); return; }
    setBusy(true);
    try { await api.wiAddLink(id, Number(target), 'System.LinkTypes.Related'); toast.success(`Linked #${target}`); setLinkDraft(''); await refetch(); }
    catch (e) { toast.error(`Link failed: ${e.message}`); }
    finally { setBusy(false); }
  }

  async function unlink(targetId) {
    setBusy(true);
    try { await api.wiRemoveLink(id, { targetId }); toast.success(`Unlinked #${targetId}`); await refetch(); }
    catch (e) { toast.error(`Remove failed: ${e.message}`); }
    finally { setBusy(false); }
  }

  if (loading) return <Loading label="Loading work item…" />;
  if (error) return <ErrorBox error={error} onRetry={refetch} />;
  if (!wi) return null;

  const rel = wi.relations || {};
  const accent = categoryColor(wi.state);

  return (
    <div>
      <Link to="/work-items/assigned" className="btn sm ghost no-print" style={{ marginBottom: 12 }}><ArrowLeft size={14} /> Work items</Link>

      <div className="card card-pad" style={{ marginBottom: 16, borderTop: `3px solid ${accent}` }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
          <WiTypeBadge type={wi.type} />
          <span className="muted">#{wi.id}</span>
          {wi.project && <span className="badge repo">{wi.project}</span>}
          <div style={{ flex: 1 }} />
          <RefreshingTag show={revalidating} />
          {wi.url && <a className="btn sm ghost" href={wi.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open in ADO</a>}
        </div>
        {editTitle ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} style={{ flex: 1, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 18, fontWeight: 600 }} />
            <button className="btn sm primary" disabled={busy || !titleDraft.trim()} onClick={async () => { await update({ 'System.Title': titleDraft.trim() }, 'Title updated'); setEditTitle(false); }}><Check size={14} /></button>
            <button className="btn sm" onClick={() => setEditTitle(false)}><X size={14} /></button>
          </div>
        ) : (
          <h1 style={{ fontSize: 22, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            {wi.title}
            <button className="btn xs ghost no-print" title="Edit title" onClick={() => { setTitleDraft(wi.title); setEditTitle(true); }}><SquarePen size={14} /></button>
          </h1>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
          <WiStateBadge state={wi.state} />
          {(wi.allowedStates || []).length > 0 && (
            <select value={wi.state} disabled={busy} onChange={(e) => update({ 'System.State': e.target.value }, `State → ${e.target.value}`)} style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}>
              {(wi.allowedStates || []).map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
          )}
          <PriorityBadge priority={wi.priority} />
          <SeverityBadge severity={wi.severity} />
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>
        <div>
          {wi.description && (
            <div className="card card-pad" style={{ marginBottom: 16 }}>
              <h3>Description</h3>
              <SafeHtml html={wi.description} />
            </div>
          )}
          {wi.reproSteps && (
            <div className="card card-pad" style={{ marginBottom: 16 }}>
              <h3>Repro steps</h3>
              <SafeHtml html={wi.reproSteps} />
            </div>
          )}
          {wi.acceptanceCriteria && (
            <div className="card card-pad" style={{ marginBottom: 16 }}>
              <h3>Acceptance criteria</h3>
              <SafeHtml html={wi.acceptanceCriteria} />
            </div>
          )}
          {wi.systemInfo && (
            <div className="card card-pad" style={{ marginBottom: 16 }}>
              <h3>System info</h3>
              <SafeHtml html={wi.systemInfo} />
            </div>
          )}

          <Discussion id={id} comments={wi.comments || []} onChanged={refetch} />

          {(wi.history || []).length > 0 && (
            <div className="card card-pad" style={{ marginBottom: 16 }}>
              <h3 className="section-title" style={{ fontSize: 15 }}><History size={16} /> History ({wi.history.length})</h3>
              {wi.history.slice(0, 30).map((h) => (
                <div key={h.rev} style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    {h.by && <Avatar name={h.by.displayName} imageUrl={h.by.imageUrl} size={16} />}
                    <strong style={{ fontSize: 13 }}>{h.by?.displayName || 'Someone'}</strong>
                    <TimeAgo date={h.date} className="muted" />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {h.changes.map((c, i) => (
                      <span key={i} className="badge repo" style={{ fontSize: 11.5 }}>
                        {c.field}: {c.from ? <span className="muted">{c.from}</span> : '∅'} → <strong>{c.to || '∅'}</strong>
                      </span>
                    ))}
                    {h.commentAdded && <span className="badge pipe-Queued" style={{ fontSize: 11.5 }}><MessageSquare size={10} /> comment</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <h3 className="section-title" style={{ fontSize: 15 }}><Link2 size={16} /> Links &amp; relations</h3>
            {rel.parent && <RelationList label="Parent" ids={[rel.parent]} Icon={Layers} onUnlink={unlink} busy={busy} />}
            <RelationList label="Children" ids={rel.children} Icon={Layers} onUnlink={unlink} busy={busy} />
            <RelationList label="Related" ids={rel.related} Icon={Link2} onUnlink={unlink} busy={busy} />
            <RelationList label="Predecessors" ids={rel.predecessors} Icon={Link2} onUnlink={unlink} busy={busy} />
            <RelationList label="Successors" ids={rel.successors} Icon={Link2} onUnlink={unlink} busy={busy} />
            {(rel.pullRequests || []).length > 0 && (
              <div className="kv">
                <span className="k" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><GitPullRequest size={14} /> Pull requests</span>
                <span className="v" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {rel.pullRequests.map((pr) => (
                    <a key={pr.prId} className="badge repo" href={pr.url} target="_blank" rel="noreferrer">PR #{pr.prId}</a>
                  ))}
                </span>
              </div>
            )}
            {(rel.hyperlinks || []).length > 0 && rel.hyperlinks.map((h, i) => (
              <div className="kv" key={i}><span className="k">Hyperlink</span><span className="v"><a href={h.url} target="_blank" rel="noreferrer">{h.comment || h.url}</a></span></div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }} className="no-print">
              <input value={linkDraft} onChange={(e) => setLinkDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') linkItem(); }} placeholder="Link a work item by id…" style={{ flex: 1, padding: '6px 9px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
              <button className="btn sm accent" disabled={busy || !linkDraft.trim()} onClick={linkItem}><Plus size={13} /> Link</button>
            </div>
          </div>
        </div>

        <aside>
          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <h3>Details</h3>
            <div style={{ marginBottom: 12 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Assigned to</div>
              <AssigneePicker current={wi.assignedTo} busy={busy} onPick={(who) => update({ 'System.AssignedTo': who }, who ? 'Reassigned' : 'Unassigned')} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Priority</div>
              <select value={wi.priority ?? ''} disabled={busy} onChange={(e) => update({ 'Microsoft.VSTS.Common.Priority': e.target.value ? Number(e.target.value) : null }, 'Priority updated')} style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}>
                <option value="">—</option>
                {[1, 2, 3, 4].map((p) => <option key={p} value={p}>P{p}</option>)}
              </select>
            </div>
            {(wi.storyPoints != null || wi.type === 'User Story' || wi.type === 'Product Backlog Item') && (
              <div style={{ marginBottom: 12 }}>
                <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>Story points</div>
                <input type="number" defaultValue={wi.storyPoints ?? ''} disabled={busy} onBlur={(e) => { const v = e.target.value === '' ? null : Number(e.target.value); if (v !== (wi.storyPoints ?? null)) update({ 'Microsoft.VSTS.Scheduling.StoryPoints': v }, 'Story points updated'); }} style={{ width: 90, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
              </div>
            )}
            <div className="kv"><span className="k">Area</span><span className="v" title={wi.areaPath}>{shortPath(wi.areaPath) || '—'}</span></div>
            <div className="kv"><span className="k">Iteration</span><span className="v" title={wi.iterationPath}>{shortPath(wi.iterationPath) || '—'}</span></div>
            <div className="kv"><span className="k">Reason</span><span className="v">{wi.reason || '—'}</span></div>
            <div className="kv"><span className="k">Created</span><span className="v">{wi.createdBy?.displayName} · <TimeAgo date={wi.createdDate} /></span></div>
            <div className="kv"><span className="k">Changed</span><span className="v">{wi.changedBy?.displayName} · <TimeAgo date={wi.changedDate} /></span></div>
          </div>

          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <h3 style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Tag size={15} /> Tags</h3>
            <TagEditor tags={wi.tags || []} busy={busy} onChange={(next) => update({ 'System.Tags': next.join('; ') }, 'Tags updated')} />
          </div>
        </aside>
      </div>
    </div>
  );
}
