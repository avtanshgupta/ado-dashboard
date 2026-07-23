import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useConfig } from '../lib/AppContext.jsx';
import { api } from '../lib/api.js';
import { useToast, Avatar } from '../components/ui.jsx';
import { GitPullRequestArrow, GitBranch, X, Plus } from '../components/icons.jsx';

/** Search + pick ADO reviewers by identity (returns {id, displayName}). */
function ReviewerPicker({ reviewers, onChange }) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  const ref = useRef(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setSuggestions([]); return undefined; }
    const id = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const res = await api.searchIdentities(q);
        if (id === seq.current) setSuggestions(res || []);
      } catch { if (id === seq.current) setSuggestions([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    function onDoc(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function add(s) {
    if (!reviewers.some((r) => r.id === s.id)) onChange([...reviewers, { id: s.id, displayName: s.displayName }]);
    setQuery(''); setSuggestions([]); setOpen(false);
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div className="tag-input">
        {reviewers.map((r) => (
          <span className="tag" key={r.id}>
            {r.displayName}
            <button type="button" onClick={() => onChange(reviewers.filter((x) => x.id !== r.id))} title="Remove"><X size={12} /></button>
          </span>
        ))}
        <input value={query} onChange={(e) => { setQuery(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Search reviewers by name or alias…" />
      </div>
      {open && query.trim().length >= 2 && suggestions.length > 0 && (
        <div className="member-suggest">
          {suggestions.map((s) => (
            <button type="button" className="member-suggest-row" key={s.id} onClick={() => add(s)}>
              <span style={{ fontWeight: 600, fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}><Avatar name={s.displayName} size={16} /> {s.displayName}{s.isGroup ? ' (group)' : ''}</span>
              {s.mail && <span className="muted" style={{ fontSize: 12 }}>{s.mail}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CreatePr() {
  const config = useConfig();
  const navigate = useNavigate();
  const toast = useToast();
  const repos = config.repositories || [];
  const [repo, setRepo] = useState(repos[0] || '');
  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [sourceBranch, setSourceBranch] = useState('');
  const [targetBranch, setTargetBranch] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isDraft, setIsDraft] = useState(false);
  const [reviewers, setReviewers] = useState([]);
  const [busy, setBusy] = useState(false);

  // C1 — PR description templates. Repo-scoped templates are offered first, then
  // any that apply everywhere (no repo). Picking one fills the description box.
  const allTemplates = config.prTemplates || [];
  const repoLower = repo.toLowerCase();
  const templates = allTemplates
    .filter((t) => !t.repo || t.repo === repoLower)
    .sort((a, b) => (b.repo === repoLower ? 1 : 0) - (a.repo === repoLower ? 1 : 0));

  function applyTemplate(id) {
    const t = templates.find((x) => x.id === id);
    if (t) setDescription(t.body);
  }

  useEffect(() => {
    if (!repo) return undefined;
    let stop = false;
    setLoadingBranches(true);
    api.pipelineBranches(repo, false)
      .then((list) => {
        if (stop) return;
        setBranches(list || []);
        setTargetBranch((t) => t || (list.includes('main') ? 'main' : list.includes('master') ? 'master' : list[0] || ''));
      })
      .catch(() => { if (!stop) setBranches([]); })
      .finally(() => { if (!stop) setLoadingBranches(false); });
    return () => { stop = true; };
  }, [repo]);

  async function submit() {
    if (!sourceBranch || !targetBranch || !title.trim()) {
      toast.error('Repo, source branch, target branch and title are required.');
      return;
    }
    setBusy(true);
    try {
      const pr = await api.createPr({
        repo, sourceBranch, targetBranch,
        title: title.trim(), description,
        isDraft,
        reviewerIds: reviewers.map((r) => r.id),
      });
      toast.success(`Created PR !${pr.pullRequestId}`);
      navigate(`/pr/${encodeURIComponent(repo)}/${pr.pullRequestId}`);
    } catch (e) {
      toast.error(`Create failed: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  const fieldStyle = { width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14 };

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <h2 className="section-title"><GitPullRequestArrow size={20} /> New Pull Request</h2>
        <div className="muted" style={{ fontSize: 13 }}>Open a PR directly from the dashboard.</div>
      </div>

      <div className="card card-pad" style={{ maxWidth: 720 }}>
        <label className="form-label">Repository</label>
        <select value={repo} onChange={(e) => { setRepo(e.target.value); setSourceBranch(''); setTargetBranch(''); }} style={{ ...fieldStyle, marginBottom: 14 }}>
          {repos.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>

        <div className="grid cols-2" style={{ gap: 14, marginBottom: 14 }}>
          <div>
            <label className="form-label"><GitBranch size={13} /> Source branch</label>
            <select value={sourceBranch} onChange={(e) => setSourceBranch(e.target.value)} style={fieldStyle} disabled={loadingBranches}>
              <option value="">{loadingBranches ? 'Loading…' : 'Select source…'}</option>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label"><GitBranch size={13} /> Target branch</label>
            <select value={targetBranch} onChange={(e) => setTargetBranch(e.target.value)} style={fieldStyle} disabled={loadingBranches}>
              <option value="">{loadingBranches ? 'Loading…' : 'Select target…'}</option>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
        </div>

        <label className="form-label">Title</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Descriptive PR title" style={{ ...fieldStyle, marginBottom: 14 }} />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <label className="form-label">Description (Markdown)</label>
          {templates.length > 0 && (
            <select
              aria-label="Insert PR description template"
              defaultValue=""
              onChange={(e) => { applyTemplate(e.target.value); e.target.value = ''; }}
              style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
            >
              <option value="" disabled>Insert template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}{t.repo ? ` (${t.repo})` : ''}</option>
              ))}
            </select>
          )}
        </div>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} placeholder="What does this PR do?" style={{ ...fieldStyle, marginBottom: 14, resize: 'vertical' }} />

        <label className="form-label">Reviewers</label>
        <div style={{ marginBottom: 14 }}>
          <ReviewerPicker reviewers={reviewers} onChange={setReviewers} />
        </div>

        <div className="check-row" style={{ marginBottom: 16 }}>
          <input type="checkbox" id="draft" checked={isDraft} onChange={() => setIsDraft((d) => !d)} />
          <label htmlFor="draft" style={{ margin: 0 }}>Create as draft</label>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={() => navigate(-1)} disabled={busy}>Cancel</button>
          <button className="btn primary" onClick={submit} disabled={busy || !sourceBranch || !targetBranch || !title.trim()}>
            <Plus size={14} /> {busy ? 'Creating…' : 'Create pull request'}
          </button>
        </div>
      </div>
    </div>
  );
}
