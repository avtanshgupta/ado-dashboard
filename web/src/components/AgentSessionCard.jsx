import { GitBranch, FolderGit2, Clock, Terminal, XCircle } from './icons.jsx';

function timeAgo(ts) {
  if (!ts) return '—';
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function runtime(start) {
  if (!start) return '—';
  const diff = Date.now() - new Date(start).getTime();
  const hrs = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

const STATUS_COLORS = {
  active: '#22c55e',
  idle: '#eab308',
  stale: '#ef4444',
  ended: '#6b7280',
};

export function AgentSessionCard({ session, onEnd }) {
  const { id, repo, branch, cwd, status, lastHeartbeat, startTime, agentType, sessionId } = session;

  return (
    <div className={`agent-session-card status-${status}`}>
      <div className="session-header">
        <span className="status-dot" style={{ background: STATUS_COLORS[status] || '#6b7280' }} />
        <span className="session-id">{sessionId || id.slice(0, 8)}</span>
        <span className={`status-badge ${status}`}>{status}</span>
        {status !== 'ended' && (
          <button className="btn-icon end-btn" onClick={() => onEnd(id)} title="End session">
            <XCircle size={14} />
          </button>
        )}
      </div>
      <div className="session-details">
        {repo && (
          <span className="detail"><FolderGit2 size={13} /> {repo}</span>
        )}
        {branch && (
          <span className="detail"><GitBranch size={13} /> {branch}</span>
        )}
        {cwd && (
          <span className="detail"><Terminal size={13} /> {cwd}</span>
        )}
        <span className="detail"><Clock size={13} /> {timeAgo(lastHeartbeat)}</span>
        {startTime && (
          <span className="detail runtime">⏱ {runtime(startTime)}</span>
        )}
      </div>
    </div>
  );
}
