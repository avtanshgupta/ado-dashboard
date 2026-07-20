import { NavLink, Outlet, Link } from 'react-router-dom';
import { LayoutDashboard, Eye, ClipboardList, Users, Bell, CalendarClock, ListFilter, Plus } from '../components/icons.jsx';

const SUBTABS = [
  { to: '/work-items', label: 'Overview', Icon: LayoutDashboard, end: true },
  { to: '/work-items/assigned', label: 'Assigned to Me', Icon: Eye },
  { to: '/work-items/created', label: 'Created by Me', Icon: ClipboardList },
  { to: '/work-items/team', label: 'Team', Icon: Users },
  { to: '/work-items/following', label: 'Following', Icon: Bell },
  { to: '/work-items/sprint', label: 'Current Sprint', Icon: CalendarClock },
  { to: '/work-items/queries', label: 'Queries', Icon: ListFilter },
];

export function WorkItems() {
  return (
    <div>
      <div className="subtabs no-print" style={{ display: 'flex', alignItems: 'center' }} data-tour="wi-subtabs">
        {SUBTABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `subtab ${isActive ? 'active' : ''}`}>
            <t.Icon size={15} /> {t.label}
          </NavLink>
        ))}
        <div style={{ flex: 1 }} />
        <Link to="/work-items/new" className="btn sm primary" style={{ marginLeft: 8 }}><Plus size={14} /> New Work Item</Link>
      </div>
      <Outlet />
    </div>
  );
}
