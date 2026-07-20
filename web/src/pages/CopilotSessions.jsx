import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api.js';
import { Loading, ErrorBox } from '../components/ui.jsx';
import { AgentSessionCard } from '../components/AgentSessionCard.jsx';
import { MachineGroup } from '../components/MachineGroup.jsx';
import { Bot, RefreshCw, Server } from '../components/icons.jsx';

export function CopilotSessions() {
  const [groups, setGroups] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [g, s] = await Promise.all([
        api.agentSessionsGrouped(),
        api.agentSummary(),
      ]);
      setGroups(g.value || []);
      setSummary(s);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh every 30s
  useEffect(() => {
    const iv = setInterval(load, 30_000);
    return () => clearInterval(iv);
  }, [load]);

  const handleEnd = async (id) => {
    await api.agentEnd(id);
    load();
  };

  if (loading) return <Loading label="Loading agent sessions…" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;

  const noSessions = !groups || groups.length === 0;

  return (
    <div className="copilot-sessions-page">
      <div className="page-header">
        <div className="page-title">
          <Bot size={22} />
          <h1>Copilot Agent Sessions</h1>
        </div>
        <button className="btn btn-ghost" onClick={load} title="Refresh">
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      {summary && (
        <div className="agent-summary-cards">
          <div className="summary-card active">
            <span className="status-dot active" />
            <span className="count">{summary.active || 0}</span>
            <span className="label">Active</span>
          </div>
          <div className="summary-card idle">
            <span className="status-dot idle" />
            <span className="count">{summary.idle || 0}</span>
            <span className="label">Idle</span>
          </div>
          <div className="summary-card stale">
            <span className="status-dot stale" />
            <span className="count">{summary.stale || 0}</span>
            <span className="label">Stale</span>
          </div>
          <div className="summary-card ended">
            <span className="status-dot ended" />
            <span className="count">{summary.ended || 0}</span>
            <span className="label">Ended</span>
          </div>
        </div>
      )}

      {noSessions ? (
        <div className="empty-state">
          <Server size={40} />
          <h2>No Agent Sessions</h2>
          <p>Set up the reporter script on your VMs to see active Copilot CLI sessions here.</p>
          <details>
            <summary>Quick Setup</summary>
            <ol>
              <li>Generate an API key in Settings → Agents</li>
              <li>Create <code>~/.config/ado-dashboard/reporter.json</code> on your VM</li>
              <li>Run <code>scripts/copilot-session-reporter.py</code> via cron every minute</li>
            </ol>
          </details>
        </div>
      ) : (
        <div className="machine-groups">
          {groups.map((group) => (
            <MachineGroup key={group.machineId} group={group} onEnd={handleEnd} />
          ))}
        </div>
      )}
    </div>
  );
}
