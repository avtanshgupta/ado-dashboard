import { useState, useEffect, useMemo } from 'react';
import { useToast } from './ui.jsx';
import { ListTodo, Check, ChevronDown, ChevronRight } from './icons.jsx';
import {
  DEFAULT_CHECKLIST,
  normalizeChecklist,
  allChecked,
  composeReviewSummary,
} from '../lib/reviewChecklist.js';

const ITEMS_KEY = 'ado-review-checklist-items';
const stateKey = (repo, id) => `ado-review-checklist:${repo}#${id}`;

function loadItems() {
  try { return normalizeChecklist(JSON.parse(localStorage.getItem(ITEMS_KEY))); }
  catch { return [...DEFAULT_CHECKLIST]; }
}
function loadChecked(repo, id) {
  try { return new Set(JSON.parse(localStorage.getItem(stateKey(repo, id))) || []); }
  catch { return new Set(); }
}

/**
 * Guided review checklist for a PR (B6). Items are shared across PRs (editable,
 * stored locally); tick state is per-PR. A completed checklist can be posted as a
 * Markdown comment via the existing PR comment endpoint (optionally after voting).
 */
export function ReviewChecklist({ repo, id, postComment, onPosted }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(loadItems);
  const [checked, setChecked] = useState(() => loadChecked(repo, id));
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setChecked(loadChecked(repo, id)); }, [repo, id]);
  useEffect(() => {
    try { localStorage.setItem(stateKey(repo, id), JSON.stringify([...checked])); } catch { /* ignore */ }
  }, [checked, repo, id]);
  useEffect(() => {
    try { localStorage.setItem(ITEMS_KEY, JSON.stringify(items)); } catch { /* ignore */ }
  }, [items]);

  const doneCount = useMemo(() => items.filter((it) => checked.has(it.id)).length, [items, checked]);
  const complete = allChecked(items, checked);

  function toggle(itemId) {
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(itemId)) n.delete(itemId); else n.add(itemId);
      return n;
    });
  }

  async function postSummary() {
    if (busy) return;
    setBusy(true);
    try {
      const md = composeReviewSummary(items, checked);
      await postComment(md);
      toast.success('Review summary posted');
      onPosted?.(true);
    } catch (e) {
      toast.error(`Post failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="review-checklist no-print">
      <button className="review-checklist-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        <ListTodo size={15} />
        <span>Review checklist</span>
        <span className={`review-checklist-badge ${complete ? 'done' : ''}`}>{doneCount}/{items.length}</span>
      </button>
      {open && (
        <div className="review-checklist-body">
          {items.map((it) => (
            <label key={it.id} className="review-checklist-item">
              <input type="checkbox" checked={checked.has(it.id)} onChange={() => toggle(it.id)} />
              {editing ? (
                <input
                  className="review-checklist-edit"
                  value={it.label}
                  onChange={(e) => setItems((list) => list.map((x) => (x.id === it.id ? { ...x, label: e.target.value } : x)))}
                />
              ) : (
                <span>{it.label}</span>
              )}
              {editing && (
                <button className="btn xs ghost" title="Remove item" onClick={() => setItems((list) => list.filter((x) => x.id !== it.id))}>×</button>
              )}
            </label>
          ))}
          <div className="review-checklist-actions">
            {editing ? (
              <>
                <button className="btn xs" onClick={() => setItems((list) => [...list, { id: `item-${Date.now()}`, label: 'New item' }])}>+ Add item</button>
                <button className="btn xs" onClick={() => setItems(loadItems())}>Reset</button>
                <button className="btn xs primary" onClick={() => setEditing(false)}><Check size={12} /> Done editing</button>
              </>
            ) : (
              <>
                <button className="btn xs ghost" onClick={() => setEditing(true)}>Edit items</button>
                <button className="btn xs primary" disabled={busy} onClick={postSummary} title="Post the checklist as a review comment">
                  {busy ? 'Posting…' : 'Post review summary'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
