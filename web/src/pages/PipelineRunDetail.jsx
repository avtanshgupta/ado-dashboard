import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAsync } from '../lib/useAsync.js';
import { api } from '../lib/api.js';
import { Loading, ErrorBox, RunStatusBadge, TimeAgo, useToast } from '../components/ui.jsx';
import { repoShort, fmtDate, fmtDuration } from '../lib/format.js';
import {
  ArrowLeft, RefreshCw, ExternalLink, XCircle, CheckCircle2, Ban, TriangleAlert,
  CircleDot, CircleDashed, GitBranch, Clock, ChevronRight, ChevronDown,
} from '../components/icons.jsx';

function RecIcon({ rec, size = 12 }) {
  let Icon = CircleDot;
  if (rec.state === 'inProgress') Icon = CircleDot;
  else if (rec.state !== 'completed') Icon = CircleDashed;
  else Icon = { succeeded: CheckCircle2, failed: XCircle, skipped: Ban, canceled: Ban, abandoned: Ban, succeededWithIssues: TriangleAlert }[rec.result] || CircleDot;
  return <Icon size={size} />;
}
function recCls(rec) {
  if (rec.state === 'inProgress') return 'rec-running';
  if (rec.state !== 'completed') return 'rec-pending';
  return { succeeded: 'rec-succeeded', failed: 'rec-failed', succeededWithIssues: 'rec-warn' }[rec.result] || 'rec-other';
}

function LogPeek({ buildId, rec, project }) {
  const [open, setOpen] = useState(false);
  const log = useAsync(() => (open && rec.log ? api.pipelineRunLog(buildId, rec.log, 200, project) : Promise.resolve(null)), [open]);
  if (!rec.log) return null;
  return (
    <div style={{ marginTop: 4 }}>
      <button className="btn sm ghost" onClick={() => setOpen((o) => !o)}>{open ? <><ChevronDown size={13} /> Hide log</> : <><ChevronRight size={13} /> View log tail</>}</button>
      {open && (
        <div className="log-box">
          {log.loading ? 'Loading…' : log.error ? `Error: ${log.error.message}` : (log.data?.lines || []).join('\n')}
        </div>
      )}
    </div>
  );
}

