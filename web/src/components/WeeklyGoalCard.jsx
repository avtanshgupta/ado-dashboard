import { useState } from 'react';
import { TaskStatusBadge } from './TaskStatusBadge.jsx';
import { ChevronDown, ChevronRight, Trash2 } from './icons.jsx';

const STATUS_CYCLE = { planned: 'in_progress', in_progress: 'done', done: 'planned', blocked: 'planned' };

export function WeeklyGoalCard({ goal, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false);

  function cycleStatus() {
    const next = STATUS_CYCLE[goal.status] || 'planned';
    onUpdate({ status: next });
  }

  return (
    <div className={`weekly-goal-card status-${goal.status}`}>
      <div className="weekly-goal-header">
        <button className="expand-btn" onClick={() => setExpanded(!expanded)}>
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <button className="task-status-btn" onClick={cycleStatus} title={`Status: ${goal.status}`}>
          <TaskStatusBadge status={goal.status} />
        </button>
        <span className={`goal-title ${goal.status === 'done' ? 'done' : ''}`}>
          {goal.title}
        </span>
        {goal.dueDate && (
          <span className="goal-due muted">Due: {goal.dueDate}</span>
        )}
        <button className="icon-btn danger" onClick={onDelete} title="Delete">
          <Trash2 size={14} />
        </button>
      </div>

      {expanded && (
        <div className="weekly-goal-details">
          {goal.description && <p className="goal-description">{goal.description}</p>}
          {goal.linkedResources?.length > 0 && (
            <div className="linked-tasks">
              <span className="muted">Linked daily tasks: {goal.linkedResources.length}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
