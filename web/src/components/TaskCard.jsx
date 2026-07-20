import { useState } from 'react';
import { TaskStatusBadge } from './TaskStatusBadge.jsx';
import { Trash2, Edit3, Check } from './icons.jsx';

const STATUS_CYCLE = { planned: 'in_progress', in_progress: 'done', done: 'planned', blocked: 'planned' };

export function TaskCard({ task, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);

  function cycleStatus() {
    const next = STATUS_CYCLE[task.status] || 'planned';
    onUpdate({ status: next });
  }

  function handleSave() {
    if (title.trim() && title.trim() !== task.title) {
      onUpdate({ title: title.trim() });
    }
    setEditing(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') { setTitle(task.title); setEditing(false); }
  }

  return (
    <div className={`task-card status-${task.status}`}>
      <button
        className="task-status-btn"
        onClick={cycleStatus}
        title={`Status: ${task.status} (click to change)`}
      >
        <TaskStatusBadge status={task.status} />
      </button>

      <div className="task-content">
        {editing ? (
          <input
            className="task-edit-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleSave}
            autoFocus
          />
        ) : (
          <span
            className={`task-title ${task.status === 'done' ? 'done' : ''}`}
            onDoubleClick={() => setEditing(true)}
          >
            {task.title}
          </span>
        )}
        {task.categories?.includes('Carried') && (
          <span className="task-badge carried" title="Carried forward">↩</span>
        )}
      </div>

      <div className="task-actions">
        {editing ? (
          <button className="icon-btn" onClick={handleSave} title="Save"><Check size={14} /></button>
        ) : (
          <button className="icon-btn" onClick={() => setEditing(true)} title="Edit"><Edit3 size={14} /></button>
        )}
        <button className="icon-btn danger" onClick={onDelete} title="Delete"><Trash2 size={14} /></button>
      </div>
    </div>
  );
}
