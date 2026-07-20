import { useState, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAsync } from '../lib/useAsync.js';
import { api } from '../lib/api.js';
import { Loading, ErrorBox, useToast } from '../components/ui.jsx';
import { repoShort } from '../lib/format.js';
import { Play, ExternalLink } from '../components/icons.jsx';

export function PipelineTrigger() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const defs = useAsync(() => api.pipelineDefs(false), []);

  const [definitionId, setDefinitionId] = useState(params.get('def') || '');
  const [branch, setBranch] = useState('');
  const [branchQuery, setBranchQuery] = useState('');
  const [mineOnly, setMineOnly] = useState(true);
  const [paramText, setParamText] = useState('');
  const [busy, setBusy] = useState(false);

  const selected = useMemo(
    () => (defs.data || []).find((d) => String(d.definitionId) === String(definitionId)),
    [defs.data, definitionId]
  );

  // Default to the first pipeline once loaded.
  useEffect(() => {
    if (!definitionId && defs.data && defs.data.length) setDefinitionId(String(defs.data[0].definitionId));
  }, [defs.data, definitionId]);

  const repo = selected?.repo;
  // Debounce the branch search into a server-side filter so branches beyond the
  // first page (200) are still findable when triggering on any branch (F4).
  const [branchFilter, setBranchFilter] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setBranchFilter(branchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [branchQuery]);
  const branches = useAsync(
    () => (repo ? api.pipelineBranches(repo, mineOnly, branchFilter) : Promise.resolve([])),
    [repo, mineOnly, branchFilter]
  );

  // Reset chosen branch when the pipeline (repo) changes.
  useEffect(() => { setBranch(''); }, [repo, mineOnly]);

  const filteredBranches = useMemo(() => {
    const list = branches.data || [];
    const q = branchQuery.trim().toLowerCase();
    return q ? list.filter((b) => b.toLowerCase().includes(q)) : list;
  }, [branches.data, branchQuery]);

  async function run() {
    if (!definitionId) return;
    let parameters;
    if (paramText.trim()) {
      try { parameters = JSON.parse(paramText); }
      catch { toast.error('Parameters must be valid JSON (e.g. {"key":"value"})'); return; }
    }
    setBusy(true);
    try {
      const r = await api.pipelineQueue(definitionId, { branch: branch || undefined, parameters });
      toast.success(`Queued run #${r.id} on ${r.branch}`);
      navigate(`/pipelines/run/${r.id}`);
    } catch (e) {
      toast.error(`Trigger failed: ${e.message}`);
      setBusy(false);
    }
  }

  if (defs.loading && !defs.data) return <Loading label="Loading pipelines…" />;
  if (defs.error) return <ErrorBox error={defs.error} onRetry={defs.refetch} />;

  return (
    <div>
      <h2 className="section-title"><Play size={20} /> Trigger a pipeline run</h2>
      <div className="card card-pad" style={{ maxWidth: 640 }}>
        <label className="field-label">Pipeline</label>
        <select value={definitionId} onChange={(e) => setDefinitionId(e.target.value)} style={{ width: '100%' }}>
          {(defs.data || []).map((d) => (
            <option key={d.definitionId} value={d.definitionId}>{d.name} — {repoShort(d.repo)}</option>
          ))}
        </select>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
          <label className="field-label" style={{ margin: 0 }}>Branch</label>
          <label className="muted" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> My branches only
          </label>
        </div>
        {branches.loading ? (
          <div className="muted" style={{ fontSize: 13, marginTop: 8 }}>Loading branches…</div>
        ) : (
          <>
            <select
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              style={{ width: '100%', marginTop: 6 }}
            >
              <option value="">
                {selected?.defaultBranch ? `Default branch (${selected.defaultBranch.replace('refs/heads/', '')})` : 'Default branch'}
              </option>
              {filteredBranches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            {(branches.data || []).length > 12 && (
              <input
                placeholder="Type to filter the branch list…"
                value={branchQuery}
                onChange={(e) => setBranchQuery(e.target.value)}
                style={{ width: '100%', marginTop: 6, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
              />
            )}
          </>
        )}
        <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
          {filteredBranches.length} branch(es){mineOnly ? ' under your user/ prefix' : ''}. Leave on “Default” to use {selected?.defaultBranch?.replace('refs/heads/', '') || 'the default branch'}.
        </div>

        <label className="field-label" style={{ marginTop: 16 }}>Parameters (optional JSON)</label>
        <textarea
          placeholder='{"myVariable":"value"}'
          value={paramText}
          onChange={(e) => setParamText(e.target.value)}
          rows={3}
          style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 12, padding: 8, border: '1px solid var(--border)', borderRadius: 6 }}
        />

        <div style={{ display: 'flex', gap: 10, marginTop: 18, alignItems: 'center' }}>
          <button className="btn accent" onClick={run} disabled={busy || !definitionId}>
            {busy ? 'Queuing…' : <><Play size={14} /> Run pipeline</>}
          </button>
          {selected && <a className="btn" href={selected.webUrl} target="_blank" rel="noreferrer">Open in ADO <ExternalLink size={13} /></a>}
        </div>
      </div>
    </div>
  );
}
