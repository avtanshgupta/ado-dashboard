import { useState, useRef, useEffect } from 'react';
import { api } from '../lib/api.js';
import { Avatar, useToast } from './ui.jsx';
import { Users, Star, X } from './icons.jsx';

/**
 * Reviewers card with management controls (author only): toggle required,
 * remove, and add via an identity-search typeahead.
 */
export function ReviewerManager({ pr, canManage, onChanged }) {
  const toast = useToast();
  const reviewers = pr.review?.reviewers || [];
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const timerRef = useRef(null);

  useEffect(() => {
    function onClick(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    if (!q || q.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api.searchIdentities(q.trim());
        setResults(r);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [q]);

  const existingIds = new Set(reviewers.map((r) => r.id));

  async function add(identity) {
    setBusyId('add');
    try {
      await api.addReviewer(pr.repo, pr.id, identity.id, false);
      toast.success(`Added ${identity.displayName}`);
      setQ('');
      setResults([]);
      setOpen(false);
      onChanged?.(true);
    } catch (e) {
      toast.error(`Add failed: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(r) {
    if (!window.confirm(`Remove ${r.displayName} as a reviewer?`)) return;
    setBusyId(r.id);
    try {
      await api.removeReviewer(pr.repo, pr.id, r.id);
      toast.success(`Removed ${r.displayName}`);
      onChanged?.(true);
    } catch (e) {
      toast.error(`Remove failed: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleRequired(r) {
    setBusyId(r.id);
    try {
      await api.setReviewerRequired(pr.repo, pr.id, r.id, !r.isRequired);
      toast.success(`${r.displayName} is now ${!r.isRequired ? 'required' : 'optional'}`);
      onChanged?.(true);
    } catch (e) {
      toast.error(`Update failed: ${e.message}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card card-pad" style={{ marginBottom: 16 }}>
      <h3>Reviewers ({reviewers.length})</h3>
      {reviewers.length === 0 && <div className="muted" style={{ fontSize: 13 }}>No reviewers yet.</div>}
      {reviewers.map((r) => (
        <div key={r.id} className="kv">
          <span className="k" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {r.isGroup ? <Users size={16} aria-label="Group" /> : <Avatar name={r.displayName} size={18} />}
            {r.displayName} {r.isRequired && <span style={{ color: 'var(--red)' }} title="Required">*</span>}
          </span>
          <span className="v" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className={`badge review-${r.vote > 0 ? 'Approved' : r.vote < 0 ? 'ChangesRequested' : 'Pending'}`}>{r.voteLabel}</span>
            {canManage && (
              <>
                <button
                  className="btn sm ghost"
                  disabled={busyId === r.id}
                  title={r.isRequired ? 'Make optional' : 'Make required'}
                  aria-label={r.isRequired ? `Make ${r.displayName} optional` : `Make ${r.displayName} required`}
                  onClick={() => toggleRequired(r)}
                >
                  <Star size={14} fill={r.isRequired ? 'currentColor' : 'none'} style={r.isRequired ? { color: 'var(--yellow)' } : undefined} />
                </button>
                <button
                  className="btn sm ghost"
                  disabled={busyId === r.id}
                  title="Remove reviewer"
                  aria-label={`Remove ${r.displayName}`}
                  onClick={() => remove(r)}
                >
                  <X size={14} />
                </button>
              </>
            )}
          </span>
        </div>
      ))}

      {canManage && (
        <div className="reviewer-add no-print" ref={boxRef} style={{ position: 'relative', marginTop: 10 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => results.length && setOpen(true)}
            placeholder="Add reviewer — type a name or email…"
            aria-label="Add reviewer"
            style={{ width: '100%', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
          />
          {open && (results.length > 0 || searching) && (
            <div className="dropdown-menu" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, minWidth: 0, zIndex: 30 }}>
              {searching && <div className="dd-item muted">Searching…</div>}
              {results.map((idn) => {
                const already = existingIds.has(idn.id);
                return (
                  <button
                    key={idn.id}
                    className="dd-item"
                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', border: 'none', background: 'none', cursor: already ? 'default' : 'pointer' }}
                    disabled={already || busyId === 'add'}
                    onClick={() => add(idn)}
                  >
                    {idn.isGroup ? <Users size={16} aria-label="Group" /> : <Avatar name={idn.displayName} size={18} />}
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {idn.displayName}
                      {idn.mail && <span className="muted" style={{ fontSize: 11 }}> · {idn.mail}</span>}
                    </span>
                    {already && <span className="muted" style={{ fontSize: 11 }}>added</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
