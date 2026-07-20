import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useConfig, useApp } from '../lib/AppContext.jsx';
import { repoShort } from '../lib/format.js';
import { TimeAgo } from './ui.jsx';
import {
  Bell, GitPullRequest, MessageSquare, Eye, XCircle, CheckCircle2,
  GitMerge, Info, PartyPopper,
} from './icons.jsx';

const TYPE_ICON = {
  'new-pr': GitPullRequest,
  'new-comment': MessageSquare,
  'review-change': Eye,
  'pipeline-failed': XCircle,
  'pipeline-succeeded': CheckCircle2,
  'pr-closed': GitMerge,
};

const TYPE_LABEL = {
  'new-pr': 'New PRs',
  'new-comment': 'Comments',
  'review-change': 'Review changes',
  'pipeline-failed': 'Pipeline failures',
  'pipeline-succeeded': 'Pipeline successes',
  'pr-closed': 'Closed',
};

// Fallback poll cadence when SSE is unavailable.
const POLL_MS = 120000;

/** Raise a desktop notification for new items (C2), when enabled + permitted. */
function pushDesktop(newItems) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (!newItems || !newItems.length) return;
  const first = newItems[0];
  const body = newItems.length === 1 ? first.message : `${first.message} (+${newItems.length - 1} more)`;
  try {
    const n = new Notification('ADO Dashboard', { body, tag: 'ado-dashboard' });
    n.onclick = () => { window.focus(); if (first.webUrl) window.open(first.webUrl, '_blank', 'noopener'); };
  } catch { /* some browsers throw outside a user gesture — ignore */ }
}

