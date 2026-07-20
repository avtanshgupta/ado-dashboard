import { useState, useCallback, useMemo, Fragment } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/useAsync.js';
import { useToast, Markdown, Avatar, Loading } from './ui.jsx';
import { TemplateMenu } from './TemplateMenu.jsx';
import {
  ChevronRight, ChevronDown, MessageSquare, Plus, X, Check, GitMerge, Sparkles, Trash2,
} from './icons.jsx';

const CT_META = {
  add: { label: 'added', cls: 'ct-add' },
  delete: { label: 'deleted', cls: 'ct-del' },
  rename: { label: 'renamed', cls: 'ct-rename' },
  edit: { label: 'modified', cls: 'ct-edit' },
};

const REASON_TEXT = {
  binary: 'Binary file — not shown',
  toobig: 'File too large to diff inline',
  error: 'Could not load this file',
  nocontent: 'No content available',
};

/** Wrap text in a ```suggestion block (A5). */
function toSuggestion(text) {
  return '```suggestion\n' + text.replace(/\s+$/, '') + '\n```';
}

/** Inline compose box: stage into a review (A3), post now, or make a suggestion (A5). */
function LineCompose({ line, onStage, onPostNow, onCancel }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const suggest = () => setText((t) => (t.trim() ? t : line?.text || ''));
  const asSuggestion = () => setText((t) => toSuggestion(t.trim() || line?.text || ''));

  async function postNow() {
    const content = text.trim();
    if (!content || busy) return;
    setBusy(true);
    try { await onPostNow(content); } finally { setBusy(false); }
  }
  function stage() {
    const content = text.trim();
    if (!content) return;
    onStage(content);
  }

  return (
    <div className="diff-compose">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Comment on this line… (Markdown supported)"
        rows={2}
        autoFocus
      />
      <div className="diff-compose-actions">
        <button className="btn xs" onClick={asSuggestion} title="Wrap as a ```suggestion block that the author can apply">
          <Sparkles size={12} /> Suggestion
        </button>
        <button className="btn xs" onClick={suggest} title="Prefill with the line text" style={{ opacity: 0.85 }}>Prefill</button>
        <TemplateMenu onPick={(body) => setText((t) => (t.trim() ? `${t}\n\n${body}` : body))} />
        <div className="grow" />
        <button className="btn xs" onClick={onCancel}><X size={12} /> Cancel</button>
        <button className="btn xs" onClick={stage} disabled={!text.trim()} title="Add to your review batch">
          <Plus size={12} /> Add to review
        </button>
        <button className="btn xs primary" onClick={postNow} disabled={busy || !text.trim()}>
          {busy ? 'Posting…' : 'Comment now'}
        </button>
      </div>
    </div>
  );
}

