export function TaskStatusBadge({ status }) {
  const config = {
    planned: { label: 'Planned', className: 'badge-planned' },
    in_progress: { label: 'In Progress', className: 'badge-in-progress' },
    blocked: { label: 'Blocked', className: 'badge-blocked' },
    done: { label: 'Done', className: 'badge-done' },
  };
  const { label, className } = config[status] || config.planned;
  return <span className={`task-status-badge ${className}`}>{label}</span>;
}
