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
import { currentUser } from '../lib/context.js';
import { loadUserConfig } from '../lib/userConfig.js';
import { generateApiKey, getApiKeyStatus, revokeApiKey } from '../lib/agentApiKeys.js';
import { agentApiKeyAuth } from '../middleware/agentApiKeyAuth.js';
import { createRateLimit } from '../middleware/rateLimit.js';

// Resolve a user's session-status thresholds from their saved config so the
// "stale after N minutes" setting (Settings → Agents) actually takes effect.
function thresholds(userId) {
  const cfg = loadUserConfig(userId);
  const staleMinutes = Number(cfg.agents?.staleMinutes) || 5;
  return { staleMs: staleMinutes * 60 * 1000 };
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
    const summary = agentService.getSummary(user.id, thresholds(user.id));
    res.json(summary);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/overview', (req, res) => {
  try {
    const user = currentUser();
    const overview = agentService.getOverview(user.id, thresholds(user.id));
    res.json(overview);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Set (or clear) a custom display name for a machine. Body: { machineId, label }.
router.put('/machines/label', (req, res) => {
  try {
    const user = currentUser();
    const { machineId, label } = req.body || {};
    const result = agentService.setMachineLabel(user.id, machineId, label);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Remove a machine and all its sessions from the dashboard. Body: { machineId }.
router.post('/machines/remove', (req, res) => {
  try {
    const user = currentUser();
    const { machineId } = req.body || {};
    const result = agentService.removeMachine(user.id, machineId);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/prune', (req, res) => {
  try {
    const user = currentUser();
    const pruned = agentService.pruneSessions(user.id);
    res.json({ ok: true, pruned });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// --- API key management (for the reporter) -------------------------------------

// Mint a new key (revoking any previous one). The plain key is returned ONCE.
router.post('/api-key', (req, res) => {
  try {
    const user = currentUser();
    const key = generateApiKey(user.id);
    res.json(key);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Non-secret status: whether a key exists, its display prefix and age.
router.get('/api-key', (req, res) => {
  try {
    const user = currentUser();
    res.json(getApiKeyStatus(user.id));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

// Revoke the user's key.
router.delete('/api-key', (req, res) => {
  try {
    const user = currentUser();
    const revoked = revokeApiKey(user.id);
    res.json({ ok: true, revoked });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

export default router;
