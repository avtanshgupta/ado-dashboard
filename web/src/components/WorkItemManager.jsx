import { useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from './ui.jsx';
import { Plus, X } from './icons.jsx';

/**
 * Work item linking (F3): list linked work items with unlink, and link a new one
 * by its numeric id. Linking is gated to the PR author (canManage).
 */
export function WorkItemManager({ pr, canManage, onChanged }) {
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const items = pr.workItems || [];

  async function link() {
    const id = draft.trim().replace(/^#/, '');
    if (!/^\d+$/.test(id)) { toast.error('Enter a numeric work item id'); return; }
    setBusy(true);
    try {
      await api.linkWorkItem(pr.repo, pr.id, Number(id));
      toast.success(`Linked work item #${id}`);
      setDraft('');
      onChanged?.(true);
    } catch (e) {
      toast.error(`Link failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function unlink(witId) {
    setBusy(true);
    try {
      await api.unlinkWorkItem(pr.repo, pr.id, witId);
      toast.success(`Unlinked work item #${witId}`);
      onChanged?.(true);
    } catch (e) {
      toast.error(`Unlink failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <h3>Work items ({items.length})</h3>
      {items.length === 0 && <div className="muted" style={{ fontSize: 13, marginBottom: canManage ? 10 : 0 }}>No linked work items.</div>}
      {items.map((w) => (
        <div key={w.id} className="kv" style={{ alignItems: 'center' }}>
          <a href={w.url} target="_blank" rel="noreferrer" className="k" style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0, textDecoration: 'none', color: 'inherit' }}>
            {w.type && <span className="badge repo">{w.type}</span>}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>#{w.id} {w.title}</span>
          </a>
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            {w.state && <span className="v muted" style={{ fontSize: 12 }}>{w.state}</span>}
            {canManage && <button className="btn xs ghost" title="Unlink" disabled={busy} onClick={() => unlink(w.id)}><X size={12} /></button>}
          </span>
        </div>
      ))}
      {canManage && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') link(); }}
            placeholder="Work item id (e.g. 12345)"
            style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
          />
          <button className="btn accent" disabled={busy || !draft.trim()} onClick={link}><Plus size={14} /> Link</button>
        </div>
      )}
    </div>
  );
}
