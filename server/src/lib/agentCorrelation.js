/**
 * Agent ↔ pull-request correlation and per-machine activity timelines.
 *
 * Pure, dependency-free helpers (no ADO / config access) so they are trivially
 * unit-tested. The service/route layer supplies already-fetched data:
 *   - `groups`  — machine groups from agentSessionService.getSessionsByMachine()
 *   - `prs`     — the open-PR snapshot from prService.snapshotState()
 */

/** Canonical `repo#branch` match key (case-insensitive repo, exact branch). */
export function sessionKey(repo, branch) {
  if (!repo || !branch) return null;
  return `${String(repo).toLowerCase()}#${branch}`;
}

/** Compact, UI-friendly projection of a snapshot PR. */
function compactPr(pr) {
  return {
    id: pr.id,
    title: pr.title || '',
    category: pr.category || null,
    state: pr.state || null,
    isDraft: !!pr.isDraft,
    reviewStatus: pr.reviewStatus || null,
    pipeline: (pr.pipeline && pr.pipeline.overall) || null,
    author: pr.createdBy?.displayName || null,
    webUrl: pr.webUrl || '',
  };
}

/**
 * Correlate live agent sessions to the open PRs on their repo + source branch.
 *
 * Returns `{ matches: { "repo#branch": { count, url, prs: [compactPr…] } } }`.
 * Only live (non-`ended`) sessions that carry both a repo and a branch create
 * keys, so ended sessions never surface stale PR links. Back-compatible with the
 * previous shape: `count` and `url` are preserved and `prs` is additive.
 */
export function matchSessionsToPrs(groups, prs) {
  const wanted = new Set();
  for (const g of groups || []) {
    for (const s of g.sessions || []) {
      if (s.status === 'ended') continue;
      const k = sessionKey(s.repo, s.branch);
      if (k) wanted.add(k);
    }
  }

  const matches = {};
  if (wanted.size === 0) return { matches };

  for (const pr of prs || []) {
    const k = sessionKey(pr.repo, pr.sourceBranch);
    if (!k || !wanted.has(k)) continue;
    if (!matches[k]) matches[k] = { count: 0, url: '', prs: [] };
    matches[k].count += 1;
    matches[k].prs.push(compactPr(pr));
  }

  // Newest PR first; `url` points at the first listed PR for the legacy link.
  for (const m of Object.values(matches)) {
    m.prs.sort((a, b) => (b.id || 0) - (a.id || 0));
    m.url = m.prs[0]?.webUrl || '';
  }
  return { matches };
}

const TIMELINE_CAP = 50;

/**
 * Flatten a machine group's sessions into a single newest-first activity
 * timeline from each session's recorded status history. Each entry is
 * `{ t, sessionId, status, repo, branch }`. Entries with an unparseable
 * timestamp are dropped; the result is capped at `limit`.
 */
export function buildMachineTimeline(group, { limit = TIMELINE_CAP } = {}) {
  const entries = [];
  for (const s of group?.sessions || []) {
    const label = s.sessionId || (s.id ? String(s.id).slice(0, 8) : '');
    for (const h of s.history || []) {
      const ts = h?.t ? new Date(h.t).getTime() : NaN;
      if (Number.isNaN(ts)) continue;
      entries.push({
        t: h.t,
        sessionId: label,
        status: h.status || 'unknown',
        repo: s.repo || '',
        branch: s.branch || '',
      });
    }
  }
  entries.sort((a, b) => new Date(b.t).getTime() - new Date(a.t).getTime());
  return entries.slice(0, Math.max(0, limit));
}
