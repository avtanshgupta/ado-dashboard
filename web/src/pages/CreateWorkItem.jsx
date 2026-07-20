import { useState, useMemo, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useConfig } from '../lib/AppContext.jsx';
import { useAsync } from '../lib/useAsync.js';
import { api } from '../lib/api.js';
import { useToast, Loading } from '../components/ui.jsx';
import { WiTypeBadge } from '../components/workItemUi.jsx';
import { Plus, ArrowLeft, Tag, X } from '../components/icons.jsx';

export function CreateWorkItem() {
  const config = useConfig();
  const navigate = useNavigate();
  const toast = useToast();
  const projects = config.workItemProjects || [];
  const types = useAsync(() => api.wiTypes(), [], { cacheKey: 'wi:types' });

  const [project, setProject] = useState(projects[0]?.name || config.project || '');
  const [type, setType] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [areaPath, setAreaPath] = useState('');
  const [iterationPath, setIterationPath] = useState('');
  const [priority, setPriority] = useState('');
  const [tags, setTags] = useState([]);
  const [tagDraft, setTagDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const typeList = useMemo(() => (types.data || []).filter((t) => !/^(microsoft\.|.*Test.*)$/i.test(t.name)), [types.data]);
  useEffect(() => { if (!type && typeList.length) setType(typeList.find((t) => t.name === 'Bug')?.name || typeList[0].name); }, [typeList, type]);

  const addTag = () => { const t = tagDraft.trim(); if (t && !tags.includes(t)) { setTags([...tags, t]); setTagDraft(''); } };

  async function submit(e) {
    e.preventDefault();
    if (!title.trim()) { toast.error('A title is required'); return; }
    if (!type) { toast.error('Pick a work item type'); return; }
    const fields = {
      'System.Title': title.trim(),
      ...(description.trim() ? { 'System.Description': description.trim() } : {}),
      ...(areaPath.trim() ? { 'System.AreaPath': areaPath.trim() } : {}),
      ...(iterationPath.trim() ? { 'System.IterationPath': iterationPath.trim() } : {}),
      ...(priority ? { 'Microsoft.VSTS.Common.Priority': Number(priority) } : {}),
      ...(tags.length ? { 'System.Tags': tags.join('; ') } : {}),
    };
    setBusy(true);
    try {
      const created = await api.wiCreate({ project, type, fields });
      toast.success(`Created work item #${created.id}`);
      navigate(`/work-item/${created.id}`);
    } catch (err) {
      toast.error(`Create failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  if (types.loading) return <Loading label="Loading work item types…" />;

  return (
    <div style={{ maxWidth: 720 }}>
      <Link to="/work-items/assigned" className="btn sm ghost no-print" style={{ marginBottom: 12 }}><ArrowLeft size={14} /> Work items</Link>
      <h2 className="section-title"><Plus size={20} /> New Work Item</h2>

      <form onSubmit={submit} className="card card-pad" style={{ display: 'grid', gap: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted" style={{ fontSize: 12 }}>Project</span>
            <select value={project} onChange={(e) => setProject(e.target.value)} style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
              {(projects.length ? projects : [{ name: config.project }]).map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted" style={{ fontSize: 12 }}>Type</span>
            <select value={type} onChange={(e) => setType(e.target.value)} style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
              {typeList.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          </label>
        </div>

        <label style={{ display: 'grid', gap: 4 }}>
          <span className="muted" style={{ fontSize: 12 }}>Title <span style={{ color: 'var(--red)' }}>*</span></span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short summary" style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6 }} />
        </label>

        <label style={{ display: 'grid', gap: 4 }}>
          <span className="muted" style={{ fontSize: 12 }}>Description</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} placeholder="Describe the work…" style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, resize: 'vertical' }} />
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: 12 }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted" style={{ fontSize: 12 }}>Area path</span>
            <input value={areaPath} onChange={(e) => setAreaPath(e.target.value)} placeholder={`${project}\\…`} style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6 }} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted" style={{ fontSize: 12 }}>Iteration path</span>
            <input value={iterationPath} onChange={(e) => setIterationPath(e.target.value)} placeholder={`${project}\\…`} style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6 }} />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="muted" style={{ fontSize: 12 }}>Priority</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} style={{ padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6 }}>
              <option value="">—</option>
              {[1, 2, 3, 4].map((p) => <option key={p} value={p}>P{p}</option>)}
            </select>
          </label>
        </div>

        <div style={{ display: 'grid', gap: 4 }}>
          <span className="muted" style={{ fontSize: 12 }}>Tags</span>
          <div className="label-row" style={{ marginBottom: 4 }}>
            {tags.map((t) => (
              <span key={t} className="badge pr-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Tag size={10} /> {t}
                <button type="button" className="btn xs ghost" style={{ padding: 0, marginLeft: 2 }} onClick={() => setTags(tags.filter((x) => x !== t))}><X size={10} /></button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} placeholder="Add tag…" style={{ flex: 1, padding: '6px 9px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
            <button type="button" className="btn sm" onClick={addTag} disabled={!tagDraft.trim()}><Plus size={12} /></button>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><WiTypeBadge type={type} /></span>
          <div style={{ flex: 1 }} />
          <Link className="btn" to="/work-items/assigned">Cancel</Link>
          <button type="submit" className="btn primary" disabled={busy || !title.trim()}><Plus size={14} /> Create</button>
        </div>
      </form>
    </div>
  );
}
