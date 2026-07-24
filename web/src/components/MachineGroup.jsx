import { useState } from 'react';
import { Server, ChevronDown, ChevronRight, SquarePen, Check, X, Trash2, Hourglass, History } from './icons.jsx';
import { AgentSessionCard } from './AgentSessionCard.jsx';
import { api } from '../lib/api.js';
import { timeAgo } from '../lib/format.js';

const TL_STATUS_COLORS = { active: '#22c55e', idle: '#eab308', stale: '#ef4444', ended: '#6b7280', started: '#3b82f6' };

export function MachineGroup({ group, onEnd, onRename, onRemove, onOpenSession, prMatches }) {
  const { machineId, machineName, label, name, sessions, status, lastSeenAgo, longRunning } = group;
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label || '');
  const [busy, setBusy] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [timeline, setTimeline] = useState(null);
  const [tlLoading, setTlLoading] = useState(false);
  const activeCount = sessions.filter((s) => s.status === 'active').length;

  async function toggleTimeline(e) {
    e.stopPropagation();
    const next = !showTimeline;
    setShowTimeline(next);
    // Lazy-load once: the aggregated timeline is derived server-side from every
    // session's status history, so only fetch it when the user asks to see it.
    if (next && timeline === null && !tlLoading) {
      setTlLoading(true);
      try {
        const r = await api.agentMachineTimeline(machineId);
        setTimeline(r.value || []);
      } catch {
        setTimeline([]);
      } finally {
        setTlLoading(false);
      }
    }
  }

  function startEdit(e) {
    e.stopPropagation();
    setDraft(label || '');
    setEditing(true);
  }

  function cancelEdit() {
    setEditing(false);
    setDraft(label || '');
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await onRename(machineId, draft);
      setEditing(false);
    } catch {
      /* parent surfaces the error; keep the editor open to retry */
    } finally {
      setBusy(false);
    }
  }

  function removeMachine(e) {
    e.stopPropagation();
    const count = sessions.length;
    const ok = window.confirm(
      `Remove "${name || machineName || machineId}" and its ${count} session${count !== 1 ? 's' : ''} from the dashboard?\n\nIf it's still reporting, it will reappear on the next heartbeat.`
    );
    if (ok) onRemove(machineId);
  }

  return (
    <div className="machine-group">
      <div className="machine-header">
        <button className="machine-toggle" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
          <span className="chevron">
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </span>
          <span className={`status-dot ${status || 'ended'}`} title={status} />
          <Server size={16} />
          {!editing && <span className="machine-name">{name || machineName || machineId}</span>}
        </button>

        {editing ? (
          <form className="machine-rename" onSubmit={saveEdit}>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); }}
              placeholder={machineName || machineId}
              maxLength={80}
              disabled={busy}
            />
            <button type="submit" className="btn-icon" title="Save name" disabled={busy}><Check size={15} /></button>
            <button type="button" className="btn-icon" title="Cancel" onClick={cancelEdit} disabled={busy}><X size={15} /></button>
          </form>
        ) : (
          <>
            <button className="btn-icon machine-timeline-btn" onClick={toggleTimeline} title="Activity timeline" aria-expanded={showTimeline}>
              <History size={13} />
            </button>
            <button className="btn-icon machine-edit" onClick={startEdit} title="Rename machine">
              <SquarePen size={13} />
            </button>
            <button className="btn-icon machine-remove" onClick={removeMachine} title="Remove machine">
              <Trash2 size={13} />
            </button>
            <span className="machine-meta">
              {longRunning && <span className="badge-longrun" title="Has a long-running session"><Hourglass size={11} /></span>}
              {sessions.length} session{sessions.length !== 1 ? 's' : ''}
              {activeCount > 0 && <span className="active-badge">{activeCount} active</span>}
              {lastSeenAgo && <span className="machine-lastseen">· seen {lastSeenAgo} ago</span>}
            </span>
          </>
        )}
      </div>
      {expanded && (
        <div className="machine-sessions">
          {sessions.map((session) => {
            const prMatch =
              prMatches && session.repo && session.branch
                ? prMatches[`${session.repo.toLowerCase()}#${session.branch}`]
                : null;
            return (
              <AgentSessionCard
                key={session.id}
                session={session}
                onEnd={onEnd}
                onOpen={onOpenSession}
                prMatch={prMatch}
              />
            );
          })}
        </div>
      )}
      {showTimeline && (
        <div className="machine-timeline">
          {tlLoading && <div className="machine-timeline-empty muted">Loading activity…</div>}
          {!tlLoading && timeline && timeline.length === 0 && (
            <div className="machine-timeline-empty muted">No recorded activity yet.</div>
          )}
          {!tlLoading && timeline && timeline.length > 0 && (
            <ul className="machine-timeline-list">
              {timeline.map((e, i) => (
                <li key={`${e.t}-${i}`}>
                  <span className="status-dot" style={{ background: TL_STATUS_COLORS[e.status] || '#6b7280' }} />
                  <span className="tl-session mono">{e.sessionId}</span>
                  <span className="tl-status">{e.status}</span>
                  {e.repo && <span className="tl-repo muted">{e.repo}</span>}
                  <span className="tl-time muted">{timeAgo(e.t)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
