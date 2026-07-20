import { Target, Calendar, AlertCircle, CheckCircle2 } from './icons.jsx';

export function PlanSummaryCards({ summary }) {
  if (!summary) return null;

  const cards = [
    { icon: Target, label: 'Due Today', value: summary.daily.total - summary.daily.done, color: 'var(--blue)' },
    { icon: Calendar, label: 'Weekly Goals', value: summary.weekly.total - summary.weekly.done, color: 'var(--purple, #7c3aed)' },
    { icon: AlertCircle, label: 'Blocked', value: summary.daily.blocked + summary.weekly.blocked, color: 'var(--red)' },
    { icon: CheckCircle2, label: 'Completed Today', value: summary.daily.done, color: 'var(--green)' },
  ];

  return (
    <div className="plan-summary-cards">
      {cards.map((c) => (
        <div key={c.label} className="summary-card">
          <div className="summary-card-icon" style={{ color: c.color }}><c.icon size={20} /></div>
          <div className="summary-card-body">
            <span className="summary-card-value">{c.value}</span>
            <span className="summary-card-label">{c.label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
