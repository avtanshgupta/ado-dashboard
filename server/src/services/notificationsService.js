import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { currentUser, currentConfig } from '../lib/context.js';
import { writeJsonAtomic } from '../lib/atomicFile.js';
import { snapshotState } from './prService.js';
import { listDefinitions } from './pipelineService.js';
import * as agentService from './agentSessionService.js';
import { detectPipelineAlerts } from '../lib/pipelineWatch.js';

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
    seedAgentState(uid, cfg, store); // baseline so we don't alert on first load
    await seedPipelineWatch(cfg, store); // baseline watched pipelines too
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

  // Agent alerts (offline machines / long-running sessions) — not repo-muted.
  let agentItems = [];
  try {
    agentItems = detectAgentItems(uid, cfg, store);
  } catch {
    agentItems = [];
  }

  // B4 — watched-pipeline failure alerts (async: reads latest runs).
  let pipelineItems = [];
  try {
    pipelineItems = await detectPipelineWatchItems(cfg, store);
  } catch {
    pipelineItems = [];
  }

  store.snapshot = currentMap;
  store.items = [...agentItems, ...pipelineItems, ...kept, ...(store.items || [])].slice(0, 500);
  save(uid, store);

  return { newItems: [...agentItems, ...pipelineItems, ...kept], unread: getNotifications().unread };
}

function agentThresholds(cfg) {
  const staleMinutes = Number(cfg.agents?.staleMinutes) || 5;
  const longRunningHours = Number(cfg.agents?.longRunningHours) || 4;
  return { staleMs: staleMinutes * 60 * 1000, longRunningMs: longRunningHours * 60 * 60 * 1000 };
}

function makeAgentItem(type, machine, message) {
  return {
    id: `${type}:${machine}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
    type,
    repo: machine, // shown as the badge on the notification
    machine,
    message,
    link: '/agents',
    timestamp: new Date().toISOString(),
    read: false,
  };
}

/** Baseline the agent state without emitting, so the first poll doesn't spam. */
function seedAgentState(userId, cfg, store) {
  try {
    const groups = agentService.getSessionsByMachine(userId, agentThresholds(cfg));
    const snap = {};
    const long = [];
    for (const g of groups) {
      snap[g.machineId] = g.status;
      for (const s of g.sessions) if (s.longRunning) long.push(s.id);
    }
    store.agentSnapshot = snap;
    store.agentLongRun = long;
  } catch {
    /* ignore */
  }
}

/**
 * Detect agent-alert transitions since the last poll: a machine that dropped from
 * online → stale/ended, and sessions that newly crossed the long-running threshold.
 */
function detectAgentItems(userId, cfg, store) {
  const prefs = cfg.notificationPrefs || {};
  if (!prefs.agentOffline && !prefs.agentLongRunning) return [];
  const groups = agentService.getSessionsByMachine(userId, agentThresholds(cfg));
  const items = [];
  const prevSnap = store.agentSnapshot || {};
  const snap = {};
  const alreadyLong = new Set(store.agentLongRun || []);
  const stillLong = [];

  for (const g of groups) {
    snap[g.machineId] = g.status;
    if (prefs.agentOffline) {
      const was = prevSnap[g.machineId];
      const wasOnline = was === 'active' || was === 'idle';
      const nowDown = g.status === 'stale' || g.status === 'ended';
      if (wasOnline && nowDown) {
        items.push(makeAgentItem('agent-offline', g.name, `Machine “${g.name}” went ${g.status} — its reporter stopped heartbeating.`));
      }
    }
    if (prefs.agentLongRunning) {
      for (const s of g.sessions) {
        if (s.longRunning) {
          stillLong.push(s.id);
          if (!alreadyLong.has(s.id)) {
            items.push(makeAgentItem('agent-long-running', g.name, `Session on “${g.name}”${s.repo ? ` (${s.repo})` : ''} has been running ${s.runtime}.`));
          }
        }
      }
    }
  }

  store.agentSnapshot = snap;
  store.agentLongRun = stillLong; // drop ids that ended / are no longer long-running
  return items;
}

// --- B4: watched-pipeline failure alerts ---------------------------------------

/** Fetch the latest run per watched pipeline (empty when nothing is watched). */
async function watchedDefinitions(cfg) {
  const watched = new Set((cfg.watchedPipelines || []).map(Number));
  if (watched.size === 0) return { watched, defs: [] };
  const all = await listDefinitions({ withLatest: true });
  return { watched, defs: all.filter((d) => watched.has(Number(d.definitionId))) };
}

/** Baseline the watched-pipeline run snapshot so the first poll doesn't alert. */
async function seedPipelineWatch(cfg, store) {
  try {
    const { watched, defs } = await watchedDefinitions(cfg);
    if (watched.size === 0) { store.pipelineSnapshot = {}; return; }
    const { snapshot } = detectPipelineAlerts({}, defs.map(toWatchDef), watched);
    store.pipelineSnapshot = snapshot;
  } catch {
    store.pipelineSnapshot = store.pipelineSnapshot || {};
  }
}

/** Normalize a listDefinitions entry to the shape detectPipelineAlerts expects. */
function toWatchDef(d) {
  return {
    definitionId: d.definitionId,
    name: d.label || d.name,
    webUrl: d.webUrl,
    lastRun: d.lastRun ? { id: d.lastRun.id, result: d.lastRun.result, webUrl: d.lastRun.webUrl } : null,
  };
}

/** Detect new failed runs on watched pipelines since the last poll. */
async function detectPipelineWatchItems(cfg, store) {
  const prefs = cfg.notificationPrefs || {};
  if (!prefs.pipelineWatchFailed) return [];
  const { watched, defs } = await watchedDefinitions(cfg);
  if (watched.size === 0) return [];
  const { alerts, snapshot } = detectPipelineAlerts(store.pipelineSnapshot || {}, defs.map(toWatchDef), watched);
  store.pipelineSnapshot = snapshot;
  return alerts.map((a) => ({
    id: `pipeline-watch:${a.definitionId}:${a.runId}`,
    type: 'pipeline-watch-failed',
    repo: a.name, // shown as the badge
    message: `Watched pipeline “${a.name}” had a failed run (${a.result}).`,
    webUrl: a.webUrl,
    timestamp: new Date().toISOString(),
    read: false,
  }));
}
