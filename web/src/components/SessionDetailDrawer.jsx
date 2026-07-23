import { X, Bot, FolderGit2, GitBranch, Terminal, Server, Hourglass, XCircle } from './icons.jsx';
import { cleanVersion } from '../lib/format.js';

const STATUS_COLORS = { active: '#22c55e', idle: '#eab308', stale: '#ef4444', ended: '#6b7280' };

function fmtTime(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function fmtSeconds(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return '';
  if (n < 60) return `${Math.round(n)}s`;
  if (n < 3600) return `${Math.round(n / 60)}m`;
  const h = Math.floor(n / 3600);
  const m = Math.round((n % 3600) / 60);
  return `${h}h ${m}m`;
}

/** Right-hand slide-over showing everything known about a single agent session. */
export function SessionDetailDrawer({ session, machineName, onClose, onEnd }) {
  if (!session) return null;
  const { id, sessionId, status, repo, branch, cwd, agentType, startTime, lastHeartbeat, runtime, lastHeartbeatAgo, heartbeatCount, longRunning, metadata, history } = session;
  const meta = metadata || {};
  const hist = Array.isArray(history) ? [...history].reverse() : [];
  const uptime = fmtSeconds(meta.uptimeSec);
  const hasMetrics = uptime || meta.paneCount || meta.agentCount;

  return (
    <div className="drawer-root" role="dialog" aria-modal="true" aria-label="Session details">
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer-panel">
        <div className="drawer-head">
          <div className="drawer-title">
            <span className="status-dot" style={{ background: STATUS_COLORS[status] || '#6b7280' }} />
            <strong>{sessionId || (id || '').slice(0, 8)}</strong>
            <span className={`status-badge ${status}`}>{status}</span>
            {longRunning && <span className="badge-longrun"><Hourglass size={11} /> long-running</span>}
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <div className="drawer-body">
          <section className="drawer-section">
            <h4>Machine</h4>
            <div className="dk"><Server size={13} /> {machineName || '—'}</div>
            {agentType && <div className="dk"><Bot size={13} /> {agentType}</div>}
          </section>

          <section className="drawer-section">
            <h4>Location</h4>
            {repo ? <div className="dk"><FolderGit2 size={13} /> {repo}</div> : <div className="dk muted">No repository</div>}
            {branch && <div className="dk"><GitBranch size={13} /> {branch}</div>}
            {cwd && <div className="dk mono"><Terminal size={13} /> {cwd}</div>}
          </section>

          <section className="drawer-section">
            <h4>Timing</h4>
            <div className="dkv"><span>Started</span><span>{fmtTime(startTime)}</span></div>
            <div className="dkv"><span>Last heartbeat</span><span>{fmtTime(lastHeartbeat)}{lastHeartbeatAgo ? ` (${lastHeartbeatAgo} ago)` : ''}</span></div>
            <div className="dkv"><span>Runtime</span><span>{runtime || '—'}</span></div>
            <div className="dkv"><span>Heartbeats</span><span>{heartbeatCount || 1}</span></div>
          </section>

          {(meta.version || meta.model || meta.os || meta.pid) && (
            <section className="drawer-section">
              <h4>Environment</h4>
              {meta.version && <div className="dkv"><span>CLI version</span><span title={meta.version}>{cleanVersion(meta.version)}</span></div>}
              {meta.model && <div className="dkv"><span>Model</span><span>{meta.model}</span></div>}
              {meta.os && <div className="dkv"><span>OS</span><span>{meta.os}</span></div>}
              {meta.pid && <div className="dkv"><span>PID</span><span>{meta.pid}</span></div>}
            </section>
          )}

          {hasMetrics && (
            <section className="drawer-section">
              <h4>Reporter metrics</h4>
              {uptime && <div className="dkv"><span>Process uptime</span><span>{uptime}</span></div>}
              {meta.agentCount && <div className="dkv"><span>Agents detected</span><span>{meta.agentCount}</span></div>}
              {meta.paneCount && <div className="dkv"><span>Tmux panes</span><span>{meta.paneCount}</span></div>}
            </section>
          )}

          {hist.length > 0 && (
            <section className="drawer-section">
              <h4>Status history</h4>
              <ul className="drawer-timeline">
                {hist.map((h, i) => (
                  <li key={`${h.t}-${i}`}>
                    <span className="status-dot" style={{ background: STATUS_COLORS[h.status] || '#6b7280' }} />
                    <span className="tl-status">{h.status}</span>
                    <span className="tl-time muted">{fmtTime(h.t)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {status !== 'ended' && (
            <button className="btn danger drawer-end" onClick={() => { onEnd(id); onClose(); }}>
              <XCircle size={14} /> End session
            </button>
          )}
        </div>
      </aside>
    </div>
  );
}
