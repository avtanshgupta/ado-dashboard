import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { currentUser, currentConfig } from '../lib/context.js';
import { writeJsonAtomic } from '../lib/atomicFile.js';
import { snapshotState } from './prService.js';

const dataDir = join(config.dataDir, 'notif');

function ensureDir() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
}
function safeId(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]/g, '_');
}
function fileFor(userId) {
  return join(dataDir, `${safeId(userId)}.json`);
}
function load(userId) {
  ensureDir();
  const f = fileFor(userId);
  if (!existsSync(f)) return { snapshot: {}, items: [], initialized: false };
  return JSON.parse(readFileSync(f, 'utf8'));
}
function save(userId, store) {
  ensureDir();
  writeJsonAtomic(fileFor(userId), store);
}

export function getNotifications({ unreadOnly = false } = {}) {
  const store = load(currentUser().id);
  let items = store.items || [];
  if (unreadOnly) items = items.filter((i) => !i.read);
  return { items: items.slice(0, 200), unread: (store.items || []).filter((i) => !i.read).length };
}

export function markRead(ids) {
  const uid = currentUser().id;
  const store = load(uid);
  const idSet = new Set(ids);
  for (const item of store.items || []) {
    if (idSet.size === 0 || idSet.has(item.id)) item.read = true;
  }
  save(uid, store);
  return getNotifications();
}

const key = (pr) => `${pr.repo}#${pr.id}`;
function snapEntry(pr) {
  return {
    title: pr.title,
    state: pr.state,
    category: pr.category,
    activeComments: pr.activeComments ?? 0,
    pipeline: pr.pipeline?.overall ?? 'None',
    reviewStatus: pr.reviewStatus,
    webUrl: pr.webUrl,
    author: pr.createdBy?.displayName,
  };
}
function makeItem(type, pr, message) {
  return {
    id: `${type}:${key(pr)}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
    type,
    repo: pr.repo,
    prId: pr.id,
    category: pr.category,
    title: pr.title,
    message,
    webUrl: pr.webUrl,
    timestamp: new Date().toISOString(),
    read: false,
  };
}

export async function poll() {
  const uid = currentUser().id;
  const cfg = currentConfig();
  const prefs = cfg.notificationPrefs;
  const mutedRepos = cfg.mutedRepoSet || new Set();
  const store = load(uid);
  const current = await snapshotState();
  const currentMap = {};
  for (const pr of current) currentMap[key(pr)] = snapEntry(pr);

  if (!store.initialized) {
    store.snapshot = currentMap;
    store.initialized = true;
    save(uid, store);
    return { newItems: [], unread: getNotifications().unread };
  }

  const prev = store.snapshot || {};
  const newItems = [];
  for (const pr of current) {
    const k = key(pr);
    const before = prev[k];
    const now = currentMap[k];
    if (!before) {
      if (prefs.newPr && (pr.category === 'team' || pr.category === 'assigned')) {
        newItems.push(makeItem('new-pr', pr, `New ${pr.category} PR by ${now.author}: ${pr.title}`));
      }
      continue;
    }
    if (prefs.newComment && now.activeComments > before.activeComments) {
      newItems.push(
        makeItem('new-comment', pr, `${now.activeComments - before.activeComments} new active comment(s) on "${pr.title}"`)
      );
    }
    if (prefs.reviewChange && now.reviewStatus !== before.reviewStatus) {
      newItems.push(makeItem('review-change', pr, `Review status changed to ${now.reviewStatus} on "${pr.title}"`));
    }
    if (now.pipeline !== before.pipeline) {
      if (prefs.pipelineFailed && now.pipeline === 'Failed') {
        newItems.push(makeItem('pipeline-failed', pr, `Pipeline failed on "${pr.title}"`));
      } else if (prefs.pipelineSucceeded && now.pipeline === 'Succeeded') {
        newItems.push(makeItem('pipeline-succeeded', pr, `Pipeline succeeded on "${pr.title}"`));
      }
    }
  }
  if (prefs.prClosed) {
    for (const k of Object.keys(prev)) {
      if (!currentMap[k]) {
        const before = prev[k];
        const [repo, id] = k.split('#');
        newItems.push({
          id: `closed:${k}:${Date.now()}`,
          type: 'pr-closed',
          repo,
          prId: Number(id),
          category: before.category,
          title: before.title,
          message: `"${before.title}" is no longer active (merged/closed)`,
          webUrl: before.webUrl,
          timestamp: new Date().toISOString(),
          read: false,
        });
      }
    }
  }

  // C4 — drop notifications for muted repositories.
  const kept = mutedRepos.size ? newItems.filter((i) => !mutedRepos.has(String(i.repo).toLowerCase())) : newItems;

  store.snapshot = currentMap;
  store.items = [...kept, ...(store.items || [])].slice(0, 500);
  save(uid, store);

  return { newItems: kept, unread: getNotifications().unread };
}
