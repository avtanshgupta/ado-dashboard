import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import {
  Zap, LayoutDashboard, GitPullRequestArrow, Eye, UserCheck, Users,
  Workflow, Settings, Search, Sun, LogOut, RefreshCw, ClipboardList, CalendarClock,
  Bot, Play, SlidersHorizontal,
} from './icons.jsx';
import { trapFocus } from './focusTrap.js';

/**
 * ⌘K / Ctrl-K command palette: instant navigation + free-text search, fully
 * keyboard-driven (↑/↓ to move, ↵ to run, Esc to close). Mounted once globally so
 * it works from any page. Typing anything offers a "search PRs & pipelines" jump.
 */
export function CommandPalette({ onLogout, onCycleTheme, onToggleDensity }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const dialogRef = useRef(null);
  const restoreRef = useRef(null);

  const baseCommands = useMemo(
    () => [
      { id: 'ac', label: 'Go to Action Center', hint: 'what needs you', Icon: Zap, run: () => navigate('/action-center') },
      { id: 'overview', label: 'Go to Dashboard', hint: 'dashboard home', Icon: LayoutDashboard, run: () => navigate('/') },
      { id: 'created', label: 'My Pull Requests', hint: 'PRs I authored', Icon: GitPullRequestArrow, run: () => navigate('/pull-requests/created') },
      { id: 'pr-new', label: 'New Pull Request', hint: 'create a PR', Icon: GitPullRequestArrow, run: () => navigate('/pull-requests/new') },
      { id: 'assigned', label: 'Assigned to Me', hint: 'PRs to review', Icon: Eye, run: () => navigate('/pull-requests/assigned') },
      { id: 'assignedTeam', label: 'Assigned to Team', hint: 'group review', Icon: UserCheck, run: () => navigate('/pull-requests/assigned-team') },
      { id: 'team', label: 'Team Pull Requests', hint: 'authored by team', Icon: Users, run: () => navigate('/pull-requests/team') },
      { id: 'workitems', label: 'Go to Work Items', hint: 'overview & rollup', Icon: ClipboardList, run: () => navigate('/work-items') },
      { id: 'wi-assigned', label: 'Work Items Assigned to Me', hint: 'my work items', Icon: Eye, run: () => navigate('/work-items/assigned') },
      { id: 'wi-created', label: 'Work Items I Created', hint: 'items I opened', Icon: ClipboardList, run: () => navigate('/work-items/created') },
      { id: 'wi-sprint', label: 'Current Sprint', hint: 'active iteration', Icon: CalendarClock, run: () => navigate('/work-items/sprint') },
      { id: 'wi-new', label: 'New Work Item', hint: 'create a work item', Icon: ClipboardList, run: () => navigate('/work-items/new') },
      { id: 'pipelines', label: 'Go to Pipelines', hint: 'runs & analytics', Icon: Workflow, run: () => navigate('/pipelines') },
      { id: 'pl-trigger', label: 'Trigger a Pipeline', hint: 'run a build', Icon: Play, run: () => navigate('/pipelines/trigger') },
      { id: 'agents', label: 'Go to Agents', hint: 'Copilot sessions', Icon: Bot, run: () => navigate('/agents') },
      { id: 'settings', label: 'Go to Settings', hint: 'repos, team, prefs', Icon: Settings, run: () => navigate('/settings') },
      { id: 'refresh', label: 'Refresh current data', hint: 'clear cache & reload', Icon: RefreshCw, run: async () => { try { await api.refresh(); } catch { /* ignore */ } window.location.reload(); } },
      { id: 'density', label: 'Toggle table density', hint: 'compact / comfortable', Icon: SlidersHorizontal, run: () => onToggleDensity?.() },
      { id: 'theme', label: 'Toggle theme', hint: 'light / dark / system', Icon: Sun, run: () => onCycleTheme?.() },
      { id: 'logout', label: 'Sign out', hint: 'end session', Icon: LogOut, run: () => onLogout?.() },
    ],
    [navigate, onCycleTheme, onLogout, onToggleDensity]
  );

  const commands = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return baseCommands;
    const matched = baseCommands.filter(
      (c) => c.label.toLowerCase().includes(term) || (c.hint || '').toLowerCase().includes(term)
    );
    const extras = [];
    // A bare number → jump straight to that work item.
    const num = q.trim().replace(/^#/, '');
    if (/^\d+$/.test(num)) {
      extras.push({ id: 'wi-goto', label: `Open work item #${num}`, Icon: ClipboardList, run: () => navigate(`/work-item/${num}`) });
    }
    const searchCmd = {
      id: 'search',
      label: `Search PRs & pipelines for “${q.trim()}”`,
      Icon: Search,
      run: () => navigate(`/pull-requests/search?q=${encodeURIComponent(q.trim())}`),
    };
    return [...extras, searchCmd, ...matched];
  }, [q, baseCommands, navigate]);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    function onKey(e) {
      const k = e.key?.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === 'k') {
        e.preventDefault();
        setOpen((o) => {
          if (!o) restoreRef.current = document.activeElement;
          return !o;
        });
      } else if (e.key === 'Escape') {
        close();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActive(0);
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
    restoreRef.current?.focus?.();
    restoreRef.current = null;
    return undefined;
  }, [open]);

  useEffect(() => setActive(0), [q]);

  // Keep the highlighted item scrolled into view while arrowing through a long
  // list (block:'nearest' scrolls only the list container, minimally).
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector('.cmdk-item.active');
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const run = useCallback((cmd) => {
    if (!cmd) return;
    close();
    cmd.run();
  }, [close]);

  if (!open) return null;

  function onInputKey(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, commands.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(commands[active]);
    }
  }

  return (
    <div className="cmdk-backdrop" onClick={close}>
      <div
        className="cmdk"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => trapFocus(dialogRef.current, e)}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        tabIndex={-1}
      >
        <div className="cmdk-input-row">
          <Search size={16} aria-hidden="true" />
          <input
            ref={inputRef}
            className="cmdk-input"
            placeholder="Type a command or search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
            aria-label="Command or search"
            aria-controls="command-palette-list"
            aria-activedescendant={commands[active] ? `command-${commands[active].id}` : undefined}
          />
        </div>
        <div className="cmdk-list" ref={listRef} id="command-palette-list" role="listbox" aria-label="Commands">
          {commands.length === 0 && <div className="cmdk-empty muted">No matching commands</div>}
          {commands.map((c, i) => (
            <button
              key={c.id}
              id={`command-${c.id}`}
              type="button"
              className={`cmdk-item ${i === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(c)}
              role="option"
              aria-selected={i === active}
            >
              <span className="cmdk-item-icon"><c.Icon size={15} aria-hidden="true" /></span>
              <span className="cmdk-item-label">{c.label}</span>
              {c.hint && <span className="cmdk-item-hint muted">{c.hint}</span>}
            </button>
          ))}
        </div>
        <div className="cmdk-foot muted">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