/** Existing inline discussion threads anchored to a line (read-only here). */
function InlineThreads({ threads }) {
  if (!threads.length) return null;
  return (
    <>
      {threads.map((t) => (
        <tr key={t.id} className="diff-thread-row">
          <td colSpan={3}>
            <div className={`diff-thread ${t.isActive ? 'active' : 'resolved'}`}>
              <div className="diff-thread-head">
                <MessageSquare size={12} />
                <span className="muted">{t.isActive ? 'Open thread' : 'Resolved'}</span>
              </div>
              {(t.comments || []).map((c, i) => (
                <div key={i} className="diff-thread-comment">
                  <span className="diff-thread-author"><Avatar name={c.author} size={16} /> {c.author}</span>
                  <Markdown text={c.content} className="diff-md" />
                </div>
              ))}
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

/** One expandable file with its diff hunks. */
function FileDiff({ repo, id, file, threadsByLine, staged, onStage, onUnstage, onPosted }) {
  const [open, setOpen] = useState(false);
  const [composeLine, setComposeLine] = useState(null); // line.newNo currently composing
  const toast = useToast();
  const meta = CT_META[file.changeType] || CT_META.edit;

  const { data, loading, error } = useAsync(
    () => (open ? api.prFileDiff(repo, id, file.path, file.changeType, file.originalPath) : Promise.resolve(null)),
    [open, repo, id, file.path]
  );

  const stagedForFile = staged.filter((s) => s.filePath === file.path);

  async function postNow(line, content) {
    try {
      await api.addInlineComment(repo, id, file.path, line, content);
      toast.success('Comment posted');
      setComposeLine(null);
      onPosted?.();
    } catch (e) {
      toast.error(`Comment failed: ${e.message}`);
    }
  }

  return (
    <div className={`diff-file ${open ? 'open' : ''}`}>
      <button className="diff-file-head" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className={`badge ct-badge ${meta.cls}`}>{meta.label}</span>
        <span className="diff-file-path">{file.path.replace(/^\//, '')}</span>
        {stagedForFile.length > 0 && <span className="badge diff-staged-chip">{stagedForFile.length} staged</span>}
        {threadsByLine.has(file.path) && <span className="badge count-pill has"><MessageSquare size={11} /> {[...threadsByLine.get(file.path).values()].reduce((a, l) => a + l.length, 0)}</span>}
      </button>
      {open && (
        <div className="diff-file-body">
          {loading && <Loading label="Loading diff…" />}
          {error && <div className="muted diff-note">Could not load diff: {error.message}</div>}
          {data && data.reason && <div className="muted diff-note">{REASON_TEXT[data.reason] || 'Not shown'}</div>}
          {data && !data.reason && data.hunks.length === 0 && <div className="muted diff-note">No textual changes.</div>}
          {data && !data.reason && data.hunks.map((h, hi) => {
            const fileThreads = threadsByLine.get(file.path);
            return (
              <table key={hi} className="diff-table">
                <tbody>
                  <tr className="diff-hunk-head">
                    <td colSpan={3}>@@ -{h.oldStart},{h.oldLines} +{h.newStart},{h.newLines} @@</td>
                  </tr>
                  {h.lines.map((l, li) => {
                    const lineNo = l.newNo;
                    const lineThreads = lineNo && fileThreads ? fileThreads.get(lineNo) || [] : [];
                    const lineStaged = stagedForFile.filter((s) => s.line === lineNo);
                    const canComment = l.type !== 'del' && l.type !== 'meta' && lineNo != null;
                    return (
                      <Fragment key={`${hi}-${li}`}>
                        <tr className={`diff-line diff-${l.type}`}>
                          <td className="diff-gutter">{l.oldNo ?? ''}</td>
                          <td className="diff-gutter">{l.newNo ?? ''}</td>
                          <td className="diff-code">
                            <span className="diff-sign">{l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' '}</span>
                            <span className="diff-text">{l.text || '\u00a0'}</span>
                            {canComment && (
                              <button className="diff-add-comment" title="Comment on this line" onClick={() => setComposeLine(composeLine === lineNo ? null : lineNo)}>
                                <Plus size={11} />
                              </button>
                            )}
                          </td>
                        </tr>
                        {lineStaged.map((s) => (
                          <tr key={s.key} className="diff-staged-row">
                            <td colSpan={3}>
                              <div className="diff-staged">
                                <span className="badge diff-staged-chip">staged</span>
                                <Markdown text={s.content} className="diff-md" />
                                <button className="btn xs" onClick={() => onUnstage(s.key)}><Trash2 size={11} /> Remove</button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {composeLine === lineNo && (
                          <tr className="diff-compose-row">
                            <td colSpan={3}>
                              <LineCompose
                                line={l}
                                onStage={(content) => { onStage({ filePath: file.path, line: lineNo, content, lineText: l.text }); setComposeLine(null); }}
                                onPostNow={(content) => postNow(lineNo, content)}
                                onCancel={() => setComposeLine(null)}
                              />
                            </td>
                          </tr>
                        )}
                        <InlineThreads threads={lineThreads} />
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Inline code diff viewer (A1) with per-line comments, batched "start a review"
 * (A3), and a ```suggestion helper (A5). `threads` are the PR's discussion
 * threads (from the detail view) so existing inline comments anchor to their line.
 */
export function DiffView({ repo, id, threads = [], onPosted }) {
  const toast = useToast();
  const [staged, setStaged] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const { data, loading, error, refetch } = useAsync(() => api.prDiffFiles(repo, id), [repo, id]);

  // Map filePath → (lineNo → [threads]) for anchoring existing inline comments.
  const threadsByLine = useMemo(() => {
    const m = new Map();
    for (const t of threads) {
      const ctx = t.context;
      if (!ctx?.filePath || !ctx.line) continue;
      if (!m.has(ctx.filePath)) m.set(ctx.filePath, new Map());
      const byLine = m.get(ctx.filePath);
      if (!byLine.has(ctx.line)) byLine.set(ctx.line, []);
      byLine.get(ctx.line).push(t);
    }
    return m;
  }, [threads]);

  const onStage = useCallback((c) => {
    setStaged((s) => [...s, { ...c, key: `${c.filePath}:${c.line}:${Math.random().toString(36).slice(2, 7)}` }]);
  }, []);
  const onUnstage = useCallback((key) => setStaged((s) => s.filter((x) => x.key !== key)), []);

  async function submitReview() {
    if (!staged.length || submitting) return;
    setSubmitting(true);
    try {
      const res = await api.submitReview(repo, id, staged.map((s) => ({ filePath: s.filePath, line: s.line, content: s.content })));
      if (res.failed) toast.error(`${res.posted} posted, ${res.failed} failed`);
      else toast.success(`Review submitted — ${res.posted} comment${res.posted === 1 ? '' : 's'} posted`);
      setStaged([]);
      onPosted?.();
    } catch (e) {
      toast.error(`Submit failed: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Loading label="Loading changed files…" />;
  if (error) return <div className="muted diff-note">Could not load changed files: {error.message}</div>;
  const files = data?.files || [];
  if (!files.length) return <div className="muted diff-note">No file changes found for this pull request.</div>;

  return (
    <div className="diff-view">
      <div className="diff-view-head muted">
        {files.length} file{files.length === 1 ? '' : 's'} changed{data.truncated ? ' (showing first 500)' : ''}
      </div>
      {files.map((f) => (
        <FileDiff
          key={f.path}
          repo={repo}
          id={id}
          file={f}
          threadsByLine={threadsByLine}
          staged={staged}
          onStage={onStage}
          onUnstage={onUnstage}
          onPosted={() => { onPosted?.(); refetch(); }}
        />
      ))}
      {staged.length > 0 && (
        <div className="diff-review-bar no-print">
          <span><Check size={14} /> {staged.length} comment{staged.length === 1 ? '' : 's'} staged</span>
          <div className="grow" />
          <button className="btn sm" onClick={() => setStaged([])} disabled={submitting}>Discard</button>
          <button className="btn sm primary" onClick={submitReview} disabled={submitting}>
            <GitMerge size={13} /> {submitting ? 'Submitting…' : 'Submit review'}
          </button>
        </div>
      )}
    </div>
  );
}
