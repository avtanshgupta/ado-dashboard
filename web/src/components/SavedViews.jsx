import { useState, useRef, useEffect } from 'react';
import { useConfig, useApp } from '../lib/AppContext.jsx';
import { api } from '../lib/api.js';
import { useToast } from './ui.jsx';
import { Star, ChevronDown, Save, X } from './icons.jsx';

/**
 * Saved views (E1): persist named filter+sort presets per user and quick-apply
 * them. Views are stored in config.savedViews and tagged by list variant so each
 * category only shows its own presets (plus any saved as "all").
 */
export function SavedViews({ variant, filters, sort, onApply }) {
  const config = useConfig();
  const { reloadConfig } = useApp();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setSaving(false); } }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const all = config.savedViews || [];
  const views = all.filter((v) => !v.variant || v.variant === variant);

  async function persist(next) {
    await api.updateConfig({ savedViews: next });
    await reloadConfig();
  }

  async function saveCurrent() {
    const nm = name.trim();
    if (!nm) return;
    const view = {
      id: `v${Date.now()}`,
      name: nm,
      variant,
      // Persist the sticky filter facets (not the ephemeral free-text search).
      filters: { repos: filters.repos, states: filters.states, timeRange: filters.timeRange, labels: filters.labels, pipeline: filters.pipeline, review: filters.review },
      sort,
    };
    try {
      await persist([...all, view]);
      toast.success(`Saved view “${nm}”`);
      setName('');
      setSaving(false);
    } catch (e) {
      toast.error(`Save failed: ${e.message}`);
    }
  }

  async function remove(id) {
    try {
      await persist(all.filter((v) => v.id !== id));
      toast.success('View removed');
    } catch (e) {
      toast.error(`Remove failed: ${e.message}`);
    }
  }

  function apply(view) {
    onApply({ filters: view.filters || {}, sort: view.sort || null });
    setOpen(false);
  }

  return (
    <div className="dropdown" ref={ref}>
      <button type="button" className="dropdown-toggle" onClick={() => setOpen((o) => !o)} title="Saved views">
        <Star size={13} /> Views{views.length ? ` (${views.length})` : ''} <ChevronDown size={11} />
      </button>
      {open && (
        <div className="dropdown-menu" style={{ minWidth: 240 }}>
          <div className="dd-head"><span>Saved views</span></div>
          {views.length === 0 && <div className="muted" style={{ fontSize: 12, padding: '4px 10px' }}>No saved views yet.</div>}
          {views.map((v) => (
            <div key={v.id} className="dd-item" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button type="button" style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', font: 'inherit', color: 'inherit' }} onClick={() => apply(v)}>{v.name}</button>
              <button type="button" className="btn xs ghost" title="Delete" onClick={() => remove(v.id)}><X size={12} /></button>
            </div>
          ))}
          <div className="dd-head" style={{ marginTop: 6 }}><span>Save current</span></div>
          {saving ? (
            <div style={{ display: 'flex', gap: 6, padding: '4px 10px' }}>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveCurrent(); }} placeholder="View name" style={{ flex: 1, padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
              <button type="button" className="btn xs primary" onClick={saveCurrent} disabled={!name.trim()}><Save size={12} /></button>
            </div>
          ) : (
            <button type="button" className="dd-item" style={{ color: 'var(--accent)' }} onClick={() => setSaving(true)}><Save size={12} /> Save current filters…</button>
          )}
        </div>
      )}
    </div>
  );
}
