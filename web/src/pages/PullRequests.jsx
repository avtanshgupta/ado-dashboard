import { NavLink, Outlet, Link } from 'react-router-dom';
import { LayoutList, GitPullRequestArrow, Eye, UserCheck, Users, Plus } from '../components/icons.jsx';

const SUBTABS = [
  { to: '/pull-requests', label: 'Overview', Icon: LayoutList, end: true },
  { to: '/pull-requests/created', label: 'My Pull Requests', Icon: GitPullRequestArrow },
  { to: '/pull-requests/assigned', label: 'Assigned to Me', Icon: Eye },
  { to: '/pull-requests/assigned-team', label: 'Assigned to Team', Icon: UserCheck },
  { to: '/pull-requests/team', label: 'Authored By Team', Icon: Users },
];

export function PullRequests() {
  return (
    <div>
      <div className="subtabs no-print" style={{ display: 'flex', alignItems: 'center' }} data-tour="pr-subtabs">
        {SUBTABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) => `subtab ${isActive ? 'active' : ''}`}
          >
            <t.Icon size={15} /> {t.label}
          </NavLink>
        ))}
        <div style={{ flex: 1 }} />
        <Link to="/pull-requests/new" className="btn sm primary" style={{ marginLeft: 8 }}><Plus size={14} /> New PR</Link>
      </div>
      <Outlet />
    </div>
  );
}
