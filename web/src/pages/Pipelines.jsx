import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Play, History } from '../components/icons.jsx';

const SUBTABS = [
  { to: '/pipelines', label: 'Overview', Icon: LayoutDashboard, end: true },
  { to: '/pipelines/trigger', label: 'Trigger a run', Icon: Play },
  { to: '/pipelines/runs', label: 'Runs', Icon: History },
];

export function Pipelines() {
  return (
    <div>
      <div className="subtabs no-print" data-tour="pipeline-subtabs">
        {SUBTABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end}
            className={({ isActive }) => `subtab ${isActive ? 'active' : ''}`}>
            <t.Icon size={15} /> {t.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
