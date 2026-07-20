import { Link } from 'react-router-dom';
import { useConfig } from '../lib/AppContext.jsx';
import { Avatar, TimeAgo, IdleTag } from './ui.jsx';
import { WiTypeBadge, WiStateBadge, PriorityBadge, SeverityBadge } from './workItemUi.jsx';
import { shortPath } from '../lib/format.js';
import { ArrowUp, ArrowDown, Tag } from './icons.jsx';

function Th({ label, k, sort, setSort, align }) {
  const active = sort.key === k;
  const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  const apply = () => setSort((s) => ({ key: k, dir: s.key === k && s.dir === 'desc' ? 'asc' : 'desc' }));
  return (
    <th
      onClick={apply}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apply(); } }}
      tabIndex={0}
      aria-sort={ariaSort}
      title={`Sort by ${label}`}
      style={align ? { textAlign: align } : undefined}
    >
      {label}
      {active && <span className="sort-ind">{sort.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}</span>}
    </th>
  );
}

export function WorkItemTable({ items, sort, setSort, typeColors = {}, density = 'comfortable', focusedKey = null, multiProject = false }) {
  const config = useConfig();
  const slaDays = config?.slaDays || 7;
  return (
    <div className="table-wrap">
      <table className={`pr-table ${density === 'compact' ? 'compact' : ''}`}>
        <thead>
          <tr>
            <Th label="Type" k="type" sort={sort} setSort={setSort} />
            <Th label="Work item" k="title" sort={sort} setSort={setSort} />
            <Th label="State" k="state" sort={sort} setSort={setSort} />
            <Th label="Assignee" k="assignedTo" sort={sort} setSort={setSort} />
            <Th label="Priority" k="priority" sort={sort} setSort={setSort} />
            <Th label="Points" k="storyPoints" sort={sort} setSort={setSort} align="center" />
            <Th label="Iteration" k="iterationPath" sort={sort} setSort={setSort} />
            <Th label="Updated" k="changedDate" sort={sort} setSort={setSort} />
            <th style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((wi) => (
            <tr key={wi.id} className={focusedKey === String(wi.id) ? 'row-focus' : ''}>
              <td><WiTypeBadge type={wi.type} color={typeColors[wi.type]} /></td>
              <td className="pr-title-cell">
                <Link className="title-link" to={`/work-item/${wi.id}`}>{wi.title}</Link>
                <div className="meta">
                  <span>#{wi.id}</span>
                  {multiProject && wi.project && <span className="badge repo">{wi.project}</span>}
                  {wi.areaPath && <span title={wi.areaPath}>{shortPath(wi.areaPath)}</span>}
                  {wi.severity && <SeverityBadge severity={wi.severity} />}
                </div>
                {wi.tags?.length > 0 && (
                  <div className="label-row">
                    {wi.tags.slice(0, 4).map((t) => (
                      <span key={t} className="badge pr-label"><Tag size={10} /> {t}</span>
                    ))}
                    {wi.tags.length > 4 && <span className="badge pr-label">+{wi.tags.length - 4}</span>}
                  </div>
                )}
              </td>
              <td><WiStateBadge state={wi.state} /></td>
              <td>
                {wi.assignedTo ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Avatar name={wi.assignedTo.displayName} imageUrl={wi.assignedTo.imageUrl} size={18} />
                    <span style={{ fontSize: 13 }}>{wi.assignedTo.displayName}</span>
                  </span>
                ) : (
                  <span className="muted" style={{ fontSize: 13 }}>Unassigned</span>
                )}
              </td>
              <td><PriorityBadge priority={wi.priority} /></td>
              <td style={{ textAlign: 'center' }} className="muted">{wi.storyPoints ?? wi.effort ?? '—'}</td>
              <td className="muted" style={{ fontSize: 12.5 }} title={wi.iterationPath || ''}>{shortPath(wi.iterationPath) || '—'}</td>
              <td className="updated-cell" style={{ whiteSpace: 'nowrap' }}>
                <TimeAgo date={wi.changedDate} className="muted" />{' '}
                <IdleTag days={wi.idleDays} threshold={slaDays} />
              </td>
              <td>
                <div className="row-actions">
                  <Link className="btn sm" to={`/work-item/${wi.id}`}>View</Link>
                  {wi.url && <a className="btn sm ghost" href={wi.url} target="_blank" rel="noreferrer" title="Open in Azure DevOps">ADO</a>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
