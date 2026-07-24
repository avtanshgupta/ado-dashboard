import { useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate, Outlet } from 'react-router-dom';
import { useConfig, useApp } from '../lib/AppContext.jsx';
import { api } from '../lib/api.js';
import { Avatar } from './ui.jsx';
import { NotificationBell } from './NotificationBell.jsx';
import { CommandPalette } from './CommandPalette.jsx';
import { KeyboardShortcuts } from './KeyboardShortcuts.jsx';
import { Tour } from './Tour.jsx';
import { BrandMark } from './BrandMark.jsx';
import { getThemePref, setThemePref } from '../lib/theme.js';
import {
  LayoutDashboard, GitPullRequest, Workflow, Settings,
  Search, Menu, Sun, Moon, Monitor, LogOut, Zap, ChevronsLeft, ChevronsRight, Compass, ClipboardList, Bot,
} from './icons.jsx';

const THEME_CYCLE = { system: 'light', light: 'dark', dark: 'system' };
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon };
const THEME_LABEL = { system: 'System', light: 'Light', dark: 'Dark' };

const NAV = [
  { to: '/', Icon: LayoutDashboard, label: 'Dashboard', end: true, tour: 'dashboard' },
  { to: '/action-center', Icon: Zap, label: 'Action Center', tour: 'action-center' },
  { to: '/pull-requests', Icon: GitPullRequest, label: 'Pull Requests', tour: 'pull-requests' },
  { to: '/work-items', Icon: ClipboardList, label: 'Work Items', tour: 'work-items' },
  { to: '/pipelines', Icon: Workflow, label: 'Pipelines', tour: 'pipelines' },
  { to: '/agents', Icon: Bot, label: 'Agents', tour: 'agents' },
  { to: '/settings', Icon: Settings, label: 'Settings', tour: 'settings' },
];

const COLLAPSE_KEY = 'ado-nav-collapsed';

export function Layout() {
  const config = useConfig();
  const { logout, reloadConfig } = useApp();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false); // mobile drawer
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [q, setQ] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState(getThemePref);
  const menuRef = useRef(null);

  function cycleTheme() {
    const next = THEME_CYCLE[theme] || 'system';
    setThemePref(next);
    setTheme(next);
  }

  async function toggleDensity() {
    const next = (config.uiPrefs?.density || 'comfortable') === 'compact' ? 'comfortable' : 'compact';
    try {
      await api.updateConfig({ uiPrefs: { density: next } });
      await reloadConfig();
    } catch {
      /* ignore — a failed toggle just leaves the current density in place */
    }
  }

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    function onClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function submitSearch(e) {
    e.preventDefault();
    if (q.trim()) navigate(`/pull-requests/search?q=${encodeURIComponent(q.trim())}`);
  }

  return (
    <div className={`app ${collapsed ? 'nav-collapsed' : ''}`}>
      <CommandPalette onLogout={logout} onCycleTheme={cycleTheme} onToggleDensity={toggleDensity} />
      <KeyboardShortcuts />
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <span className="logo"><BrandMark size={18} strokeWidth={2.2} /></span>
          <span className="brand-text">ADO Dashboard</span>
        </div>
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            title={n.label}
            data-tour={`nav-${n.tour}`}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            onClick={() => setOpen(false)}
          >
            <span className="icon"><n.Icon size={18} /></span>
            <span className="label">{n.label}</span>
            {n.badge && <span className="nav-badge">{n.badge}</span>}
          </NavLink>
        ))}
        <div className="spacer" />
        <button
          className="collapse-btn no-print"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-label="Toggle navigation"
        >
          <span className="icon">{collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}</span>
          <span className="label">Collapse</span>
        </button>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            className="icon-btn mobile-toggle"
            onClick={() => setOpen((o) => !o)}
            aria-label="Toggle navigation menu"
            aria-expanded={open}
          >
            <Menu size={18} aria-hidden="true" />
          </button>
          <form className="search" onSubmit={submitSearch} role="search" data-tour="search">
            <span className="search-icon" aria-hidden="true"><Search size={15} /></span>
            <input
              placeholder="Search pull requests & pipelines…"
              aria-label="Search pull requests and pipelines"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <kbd className="search-kbd no-print" title="Open command palette">⌘K</kbd>
          </form>
          <div className="spacer" />
          <span data-tour="notifications" style={{ display: 'inline-flex' }}><NotificationBell /></span>
          <div className="user-menu" ref={menuRef} data-tour="user-menu">
            <button
              className="me"
              onClick={() => setMenuOpen((o) => !o)}
              style={{ background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <Avatar name={config.me.displayName} imageUrl={config.me.imageUrl} />
              <span className="no-print" style={{ fontSize: 13 }}>
                {config.me.displayName}
              </span>
            </button>
            {menuOpen && (
              <div className="user-menu-pop">
                <div className="um-head">
                  <div style={{ fontWeight: 600 }}>{config.me.displayName}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{config.me.uniqueName}</div>
                </div>
                <button className="um-item" onClick={() => { setMenuOpen(false); navigate('/settings'); }}><Settings size={15} /> Settings</button>
                <button className="um-item" onClick={cycleTheme}>{(() => { const T = THEME_ICON[theme]; return <T size={15} />; })()} Theme: {THEME_LABEL[theme]}</button>
                <button className="um-item" onClick={() => { setMenuOpen(false); window.dispatchEvent(new CustomEvent('ado-start-tour')); }}><Compass size={15} /> Take a tour</button>
                <button className="um-item" onClick={() => { setMenuOpen(false); window.dispatchEvent(new CustomEvent('ado-show-shortcuts')); }}><kbd className="um-kbd">?</kbd> Keyboard shortcuts</button>
                <button className="um-item" onClick={() => { setMenuOpen(false); logout(); }}><LogOut size={15} /> Sign out</button>
              </div>
            )}
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
      <Tour />
    </div>
  );
}
