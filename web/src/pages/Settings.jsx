import { useState, useEffect, useRef, useCallback } from 'react';
import { useConfig, useApp } from '../lib/AppContext.jsx';
import { useToast } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { Settings as SettingsIcon, Save, X, SlidersHorizontal, Users, Workflow, ClipboardList, Bell, MessageSquare, CircleUser, Bot, Download, Trash2, Check, Terminal, Plus } from '../components/icons.jsx';

/**
 * Tag input that searches Azure DevOps users as you type (by alias or email) and
 * lets you pick from the results. Selected people are stored by their email. You
 * can still type a full email and press Enter to add it directly.
 */
function MemberSearch({ items, onChange, placeholder }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  const boxRef = useRef(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setSuggestions([]); setSearching(false); return undefined; }
    setSearching(true);
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const res = await api.searchIdentities(q);
        if (id === seq.current) setSuggestions((res || []).filter((r) => !r.isGroup && r.mail));
      } catch {
        if (id === seq.current) setSuggestions([]);
      } finally {
        if (id === seq.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    function onDoc(e) { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function add(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!e) return;
    if (!items.some((x) => x.toLowerCase() === e)) onChange([...items, e]);
    setQuery(''); setSuggestions([]); setOpen(false);
  }
  function addTyped() {
    const q = query.trim();
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(q)) add(q);
    else if (suggestions[0]) add(suggestions[0].mail);
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <div className="tag-input">
        {items.map((t) => (
          <span className="tag" key={t}>
            {t}
            <button type="button" onClick={() => onChange(items.filter((x) => x !== t))} title="Remove"><X size={12} /></button>
          </span>
        ))}
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } }}
          placeholder={placeholder}
        />
      </div>
      {open && query.trim().length >= 2 && (
        <div className="member-suggest">
          {searching ? (
            <div className="muted" style={{ fontSize: 12, padding: '7px 10px' }}>Searching…</div>
          ) : suggestions.length ? (
            suggestions.map((s) => (
              <button type="button" className="member-suggest-row" key={s.id} onClick={() => add(s.mail)}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{s.displayName}</span>
                <span className="muted" style={{ fontSize: 12 }}>{s.mail}</span>
              </button>
            ))
          ) : (
            <div className="muted" style={{ fontSize: 12, padding: '7px 10px' }}>
              No matches — press Enter to add an email as-is
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const PREF_LABELS = {
  newPr: 'New PR from team / assigned to me',
  newComment: 'New active comments on tracked PRs',
  reviewChange: 'Review status changes',
  pipelineFailed: 'Pipeline failures',
  pipelineSucceeded: 'Pipeline successes',
  prClosed: 'PR merged or closed',
  agentOffline: 'Agent machine went stale / offline',
  agentLongRunning: 'Long-running agent sessions',
  browserPush: 'Desktop / browser notifications',
};

/** Short org label from an org base URL: dev.azure.com/{org} or {org}.visualstudio.com. */
function orgLabel(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host === 'dev.azure.com') return u.pathname.split('/').filter(Boolean)[0] || host;
    const vs = host.match(/^(.+)\.visualstudio\.com$/);
    if (vs) return vs[1];
    return host;
  } catch {
    return '';
  }
}

export function Settings() {
  const config = useConfig();
  const { reloadConfig } = useApp();
  const toast = useToast();

  const [repos, setRepos] = useState(config.repositories);
  const [repoProjects, setRepoProjects] = useState(config.repoProjects || {});
  const [repoRef, setRepoRef] = useState('');
  const [repoResolving, setRepoResolving] = useState(false);
  const [projects, setProjects] = useState(config.projects || []);
  const [projectLink, setProjectLink] = useState('');
  const [projectResolving, setProjectResolving] = useState(false);
  const [team, setTeam] = useState(config.team);
  const [groups, setGroups] = useState(config.reviewerGroups || []);
  const [months, setMonths] = useState(config.defaultTimeRangeMonths || 6);
  const [pipelines, setPipelines] = useState(config.pipelines || []);
  const [plRef, setPlRef] = useState('');
  const [plResolving, setPlResolving] = useState(false);
  const [plNames, setPlNames] = useState({}); // definitionId -> name (for display)
  const [prefs, setPrefs] = useState(config.notificationPrefs || {});
  const [templates, setTemplates] = useState(config.commentTemplates || []); // A4
  const [prTemplates, setPrTemplates] = useState(config.prTemplates || []); // C1
  const [audit, setAudit] = useState(null); // B2 — recent state-changing actions
  const [slaDays, setSlaDays] = useState(config.slaDays || 7); // B4
  const [density, setDensity] = useState(config.uiPrefs?.density || 'comfortable'); // E5
  const [agents, setAgents] = useState(config.agents || {}); // Copilot agent session thresholds
  // Reporter API key + setup-file download state (Settings → Agents).
  const [keys, setKeys] = useState([]); // reporter API keys (multiple, named)
  const [newKey, setNewKey] = useState(null); // freshly-created key { apiKey, keyId, label, prefix } — shown once
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyCopied, setKeyCopied] = useState(false);
  const [machineName, setMachineName] = useState('');
  const [wiQueries, setWiQueries] = useState(config.workItemSavedQueries || []); // WI
  const [wiQueryLink, setWiQueryLink] = useState('');
  const [wiQueryResolving, setWiQueryResolving] = useState(false);
  const [aliasDraft, setAliasDraft] = useState('');
  const [resolving, setResolving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [section, setSection] = useState('general');

  // Load names for the currently configured pipelines (for display).
  useEffect(() => {
    let stop = false;
    api.pipelineDefs(false)
      .then((defs) => { if (!stop) setPlNames(Object.fromEntries(defs.map((d) => [d.definitionId, d.name]))); })
      .catch(() => {});
    return () => { stop = true; };
  }, []);

  // Load the reporter API keys (non-secret metadata only).
  const loadKeys = useCallback(
    () => api.agentApiKeys().then((r) => setKeys(r.value || [])).catch(() => setKeys([])),
    []
  );
  useEffect(() => { loadKeys(); }, [loadKeys]);

  // B2 — load the user's own recent audit trail once (shown under Account).
  useEffect(() => {
    let stop = false;
    api.audit(50).then((r) => { if (!stop) setAudit(r.value || []); }).catch(() => { if (!stop) setAudit([]); });
    return () => { stop = true; };
  }, []);

  function downloadFile(filename, text, type = 'application/octet-stream') {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function generateApiKey() {
    setKeyBusy(true);
    try {
      const k = await api.agentGenerateApiKey(newKeyLabel);
      setNewKey(k);
      setMachineName((m) => m || k.label);
      setNewKeyLabel('');
      setKeyCopied(false);
      await loadKeys();
      toast.success('API key created — copy it now, it won’t be shown again');
    } catch (e) {
      toast.error(`Couldn’t create key: ${e.message}`);
    } finally {
      setKeyBusy(false);
    }
  }

  async function revokeKey(keyId) {
    try {
      await api.agentRevokeApiKey(keyId);
      if (newKey && newKey.keyId === keyId) setNewKey(null);
      await loadKeys();
      toast.info('Key revoked');
    } catch (e) {
      toast.error(`Couldn’t revoke key: ${e.message}`);
    }
  }

  async function copyApiKey() {
    try {
      await navigator.clipboard.writeText(newKey.apiKey);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 1500);
    } catch {
      toast.error('Copy failed — select the key and copy manually');
    }
  }

  function downloadReporterConfig() {
    const cfg = {
      dashboard_url: window.location.origin,
      api_key: newKey.apiKey,
      machine_name: machineName.trim() || 'my-vm',
    };
    downloadFile('reporter.json', `${JSON.stringify(cfg, null, 2)}\n`, 'application/json');
  }

  async function addRepoByLink() {
    const ref = repoRef.trim();
    if (!ref) return;
    setRepoResolving(true);
    try {
      const info = await api.repoResolve(ref); // { repo, project, projectId, org, ... }
      const already = repos.some((r) => r.toLowerCase() === info.repo.toLowerCase());
      const nextRepos = already ? repos : [...repos, info.repo];
      // Record the repo's owning project + org so its PRs show alongside every
      // other project's in the same lists (across organizations).
      const nextRepoProjects = {
        ...repoProjects,
        [info.repo.toLowerCase()]: { project: info.project, projectId: info.projectId || '', ...(info.org ? { org: info.org } : {}) },
      };

      // Persist immediately so tracking starts right away.
      await api.updateConfig({ repositories: nextRepos, repoProjects: nextRepoProjects });
      await reloadConfig();
      setRepos(nextRepos);
      setRepoProjects(nextRepoProjects);
      setRepoRef('');

      if (already) toast.info(`“${info.repo}” is already tracked (${info.project})`);
      else toast.success(`Now tracking “${info.repo}” in ${info.project}`);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setRepoResolving(false);
    }
  }

  async function addPipeline() {
    const ref = String(plRef).trim();
    if (!ref) return;
    setPlResolving(true);
    try {
      const info = await api.pipelineResolve(ref); // { definitionId, name, repo, project, projectId }
      if (pipelines.some((p) => Number(p.definitionId) === Number(info.definitionId))) {
        toast.info('That pipeline is already added');
      } else {
        setPipelines([...pipelines, {
          repo: info.repo,
          definitionId: info.definitionId,
          name: info.name,
          ...(info.project ? { project: info.project } : {}),
          ...(info.projectId ? { projectId: info.projectId } : {}),
        }]);
        setPlNames((m) => ({ ...m, [info.definitionId]: info.name }));
        toast.success(`Added “${info.name}”${info.project ? ` (${info.project})` : ''}`);
      }
      setPlRef('');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setPlResolving(false);
    }
  }

  async function addAlias() {    const alias = aliasDraft.trim();
    if (!alias) return;
    setResolving(true);
    try {
      const g = await api.resolveGroup(alias);
      if (!groups.some((x) => x.name.toLowerCase() === g.name.toLowerCase())) {
        setGroups([...groups, g]);
        toast.success(`Resolved to "${g.name}"`);
      } else {
        toast.info('That group is already added');
      }
      setAliasDraft('');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setResolving(false);
    }
  }

  async function addProjectByLink() {
    const ref = projectLink.trim();
    if (!ref) return;
    setProjectResolving(true);
    try {
      const info = await api.projectResolve(ref); // { name, id, url }
      if (projects.some((p) => p.name.toLowerCase() === info.name.toLowerCase())) {
        toast.info(`“${info.name}” is already monitored`);
      } else {
        setProjects([...projects, { name: info.name, id: info.id, url: info.url }]);
        toast.success(`Now monitoring project “${info.name}”`);
      }
      setProjectLink('');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setProjectResolving(false);
    }
  }

  async function addQueryByLink() {
    const ref = wiQueryLink.trim();
    if (!ref) return;
    setWiQueryResolving(true);
    try {
      const info = await api.wiResolveQuery(ref); // { id, name, project, org }
      if (wiQueries.some((q) => (q.id || '').toLowerCase() === info.id.toLowerCase())) {
        toast.info(`“${info.name}” is already added`);
      } else {
        setWiQueries([...wiQueries, { id: info.id, name: info.name, ...(info.project ? { project: info.project } : {}), ...(info.org ? { org: info.org } : {}) }]);
        toast.success(`Added query “${info.name}”`);
      }
      setWiQueryLink('');
    } catch (e) {
      toast.error(e.message);
    } finally {
      setWiQueryResolving(false);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await api.updateConfig({
        projects,
        repositories: repos,
        repoProjects,
        team,
        reviewerGroups: groups,
        defaultTimeRangeMonths: Number(months),
        pipelines,
        notificationPrefs: prefs,
        commentTemplates: templates.filter((t) => t.name.trim() && t.body.trim()),
        prTemplates: prTemplates
          .filter((t) => t.name.trim() && t.body.trim())
          .map((t) => ({ id: t.id, name: t.name, body: t.body, ...(t.repo ? { repo: t.repo } : {}) })),
        slaDays: Number(slaDays),
        uiPrefs: { density },
        workItemSavedQueries: wiQueries.filter((q) => (q.id || '').trim()),
        agents: { staleMinutes: Number(agents.staleMinutes) || 5, longRunningHours: Number(agents.longRunningHours) || 4 },
      });
      await reloadConfig();
      toast.success('Settings saved');
    } catch (e) {
      toast.error(`Save failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  const SECTIONS = [
    { id: 'general', label: 'General', Icon: SlidersHorizontal },
    { id: 'team', label: 'Team & Reviewers', Icon: Users },
    { id: 'templates', label: 'Templates', Icon: MessageSquare },
    { id: 'workitems', label: 'Work Items', Icon: ClipboardList },
    { id: 'pipelines', label: 'Pipelines', Icon: Workflow },
    { id: 'agents', label: 'Agents', Icon: Bot },
    { id: 'notifications', label: 'Notifications', Icon: Bell },
    { id: 'account', label: 'Account', Icon: CircleUser },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 10, flexWrap: 'wrap' }}>
        <h2 className="section-title" style={{ margin: 0 }}><SettingsIcon size={20} /> Settings</h2>
        <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : <><Save size={15} /> Save changes</>}</button>
      </div>

      <div className="subtabs no-print" data-tour="settings-nav">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" className={`subtab ${section === s.id ? 'active' : ''}`} onClick={() => setSection(s.id)}>
            <s.Icon size={15} /> {s.label}
          </button>
        ))}
      </div>

      <div className="settings-content">
          {section === 'general' && (
            <>
              <div className="card card-pad" style={{ marginBottom: 16 }} data-tour="settings-projects">
                <h3 className="settings-section-head">Projects to monitor ({projects.length})</h3>
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  All data — pull requests, builds, repos, work items and queries — is scoped to these
                  Azure DevOps projects. Paste a project <strong>URL</strong>
                  (<code>https://…/&lt;project&gt;</code>) to add one; its name and id are verified automatically.
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input
                    value={projectLink}
                    onChange={(e) => setProjectLink(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addProjectByLink(); } }}
                    placeholder="Project URL (…/<org>/<project>)"
                    style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
                  />
                  <button className="btn accent" onClick={addProjectByLink} disabled={projectResolving || !projectLink.trim()}>
                    {projectResolving ? 'Verifying…' : '+ Add'}
                  </button>
                </div>
                <div className="tag-input">
                  {projects.map((p) => (
                    <span className="tag" key={p.name} title={p.url || p.name}>
                      {p.name}
                      <span style={{ opacity: 0.65, marginLeft: 4 }}>· {orgLabel(p.org || p.url)}</span>
                      <button type="button" onClick={() => setProjects(projects.filter((x) => x.name !== p.name))} title="Remove"><X size={12} /></button>
                    </span>
                  ))}
                  {projects.length === 0 && <span className="muted" style={{ fontSize: 12, padding: '4px 2px' }}>No projects — add at least one to populate the dashboard.</span>}
                </div>
              </div>

              <div className="card card-pad" style={{ marginBottom: 16 }} data-tour="settings-repos">
                <h3 className="settings-section-head">Repositories to monitor ({repos.length})</h3>
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                  Paste a repo <strong>URL</strong> (<code>…/_git/&lt;repo&gt;</code>) from any monitored project —
                  the name and project are filled in automatically and tracking starts. Repos from every project
                  appear together in the same lists.
                </div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input
                    value={repoRef}
                    onChange={(e) => setRepoRef(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRepoByLink(); } }}
                    placeholder="Repository URL (…/_git/<repo>)"
                    style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
                  />
                  <button className="btn accent" onClick={addRepoByLink} disabled={repoResolving || !repoRef.trim()}>
                    {repoResolving ? 'Verifying…' : '+ Add'}
                  </button>
                </div>
                <div className="tag-input">
                  {repos.map((r) => {
                    const proj = repoProjects[r.toLowerCase()]?.project;
                    const crossProject = proj && proj !== config.project;
                    return (
                      <span className="tag" key={r} title={proj ? `${r} · ${proj}` : r}>
                        {r}
                        {crossProject && <span style={{ opacity: 0.65, marginLeft: 4 }}>· {proj}</span>}
                        <button type="button" onClick={() => setRepos(repos.filter((x) => x !== r))} title="Remove"><X size={12} /></button>
                      </span>
                    );
                  })}
                  {repos.length === 0 && <span className="muted" style={{ fontSize: 12, padding: '4px 2px' }}>No repositories yet — paste a repo URL above.</span>}
                </div>
              </div>

              <div className="card card-pad">
                <h3 className="settings-section-head">Preferences</h3>
                <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>Defaults that shape your lists, overviews and staleness signals.</div>
                <div className="kv"><span className="k">Default time window</span>
                  <span className="v">
                    <select value={months} onChange={(e) => setMonths(e.target.value)} style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
                      {[1, 3, 6, 12, 24].map((m) => <option key={m} value={m}>{m === 12 ? '1 year' : m === 24 ? '2 years' : `${m} months`}</option>)}
                    </select>
                  </span>
                </div>
                <div className="kv"><span className="k">Staleness SLA</span>
                  <span className="v">
                    <select value={slaDays} onChange={(e) => setSlaDays(e.target.value)} style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
                      {[...new Set([Number(slaDays) || 7, 1, 2, 3, 5, 7, 14, 21, 30, 60, 90])].sort((a, b) => a - b).map((d) => (
                        <option key={d} value={d}>{d} day{d === 1 ? '' : 's'}</option>
                      ))}
                    </select>
                  </span>
                </div>
                <div className="kv"><span className="k">Table density</span>
                  <span className="v">
                    <select value={density} onChange={(e) => setDensity(e.target.value)} style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
                      <option value="comfortable">Comfortable</option>
                      <option value="compact">Compact</option>
                    </select>
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                  Idle PRs/work items past the SLA are flagged as breaching in Analytics, the Action Center and dashboard.
                </div>
              </div>
            </>
          )}

          {section === 'team' && (
            <>
              <div className="card card-pad" style={{ marginBottom: 16 }}>
                <h3 className="settings-section-head">Team members ({team.length})</h3>
                <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Their open PRs appear under “Authored By Team”, and their work items under the Work Items → Team tab. Search by alias or email, then pick.</div>
                <MemberSearch items={team} onChange={setTeam} placeholder="Search by alias or email…" />
              </div>

              <div className="card card-pad">
                <h3 className="settings-section-head">Review-group aliases for “Assigned to Me”</h3>
                <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                  PRs where any of these groups is a reviewer also appear under Assigned to Me.
                </div>
                {groups.map((g) => (
                  <div className="group-row" key={g.name}>
                    <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.label || g.name}</span>
                    <span title={g.name} style={{ fontSize: 12.5, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
                    <button className="btn sm" onClick={() => setGroups(groups.filter((x) => x.name !== g.name))}>Remove</button>
                  </div>
                ))}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <input
                    value={aliasDraft}
                    onChange={(e) => setAliasDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addAlias(); }}
                    placeholder="group-alias@microsoft.com"
                    style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
                  />
                  <button className="btn accent" onClick={addAlias} disabled={resolving || !aliasDraft.trim()}>
                    {resolving ? 'Resolving…' : '+ Add'}
                  </button>
                </div>
              </div>
            </>
          )}

          {section === 'pipelines' && (
            <div className="card card-pad">
              <h3 className="settings-section-head">Pipelines to monitor ({pipelines.length})</h3>
              <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                Paste an ADO pipeline <strong>URL</strong> (<code>…/_build?definitionId=NNN</code>) from a
                monitored project. The name is filled in automatically.
              </div>
              {pipelines.map((p, i) => (
                <div className="group-row" key={`${p.definitionId}`}>
                  <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name || plNames[p.definitionId] || `Pipeline ${p.definitionId}`}
                  </span>
                  <span title={p.repo} style={{ fontSize: 12, color: 'var(--text-muted)' }}>#{p.definitionId} · {p.repo || '—'}</span>
                  <button className="btn sm" onClick={() => setPipelines(pipelines.filter((_, j) => j !== i))}>Remove</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <input
                  value={plRef}
                  onChange={(e) => setPlRef(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addPipeline(); }}
                  placeholder="Pipeline URL (…/_build?definitionId=NNN)"
                  style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
                />
                <button className="btn accent" onClick={addPipeline} disabled={plResolving || !plRef.trim()}>
                  {plResolving ? 'Resolving…' : '+ Add'}
                </button>
              </div>
            </div>
          )}

          {section === 'workitems' && (
            <div className="card card-pad" data-tour="settings-workitems">
              <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>
                Work items are tracked across <strong>all your monitored projects</strong> (configure those
                under <strong>General → Projects</strong>). No area paths needed — every work item in those
                projects is available under the Work Items tabs.
              </div>

              <h3 className="settings-section-head">Saved queries ({wiQueries.length})</h3>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                Run your Azure DevOps queries under the Work Items → <strong>Queries</strong> tab. Paste a
                query <strong>URL</strong> (<code>…/_queries/query/&lt;guid&gt;</code>) — the name, project and
                organization are filled in automatically.
              </div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input
                  value={wiQueryLink}
                  onChange={(e) => setWiQueryLink(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addQueryByLink(); } }}
                  placeholder="Query URL (…/_queries/query/<guid>)"
                  style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}
                />
                <button className="btn accent" onClick={addQueryByLink} disabled={wiQueryResolving || !wiQueryLink.trim()}>
                  {wiQueryResolving ? 'Resolving…' : '+ Add'}
                </button>
              </div>
              {wiQueries.map((q, i) => (
                <div className="group-row" key={q.id || i}>
                  <span style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.name || q.id}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{q.project || '—'}{q.org ? ` · ${orgLabel(q.org)}` : ''}</span>
                  <button className="btn sm" onClick={() => setWiQueries(wiQueries.filter((_, j) => j !== i))}>Remove</button>
                </div>
              ))}
              {wiQueries.length === 0 && <span className="muted" style={{ fontSize: 12 }}>No saved queries yet — paste a query URL above.</span>}
            </div>
          )}

          {section === 'notifications' && (
            <div className="card card-pad">
              <h3 className="settings-section-head">Notification preferences</h3>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                In-app notifications poll automatically and show in the bell. Enable desktop / browser
                notifications to be alerted even when the tab is in the background.
              </div>
              {Object.entries(PREF_LABELS).map(([key, label]) => (
                <div className="check-row" key={key}>
                  <input type="checkbox" id={key} checked={!!prefs[key]} onChange={() => setPrefs({ ...prefs, [key]: !prefs[key] })} />
                  <label htmlFor={key} style={{ margin: 0 }}>{label}</label>
                </div>
              ))}
            </div>
          )}

          {section === 'templates' && (
            <div className="card card-pad">
              <h3 className="settings-section-head">Comment templates ({templates.length})</h3>
              <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                Saved reply snippets you can insert into any PR comment or inline review comment.
              </div>
              {templates.map((t, i) => (
                <div key={t.id || i} className="tmpl-edit" style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--border-muted)' }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <input
                      value={t.name}
                      onChange={(e) => { const n = [...templates]; n[i] = { ...t, name: e.target.value }; setTemplates(n); }}
                      placeholder="Template name"
                      style={{ flex: 1, padding: '6px 9px', border: '1px solid var(--border)', borderRadius: 6 }}
                    />
                    <button className="btn sm" onClick={() => setTemplates(templates.filter((_, j) => j !== i))}>Remove</button>
                  </div>
                  <textarea
                    value={t.body}
                    onChange={(e) => { const n = [...templates]; n[i] = { ...t, body: e.target.value }; setTemplates(n); }}
                    placeholder="Template body (Markdown supported)"
                    rows={2}
                    style={{ width: '100%', padding: '6px 9px', border: '1px solid var(--border)', borderRadius: 6, resize: 'vertical', fontSize: 13 }}
                  />
                </div>
              ))}
              <button className="btn sm accent" onClick={() => setTemplates([...templates, { id: `t${Date.now()}`, name: '', body: '' }])}>+ Add template</button>
            </div>
          )}

          {section === 'templates' && (
            <div className="card card-pad" style={{ marginTop: 16 }}>
              <h3 className="settings-section-head">PR description templates ({prTemplates.length})</h3>
              <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                Prefill the description when opening a new pull request. Scope a template to one
                repository, or leave it on “All repositories” to offer it everywhere.
              </div>
              {prTemplates.map((t, i) => (
                <div key={t.id || i} className="tmpl-edit" style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--border-muted)' }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <input
                      value={t.name}
                      onChange={(e) => { const n = [...prTemplates]; n[i] = { ...t, name: e.target.value }; setPrTemplates(n); }}
                      placeholder="Template name"
                      style={{ flex: 1, padding: '6px 9px', border: '1px solid var(--border)', borderRadius: 6 }}
                    />
                    <select
                      value={t.repo || ''}
                      aria-label="Template repository scope"
                      onChange={(e) => { const n = [...prTemplates]; n[i] = { ...t, repo: e.target.value.toLowerCase() }; setPrTemplates(n); }}
                      style={{ padding: '6px 9px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}
                    >
                      <option value="">All repositories</option>
                      {(repos || []).map((r) => <option key={r} value={r.toLowerCase()}>{r}</option>)}
                    </select>
                    <button className="btn sm" onClick={() => setPrTemplates(prTemplates.filter((_, j) => j !== i))}>Remove</button>
                  </div>
                  <textarea
                    value={t.body}
                    onChange={(e) => { const n = [...prTemplates]; n[i] = { ...t, body: e.target.value }; setPrTemplates(n); }}
                    placeholder="Template body (Markdown supported)"
                    rows={3}
                    style={{ width: '100%', padding: '6px 9px', border: '1px solid var(--border)', borderRadius: 6, resize: 'vertical', fontSize: 13 }}
                  />
                </div>
              ))}
              <button className="btn sm accent" onClick={() => setPrTemplates([...prTemplates, { id: `p${Date.now()}`, name: '', body: '', repo: '' }])}>+ Add PR template</button>
            </div>
          )}

          {section === 'agents' && (
            <div className="card card-pad">
              <h3 className="settings-section-head">Copilot Agent Sessions</h3>
              <p className="muted" style={{ fontSize: 12.5, marginBottom: 18 }}>
                See live Copilot CLI sessions across your VMs. Set up the reporter on each
                machine in three steps — no repo checkout needed.
              </p>

              {/* Step 1 — API keys */}
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>1 · Create an API key</div>
              <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>
                Each reporter authenticates with a personal key. Create one per machine or fleet —
                revoking or rotating one won’t affect your other reporters.
              </div>

              {keys.length > 0 && (
                <div className="apikey-list">
                  {keys.map((k) => (
                    <div className="apikey-row" key={k.keyId}>
                      <div className="apikey-info">
                        <span className="apikey-label">{k.label}</span>
                        <code className="apikey-prefix">{k.prefix}…</code>
                        <span className="muted apikey-dates">
                          created {new Date(k.createdAt).toLocaleDateString()}
                          {' · '}
                          {k.lastUsedAt ? `last used ${new Date(k.lastUsedAt).toLocaleString()}` : 'never used'}
                        </span>
                      </div>
                      <button className="btn-icon" title="Revoke key" onClick={() => revokeKey(k.keyId)}><Trash2 size={14} /></button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                <input value={newKeyLabel} onChange={(e) => setNewKeyLabel(e.target.value)} placeholder="Key name (e.g. build-box)" maxLength={60}
                  style={{ flex: '1 1 180px', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6 }} />
                <button className="btn accent" onClick={generateApiKey} disabled={keyBusy}>
                  <Plus size={14} /> New key
                </button>
              </div>

              {newKey && (
                <div style={{ marginTop: 10, padding: 12, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-subtle, rgba(127,127,127,0.06))' }}>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                    New key <strong>{newKey.label}</strong> — copy it now, it won’t be shown again.
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input readOnly value={newKey.apiKey} onFocus={(e) => e.target.select()}
                      style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontFamily: 'monospace', fontSize: 12.5 }} />
                    <button className="btn" onClick={copyApiKey}>
                      {keyCopied ? <><Check size={14} /> Copied</> : 'Copy'}
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2 — download setup files */}
              <div style={{ fontWeight: 600, fontSize: 13, margin: '20px 0 6px' }}>2 · Download the setup files</div>
              <div className="field-row">
                <label className="field-label">Machine name</label>
                <input value={machineName} onChange={(e) => setMachineName(e.target.value)} placeholder="my-vm" />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <button className="btn" onClick={downloadReporterConfig} disabled={!newKey} title={!newKey ? 'Generate a key first' : 'Download reporter.json'}>
                  <Download size={14} /> reporter.json
                </button>
                <a className="btn" href={api.reporterScriptUrl} download="copilot-session-reporter.py">
                  <Download size={14} /> copilot-session-reporter.py
                </a>
              </div>
              {!newKey && (
                <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                  Generate a key above to enable the <code>reporter.json</code> download — it embeds the key.
                </div>
              )}

              {/* Step 3 — install on the VM */}
              <div style={{ fontWeight: 600, fontSize: 13, margin: '20px 0 6px' }}>
                <Terminal size={13} /> 3 · Install on the VM
              </div>
              <pre style={{ margin: 0, padding: 12, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-subtle, rgba(127,127,127,0.06))', fontSize: 12, overflowX: 'auto', whiteSpace: 'pre' }}>{`mkdir -p ~/.config/ado-dashboard
mv ~/Downloads/reporter.json ~/.config/ado-dashboard/reporter.json
mv ~/Downloads/copilot-session-reporter.py ~/
# run every minute via cron
( crontab -l 2>/dev/null; echo "* * * * * python3 $HOME/copilot-session-reporter.py" ) | crontab -`}</pre>
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                Requires Python 3 on the VM. The reporter only sends metadata (repo, branch, cwd, status) — never terminal content or secrets.
              </div>

              {/* Display thresholds */}
              <div style={{ fontWeight: 600, fontSize: 13, margin: '20px 0 6px' }}>Display thresholds</div>
              <div className="field-row">
                <label className="field-label">Stale threshold (minutes)</label>
                <input type="number" min={1} max={60} value={agents.staleMinutes ?? 5}
                  onChange={(e) => setAgents((a) => ({ ...a, staleMinutes: Number(e.target.value) }))} />
              </div>
              <div className="field-row">
                <label className="field-label">Long-running threshold (hours)</label>
                <input type="number" min={1} max={48} value={agents.longRunningHours ?? 4}
                  onChange={(e) => setAgents((a) => ({ ...a, longRunningHours: Number(e.target.value) }))} />
              </div>
            </div>
          )}

          {section === 'account' && (
            <div className="card card-pad">
              <h3 className="settings-section-head">Account</h3>
              <div className="kv"><span className="k">Signed in as</span><span className="v">{config.me.displayName}</span></div>
              <div className="kv"><span className="k">Email</span><span className="v">{config.me.uniqueName}</span></div>
              <div className="kv"><span className="k">Organization</span><span className="v">{config.organizationUrl.replace('https://', '')}</span></div>
              <div className="kv"><span className="k">Default project</span><span className="v">{config.project}</span></div>
              <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
                You act with your own Azure DevOps permissions. Settings on this page are personal to you.
              </div>
            </div>
          )}

          {section === 'account' && (
            <div className="card card-pad" style={{ marginTop: 16 }}>
              <h3 className="settings-section-head">Recent activity</h3>
              <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
                Your most recent state-changing actions (merges, votes, comments, edits). Recorded
                locally for your own traceability — no comment text or tokens are stored.
              </div>
              {audit == null && <div className="muted" style={{ fontSize: 13 }}>Loading…</div>}
              {audit != null && audit.length === 0 && <div className="muted" style={{ fontSize: 13 }}>No recorded actions yet.</div>}
              {audit != null && audit.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 320, overflowY: 'auto' }}>
                  {audit.map((a, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '4px 0', borderBottom: '1px solid var(--border-muted)' }}>
                      <span className="badge" style={{ minWidth: 46, textAlign: 'center' }}>{a.method}</span>
                      <span style={{ color: a.ok ? 'var(--ok, inherit)' : 'var(--danger, #c00)', fontWeight: 600, minWidth: 34 }}>{a.status}</span>
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--mono, monospace)' }} title={a.path}>{a.path}</span>
                      <span className="muted" style={{ whiteSpace: 'nowrap' }}>{a.t ? new Date(a.t).toLocaleString() : ''}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
    </div>
  );
}
