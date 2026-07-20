import { structuredPatch } from 'diff';
import { adoGet, gitUrl } from '../lib/adoClient.js';

// Caps so a huge PR can't blow up memory / wall-clock. Metadata is cheap; the
// per-file diff is fetched lazily (two blobs + jsdiff) only when a file is opened.
const MAX_FILES = 500; // files listed in the changes summary
const MAX_BYTES = 400_000; // per-side blob size we're willing to diff
const DIFF_CONTEXT = 3; // unified-diff context lines

/** Map an ADO changeType to a compact token. */
function normChangeType(ct) {
  const s = String(ct || '').toLowerCase();
  if (s.includes('add')) return 'add';
  if (s.includes('delete')) return 'delete';
  if (s.includes('rename')) return 'rename';
  return 'edit';
}

/** Latest iteration's merge-base (common) and source commits — the real PR diff. */
async function getIterationCommits(repo, prId) {
  const iters = await adoGet(gitUrl(repo, `pullRequests/${prId}/iterations`), {
    query: { 'api-version': '7.1' },
  });
  const list = iters.value || [];
  if (!list.length) return null;
  const last = list[list.length - 1];
  return {
    iterationId: last.id,
    base: last.commonRefCommit?.commitId || last.targetRefCommit?.commitId || null,
    target: last.sourceRefCommit?.commitId || null,
  };
}

/**
 * List the files changed in a PR (cheap — no blob content). Each entry carries
 * the change type so the UI can badge add/edit/delete/rename and lazy-load the
 * actual diff per file.
 */
export async function getPrDiffFiles(repo, prId) {
  const commits = await getIterationCommits(repo, prId);
  if (!commits) return { files: [], base: null, target: null, truncated: false };
  const changes = await adoGet(
    gitUrl(repo, `pullRequests/${prId}/iterations/${commits.iterationId}/changes`),
    { query: { 'api-version': '7.1', '$top': MAX_FILES + 1 } }
  );
  const entries = (changes.changeEntries || []).filter(
    (c) => c.item && c.item.gitObjectType !== 'tree' && c.item.path
  );
  const truncated = entries.length > MAX_FILES;
  const files = entries.slice(0, MAX_FILES).map((c) => ({
    path: c.item.path,
    originalPath: c.sourceServerItem || c.originalPath || null,
    changeType: normChangeType(c.changeType),
  }));
  return { files, base: commits.base, target: commits.target, truncated };
}

/** Fetch a file's text content at a commit, or null if missing/binary/too big. */
async function fetchItemContent(repo, path, commitId) {
  if (!commitId || !path) return { content: null, reason: 'missing' };
  try {
    // cache:false — blobs can be large; don't pollute the shared per-user cache.
    const data = await adoGet(gitUrl(repo, 'items'), {
      query: {
        path,
        'versionDescriptor.version': commitId,
        'versionDescriptor.versionType': 'commit',
        includeContent: true,
        includeContentMetadata: true,
        'api-version': '7.1',
      },
      cache: false,
    });
    if (data?.contentMetadata?.isBinary) return { content: null, reason: 'binary' };
    const content = typeof data?.content === 'string' ? data.content : null;
    if (content == null) return { content: null, reason: 'nocontent' };
    if (content.length > MAX_BYTES) return { content: null, reason: 'toobig' };
    if (content.includes('\u0000')) return { content: null, reason: 'binary' };
    return { content, reason: null };
  } catch (e) {
    // A 404 means the file doesn't exist on that side (added/deleted) → empty.
    if (e.status === 404) return { content: '', reason: null };
    // Auth failures must propagate so the SPA can prompt a re-auth, not be
    // silently turned into an "undiffable" file.
    if (e.status === 401 || e.status === 403) throw e;
    return { content: null, reason: 'error' };
  }
}

/** Turn a jsdiff hunk into typed lines with running old/new line numbers. */
function shapeHunk(h) {
  let oldNo = h.oldStart;
  let newNo = h.newStart;
  const lines = [];
  for (const raw of h.lines) {
    const tag = raw[0];
    const text = raw.slice(1);
    if (tag === '+') lines.push({ type: 'add', text, newNo: newNo++ });
    else if (tag === '-') lines.push({ type: 'del', text, oldNo: oldNo++ });
    else if (tag === '\\') lines.push({ type: 'meta', text }); // "No newline at end of file"
    else lines.push({ type: 'context', text, oldNo: oldNo++, newNo: newNo++ });
  }
  return { oldStart: h.oldStart, oldLines: h.oldLines, newStart: h.newStart, newLines: h.newLines, lines };
}

/**
 * Pure: compute typed diff hunks + add/del counts between two file versions.
 * Separated from I/O so the line-numbering logic is unit-testable.
 */
export function computeFileDiff(path, oldStr, newStr, changeType = 'edit') {
  const patch = structuredPatch(path, path, oldStr ?? '', newStr ?? '', '', '', { context: DIFF_CONTEXT });
  const hunks = (patch.hunks || []).map(shapeHunk);
  let additions = 0;
  let deletions = 0;
  for (const h of hunks) for (const l of h.lines) {
    if (l.type === 'add') additions++;
    else if (l.type === 'del') deletions++;
  }
  return { path, changeType, isBinary: false, reason: null, hunks, additions, deletions };
}

/**
 * Compute the unified diff for a single file in a PR. Returns hunks plus add/del
 * counts, or a reason when the file can't be diffed inline (binary/too big).
 */
export async function getPrFileDiff(repo, prId, path, hints = {}) {
  if (!path) {
    const e = new Error('path is required'); e.status = 400; throw e;
  }
  const commits = await getIterationCommits(repo, prId);
  if (!commits) {
    const e = new Error('Pull request has no iterations to diff.'); e.status = 404; throw e;
  }
  // For a rename the base lives at the original path; otherwise both sides use
  // the current path. `hints` come from the (authoritative) change list.
  const hintType = hints.changeType || null;
  const basePath = hintType === 'rename' && hints.originalPath ? hints.originalPath : path;
  const [baseRes, targetRes] = await Promise.all([
    fetchItemContent(repo, basePath, commits.base),
    fetchItemContent(repo, path, commits.target),
  ]);

  const changeType =
    hintType ||
    (baseRes.content === '' || baseRes.content == null
      ? targetRes.content
        ? 'add'
        : 'edit'
      : targetRes.content === '' || targetRes.content == null
        ? 'delete'
        : 'edit');

  // Undiffable if either side is binary/too big/errored (empty string is fine).
  const undiffable = [baseRes, targetRes].find((r) => r.content == null && r.reason && r.reason !== 'missing');
  if (undiffable) {
    return { path, changeType, isBinary: undiffable.reason === 'binary', reason: undiffable.reason, hunks: [], additions: 0, deletions: 0 };
  }

  return computeFileDiff(path, baseRes.content || '', targetRes.content || '', changeType);
}
