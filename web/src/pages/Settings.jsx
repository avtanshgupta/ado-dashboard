import { useState, useEffect, useRef } from 'react';
import { useConfig, useApp } from '../lib/AppContext.jsx';
import { useToast } from '../components/ui.jsx';
import { api } from '../lib/api.js';
import { Settings as SettingsIcon, Save, X } from '../components/icons.jsx';

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
  browserPush: 'Desktop / browser notifications',
  email: 'Also send notifications by email',
};

export function Settings() {
  const config = useConfig();
  const { reloadConfig } = useApp();
  const toast = useToast();

  const [repos, setRepos] = useState(config.repositories);
  const [repoProjects, setRepoProjects] = useState(config.repoProjects || {});
  const [repoRef, setRepoRef] = useState('');
  const [repoDraft, setRepoDraft] = useState('');
  const [repoResolving, setRepoResolving] = useState(false);
  const [team, setTeam] = useState(config.team);
  const [groups, setGroups] = useState(config.reviewerGroups || []);
  const [months, setMonths] = useState(config.defaultTimeRangeMonths || 6);
  const [pipelines, setPipelines] = useState(config.pipelines || []);
  const [plRef, setPlRef] = useState('');
  const [plResolving, setPlResolving] = useState(false);
  const [plNames, setPlNames] = useState({}); // definitionId -> name (for display)
  const [prefs, setPrefs] = useState(config.notificationPrefs || {});
  const [templates, setTemplates] = useState(config.commentTemplates || []); // A4
  const [slaDays, setSlaDays] = useState(config.slaDays || 7); // B4
  const [webhooks, setWebhooks] = useState(config.chatWebhooks || []); // D1
  const [testingHook, setTestingHook] = useState(null);
  const [density, setDensity] = useState(config.uiPrefs?.density || 'comfortable'); // E5
  const [aliasDraft, setAliasDraft] = useState('');
  const [resolving, setResolving] = useState(false);
  const [busy, setBusy] = useState(false);

  // Load names for the currently configured pipelines (for display).
  useEffect(() => {
    let stop = false;
    api.pipelineDefs(false)
      .then((defs) => { if (!stop) setPlNames(Object.fromEntries(defs.map((d) => [d.definitionId, d.name]))); })
      .catch(() => {});
    return () => { stop = true; };
  }, []);

  async function addRepoByLink() {
    const ref = repoRef.trim();
    if (!ref) return;
    setRepoResolving(true);
    try {
      const info = await api.repoResolve(ref); // { repo, project, projectId, ... }
      const already = repos.some((r) => r.toLowerCase() === info.repo.toLowerCase());
      const nextRepos = already ? repos : [...repos, info.repo];
      // Record the repo's owning project so its PRs show alongside every other
      // project's in the same lists (no active-project switching).
      const nextRepoProjects = {
        ...repoProjects,
        [info.repo.toLowerCase()]: { project: info.project, projectId: info.projectId || '' },
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

  async function testHook(i) {
    const w = webhooks[i];
    setTestingHook(i);
    try {
      await api.testWebhook(w.url, w.type);
      toast.success('Test message sent — check your channel');
    } catch (e) {
      toast.error(`Webhook test failed: ${e.message}`);
    } finally {
      setTestingHook(null);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await api.updateConfig({
        repositories: repos,
        repoProjects,
        team,
        reviewerGroups: groups,
        defaultTimeRangeMonths: Number(months),
        pipelines,
        notificationPrefs: prefs,
        commentTemplates: templates.filter((t) => t.name.trim() && t.body.trim()),
        slaDays: Number(slaDays),
        chatWebhooks: webhooks.filter((w) => /^https:\/\//i.test((w.url || '').trim())),
        uiPrefs: { density },
      });
      await reloadConfig();
      toast.success('Settings saved');
    } catch (e) {
      toast.error(`Save failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <h2 className="section-title" style={{ margin: 0 }}><SettingsIcon size={20} /> Settings</h2>
        <button className="btn primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : <><Save size={15} /> Save changes</>}</button>
      </div>

      <div className="grid cols-2">
        <div>
          <div className="card card-pad" style={{ marginBottom: 16 }} data-tour="settings-repos">
            <h3>Repositories to monitor ({repos.length})</h3>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              Paste a repo <strong>URL</strong> (<code>…/_git/&lt;repo&gt;</code>) from <strong>any project</strong> —
              the name and project are filled in automatically and tracking starts. Repos from every project
              appear together in the same lists.
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                value={repoRef}
                onChange={(e) => setRepoRef(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRepoByLink(); } }}
                placeholder="Repository URL or name"
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
                    <button
                      type="button"
                      onClick={() => setRepos(repos.filter((x) => x !== r))}
                      title="Remove"
                    ><X size={12} /></button>
                  </span>
                );
              })}
              <input
                value={repoDraft}
                onChange={(e) => setRepoDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault();
                    const vals = repoDraft.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
                    if (vals.length) setRepos([...new Set([...repos, ...vals])]);
                    setRepoDraft('');
                  }
                }}
                placeholder={`Add a name in ${config.project} + Enter`}
              />
            </div>
          </div>

          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <h3>Team members ({team.length})</h3>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Their open PRs appear under “Authored By Team”. Search by alias or email, then pick.</div>
            <MemberSearch items={team} onChange={setTeam} placeholder="Search by alias or email…" />
          </div>

          <div className="card card-pad">
            <h3>Default time window</h3>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Default “updated within” filter for lists & overview.</div>
            <select value={months} onChange={(e) => setMonths(e.target.value)} style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
              {[1, 3, 6, 12, 24].map((m) => <option key={m} value={m}>{m === 12 ? '1 year' : m === 24 ? '2 years' : `${m} months`}</option>)}
            </select>
            <h3 style={{ marginTop: 16 }}>Staleness SLA</h3>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Open PRs idle this many days are flagged as breaching SLA in Analytics & Action Center.</div>
            <input
              type="number"
              min={1}
              max={90}
              value={slaDays}
              onChange={(e) => setSlaDays(e.target.value)}
              style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, width: 100 }}
            /> <span className="muted" style={{ fontSize: 13 }}>days</span>
            <h3 style={{ marginTop: 16 }}>Table density</h3>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>Compact mode fits more rows per screen in PR lists.</div>
            <select value={density} onChange={(e) => setDensity(e.target.value)} style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </div>

          <div className="card card-pad" style={{ marginTop: 16 }}>
            <h3>Pipelines to monitor ({pipelines.length})</h3>
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              Paste an ADO pipeline <strong>URL</strong> (<code>…/_build?definitionId=NNN</code>) or just the
              <strong> definitionId</strong>. The name is filled in automatically.
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
                placeholder="Pipeline URL or definitionId"
                style={{ flex: 1, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
              />
              <button className="btn accent" onClick={addPipeline} disabled={plResolving || !plRef.trim()}>
                {plResolving ? 'Resolving…' : '+ Add'}
              </button>
            </div>
          </div>
        </div>

        <div>
          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <h3>Review-group aliases for “Assigned to Me”</h3>
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              PRs where any of these groups is a reviewer also appear under Assigned to Me.
            </div>
            {groups.map((g, i) => (
              <div className="group-row" key={g.name}>
                <input value={g.label} onChange={(e) => { const n = [...groups]; n[i] = { ...g, label: e.target.value }; setGroups(n); }} placeholder="Badge label" />
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

          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <h3>Notification preferences</h3>
            <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
              In-app notifications poll automatically. Email requires server SMTP ({config.emailEnabled ? 'enabled' : 'disabled'}).
            </div>
            {Object.entries(PREF_LABELS).map(([key, label]) => (
              <div className="check-row" key={key}>
                <input type="checkbox" id={key} checked={!!prefs[key]} onChange={() => setPrefs({ ...prefs, [key]: !prefs[key] })} disabled={key === 'email' && !config.emailEnabled} />
                <label htmlFor={key} style={{ margin: 0 }}>{label}{key === 'email' && !config.emailEnabled && <span className="muted"> (configure SMTP)</span>}</label>
              </div>
            ))}
            <div className="check-row" style={{ marginTop: 8 }}>
              <label htmlFor="digest" style={{ margin: 0, marginRight: 8 }}>Digest email</label>
              <select
                id="digest"
                value={prefs.digest || 'off'}
                onChange={(e) => setPrefs({ ...prefs, digest: e.target.value })}
                disabled={!config.emailEnabled}
                style={{ padding: '5px 9px', border: '1px solid var(--border)', borderRadius: 6 }}
              >
                <option value="off">Off</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
              {!config.emailEnabled && <span className="muted" style={{ marginLeft: 8 }}>(configure SMTP)</span>}
            </div>
          </div>

          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <h3>Comment templates ({templates.length})</h3>
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

          <div className="card card-pad" style={{ marginBottom: 16 }}>
            <h3>Chat webhooks ({webhooks.length})</h3>
            <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              Post notifications to Slack or Microsoft Teams via an incoming-webhook URL. Enable the
              “Send to chat webhooks” toggle below to fan out.
            </div>
            <div className="check-row" style={{ marginBottom: 10 }}>
              <input type="checkbox" id="chatPref" checked={!!prefs.chat} onChange={() => setPrefs({ ...prefs, chat: !prefs.chat })} />
              <label htmlFor="chatPref" style={{ margin: 0 }}>Send notifications to chat webhooks</label>
            </div>
            {webhooks.map((w, i) => (
              <div key={w.id || i} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--border-muted)' }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                  <select value={w.type} onChange={(e) => { const n = [...webhooks]; n[i] = { ...w, type: e.target.value }; setWebhooks(n); }} style={{ padding: '6px 8px', border: '1px solid var(--border)', borderRadius: 6 }}>
                    <option value="slack">Slack</option>
                    <option value="teams">Teams</option>
                  </select>
                  <input value={w.name || ''} onChange={(e) => { const n = [...webhooks]; n[i] = { ...w, name: e.target.value }; setWebhooks(n); }} placeholder="Label" style={{ flex: 1, padding: '6px 9px', border: '1px solid var(--border)', borderRadius: 6 }} />
                  <button className="btn sm" disabled={testingHook === i || !/^https:\/\//i.test(w.url || '')} onClick={() => testHook(i)}>{testingHook === i ? 'Testing…' : 'Test'}</button>
                  <button className="btn sm" onClick={() => setWebhooks(webhooks.filter((_, j) => j !== i))}>Remove</button>
                </div>
                <input value={w.url} onChange={(e) => { const n = [...webhooks]; n[i] = { ...w, url: e.target.value }; setWebhooks(n); }} placeholder="https://hooks.slack.com/… or https://outlook.office.com/webhook/…" style={{ width: '100%', padding: '6px 9px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12.5 }} />
              </div>
            ))}
            <button className="btn sm accent" onClick={() => setWebhooks([...webhooks, { id: `w${Date.now()}`, type: 'slack', name: '', url: '' }])}>+ Add webhook</button>
          </div>

          <div className="card card-pad">
            <h3>Account</h3>
            <div className="kv"><span className="k">Signed in as</span><span className="v">{config.me.displayName}</span></div>
            <div className="kv"><span className="k">Email</span><span className="v">{config.me.uniqueName}</span></div>
            <div className="kv"><span className="k">Organization</span><span className="v">{config.organizationUrl.replace('https://', '')}</span></div>
            <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
              You act with your own Azure DevOps permissions. Settings on this page are personal to you.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
