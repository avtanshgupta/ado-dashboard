import { useState, useRef, useEffect } from 'react';
import { api } from '../lib/api.js';
import { useToast } from './ui.jsx';
import { tagFieldWithAdded, summarize } from '../lib/workItemBulk.js';
import { Check, X, Tag, UserCheck, ListTodo } from './icons.jsx';

/**
 * Bulk actions on the currently-selected work items (A3). Mirrors the PR
 * BulkActionsBar: reuses the per-item PATCH endpoint, loops sequentially, and
 * reports a per-item success/failure summary. Actions:
 *   - Reassign      → System.AssignedTo (identity search)
 *   - Add a tag     → System.Tags (merged per item; existing tag = no-op skip)
 *   - Set state     → System.State (may not be valid for every type; failures
 *                     are counted and reported rather than aborting the batch)
 */
export function BulkWorkItemBar({ items, onClear, onChanged }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [mode, setMode] = useState(null); // 'tag' | 'state' | 'assign' | null
  const n = items.length;

  async function runEach(label, fnFor) {
    if (busy) return;
    setBusy(true);
    setMode(null);
    const results = [];
    for (let i = 0; i < items.length; i++) {
      setProgress(`${label}: ${i + 1}/${items.length}`);
      const fn = fnFor(items[i]);
      if (!fn) { results.push({ ok: true, skipped: true }); continue; } // no-op
      try { await fn(); results.push({ ok: true }); }
      catch { results.push({ ok: false }); }
    }
    const { ok, failed } = summarize(results);
    setBusy(false);
    setProgress(null);
    if (failed) toast.error(`${label}: ${ok} succeeded, ${failed} failed`);
    else toast.success(`${label}: ${ok} work item${ok === 1 ? '' : 's'} updated`);
    onChanged?.();
    onClear?.();
  }

  const addTag = (tag) => {
    const clean = tag.trim();
    if (!clean) return;
    runEach('Add tag', (wi) => {
      const field = tagFieldWithAdded(wi.tags || [], clean);
      return field == null ? null : () => api.wiUpdate(wi.id, { 'System.Tags': field });
    });
  };
  const setState = (state) => {
    const clean = state.trim();
    if (!clean) return;
    runEach(`Set state → ${clean}`, (wi) => () => api.wiUpdate(wi.id, { 'System.State': clean }));
  };
  const reassign = (who) => {
    runEach(who ? 'Reassign' : 'Unassign', (wi) => () => api.wiUpdate(wi.id, { 'System.AssignedTo': who }));
  };

  if (n === 0) return null;

  return (
    <div className="bulk-bar no-print">
      <span className="bulk-count"><Check size={14} /> {n} selected</span>
      <div className="grow" />

      {mode === 'tag' && <InlineText placeholder="Tag to add…" onSubmit={addTag} onCancel={() => setMode(null)} disabled={busy} />}
      {mode === 'state' && <InlineText placeholder="New state (e.g. Active, Resolved)…" onSubmit={setState} onCancel={() => setMode(null)} disabled={busy} />}
      {mode === 'assign' && <InlineAssignee onPick={reassign} onCancel={() => setMode(null)} disabled={busy} />}

      {!mode && (
        <>
          <button className="btn sm" disabled={busy} onClick={() => setMode('assign')} title="Reassign the selected work items">
            <UserCheck size={13} /> Reassign
          </button>
          <button className="btn sm" disabled={busy} onClick={() => setMode('tag')} title="Add a tag to the selected work items">
            <Tag size={13} /> Add tag
          </button>
          <button className="btn sm" disabled={busy} onClick={() => setMode('state')} title="Set the state of the selected work items">
            <ListTodo size={13} /> Set state
          </button>
        </>
      )}

      {progress && <span className="muted" style={{ fontSize: 12 }}>{progress}</span>}
      <button className="btn sm ghost" disabled={busy} onClick={onClear} title="Clear selection"><X size={13} /> Clear</button>
    </div>
  );
}

/** Small inline text field with submit-on-Enter and a confirm button. */
function InlineText({ placeholder, onSubmit, onCancel, disabled }) {
  const [v, setV] = useState('');
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <span className="bulk-inline">
      <input
        ref={ref}
        value={v}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(v); } else if (e.key === 'Escape') onCancel(); }}
        style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, minWidth: 190 }}
      />
      <button className="btn sm" disabled={disabled || !v.trim()} onClick={() => onSubmit(v)}><Check size={13} /></button>
      <button className="btn sm ghost" disabled={disabled} onClick={onCancel}><X size={13} /></button>
    </span>
  );
}

/** Inline identity search → picks an assignee (or clears it). */
function InlineAssignee({ onPick, onCancel, disabled }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => {
    if (!q.trim()) { setResults([]); setOpen(false); return undefined; }
    let live = true;
    const t = setTimeout(async () => {
      try { const r = await api.searchIdentities(q.trim()); if (live) { setResults(r || []); setOpen(true); } }
      catch { if (live) setResults([]); }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  return (
    <span className="bulk-inline" style={{ position: 'relative' }}>
      <input
        ref={ref}
        value={q}
        placeholder="Search a person…"
        disabled={disabled}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }}
        style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, minWidth: 190 }}
      />
      <button className="btn sm ghost" disabled={disabled} title="Unassign" onClick={() => onPick(null)}>Unassign</button>
      <button className="btn sm ghost" disabled={disabled} onClick={onCancel}><X size={13} /></button>
      {open && results.length > 0 && (
        <div className="bulk-assignee-pop">
          {results.slice(0, 8).map((idn) => (
            <button
              key={idn.id || idn.mail || idn.uniqueName}
              className="bulk-assignee-item"
              disabled={disabled}
              onClick={() => onPick(idn.mail || idn.uniqueName || idn.displayName)}
            >
              {idn.displayName}
              {(idn.mail || idn.uniqueName) && <span className="muted"> · {idn.mail || idn.uniqueName}</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
