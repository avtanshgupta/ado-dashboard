import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useConfig } from '../lib/AppContext.jsx';
import { useAsync } from '../lib/useAsync.js';
import { api } from '../lib/api.js';
import { Loading, RefreshingTag } from '../components/ui.jsx';
import {
  LayoutDashboard, Zap, Eye, GitPullRequest, ClipboardList, Workflow, Bot,
  RefreshCw, SlidersHorizontal, ChevronRight, ArrowUp, ArrowDown, TriangleAlert, Check,
} from '../components/icons.jsx';
import { resolveLayout, toSaved, moveWidget, toggleWidget, MY_WORK_WIDGETS } from '../lib/myWorkLayout.js';

const LAYOUT_KEY = 'ado-mywork-layout';

function loadLayout() {
  try { return resolveLayout(JSON.parse(localStorage.getItem(LAYOUT_KEY))); }
  catch { return resolveLayout(null); }
}
function persistLayout(layout) {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(toSaved(layout))); } catch { /* ignore */ }
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** Card shell shared by every widget. */
function Widget({ title, Icon, to, viewLabel, revalidating, children }) {
  return (
    <section className="mywork-widget card">
      <div className="mywork-widget-head">
        <h3><Icon size={16} /> {title}</h3>
        <RefreshingTag show={revalidating} />
        {to && <Link className="mywork-viewall" to={to}>{viewLabel || 'View all'} <ChevronRight size={13} /></Link>}
      </div>
      <div className="mywork-widget-body">{children}</div>
    </section>
  );
}

function CountLine({ n, singular, plural, done }) {
  if (n === 0) return <div className="mywork-empty">{done}</div>;
  return <div className="mywork-count"><strong>{n}</strong> {n === 1 ? singular : (plural || `${singular}s`)}</div>;
}

function PrRow({ pr }) {
  return (
    <Link className="mywork-row" to={`/pr/${encodeURIComponent(pr.repo)}/${pr.id}`}>
      <span className="mywork-row-title">{pr.title}</span>
      <span className="mywork-row-meta muted">{pr.repo}{pr.reason ? ` · ${pr.reason}` : ''}</span>
    </Link>
  );
}

function AttentionWidget() {
  const { data, loading, revalidating } = useAsync(() => api.actionCenter(), [], { pollMs: 90000, cacheKey: 'action-center' });
  const items = data?.items || [];
  return (
    <Widget title="Needs my attention" Icon={Zap} to="/action-center" revalidating={revalidating}>
      {loading && !data ? <Loading label="Loading…" /> : (
        <>
          <CountLine n={data?.counts?.total ?? items.length} singular="item needs you" plural="items need you" done="You're all caught up 🎉" />
          {items.slice(0, 5).map((it) => <PrRow key={`${it.repo}#${it.id}`} pr={it} />)}
        </>
      )}
    </Widget>
  );
}

function MyPrsWidget() {
  const { data, loading, revalidating } = useAsync(() => api.created(), [], { pollMs: 90000, cacheKey: 'pr:list:created:active' });
  const prs = data || [];
  return (
    <Widget title="My open pull requests" Icon={GitPullRequest} to="/pull-requests/created" revalidating={revalidating}>
      {loading && !data ? <Loading label="Loading…" /> : (
        <>
          <CountLine n={prs.length} singular="open PR" done="No open PRs." />
          {prs.slice(0, 5).map((pr) => <PrRow key={`${pr.repo}#${pr.id}`} pr={pr} />)}
        </>
      )}
    </Widget>
  );
}

function ReviewPrsWidget() {
  const { data, loading, revalidating } = useAsync(() => api.assigned('me'), [], { pollMs: 90000, cacheKey: 'pr:list:assigned:active' });
  const prs = data || [];
  const pending = prs.filter((pr) => !pr.myVote || pr.myVote === 0);
  return (
    <Widget title="Pull requests to review" Icon={Eye} to="/pull-requests/assigned" revalidating={revalidating}>
      {loading && !data ? <Loading label="Loading…" /> : (
        <>
          <CountLine n={pending.length} singular="PR awaiting your review" plural="PRs awaiting your review" done="No PRs awaiting your review." />
          {pending.slice(0, 5).map((pr) => <PrRow key={`${pr.repo}#${pr.id}`} pr={pr} />)}
        </>
      )}
    </Widget>
  );
}

function AtRiskWiWidget() {
  const config = useConfig();
  const slaDays = config?.slaDays || 7;
  const { data, loading, revalidating } = useAsync(() => api.wiList('assigned'), [], { pollMs: 120000, cacheKey: 'wi:list:assigned:' });
  const atRisk = useMemo(() => {
    const items = data || [];
    return items
      .filter((wi) => (wi.idleDays ?? 0) >= slaDays && wi.state !== 'Closed' && wi.state !== 'Resolved' && wi.state !== 'Done')
      .sort((a, b) => (b.idleDays ?? 0) - (a.idleDays ?? 0));
  }, [data, slaDays]);
  return (
    <Widget title="At-risk work items" Icon={ClipboardList} to="/work-items/assigned" revalidating={revalidating}>
      {loading && !data ? <Loading label="Loading…" /> : (
        <>
          <CountLine n={atRisk.length} singular={`item idle ≥ ${slaDays}d`} plural={`items idle ≥ ${slaDays}d`} done={`Nothing idle beyond ${slaDays} days.`} />
          {atRisk.slice(0, 5).map((wi) => (
            <Link key={wi.id} className="mywork-row" to={`/work-item/${wi.id}`}>
              <span className="mywork-row-title">{wi.title}</span>
              <span className="mywork-row-meta muted">#{wi.id} · idle {wi.idleDays}d · {wi.state}</span>
            </Link>
          ))}
        </>
      )}
    </Widget>
  );
}

