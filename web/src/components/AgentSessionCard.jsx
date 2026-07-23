import { GitBranch, FolderGit2, Clock, Terminal, XCircle, Bot, Hourglass, GitPullRequest, ChevronRight } from './icons.jsx';
import { cleanVersion } from '../lib/format.js';

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

function shortSeconds(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return '';
  if (n < 60) return `${Math.round(n)}s`;
  if (n < 3600) return `${Math.round(n / 60)}m`;
  return `${Math.floor(n / 3600)}h`;
}

const STATUS_COLORS = {
  active: '#22c55e',
  idle: '#eab308',
  stale: '#ef4444',
  ended: '#6b7280',
};

export function AgentSessionCard({ session, onEnd, onOpen, prMatch }) {
  const { id, repo, branch, cwd, status, lastHeartbeat, startTime, agentType, sessionId, longRunning, metadata } = session;
  const meta = metadata || {};
  const uptime = shortSeconds(meta.uptimeSec);

  return (
    <div className={`agent-session-card status-${status}${longRunning ? ' long-running' : ''}`}>
      <div className="session-header">
        <span className="status-dot" style={{ background: STATUS_COLORS[status] || '#6b7280' }} />
        <button className="session-id-btn" onClick={() => onOpen?.(session)} title="Session details">
          <span className="session-id">{sessionId || id.slice(0, 8)}</span>
          <ChevronRight size={13} />
        </button>
        <span className={`status-badge ${status}`}>{status}</span>
        {longRunning && (
          <span className="badge-longrun" title="Running longer than your long-running threshold">
            <Hourglass size={11} /> long-running
          </span>
        )}
        {agentType && <span className="agent-type"><Bot size={11} /> {agentType}</span>}
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
        {prMatch && prMatch.count > 0 && (
          <a className="detail pr-link" href={prMatch.url} target="_blank" rel="noopener noreferrer" title="Open pull request">
            <GitPullRequest size={13} /> {prMatch.count} open PR{prMatch.count !== 1 ? 's' : ''}
          </a>
        )}
        {cwd && (
          <span className="detail"><Terminal size={13} /> {cwd}</span>
        )}
        <span className="detail"><Clock size={13} /> {timeAgo(lastHeartbeat)}</span>
        {startTime && (
          <span className="detail runtime">⏱ {runtime(startTime)}</span>
        )}
      </div>
      {(meta.version || meta.os || meta.pid || meta.model || uptime || meta.agentCount || meta.paneCount) && (
        <div className="session-meta">
          {meta.version && <span className="meta-chip" title={meta.version}>v{cleanVersion(meta.version)}</span>}
          {meta.model && <span className="meta-chip">{meta.model}</span>}
          {meta.os && <span className="meta-chip">{meta.os}</span>}
          {meta.pid && <span className="meta-chip">pid {meta.pid}</span>}
          {uptime && <span className="meta-chip">up {uptime}</span>}
          {meta.agentCount && <span className="meta-chip">{meta.agentCount} agent{Number(meta.agentCount) === 1 ? '' : 's'}</span>}
          {meta.paneCount && <span className="meta-chip">{meta.paneCount} pane{Number(meta.paneCount) === 1 ? '' : 's'}</span>}
        </div>
      )}
    </div>
  );
}
