import { useState } from 'react';
import { Modal, useToast } from './ui.jsx';
import { api } from '../lib/api.js';
import { isGateInFlight } from '../lib/format.js';

const STRATEGIES = [
  { value: 'squash', label: 'Squash commit' },
  { value: 'noFastForward', label: 'Merge (no fast-forward)' },
  { value: 'rebase', label: 'Rebase' },
  { value: 'rebaseMerge', label: 'Semi-linear merge (rebase + merge)' },
];

export function MergeModal({ pr, onClose, onDone }) {
  const toast = useToast();
  const [strategy, setStrategy] = useState('squash');
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [bypass, setBypass] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function doMerge() {
    setBusy(true);
    try {
      await api.merge(pr.repo, pr.id, {
        mergeStrategy: strategy,
        deleteSourceBranch: deleteBranch,
        bypassPolicy: bypass,
        bypassReason: reason,
      });
      toast.success(`Merge started for !${pr.id}`);
      onDone && onDone();
      onClose();
    } catch (e) {
      toast.error(`Merge failed: ${e.message}`);
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Complete pull request !${pr.id}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn primary" onClick={doMerge} disabled={busy}>
            {busy ? 'Merging…' : 'Complete merge'}
          </button>
        </>
      }
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{pr.title}</div>
      <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 8 }}>
        {pr.sourceBranch} → {pr.targetBranch}
      </div>
      <label>Merge strategy</label>
      <select value={strategy} onChange={(e) => setStrategy(e.target.value)}>
        {STRATEGIES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <div className="check-row">
        <input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} id="delbr" />
        <label htmlFor="delbr" style={{ margin: 0 }}>
          Delete source branch after merge
        </label>
      </div>
      <div className="check-row">
        <input type="checkbox" checked={bypass} onChange={(e) => setBypass(e.target.checked)} id="byp" />
        <label htmlFor="byp" style={{ margin: 0 }}>
          Bypass branch policies (override)
        </label>
      </div>
      {bypass && (
        <input
          type="text"
          placeholder="Bypass reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      )}
      <div style={{ fontSize: 12, color: 'var(--text-subtle)', marginTop: 10 }}>
        The Azure DevOps API enforces your real permissions — if you lack rights to complete this PR,
        the action will be rejected.
      </div>
    </Modal>
  );
}

export function RequeueModal({ pr, onClose, onDone }) {
  const toast = useToast();
  const builds = pr.pipeline?.builds || [];
  const [selected, setSelected] = useState(
    () =>
      new Set(
        builds
          .filter((b) => b.effectiveStatus === 'rejected' || b.effectiveStatus === 'expired' || b.status === 'rejected' || b.isExpired)
          .map((b) => b.evaluationId)
      )
  );
  const [busy, setBusy] = useState(false);

  function toggle(id) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  async function run() {
    setBusy(true);
    const ids = [...selected];
    let ok = 0;
    for (const id of ids) {
      try {
        await api.requeue(pr.repo, pr.id, id);
        ok++;
      } catch (e) {
        toast.error(`Re-run failed: ${e.message}`);
      }
    }
    if (ok) toast.success(`Re-queued ${ok} pipeline(s) for !${pr.id}`);
    setBusy(false);
    onDone && onDone();
    onClose();
  }

  return (
    <Modal
      title={`Re-trigger gating pipelines · !${pr.id}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn accent" onClick={run} disabled={busy || selected.size === 0}>
            {busy ? 'Queuing…' : `Re-run ${selected.size} selected`}
          </button>
        </>
      }
    >
      {builds.length === 0 && <div>No gating build pipelines found on this pull request.</div>}
      {builds.map((b) => {
        const st = b.effectiveStatus || b.status;
        const inFlight = isGateInFlight(b);
        return (
          <div className="check-row" key={b.evaluationId}>
            <input
              type="checkbox"
              checked={selected.has(b.evaluationId)}
              disabled={inFlight}
              onChange={() => !inFlight && toggle(b.evaluationId)}
              id={b.evaluationId}
            />
            <label htmlFor={b.evaluationId} style={{ margin: 0, flex: 1, opacity: inFlight ? 0.6 : 1 }}>
              {b.name}{' '}
              <span className={`badge pipe-${mapBuild(st)}`} style={{ marginLeft: 6 }}>
                {st}
              </span>
              {inFlight && (
                <span className="muted" style={{ fontSize: 11, marginLeft: 6 }}>
                  — already running, can’t re-trigger
                </span>
              )}
            </label>
          </div>
        );
      })}
    </Modal>
  );
}

function mapBuild(s) {
  return { approved: 'Succeeded', rejected: 'Failed', running: 'Running', queued: 'Queued', expired: 'Expired' }[s] || 'None';
}
