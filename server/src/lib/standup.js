// D2 — stand-up / daily summary. Pure builders that turn the user's PR lists into
// a copy-paste stand-up (Markdown) and a minimal ICS reminder. No I/O here.

const DAY_MS = 86400000;

function line(pr) {
  return `${pr.title} (${pr.repo} !${pr.id})`;
}

/**
 * Build a stand-up summary object from the user's created + assigned lists and
 * recently-merged PRs. `sinceMs` bounds the "merged" (done) section.
 */
export function buildStandup({ created = [], assignedMe = [], merged = [] }, { now = Date.now(), sinceMs } = {}) {
  const since = sinceMs ?? now - DAY_MS;
  const done = merged
    .filter((p) => p.closedDate && new Date(p.closedDate).getTime() >= since)
    .map((p) => ({ id: p.id, repo: p.repo, title: p.title, webUrl: p.webUrl }));

  const inProgress = created
    .filter((p) => p.state === 'Open' || p.state === 'Draft')
    .map((p) => ({ id: p.id, repo: p.repo, title: p.title, webUrl: p.webUrl, state: p.state, reviewStatus: p.reviewStatus }));

  // Blocked = my open PRs with a failing/expired gate, changes requested, or a conflict.
  const blocked = created.filter((p) => {
    if (p.state !== 'Open') return false;
    const pipe = p.pipeline?.overall;
    const conflict = p.merge ? p.merge.noConflicts === false : false;
    return pipe === 'Failed' || pipe === 'Expired' || p.reviewStatus === 'Changes Requested' || conflict;
  }).map((p) => ({
    id: p.id, repo: p.repo, title: p.title, webUrl: p.webUrl,
    why: p.reviewStatus === 'Changes Requested' ? 'changes requested'
      : p.pipeline?.overall === 'Failed' ? 'CI failed'
      : p.pipeline?.overall === 'Expired' ? 'CI expired'
      : 'merge conflict',
  }));

  const reviewing = assignedMe
    .filter((p) => !p.myReview?.reviewed)
    .map((p) => ({ id: p.id, repo: p.repo, title: p.title, webUrl: p.webUrl, author: p.createdBy?.displayName }));

  return { generatedAt: new Date(now).toISOString(), done, inProgress, blocked, reviewing };
}

/** Render a stand-up object as Markdown. */
export function standupMarkdown(s) {
  const section = (title, items, render) =>
    `### ${title}\n${items.length ? items.map((i) => `- ${render(i)}`).join('\n') : '- _nothing_'}`;
  return [
    `## Stand-up — ${new Date(s.generatedAt).toLocaleDateString()}`,
    section('✅ Recently merged', s.done, line),
    section('🔧 In progress', s.inProgress, (p) => `${line(p)} — ${p.reviewStatus || p.state}`),
    section('🚧 Blocked', s.blocked, (p) => `${line(p)} — ${p.why}`),
    section('👀 Reviewing', s.reviewing, (p) => `${line(p)}${p.author ? ` — by ${p.author}` : ''}`),
  ].join('\n\n');
}

function icsDate(d) {
  return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Minimal ICS VEVENT reminding you to review your open work. */
export function standupIcs(s, { at } = {}) {
  const start = at ? new Date(at) : new Date(Date.now() + 60 * 60 * 1000);
  const end = new Date(start.getTime() + 15 * 60 * 1000);
  const counts = `${s.reviewing.length} to review · ${s.blocked.length} blocked · ${s.inProgress.length} in progress`;
  const uid = `standup-${start.getTime()}@ado-pr-dashboard`;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ADO PR Dashboard//Standup//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${icsDate(s.generatedAt)}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    'SUMMARY:PR stand-up',
    `DESCRIPTION:${counts}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
