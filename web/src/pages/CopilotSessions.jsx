import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Loading, ErrorBox, useToast } from '../components/ui.jsx';
import { MachineGroup } from '../components/MachineGroup.jsx';
import { Bot, RefreshCw, Server, Activity, TriangleAlert } from '../components/icons.jsx';

function AgentOverview({ o }) {
  const tiles = [
    { key: 'machines', num: o.totalMachines, label: 'Machines', sub: `${o.machinesOnline} online` },
    { key: 'active', num: o.active, label: 'Active', dot: 'active' },
    { key: 'idle', num: o.idle, label: 'Idle', dot: 'idle' },
    { key: 'stale', num: o.stale, label: 'Stale', dot: 'stale' },
    { key: 'ended', num: o.ended, label: 'Ended', dot: 'ended' },
  ];
  return (
    <section className="agent-overview">
      <div className="overview-tiles">
        {tiles.map((t) => (
          <div className="ov-tile" key={t.key}>
            <span className="ov-num">{t.num || 0}</span>
            <span className="ov-lbl">
              {t.dot && <span className={`status-dot ${t.dot}`} />} {t.label}
            </span>
            {t.sub && <span className="ov-sub">{t.sub}</span>}
          </div>
        ))}
      </div>
      <div className="overview-detail">
        <div className="ov-card">
          <h4>Top repositories</h4>
          {o.topRepos && o.topRepos.length ? (
            <ul className="ov-repos">
              {o.topRepos.map((r) => (
                <li key={r.repo}>
                  <span className="ov-repo-name">{r.repo}</span>
                  <span className="ov-count">{r.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>No active repositories.</p>
          )}
        </div>
        <div className="ov-card">
          <h4>Highlights</h4>
          <div className="ov-kv"><span>Live sessions</span><span>{o.liveSessions || 0}</span></div>
          <div className="ov-kv">
            <span>Longest running</span>
            <span>{o.longestRunning ? `${o.longestRunning.name} · ${o.longestRunning.runtime}` : '—'}</span>
          </div>
          <div className="ov-kv">
            <span>Last activity</span>
            <span>{o.lastActivityAgo ? `${o.lastActivityAgo} ago` : '—'}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function CopilotSessions() {
  const [groups, setGroups] = useState(null);
  const [overview, setOverview] = useState(null);
  const [keyStatus, setKeyStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('overview');
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [g, o, k] = await Promise.all([
        api.agentSessionsGrouped(),
        api.agentOverview(),
        api.agentApiKeyStatus().catch(() => null), // don't fail the page if this errors
      ]);
      setGroups(g.value || []);
      setOverview(o);
      setKeyStatus(k);
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

  const handleRename = async (machineId, label) => {
    try {
      await api.agentSetMachineLabel(machineId, label);
      toast.success(label.trim() ? 'Machine renamed' : 'Machine name reset');
      await load();
    } catch (e) {
      toast.error(`Rename failed: ${e.message}`);
      throw e;
    }
  };

  const handleRemove = async (machineId) => {
    try {
      const res = await api.agentRemoveMachine(machineId);
      toast.success(`Removed “${machineId}” (${res.removed} session${res.removed !== 1 ? 's' : ''})`);
      await load();
    } catch (e) {
      toast.error(`Remove failed: ${e.message}`);
    }
  };

  if (loading) return <Loading label="Loading agent sessions…" />;
  if (error) return <ErrorBox error={error} onRetry={load} />;

  const noSessions = !groups || groups.length === 0;
  const sessionCount = (groups || []).reduce((n, g) => n + g.sessions.length, 0);

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

      {noSessions ? (
        <div className="empty-state">
          <Server size={40} />
          <h2>No Agent Sessions</h2>
          <p>Set up the reporter script on your VMs to see active Copilot CLI sessions here.</p>
          <details>
            <summary>Quick Setup</summary>
            <ol>
              <li>Open <strong>Settings → Agents</strong> and click <strong>Generate key</strong></li>
              <li>Download <code>reporter.json</code> and <code>copilot-session-reporter.py</code> from there</li>
              <li>On your VM, drop <code>reporter.json</code> in <code>~/.config/ado-dashboard/</code> and run the script via cron every minute</li>
            </ol>
          </details>
        </div>
      ) : (
        <>
          {keyStatus && !keyStatus.hasKey && (
            <div className="agent-keywarn">
              <TriangleAlert size={16} />
              <div>
                <strong>No reporter API key.</strong> Your reporters can’t authenticate, so no new
                heartbeats arrive and sessions age to <em>stale</em> then <em>ended</em>.{' '}
                <Link to="/settings">Generate a key in Settings → Agents</Link>, then update{' '}
                <code>reporter.json</code> on each machine.
              </div>
            </div>
          )}

          <div className="subtabs">
            <button type="button" className={`subtab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}>
              <Activity size={15} /> Overview
            </button>
            <button type="button" className={`subtab ${tab === 'sessions' ? 'active' : ''}`} onClick={() => setTab('sessions')}>
              <Server size={15} /> Sessions{sessionCount ? ` (${sessionCount})` : ''}
            </button>
          </div>

          {tab === 'overview' && overview && <AgentOverview o={overview} />}

          {tab === 'sessions' && (
            <div className="machine-groups">
              {groups.map((group) => (
                <MachineGroup key={group.machineId} group={group} onEnd={handleEnd} onRename={handleRename} onRemove={handleRemove} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
