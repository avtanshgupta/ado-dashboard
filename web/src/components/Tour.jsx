import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useConfig, useApp } from '../lib/AppContext.jsx';
import { api } from '../lib/api.js';
import {
  Rocket, LayoutDashboard, Zap, GitPullRequest, GitMerge, Workflow, Settings as SettingsIcon,
  Search, Bell, PartyPopper, ChevronLeft, ChevronRight, X, ClipboardList, ListFilter,
} from './icons.jsx';

// Each step optionally navigates to `route`, then spotlights the element carrying
// [data-tour="anchor"]. Anchors on persistent chrome (nav, topbar) are always
// present; page anchors are located after navigation with a short retry. Steps
// marked `optional` are skipped when their anchor isn't on screen.
const STEPS = [
  {
    key: 'welcome',
    Icon: Rocket,
    title: 'Welcome to your ADO Dashboard',
    body: 'One place for your Azure DevOps work — pull requests, pipelines, and work items — across every project you track. This quick tour shows where everything lives. It takes about a minute.',
  },
  {
    key: 'dashboard',
    route: '/',
    anchor: 'nav-dashboard',
    Icon: LayoutDashboard,
    title: 'Dashboard — your command center',
    body: 'Start here each day. Cross-domain tiles surface what needs you across pull requests, pipelines, and work items — followed by a prioritized “needs your attention” list and a summary card for each domain.',
  },
  {
    key: 'action-center',
    route: '/action-center',
    anchor: 'nav-action-center',
    Icon: Zap,
    title: 'Action Center',
    body: 'A single prioritized inbox of everything that needs action — ordered by urgency, with staleness flags so nothing slips through. Follow, snooze, or dismiss each item.',
  },
  {
    key: 'pull-requests',
    route: '/pull-requests',
    anchor: 'nav-pull-requests',
    Icon: GitPullRequest,
    title: 'Pull requests',
    body: 'Browse PRs you created, ones assigned to you or your team, and an Overview with analytics. Rich filters — repo, label, multi-select state, time range — plus sortable columns keep long lists manageable.',
  },
  {
    key: 'handle-prs',
    route: '/pull-requests/assigned',
    anchor: 'pr-subtabs',
    Icon: GitMerge,
    title: 'Handle a PR end-to-end',
    body: 'Open any PR to read the diff, vote (approve / wait / reject), comment with saved templates, add reviewers, link work items, and complete the merge — all without leaving the dashboard.',
  },
  {
    key: 'work-items',
    route: '/work-items',
    anchor: 'nav-work-items',
    Icon: ClipboardList,
    title: 'Work items',
    body: 'Track bugs, stories, tasks and features across every configured project. Create and edit inline — change state, reassign, edit tags and fields, comment, and link related items and pull requests.',
  },
  {
    key: 'work-items-tabs',
    route: '/work-items',
    anchor: 'wi-subtabs',
    optional: true,
    Icon: ClipboardList,
    title: 'Work item views',
    body: 'An Overview with rollups and charts, plus Assigned to Me, Created by Me, Team, Following, the current Sprint, and your saved ADO queries — each a filterable, exportable list.',
  },
  {
    key: 'filters',
    route: '/work-items/assigned',
    anchor: 'list-filters',
    optional: true,
    Icon: ListFilter,
    title: 'Filter, sort & instant loads',
    body: 'Multi-select facets (type, state, assignee, area, iteration, tags…), sortable columns, saved views and CSV export work across every list. Pages open instantly from cache and refresh in the background — watch for the “Updating…” pill.',
  },
  {
    key: 'pipelines',
    route: '/pipelines',
    anchor: 'nav-pipelines',
    Icon: Workflow,
    title: 'Pipelines & builds',
    body: 'Explore builds under the Overview, kick one off from “Trigger a run”, and browse Runs history. Open any run to watch its stages and read logs live.',
  },
  {
    key: 'search',
    anchor: 'search',
    Icon: Search,
    title: 'Search & command palette',
    body: 'Find any PR or pipeline from the search box. Press ⌘K (Ctrl-K) anywhere for the command palette — jump to any area, or type a work item number to open it directly.',
  },
  {
    key: 'notifications',
    anchor: 'notifications',
    Icon: Bell,
    title: 'Real-time notifications',
    body: 'The bell lights up when something you care about changes — new votes, comments, or finished builds. Tune what you’re notified about, and enable browser push, from Settings.',
  },
  {
    key: 'settings',
    route: '/settings',
    anchor: 'settings-nav',
    Icon: SettingsIcon,
    title: 'Configure your workspace',
    body: 'Settings are grouped into sections — General (monitored projects, repositories, time window, SLA, density), Team & Reviewers, Pipelines, Work Items (saved queries), Notifications, and templates. Add projects, repos and pipelines by pasting their URL; everything here is personal to you.',
  },
  {
    key: 'finish',
    Icon: PartyPopper,
    title: 'You’re all set!',
    body: 'That’s the whole app. A great first step is reviewing your monitored projects and adding repositories in Settings. Replay this tour anytime from the profile menu.',
    finishTo: '/settings',
    finishLabel: 'Go to Settings',
  },
];

const CARD_W = 344;

function placeCard(rect, size, vw, vh) {
  const gap = 14;
  const { w, h } = size;
  if (!rect) return { left: Math.max(gap, (vw - w) / 2), top: Math.max(gap, (vh - h) / 2) };
  let left;
  let top;
  const spaceRight = vw - rect.right;
  if (rect.left < 300 && spaceRight > w + gap + 12) {
    left = rect.right + gap; // sidebar anchor → to the right
    top = rect.top;
  } else if (rect.bottom + gap + h < vh) {
    left = rect.left; // below
    top = rect.bottom + gap;
  } else if (rect.top - gap - h > 0) {
    left = rect.left; // above
    top = rect.top - gap - h;
  } else {
    left = rect.right + gap;
    top = rect.top;
  }
  left = Math.min(Math.max(gap, left), vw - w - gap);
  top = Math.min(Math.max(gap, top), vh - h - gap);
  return { left, top };
}

