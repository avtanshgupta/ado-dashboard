import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { writeJsonAtomic } from './atomicFile.js';
import { currentUser } from './context.js';

// E3 — per-user operational overlay: followed PRs + Action-Center snoozes and
// dismissals. Kept separate from userConfig because it mutates frequently and
// isn't a "setting". File-backed under DATA_DIR/state/<user>.json.
//
// Records are keyed by "repo#id". Each tracked repo belongs to exactly one
// project (repo names are unique), so this key is unique across every project —
// overlay state therefore aggregates across all projects at once.

const dir = join(config.dataDir, 'state');

function ensureDir() {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]/g, '_');
}
function fileFor(userId) {
  return join(dir, `${safeId(userId)}.json`);
}

function empty() {
  return { follows: [], snoozes: {}, dismissals: {} };
}

export function loadState(userId) {
  ensureDir();
  const f = fileFor(userId);
  if (!existsSync(f)) return empty();
  try {
    const s = JSON.parse(readFileSync(f, 'utf8'));
    return {
      follows: Array.isArray(s.follows) ? s.follows : [],
      snoozes: s.snoozes && typeof s.snoozes === 'object' ? s.snoozes : {},
      dismissals: s.dismissals && typeof s.dismissals === 'object' ? s.dismissals : {},
    };
  } catch {
    return empty();
  }
}

function save(userId, state) {
  ensureDir();
  writeJsonAtomic(fileFor(userId), state);
}

/** Overlay key: "repo#id" (unique across projects since repo names are). */
const key = (repo, id) => `${repo}#${id}`;
const sameFollow = (f, repo, id) => f.repo === repo && String(f.id) === String(id);

export function getState() {
  return loadState(currentUser().id);
}

/** Follow a PR (idempotent). */
export function addFollow(repo, id) {
  const uid = currentUser().id;
  const s = loadState(uid);
  if (!s.follows.some((f) => sameFollow(f, repo, id))) {
    s.follows.unshift({ repo, id: Number(id), addedAt: new Date().toISOString() });
    save(uid, s);
  }
  return s;
}

export function removeFollow(repo, id) {
  const uid = currentUser().id;
  const s = loadState(uid);
  s.follows = s.follows.filter((f) => !sameFollow(f, repo, id));
  save(uid, s);
  return s;
}

/** All followed PRs (across every tracked project). */
export function listFollows() {
  return getState().follows;
}

/** True if the PR is followed. */
export function isFollowing(repo, id) {
  return getState().follows.some((f) => sameFollow(f, repo, id));
}

/** Snooze an Action-Center item until `untilIso`. */
export function setSnooze(repo, id, untilIso) {
  const uid = currentUser().id;
  const s = loadState(uid);
  s.snoozes[key(repo, id)] = untilIso;
  save(uid, s);
  return s;
}

export function clearSnooze(repo, id) {
  const uid = currentUser().id;
  const s = loadState(uid);
  delete s.snoozes[key(repo, id)];
  save(uid, s);
  return s;
}

/** Dismiss an Action-Center item; `sig` captures the state so it re-appears on change. */
export function setDismiss(repo, id, sig) {
  const uid = currentUser().id;
  const s = loadState(uid);
  s.dismissals[key(repo, id)] = sig || '';
  save(uid, s);
  return s;
}

export function clearDismiss(repo, id) {
  const uid = currentUser().id;
  const s = loadState(uid);
  delete s.dismissals[key(repo, id)];
  save(uid, s);
  return s;
}

/**
 * The overlay keyed by "repo#id" for applyActionOverlay:
 * { snoozes, dismissals, follows(Set) }.
 */
export function getScopedOverlay() {
  const s = loadState(currentUser().id);
  const snoozes = {};
  const dismissals = {};
  // Keep only current "repo#id" keys (drops any legacy "project#repo#id" entries,
  // which self-heal via pruneScopedOverlay).
  for (const [k, v] of Object.entries(s.snoozes)) if (k.split('#').length === 2) snoozes[k] = v;
  for (const [k, v] of Object.entries(s.dismissals)) if (k.split('#').length === 2) dismissals[k] = v;
  const follows = new Set(listFollows().map((f) => `${f.repo}#${f.id}`));
  return { snoozes, dismissals, follows };
}

/**
 * Garbage-collect stale overlay state (#11): drop expired snoozes and any
 * dismissal whose item is gone or whose signature no longer matches — otherwise
 * a dismissal could permanently hide a later recurrence of the same state.
 * `currentSigByKey` maps "repo#id" -> signature for currently-actionable items.
 * Legacy "project#repo#id" keys have no current sig and are pruned too.
 */
export function pruneScopedOverlay(currentSigByKey, now = Date.now()) {
  const uid = currentUser().id;
  const s = loadState(uid);
  let changed = false;
  for (const k of Object.keys(s.snoozes)) {
    const t = new Date(s.snoozes[k]).getTime();
    if (Number.isNaN(t) || t <= now) { delete s.snoozes[k]; changed = true; }
  }
  for (const k of Object.keys(s.dismissals)) {
    const cur = currentSigByKey.get(k);
    if (cur === undefined || cur !== s.dismissals[k]) { delete s.dismissals[k]; changed = true; }
  }
  if (changed) save(uid, s);
}