export function PipelineRunDetail() {
  const { buildId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, refetch } = useAsync(() => api.pipelineRunDetail(buildId), [buildId], { pollMs: 15000 });
  const [expanded, setExpanded] = useState(() => new Set());
  const [rerunning, setRerunning] = useState(false);
  const [rerunningFailed, setRerunningFailed] = useState(false);

  if (loading && !data) return <Loading label="Loading run…" />;
  if (error) return <ErrorBox error={error} onRetry={refetch} />;

  const { run, stages, failed, failedStages = [], canRerun, canRerunFailed, isRunning } = data;
  const toggle = (id) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function rerun() {
    setRerunning(true);
    try {
      const r = await api.pipelineRetry(run.id, run.project);
      toast.success(`Re-queued as run #${r.id}`);
      navigate(`/pipelines/run/${r.id}`);
    } catch (e) {
      toast.error(`Re-run failed: ${e.message}`);
      setRerunning(false);
    }
  }

  async function rerunFailed() {
    setRerunningFailed(true);
    try {
      const r = await api.pipelineRetryFailed(run.id, run.project);
      toast.success(`Re-running ${r.retried} failed stage(s)`);
      setTimeout(() => refetch(true), 1500);
    } catch (e) {
      toast.error(`Re-run failed stages failed: ${e.message}`);
    } finally {
      setRerunningFailed(false);
    }
  }

  return (
    <div>
      <button onClick={() => navigate(-1)} className="btn sm no-print" style={{ marginBottom: 14 }}><ArrowLeft size={14} /> Back</button>

      <div className="detail-header">
        <div style={{ flex: 1 }}>
          <h1>{run.definitionName} <span style={{ color: 'var(--text-subtle)', fontWeight: 400 }}>#{run.id}</span></h1>
          <div className="detail-sub">
            <RunStatusBadge status={run.status} />
            <span className="badge repo">{repoShort(run.repo)}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><GitBranch size={14} /> {run.branch}</span>
            <span>{run.reasonLabel}</span>
            <span>{run.requestedFor}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Clock size={14} /> {fmtDuration(run.durationMs)}</span>
          </div>
        </div>
        <div className="row-actions no-print" style={{ flexWrap: 'wrap' }}>
          {failedStages.length > 0 && (
            <button
              className="btn"
              onClick={rerunFailed}
              disabled={rerunningFailed || !canRerunFailed}
              title={isRunning ? 'Available once the run completes' : `Re-run ${failedStages.length} failed stage(s) in place`}
            >
              {rerunningFailed ? 'Re-running…' : <><RefreshCw size={14} /> Re-run failed stage{failedStages.length === 1 ? '' : 's'} ({failedStages.length})</>}
            </button>
          )}
          <button
            className="btn accent"
            onClick={rerun}
            disabled={rerunning || !canRerun}
            title={isRunning ? 'Available once the run completes' : 'Queue a fresh run on the same branch'}
          >
            {rerunning ? 'Re-running…' : <><RefreshCw size={14} /> Re-run pipeline</>}
          </button>
          <a className="btn" href={run.webUrl} target="_blank" rel="noreferrer">Open in ADO <ExternalLink size={13} /></a>
        </div>
      </div>

      <div className="detail-grid">
        <div>
          {failed.length > 0 && (
            <div className="card card-pad" style={{ marginBottom: 16, borderLeft: '3px solid var(--red)' }}>
              <h3><XCircle size={16} /> Failures ({failed.length})</h3>
              {failed.map((f) => (
                <div key={f.id} className="fail-item">
                  <div>
                    <span className="badge run-Failed">{f.type}</span>{' '}
                    <strong>{f.name}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {f.stage ? `Stage: ${f.stage}` : ''}{f.job && f.job !== f.name ? ` · Job: ${f.job}` : ''}
                      {f.errorCount ? ` · ${f.errorCount} error(s)` : ''}
                    </div>
                  </div>
                  <LogPeek buildId={run.id} rec={f} project={run.project} />
                </div>
              ))}
            </div>
          )}

          <div className="card card-pad">
            <h3>Stages ({stages.length})</h3>
            {stages.length === 0 && <div className="muted">No timeline available for this run yet.</div>}
            {stages.map((st) => {
              const open = expanded.has(st.id);
              return (
                <div key={st.id} className={`stage ${recCls(st)}`}>
                  <div
                    className="stage-head"
                    onClick={() => toggle(st.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggle(st.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                  >
                    <span className={`chev ${open ? 'open' : ''}`}><ChevronRight size={13} /></span>
                    <span className={`rec-badge ${recCls(st)}`}><RecIcon rec={st} /></span>
                    <span style={{ flex: 1, fontWeight: 600 }}>{st.name}</span>
                    <span className="muted" style={{ fontSize: 12 }}>{fmtDuration(st.durationMs)}</span>
                  </div>
                  {open && (
                    <div className="stage-body">
                      {st.jobs.length === 0 && <div className="muted" style={{ fontSize: 12 }}>No jobs.</div>}
                      {st.jobs.map((job) => (
                        <div key={job.id} className="job">
                          <div className="job-head">
                            <span className={`rec-badge ${recCls(job)}`}><RecIcon rec={job} /></span>
                            <span style={{ flex: 1 }}>{job.name}</span>
                            <span className="muted" style={{ fontSize: 11.5 }}>{fmtDuration(job.durationMs)}</span>
                          </div>
                          {job.tasks.filter((t) => t.result === 'failed' || t.state === 'inProgress').map((t) => (
                            <div key={t.id} className={`task ${recCls(t)}`}>
                              <span className={`rec-badge ${recCls(t)}`}><RecIcon rec={t} size={11} /></span>
                              <span style={{ flex: 1 }}>{t.name}</span>
                              <span className="muted" style={{ fontSize: 11 }}>{fmtDuration(t.durationMs)}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="card card-pad">
            <h3>Run details</h3>
            <div className="kv"><span className="k">Status</span><span className="v"><RunStatusBadge status={run.status} /></span></div>
            <div className="kv"><span className="k">Build number</span><span className="v">{run.buildNumber}</span></div>
            <div className="kv"><span className="k">Trigger</span><span className="v">{run.reasonLabel}</span></div>
            <div className="kv"><span className="k">Branch</span><span className="v" title={run.sourceBranch}>{run.branch}</span></div>
            <div className="kv"><span className="k">Requested by</span><span className="v">{run.requestedFor}</span></div>
            <div className="kv"><span className="k">Queued</span><span className="v"><TimeAgo date={run.queueTime} /></span></div>
            <div className="kv"><span className="k">Started</span><span className="v">{run.startTime ? <TimeAgo date={run.startTime} /> : '—'}</span></div>
            <div className="kv"><span className="k">Finished</span><span className="v">{run.finishTime ? <TimeAgo date={run.finishTime} /> : '—'}</span></div>
            <div className="kv"><span className="k">Duration</span><span className="v">{fmtDuration(run.durationMs)}</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