export function NotificationBell() {
  const navigate = useNavigate();
  const config = useConfig();
  const { reloadConfig } = useApp();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [filterType, setFilterType] = useState('all');
  const [filterRepo, setFilterRepo] = useState('all');
  const ref = useRef(null);
  const pushEnabled = !!(config && config.notificationPrefs && config.notificationPrefs.browserPush);

  const load = useCallback(async () => {
    try {
      const res = await api.notifications();
      setItems(res.items || []);
      setUnread(res.unread || 0);
    } catch { /* transient — keep last known state */ }
  }, []);

  const doPoll = useCallback(async () => {
    try {
      const res = await api.poll();
      setUnread(res.unread || 0);
      if (res.newItems && res.newItems.length) { await load(); if (pushEnabled) pushDesktop(res.newItems); }
    } catch { /* transient — try again next tick */ }
  }, [load, pushEnabled]);

  // Ask for desktop-notification permission once the user has opted in (C2).
  useEffect(() => {
    if (pushEnabled && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, [pushEnabled]);

  // Live updates via SSE (C1); fall back to interval polling if it fails.
  useEffect(() => {
    load();
    let es = null;
    let pollTimer = null;
    let stopped = false;

    const startPolling = () => {
      if (pollTimer || stopped) return;
      doPoll();
      pollTimer = setInterval(doPoll, POLL_MS);
    };

    if (typeof EventSource !== 'undefined') {
      try {
        es = new EventSource('/api/stream', { withCredentials: true });
        es.addEventListener('notifications', (ev) => {
          try {
            const data = JSON.parse(ev.data);
            setUnread(data.unread || 0);
            if (data.newItems && data.newItems.length) { load(); if (pushEnabled) pushDesktop(data.newItems); }
          } catch { /* ignore malformed frame */ }
        });
        es.addEventListener('auth', () => {
          window.dispatchEvent(new CustomEvent('ado-auth-expired', { detail: { code: 'token_expired' } }));
        });
        es.onerror = () => {
          if (es) { es.close(); es = null; }
          startPolling();
        };
      } catch {
        startPolling();
      }
    } else {
      startPolling();
    }

    return () => {
      stopped = true;
      if (es) es.close();
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [load, doPoll, pushEnabled]);

  // Close on outside click.
  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) await load();
  }

  async function markAllRead() {
    try {
      const res = await api.markRead([]);
      setItems(res.items || []);
      setUnread(res.unread || 0);
    } catch { /* ignore */ }
  }

  async function muteRepo(repo) {
    const muted = config.mutedRepos || [];
    if (muted.some((r) => r.toLowerCase() === repo.toLowerCase())) return;
    try {
      await api.updateConfig({ mutedRepos: [...muted, repo] });
      await reloadConfig();
    } catch { /* ignore */ }
  }

  async function unmuteRepo(repo) {
    try {
      await api.updateConfig({ mutedRepos: (config.mutedRepos || []).filter((r) => r.toLowerCase() !== repo.toLowerCase()) });
      await reloadConfig();
    } catch { /* ignore */ }
  }

  async function openItem(item) {
    try {
      if (!item.read) {
        const res = await api.markRead([item.id]);
        setItems(res.items || []);
        setUnread(res.unread || 0);
      }
    } catch { /* still navigate even if marking failed */ }
    setOpen(false);
    if (item.repo && item.prId) navigate(`/pr/${encodeURIComponent(item.repo)}/${item.prId}`);
    else if (item.webUrl) window.open(item.webUrl, '_blank', 'noopener');
  }

  const hasUnread = items.some((i) => !i.read);
  const repos = [...new Set(items.map((i) => i.repo).filter(Boolean))];
  const types = [...new Set(items.map((i) => i.type).filter(Boolean))];
  const filtered = items.filter(
    (i) => (filterType === 'all' || i.type === filterType) && (filterRepo === 'all' || i.repo === filterRepo)
  );
  const mutedRepos = (config && config.mutedRepos) || [];

  return (
    <div className="notif" ref={ref}>
      <button
        className="icon-btn"
        onClick={toggle}
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Notifications"
      >
        <Bell size={18} aria-hidden="true" />
        {unread > 0 && <span className="badge-dot">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="notif-pop" role="menu">
          <div className="notif-head">
            <strong>Notifications</strong>
            {hasUnread && (
              <button className="btn sm" onClick={markAllRead}>Mark all read</button>
            )}
          </div>
          {items.length > 0 && (
            <div className="notif-filters no-print">
              <select value={filterType} onChange={(e) => setFilterType(e.target.value)} aria-label="Filter by type">
                <option value="all">All types</option>
                {types.map((t) => <option key={t} value={t}>{TYPE_LABEL[t] || t}</option>)}
              </select>
              <select value={filterRepo} onChange={(e) => setFilterRepo(e.target.value)} aria-label="Filter by repository">
                <option value="all">All repos</option>
                {repos.map((r) => <option key={r} value={r}>{repoShort(r)}</option>)}
              </select>
            </div>
          )}
          {mutedRepos.length > 0 && (
            <div className="notif-muted no-print">
              Muted: {mutedRepos.map((r) => (
                <button key={r} className="badge repo muted-chip" title="Click to unmute" onClick={() => unmuteRepo(r)}>{repoShort(r)} ✕</button>
              ))}
            </div>
          )}
          <div className="notif-list">
            {filtered.length === 0 ? (
              <div className="notif-empty muted"><PartyPopper size={16} /> {items.length ? 'No matching notifications' : "You're all caught up"}</div>
            ) : (
              filtered.slice(0, 50).map((item) => {
                const TypeIcon = TYPE_ICON[item.type] || Info;
                return (
                  <div key={item.id} className={`notif-item ${item.read ? '' : 'unread'}`}>
                    <button className="notif-item-main" onClick={() => openItem(item)} role="menuitem">
                      <span className="notif-icon" aria-hidden="true"><TypeIcon size={16} /></span>
                      <span className="notif-content">
                        <span className="notif-msg">{item.message}</span>
                        <span className="notif-meta muted">
                          <span className="badge repo">{repoShort(item.repo)}</span>
                          <TimeAgo date={item.timestamp} prefix="· " />
                        </span>
                      </span>
                      {!item.read && <span className="notif-dot" aria-hidden="true" />}
                    </button>
                    {item.repo && (
                      <button className="notif-mute" title={`Mute ${item.repo}`} onClick={() => muteRepo(item.repo)} aria-label={`Mute ${item.repo}`}>
                        mute
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