function PipelinesWidget() {
  const { data, loading, revalidating } = useAsync(() => api.pipelineOverview(), [], { pollMs: 120000, cacheKey: 'pl:overview:dash' });
  const failing = useMemo(() => {
    const all = [...(data?.active || []), ...(data?.recent || [])];
    const seen = new Set();
    return all.filter((r) => {
      if (String(r.result).toLowerCase() !== 'failed') return false;
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
  }, [data]);
  return (
    <Widget title="Failing pipelines" Icon={Workflow} to="/pipelines" revalidating={revalidating}>
      {loading && !data ? <Loading label="Loading…" /> : (
        <>
          <CountLine n={failing.length} singular="recent failed run" done="No recent failures 🎉" />
          {failing.slice(0, 5).map((r) => (
            <Link key={r.id} className="mywork-row" to={`/pipelines/run/${r.id}`}>
              <span className="mywork-row-title">{r.definitionName}</span>
              <span className="mywork-row-meta muted">{r.repo} · {r.branch}</span>
            </Link>
          ))}
        </>
      )}
    </Widget>
  );
}

function AgentsWidget() {
  const { data, loading, revalidating } = useAsync(() => api.agentOverview(), [], { pollMs: 60000, cacheKey: 'agents:dashboard' });
  const live = data?.liveSessions ?? 0;
  return (
    <Widget title="Live agent sessions" Icon={Bot} to="/agents" revalidating={revalidating}>
      {loading && !data ? <Loading label="Loading…" /> : (
        <>
          <CountLine n={live} singular="live session" done="No live agent sessions." />
          {live > 0 && (
            <div className="mywork-agent-line muted">
              {data.active} active · {data.idle} idle · {data.machinesOnline}/{data.totalMachines} machines online
              {data.longRunning ? ` · ${data.longRunning} long-running` : ''}
            </div>
          )}
        </>
      )}
    </Widget>
  );
}

const WIDGET_COMPONENTS = {
  attention: AttentionWidget,
  myPrs: MyPrsWidget,
  reviewPrs: ReviewPrsWidget,
  atRiskWi: AtRiskWiWidget,
  pipelines: PipelinesWidget,
  agents: AgentsWidget,
};

export function MyWork() {
  const config = useConfig();
  const [layout, setLayout] = useState(loadLayout);
  const [editing, setEditing] = useState(false);
  const [nonce, setNonce] = useState(0); // bump to force a re-fetch of all widgets

  useEffect(() => { persistLayout(layout); }, [layout]);

  const firstName = (config.me?.displayName || '').split(' ')[0];
  const visible = layout.filter((w) => !w.hidden);

  return (
    <div>
      <div className="dash-head">
        <div>
          <h2 className="section-title" style={{ margin: 0 }}><LayoutDashboard size={20} /> {greeting()}, {firstName}</h2>
          <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>Your personalized work summary across pull requests, work items, pipelines and agents.</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={() => setEditing((e) => !e)} title="Customize widgets">
            <SlidersHorizontal size={14} /> {editing ? 'Done' : 'Customize'}
          </button>
          <button className="btn sm" onClick={() => setNonce((n) => n + 1)} title="Refresh all widgets"><RefreshCw size={14} /> Refresh</button>
        </div>
      </div>

      {editing && (
        <div className="card card-pad mywork-editor" style={{ marginBottom: 16 }}>
          <h3 className="settings-section-head">Customize your home</h3>
          <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>Show, hide and reorder the widgets on this page. Saved on this device.</div>
          {layout.map((w, i) => (
            <div className="mywork-editor-row" key={w.id}>
              <button className="btn xs ghost" disabled={i === 0} onClick={() => setLayout((l) => moveWidget(l, i, -1))} aria-label="Move up"><ArrowUp size={13} /></button>
              <button className="btn xs ghost" disabled={i === layout.length - 1} onClick={() => setLayout((l) => moveWidget(l, i, 1))} aria-label="Move down"><ArrowDown size={13} /></button>
              <span className="mywork-editor-title">{w.title}</span>
              <button className={`btn xs ${w.hidden ? 'ghost' : 'primary'}`} onClick={() => setLayout((l) => toggleWidget(l, w.id))}>
                {w.hidden ? 'Hidden' : <><Check size={12} /> Shown</>}
              </button>
            </div>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="mywork-empty-all">
          <TriangleAlert size={18} /> All widgets are hidden. Click <strong>Customize</strong> to show some.
        </div>
      ) : (
        <div className="mywork-grid" key={nonce}>
          {visible.map((w) => {
            const Comp = WIDGET_COMPONENTS[w.id];
            return Comp ? <Comp key={w.id} /> : null;
          })}
        </div>
      )}

      <div className="muted" style={{ fontSize: 12, marginTop: 16 }}>
        Widgets: {MY_WORK_WIDGETS.length} available · {visible.length} shown.
      </div>
    </div>
  );
}
