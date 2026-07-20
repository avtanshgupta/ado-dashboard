import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
} from 'recharts';

// Weekly pass/fail trend for a single pipeline.
export function PipelineTrendChart({ trend }) {
  if (!trend || trend.length === 0) return <div className="muted">No runs in this window.</div>;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={trend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eaeef2" />
        <XAxis dataKey="period" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Legend />
        <Bar dataKey="success" stackId="a" fill="#1f883d" name="Succeeded" />
        <Bar dataKey="fail" stackId="a" fill="#cf222e" name="Failed" />
        <Bar dataKey="other" stackId="a" fill="#8c959f" name="Other" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// Weekly merge throughput (PRs merged per ISO week) — B1.
export function ThroughputChart({ perWeek }) {
  if (!perWeek || perWeek.length === 0) return <div className="muted">No merges in this window.</div>;
  const data = perWeek.map((w) => ({ week: w.week.slice(5), count: w.count }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eaeef2" />
        <XAxis dataKey="week" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Line type="monotone" dataKey="count" stroke="#8250df" strokeWidth={2} dot={{ r: 3 }} name="Merged" />
      </LineChart>
    </ResponsiveContainer>
  );
}

// Open-PR age distribution histogram — B1/B4.
export function AgingChart({ buckets }) {
  if (!buckets || buckets.every((b) => b.count === 0)) return <div className="muted">No open PRs to age.</div>;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={buckets} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eaeef2" />
        <XAxis dataKey="label" tick={{ fontSize: 10.5 }} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="count" fill="#0969da" radius={[3, 3, 0, 0]} name="Open PRs" />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---- work items ----

const WI_BAR_COLORS = ['#0969da', '#1f883d', '#8250df', '#bc4c00', '#9a6700', '#cf222e', '#57606a', '#0a7ea4'];

// Generic horizontal-ish distribution bar (by type / state category / assignee).
export function WiDistributionChart({ data, nameKey = 'key', label = 'Items', height = 240 }) {
  if (!data || data.length === 0) return <div className="muted">Nothing to chart.</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eaeef2" />
        <XAxis dataKey={nameKey} tick={{ fontSize: 10.5 }} interval={0} angle={data.length > 5 ? -20 : 0} textAnchor={data.length > 5 ? 'end' : 'middle'} height={data.length > 5 ? 54 : 30} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="count" radius={[3, 3, 0, 0]} name={label}>
          {data.map((_, i) => <Cell key={i} fill={WI_BAR_COLORS[i % WI_BAR_COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Weekly created vs closed work-item throughput.
export function WiThroughputChart({ throughput }) {
  if (!throughput || throughput.length === 0) return <div className="muted">No activity in this window.</div>;
  const data = throughput.map((w) => ({ week: w.week.slice(5), created: w.created, closed: w.closed }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eaeef2" />
        <XAxis dataKey="week" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Legend />
        <Line type="monotone" dataKey="created" stroke="#0969da" strokeWidth={2} dot={{ r: 2 }} name="Created" />
        <Line type="monotone" dataKey="closed" stroke="#1f883d" strokeWidth={2} dot={{ r: 2 }} name="Closed" />
      </LineChart>
    </ResponsiveContainer>
  );
}

// Open work-item age distribution histogram.
export function WiAgingChart({ buckets }) {
  if (!buckets || buckets.every((b) => b.count === 0)) return <div className="muted">No open items to age.</div>;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={buckets} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eaeef2" />
        <XAxis dataKey="label" tick={{ fontSize: 10.5 }} />
        <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="count" fill="#8250df" radius={[3, 3, 0, 0]} name="Open items" />
      </BarChart>
    </ResponsiveContainer>
  );
}
