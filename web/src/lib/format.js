// The IANA time zone used to render all absolute dates/times in the app. It is a
// module-level value (default IST) set once from the user's config at bootstrap
// and whenever the setting changes — so every fmtDate/fmtDateShort call across
// the app renders in the chosen zone without threading it through each caller.
export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';
let currentTimeZone = DEFAULT_TIME_ZONE;

/** Set the active time zone (falls back to IST for an empty/invalid value). */
export function setTimeZone(tz) {
  if (typeof tz === 'string' && tz.trim()) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz.trim() });
      currentTimeZone = tz.trim();
      return;
    } catch {
      /* keep the previous zone on an invalid value */
    }
  }
}

/** The active time zone. */
export function getTimeZone() {
  return currentTimeZone;
}

/** Curated IANA zones for the Settings picker (IST first). */
export const COMMON_TIME_ZONES = [
  { tz: 'Asia/Kolkata', label: 'India — IST (Asia/Kolkata)' },
  { tz: 'UTC', label: 'UTC' },
  { tz: 'America/Los_Angeles', label: 'US Pacific (Los Angeles)' },
  { tz: 'America/Denver', label: 'US Mountain (Denver)' },
  { tz: 'America/Chicago', label: 'US Central (Chicago)' },
  { tz: 'America/New_York', label: 'US Eastern (New York)' },
  { tz: 'America/Sao_Paulo', label: 'Brazil (São Paulo)' },
  { tz: 'Europe/London', label: 'UK (London)' },
  { tz: 'Europe/Berlin', label: 'Central Europe (Berlin)' },
  { tz: 'Europe/Moscow', label: 'Moscow' },
  { tz: 'Asia/Dubai', label: 'Gulf (Dubai)' },
  { tz: 'Asia/Karachi', label: 'Pakistan (Karachi)' },
  { tz: 'Asia/Singapore', label: 'Singapore' },
  { tz: 'Asia/Shanghai', label: 'China (Shanghai)' },
  { tz: 'Asia/Tokyo', label: 'Japan (Tokyo)' },
  { tz: 'Australia/Sydney', label: 'Australia (Sydney)' },
  { tz: 'Pacific/Auckland', label: 'New Zealand (Auckland)' },
];

export function timeAgo(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function fmtDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: currentTimeZone,
  });
}

export function fmtDateShort(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: currentTimeZone,
  });
}

/** Whole days since a timestamp (>=0), or null if missing/unparseable. */
export function daysSinceDate(dateStr) {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

export const STATE_COLORS = {
  Open: '#1f883d',
  Draft: '#9a6700',
  Merged: '#8250df',
  Closed: '#cf222e',
};

export const REVIEW_COLORS = {
  Approved: '#1f883d',
  'Partially Approved': '#0969da',
  'Not Approved': '#6e7781',
  Pending: '#6e7781',
  'Waiting for Author': '#9a6700',
  'Changes Requested': '#cf222e',
};

export const PIPELINE_COLORS = {
  Succeeded: '#1f883d',
  Running: '#0969da',
  Queued: '#6e7781',
  Failed: '#cf222e',
  Pending: '#9a6700',
  Expired: '#bc4c00',
  None: '#8c959f',
};

export const REPO_SHORT = {
  'WD.Client.Linux': 'Linux',
  'WD.Client.Mac': 'Mac',
  'WD.Client.Linux.eBPF': 'eBPF',
  'WD.Client.Linux.Installer': 'Installer',
};

export function repoShort(repo) {
  return REPO_SHORT[repo] || repo;
}

/** Tail segment of an ADO tree path (Project\Area\Sub → Sub). */
export function shortPath(path) {
  if (!path) return '';
  const parts = String(path).split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || String(path);
}

/**
 * Extract a clean version token from a reporter's raw `--version` output.
 * e.g. "GitHub Copilot CLI 1.0.74-1. Run 'copilot update'…" → "1.0.74-1".
 * Falls back to a trimmed, length-capped string when no version pattern matches.
 */
export function cleanVersion(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  const m = s.match(/\d+\.\d+(?:\.\d+)?(?:-\w+)?/);
  return m ? m[0] : s.replace(/^v/i, '').slice(0, 24);
}

export const RUN_STATUS_COLORS = {
  Succeeded: '#1f883d',
  Running: '#0969da',
  Queued: '#6e7781',
  Failed: '#cf222e',
  Partial: '#9a6700',
  Canceled: '#57606a',
  Cancelling: '#57606a',
  Completed: '#57606a',
  Unknown: '#8c959f',
};

/** Human-readable duration from milliseconds. */
export function fmtDuration(ms) {
  if (ms == null || Number.isNaN(Number(ms)) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

/**
 * A gating build is "in flight" (already running or queued) when its current
 * status is running/queued — re-triggering it is not allowed. Expired builds
 * report a queued status from ADO but carry effectiveStatus 'expired', so they
 * stay re-runnable (that's the main re-run case).
 */
export function isGateInFlight(build) {
  const s = build?.effectiveStatus || build?.status;
  return s === 'running' || s === 'queued';
}

/** Builds on a PR that can be re-triggered (i.e. not currently in flight). */
export function rerunnableBuilds(pr) {
  return (pr?.pipeline?.builds || []).filter((b) => !isGateInFlight(b));
}

/** Whether the PR has at least one gate that can be re-triggered. */
export function canRerunGate(pr) {
  return rerunnableBuilds(pr).length > 0;
}
