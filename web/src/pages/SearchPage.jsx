import { useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useAsync } from '../lib/useAsync.js';
import { api } from '../lib/api.js';
import { Loading, ErrorBox, Empty, StateBadge, PipelineBadge, ReviewBadge, RunStatusBadge } from '../components/ui.jsx';
import { searchAll } from '../lib/filters.js';
import { repoShort, timeAgo, fmtDuration } from '../lib/format.js';
import { Search, GitPullRequest, Workflow, Play, GitBranch } from '../components/icons.jsx';

function searchPipelines(defs, runs, q) {
  const query = q.trim().toLowerCase();
  if (!query) return { defs: [], runs: [] };
  const matchedDefs = (defs || []).filter((d) =>
    `${d.name} ${d.repo} ${d.definitionId}`.toLowerCase().includes(query)
  );
  const seen = new Set();
  const matchedRuns = [];
  for (const r of runs || []) {
    if (seen.has(r.id)) continue;
    const hay = `${r.id} ${r.buildNumber} ${r.branch} ${r.definitionName} ${r.requestedFor}`.toLowerCase();
    if (hay.includes(query)) {
      seen.add(r.id);
      matchedRuns.push(r);
    }
  }
  return { defs: matchedDefs, runs: matchedRuns.slice(0, 25) };
}

export function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const { data, loading, error, refetch } = useAsync(
    async () => {
      const [created, assigned, assignedTeam, team, defs, overview] = await Promise.all([
        api.created(),
        api.assigned('me'),
        api.assigned('team'),
        api.team(),
        api.pipelineDefs(true).catch(() => []),
        api.pipelineOverview().catch(() => ({ active: [], recent: [] })),
      ]);
      return { created, assigned, assignedTeam, team, defs, overview };
    },
    []
  );

  const prResults = useMemo(
    () =>
      data
        ? searchAll(
            { created: data.created, assigned: data.assigned, assignedTeam: data.assignedTeam, team: data.team },
            q
          )
        : [],
    [data, q]
  );
  const pipelineResults = useMemo(
    () =>
      data
        ? searchPipelines(data.defs, [...(data.overview.active || []), ...(data.overview.recent || [])], q)
        : { defs: [], runs: [] },
    [data, q]
  );

  if (loading && !data) return <Loading label="Searching pull requests & pipelines…" />;
  if (error) return <ErrorBox error={error} onRetry={refetch} />;

  const totalPipelines = pipelineResults.defs.length + pipelineResults.runs.length;
  const total = prResults.length + totalPipelines;

  return (
    <div>
      <h2 className="section-title"><Search size={20} /> Search results for “{q}”</h2>
      <div style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
        {total} match(es)
        {total > 0 ? ` · ${prResults.length} pull request(s), ${totalPipelines} pipeline result(s)` : ''}
      </div>

      {total === 0 ? (
        <Empty Icon={Search} label="No pull requests or pipelines match your search" />
      ) : (
        <>
          {prResults.length > 0 && (
            <div className="page-section">
              <h3 className="section-title" style={{ fontSize: 15 }}><GitPullRequest size={17} /> Pull requests ({prResults.length})</h3>
              <div className="table-wrap">
                <table className="pr-table">
                  <thead>
                    <tr>
                      <th>Pull request</th>
                      <th>Repo</th>
                      <th>Bucket</th>
                      <th>State</th>
                      <th>Pipeline</th>
                      <th>Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prResults.map((pr) => (
                      <tr key={`${pr.repo}#${pr.id}`}>
                        <td className="pr-title-cell">
                          <Link className="title-link" to={`/pr/${encodeURIComponent(pr.repo)}/${pr.id}`}>
                            {pr.title}
                          </Link>
                          <div className="meta">
                            <span>!{pr.id}</span>
                            <span>{pr.createdBy?.displayName}</span>
                            <span>· {timeAgo(pr.lastActivity || pr.creationDate)}</span>
                          </div>
                        </td>
                        <td><span className="badge repo">{repoShort(pr.repo)}</span></td>
                        <td style={{ textTransform: 'capitalize' }}>{pr.category}</td>
                        <td><StateBadge state={pr.state} /></td>
                        <td><PipelineBadge status={pr.pipeline?.overall} /></td>
                        <td><ReviewBadge status={pr.reviewStatus} review={pr.review} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {pipelineResults.defs.length > 0 && (
            <div className="page-section">
              <h3 className="section-title" style={{ fontSize: 15 }}><Workflow size={17} /> Pipelines ({pipelineResults.defs.length})</h3>
              <div className="grid cols-3">
                {pipelineResults.defs.map((p) => (
                  <div className="card card-pad" key={p.definitionId}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 8 }}>
                      <div style={{ minWidth: 0 }}>
                        <strong style={{ fontSize: 14 }}>{p.name}</strong>
                        <div className="muted" style={{ fontSize: 12 }}>{repoShort(p.repo)}</div>
                      </div>
                      {p.lastRun ? <RunStatusBadge status={p.lastRun.status} /> : <span className="muted">no runs</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                      <Link className="btn sm" to={`/pipelines/runs?def=${p.definitionId}`}>Runs</Link>
                      <Link className="btn sm accent" to={`/pipelines/trigger?def=${p.definitionId}`}><Play size={13} /> Trigger</Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pipelineResults.runs.length > 0 && (
            <div className="page-section">
              <h3 className="section-title" style={{ fontSize: 15 }}><Play size={16} /> Pipeline runs ({pipelineResults.runs.length})</h3>
              <div className="table-wrap">
                <table className="pr-table">
                  <thead>
                    <tr>
                      <th>Run</th>
                      <th>Repo</th>
                      <th>Status</th>
                      <th>Branch</th>
                      <th>Duration</th>
                      <th>Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pipelineResults.runs.map((r) => (
                      <tr key={r.id}>
                        <td className="pr-title-cell">
                          <Link className="title-link" to={`/pipelines/run/${r.id}`}>{r.definitionName}</Link>
                          <div className="meta"><span>#{r.id}</span><span>{r.reasonLabel}</span></div>
                        </td>
                        <td><span className="badge repo">{repoShort(r.repo)}</span></td>
                        <td><RunStatusBadge status={r.status} /></td>
                        <td title={r.sourceBranch} style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><GitBranch size={12} /> {r.branch}</td>
                        <td className="muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{fmtDuration(r.durationMs)}</td>
                        <td className="muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{timeAgo(r.startTime || r.queueTime)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
