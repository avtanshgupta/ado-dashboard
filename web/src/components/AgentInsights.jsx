import { Clock, Server, FolderGit2, Activity } from './icons.jsx';

function Bars({ items, labelKey, valueKey, maxLabels = 8 }) {
  const max = Math.max(1, ...items.map((i) => i[valueKey]));
  const step = Math.max(1, Math.ceil(items.length / maxLabels));
  return (
    <div className="insight-chart">
      <div className="insight-bars">
        {items.map((it) => (
          <div className="ib-col" key={it[labelKey]} title={`${it[labelKey]}: ${it[valueKey]}`}>
            <div className="ib-bar" style={{ height: `${Math.round((it[valueKey] / max) * 100)}%` }} />
          </div>
        ))}
      </div>
      <div className="insight-xaxis">
        {items.map((it, i) => (
          <span className="ib-label" key={it[labelKey]}>{i % step === 0 ? it[labelKey] : ''}</span>
        ))}
      </div>
    </div>
  );
}

/** Usage analytics for the Agents "Insights" tab. */
export function AgentInsights({ data }) {
  if (!data) return null;
  const { totalSessions, agentHours, perMachine = [], byHour = [], byDay = [], perRepo = [] } = data;
  const hourItems = byHour.map((h) => ({ label: String(h.hour).padStart(2, '0'), count: h.count }));
  const dayItems = byDay.map((d) => ({ label: d.day.slice(5), count: d.count }));

  return (
    <section className="agent-insights">
      <div className="overview-tiles">
        <div className="ov-tile"><span className="ov-num">{agentHours}</span><span className="ov-lbl"><Clock size={13} /> Agent-hours</span></div>
        <div className="ov-tile"><span className="ov-num">{totalSessions}</span><span className="ov-lbl"><Activity size={13} /> Sessions</span></div>
        <div className="ov-tile"><span className="ov-num">{perMachine.length}</span><span className="ov-lbl"><Server size={13} /> Machines</span></div>
      </div>

      <div className="overview-detail">
        <div className="ov-card">
          <h4>Busiest hours (session starts, UTC)</h4>
          {byHour.some((h) => h.count) ? <Bars items={hourItems} labelKey="label" valueKey="count" maxLabels={8} /> : <p className="muted" style={{ fontSize: 13, margin: 0 }}>No data yet.</p>}
        </div>
        <div className="ov-card">
          <h4><FolderGit2 size={13} /> Sessions by repository</h4>
          {perRepo.length ? (
            <ul className="ov-repos">
              {perRepo.map((r) => (
                <li key={r.repo}><span className="ov-repo-name">{r.repo}</span><span className="ov-count">{r.count}</span></li>
              ))}
            </ul>
          ) : <p className="muted" style={{ fontSize: 13, margin: 0 }}>No repositories yet.</p>}
        </div>
      </div>

      <div className="ov-card" style={{ marginTop: 12 }}>
        <h4>Daily activity (sessions started)</h4>
        {dayItems.length ? <Bars items={dayItems} labelKey="label" valueKey="count" maxLabels={14} /> : <p className="muted" style={{ fontSize: 13, margin: 0 }}>No data yet.</p>}
      </div>

      <div className="ov-card" style={{ marginTop: 12 }}>
        <h4><Server size={13} /> Per-machine uptime</h4>
        {perMachine.length ? (
          <table className="insight-table">
            <thead><tr><th>Machine</th><th>Sessions</th><th>Agent-hours</th><th>Last seen</th></tr></thead>
            <tbody>
              {perMachine.map((m) => (
                <tr key={m.machineId}>
                  <td>{m.name}</td>
                  <td>{m.sessions}</td>
                  <td>{m.agentHours}</td>
                  <td className="muted">{m.lastSeenAgo ? `${m.lastSeenAgo} ago` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted" style={{ fontSize: 13, margin: 0 }}>No machines yet.</p>}
      </div>
    </section>
  );
}
