import { useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from './ui.jsx';
import { rerunnableBuilds } from '../lib/format.js';
import { RefreshCw, Zap, Trash2, Check, X, GitMerge } from './icons.jsx';

/**
 * Bulk actions on the currently-selected PRs (A2). Reuses the per-PR endpoints,
 * looping sequentially (ADO writes are cheap but we avoid hammering), and reports
 * a per-action success/failure summary. Available actions depend on the variant.
 */
export function BulkActionsBar({ variant, selectedPrs, onClear, onChanged }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const n = selectedPrs.length;
  if (n === 0) return null;

  async function run(label, fn, filter) {
    if (busy) return;
    const targets = filter ? selectedPrs.filter(filter) : selectedPrs;
    if (!targets.length) { toast.info(`No selected PRs are eligible for "${label}".`); return; }
    setBusy(true);
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < targets.length; i++) {
      setProgress(`${label}: ${i + 1}/${targets.length}`);
      try { await fn(targets[i]); ok += 1; }
      catch { failed += 1; }
    }
    setBusy(false);
    setProgress(null);
    if (failed) toast.error(`${label}: ${ok} succeeded, ${failed} failed`);
    else toast.success(`${label}: ${ok} PR${ok === 1 ? '' : 's'} updated`);
    onChanged?.();
    onClear?.();
  }

  const isCreated = variant === 'created';
  const isAssigned = variant === 'assigned' || variant === 'assignedTeam';

  return (
    <div className="bulk-bar no-print">
      <span className="bulk-count"><Check size={14} /> {n} selected</span>
      <div className="grow" />

      {isCreated && (
        <>
          <button className="btn sm" disabled={busy} title="Re-run every re-runnable gating pipeline on the selected PRs"
            onClick={() => run('Re-run gates', async (pr) => {
              const builds = rerunnableBuilds(pr);
              for (const b of builds) await api.requeue(pr.repo, pr.id, b.evaluationId);
            }, (pr) => rerunnableBuilds(pr).length > 0)}>
            <RefreshCw size={13} /> Re-run gates
          </button>
          <button className="btn sm" disabled={busy} title="Enable auto-complete (squash · delete source branch)"
            onClick={() => run('Auto-complete', (pr) => api.setAutoComplete(pr.repo, pr.id, true), (pr) => pr.state === 'Open')}>
            <Zap size={13} /> Auto-complete
          </button>
          <button className="btn sm danger" disabled={busy} title="Abandon the selected PRs"
            onClick={() => run('Abandon', (pr) => api.abandon(pr.repo, pr.id), (pr) => pr.state === 'Open' || pr.state === 'Draft')}>
            <Trash2 size={13} /> Abandon
          </button>
        </>
      )}

      {isAssigned && (
        <>
          <button className="btn sm primary" disabled={busy} title="Approve the selected PRs"
            onClick={() => run('Approve', (pr) => api.vote(pr.repo, pr.id, 10))}>
            <Check size={13} /> Approve
          </button>
          <button className="btn sm" disabled={busy} title="Approve with suggestions"
            onClick={() => run('Approve w/ suggestions', (pr) => api.vote(pr.repo, pr.id, 5))}>
            <GitMerge size={13} /> Approve w/ sugg.
          </button>
          <button className="btn sm" disabled={busy} title="Wait for author on the selected PRs"
            onClick={() => run('Wait for author', (pr) => api.vote(pr.repo, pr.id, -5))}>
            Wait
          </button>
        </>
      )}

      {progress && <span className="muted" style={{ fontSize: 12 }}>{progress}</span>}
      <button className="btn sm ghost" disabled={busy} onClick={onClear} title="Clear selection"><X size={13} /> Clear</button>
    </div>
  );
}
