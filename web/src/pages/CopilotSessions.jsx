import { useState, useEffect, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { Loading, ErrorBox, useToast, RefreshingTag } from '../components/ui.jsx';
import { MachineGroup } from '../components/MachineGroup.jsx';
import { AgentInsights } from '../components/AgentInsights.jsx';
import { SessionDetailDrawer } from '../components/SessionDetailDrawer.jsx';
import { Bot, RefreshCw, Server, Activity, TriangleAlert, Trash2, Search } from '../components/icons.jsx';

function AgentOverview({ o }) {
  const tiles = [
    { key: 'machines', num: o.totalMachines, label: 'Machines', sub: `${o.machinesOnline} online · ${o.machinesOffline} offline` },
    { key: 'active', num: o.active, label: 'Active', dot: 'active' },
    { key: 'idle', num: o.idle, label: 'Idle', dot: 'idle' },
    { key: 'stale', num: o.stale, label: 'Stale', dot: 'stale' },
    { key: 'ended', num: o.ended, label: 'Ended', dot: 'ended' },
    { key: 'long', num: o.longRunning, label: 'Long-running' },
  ];
  return (
    <section className="agent-overview">
      <div className="overview-tiles">
        {tiles.map((t) => (
          <div className="ov-tile" key={t.key}>
            <span className="ov-num">{t.num || 0}</span>
            <span className="ov-lbl">{t.dot && <span className={`status-dot ${t.dot}`} />} {t.label}</span>
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
                <li key={r.repo}><span className="ov-repo-name">{r.repo}</span><span className="ov-count">{r.count}</span></li>
              ))}
            </ul>
          ) : <p className="muted" style={{ fontSize: 13, margin: 0 }}>No active repositories.</p>}
        </div>
        <div className="ov-card">
          <h4>Highlights</h4>
          <div className="ov-kv"><span>Live sessions</span><span>{o.liveSessions || 0}</span></div>
          <div className="ov-kv"><span>Longest running</span><span>{o.longestRunning ? `${o.longestRunning.name} · ${o.longestRunning.runtime}` : '—'}</span></div>
          <div className="ov-kv"><span>Last activity</span><span>{o.lastActivityAgo ? `${o.lastActivityAgo} ago` : '—'}</span></div>
        </div>
      </div>
    </section>
  );
}

const STATUS_OPTS = ['all', 'active', 'idle', 'stale', 'ended'];

