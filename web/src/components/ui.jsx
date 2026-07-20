import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { timeAgo, fmtDate, daysSinceDate } from '../lib/format.js';
import {
  CheckCircle2, XCircle, CircleDot, CircleDashed, Hourglass, Ban, Minus,
  MessageSquare, TriangleAlert, Info, Inbox, ShieldCheck, Clock,
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, LoaderCircle,
} from './icons.jsx';

marked.setOptions({ gfm: true, breaks: true });

// Open any links rendered from user markdown in a new, isolated tab.
if (typeof window !== 'undefined' && DOMPurify.isSupported) {
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
}

/**
 * Render Markdown (PR descriptions, comments) as sanitized HTML. ADO stores
 * these as markdown; author-supplied content is sanitized with DOMPurify to
 * neutralize any embedded HTML/script before insertion.
 */
export function Markdown({ text, className = '' }) {
  const src = (text ?? '').toString().trim();
  if (!src) return null;
  const html = DOMPurify.sanitize(marked.parse(src, { async: false }));
  return <div className={`markdown ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * Render trusted-source-but-author-supplied HTML (ADO work-item rich-text fields
 * — Description, Repro Steps, Acceptance Criteria — are stored as HTML, not
 * Markdown). Sanitized with DOMPurify before insertion; links open isolated.
 */
export function SafeHtml({ html, className = '' }) {
  const src = (html ?? '').toString().trim();
  if (!src) return null;
  const clean = DOMPurify.sanitize(src);
  return <div className={`markdown ${className}`} dangerouslySetInnerHTML={{ __html: clean }} />;
}


/* ---------------- Badges ---------------- */
export function Badge({ className = '', children, color }) {
  return (
    <span className={`badge ${className}`} style={color ? { color, background: 'transparent' } : undefined}>
      {children}
    </span>
  );
}

export function StateBadge({ state }) {
  return (
    <span className={`badge state-${state}`}>
      <span className="dot" /> {state}
    </span>
  );
}

export function ReviewBadge({ status, review }) {
  if (!status) return <span className="badge review-Pending">—</span>;
  const cls = status.replace(/\s/g, '');
  let title;
  if (review && typeof review.approvals === 'number' && typeof review.required === 'number') {
    title = `${review.approvals} of ${review.required} required approval${review.required === 1 ? '' : 's'}`;
    if (review.rejections) title += ` · ${review.rejections} rejection${review.rejections === 1 ? '' : 's'}`;
    if (review.waiting) title += ` · ${review.waiting} waiting for author`;
  }
  return <span className={`badge review-${cls}`} title={title}>{status}</span>;
}

/** The current user's own review state on a PR (assigned lists). */
export function MyReviewBadge({ review }) {
  const vote = review?.vote ?? 0;
  const map = {
    '10': { cls: 'myrev-approved', Icon: CheckCircle2, label: 'Approved', full: 'Approved' },
    '5': { cls: 'myrev-approved', Icon: CheckCircle2, label: 'Approved (sugg.)', full: 'Approved with suggestions' },
    '-5': { cls: 'myrev-waiting', Icon: Clock, label: 'Waiting', full: 'Waiting for author' },
    '-10': { cls: 'myrev-rejected', Icon: XCircle, label: 'Rejected', full: 'Rejected' },
  };
  const m = map[String(vote)];
  if (!m) {
    return (
      <span className="badge myrev-none" title="You haven't voted on this PR yet">
        Not reviewed
      </span>
    );
  }
  const { Icon } = m;
  return (
    <span className={`badge ${m.cls}`} title={`Your vote: ${m.full}`}>
      <Icon size={13} /> {m.label}
    </span>
  );
}

const PIPE_ICON = { Succeeded: CheckCircle2, Failed: XCircle, Running: CircleDot, Queued: CircleDashed, Pending: CircleDashed, Expired: Hourglass, None: Minus };
export function PipelineBadge({ status, title }) {
  const s = status || 'None';
  const Icon = PIPE_ICON[s] || Minus;
  return (
    <span className={`badge pipe-${s}`} title={title || undefined}>
      <Icon size={13} /> {s}
    </span>
  );
}

/** Build/pipeline run status badge. */
const RUN_ICON = {
  Succeeded: CheckCircle2, Completed: CheckCircle2, Failed: XCircle, Running: CircleDot,
  Queued: CircleDashed, Partial: TriangleAlert, Canceled: Ban, Cancelling: Ban, Unknown: Minus,
};
export function RunStatusBadge({ status, title }) {
  const s = status || 'Unknown';
  const Icon = RUN_ICON[s] || Minus;
  return (
    <span className={`badge run-${s}`} title={title || undefined}>
      <Icon size={13} /> {s}
    </span>
  );
}

export function RepoBadge({ repo, short }) {
  return <span className="badge repo">{short || repo}</span>;
}

export function CommentPill({ count }) {
  return (
    <span className={`badge count-pill ${count > 0 ? 'has' : ''}`} title={`${count} active comment(s)`}>
      <MessageSquare size={12} /> {count ?? 0}
    </span>
  );
}

export function PopBadge({ pop, compact }) {
  if (!pop) return null;
  const cls = pop.ok ? 'pop-ok' : pop.status === 'rejected' ? 'pop-no' : 'pop-pending';
  const Icon = pop.ok ? ShieldCheck : pop.status === 'rejected' ? XCircle : Hourglass;
  return (
    <span className={`badge ${cls}`} title={`Proof of Presence: ${pop.label}`}>
      <Icon size={13} /> {compact ? '' : 'PoP '}{pop.label}
    </span>
  );
}

/** A staleness badge: shows "Nd idle" once idle days cross a threshold, colored
 *  by severity. Accepts either a `days` number or a `date` to compute from. */
export function IdleTag({ date, days, threshold = 3 }) {
  const d = days != null ? days : daysSinceDate(date);
  if (d == null || d < threshold) return null;
  const cls = d >= 14 ? 'pipe-Failed' : d >= 7 ? 'pipe-Expired' : 'pipe-Queued';
  return (
    <span className={`badge ${cls}`} title={`Idle for ${d} day${d === 1 ? '' : 's'}`}>
      <Clock size={11} /> {d}d idle
    </span>
  );
}

/** Flags a PR whose enrichment (comments/pipeline/etc.) partially failed to load. */
export function PartialBadge({ parts }) {
  if (!parts || !parts.length) return null;
  const list = parts.join(', ');
  return (
    <span
      className="badge partial-badge"
      title={`Couldn't load: ${list}. Data may be incomplete — try Refresh.`}
      aria-label={`Partial data: ${list} failed to load`}
    >
      <TriangleAlert size={12} aria-hidden="true" /> partial
    </span>
  );
}

