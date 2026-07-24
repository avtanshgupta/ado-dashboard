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

export function WorkItemTable({ items, sort, setSort, typeColors = {}, density = 'comfortable', focusedKey = null, multiProject = false, selectable = false, selected, onToggleSelect, onToggleAll }) {
  const config = useConfig();
  const slaDays = config?.slaDays || 7;
  const allSelected = selectable && items.length > 0 && items.every((wi) => selected?.has(String(wi.id)));
  return (
    <div className="table-wrap">
      <table className={`pr-table ${density === 'compact' ? 'compact' : ''}`} aria-label="Work items">
        <thead>
          <tr>
            {selectable && (
              <th scope="col" style={{ width: 30 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  aria-label="Select all work items on this page"
                  onChange={() => onToggleAll?.(items)}
                />
              </th>
            )}
            <Th label="Type" k="type" sort={sort} setSort={setSort} />
            <Th label="Work item" k="title" sort={sort} setSort={setSort} />
            <Th label="State" k="state" sort={sort} setSort={setSort} />
            <Th label="Assignee" k="assignedTo" sort={sort} setSort={setSort} />
            <Th label="Priority" k="priority" sort={sort} setSort={setSort} />
            <Th label="Points" k="storyPoints" sort={sort} setSort={setSort} align="center" />
            <Th label="Iteration" k="iterationPath" sort={sort} setSort={setSort} />
            <Th label="Updated" k="changedDate" sort={sort} setSort={setSort} />
            <th scope="col" style={{ textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((wi) => (
            <tr key={wi.id} className={`${selectable && selected?.has(String(wi.id)) ? 'row-selected' : ''} ${focusedKey === String(wi.id) ? 'row-focus' : ''}`}>
              {selectable && (
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={selected?.has(String(wi.id)) || false}
                    aria-label={`Select work item ${wi.id}`}
                    onChange={() => onToggleSelect?.(wi)}
                  />
                </td>
              )}
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