export function CopilotSessions() {
  const [prMatches, setPrMatches] = useState({});
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('overview');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [hideEnded, setHideEnded] = useState(false);
  const toast = useToast();
  const prFetched = useRef(false);

  // Stale-while-revalidate: renders instantly from cache on revisit, then
  // refreshes in the background (every 30s) so the latest data is always shown.
  const main = useAsync(
    async () => {
      const [g, o, a] = await Promise.all([
        api.agentSessionsGrouped(),
        api.agentOverview(),
        api.agentAnalytics().catch(() => null),
      ]);
      return { groups: g.value || [], overview: o, analytics: a };
    },
    [],
    { pollMs: 30_000, cacheKey: 'agents:dashboard' }
  );
  const keyInfo = useAsync(() => api.agentApiKeyStatus(), [], { pollMs: 60_000, cacheKey: 'agents:keystatus' });

  const groups = main.data ? main.data.groups : null;
  const overview = main.data ? main.data.overview : null;
  const analytics = main.data ? main.data.analytics : null;
  const keyStatus = keyInfo.data || null;
  const loading = main.loading;
  const error = main.error;
  const revalidating = main.revalidating || keyInfo.revalidating;
  const refresh = () => { main.refetch(); keyInfo.refetch(); };

  // Lazy, once: open-PR matches for live sessions (snapshotState is heavy).
  useEffect(() => {
    if (prFetched.current || !groups || groups.length === 0) return;
    prFetched.current = true;
    api.agentPrMatches().then((r) => setPrMatches(r.matches || {})).catch(() => {});
  }, [groups]);

  const handleEnd = async (id) => { await api.agentEnd(id); main.refetch(); };
  const handleRename = async (machineId, label) => {
    try {
      await api.agentSetMachineLabel(machineId, label);
      toast.success(label.trim() ? 'Machine renamed' : 'Machine name reset');
      await main.refetch();
    } catch (e) {
      toast.error(`Rename failed: ${e.message}`);
      throw e;
    }
  };
  const handleRemove = async (machineId) => {
    try {
      const res = await api.agentRemoveMachine(machineId);
      toast.success(`Removed “${machineId}” (${res.removed} session${res.removed !== 1 ? 's' : ''})`);
      await main.refetch();
    } catch (e) {
      toast.error(`Remove failed: ${e.message}`);
    }
  };
  const handleClearEnded = async () => {
    try {
      const r = await api.agentClearEnded();
      toast.success(r.removed ? `Cleared ${r.removed} ended session${r.removed !== 1 ? 's' : ''}` : 'No ended sessions to clear');
      await main.refetch();
    } catch (e) {
      toast.error(`Clear failed: ${e.message}`);
    }
  };
  const openSession = (session) => {
    const g = (groups || []).find((x) => x.machineId === session.machineId);
    setSelected({ session, machineName: g ? g.name : session.machineId });
  };

  const visibleGroups = useMemo(() => {
    if (!groups) return [];
    const q = query.trim().toLowerCase();
    let gs = groups.map((g) => {
      const nameMatch = q && (g.name || '').toLowerCase().includes(q);
      let sessions = g.sessions;
      if (hideEnded) sessions = sessions.filter((s) => s.status !== 'ended');
      if (statusFilter !== 'all') sessions = sessions.filter((s) => s.status === statusFilter);
      if (q && !nameMatch) {
        sessions = sessions.filter((s) =>
          [s.repo, s.branch, s.cwd, s.sessionId].some((x) => (x || '').toLowerCase().includes(q))
        );
      }
      return { ...g, sessions };
    }).filter((g) => g.sessions.length > 0);

    if (sortBy === 'name') gs = [...gs].sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' }));
    else if (sortBy === 'sessions') gs = [...gs].sort((a, b) => b.sessions.length - a.sessions.length);
    return gs;
  }, [groups, query, statusFilter, sortBy, hideEnded]);

  if (loading) return <Loading label="Loading agent sessions…" />;
  if (error && !groups) return <ErrorBox error={error} onRetry={refresh} />;

  const noSessions = !groups || groups.length === 0;
  const sessionCount = (groups || []).reduce((n, g) => n + g.sessions.length, 0);
  const endedCount = (groups || []).reduce((n, g) => n + g.sessions.filter((s) => s.status === 'ended').length, 0);

  return (
    <div className="copilot-sessions-page">
      <div className="page-header">
        <div className="page-title"><Bot size={22} /><h1>Copilot Agent Sessions</h1><RefreshingTag show={revalidating} /></div>
        <button className="btn btn-ghost" onClick={refresh} title="Refresh"><RefreshCw size={15} /> Refresh</button>
      </div>

      {noSessions ? (
        <div className="empty-state">
          <Server size={40} />
          <h2>No Agent Sessions</h2>
          <p>Set up the reporter script on your VMs to see active Copilot CLI sessions here.</p>
          {keyStatus && !keyStatus.hasKey && (
            <p className="muted" style={{ fontSize: 13 }}>Start by generating a reporter key in <Link to="/settings">Settings → Agents</Link>.</p>
          )}
          <details>
            <summary>Quick Setup</summary>
            <ol>
              <li>Open <strong>Settings → Agents</strong> and click <strong>New key</strong></li>
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
            <button type="button" className={`subtab ${tab === 'overview' ? 'active' : ''}`} onClick={() => setTab('overview')}><Activity size={15} /> Overview</button>
            <button type="button" className={`subtab ${tab === 'sessions' ? 'active' : ''}`} onClick={() => setTab('sessions')}><Server size={15} /> Sessions{sessionCount ? ` (${sessionCount})` : ''}</button>
          </div>

          {tab === 'overview' && (
            <>
              {overview && <AgentOverview o={overview} />}
              {analytics && (
                <>
                  <h3 className="agent-subhead">Usage &amp; analytics</h3>
                  <AgentInsights data={analytics} />
                </>
              )}
            </>
          )}

          {tab === 'sessions' && (
            <>
              <div className="agent-toolbar">
                <div className="agent-search">
                  <Search size={14} />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search repo, branch, cwd, machine…" />
                </div>
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
                  {STATUS_OPTS.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s[0].toUpperCase() + s.slice(1)}</option>)}
                </select>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort machines">
                  <option value="name">Name</option>
                  <option value="activity">Recent activity</option>
                  <option value="sessions">Session count</option>
                </select>
                <label className="agent-toggle"><input type="checkbox" checked={hideEnded} onChange={(e) => setHideEnded(e.target.checked)} /> Hide ended</label>
                {endedCount > 0 && (
                  <button className="btn sm" onClick={handleClearEnded} title="Remove all ended sessions"><Trash2 size={13} /> Clear ended ({endedCount})</button>
                )}
              </div>

              {visibleGroups.length === 0 ? (
                <div className="muted" style={{ padding: '24px 4px', fontSize: 13 }}>No sessions match your filters.</div>
              ) : (
                <div className="machine-groups">
                  {visibleGroups.map((group) => (
                    <MachineGroup
                      key={group.machineId}
                      group={group}
                      onEnd={handleEnd}
                      onRename={handleRename}
                      onRemove={handleRemove}
                      onOpenSession={openSession}
                      prMatches={prMatches}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}

      {selected && (
        <SessionDetailDrawer
          session={selected.session}
          machineName={selected.machineName}
          onClose={() => setSelected(null)}
          onEnd={handleEnd}
        />
      )}
    </div>
  );
}
