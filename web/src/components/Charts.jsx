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
