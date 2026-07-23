import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useConfig } from '../lib/AppContext.jsx';
import { StateBadge, ReviewBadge, MyReviewBadge, PipelineBadge, CommentPill, PopBadge, PartialBadge, Avatar, TimeAgo } from './ui.jsx';
import { MergeModal, RequeueModal } from './actions.jsx';
import { repoShort, canRerunGate, daysSinceDate } from '../lib/format.js';
import { ArrowUp, ArrowDown, RefreshCw, GitBranch } from './icons.jsx';

function Th({ label, k, sort, setSort, align }) {
  const active = sort.key === k;
  const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  const apply = () => setSort((s) => ({ key: k, dir: s.key === k && s.dir === 'desc' ? 'asc' : 'desc' }));
  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      title={`Sort by ${label}`}
      style={align ? { textAlign: align } : undefined}
    >
      <button
        type="button"
        onClick={apply}
        aria-label={`Sort by ${label}${active ? `, currently ${ariaSort}` : ''}`}
        style={{
          appearance: 'none',
          background: 'none',
          border: 0,
          color: 'inherit',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          font: 'inherit',
          padding: 0,
          textAlign: align || 'left',
        }}
      >
        {label}
        {active && <span className="sort-ind">{sort.dir === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />}</span>}
      </button>
    </th>
  );
}

export function PrTable({ prs, variant, sort, setSort, onChanged, selectable = false, selected, onToggleSelect, onToggleAll, density = 'comfortable', focusedKey = null }) {
  const config = useConfig();
  const slaDays = config?.slaDays || 7;
  const [merge, setMerge] = useState(null);
  const [requeue, setRequeue] = useState(null);
  const isAssigned = variant === 'assigned' || variant === 'assignedTeam';
  const selKey = (pr) => `${pr.repo}#${pr.id}`;
  const allSelected = selectable && prs.length > 0 && prs.every((pr) => selected?.has(selKey(pr)));

  return (
    <div className="table-wrap">
      <table className={`pr-table ${density === 'compact' ? 'compact' : ''}`} aria-label="Pull requests">
        <thead>
          <tr>
            {selectable && (
              <th scope="col" style={{ width: 30 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  aria-label="Select all pull requests on this page"
                  onChange={() => onToggleAll?.(prs)}
                />
              </th>
            )}
            <Th label="Pull request" k="title" sort={sort} setSort={setSort} />
            <Th label="Repo" k="repo" sort={sort} setSort={setSort} />
            <Th label="State" k="state" sort={sort} setSort={setSort} />
            <Th label="Comments" k="activeComments" sort={sort} setSort={setSort} align="center" />
            <Th label="Pipeline" k="pipeline" sort={sort} setSort={setSort} />
            {variant === 'created' && <Th label="PoP" k="pop" sort={sort} setSort={setSort} />}
            {isAssigned && <Th label="My review" k="myReview" sort={sort} setSort={setSort} />}
            <Th label="Review" k="reviewStatus" sort={sort} setSort={setSort} />
            <Th label="Updated" k="lastActivity" sort={sort} setSort={setSort} />
            {isAssigned && <th scope="col">Threads</th>}
            <th scope="col" style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {prs.map((pr) => (
            <tr key={`${pr.repo}#${pr.id}`} className={`${selectable && selected?.has(selKey(pr)) ? 'row-selected' : ''} ${focusedKey === selKey(pr) ? 'row-focus' : ''}`}>
              {selectable && (
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={selected?.has(selKey(pr)) || false}
                    aria-label={`Select PR ${pr.id}`}
                    onChange={() => onToggleSelect?.(pr)}
                  />
                </td>
              )}
              <td className="pr-title-cell">
                <Link className="title-link" to={`/pr/${encodeURIComponent(pr.repo)}/${pr.id}`}>
                  {pr.title}
                </Link>
                <div className="meta">
                  <span>!{pr.id}</span>
                  {variant !== 'created' && (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Avatar name={pr.createdBy?.displayName} imageUrl={pr.createdBy?.imageUrl} size={16} />
                      {pr.createdBy?.displayName}
                    </span>
                  )}
                  <span title={pr.sourceBranch} style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><GitBranch size={12} /> {pr.sourceBranch?.slice(0, 28)}</span>
                  {pr.partial?.length > 0 && <PartialBadge parts={pr.partial} />}
                </div>
                {pr.labels?.length > 0 && (
                  <div className="label-row">
                    {pr.labels.map((l) => (
                      <span key={l} className="badge pr-label">{l}</span>
                    ))}
                  </div>
                )}
              </td>
              <td>
                <span className="badge repo">{repoShort(pr.repo)}</span>
              </td>
              <td>
                <StateBadge state={pr.state} />
              </td>
              <td style={{ textAlign: 'center' }}>
                <CommentPill count={pr.activeComments} />
              </td>
              <td>
                <PipelineBadge
                  status={pr.pipeline?.overall}
                  title={
                    (pr.pipeline?.builds || []).length
                      ? pr.pipeline.builds.map((b) => `${b.name}: ${b.effectiveStatus || b.status}`).join('\n')
                      : undefined
                  }
                />
              </td>
              {variant === 'created' && (
                <td>
                  {pr.pop ? <PopBadge pop={pr.pop} compact /> : <span className="muted">—</span>}
                </td>
              )}
              {isAssigned && (
                <td>
                  <MyReviewBadge review={pr.myReview} />
                </td>
              )}
              <td>
                <ReviewBadge status={pr.reviewStatus} review={pr.review} />
              </td>
              <td className="updated-cell">
                {(() => {
                  const when = pr.lastActivity || pr.creationDate;
                  const idle = daysSinceDate(when);
                  const overSla = idle != null && idle >= slaDays;
                  return (
                    <TimeAgo
                      date={when}
                      className={overSla ? 'sla-breach' : 'muted'}
                      title={overSla ? `Idle ${idle} day${idle === 1 ? '' : 's'} — past your ${slaDays}-day SLA` : undefined}
                    />
                  );
                })()}
              </td>
              {isAssigned && (
                <td>
                  <span className="badge count-pill has" title="Open threads">
                    {pr.comments?.active ?? pr.activeComments ?? 0} open
                  </span>{' '}
                  <span className="badge pipe-Succeeded" title="Resolved threads">
                    {pr.comments?.resolved ?? 0} resolved
                  </span>
                </td>
              )}
              <td>
                <div className="row-actions">
                  {variant === 'created' && pr.canMerge && (
                    <button className="btn sm primary" onClick={() => setMerge(pr)}>
                      Merge
                    </button>
                  )}
                  {variant === 'created' && (pr.pipeline?.builds?.length || 0) > 0 && (
                    <button
                      className="btn sm"
                      disabled={!canRerunGate(pr)}
                      onClick={() => setRequeue(pr)}
                      title={canRerunGate(pr) ? 'Re-trigger gating pipeline' : 'Gates are already running — nothing to re-trigger'}
                    >
                      <RefreshCw size={13} /> Gate
                    </button>
                  )}
                  <Link className="btn sm" to={`/pr/${encodeURIComponent(pr.repo)}/${pr.id}`}>
                    View
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {merge && <MergeModal pr={merge} onClose={() => setMerge(null)} onDone={onChanged} />}
      {requeue && <RequeueModal pr={requeue} onClose={() => setRequeue(null)} onDone={onChanged} />}
    </div>
  );
}