export function Avatar({ name, imageUrl, size = 28 }) {
  const initials = (name || '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4 }} title={name}>
      {imageUrl ? <img src={imageUrl} alt={name} /> : initials}
    </span>
  );
}

/* ---------------- Loading / Empty ---------------- */
export function Loading({ label = 'Loading…' }) {
  return (
    <div className="loading">
      <div className="spinner" />
      <div>{label}</div>
    </div>
  );
}

/** A lightweight "fetching fresh data" pill for stale-while-revalidate refreshes. */
export function RefreshingTag({ show, label = 'Updating…' }) {
  if (!show) return null;
  return (
    <span className="refreshing-tag" title="Showing cached data — fetching the latest…" aria-live="polite">
      <LoaderCircle size={12} className="spin" aria-hidden="true" /> {label}
    </span>
  );
}

export function Empty({ Icon = Inbox, label = 'Nothing here', action = null }) {
  return (
    <div className="empty">
      <Icon size={38} strokeWidth={1.5} aria-hidden="true" />
      <div>{label}</div>
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

// ---- live relative time ----
// One shared 60s ticker drives every <TimeAgo>, so relative timestamps stay
// fresh between data polls without N per-component intervals.
const tickListeners = new Set();
let tickTimer = null;
function subscribeTick(cb) {
  tickListeners.add(cb);
  if (!tickTimer) tickTimer = setInterval(() => tickListeners.forEach((l) => l()), 60000);
  return () => {
    tickListeners.delete(cb);
    if (tickListeners.size === 0 && tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  };
}

/** Relative timestamp that refreshes itself every minute (title = full date,
 *  unless a `title` override is provided). */
export function TimeAgo({ date, className, prefix = '', title }) {
  const [, force] = useState(0);
  useEffect(() => subscribeTick(() => force((n) => n + 1)), []);
  if (!date) return null;
  const tip = title ? `${title} · ${fmtDate(date)}` : fmtDate(date);
  return <span className={className} title={tip}>{prefix}{timeAgo(date)}</span>;
}

/** Client-side pagination controls for large tables. */
export function Pager({ page, pageSize, total, onPage, onPageSize, pageSizes = [25, 50, 100] }) {
  if (total === 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="pager no-print">
      <span className="muted" style={{ fontSize: 13 }}>{from}–{to} of {total}</span>
      <div className="grow" />
      <label className="muted" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
        Rows
        <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} aria-label="Rows per page">
          {pageSizes.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <button className="btn sm" disabled={page <= 1} onClick={() => onPage(1)} aria-label="First page"><ChevronsLeft size={14} /></button>
      <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft size={14} /> Prev</button>
      <span className="muted" style={{ fontSize: 13, whiteSpace: 'nowrap' }}>Page {page} / {totalPages}</span>
      <button className="btn sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page">Next <ChevronRight size={14} /></button>
      <button className="btn sm" disabled={page >= totalPages} onClick={() => onPage(totalPages)} aria-label="Last page"><ChevronsRight size={14} /></button>
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  return (
    <div className="empty">
      <TriangleAlert size={38} strokeWidth={1.5} style={{ color: 'var(--red)' }} aria-hidden="true" />
      <div style={{ color: 'var(--red)', fontWeight: 600 }}>Something went wrong</div>
      <div style={{ maxWidth: 520, textAlign: 'center' }}>{String(error?.message || error)}</div>
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

/* ---------------- Modal ---------------- */
export function Modal({ title, children, onClose, footer }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------- Toasts ---------------- */
const ToastCtx = createContext(null);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((message, type = 'info', ms = 4000) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);
  const api = {
    info: (m) => push(m, 'info'),
    success: (m) => push(m, 'success'),
    error: (m) => push(m, 'error', 6000),
  };
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => {
          const Icon = t.type === 'success' ? CheckCircle2 : t.type === 'error' ? TriangleAlert : Info;
          return (
            <div key={t.id} className={`toast ${t.type}`}>
              <Icon size={16} /> <span>{t.message}</span>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}