export function Tour() {
  const config = useConfig();
  const { reloadConfig } = useApp();
  const navigate = useNavigate();

  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState(null);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });
  const cardRef = useRef(null);
  const dirRef = useRef(1);
  const autoStartedRef = useRef(false);

  const step = STEPS[index];
  const isLast = index === STEPS.length - 1;

  const finish = useCallback(
    async (goto) => {
      setActive(false);
      setIndex(0);
      setRect(null);
      if (goto) navigate(goto);
      try {
        await api.updateConfig({ uiPrefs: { onboarded: true } });
        await reloadConfig();
      } catch {
        /* tour still closes; will simply offer again next load */
      }
    },
    [navigate, reloadConfig]
  );

  const next = useCallback(() => {
    dirRef.current = 1;
    setIndex((i) => Math.min(STEPS.length - 1, i + 1));
  }, []);
  const back = useCallback(() => {
    dirRef.current = -1;
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  // Auto-start once for a first-time user (uiPrefs.onboarded === false).
  useEffect(() => {
    if (autoStartedRef.current || active) return undefined;
    if (config?.uiPrefs && config.uiPrefs.onboarded === false) {
      autoStartedRef.current = true;
      const t = setTimeout(() => { setIndex(0); setActive(true); }, 650);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [config, active]);

  // Manual (re)start from the profile menu.
  useEffect(() => {
    function onStart() { autoStartedRef.current = true; setIndex(0); setActive(true); }
    window.addEventListener('ado-start-tour', onStart);
    return () => window.removeEventListener('ado-start-tour', onStart);
  }, []);

  // Locate the current step's anchor (navigating first if needed), retrying a
  // few frames while a freshly-routed page mounts.
  useEffect(() => {
    if (!active) return undefined;
    const s = STEPS[index];
    if (s.route && window.location.pathname !== s.route) navigate(s.route);

    let raf = 0;
    let tries = 0;
    let cancelled = false;
    setRect(null);

    const find = () => {
      if (cancelled) return;
      if (!s.anchor) { setRect(null); return; }
      const el = document.querySelector(`[data-tour="${s.anchor}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          setRect(el.getBoundingClientRect());
          return;
        }
      }
      tries += 1;
      if (tries > 45) {
        if (s.optional) { (dirRef.current < 0 ? back : next)(); return; }
        setRect(null); // centered fallback
        return;
      }
      raf = requestAnimationFrame(find);
    };
    raf = requestAnimationFrame(find);
    return () => { cancelled = true; if (raf) cancelAnimationFrame(raf); };
  }, [index, active, navigate, next, back]);

  // Keep the spotlight glued to the anchor on resize/scroll.
  useEffect(() => {
    if (!active || !step.anchor) return undefined;
    const remeasure = () => {
      const el = document.querySelector(`[data-tour="${step.anchor}"]`);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) setRect(r);
      }
    };
    window.addEventListener('resize', remeasure);
    window.addEventListener('scroll', remeasure, true);
    return () => {
      window.removeEventListener('resize', remeasure);
      window.removeEventListener('scroll', remeasure, true);
    };
  }, [active, step.anchor]);

  // Position the card once we know both the anchor rect and the card size.
  useLayoutEffect(() => {
    if (!active) return;
    const card = cardRef.current;
    const size = { w: card ? card.offsetWidth : CARD_W, h: card ? card.offsetHeight : 200 };
    setPos(placeCard(rect, size, window.innerWidth, window.innerHeight));
  }, [rect, active, index]);

  // Keyboard controls.
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(); }
      else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); isLast ? finish(step.finishTo) : next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, isLast, step, next, back, finish]);

  if (!active) return null;
  const StepIcon = step.Icon;

  return createPortal(
    <div className="tour-root" role="dialog" aria-modal="true" aria-label="Product tour">
      <div className="tour-blocker" />
      {rect ? (
        <div
          className="tour-spot"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      ) : (
        <div className="tour-dim-full" />
      )}
      <div className="tour-card" ref={cardRef} style={{ top: pos.top, left: pos.left }}>
        <div className="tour-card-head">
          <span className="tour-ic"><StepIcon size={18} /></span>
          <strong className="tour-title">{step.title}</strong>
          <button className="tour-x" onClick={() => finish()} aria-label="Close tour"><X size={16} /></button>
        </div>
        <p className="tour-body">{step.body}</p>
        <div className="tour-foot">
          <div className="tour-dots" aria-hidden="true">
            {STEPS.map((s, i) => <span key={s.key} className={`tour-dot ${i === index ? 'on' : ''}`} />)}
          </div>
          <div className="tour-btns">
            <span className="tour-count">{index + 1} / {STEPS.length}</span>
            {index > 0 && <button className="btn sm" onClick={back}><ChevronLeft size={14} /> Back</button>}
            {isLast ? (
              <button className="btn sm primary" onClick={() => finish(step.finishTo)}>{step.finishLabel || 'Finish'}</button>
            ) : (
              <button className="btn sm primary" onClick={next}>Next <ChevronRight size={14} /></button>
            )}
          </div>
        </div>
        {!isLast && <button className="tour-skip" onClick={() => finish()}>Skip tour</button>}
      </div>
    </div>,
    document.body
  );
}
