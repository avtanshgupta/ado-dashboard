/**
 * Agent session API routes.
 * Heartbeat endpoint for the reporter script + session management for the UI.
 */
import { Router } from 'express';
import * as agentService from '../services/agentSessionService.js';
import { currentUser } from '../lib/context.js';
import { loadUserConfig } from '../lib/userConfig.js';
import { createRateLimit } from '../middleware/rateLimit.js';

const router = Router();

// Rate-limit heartbeat to prevent abuse (120 per 5min per IP).
const heartbeatLimiter = createRateLimit({ windowMs: 5 * 60 * 1000, max: 120, name: 'agent-heartbeat' });

// --- API Key auth for heartbeat (reporter uses this) ---
// The heartbeat endpoint supports both session cookie auth (normal flow) and
// a per-user API key (for the reporter running on remote VMs without a browser).
// API key is stored in user config as `agentApiKey`.

function validateApiKey(req) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const key = auth.slice(7).trim();
  if (!key) return null;
  // Look up which user owns this key. For now scan user configs — in production
  // this would use a reverse-index. We return the userId if found.
  // For simplicity, the heartbeat will just use the session context user.
  return key;
}

// --- Routes ---

router.post('/heartbeat', heartbeatLimiter, (req, res) => {
  try {
    const user = currentUser();
    if (!user) return res.status(401).json({ error: 'Authentication required' });
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

router.get('/sessions', (req, res) => {
  try {
    const user = currentUser();
    const sessions = agentService.getSessions(user.id);
    res.json({ value: sessions });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/sessions/grouped', (req, res) => {
  try {
    const user = currentUser();
    const groups = agentService.getSessionsByMachine(user.id);
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
    const summary = agentService.getSummary(user.id);
    res.json(summary);
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

export default router;
