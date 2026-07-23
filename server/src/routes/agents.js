/**
 * Agent session API routes.
 *
 * Two auth models:
 *  - heartbeatRouter — authenticated by a per-user API key (headless reporter on
 *    a VM, no browser session). Mounted in index.js OUTSIDE sessionContext.
 *  - router (default)  — the browser UI routes, behind the normal session context.
 */
import { Router } from 'express';
import * as agentService from '../services/agentSessionService.js';
import { snapshotState } from '../services/prService.js';
import { currentUser } from '../lib/context.js';
import { loadUserConfig } from '../lib/userConfig.js';
import { generateApiKey, getApiKeyStatus, listApiKeys, revokeApiKey } from '../lib/agentApiKeys.js';
import { isValidTimeZone } from '../lib/userConfig.js';
import { agentApiKeyAuth } from '../middleware/agentApiKeyAuth.js';
import { createRateLimit } from '../middleware/rateLimit.js';

// Resolve a user's session-status thresholds from their saved config so the
// "stale after N minutes" and "long-running after N hours" settings take effect.
function thresholds(userId) {
  const cfg = loadUserConfig(userId);
  const staleMinutes = Number(cfg.agents?.staleMinutes) || 5;
  const longRunningHours = Number(cfg.agents?.longRunningHours) || 4;
  return {
    staleMs: staleMinutes * 60 * 1000,
    longRunningMs: longRunningHours * 60 * 60 * 1000,
  };
}

// --- Heartbeat (API-key auth, headless reporter) --------------------------------

export const heartbeatRouter = Router();

// Rate-limit heartbeat to prevent abuse (120 per 5min per IP).
const heartbeatLimiter = createRateLimit({ windowMs: 5 * 60 * 1000, max: 120, name: 'agent-heartbeat' });

heartbeatRouter.post('/', heartbeatLimiter, agentApiKeyAuth, (req, res) => {
  try {
    const user = currentUser();
    const data = req.body;
    if (!data || !data.machineId) {
      return res.status(400).json({ error: 'machineId is required' });
    }
    const session = agentService.heartbeat(user.id, data);
    res.json({ ok: true, session });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// --- Browser UI routes (session auth) ------------------------------------------

const router = Router();

router.get('/sessions', (req, res) => {
  try {
    const user = currentUser();
    const sessions = agentService.getSessions(user.id, thresholds(user.id));
    res.json({ value: sessions });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/sessions/grouped', (req, res) => {
  try {
    const user = currentUser();
    const groups = agentService.getSessionsByMachine(user.id, thresholds(user.id));
    res.json({ value: groups });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Single session detail (for the drawer). Defined after /sessions/grouped so the
// literal path wins over the :id param.
router.get('/sessions/:id', (req, res) => {
  try {
    const user = currentUser();
    const session = agentService.getSessionById(user.id, req.params.id, thresholds(user.id));
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.delete('/sessions/:id', (req, res) => {
  try {
    const user = currentUser();
    const session = agentService.endSession(user.id, req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json({ ok: true, session });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/summary', (req, res) => {
  try {
    const user = currentUser();
    res.json(agentService.getSummary(user.id, thresholds(user.id)));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/overview', (req, res) => {
  try {
    const user = currentUser();
    res.json(agentService.getOverview(user.id, thresholds(user.id)));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/analytics', (req, res) => {
  try {
    const user = currentUser();
    // Bucket hour/day by the caller's zone: an explicit ?tz= wins, else the
    // user's saved setting, else IST.
    const cfg = loadUserConfig(user.id);
    const requested = req.query.tz;
    const tz = (isValidTimeZone(requested) && requested) || cfg.uiPrefs?.timezone || 'Asia/Kolkata';
    res.json(agentService.getAnalytics(user.id, { ...thresholds(user.id), tz }));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Open PRs matching each live session's repo + branch (best-effort; may be slow).
router.get('/pr-matches', async (req, res) => {
  try {
    const user = currentUser();
    const groups = agentService.getSessionsByMachine(user.id, thresholds(user.id));
    const wanted = new Set();
    for (const g of groups) {
      for (const s of g.sessions) {
        if (s.status !== 'ended' && s.repo && s.branch) wanted.add(`${s.repo.toLowerCase()}#${s.branch}`);
      }
    }
    if (wanted.size === 0) return res.json({ matches: {} });
    const prs = await snapshotState();
    const matches = {};
    for (const pr of prs) {
      const k = `${String(pr.repo).toLowerCase()}#${pr.sourceBranch}`;
      if (!wanted.has(k)) continue;
      if (!matches[k]) matches[k] = { count: 0, url: pr.webUrl };
      matches[k].count += 1;
    }
    res.json({ matches });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Set (or clear) a custom display name for a machine. Body: { machineId, label }.
router.put('/machines/label', (req, res) => {
  try {
    const user = currentUser();
    const { machineId, label } = req.body || {};
    res.json({ ok: true, ...agentService.setMachineLabel(user.id, machineId, label) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Remove a machine and all its sessions from the dashboard. Body: { machineId }.
router.post('/machines/remove', (req, res) => {
  try {
    const user = currentUser();
    const { machineId } = req.body || {};
    res.json({ ok: true, ...agentService.removeMachine(user.id, machineId) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/prune', (req, res) => {
  try {
    const user = currentUser();
    res.json({ ok: true, pruned: agentService.pruneSessions(user.id) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Remove all ended sessions immediately.
router.post('/clear-ended', (req, res) => {
  try {
    const user = currentUser();
    res.json({ ok: true, removed: agentService.clearEndedSessions(user.id, thresholds(user.id)) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// --- API key management (for the reporter) -------------------------------------

// Lightweight status for the no-key banner: { hasKey, count }.
router.get('/api-key', (req, res) => {
  try {
    res.json(getApiKeyStatus(currentUser().id));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// List a user's keys (non-secret metadata only).
router.get('/api-keys', (req, res) => {
  try {
    res.json({ value: listApiKeys(currentUser().id) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Mint a new named key. The plain key is returned ONCE. Body: { label }.
router.post('/api-keys', (req, res) => {
  try {
    res.json(generateApiKey(currentUser().id, (req.body || {}).label));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Revoke one key by id.
router.delete('/api-keys/:keyId', (req, res) => {
  try {
    const revoked = revokeApiKey(currentUser().id, req.params.keyId);
    if (!revoked) return res.status(404).json({ error: 'Key not found' });
    res.json({ ok: true, revoked });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;
