import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
import { Clock, Server, FolderGit2, Activity } from './icons.jsx';

const BAR_FILL = '#0969da';
const BAR_FILL_ACTIVE = '#0a5cc0';

/**
 * Interactive activity histogram (recharts, matching the app's other charts):
 * hover shows a themed tooltip and highlights the hovered bar. `interval` thins
 * crowded x-axis labels; `labelFormatter` prettifies the tooltip header.
 */
function ActivityChart({ data, interval = 0, labelFormatter, height = 150 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eaeef2" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={interval} tickLine={false} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} width={28} />
        <Tooltip
          cursor={{ fill: 'rgba(9, 105, 218, 0.08)' }}
          labelFormatter={labelFormatter}
          formatter={(v) => [v, v === 1 ? 'session' : 'sessions']}
        />
        <Bar
          dataKey="count"
          name="Sessions"
          fill={BAR_FILL}
          activeBar={{ fill: BAR_FILL_ACTIVE }}
          radius={[3, 3, 0, 0]}
          maxBarSize={38}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
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
          {byHour.some((h) => h.count) ? <ActivityChart data={hourItems} interval={2} labelFormatter={(l) => `${l}:00 UTC`} /> : <p className="muted" style={{ fontSize: 13, margin: 0 }}>No data yet.</p>}
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
        {dayItems.length ? <ActivityChart data={dayItems} interval={dayItems.length > 10 ? 1 : 0} labelFormatter={(l) => l} /> : <p className="muted" style={{ fontSize: 13, margin: 0 }}>No data yet.</p>}
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
