import { useState } from 'react';
import { Server, ChevronDown, ChevronRight, SquarePen, Check, X, Trash2 } from './icons.jsx';
import { AgentSessionCard } from './AgentSessionCard.jsx';

export function MachineGroup({ group, onEnd, onRename, onRemove }) {
  const { machineId, machineName, label, name, sessions } = group;
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(label || '');
  const [busy, setBusy] = useState(false);
  const activeCount = sessions.filter((s) => s.status === 'active').length;

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
            <button className="btn-icon machine-edit" onClick={startEdit} title="Rename machine">
              <SquarePen size={13} />
            </button>
            <button className="btn-icon machine-remove" onClick={removeMachine} title="Remove machine">
              <Trash2 size={13} />
            </button>
            <span className="machine-meta">
              {sessions.length} session{sessions.length !== 1 ? 's' : ''}
              {activeCount > 0 && <span className="active-badge">{activeCount} active</span>}
            </span>
          </>
        )}
      </div>
      {expanded && (
        <div className="machine-sessions">
          {sessions.map((session) => (
            <AgentSessionCard key={session.id} session={session} onEnd={onEnd} />
          ))}
        </div>
      )}
    </div>
  );
}
